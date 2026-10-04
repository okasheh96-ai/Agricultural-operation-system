-- Engine: more than one rule may allow the same status change with different authority (the first rule the
-- actor may use applies). Needed for unplanned field work: a planner dispatches a task (dispatch), or a
-- supervisor assigns work to themselves (execute, guard: assignee is the actor).
-- Then task workflow v2 = v1 + that self-assign rule. Published versions are frozen; in-flight tasks finish on v1.

set check_function_bodies = off;

drop index public.allowed_transitions_uq;
create unique index allowed_transitions_uq on public.allowed_transitions (workflow_version_id, from_status, to_status, required_action)
  where voided_at is null;

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
  v_any     boolean;
  v_chosen  boolean := false;
  v_guard_failed boolean := false;
  v_denied_action text;
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

  -- Several rules may allow the same status change with different authority (e.g. a planner dispatches,
  -- or a supervisor assigns unplanned work to themselves). Use the first rule this actor may use.
  v_any := false;
  v_denied_action := null;
  for tr in
    select * from public.allowed_transitions
     where workflow_version_id = (rec ->> 'workflow_version_id')::uuid
       and from_status = v_from and to_status = p_to_status and voided_at is null
     order by (guard is null), required_action
  loop
    v_any := true;
    v_dept := case
      when tr.scope_column is not null then (rec ->> tr.scope_column)::uuid
      when reg.department_column is not null then (rec ->> reg.department_column)::uuid
    end;
    if not app.has_permission(v_farm, reg.object_type, tr.required_action, v_dept, v_loc, v_from) then
      v_denied_action := coalesce(v_denied_action, tr.required_action);
      continue;
    end if;
    if tr.guard is not null and not app.call_bool('guard_' || tr.guard, rec) then
      v_guard_failed := true;
      continue;
    end if;
    v_chosen := true;
    exit;
  end loop;
  if not v_any then
    raise exception 'Transition % → % is not allowed', v_from, p_to_status using errcode = 'P0422';
  end if;
  if not v_chosen then
    if v_guard_failed then
      raise exception 'Transition % → % does not apply to this record', v_from, p_to_status using errcode = 'P0422';
    end if;
    raise exception 'You do not have permission to % this record', v_denied_action using errcode = 'P0403';
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

-- Copy a workflow's active version into a new, unpublished version (to change rules without touching history).
create function app.clone_workflow_version(p_farm uuid, p_code text, p_note text) returns uuid
language plpgsql
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  select id into v_old from public.workflow_versions
   where farm_id = p_farm and workflow_code = p_code and is_active and voided_at is null;
  if v_old is null then
    raise exception 'No active % workflow for farm %', p_code, p_farm;
  end if;
  insert into public.workflow_versions (farm_id, workflow_code, version_no, is_active, note)
  select p_farm, p_code, max(version_no) + 1, false, p_note from public.workflow_versions where farm_id = p_farm and workflow_code = p_code
  returning id into v_new;
  insert into public.workflow_statuses (farm_id, workflow_version_id, code, name_ar, name_en, is_initial, is_terminal, sort_order)
  select farm_id, v_new, code, name_ar, name_en, is_initial, is_terminal, sort_order
    from public.workflow_statuses where workflow_version_id = v_old and voided_at is null;
  insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action, required_fields,
    must_differ_from, set_actor_column, payload_columns, clear_columns, counter_column, guard, scope_column)
  select farm_id, v_new, from_status, to_status, required_action, required_fields,
         must_differ_from, set_actor_column, payload_columns, clear_columns, counter_column, guard, scope_column
    from public.allowed_transitions where workflow_version_id = v_old and voided_at is null;
  return v_new;
end;
$$;

-- Publish a version and make it the one new records start on.
create function app.activate_workflow_version(p_version uuid) returns void
language plpgsql
as $$
declare
  v public.workflow_versions;
begin
  select * into v from public.workflow_versions where id = p_version;
  update public.workflow_versions set is_active = false, version = version
   where farm_id = v.farm_id and workflow_code = v.workflow_code and is_active and id <> p_version;
  update public.workflow_versions set is_active = true, published_at = coalesce(published_at, now()), version = version
   where id = p_version;
end;
$$;

create function app.guard_task_assignee_is_actor(p_rec jsonb) returns boolean
language sql stable
as $$ select (p_rec ->> 'supervisor_id')::uuid = app.current_user_id() $$;

-- Task workflow v2 for a farm (idempotent).
create function app.seed_task_workflow_v2(p_farm uuid) returns void
language plpgsql
as $$
declare
  v uuid;
begin
  if not exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'task')
     or exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'task' and version_no >= 2) then
    return;
  end if;
  v := app.clone_workflow_version(p_farm, 'task', 'v2: supervisors may self-assign unplanned field work (VR-C23)');
  insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action,
                                          required_fields, set_actor_column, guard)
  values (p_farm, v, 'draft', 'assigned', 'execute', array['planned_date', 'location_id', 'supervisor_id'], 'assigned_by', 'task_assignee_is_actor');
  perform app.activate_workflow_version(v);
end;
$$;

create or replace function app.seed_phase_structure(p_farm uuid) returns void
language plpgsql as $$
begin
  perform app.seed_phase2_structure(p_farm);
  perform app.seed_task_workflow_v2(p_farm);
end $$;

select app.seed_task_workflow_v2(id) from public.farms;
