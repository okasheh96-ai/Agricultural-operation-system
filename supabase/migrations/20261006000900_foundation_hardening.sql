-- Foundation hardening (audit 2026-10-05, items C1–C3 server side, B3, B4). No new module, no scope change.
--
-- C1  Columns written by workflow steps (who assigned/started/completed/verified/closed, payload fields such as
--     supervisor, block details and actual quantity, counters) change only inside transition_record() or a
--     dedicated audited function. Reassignment becomes reassign_task() with a reason in the status history.
-- C2  Independent departments (QA): farm-wide role grants do not reach them, except roles explicitly flagged to
--     span them (System Administrator, for configuration). Operations routes problem reports (dispatch) but no
--     longer resolves, rejects or converts them on a department's behalf (review stays with the owning department).
-- B3  An assignee must hold execution authority in the task's department; execution steps and execution records
--     belong to the assignee, the assignee's delegate, or a planner of that department.
-- B4  Every reference to a farm-scoped record must point into the same farm.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------------------------
-- C1 helpers
-- ---------------------------------------------------------------------------------------------
create function app.workflow_columns(p_workflow text, p_farm uuid) returns text[]
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct c), '{}')
    from public.allowed_transitions t
    join public.workflow_versions v on v.id = t.workflow_version_id
    cross join lateral unnest(t.payload_columns || t.clear_columns
                              || array_remove(array[t.set_actor_column, t.counter_column], null)) c
   where v.workflow_code = p_workflow and v.farm_id = p_farm and t.voided_at is null
$$;

-- Columns that record a step's actor or count steps (never set by hand, not even on insert).
create function app.workflow_actor_columns(p_workflow text, p_farm uuid) returns text[]
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct c), '{}')
    from public.allowed_transitions t
    join public.workflow_versions v on v.id = t.workflow_version_id
    cross join lateral unnest(array_remove(array[t.set_actor_column, t.counter_column], null)) c
   where v.workflow_code = p_workflow and v.farm_id = p_farm and t.voided_at is null
$$;

-- ---------------------------------------------------------------------------------------------
-- C2: independent departments + permission check for any user (needed by B3)
-- ---------------------------------------------------------------------------------------------
alter table public.roles add column spans_independent_departments boolean not null default false;
comment on column public.roles.spans_independent_departments is
  'Farm-wide grants of this role also reach independent departments (QA). Only System Administrator (configuration).';

create function app.user_has_permission(
  p_user        uuid,
  p_farm        uuid,
  p_object_type text,
  p_action      text,
  p_department  uuid default null,
  p_location    uuid default null,
  p_state       text default null
) returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  with holders as (
    select p_user as user_id, null::uuid as only_department
    union all
    select d.from_user_id, d.department_id
      from public.delegations d
     where d.to_user_id = p_user and d.farm_id = p_farm and d.voided_at is null
       and d.valid_from <= now() and d.valid_to > now()
  ),
  independent as (
    select coalesce((select is_independent from public.departments where id = p_department), false) as yes
  )
  select exists (
    select 1
      from holders h
      join public.user_roles ur on ur.user_id = h.user_id
      join public.roles r on r.id = ur.role_id
      join public.role_permissions rp on rp.role_id = ur.role_id and rp.voided_at is null
      cross join independent i
     where p_user is not null
       and ur.farm_id = p_farm and ur.voided_at is null
       and ur.valid_from <= now() and (ur.valid_to is null or ur.valid_to > now())
       and rp.object_type = p_object_type and rp.action = p_action
       and (rp.allowed_states is null or p_state = any (rp.allowed_states))
       and (ur.department_id is null or ur.department_id = p_department)
       and (h.only_department is null or h.only_department = p_department)
       -- An independent department is reached only by its own roles (or a role flagged to span it).
       and (not i.yes or ur.department_id = p_department or r.spans_independent_departments)
       and (ur.location_id is null
            or exists (select 1 from public.locations l
                        where l.id = p_location and ur.location_id = any (l.path)))
  )
$$;
comment on function app.user_has_permission is
  'Six-dimension permission check for any user (role × department × location × object × action × state, delegations, independent departments).';

create or replace function app.has_permission(
  p_farm        uuid,
  p_object_type text,
  p_action      text,
  p_department  uuid default null,
  p_location    uuid default null,
  p_state       text default null
) returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$ select app.user_has_permission(app.current_user_id(), p_farm, p_object_type, p_action, p_department, p_location, p_state) $$;

-- ---------------------------------------------------------------------------------------------
-- B3: assignee authority and execution scope
-- ---------------------------------------------------------------------------------------------
alter table app.registered_tables add column assignee_column text;
update app.registered_tables set assignee_column = 'supervisor_id' where table_name = 'tasks';

create function app.may_execute_assigned(reg app.registered_tables, rec jsonb, p_farm uuid, p_dept uuid, p_loc uuid)
returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select reg.assignee_column is null
      or (rec ->> reg.assignee_column) is null
      or (rec ->> reg.assignee_column)::uuid = app.current_user_id()
      or (rec ->> reg.assignee_column)::uuid in (select app.active_delegators(p_farm))
      or app.has_permission(p_farm, reg.object_type, 'dispatch', p_dept, p_loc)
$$;

-- For callers without access to the internal registry (row triggers running as the user).
create function app.may_execute_task(p_task jsonb) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select app.may_execute_assigned(r, p_task, (p_task ->> 'farm_id')::uuid, (p_task ->> 'department_id')::uuid,
                                  (p_task ->> 'location_id')::uuid)
    from app.registered_tables r where r.table_name = 'tasks'
$$;

-- Whoever a task is assigned to must be able to execute it there (no assignment to people without that authority).
create function app.tasks_check_assignee() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp
as $$
begin
  if new.supervisor_id is not null and (tg_op = 'INSERT' or new.supervisor_id is distinct from old.supervisor_id)
     and not app.user_has_permission(new.supervisor_id, new.farm_id, 'task', 'execute', new.department_id, new.location_id) then
    raise exception 'The chosen person has no authority to execute work in this department/location'
      using errcode = 'P0422';
  end if;
  return new;
end;
$$;
create trigger tasks_check_assignee before insert or update of supervisor_id on public.tasks
  for each row execute function app.tasks_check_assignee();

-- Reassignment (person absent, crew change) is a recorded step with a reason, not a silent edit.
create function public.reassign_task(p_task uuid, p_supervisor uuid, p_crew uuid, p_reason text, p_expected_version integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  t     public.tasks;
  v_ver integer;
begin
  if app.current_user_id() is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;
  select * into t from public.tasks where id = p_task for update;
  if not found or not app.is_farm_member(t.farm_id) or t.voided_at is not null then
    raise exception 'Task not found' using errcode = 'P0404';
  end if;
  if not app.has_permission(t.farm_id, 'task', 'dispatch', t.department_id, t.location_id) then
    raise exception 'You do not have permission to reassign this task' using errcode = 'P0403';
  end if;
  if t.status not in ('planned', 'assigned', 'in_progress', 'blocked') then
    raise exception 'A % task cannot be reassigned', t.status using errcode = 'P0422';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0422';
  end if;
  if p_expected_version is not null and p_expected_version <> t.version then
    raise exception 'Record was changed by someone else' using errcode = 'P0409';
  end if;

  perform set_config('app.in_transition', 'on', true);
  perform set_config('app.audit_comment', p_reason, true);
  update public.tasks set supervisor_id = p_supervisor, crew_id = p_crew, version = version
   where id = p_task returning version into v_ver;
  insert into public.record_transitions (farm_id, entity_type, entity_id, workflow_version_id, from_status, to_status,
                                         actor_user_id, comment, payload)
  values (t.farm_id, 'tasks', t.id, t.workflow_version_id, t.status, t.status, app.current_user_id(), p_reason,
          jsonb_build_object('reassigned', true, 'from_supervisor_id', t.supervisor_id, 'to_supervisor_id', p_supervisor,
                             'from_crew_id', t.crew_id, 'to_crew_id', p_crew));
  perform set_config('app.in_transition', 'off', true);
  perform set_config('app.audit_comment', '', true);
  perform app.notify(t.farm_id, p_supervisor, 'task_assigned', 'tasks', t.id, jsonb_build_object('code', t.code, 'title', t.title));
  return jsonb_build_object('id', t.id, 'version', v_ver);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- C2: Operations routes problem reports; the owning department reviews them
-- ---------------------------------------------------------------------------------------------
create function public.route_problem_report(p_report uuid, p_department uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  r     public.problem_reports;
  v_ver integer;
begin
  if app.current_user_id() is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;
  select * into r from public.problem_reports where id = p_report for update;
  if not found or not app.is_farm_member(r.farm_id) or r.voided_at is not null then
    raise exception 'Problem report not found' using errcode = 'P0404';
  end if;
  if not (app.has_permission(r.farm_id, 'problem_report', 'dispatch', r.owning_department_id, r.location_id)
          or app.has_permission(r.farm_id, 'problem_report', 'review', r.owning_department_id, r.location_id)) then
    raise exception 'You do not have permission to route this report' using errcode = 'P0403';
  end if;
  if r.status not in ('open', 'acknowledged') then
    raise exception 'This report is already %', r.status using errcode = 'P0422';
  end if;
  if not exists (select 1 from public.departments where id = p_department and farm_id = r.farm_id) then
    raise exception 'Unknown department' using errcode = 'P0422';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0422';
  end if;
  perform set_config('app.audit_comment', p_reason, true);
  update public.problem_reports set owning_department_id = p_department, version = version where id = r.id returning version into v_ver;
  insert into public.record_transitions (farm_id, entity_type, entity_id, workflow_version_id, from_status, to_status,
                                         actor_user_id, comment, payload)
  values (r.farm_id, 'problem_reports', r.id, r.workflow_version_id, r.status, r.status, app.current_user_id(), p_reason,
          jsonb_build_object('routed', true, 'from_department_id', r.owning_department_id, 'to_department_id', p_department));
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('id', r.id, 'version', v_ver);
end;
$$;

-- Per-farm permission/role adjustments (existing farms now; new farms through seed_phase_structure).
create function app.seed_hardening(p_farm uuid) returns void
language plpgsql
as $$
declare
  v_ops uuid := (select id from public.roles where farm_id = p_farm and code = 'operations_manager');
begin
  update public.roles set spans_independent_departments = true, version = version
   where farm_id = p_farm and code = 'system_admin' and not spans_independent_departments;
  perform set_config('app.in_void', 'on', true);
  update public.role_permissions
     set voided_at = now(), void_reason = 'Audit C2: Operations routes reports; the owning department reviews them', version = version
   where role_id = v_ops and object_type = 'problem_report' and action = 'review' and voided_at is null;
  perform set_config('app.in_void', 'off', true);
  perform app.grant_permissions(p_farm, 'operations_manager', 'problem_report', array['dispatch']);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- B4: references stay inside the farm
-- ---------------------------------------------------------------------------------------------
create table app.tenant_refs (
  table_name  text not null,
  column_name text not null,
  ref_table   text not null,
  primary key (table_name, column_name)
);
comment on table app.tenant_refs is 'Single-column foreign keys from farm-scoped tables to farm-scoped tables (checked by app.check_same_farm).';

create function app.check_same_farm() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  n   jsonb := to_jsonb(new);
  o   jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  ref record;
  v_farm uuid;
begin
  for ref in select column_name, ref_table from app.tenant_refs where table_name = tg_table_name loop
    if (n ->> ref.column_name) is not null and (n -> ref.column_name) is distinct from (o -> ref.column_name) then
      execute format('select farm_id from public.%I where id = $1', ref.ref_table) into v_farm using (n ->> ref.column_name)::uuid;
      if v_farm is distinct from (n ->> 'farm_id')::uuid then
        raise exception 'Referenced % belongs to another farm', ref.ref_table using errcode = 'P0422';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create function app.refresh_tenant_refs() returns void
language plpgsql
as $$
declare
  t text;
begin
  delete from app.tenant_refs;
  insert into app.tenant_refs (table_name, column_name, ref_table)
  select distinct src.relname, a.attname, dst.relname
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_namespace ns on ns.oid = src.relnamespace and ns.nspname = 'public'
    join pg_class dst on dst.oid = c.confrelid
    join pg_namespace nd on nd.oid = dst.relnamespace and nd.nspname = 'public'
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and array_length(c.conkey, 1) = 1 and dst.relname <> 'farms'
     and exists (select 1 from pg_attribute x where x.attrelid = src.oid and x.attname = 'farm_id' and not x.attisdropped)
     and exists (select 1 from pg_attribute y where y.attrelid = dst.oid and y.attname = 'farm_id' and not y.attisdropped)
     -- referenced tables must expose an "id" key (wells/worker_private use a generated copy)
     and exists (select 1 from pg_attribute z where z.attrelid = dst.oid and z.attname = 'id' and not z.attisdropped);
  for t in select distinct table_name from app.tenant_refs loop
    if not exists (select 1 from pg_trigger g join pg_class k on k.oid = g.tgrelid
                    where k.relname = t and g.tgname = t || '_same_farm') then
      execute format('create trigger %I before insert or update on public.%I for each row execute function app.check_same_farm()',
                     t || '_same_farm', t);
    end if;
  end loop;
end;
$$;

-- Every migration ends with app.apply_api_grants(); it now also refreshes the tenant reference checks.
create or replace function app.apply_api_grants() returns void
language plpgsql
as $$
begin
  revoke all on all tables in schema public from anon;
  revoke all on all functions in schema public from anon;
  grant select, insert, update on all tables in schema public to authenticated;
  revoke delete, truncate on all tables in schema public from authenticated;
  revoke insert, update on public.audit_events, public.record_transitions, public.processed_mutations,
    public.sync_conflicts, public.notifications, public.escalations, public.stock_movements,
    public.stock_balances from authenticated;
  revoke execute on function public.bootstrap_first_admin(uuid, uuid, text) from authenticated;
  perform app.refresh_tenant_refs();
end;
$$;

create or replace function app.before_write() returns trigger
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
  v_col    text;
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

    -- C1: columns that record who performed a workflow step (and step counters) start empty.
    if reg.workflow_code is not null and not app.flag('in_transition') then
      foreach v_col in array app.workflow_actor_columns(reg.workflow_code, (n ->> 'farm_id')::uuid) loop
        if coalesce(n ->> v_col, '0') not in ('0', '') then
          raise exception 'Column "%" is written only by workflow steps', v_col using errcode = 'P0403';
        end if;
      end loop;
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

  -- C1: every column a workflow step writes (actor, payload, cleared, counter) changes only inside that step.
  if reg.workflow_code is not null and not app.flag('in_transition') then
    foreach v_col in array app.workflow_columns(reg.workflow_code, (o ->> 'farm_id')::uuid) loop
      if (n -> v_col) is distinct from (o -> v_col) then
        raise exception 'Column "%" changes only through its workflow step (transition_record or a dedicated function)', v_col
          using errcode = 'P0403';
      end if;
    end loop;
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

  -- B3: execution steps on an assigned record belong to its assignee, the assignee's delegate, or a planner
  -- of that department (dispatch authority) — not to every executor in the department.
  if tr.required_action = 'execute' and not app.may_execute_assigned(reg, rec, v_farm, v_dept, v_loc) then
    raise exception 'Only the assigned person (or their delegate, or a planner of this department) can do this step'
      using errcode = 'P0403';
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

create or replace function app.task_entry_guard() returns trigger
language plpgsql
as $$
declare
  t        public.tasks;
  n        jsonb := to_jsonb(new);
  o        jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  planning boolean;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found or t.farm_id <> new.farm_id then
    raise exception 'Task not found' using errcode = 'P0404';
  end if;

  planning := case tg_table_name
    when 'task_checklist_items' then tg_op = 'INSERT' or (n ->> 'label') is distinct from (o ->> 'label')
    -- compare as text: a JSON null and a missing key must both read as SQL NULL
    when 'material_consumptions' then (n ->> 'planned_qty') is distinct from (o ->> 'planned_qty')
                                      and (n ->> 'actual_qty') is not distinct from (o ->> 'actual_qty')
    else false
  end;

  if planning then
    if t.status not in ('draft', 'planned', 'assigned') then
      raise exception 'Planned items can only change before work starts' using errcode = 'P0422';
    end if;
    if not app.has_permission(t.farm_id, 'task', 'plan', t.department_id, t.location_id) then
      raise exception 'You do not have permission to plan this task' using errcode = 'P0403';
    end if;
  else
    if t.status not in ('assigned', 'in_progress', 'blocked') then
      raise exception 'Execution records can only change while the task is active (status %)', t.status using errcode = 'P0422';
    end if;
    if not app.has_permission(t.farm_id, 'task', 'execute', t.department_id, t.location_id) then
      raise exception 'You do not have permission to record work on this task' using errcode = 'P0403';
    end if;
    -- B3: execution records belong to the assignee, their delegate, or a planner of the department.
    if not app.may_execute_task(to_jsonb(t)) then
      raise exception 'Only the assigned person (or their delegate, or a planner of this department) can record work on this task'
        using errcode = 'P0403';
    end if;
  end if;

  if tg_table_name = 'task_checklist_items' and (n ->> 'is_done') is distinct from (o ->> 'is_done') then
    new := jsonb_populate_record(new, jsonb_build_object(
      'done_by', case when (n ->> 'is_done')::boolean then app.current_user_id() end,
      'done_at', case when (n ->> 'is_done')::boolean then now() end));
  end if;
  return new;
end;
$$;

create or replace function app.seed_phase_structure(p_farm uuid) returns void
language plpgsql as $$
begin
  perform app.seed_phase2_structure(p_farm);
  perform app.seed_task_workflow_v2(p_farm);
  perform app.seed_well_placeholders(p_farm);
  perform app.seed_hardening(p_farm);
end $$;

select app.seed_hardening(id) from public.farms;
select app.apply_api_grants();
