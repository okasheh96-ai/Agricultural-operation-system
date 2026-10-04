-- Foundation 3/5: workflow (state machine) engine, idempotent mutations and sync conflicts.
--
-- Operational purpose (Master Prompt §3.5, §3.7): every status change in every module goes through
-- transition_record(), which checks the versioned allowed_transitions data, the six-dimension
-- permission, required fields and segregation of duties, then writes status, history and audit.
-- Offline replays carry an idempotency key so a retry over a weak link never applies twice, and a
-- replay the server rejects lands in sync_conflicts instead of being dropped.

set check_function_bodies = off;

create table public.workflow_versions (
  id            uuid primary key default gen_random_uuid(),
  workflow_code text not null,
  version_no    integer not null check (version_no > 0),
  is_active     boolean not null default false,
  published_at  timestamptz,
  note          text
);
comment on table public.workflow_versions is
  'A versioned set of statuses and transitions for one workflow (e.g. asset_status, task). Records keep the '
  'version they started under, so the farm can change rules after discovery without corrupting history.';

create table public.workflow_statuses (
  id                  uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.workflow_versions(id),
  code                text not null,
  name_ar             text not null,
  name_en             text,
  is_initial          boolean not null default false,
  is_terminal         boolean not null default false,
  sort_order          integer not null default 0,
  unique (workflow_version_id, code)
);
comment on table public.workflow_statuses is 'Statuses of one workflow version, with Arabic/English labels.';
create unique index workflow_statuses_one_initial on public.workflow_statuses (workflow_version_id) where is_initial;

create table public.allowed_transitions (
  id                  uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.workflow_versions(id),
  from_status         text not null,
  to_status           text not null,
  required_action     text not null check (required_action in
                        ('view', 'create', 'plan', 'dispatch', 'execute', 'review', 'verify', 'approve', 'close', 'configure', 'void')),
  required_fields     text[] not null default '{}',
  must_differ_from    text[] not null default '{}',
  set_actor_column    text,
  foreign key (workflow_version_id, from_status) references public.workflow_statuses (workflow_version_id, code),
  foreign key (workflow_version_id, to_status) references public.workflow_statuses (workflow_version_id, code),
  check (from_status <> to_status)
);
comment on table public.allowed_transitions is
  'State machine as data: which status change is allowed, which permission action it needs, which payload '
  'fields are mandatory (e.g. reason), which record roles the actor must differ from (segregation of duties), '
  'and which column records the actor (e.g. verified_by). Synced to devices for provisional offline changes.';

select app.register_table('public.workflow_versions', 'workflow', false);
create unique index workflow_versions_uq on public.workflow_versions (farm_id, workflow_code, version_no);
create unique index workflow_versions_one_active on public.workflow_versions (farm_id, workflow_code)
  where is_active and voided_at is null;
select app.register_table('public.workflow_statuses', 'workflow', false);
select app.register_table('public.allowed_transitions', 'workflow', false);
create unique index allowed_transitions_uq on public.allowed_transitions (workflow_version_id, from_status, to_status)
  where voided_at is null;

-- Published versions are frozen: change rules by creating a new version.
create function app.forbid_published_workflow_change() returns trigger
language plpgsql
as $$
declare
  v_published timestamptz;
begin
  select published_at into v_published from public.workflow_versions where id = new.workflow_version_id;
  if v_published is not null then
    raise exception 'Workflow version is published; create a new version to change its rules' using errcode = 'P0422';
  end if;
  return new;
end;
$$;
create trigger workflow_statuses_frozen before insert or update on public.workflow_statuses
  for each row execute function app.forbid_published_workflow_change();
create trigger allowed_transitions_frozen before insert or update on public.allowed_transitions
  for each row execute function app.forbid_published_workflow_change();

-- ---------------------------------------------------------------------------------------------
create table public.record_transitions (
  id                  uuid primary key default gen_random_uuid(),
  farm_id             uuid not null references public.farms(id),
  entity_type         text not null,
  entity_id           uuid not null,
  workflow_version_id uuid not null references public.workflow_versions(id),
  from_status         text not null,
  to_status           text not null,
  actor_user_id       uuid not null references auth.users(id),
  comment             text,
  payload             jsonb not null default '{}',
  client_recorded_at  timestamptz,
  server_received_at  timestamptz not null default now(),
  clock_skew_seconds  numeric,
  clock_skew_flag     boolean not null default false,
  device_id           text,
  idempotency_key     uuid
);
comment on table public.record_transitions is
  'Status history of every workflow-governed record (asset/well status history, task history, ...), with '
  'who, why, device time vs server time and a clock-skew flag. Written only by transition_record().';
create index record_transitions_entity_idx on public.record_transitions (entity_type, entity_id, server_received_at);
alter table public.record_transitions enable row level security;
create policy record_transitions_select on public.record_transitions for select to authenticated
  using (app.is_farm_member(farm_id));
create trigger record_transitions_immutable before update or delete on public.record_transitions
  for each row execute function app.forbid_audit_change();

create table public.processed_mutations (
  idempotency_key uuid primary key,
  farm_id         uuid not null references public.farms(id),
  user_id         uuid not null references auth.users(id),
  kind            text not null,
  outcome         text not null check (outcome in ('applied', 'conflict')),
  result          jsonb not null,
  processed_at    timestamptz not null default now()
);
comment on table public.processed_mutations is
  'Idempotency keys of mutations already processed, so offline retries return the stored result instead of applying twice.';
alter table public.processed_mutations enable row level security;
create policy processed_mutations_select_own on public.processed_mutations for select to authenticated
  using (user_id = auth.uid());

create table public.sync_conflicts (
  id               uuid primary key default gen_random_uuid(),
  farm_id          uuid not null references public.farms(id),
  user_id          uuid not null references auth.users(id),
  idempotency_key  uuid not null,
  entity_type      text not null,
  entity_id        uuid not null,
  attempted        jsonb not null,
  reason_code      text not null,
  reason_message   text not null,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id),
  resolution       text,
  check ((resolved_at is null) = (resolution is null))
);
comment on table public.sync_conflicts is
  'Offline changes the server rejected at sync, with a readable reason. Visible to the user until resolved; never silently dropped.';
alter table public.sync_conflicts enable row level security;
create policy sync_conflicts_select on public.sync_conflicts for select to authenticated
  using (user_id = auth.uid() or app.has_permission(farm_id, 'sync_conflict', 'review'));

-- ---------------------------------------------------------------------------------------------
-- transition_record
-- ---------------------------------------------------------------------------------------------
create function public.transition_record(
  p_entity_type        text,
  p_id                 uuid,
  p_to_status          text,
  p_payload            jsonb default '{}',
  p_comment            text default null,
  p_expected_version   integer default null,
  p_idempotency_key    uuid default null,
  p_client_recorded_at timestamptz default null,
  p_device_id          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid     uuid := app.current_user_id();
  reg       app.registered_tables;
  rec       jsonb;
  tr        public.allowed_transitions;
  v_from    text;
  v_farm    uuid;
  v_dept    uuid;
  v_loc     uuid;
  v_field   text;
  v_col     text;
  v_skew    numeric;
  v_flag    boolean := false;
  v_limit   numeric;
  v_new_ver integer;
  v_result  jsonb;
  v_prev    public.processed_mutations;
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;

  if p_idempotency_key is not null then
    select * into v_prev from public.processed_mutations where idempotency_key = p_idempotency_key;
    if found then
      if v_prev.user_id <> v_uid then
        raise exception 'Idempotency key belongs to another user' using errcode = 'P0403';
      end if;
      return v_prev.result || jsonb_build_object('replayed', true);
    end if;
  end if;

  select * into reg from app.registered_tables where table_name = p_entity_type;
  if reg.workflow_code is null then
    raise exception 'Unknown workflow entity %', p_entity_type using errcode = 'P0422';
  end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', reg.table_name)
    into rec using p_id;
  if rec is null then
    raise exception 'Record not found' using errcode = 'P0404';
  end if;

  v_farm := (rec ->> 'farm_id')::uuid;
  v_from := rec ->> 'status';
  v_dept := case when reg.department_column is not null then (rec ->> reg.department_column)::uuid end;
  v_loc  := case when reg.location_column is not null then (rec ->> reg.location_column)::uuid end;

  if not app.is_farm_member(v_farm) then
    raise exception 'Record not found' using errcode = 'P0404';
  end if;
  if (rec ->> 'voided_at') is not null then
    raise exception 'Voided records cannot change status' using errcode = 'P0422';
  end if;
  if p_expected_version is not null and p_expected_version <> (rec ->> 'version')::int then
    raise exception 'Record was changed by someone else (expected version %, current %)',
      p_expected_version, rec ->> 'version' using errcode = 'P0409';
  end if;

  select * into tr from public.allowed_transitions
   where workflow_version_id = (rec ->> 'workflow_version_id')::uuid
     and from_status = v_from and to_status = p_to_status and voided_at is null;
  if not found then
    raise exception 'Transition % → % is not allowed', v_from, p_to_status using errcode = 'P0422';
  end if;

  if not app.has_permission(v_farm, reg.object_type, tr.required_action, v_dept, v_loc, v_from) then
    raise exception 'You do not have permission to % this record', tr.required_action using errcode = 'P0403';
  end if;

  foreach v_field in array tr.required_fields loop
    if v_field = 'comment' then
      if coalesce(trim(p_comment), '') = '' then
        raise exception 'A comment is required for this change' using errcode = 'P0422';
      end if;
    elsif coalesce(trim(p_payload ->> v_field), '') = '' and coalesce(trim(rec ->> v_field), '') = '' then
      raise exception 'Field "%" is required for this change', v_field using errcode = 'P0422';
    end if;
  end loop;

  -- Segregation of duties: the actor may not hold the listed record roles, nor act for someone
  -- who does through a delegation (a delegation never lets you verify the delegator's own work).
  foreach v_col in array tr.must_differ_from loop
    if (rec ->> v_col) is not null
       and ((rec ->> v_col)::uuid = v_uid or (rec ->> v_col)::uuid in (select app.active_delegators(v_farm))) then
      raise exception 'Segregation of duties: the % of this record cannot perform this step', v_col
        using errcode = 'P0423';
    end if;
  end loop;

  if p_client_recorded_at is not null then
    v_skew := abs(extract(epoch from (now() - p_client_recorded_at)));
    select (value #>> '{}')::numeric into v_limit from public.settings
     where farm_id = v_farm and key = 'clock_skew_flag_seconds' and voided_at is null;
    v_flag := v_skew > coalesce(v_limit, 300);
  end if;

  perform set_config('app.in_transition', 'on', true);
  perform set_config('app.audit_comment', coalesce(p_comment, ''), true);
  perform set_config('app.client_recorded_at', coalesce(p_client_recorded_at::text, ''), true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);
  perform set_config('app.idempotency_key', coalesce(p_idempotency_key::text, ''), true);

  execute format(
    'update public.%I set status = $1%s where id = $2 returning version',
    reg.table_name,
    case when tr.set_actor_column is not null then format(', %I = $3', tr.set_actor_column) else '' end
  ) into v_new_ver using p_to_status, p_id, v_uid;

  insert into public.record_transitions
    (farm_id, entity_type, entity_id, workflow_version_id, from_status, to_status, actor_user_id, comment, payload,
     client_recorded_at, clock_skew_seconds, clock_skew_flag, device_id, idempotency_key)
  values
    (v_farm, reg.table_name, p_id, (rec ->> 'workflow_version_id')::uuid, v_from, p_to_status, v_uid, p_comment,
     coalesce(p_payload, '{}'), p_client_recorded_at, v_skew, v_flag, p_device_id, p_idempotency_key);

  perform set_config('app.in_transition', 'off', true);
  perform set_config('app.audit_comment', '', true);

  v_result := jsonb_build_object('id', p_id, 'from_status', v_from, 'to_status', p_to_status,
                                 'version', v_new_ver, 'clock_skew_flag', v_flag);

  if p_idempotency_key is not null then
    insert into public.processed_mutations (idempotency_key, farm_id, user_id, kind, outcome, result)
    values (p_idempotency_key, v_farm, v_uid, 'transition', 'applied', v_result);
  end if;

  return v_result;
end;
$$;
comment on function public.transition_record is
  'The only way any status changes. Checks transition rules (versioned), permission, required fields and '
  'segregation of duties; writes status, history and audit; idempotent when given a key.';

-- Offline replay entry point: never loses the change. A rejection is stored as a conflict.
create function public.sync_transition(
  p_entity_type        text,
  p_id                 uuid,
  p_to_status          text,
  p_idempotency_key    uuid,
  p_client_recorded_at timestamptz,
  p_payload            jsonb default '{}',
  p_comment            text default null,
  p_expected_version   integer default null,
  p_device_id          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid    uuid := app.current_user_id();
  v_prev   public.processed_mutations;
  v_farm   uuid;
  v_state  text;
  v_msg    text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;
  if p_idempotency_key is null or p_client_recorded_at is null then
    raise exception 'Offline mutations need an idempotency key and device time' using errcode = 'P0422';
  end if;

  select * into v_prev from public.processed_mutations where idempotency_key = p_idempotency_key;
  if found then
    if v_prev.user_id <> v_uid then
      raise exception 'Idempotency key belongs to another user' using errcode = 'P0403';
    end if;
    return v_prev.result || jsonb_build_object('replayed', true);
  end if;

  begin
    return jsonb_build_object('outcome', 'applied') || public.transition_record(
      p_entity_type, p_id, p_to_status, p_payload, p_comment, p_expected_version,
      p_idempotency_key, p_client_recorded_at, p_device_id);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;

  -- Resolve the farm without leaking existence of records outside the caller's farms.
  begin
    execute format('select farm_id from public.%I where id = $1', p_entity_type) into v_farm using p_id;
  exception when others then
    v_farm := null;
  end;
  if v_farm is null or not app.is_farm_member(v_farm) then
    raise exception 'Record not found' using errcode = 'P0404';
  end if;

  v_result := jsonb_build_object('outcome', 'conflict', 'reason_code', v_state, 'reason_message', v_msg,
                                 'id', p_id, 'to_status', p_to_status);

  insert into public.sync_conflicts (farm_id, user_id, idempotency_key, entity_type, entity_id, attempted, reason_code, reason_message)
  values (v_farm, v_uid, p_idempotency_key, p_entity_type, p_id,
          jsonb_build_object('to_status', p_to_status, 'payload', p_payload, 'comment', p_comment,
                             'expected_version', p_expected_version, 'client_recorded_at', p_client_recorded_at,
                             'device_id', p_device_id),
          v_state, v_msg);

  insert into public.processed_mutations (idempotency_key, farm_id, user_id, kind, outcome, result)
  values (p_idempotency_key, v_farm, v_uid, 'transition', 'conflict', v_result);

  return v_result;
end;
$$;
comment on function public.sync_transition is
  'Replays a queued offline status change. Applied, or stored in sync_conflicts with a readable reason; idempotent.';

create function public.resolve_sync_conflict(p_id uuid, p_resolution text) returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  c public.sync_conflicts;
begin
  select * into c from public.sync_conflicts where id = p_id for update;
  if not found or not (c.user_id = app.current_user_id() or app.has_permission(c.farm_id, 'sync_conflict', 'review')) then
    raise exception 'Conflict not found' using errcode = 'P0404';
  end if;
  if c.resolved_at is not null then
    raise exception 'Conflict already resolved' using errcode = 'P0422';
  end if;
  if coalesce(trim(p_resolution), '') = '' then
    raise exception 'A resolution note is required' using errcode = 'P0422';
  end if;
  update public.sync_conflicts
     set resolved_at = now(), resolved_by = app.current_user_id(), resolution = p_resolution
   where id = p_id;
end;
$$;
