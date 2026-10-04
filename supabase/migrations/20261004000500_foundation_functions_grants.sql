-- Foundation 5/5: verification queue, verify/void server functions, first-admin bootstrap, device
-- revocation, audit log access and API grants.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------------------------
-- Verification (Master Prompt §3.4, §4.5): master values stay "Not Yet Verified" until an
-- authorised person verifies them, with evidence.
-- ---------------------------------------------------------------------------------------------
create function public.set_verification_status(
  p_entity_type      text,
  p_id               uuid,
  p_status           app.verification_status,
  p_source_note      text,
  p_expected_version integer
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid  uuid := app.current_user_id();
  reg    app.registered_tables;
  rec    jsonb;
  v_ver  integer;
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;
  select * into reg from app.registered_tables where table_name = p_entity_type and is_master;
  if not found then
    raise exception 'Unknown master data type %', p_entity_type using errcode = 'P0422';
  end if;
  if coalesce(trim(p_source_note), '') = '' then
    raise exception 'A source note (who confirmed it, how) is required' using errcode = 'P0422';
  end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', reg.table_name) into rec using p_id;
  if rec is null or not app.is_farm_member(coalesce((rec ->> 'farm_id')::uuid, (rec ->> 'id')::uuid)) then
    raise exception 'Record not found' using errcode = 'P0404';
  end if;
  if not app.has_permission(coalesce((rec ->> 'farm_id')::uuid, (rec ->> 'id')::uuid), reg.object_type, 'verify',
       case when reg.department_column is not null then (rec ->> reg.department_column)::uuid end,
       case when reg.location_column is not null then (rec ->> reg.location_column)::uuid end) then
    raise exception 'You do not have permission to verify this record' using errcode = 'P0403';
  end if;

  perform set_config('app.in_verify', 'on', true);
  perform set_config('app.audit_comment', p_source_note, true);
  execute format(
    'update public.%I set verification_status = $1, source_note = $2, verified_by = $3, verified_at = $4, version = $5 '
    'where id = $6 returning version', reg.table_name)
    into v_ver
    using p_status, p_source_note,
          case when p_status = 'verified' then v_uid end,
          case when p_status = 'verified' then now() end,
          p_expected_version, p_id;
  perform set_config('app.in_verify', 'off', true);
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('id', p_id, 'verification_status', p_status, 'version', v_ver);
end;
$$;

-- Records are voided with a reason, never deleted (§2.9).
create function public.void_record(
  p_entity_type      text,
  p_id               uuid,
  p_reason           text,
  p_expected_version integer
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid  uuid := app.current_user_id();
  reg    app.registered_tables;
  rec    jsonb;
  v_farm uuid;
  v_ver  integer;
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;
  select * into reg from app.registered_tables where table_name = p_entity_type;
  if not found then
    raise exception 'Unknown record type %', p_entity_type using errcode = 'P0422';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a record' using errcode = 'P0422';
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', reg.table_name) into rec using p_id;
  v_farm := coalesce((rec ->> 'farm_id')::uuid, (rec ->> 'id')::uuid);
  if rec is null or not app.is_farm_member(v_farm) then
    raise exception 'Record not found' using errcode = 'P0404';
  end if;
  if not app.has_permission(v_farm, reg.object_type, 'void',
       case when reg.department_column is not null then (rec ->> reg.department_column)::uuid end,
       case when reg.location_column is not null then (rec ->> reg.location_column)::uuid end,
       rec ->> 'status') then
    raise exception 'You do not have permission to void this record' using errcode = 'P0403';
  end if;

  perform set_config('app.in_void', 'on', true);
  perform set_config('app.audit_comment', p_reason, true);
  execute format(
    'update public.%I set voided_at = now(), voided_by = $1, void_reason = $2, version = $3 where id = $4 returning version',
    reg.table_name) into v_ver using v_uid, p_reason, p_expected_version, p_id;
  perform set_config('app.in_void', 'off', true);
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('id', p_id, 'voided', true, 'version', v_ver);
end;
$$;

-- Everything awaiting confirmation, in one queue for the Administration → Verification Queue screen.
create view public.verification_queue with (security_invoker = true) as
          select 'departments'::text as entity_type, id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.departments where voided_at is null and verification_status <> 'verified'
union all select 'units', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.units where voided_at is null and verification_status <> 'verified'
union all select 'production_systems', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.production_systems where voided_at is null and verification_status <> 'verified'
union all select 'locations', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.locations where voided_at is null and verification_status <> 'verified'
union all select 'asset_classes', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.asset_classes where voided_at is null and verification_status <> 'verified'
union all select 'assets', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.assets where voided_at is null and verification_status <> 'verified'
union all select 'water_sources', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.water_sources where voided_at is null and verification_status <> 'verified'
union all select 'species', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.species where voided_at is null and verification_status <> 'verified'
union all select 'crop_types', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.crop_types where voided_at is null and verification_status <> 'verified'
union all select 'varieties', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.varieties where voided_at is null and verification_status <> 'verified'
union all select 'market_names', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.market_names where voided_at is null and verification_status <> 'verified'
union all select 'crop_aliases', id, farm_id, null, original_name, null, verification_status, source_note, created_at, version from public.crop_aliases where voided_at is null and verification_status <> 'verified'
union all select 'workers', id, farm_id, code, full_name, full_name_en, verification_status, source_note, created_at, version from public.workers where voided_at is null and verification_status <> 'verified'
union all select 'crews', id, farm_id, code, name_ar, name_en, verification_status, source_note, created_at, version from public.crews where voided_at is null and verification_status <> 'verified';
comment on view public.verification_queue is 'All non-voided master records not yet verified, across master tables. RLS of each table applies.';

-- ---------------------------------------------------------------------------------------------
-- First administrator. Run once by the owner from the SQL editor (not callable through the API).
-- ---------------------------------------------------------------------------------------------
create function public.bootstrap_first_admin(p_farm uuid, p_user uuid, p_full_name text) returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_role uuid;
begin
  if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
              where ur.farm_id = p_farm and r.code = 'system_admin' and ur.voided_at is null) then
    raise exception 'This farm already has a system administrator' using errcode = 'P0422';
  end if;
  select id into v_role from public.roles where farm_id = p_farm and code = 'system_admin';
  if v_role is null then
    raise exception 'Run the structure seed first' using errcode = 'P0422';
  end if;
  perform set_config('app.acting_user_id', p_user::text, true);
  insert into public.user_profiles (id, farm_id, full_name) values (p_user, p_farm, p_full_name)
    on conflict (id) do nothing;
  insert into public.user_roles (farm_id, user_id, role_id) values (p_farm, p_user, v_role);
end;
$$;
revoke all on function public.bootstrap_first_admin(uuid, uuid, text) from public;

create function public.revoke_device(p_device uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  d public.devices;
begin
  select * into d from public.devices where id = p_device for update;
  if not found or not app.has_permission(d.farm_id, 'device', 'configure') then
    raise exception 'Device not found' using errcode = 'P0404';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0422';
  end if;
  update public.devices
     set revoked_at = now(), revoked_by = app.current_user_id(), revoke_reason = p_reason, version = d.version
   where id = p_device;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Audit log read access (admin audit screen). No write policy exists for anyone.
-- ---------------------------------------------------------------------------------------------
alter table public.audit_events enable row level security;
create policy audit_events_select on public.audit_events for select to authenticated
  using (farm_id is not null and app.has_permission(farm_id, 'audit_log', 'view'));

-- ---------------------------------------------------------------------------------------------
-- API grants. Supabase grants broad default privileges on public; narrow them explicitly.
-- No anonymous access to any table. Nobody deletes through the API. The audit log, transition
-- history, idempotency and conflict tables are written only by SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------------------------
grant usage on schema app to authenticated;
grant execute on function app.current_user_id(), app.normalize_ar(text), app.flag(text),
  app.is_farm_member(uuid), app.active_delegators(uuid),
  app.has_permission(uuid, text, text, uuid, uuid, text) to authenticated;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update on all tables in schema public to authenticated;
revoke delete, truncate on all tables in schema public from authenticated;
revoke insert, update on public.audit_events, public.record_transitions, public.processed_mutations,
  public.sync_conflicts from authenticated;
revoke execute on function public.bootstrap_first_admin(uuid, uuid, text) from authenticated;
