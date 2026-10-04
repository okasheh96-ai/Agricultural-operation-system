-- Phase 2 prerequisite: generic extensions to the workflow engine (no module-specific code here).
--
--   payload_columns   columns a transition writes from its payload (e.g. blocked_reason, actual_quantity)
--   clear_columns     columns a transition resets to null (e.g. block details when work resumes)
--   counter_column    integer column incremented by the transition (e.g. rejection_count)
--   guard             name of app.guard_<name>(record jsonb) that must return true (record-dependent paths,
--                     e.g. "this task type requires verification")
--   scope_column      department column to check permission against instead of the table default
--                     (e.g. warehouse-side vs requester-side steps of a stock issue request)
--
-- Segregation-of-duties exceptions: when app.sod_exception_<table>(record, column) exists and returns
-- true, the step is allowed and the use is recorded (record_transitions.sod_exception) — §2.5.
-- After-transition hooks: app.on_transition_<table>(record, from, to) runs inside the same transaction
-- (notifications, derived updates).

set check_function_bodies = off;

alter table public.allowed_transitions
  add column payload_columns text[] not null default '{}',
  add column clear_columns   text[] not null default '{}',
  add column counter_column  text,
  add column guard           text,
  add column scope_column    text;

alter table public.record_transitions add column sod_exception boolean not null default false;

create function app.call_bool(p_fn text, p_rec jsonb, p_arg text default null) returns boolean
language plpgsql
as $$
declare v boolean;
begin
  if p_arg is null then
    execute format('select app.%I($1)', p_fn) into v using p_rec;
  else
    execute format('select app.%I($1, $2)', p_fn) into v using p_rec, p_arg;
  end if;
  return coalesce(v, false);
end;
$$;

create or replace function public.transition_record(
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
  v_sod_ex  boolean := false;
  v_sets    text := '';
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

  v_dept := case
    when tr.scope_column is not null then (rec ->> tr.scope_column)::uuid
    when reg.department_column is not null then (rec ->> reg.department_column)::uuid
  end;

  if not app.has_permission(v_farm, reg.object_type, tr.required_action, v_dept, v_loc, v_from) then
    raise exception 'You do not have permission to % this record', tr.required_action using errcode = 'P0403';
  end if;

  if tr.guard is not null and not app.call_bool('guard_' || tr.guard, rec) then
    raise exception 'Transition % → % does not apply to this record', v_from, p_to_status using errcode = 'P0422';
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

  foreach v_col in array tr.must_differ_from loop
    if (rec ->> v_col) is not null
       and ((rec ->> v_col)::uuid = v_uid or (rec ->> v_col)::uuid in (select app.active_delegators(v_farm))) then
      if to_regprocedure(format('app.sod_exception_%s(jsonb,text)', reg.table_name)) is not null
         and app.call_bool('sod_exception_' || reg.table_name, rec, v_col) then
        v_sod_ex := true;
      else
        raise exception 'Segregation of duties: the % of this record cannot perform this step', v_col
          using errcode = 'P0423';
      end if;
    end if;
  end loop;

  if p_client_recorded_at is not null then
    v_skew := abs(extract(epoch from (now() - p_client_recorded_at)));
    select (value #>> '{}')::numeric into v_limit from public.settings
     where farm_id = v_farm and key = 'clock_skew_flag_seconds' and voided_at is null;
    v_flag := v_skew > coalesce(v_limit, 300);
  end if;

  if tr.set_actor_column is not null then
    v_sets := v_sets || format(', %I = $3', tr.set_actor_column);
  end if;
  foreach v_col in array tr.payload_columns loop
    if p_payload ? v_col then
      v_sets := v_sets || format(', %1$I = (jsonb_populate_record(null::public.%2$I, $4)).%1$I', v_col, reg.table_name);
    end if;
  end loop;
  foreach v_col in array tr.clear_columns loop
    v_sets := v_sets || format(', %I = null', v_col);
  end loop;
  if tr.counter_column is not null then
    v_sets := v_sets || format(', %1$I = coalesce(%1$I, 0) + 1', tr.counter_column);
  end if;

  perform set_config('app.in_transition', 'on', true);
  perform set_config('app.audit_comment', coalesce(p_comment, ''), true);
  perform set_config('app.client_recorded_at', coalesce(p_client_recorded_at::text, ''), true);
  perform set_config('app.device_id', coalesce(p_device_id, ''), true);
  perform set_config('app.idempotency_key', coalesce(p_idempotency_key::text, ''), true);

  execute format('update public.%I set status = $1%s where id = $2 returning version', reg.table_name, v_sets)
    into v_new_ver using p_to_status, p_id, v_uid, coalesce(p_payload, '{}');

  insert into public.record_transitions
    (farm_id, entity_type, entity_id, workflow_version_id, from_status, to_status, actor_user_id, comment, payload,
     client_recorded_at, clock_skew_seconds, clock_skew_flag, device_id, idempotency_key, sod_exception)
  values
    (v_farm, reg.table_name, p_id, (rec ->> 'workflow_version_id')::uuid, v_from, p_to_status, v_uid, p_comment,
     coalesce(p_payload, '{}'), p_client_recorded_at, v_skew, v_flag, p_device_id, p_idempotency_key, v_sod_ex);

  perform set_config('app.in_transition', 'off', true);
  perform set_config('app.audit_comment', '', true);

  if to_regprocedure(format('app.on_transition_%s(jsonb,text,text)', reg.table_name)) is not null then
    execute format('select to_jsonb(t) from public.%I t where id = $1', reg.table_name) into rec using p_id;
    execute format('select app.%I($1, $2, $3)', 'on_transition_' || reg.table_name) using rec, v_from, p_to_status;
  end if;

  v_result := jsonb_build_object('id', p_id, 'from_status', v_from, 'to_status', p_to_status,
                                 'version', v_new_ver, 'clock_skew_flag', v_flag, 'sod_exception', v_sod_ex);

  if p_idempotency_key is not null then
    insert into public.processed_mutations (idempotency_key, farm_id, user_id, kind, outcome, result)
    values (p_idempotency_key, v_farm, v_uid, 'transition', 'applied', v_result);
  end if;

  return v_result;
end;
$$;
