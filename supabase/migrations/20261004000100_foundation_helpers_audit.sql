-- Foundation 1/5: internal helpers, the standard row contract and the append-only audit log.
--
-- Operational purpose: every operational and master table in this system shares one contract
-- (UUID id, farm_id, created/updated by/at, optimistic version, soft void with reason, and for master
-- data a verification status). Instead of re-implementing it per module, tables are registered with
-- app.register_table(), which adds the columns, triggers and RLS (Master Prompt §3.4, §3.8, §2.0).

create extension if not exists btree_gist;

create schema if not exists app;
comment on schema app is 'Internal helpers for business rules. Not exposed through the API.';

-- Evidence of a master record (Master Prompt §3.4): never present an unconfirmed value as fact.
create type app.verification_status as enum ('verified', 'not_yet_verified', 'to_be_confirmed_on_site', 'conflicting');

-- ---------------------------------------------------------------------------------------------
-- Identity of the real acting user. Elevated server functions running without a JWT must set
-- app.acting_user_id to the real caller; audit rows are never written as an anonymous "service".
-- auth.uid() always wins so an authenticated client cannot impersonate someone else.
-- ---------------------------------------------------------------------------------------------
create function app.current_user_id() returns uuid
language sql stable
as $$
  select coalesce(auth.uid(), nullif(current_setting('app.acting_user_id', true), '')::uuid)
$$;

-- Arabic search normalization (Master Prompt §3.9): alef variants, ta marbuta/ha, alef maqsura/ya,
-- diacritics and tatweel compare as equal. Mirrored in src/core/i18n/normalizeArabic.ts.
create function app.normalize_ar(p text) returns text
language sql immutable parallel safe
as $$
  select lower(
    translate(
      regexp_replace(coalesce(p, ''), '[ً-ْٰـ]', '', 'g'),
      'أإآٱةى',
      'ااااهي'
    )
  )
$$;

-- Session flags set (transaction-local) by the server functions that own guarded columns.
create function app.flag(p_name text) returns boolean
language sql stable
as $$ select coalesce(current_setting('app.' || p_name, true), '') = 'on' $$;

-- ---------------------------------------------------------------------------------------------
-- Registry of standard tables (used by transition_record, verification and void functions).
-- ---------------------------------------------------------------------------------------------
create table app.registered_tables (
  table_name        text primary key,
  object_type       text not null,
  is_master         boolean not null,
  workflow_code     text,
  department_column text,
  location_column   text
);
comment on table app.registered_tables is
  'One row per standard table: which permission object type governs it, whether it is master data '
  '(carries verification status), which workflow governs its status, and which columns give its '
  'department and location scope for permission checks.';

-- ---------------------------------------------------------------------------------------------
-- BEFORE INSERT/UPDATE: stamps, optimistic concurrency and guarded columns.
-- ---------------------------------------------------------------------------------------------
create function app.before_write() returns trigger
language plpgsql
security definer  -- reads the registry and workflow config regardless of the caller's RLS; only edits NEW
set search_path = public, app, pg_temp
as $$
declare
  reg      app.registered_tables;
  n        jsonb := to_jsonb(new);
  o        jsonb;
  v_init   text;
  v_wfv    uuid;
begin
  select * into reg from app.registered_tables where table_name = tg_table_name;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.created_by := app.current_user_id();
    new.updated_by := new.created_by;
    new.version    := 1;

    if n ->> 'voided_at' is not null then
      raise exception 'A record cannot be created already voided' using errcode = 'P0422';
    end if;

    if reg.is_master and (n ->> 'verification_status') = 'verified' and not app.flag('in_verify') then
      raise exception 'Master data can only be marked verified through set_verification_status()'
        using errcode = 'P0403';
    end if;

    if reg.workflow_code is not null and not app.flag('in_transition') then
      -- New records start on the active workflow version, in its initial status.
      select wv.id, ws.code into v_wfv, v_init
        from public.workflow_versions wv
        join public.workflow_statuses ws on ws.workflow_version_id = wv.id and ws.is_initial
       where wv.farm_id = (n ->> 'farm_id')::uuid and wv.workflow_code = reg.workflow_code
         and wv.is_active and wv.voided_at is null;
      if v_wfv is null then
        raise exception 'No active workflow version for %', reg.workflow_code using errcode = 'P0422';
      end if;
      if (n ->> 'status') is not null and (n ->> 'status') <> v_init then
        raise exception 'New % records start in status "%"; status changes go through transition_record()',
          tg_table_name, v_init using errcode = 'P0403';
      end if;
      new := jsonb_populate_record(new, jsonb_build_object('status', v_init, 'workflow_version_id', v_wfv));
    end if;
    return new;
  end if;

  -- UPDATE
  o := to_jsonb(old);

  if (o ->> 'voided_at') is not null then
    raise exception 'Voided records cannot be changed' using errcode = 'P0422';
  end if;

  if (n ->> 'version')::int is distinct from (o ->> 'version')::int then
    raise exception 'Record was changed by someone else (expected version %, current %)',
      n ->> 'version', o ->> 'version' using errcode = 'P0409';
  end if;

  if n -> 'id' <> o -> 'id' or n -> 'created_at' <> o -> 'created_at'
     or (n -> 'created_by') is distinct from (o -> 'created_by')
     or (n ? 'farm_id' and n -> 'farm_id' <> o -> 'farm_id') then
    raise exception 'id, farm_id and creation stamps are immutable' using errcode = 'P0403';
  end if;

  if not app.flag('in_transition')
     and ((n -> 'status') is distinct from (o -> 'status')
          or (n -> 'workflow_version_id') is distinct from (o -> 'workflow_version_id')) then
    raise exception 'Status changes must go through transition_record()' using errcode = 'P0403';
  end if;

  if not app.flag('in_void')
     and ((n -> 'voided_at') is distinct from (o -> 'voided_at')
          or (n -> 'voided_by') is distinct from (o -> 'voided_by')
          or (n -> 'void_reason') is distinct from (o -> 'void_reason')) then
    raise exception 'Records are voided only through void_record()' using errcode = 'P0403';
  end if;

  if reg.is_master and not app.flag('in_verify')
     and ((n -> 'verification_status') is distinct from (o -> 'verification_status')
          or (n -> 'verified_by') is distinct from (o -> 'verified_by')
          or (n -> 'verified_at') is distinct from (o -> 'verified_at')) then
    raise exception 'Verification status changes only through set_verification_status()' using errcode = 'P0403';
  end if;

  new.version    := (o ->> 'version')::int + 1;
  new.updated_at := now();
  new.updated_by := app.current_user_id();
  return new;
end;
$$;

create function app.forbid_delete() returns trigger
language plpgsql
as $$
begin
  raise exception 'Operational and master records are never deleted; void them with a reason (table %)', tg_table_name
    using errcode = 'P0403';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Audit log (Master Prompt §3.8): append-only, written only by triggers.
-- ---------------------------------------------------------------------------------------------
create table public.audit_events (
  id                  bigint generated always as identity primary key,
  farm_id             uuid,
  actor_user_id       uuid,
  actor_kind          text not null check (actor_kind in ('user', 'scheduler', 'system')),
  action              text not null check (action in ('insert', 'update', 'transition', 'verify', 'void')),
  entity_type         text not null,
  entity_id           uuid not null,
  before              jsonb,
  after               jsonb,
  comment             text,
  client_recorded_at  timestamptz,
  server_received_at  timestamptz not null default now(),
  device_id           text,
  idempotency_key     uuid,
  gps                 jsonb
);
comment on table public.audit_events is
  'Append-only trail of every change to operational and master records: who, what, when, old and new '
  'values, comment, device and client time. Nobody can update or delete it.';
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, id);
create index audit_events_farm_time_idx on public.audit_events (farm_id, server_received_at desc);
create index audit_events_actor_idx on public.audit_events (actor_user_id, server_received_at desc);

create function app.forbid_audit_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'The audit log is append-only' using errcode = 'P0403';
end;
$$;

create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function app.forbid_audit_change();
create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function app.forbid_audit_change();

create function app.audit_row() returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  n        jsonb := to_jsonb(new);
  o        jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_actor  uuid  := app.current_user_id();
  v_kind   text;
  v_action text;
begin
  if v_actor is not null then
    v_kind := 'user';
  elsif current_setting('app.actor_kind', true) = 'scheduler' then
    v_kind := 'scheduler';
  -- current_user is the definer here; the API role is in the session's "role" setting.
  elsif current_setting('role', true) = 'service_role' then
    raise exception 'Elevated writes must pass the real acting user (app.acting_user_id)' using errcode = 'P0403';
  elsif current_setting('role', true) in ('authenticated', 'anon') then
    raise exception 'Writes require a signed-in user' using errcode = 'P0403';
  else
    v_kind := 'system';  -- migrations and structure seeds run by the database owner
  end if;

  v_action := case
    when tg_op = 'INSERT' then 'insert'
    when (n ->> 'voided_at') is not null and (o ->> 'voided_at') is null then 'void'
    when (n -> 'status') is distinct from (o -> 'status') then 'transition'
    when (n -> 'verification_status') is distinct from (o -> 'verification_status') then 'verify'
    else 'update'
  end;

  insert into public.audit_events
    (farm_id, actor_user_id, actor_kind, action, entity_type, entity_id, before, after, comment,
     client_recorded_at, device_id, idempotency_key)
  values (
    coalesce((n ->> 'farm_id')::uuid, case when tg_table_name = 'farms' then (n ->> 'id')::uuid end),
    v_actor, v_kind, v_action, tg_table_name, (n ->> 'id')::uuid, o, n,
    nullif(current_setting('app.audit_comment', true), ''),
    nullif(current_setting('app.client_recorded_at', true), '')::timestamptz,
    nullif(current_setting('app.device_id', true), ''),
    nullif(current_setting('app.idempotency_key', true), '')::uuid
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- app.register_table: apply the standard contract to a table.
-- ---------------------------------------------------------------------------------------------
create function app.register_table(
  p_table             regclass,
  p_object_type       text,
  p_is_master         boolean,
  p_workflow_code     text default null,
  p_department_column text default null,
  p_location_column   text default null,
  p_has_farm          boolean default true,
  p_default_policies  boolean default true
) returns void
language plpgsql
as $$
declare
  t      text := (select relname from pg_class where oid = p_table);
  dept   text := coalesce(quote_ident(p_department_column), 'null::uuid');
  loc    text := coalesce(quote_ident(p_location_column), 'null::uuid');
begin
  if p_has_farm then
    execute format('alter table %s add column if not exists farm_id uuid not null references public.farms(id)', p_table);
    execute format('create index if not exists %I on %s (farm_id)', t || '_farm_idx', p_table);
  end if;

  execute format($f$
    alter table %s
      add column if not exists created_by uuid references auth.users(id),
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_by uuid references auth.users(id),
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists version integer not null default 1,
      add column if not exists client_recorded_at timestamptz,
      add column if not exists voided_at timestamptz,
      add column if not exists voided_by uuid references auth.users(id),
      add column if not exists void_reason text,
      add constraint %I check ((voided_at is null) = (void_reason is null))
  $f$, p_table, t || '_void_consistency');

  if p_is_master then
    execute format($f$
      alter table %s
        add column if not exists verification_status app.verification_status not null default 'not_yet_verified',
        add column if not exists verified_by uuid references auth.users(id),
        add column if not exists verified_at timestamptz,
        add column if not exists source_note text,
        add constraint %I check (
          verification_status <> 'verified'
          or (verified_at is not null and (verified_by is not null or source_note is not null)))
    $f$, p_table, t || '_verified_needs_evidence');
  end if;

  if p_workflow_code is not null then
    execute format($f$
      alter table %s
        add column if not exists status text not null,
        add column if not exists workflow_version_id uuid not null references public.workflow_versions(id),
        add constraint %I foreign key (workflow_version_id, status)
          references public.workflow_statuses (workflow_version_id, code)
    $f$, p_table, t || '_status_fk');
    execute format('create index if not exists %I on %s (status)', t || '_status_idx', p_table);
  end if;

  insert into app.registered_tables values (t, p_object_type, p_is_master, p_workflow_code, p_department_column, p_location_column);

  execute format('create trigger %I before insert or update on %s for each row execute function app.before_write()', t || '_before_write', p_table);
  execute format('create trigger %I before delete on %s for each row execute function app.forbid_delete()', t || '_no_delete', p_table);
  execute format('create trigger %I after insert or update on %s for each row execute function app.audit_row()', t || '_audit', p_table);

  execute format('alter table %s enable row level security', p_table);

  if p_default_policies and p_has_farm then
    -- Read: any member of the farm (field pickers need master data). Tier C, VR-C02.
    execute format('create policy %I on %s for select to authenticated using (app.is_farm_member(farm_id))', t || '_select', p_table);
    execute format('create policy %I on %s for insert to authenticated with check (app.has_permission(farm_id, %L, %L, %s, %s))',
      t || '_insert', p_table, p_object_type, 'create', dept, loc);
    execute format('create policy %I on %s for update to authenticated using (app.has_permission(farm_id, %L, %L, %s, %s)) with check (app.has_permission(farm_id, %L, %L, %s, %s))',
      t || '_update', p_table, p_object_type, 'configure', dept, loc, p_object_type, 'configure', dept, loc);
  end if;
end;
$$;
comment on function app.register_table is
  'Applies the standard row contract (stamps, version, void, verification, workflow status, audit, '
  'no-delete, RLS and default policies) to a table and records it in app.registered_tables.';
