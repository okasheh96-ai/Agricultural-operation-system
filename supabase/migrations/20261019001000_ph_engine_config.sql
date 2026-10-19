-- Packing house (PH-OAS-SPEC-001 v0.1) 1/3: engine extension, roles, permission matrix, open decisions,
-- rule parameters and inspection templates. All of it is per-farm data carrying the specification's own evidence
-- label: C Confirmed (documented in SOP001 / Summary, floor walk-through pending) · P Proposed (needs the named
-- owner's approval) · NYV Not Yet Verified (needs an open decision). Nothing here makes a proposal a rule.
--
-- Engine extension (no copy of the engine):
--   allowed_transitions.ph_action      packing-house matrix action checked instead of role_permissions
--   allowed_transitions.decision_gate  'OD-17:A' — the transition is refused until OD-17 is decided with option A
--   record_transitions.permission_basis / decision_basis  what authorised the step (spec label, role, decision)

set check_function_bodies = off;

alter table public.allowed_transitions
  add column ph_action     text,
  add column decision_gate text check (decision_gate is null or decision_gate ~ '^OD-[0-9]{2}(:[A-Z](\|[A-Z])*)?$');
alter table public.record_transitions
  add column permission_basis text,
  add column decision_basis   text;
-- Two rules may share from/to/action when they differ by packing-house action (e.g. quality vs food-safety disposition).
drop index public.allowed_transitions_uq;
create unique index allowed_transitions_uq on public.allowed_transitions
  (workflow_version_id, from_status, to_status, required_action, coalesce(ph_action, '')) where voided_at is null;

-- ---------------------------------------------------------------------------------------------
-- Roles (spec §6.1). Each spec role is a row in public.roles (code ph_<spec code>) granted farm-wide in user_roles;
-- department scope does not apply to packing-house records — the matrix decides.
-- ---------------------------------------------------------------------------------------------
create table public.ph_roles (
  id               uuid primary key default gen_random_uuid(),
  role_id          uuid not null references public.roles(id),
  spec_code        text not null check (spec_code ~ '^[A-Z]{2,3}$'),
  department_text  text not null,
  reporting_line   text not null,
  evidence         text not null check (evidence in ('C', 'P', 'NYV')),
  source           text not null,
  system_use       text not null,
  decision_code    text,
  sort_order       integer not null default 0
);
comment on table public.ph_roles is
  'Packing-house role catalogue (PH-OAS-SPEC-001 §6.1): spec code, department and reporting line as documented, with the '
  'spec label. Links each spec role to its public.roles row. Reporting lines marked "Not stated" are not modelled.';
select app.register_table('public.ph_roles', 'ph_config', false, p_default_policies => false);
create unique index ph_roles_uq on public.ph_roles (farm_id, spec_code) where voided_at is null;

-- Actions per record object (spec §6.3 rows, plus actors named only in the §8.1 state tables).
create table public.ph_actions (
  id            uuid primary key default gen_random_uuid(),
  action_key    text not null check (action_key ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  object_code   text not null,
  label_en      text not null,
  label_ar      text not null,
  owner_roles   text[] not null default '{}',
  milestone     text not null,
  source        text not null,
  sort_order    integer not null default 0
);
comment on table public.ph_actions is
  'Every packing-house action the permission matrix governs. owner_roles = data owner of the record type (spec §9.1), who '
  'may approve proposed (P) cells. milestone = build milestone that implements the action (M1 receiving … M4).';
select app.register_table('public.ph_actions', 'ph_config', false, p_default_policies => false);
create unique index ph_actions_uq on public.ph_actions (farm_id, action_key) where voided_at is null;

create table public.ph_permission_cells (
  id             uuid primary key default gen_random_uuid(),
  action_key     text not null,
  spec_code      text not null,
  evidence       text not null check (evidence in ('C', 'P', 'NYV')),
  state          text not null check (state in ('active', 'proposed', 'pending_decision', 'disabled')),
  basis          text not null,
  decision_code  text,
  note           text,
  resolved_by    uuid references auth.users(id),
  resolved_at    timestamptz
);
comment on table public.ph_permission_cells is
  'The action-level permission matrix (spec §6.3) as data, one row per role × action. evidence = the spec label '
  '(● C, ○ P, ? NYV). state: active (usable), proposed (P, usable only while the farm puts proposals in effect, until '
  'the record-type owner approves it), pending_decision (NYV, unusable until the named open decision activates it), '
  'disabled. A role with no row has no permission. Negative tests (T-20) are generated from this table.';
select app.register_table('public.ph_permission_cells', 'ph_config', false, p_default_policies => false);
create unique index ph_permission_cells_uq on public.ph_permission_cells (farm_id, action_key, spec_code) where voided_at is null;

-- ---------------------------------------------------------------------------------------------
-- Open decisions register (spec §13) with owner approvals.
-- ---------------------------------------------------------------------------------------------
create table public.ph_open_decisions (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null check (code ~ '^OD-[0-9]{2}$'),
  priority           text not null check (priority in ('critical', 'high', 'medium', 'low')),
  needed_by          text not null,
  title_en           text not null,
  title_ar           text not null,
  why_en             text not null,
  options            jsonb not null default '[]',
  recommendation_en  text,
  owner_text         text not null,
  owner_roles        text[] not null default '{}',
  source             text not null,
  dependents         text[] not null default '{}',
  blocks_en          text not null,
  blocks_ar          text not null,
  decision_state     text not null default 'open' check (decision_state in ('open', 'proposed', 'decided', 'demo_assumption')),
  selected_option    text,
  activate_roles     text[] not null default '{}',
  rationale          text,
  proposed_by        uuid references auth.users(id),
  proposed_at        timestamptz,
  decided_at         timestamptz,
  effective_from     timestamptz,
  config_version     integer,
  check (decision_state = 'open' or selected_option is not null),
  check (decision_state not in ('decided', 'demo_assumption') or (decided_at is not null and effective_from is not null))
);
comment on table public.ph_open_decisions is
  'The 41 open decisions of PH-OAS-SPEC-001 §13: owner, priority, options, the spec''s recommendation (kept as a '
  'proposal), dependent requirements and what the system blocks while open. A decision closes when every owner role has '
  'approved the recorded option (ph_decision_approvals). demo_assumption exists only on demo farms and is never a '
  'management decision.';
select app.register_table('public.ph_open_decisions', 'ph_decision', false, p_default_policies => false);
create unique index ph_open_decisions_uq on public.ph_open_decisions (farm_id, code) where voided_at is null;

create table public.ph_decision_approvals (
  id           uuid primary key default gen_random_uuid(),
  decision_id  uuid not null references public.ph_open_decisions(id),
  spec_code    text not null,
  approved_by  uuid not null references auth.users(id),
  approved_at  timestamptz not null default now(),
  option_code  text not null,
  comment      text
);
comment on table public.ph_decision_approvals is
  'Approval record of a decision: which owner role approved which option, who and when. Written only by '
  'ph_record_decision(); never edited.';
select app.register_table('public.ph_decision_approvals', 'ph_decision', false, p_default_policies => false);
create unique index ph_decision_approvals_uq on public.ph_decision_approvals (decision_id, spec_code) where voided_at is null;

-- Demo assumptions never reach a real farm.
create function app.ph_demo_assumption_only_demo() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp
as $$
begin
  if new.decision_state = 'demo_assumption' and not coalesce((select is_demo from public.farms where id = new.farm_id), false) then
    raise exception 'Demo assumptions are only allowed on a demo farm' using errcode = 'P0403';
  end if;
  return new;
end;
$$;
create trigger ph_open_decisions_demo_only before insert or update on public.ph_open_decisions
  for each row execute function app.ph_demo_assumption_only_demo();

-- ---------------------------------------------------------------------------------------------
-- Rule parameters (FR-MD-07): effective-dated values, SOP-documented ones pre-loaded and labelled so.
-- ---------------------------------------------------------------------------------------------
create table public.ph_rule_parameters (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  version_no      integer not null default 1 check (version_no > 0),
  area            text not null check (area in ('operational', 'quality')),
  value_numeric   numeric,
  value_text      text,
  unit_code       text,
  evidence        text not null check (evidence in ('C', 'P', 'NYV')),
  basis_label     text not null,
  source          text not null,
  decision_code   text,
  label_en        text not null,
  label_ar        text not null,
  state           text not null check (state in ('in_effect', 'proposed', 'pending_decision', 'superseded', 'rejected')),
  effective_from  timestamptz not null default now(),
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  check (state <> 'in_effect' or value_numeric is not null or value_text is not null)
);
comment on table public.ph_rule_parameters is
  'Time limits, thresholds and lead times used by packing-house rules (FR-MD-07, DP-06). Values documented in SOP001 are '
  'pre-loaded as "SOP-documented"; values the sources do not give are pending_decision with no number. A change is a '
  'new version proposed by one area owner and approved by another person (SoD-07); rules read the version in effect.';
select app.register_table('public.ph_rule_parameters', 'ph_config', false, p_default_policies => false);
create unique index ph_rule_parameters_uq on public.ph_rule_parameters (farm_id, code, version_no) where voided_at is null;

-- Inspection templates (FR-QG-07): checklist items per inspection type, versioned; inspections store the version.
create table public.ph_inspection_templates (
  id              uuid primary key default gen_random_uuid(),
  inspection_type text not null,
  version_no      integer not null default 1 check (version_no > 0),
  items           jsonb not null,
  evidence        text not null check (evidence in ('C', 'P', 'NYV')),
  source          text not null,
  note            text,
  state           text not null check (state in ('in_effect', 'proposed', 'superseded')),
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz
);
comment on table public.ph_inspection_templates is
  'Checklist items per inspection type (arrival check, vehicle, RMA, recheck, QC-1, …) with their source. Versioned; '
  'each inspection stores the template version it used (AT-06). Maintained by QCM/QAM.';
select app.register_table('public.ph_inspection_templates', 'ph_config', false, p_default_policies => false);
create unique index ph_inspection_templates_uq on public.ph_inspection_templates (farm_id, inspection_type, version_no) where voided_at is null;

-- Code counters for human-readable IDs (ARR-YYMMDD-NNNN, …). IDs are never reused (V-19, GEN-12).
create table app.ph_counters (
  farm_id uuid not null,
  key     text not null,
  value   integer not null,
  primary key (farm_id, key)
);

create function app.ph_next(p_farm uuid, p_key text) returns integer
language sql security definer set search_path = public, app, pg_temp
as $$
  insert into app.ph_counters as c (farm_id, key, value) values (p_farm, p_key, 1)
  on conflict (farm_id, key) do update set value = c.value + 1
  returning value
$$;

-- ---------------------------------------------------------------------------------------------
-- Membership, permission and decision checks
-- ---------------------------------------------------------------------------------------------
-- Holds any packing-house role on the farm (read access to packing-house records; VR-PH-C02).
create function app.ph_is_member(p_farm uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
     where ur.user_id = app.current_user_id() and ur.farm_id = p_farm and ur.voided_at is null
       and ur.valid_from <= now() and (ur.valid_to is null or ur.valid_to > now()) and r.code like 'ph\_%'
  )
$$;

create function app.ph_user_spec_roles(p_user uuid, p_farm uuid) returns text[]
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct pr.spec_code), '{}')
    from public.user_roles ur
    join public.ph_roles pr on pr.role_id = ur.role_id and pr.voided_at is null
   where ur.user_id = p_user and ur.farm_id = p_farm and ur.voided_at is null
     and ur.valid_from <= now() and (ur.valid_to is null or ur.valid_to > now())
$$;

create function app.ph_proposals_in_effect(p_farm uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings
                    where farm_id = p_farm and key = 'ph_proposals_in_effect' and voided_at is null), false)
$$;

-- What would authorise p_user to perform p_action: 'C:QAO', 'P:DEC', 'P-approved:PHM', 'OD-38:DEC', … or null.
create function app.ph_permission_basis(p_user uuid, p_farm uuid, p_action text) returns text
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select c.basis || ':' || c.spec_code
    from public.ph_permission_cells c
   where c.farm_id = p_farm and c.action_key = p_action and c.voided_at is null
     and c.spec_code = any (app.ph_user_spec_roles(p_user, p_farm))
     and (c.state = 'active' or (c.state = 'proposed' and app.ph_proposals_in_effect(p_farm)))
   order by (c.state = 'active') desc, (c.evidence = 'C') desc, c.spec_code
   limit 1
$$;

-- Why p_user may not perform p_action (for messages and the "why is this unavailable" panel).
create function app.ph_denial(p_user uuid, p_farm uuid, p_action text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_roles text[] := app.ph_user_spec_roles(p_user, p_farm);
  c       public.ph_permission_cells;
begin
  if app.ph_permission_basis(p_user, p_farm, p_action) is not null then
    return null;
  end if;
  select * into c from public.ph_permission_cells
   where farm_id = p_farm and action_key = p_action and voided_at is null and spec_code = any (v_roles)
   order by case state when 'proposed' then 1 when 'pending_decision' then 2 else 3 end limit 1;
  if not found then
    return jsonb_build_object('key', 'ph.denied.noRole', 'action', p_action,
      'roles', (select coalesce(array_agg(spec_code order by spec_code), '{}') from public.ph_permission_cells
                 where farm_id = p_farm and action_key = p_action and voided_at is null and state <> 'disabled'));
  elsif c.state = 'proposed' then
    return jsonb_build_object('key', 'ph.denied.proposed', 'action', p_action, 'role', c.spec_code,
      'owners', (select owner_roles from public.ph_actions where farm_id = p_farm and action_key = p_action and voided_at is null));
  elsif c.state = 'pending_decision' then
    return jsonb_build_object('key', 'ph.denied.pendingDecision', 'action', p_action, 'role', c.spec_code,
      'decision', c.decision_code);
  else
    return jsonb_build_object('key', 'ph.denied.disabled', 'action', p_action, 'role', c.spec_code);
  end if;
end;
$$;

-- Raises a permission error that names the reason; returns the basis used.
create function app.ph_authorize(p_farm uuid, p_action text) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_basis text := app.ph_permission_basis(app.current_user_id(), p_farm, p_action);
  v_why   jsonb;
begin
  if app.current_user_id() is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;
  if v_basis is null then
    v_why := app.ph_denial(app.current_user_id(), p_farm, p_action);
    raise exception 'Not permitted for your role: % (%)', p_action, v_why ->> 'key'
      using errcode = 'P0403', detail = v_why::text;
  end if;
  return v_basis;
end;
$$;

-- Decision gate: 'OD-17' (any decided option) or 'OD-17:A' / 'OD-01:B|C'. Returns 'OD-17=A' or 'demo:OD-17=A';
-- raises P0428 naming the decision while it is open or decided for an option this flow does not implement.
create function app.ph_decision_gate(p_farm uuid, p_gate text) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_code text := split_part(p_gate, ':', 1);
  v_opts text[] := case when position(':' in p_gate) > 0 then string_to_array(split_part(p_gate, ':', 2), '|') end;
  d      public.ph_open_decisions;
begin
  select * into d from public.ph_open_decisions where farm_id = p_farm and code = v_code and voided_at is null;
  if not found or d.decision_state not in ('decided', 'demo_assumption') or d.effective_from > now() then
    raise exception 'Blocked by open decision %: %', v_code, coalesce(d.title_en, '')
      using errcode = 'P0428', detail = jsonb_build_object('key', 'ph.blocked.open', 'decision', v_code)::text;
  end if;
  if v_opts is not null and not d.selected_option = any (v_opts) then
    raise exception 'Decision % chose option %; this step implements option %', v_code, d.selected_option, array_to_string(v_opts, '/')
      using errcode = 'P0428', detail = jsonb_build_object('key', 'ph.blocked.otherOption', 'decision', v_code,
        'selected', d.selected_option, 'implemented', v_opts)::text;
  end if;
  return case when d.decision_state = 'demo_assumption' then 'demo:' else '' end || v_code || '=' || d.selected_option;
end;
$$;

-- Non-raising variant for availability panels.
create function app.ph_decision_open(p_farm uuid, p_gate text) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
begin
  perform app.ph_decision_gate(p_farm, p_gate);
  return null;
exception when sqlstate 'P0428' then
  return split_part(p_gate, ':', 1);
end;
$$;

create function app.ph_param(p_farm uuid, p_code text) returns numeric
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select value_numeric from public.ph_rule_parameters
   where farm_id = p_farm and code = p_code and state = 'in_effect' and effective_from <= now() and voided_at is null
   order by effective_from desc, version_no desc limit 1
$$;

create function app.ph_param_text(p_farm uuid, p_code text) returns text
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select value_text from public.ph_rule_parameters
   where farm_id = p_farm and code = p_code and state = 'in_effect' and effective_from <= now() and voided_at is null
   order by effective_from desc, version_no desc limit 1
$$;

-- Transaction-local marker set by packing-house server functions. Packing-house transitions carry guards that require it,
-- so the API cannot skip a function's validation by calling transition_record() directly.
create function app.ph_in_rpc() returns boolean language sql stable as $$ select app.flag('ph_rpc') $$;

-- ---------------------------------------------------------------------------------------------
-- transition_record(): hardening version + packing-house matrix and decision gates.
-- ---------------------------------------------------------------------------------------------
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
  v_denied_ph text;
  v_basis   text;
  v_dbasis  text;
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
    if tr.ph_action is not null then
      -- Packing house: the spec's action-level matrix (C / approved or in-effect P / decided NYV).
      v_basis := app.ph_permission_basis(v_uid, v_farm, tr.ph_action);
      if v_basis is null then
        v_denied_ph := coalesce(v_denied_ph, tr.ph_action);
        v_denied_action := coalesce(v_denied_action, tr.ph_action);
        continue;
      end if;
    elsif not app.has_permission(v_farm, reg.object_type, tr.required_action, v_dept, v_loc, v_from) then
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
    if v_denied_ph is not null then
      perform app.ph_authorize(v_farm, v_denied_ph);  -- raises with the reason (no role / proposal / pending decision)
    end if;
    raise exception 'You do not have permission to % this record', v_denied_action using errcode = 'P0403';
  end if;

  if tr.decision_gate is not null then
    v_dbasis := app.ph_decision_gate(v_farm, tr.decision_gate);
  end if;

  -- B3: execution steps on an assigned record belong to its assignee, the assignee's delegate, or a planner.
  if tr.required_action = 'execute' and tr.ph_action is null and not app.may_execute_assigned(reg, rec, v_farm, v_dept, v_loc) then
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
          using errcode = 'P0423', detail = jsonb_build_object('key', 'ph.sod', 'column', v_col)::text;
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
     client_recorded_at, clock_skew_seconds, clock_skew_flag, device_id, idempotency_key, sod_exception,
     permission_basis, decision_basis)
  values
    (v_farm, reg.table_name, p_id, (rec ->> 'workflow_version_id')::uuid, v_from, p_to_status, v_uid, p_comment,
     coalesce(p_payload, '{}'), p_client_recorded_at, v_skew, v_flag, p_device_id, p_idempotency_key, v_sod_ex,
     case when tr.ph_action is not null then tr.ph_action || ' ' || v_basis end, v_dbasis);

  perform set_config('app.in_transition', 'off', true);
  perform set_config('app.audit_comment', '', true);

  if to_regprocedure(format('app.on_transition_%s(jsonb,text,text)', reg.table_name)) is not null then
    execute format('select to_jsonb(t) from public.%I t where id = $1', reg.table_name) into rec using p_id;
    execute format('select app.%I($1, $2, $3)', 'on_transition_' || reg.table_name) using rec, v_from, p_to_status;
  end if;

  v_result := jsonb_build_object('id', p_id, 'from_status', v_from, 'to_status', p_to_status,
                                 'version', v_new_ver, 'clock_skew_flag', v_flag, 'sod_exception', v_sod_ex,
                                 'permission_basis', v_basis, 'decision_basis', v_dbasis);

  if p_idempotency_key is not null then
    insert into public.processed_mutations (idempotency_key, farm_id, user_id, kind, outcome, result)
    values (p_idempotency_key, v_farm, v_uid, 'transition', 'applied', v_result);
  end if;

  return v_result;
end;
$$;

-- define_workflow + ph_action / decision_gate keys.
create or replace function app.define_workflow(p_farm uuid, p_code text, p_statuses jsonb, p_transitions jsonb) returns uuid
language plpgsql
as $$
declare
  v_wf uuid;
  s    jsonb;
  t    jsonb;
  arr  text := 'select coalesce(array(select jsonb_array_elements_text(coalesce($1, ''[]''))), ''{}'')';
  v_req text[]; v_diff text[]; v_pay text[]; v_clear text[];
begin
  insert into public.workflow_versions (farm_id, workflow_code, version_no, is_active, note)
  values (p_farm, p_code, 1, true, 'Initial definition') returning id into v_wf;
  for s in select * from jsonb_array_elements(p_statuses) loop
    insert into public.workflow_statuses (farm_id, workflow_version_id, code, name_ar, name_en, is_initial, is_terminal, sort_order)
    values (p_farm, v_wf, s ->> 'code', s ->> 'ar', s ->> 'en', coalesce((s ->> 'initial')::boolean, false),
            coalesce((s ->> 'terminal')::boolean, false), coalesce((s ->> 'sort')::int, 0));
  end loop;
  for t in select * from jsonb_array_elements(p_transitions) loop
    execute arr into v_req using t -> 'req';
    execute arr into v_diff using t -> 'differ';
    execute arr into v_pay using t -> 'payload';
    execute arr into v_clear using t -> 'clear';
    insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action,
      required_fields, must_differ_from, set_actor_column, payload_columns, clear_columns, counter_column, guard, scope_column,
      ph_action, decision_gate)
    values (p_farm, v_wf, t ->> 'from', t ->> 'to', t ->> 'action', v_req, v_diff, t ->> 'actor', v_pay, v_clear,
            t ->> 'counter', t ->> 'guard', t ->> 'scope', t ->> 'ph', t ->> 'gate');
  end loop;
  update public.workflow_versions set published_at = now() where id = v_wf;
  return v_wf;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Per-farm structure: roles, actions, matrix, decisions, parameters, templates.
-- ---------------------------------------------------------------------------------------------
create function app.seed_ph_config(p_farm uuid) returns void
language plpgsql
as $fn$
declare
  v_demo boolean := coalesce((select is_demo from public.farms where id = p_farm), false);
begin
  if exists (select 1 from public.ph_roles where farm_id = p_farm) then
    return;
  end if;

  -- Roles (§6.1). Arabic labels are a starting glossary (E46).
  insert into public.roles (farm_id, code, name_ar, name_en)
  select p_farm, 'ph_' || lower(r.c), r.ar, r.en
    from (values
      ('PHM', 'مدير بيت التعبئة', 'Packing House Manager'),
      ('PE',  'مهندس الإنتاج', 'Production Engineer'),
      ('LL',  'مشرف / قائد خط', 'Line Supervisor / Line Leader'),
      ('PHO', 'مشغّل بيت التعبئة', 'Packing House Operator'),
      ('TRC', 'عضو فريق التتبع', 'Traceability team member'),
      ('DEC', 'مدخل بيانات (الاستلام)', 'Data Entry Clerk (Receiving / PH)'),
      ('WHM', 'مدير المستودعات', 'Warehouse Manager'),
      ('STK', 'أمين المخزن', 'Store Controller / Store Keeper'),
      ('QCI', 'مراقب جودة', 'QC Inspector / Quality Controller'),
      ('QCM', 'مدير مراقبة الجودة', 'QC Manager'),
      ('QAO', 'مسؤول ضمان الجودة', 'QA Officer'),
      ('QAM', 'مدير ضمان الجودة', 'QA Manager'),
      ('ENG', 'مهندس إعادة الفرز', 'Engineer (regrades rejected incoming product)'),
      ('FRM', 'مشرف حصاد المزرعة', 'Farm Harvest Supervisor'),
      ('SAL', 'المبيعات', 'Sales'),
      ('LOG', 'اللوجستيات', 'Logistics'),
      ('FIN', 'المالية', 'Finance'),
      ('TOP', 'الإدارة العليا', 'Top Management'),
      ('ADM', 'مسؤول النظام (بيت التعبئة)', 'System Administrator (packing house)'),
      ('AUD', 'مدقق (قراءة فقط)', 'Auditor (read-only)')
    ) as r(c, ar, en);

  insert into public.ph_roles (farm_id, role_id, spec_code, department_text, reporting_line, evidence, source, system_use, decision_code, sort_order)
  select p_farm, (select id from public.roles where farm_id = p_farm and code = 'ph_' || lower(r.c)), r.c, r.dept, r.rep, r.ev, r.src, r.use, r.od, r.ord
    from (values
      ('PHM', 'Packing House', 'Not stated in sources', 'C', 'SUM-3; SOP', 'Full PH operational authority; order acceptance; waste sign-off; instruction channel', null, 1),
      ('PE',  'Packing House', 'Not stated (assumed PHM)', 'C', 'SOP-ST; SUM-3', 'Instruction channel; production planning', null, 2),
      ('LL',  'Packing House', 'Not stated (assumed PHM/PE)', 'C', 'SOP-PL', 'Line execution, packaging hand-out, line-start check with QC', null, 3),
      ('PHO', 'Packing House', 'Line Leader', 'NYV', 'SOP-PL (staff)', 'Scan/record only, if given access', 'OD-24', 4),
      ('TRC', 'Not stated', 'Not stated', 'NYV', 'SOP-PC', 'Production traceability recording', 'OD-13', 5),
      ('DEC', 'Warehouse Management', 'Warehouse Management', 'C', 'SUM-3; SOP-ST', 'Receiving registration, ERP transactions, LSS box inventory', null, 6),
      ('WHM', 'Warehouse', 'Not stated', 'C', 'SUM-3; SOP-TR; SOP-WS', 'Packaging stock, ERP postings, waste sign-off (>1 t), arrival time approval', null, 7),
      ('STK', 'Warehouse (assumed)', 'Not stated', 'NYV', 'SOP-PL', 'Packaging issue (department assumed)', 'OD-14', 8),
      ('QCI', 'Quality Control', 'QC management (outside PH)', 'C', 'SUM-3; SOP-GR', 'Arrival check, QC-1, line checks, QC-2, dispatch QC, waste label, crate inspection', null, 9),
      ('QCM', 'Quality Control', 'Not stated', 'C', 'SUM-3', 'QC disposition authority, QC master data approval', null, 10),
      ('QAO', 'Quality Assurance', 'QA management (outside PH)', 'C', 'SUM-3; SOP-RC', 'Raw-material acceptance, dispatch findings, shelf-life samples', null, 11),
      ('QAM', 'Quality Assurance', 'Not stated', 'C', 'SUM-3', 'Holds, NC/CAPA, complaints, tolerances, temperature parameters', null, 12),
      ('ENG', 'Not stated (farm or PH)', 'Not stated', 'NYV', 'SOP-RC', 'Regrade of rejected incoming product', 'OD-12', 13),
      ('FRM', 'Farm Operations', 'Not stated', 'C', 'SOP-RC (tag)', 'Tag data; dispatch note if CP-02 approved', null, 14),
      ('SAL', 'Sales', 'Not stated', 'C', 'SOP-FC; SOP-CP', 'Orders, customer specs, complaint intake', null, 15),
      ('LOG', 'Logistics', 'Not stated', 'C', 'SOP-FC; SOP-TR', 'Truck schedules, transit times', null, 16),
      ('FIN', 'Finance', 'Not stated', 'C', 'SOP-WS', 'Waste sign-off (>1 t), packaging waste sign-off', null, 17),
      ('TOP', 'Executive', '—', 'C', 'SOP-WS; SOP-TR', 'Long-storage waste >1 t approval; vehicle non-compliance approval', null, 18),
      ('ADM', 'IT', 'Not stated', 'P', 'Proposed', 'User/role administration only; no operational transactions', null, 19),
      ('AUD', 'Internal audit / certification', '—', 'P', 'Proposed', 'Read-only access to records and audit trail', null, 20)
    ) as r(c, dept, rep, ev, src, use, od, ord);

  -- Actions (§6.3 rows; actors named only in §8.1 state tables are marked "SM-…").
  insert into public.ph_actions (farm_id, action_key, object_code, label_en, label_ar, owner_roles, milestone, source, sort_order)
  select p_farm, a.k, split_part(a.k, '.', 1), a.en, a.ar, a.own, a.ms, a.src, row_number() over ()
    from (values
      ('customer_order.view', 'View customer orders', 'عرض طلبات العملاء', '{SAL,PHM}'::text[], 'M2', '§6.3'),
      ('customer_order.create', 'Create / edit / submit order lines', 'إنشاء / تعديل / إرسال بنود الطلب', '{SAL,PHM}', 'M2', '§6.3'),
      ('customer_order.accept', 'Accept / reject order lines', 'قبول / رفض بنود الطلب', '{SAL,PHM}', 'M2', '§6.3'),
      ('customer_order.amend', 'Cancel / reopen (amend) order lines', 'إلغاء / إعادة فتح (تعديل) بنود الطلب', '{SAL,PHM}', 'M2', '§6.3'),
      ('job_card.view', 'View daily plan / Job Cards', 'عرض الخطة اليومية / بطاقات العمل', '{PHM}', 'M2', '§6.3'),
      ('job_card.create', 'Create / edit / submit Job Card', 'إنشاء / تعديل / إرسال بطاقة عمل', '{PHM}', 'M2', '§6.3'),
      ('job_card.approve', 'Approve Job Card', 'اعتماد بطاقة عمل', '{PHM}', 'M2', '§6.3'),
      ('job_card.execute', 'Execute Job Card (start / pause / complete)', 'تنفيذ بطاقة العمل (بدء / إيقاف / إكمال)', '{PHM}', 'M2', '§6.3'),
      ('job_card.record_inputs', 'Record inputs consumed', 'تسجيل المدخلات المستهلكة', '{PHM}', 'M2', '§6.3'),
      ('job_card.close', 'Cancel / reopen / close Job Card', 'إلغاء / إعادة فتح / إغلاق بطاقة عمل', '{PHM}', 'M2', '§6.3'),
      ('arrival.create', 'Create / edit / submit arrival', 'إنشاء / تعديل / إرسال سجل الوصول', '{WHM}', 'M1', '§6.3'),
      ('arrival.vehicle_inspection', 'Record incoming vehicle inspection', 'تسجيل فحص المركبة الواردة', '{WHM}', 'M1', '§6.3'),
      ('arrival.vehicle_exception', 'Approve or refuse a vehicle exception (all three required)', 'اعتماد أو رفض استثناء المركبة (الثلاثة مطلوبون)', '{WHM}', 'M1', '§6.3'),
      ('incoming_pallet.view', 'View incoming pallets', 'عرض الطبالي الواردة', '{WHM}', 'M1', '§6.3'),
      ('incoming_pallet.register', 'Register incoming pallet (weight, ID)', 'تسجيل طبلية واردة (الوزن والرقم)', '{WHM}', 'M1', '§6.3'),
      ('incoming_pallet.edit_weight', 'Edit weight before QA decision', 'تعديل الوزن قبل قرار ضمان الجودة', '{WHM}', 'M1', '§6.3'),
      ('incoming_pallet.correct', 'Correct after QA decision (maker)', 'تصحيح بعد قرار ضمان الجودة (المُنشئ)', '{WHM}', 'M4', '§6.3'),
      ('incoming_pallet.correct_verify', 'Correct after QA decision (checker)', 'تصحيح بعد قرار ضمان الجودة (المدقق)', '{WHM}', 'M4', '§6.3'),
      ('incoming_pallet.print_label', 'Print / reprint receiving label', 'طباعة / إعادة طباعة ملصق الاستلام', '{WHM}', 'M1', '§6.3'),
      ('incoming_pallet.void_request', 'Request void (registered in error)', 'طلب إلغاء (سُجّلت خطأً)', '{WHM}', 'M1', '§6.3'),
      ('incoming_pallet.void_approve', 'Approve void', 'اعتماد الإلغاء', '{WHM}', 'M1', '§6.3'),
      ('incoming_pallet.record_disposition', 'Record disposition of an arrival-rejected pallet', 'تسجيل مصير طبلية مرفوضة عند الوصول', '{WHM}', 'M1', 'SM-IP §8.1'),
      ('arrival_check.submit', 'Arrival visual check (pass / reject)', 'فحص الوصول البصري (قبول / رفض)', '{QCM,QAM}', 'M1', '§6.3'),
      ('arrival_check.reopen', 'Reopen arrival check', 'إعادة فتح فحص الوصول', '{QCM,QAM}', 'M4', '§6.3'),
      ('precool.record', 'Record pre-cooling entry / exit', 'تسجيل دخول / خروج التبريد الأولي', '{PHM}', 'M1', '§6.3'),
      ('precool.correct_times', 'Correct pre-cooling times', 'تصحيح أوقات التبريد الأولي', '{PHM}', 'M4', '§6.3'),
      ('rma.submit', 'Create / submit raw-material acceptance', 'إنشاء / إرسال تقرير قبول المواد الخام', '{QAM}', 'M1', '§6.3'),
      ('rma.cosign', 'Verify (co-sign) raw-material acceptance', 'التحقق (التوقيع المشترك) على قبول المواد الخام', '{QAM}', 'M1', '§6.3'),
      ('rma.decide', 'Accept / reject raw material', 'قبول / رفض المواد الخام', '{QAM}', 'M1', '§6.3'),
      ('rma.recheck', 'Recheck after regrade', 'إعادة الفحص بعد إعادة الفرز', '{QAM}', 'M1', '§6.3'),
      ('rma.reopen', 'Reopen raw-material acceptance', 'إعادة فتح قبول المواد الخام', '{QAM}', 'M4', '§6.3'),
      ('regrade.execute', 'Regrade rejected incoming product (start / mark complete)', 'إعادة فرز المنتج الوارد المرفوض (بدء / إنهاء)', '{QAM}', 'M1', '§6.3'),
      ('regrade.reweigh', 'Re-weigh after regrade', 'إعادة الوزن بعد إعادة الفرز', '{WHM}', 'M1', '§6.3'),
      ('stock_move.execute', 'Move pallet (scan from / to)', 'نقل طبلية (مسح من / إلى)', '{PHM}', 'M1', '§6.3'),
      ('stock_move.assign_group', 'Assign fridge storage group', 'تعيين مجموعة التخزين للثلاجة', '{PHM}', 'M1', '§6.3'),
      ('stock_move.override_placement', 'Override placement warning', 'تجاوز تحذير التخزين', '{PHM}', 'M1', '§6.3'),
      ('temperature.create', 'Record temperature reading', 'تسجيل قراءة الحرارة', '{QAM}', 'M3', '§6.3'),
      ('temperature.acknowledge', 'Acknowledge temperature excursion', 'الإقرار بتجاوز الحرارة', '{QAM}', 'M3', '§6.3'),
      ('qc1.release', 'QC-1 release / hold', 'إفراج QC-1 / حجز', '{QCM}', 'M1', '§6.3'),
      ('qc1.reopen', 'Reopen QC-1', 'إعادة فتح QC-1', '{QCM}', 'M4', '§6.3'),
      ('packaging.request', 'Request packaging', 'طلب مواد التعبئة', '{WHM}', 'M2', '§6.3'),
      ('packaging.issue', 'Issue packaging', 'صرف مواد التعبئة', '{WHM}', 'M2', '§6.3'),
      ('packaging.remove_erp', 'Remove packaging from ERP stock', 'خصم مواد التعبئة من مخزون ERP', '{WHM}', 'M2', '§6.3'),
      ('line_start.submit', 'Line start check (joint)', 'فحص بدء الخط (مشترك)', '{QCM}', 'M2', '§6.3'),
      ('qc2.submit', 'QC-2 inspection (pass / fail)', 'فحص QC-2 (قبول / رفض)', '{QCM}', 'M2', '§6.3'),
      ('qc2.reopen', 'Reopen QC-2', 'إعادة فتح QC-2', '{QCM}', 'M4', '§6.3'),
      ('fg_pallet.view', 'View finished-goods pallets', 'عرض طبالي المنتج النهائي', '{PHM}', 'M2', '§6.3'),
      ('fg_pallet.create', 'Create / weigh / print FG label', 'إنشاء / وزن / طباعة ملصق المنتج النهائي', '{PHM}', 'M2', '§6.3'),
      ('fg_pallet.confirm_complete', 'Confirm FG pallet complete', 'تأكيد اكتمال طبلية المنتج النهائي', '{PHM}', 'M2', '§6.3'),
      ('fg_pallet.split_merge', 'Split / merge (execute)', 'تقسيم / دمج (تنفيذ)', '{PHM}', 'M2', '§6.3'),
      ('fg_pallet.split_merge_approve', 'Split / merge (approve)', 'تقسيم / دمج (اعتماد)', '{PHM}', 'M2', '§6.3'),
      ('fg_pallet.relabel', 'Relabel / correct', 'إعادة الملصق / تصحيح', '{PHM}', 'M2', '§6.3'),
      ('hold.raise', 'Raise hold', 'رفع حجز', '{QAM}', 'M1', '§6.3'),
      ('hold.assign', 'Take hold into assessment', 'أخذ الحجز للتقييم', '{QAM}', 'M1', 'SM-NC §8.1'),
      ('hold.decide_quality', 'Decide disposition — quality hold', 'تحديد المصير — حجز جودة', '{QAM}', 'M1', '§6.3'),
      ('hold.decide_food_safety', 'Decide disposition — food-safety hold', 'تحديد المصير — حجز سلامة غذاء', '{QAM}', 'M1', '§6.3'),
      ('hold.release', 'Release held items', 'الإفراج عن المحجوز', '{QAM}', 'M1', '§6.3'),
      ('hold.execute', 'Execute disposition (via PH)', 'تنفيذ المصير (عبر بيت التعبئة)', '{QAM}', 'M1', 'SM-NC §8.1'),
      ('hold.verify', 'Verify executed disposition', 'التحقق من تنفيذ المصير', '{QAM}', 'M1', 'SM-NC §8.1'),
      ('hold.close', 'Close hold', 'إغلاق الحجز', '{QAM}', 'M1', '§6.3'),
      ('hold.cancel', 'Cancel hold', 'إلغاء الحجز', '{QAM}', 'M1', 'SM-NC §8.1'),
      ('waste.create', 'Create / weigh waste', 'إنشاء / وزن الهدر', '{PHM}', 'M2', '§6.3'),
      ('waste.qc_label', 'Verify — QC waste approval label', 'التحقق — ملصق اعتماد الهدر من الجودة', '{PHM}', 'M2', '§6.3'),
      ('waste.signoff_small', 'Sign off waste < 1 t', 'توقيع الهدر أقل من طن', '{PHM}', 'M2', '§6.3'),
      ('waste.signoff_large', 'Sign off waste > 1 t or long-storage (all required)', 'توقيع الهدر أكثر من طن أو تخزين طويل (الجميع مطلوب)', '{PHM}', 'M2', '§6.3'),
      ('waste.topmgmt', 'Approve long-storage waste > 1 t', 'اعتماد هدر التخزين الطويل أكثر من طن', '{PHM}', 'M2', '§6.3'),
      ('waste.erp_ref', 'Record ERP posting reference', 'تسجيل مرجع الترحيل في ERP', '{PHM}', 'M2', '§6.3'),
      ('waste.reopen', 'Reopen waste (before ERP posting)', 'إعادة فتح الهدر (قبل الترحيل)', '{PHM}', 'M2', '§6.3'),
      ('load.create', 'Create load / allocate pallets', 'إنشاء شحنة / تخصيص الطبالي', '{PHM}', 'M3', '§6.3'),
      ('load.pick', 'Pick / scan loaded pallets', 'التقاط / مسح الطبالي المحمّلة', '{PHM}', 'M3', '§6.3'),
      ('load.vehicle_inspection', 'Dispatch vehicle inspection pass / fail', 'فحص مركبة الشحن قبول / رفض', '{PHM}', 'M3', '§6.3'),
      ('load.product_temp', 'Product temperature check', 'فحص حرارة المنتج', '{PHM}', 'M3', '§6.3'),
      ('load.release_pallet', 'Release / reject pallet (dispatch QC)', 'إفراج / رفض طبلية (جودة الشحن)', '{PHM}', 'M3', '§6.3'),
      ('load.decide_rejected', 'Decide rejected pallet: resort or replace', 'تحديد مصير الطبلية المرفوضة: إعادة فرز أو استبدال', '{PHM}', 'M3', '§6.3'),
      ('load.qa_findings', 'Record QA dispatch findings', 'تسجيل ملاحظات ضمان الجودة للشحن', '{PHM}', 'M3', '§6.3'),
      ('load.logger_seal', 'Record logger ID & position / seal number', 'تسجيل رقم المسجل وموضعه / رقم الختم', '{PHM}', 'M3', '§6.3'),
      ('load.finalise', 'Finalise packing list / record departure', 'اعتماد قائمة التعبئة / تسجيل المغادرة', '{PHM}', 'M3', '§6.3'),
      ('load.window_override', 'Approve loading-window override', 'اعتماد تجاوز نافذة التحميل', '{PHM}', 'M3', '§6.3'),
      ('shelf_life.create', 'Create / dispose shelf-life sample', 'إنشاء / التخلص من عينة العمر التخزيني', '{QAM}', 'M3', '§6.3'),
      ('complaint.create', 'Create complaint', 'إنشاء شكوى', '{QAM}', 'M4', '§6.3'),
      ('complaint.validity', 'Complaint validity decision', 'قرار صلاحية الشكوى', '{QAM}', 'M4', '§6.3'),
      ('complaint.investigate', 'Investigate complaint', 'التحقيق في الشكوى', '{QAM}', 'M4', '§6.3'),
      ('complaint.confirm', 'Confirm investigation', 'تأكيد التحقيق', '{QAM}', 'M4', '§6.3'),
      ('complaint.recall', 'Initiate recall', 'بدء الاستدعاء', '{QAM}', 'M4', '§6.3'),
      ('complaint.close', 'Close complaint', 'إغلاق الشكوى', '{QAM}', 'M4', '§6.3'),
      ('capa.manage', 'Open / approve closure of CAPA', 'فتح / اعتماد إغلاق الإجراء التصحيحي', '{QAM}', 'M4', '§6.3'),
      ('deviation.create', 'Create customer deviation request / record approval', 'إنشاء طلب انحراف للعميل / تسجيل الموافقة', '{QCM}', 'M2', '§6.3'),
      ('stock_report.issue', 'Issue daily stock report', 'إصدار تقرير المخزون اليومي', '{PHM}', 'M4', '§6.3'),
      ('stock_report.view', 'View daily stock report', 'عرض تقرير المخزون اليومي', '{PHM}', 'M4', '§6.3'),
      ('md_quality.edit', 'Master data — quality parameters (maker)', 'البيانات الرئيسية — معايير الجودة (المُعِد)', '{QCM,QAM}', 'M1', '§6.3'),
      ('md_quality.approve', 'Master data — quality parameters (checker)', 'البيانات الرئيسية — معايير الجودة (المُعتمِد)', '{QCM,QAM}', 'M1', '§6.3'),
      ('md_operational.edit', 'Master data — operational (maker)', 'البيانات الرئيسية — التشغيلية (المُعِد)', '{PHM}', 'M1', '§6.3'),
      ('md_operational.approve', 'Master data — operational (checker)', 'البيانات الرئيسية — التشغيلية (المُعتمِد)', '{PHM}', 'M1', '§6.3'),
      ('md_customer.edit', 'Master data — customers & specs (maintain)', 'البيانات الرئيسية — العملاء والمواصفات (الإدامة)', '{SAL,QCM}', 'M2', '§6.3'),
      ('md_customer.approve', 'Master data — customer spec content (approve)', 'البيانات الرئيسية — محتوى مواصفات العميل (اعتماد)', '{SAL,QCM}', 'M2', '§6.3'),
      ('users.administer', 'Administer users & roles', 'إدارة المستخدمين والأدوار', '{ADM}', 'M4', '§6.3'),
      ('users.access_review', 'Approve access request / periodic review', 'اعتماد طلب الوصول / المراجعة الدورية', '{ADM}', 'M4', '§6.3'),
      ('override.invoke', 'Invoke emergency override', 'تفعيل التجاوز الطارئ', '{PHM,QCM,QAM}', 'M4', '§6.3'),
      ('override.review', 'Retrospective review of override', 'المراجعة اللاحقة للتجاوز', '{PHM,QCM,QAM}', 'M4', '§6.3'),
      ('audit.view', 'View audit trail (read-only)', 'عرض سجل التدقيق (قراءة فقط)', '{QAM}', 'M1', '§6.3')
    ) as a(k, en, ar, own, ms, src);

  -- The matrix (§6.3, PDF pages 45–48). Format: action | role | label | decision | note.
  insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, decision_code, note)
  select p_farm, m.k, m.r, m.e,
         case m.e when 'C' then 'active' when 'P' then 'proposed' else 'pending_decision' end,
         m.e, m.od, m.note
    from (values
      ('customer_order.view','PHM','P',null::text,null::text),('customer_order.view','PE','P',null,null),('customer_order.view','LL','P',null,null),
      ('customer_order.view','DEC','P',null,null),('customer_order.view','WHM','P',null,null),('customer_order.view','QCI','P',null,null),
      ('customer_order.view','QCM','P',null,null),('customer_order.view','QAO','P',null,null),('customer_order.view','QAM','P',null,null),
      ('customer_order.view','SAL','P',null,null),('customer_order.view','LOG','P',null,null),('customer_order.view','AUD','P',null,null),
      ('customer_order.create','SAL','C','OD-37','Sales sends orders (SOP-FC). PH planner keying on Sales'' behalf: OD-37.'),
      ('customer_order.accept','PHM','C',null,'PH management accepts or rejects orders (SOP-FC).'),
      ('customer_order.amend','PHM','P',null,'Amendment returns line to Pending acceptance.'),('customer_order.amend','SAL','P',null,'Amendment returns line to Pending acceptance.'),
      ('job_card.view','PHM','P',null,null),('job_card.view','PE','P',null,null),('job_card.view','LL','P',null,null),('job_card.view','DEC','P',null,null),
      ('job_card.view','WHM','P',null,null),('job_card.view','STK','P',null,null),('job_card.view','QCI','P',null,null),('job_card.view','QCM','P',null,null),
      ('job_card.view','QAO','P',null,null),('job_card.view','QAM','P',null,null),('job_card.view','AUD','P',null,null),
      ('job_card.create','PHM','P','OD-15',null),('job_card.create','PE','P','OD-15',null),
      ('job_card.approve','PHM','P','OD-15',null),
      ('job_card.execute','LL','P',null,null),
      ('job_card.record_inputs','LL','P',null,null),('job_card.record_inputs','TRC','NYV','OD-13','Traceability team identity: OD-13.'),
      ('job_card.record_inputs','DEC','NYV','OD-13','Traceability team identity: OD-13.'),
      ('job_card.close','PHM','P','OD-15','Reopen window: OD-15.'),
      ('arrival.create','DEC','P',null,null),
      ('arrival.vehicle_inspection','DEC','NYV','OD-38','SOP-TR names no inspector.'),('arrival.vehicle_inspection','QAO','NYV','OD-38','SOP-TR names no inspector.'),
      ('arrival.vehicle_exception','PHM','C',null,'SOP-TR: PHM, QA team and top management.'),
      ('arrival.vehicle_exception','QAM','C','OD-38','SOP-TR: PHM, QA team and top management. QA signing level: OD-38.'),
      ('arrival.vehicle_exception','TOP','C','OD-38','SOP-TR: PHM, QA team and top management. Which top-management role: OD-38.'),
      ('incoming_pallet.view','PHM','P',null,null),('incoming_pallet.view','PE','P',null,null),('incoming_pallet.view','LL','P',null,null),
      ('incoming_pallet.view','DEC','P',null,null),('incoming_pallet.view','WHM','P',null,null),('incoming_pallet.view','QCI','P',null,null),
      ('incoming_pallet.view','QCM','P',null,null),('incoming_pallet.view','QAO','P',null,null),('incoming_pallet.view','QAM','P',null,null),
      ('incoming_pallet.view','ENG','P',null,null),('incoming_pallet.view','AUD','P',null,null),
      ('incoming_pallet.register','DEC','C','OD-01','SUM-3. Registering before QA acceptance is CP-01 (OD-01).'),
      ('incoming_pallet.edit_weight','DEC','P',null,'Reason mandatory.'),
      ('incoming_pallet.correct','DEC','P',null,'DEC creates the correction; QAO verifies.'),
      ('incoming_pallet.correct_verify','QAO','P',null,'DEC creates the correction; QAO verifies.'),
      ('incoming_pallet.print_label','DEC','P','OD-03','Reprints logged.'),
      ('incoming_pallet.void_request','DEC','P',null,'DEC requests; WHM approves.'),
      ('incoming_pallet.void_approve','WHM','P',null,'DEC requests; WHM approves.'),
      ('incoming_pallet.record_disposition','DEC','C',null,'SM-IP §8.1: Record disposition (DEC/PHM).'),
      ('incoming_pallet.record_disposition','PHM','C',null,'SM-IP §8.1: Record disposition (DEC/PHM).'),
      ('arrival_check.submit','QCI','C',null,'SOP-RC: QC/QA team.'),('arrival_check.submit','QAO','C',null,'SOP-RC: QC/QA team.'),
      ('arrival_check.reopen','QCM','P',null,null),('arrival_check.reopen','QAM','P',null,null),
      ('precool.record','PHO','P',null,null),('precool.record','DEC','P',null,null),
      ('precool.correct_times','PHM','P',null,null),
      ('rma.submit','QAO','C',null,'SOP-RC.'),
      ('rma.cosign','QCI','C',null,'SOP-GR: report signed by QA/QC team.'),('rma.cosign','QAM','P',null,'SOP-GR: report signed by QA/QC team.'),
      ('rma.decide','QAO','C',null,null),
      ('rma.recheck','QCI','C',null,null),('rma.recheck','QAO','C',null,null),
      ('rma.reopen','QAM','P',null,null),
      ('regrade.execute','ENG','C','OD-12','Engineer''s department: OD-12.'),
      ('regrade.reweigh','DEC','C',null,'SOP-RC: returned for re-scaling.'),
      ('stock_move.execute','PHO','P',null,null),('stock_move.execute','DEC','P',null,null),
      ('stock_move.execute','STK','NYV','OD-14','SOP-PL: store keeper issues product FIFO — custody: OD-14.'),
      ('stock_move.assign_group','PHM','P',null,'Allocations may change with need (SOP-PC).'),
      ('stock_move.override_placement','PHM','P',null,'Reason mandatory; logged.'),
      ('temperature.create','PHO','NYV','OD-32',null),('temperature.create','QAO','NYV','OD-32',null),
      ('temperature.acknowledge','PHM','P',null,null),('temperature.acknowledge','QAM','P',null,null),
      ('qc1.release','QCI','C','OD-17','SUM-3.'),
      ('qc1.reopen','QCM','P',null,null),
      ('packaging.request','PE','NYV',null,'SOP-PL does not name the requester (no decision named in the spec).'),
      ('packaging.request','LL','NYV',null,'SOP-PL does not name the requester (no decision named in the spec).'),
      ('packaging.issue','STK','C',null,'SOP-PL.'),
      ('packaging.remove_erp','WHM','C',null,'SOP-PL: Warehouse Dept on dispatch.'),
      ('line_start.submit','LL','C',null,'SOP-PL: Quality controller and line leader.'),('line_start.submit','QCI','C',null,'SOP-PL: Quality controller and line leader.'),
      ('qc2.submit','QCI','C',null,'SOP-GR.'),
      ('qc2.reopen','QCM','P',null,null),
      ('fg_pallet.view','PHM','P',null,null),('fg_pallet.view','PE','P',null,null),('fg_pallet.view','LL','P',null,null),('fg_pallet.view','DEC','P',null,null),
      ('fg_pallet.view','WHM','P',null,null),('fg_pallet.view','QCI','P',null,null),('fg_pallet.view','QCM','P',null,null),('fg_pallet.view','QAO','P',null,null),
      ('fg_pallet.view','QAM','P',null,null),('fg_pallet.view','SAL','P',null,null),('fg_pallet.view','LOG','P',null,null),('fg_pallet.view','AUD','P',null,null),
      ('fg_pallet.create','PHO','P','OD-13','Recording role: OD-13.'),('fg_pallet.create','TRC','NYV','OD-13','Recording role: OD-13.'),
      ('fg_pallet.create','DEC','NYV','OD-13','Recording role: OD-13.'),
      ('fg_pallet.confirm_complete','LL','P',null,null),
      ('fg_pallet.split_merge','PHO','P',null,'Compatibility rules V-22.'),
      ('fg_pallet.split_merge_approve','PHM','P',null,null),
      ('fg_pallet.relabel','DEC','P',null,'Old label voided; reason mandatory.'),
      ('hold.raise','PHM','P',null,'PHM may raise operational holds.'),('hold.raise','QCI','P',null,null),('hold.raise','QAO','P',null,null),
      ('hold.assign','QCM','P',null,'SM-NC §8.1: Assign (QCM/QAM).'),('hold.assign','QAM','P',null,'SM-NC §8.1: Assign (QCM/QAM).'),
      ('hold.decide_quality','QCM','P',null,null),('hold.decide_quality','QAM','P',null,null),
      ('hold.decide_food_safety','QAM','P','OD-23','Which holds are food-safety: OD-23.'),
      ('hold.release','QCM','P',null,'PHM cannot release a quality hold (SoD-05).'),('hold.release','QAM','P',null,'PHM cannot release a quality hold (SoD-05).'),
      ('hold.execute','PHM','P',null,'SM-NC §8.1: Execute (PHM/LL via PH).'),('hold.execute','LL','P',null,'SM-NC §8.1: Execute (PHM/LL via PH).'),
      ('hold.verify','QCI','P',null,'SM-NC §8.1: Verify (QCI/QAO).'),('hold.verify','QAO','P',null,'SM-NC §8.1: Verify (QCI/QAO).'),
      ('hold.close','QAM','P',null,null),
      ('hold.cancel','QAM','P',null,'SM-NC §8.1: Cancel (QAM).'),
      ('waste.create','PHO','NYV',null,'Scaling role not stated (no decision named in the spec).'),('waste.create','DEC','P',null,null),
      ('waste.qc_label','QCI','C',null,'SOP-WS: before scaling and loading.'),
      ('waste.signoff_small','PHM','C','OD-11','Threshold basis: OD-11.'),
      ('waste.signoff_large','PHM','C','OD-11',null),('waste.signoff_large','WHM','C','OD-11',null),('waste.signoff_large','FIN','C','OD-11',null),
      ('waste.signoff_large','QCM','NYV','OD-11','SOP: ''QA and QC team'' — signing level: OD-11.'),
      ('waste.signoff_large','QAM','NYV','OD-11','SOP: ''QA and QC team'' — signing level: OD-11.'),
      ('waste.topmgmt','TOP','C',null,'If no approval in 24 h: removal recorded under the 24 h rule (E-20).'),
      ('waste.erp_ref','DEC','C',null,'SOP-ST: data entry clerks handle ERP transactions.'),
      ('waste.reopen','PHM','P',null,null),
      ('load.create','PHM','P',null,null),('load.create','PE','P',null,null),
      ('load.pick','PHO','P',null,null),
      ('load.vehicle_inspection','QCI','C',null,'SOP-GR dispatched product grading report.'),
      ('load.product_temp','QCI','C',null,'SOP-DS: QC / QA.'),('load.product_temp','QAO','C',null,'SOP-DS: QC / QA.'),
      ('load.release_pallet','QCI','C',null,'Reject only if QC approval > 24 h (SOP-DS).'),
      ('load.decide_rejected','PHM','C',null,'SOP-GR: discussed with QC and PHM.'),('load.decide_rejected','QCI','C',null,'SOP-GR: discussed with QC and PHM.'),
      ('load.qa_findings','QAO','C',null,'SOP-DS.'),
      ('load.logger_seal','PHO','NYV','OD-18','OD-18.'),('load.logger_seal','DEC','NYV','OD-18','OD-18.'),
      ('load.finalise','DEC','NYV',null,'Recording role not stated (no decision named in the spec).'),
      ('load.window_override','PHM','P','OD-39','OD-39.'),
      ('shelf_life.create','QAO','C',null,'SOP-GR.'),
      ('complaint.create','SAL','C','OD-33','SOP-CP.'),
      ('complaint.validity','QCI','P',null,null),('complaint.validity','QAO','P',null,null),
      ('complaint.investigate','QCI','C',null,'SOP-CP.'),('complaint.investigate','QAO','C',null,'SOP-CP.'),
      ('complaint.confirm','PHM','C',null,'SOP-CP.'),
      ('complaint.recall','QAM','NYV','OD-22','Authority not stated: OD-22.'),('complaint.recall','TOP','NYV','OD-22','Authority not stated: OD-22.'),
      ('complaint.close','QAM','P',null,null),
      ('capa.manage','QCM','P',null,null),('capa.manage','QAM','P',null,null),
      ('deviation.create','SAL','NYV',null,'SOP-PL names no requester (no decision named in the spec).'),
      ('stock_report.issue','PHM','P',null,null),
      ('stock_report.view','PHM','P',null,null),('stock_report.view','PE','P',null,null),('stock_report.view','LL','P',null,null),('stock_report.view','DEC','P',null,null),
      ('stock_report.view','WHM','P',null,null),('stock_report.view','QCI','P',null,null),('stock_report.view','QCM','P',null,null),('stock_report.view','QAO','P',null,null),
      ('stock_report.view','QAM','P',null,null),('stock_report.view','SAL','P',null,null),('stock_report.view','FIN','P',null,null),('stock_report.view','TOP','P',null,null),
      ('stock_report.view','AUD','P',null,null),
      ('md_quality.edit','QCI','P',null,'Tolerances, temperatures, specs.'),('md_quality.edit','QAO','P',null,'Tolerances, temperatures, specs.'),
      ('md_quality.approve','QCM','P',null,'Effective-dated versions.'),('md_quality.approve','QAM','P',null,'Effective-dated versions.'),
      ('md_operational.edit','ADM','P',null,'Crops, lines, routes, locations, capacities.'),
      ('md_operational.approve','PHM','P',null,null),
      ('md_customer.edit','SAL','P','OD-06','SAL maintains; QCM approves spec content.'),
      ('md_customer.approve','QCM','P','OD-06','SAL maintains; QCM approves spec content.'),
      ('users.administer','ADM','P',null,'On approved request from the department head.'),
      ('users.access_review','PHM','P','OD-41','Each for own staff. OD-41.'),('users.access_review','WHM','P','OD-41','Each for own staff. OD-41.'),
      ('users.access_review','QCM','P','OD-41','Each for own staff. OD-41.'),('users.access_review','QAM','P','OD-41','Each for own staff. OD-41.'),
      ('override.invoke','PHM','P','OD-16','Scope by gate owner: OD-16.'),('override.invoke','QCM','P','OD-16','Scope by gate owner: OD-16.'),
      ('override.invoke','QAM','P','OD-16','Scope by gate owner: OD-16.'),
      ('override.review','PHM','P','OD-16','Gate owner reviews; invoker cannot review own override.'),
      ('override.review','QCM','P','OD-16','Gate owner reviews; invoker cannot review own override.'),
      ('override.review','QAM','P','OD-16','Gate owner reviews; invoker cannot review own override.'),
      ('audit.view','QAM','P',null,'No role can edit or delete audit entries.'),('audit.view','ADM','P',null,'No role can edit or delete audit entries.'),
      ('audit.view','AUD','P',null,'No role can edit or delete audit entries.')
    ) as m(k, r, e, od, note);

  insert into public.settings (farm_id, key, value, evidence_tier, note)
  values (p_farm, 'ph_proposals_in_effect', to_jsonb(v_demo), 'C',
          case when v_demo then 'Demo farm: proposed (P) permissions and rules are usable and flagged so the workflow can be exercised'
               else 'Proposed (P) permissions are not usable until the record-type owner approves each cell (PH-OAS-SPEC-001: "build only after the named owner approves")' end);

  perform app.seed_ph_decisions(p_farm);
  perform app.seed_ph_parameters(p_farm);
  perform app.seed_ph_templates(p_farm);
end;
$fn$;

create function app.seed_ph_decisions(p_farm uuid) returns void
language sql
as $$
  insert into public.ph_open_decisions (farm_id, code, priority, needed_by, title_en, title_ar, why_en, options, recommendation_en,
                                        owner_text, owner_roles, source, dependents, blocks_en, blocks_ar)
  select p_farm, d.code, d.pri, d.need, d.ten, d.tar, d.why, d.opts::jsonb, d.rec, d.own, d.roles, d.src, d.dep, d.ben, d.bar
    from (values
      ('OD-01','critical','Phase 0','Point of system entry; registration of rejected pallets; farm dispatch note.',
       'نقطة إدخال الطبالي إلى النظام وتسجيل الطبالي المرفوضة وإشعار إرسال المزرعة',
       'Defines what ''received'' means and whether quantities reconcile (EV-01, EV-03, EV-04).',
       '[{"code":"A","en":"Register after QA acceptance (current SOP)."},{"code":"B","en":"Register every pallet at the scale with status (CP-01) + dispatch note (CP-02)."}]',
       'B — it is the only option that closes MB-03.','PHM + WHM + QAM; Farm Operations for CP-02','{PHM,WHM,QAM}'::text[],'SOP-RC; SUM-3 #6',
       '{CP-01,CP-02,MB-03,FR-RC-03,ST-02}'::text[],
       'Registering incoming pallets before QA acceptance (the receiving workflow as built implements option B).',
       'تسجيل الطبالي الواردة قبل قبول ضمان الجودة (المسار المبني يطبق الخيار B).'),
      ('OD-02','critical','Phase 0','Lot definition and assignment point.','تعريف رقم اللوط ونقطة تخصيصه',
       'The lot is the traceability key on labels and complaints (EV-05, EV-25).',
       '[{"code":"A","en":"Lot at QA acceptance (crop × source × harvest date)."},{"code":"B","en":"Lot at production (per Job Card)."},{"code":"C","en":"Both — raw lot printed on labels, Job Card as batch."}]',
       'C.','QAM + PHM','{QAM,PHM}','SOP-RC; SOP-PF; SUM-3 #8','{CP-03,GEN-03,ST-05,"7.1 LOT"}',
       'Lot assignment: accepted pallets show "Lot: pending OD-02" and no lot is created.',
       'تخصيص اللوط: تظهر الطبالي المقبولة "اللوط: بانتظار OD-02" ولا يُنشأ لوط.'),
      ('OD-03','critical','Phase 0','Identity of the ''pack house system'' and who issues Pallet IDs, lot numbers and labels.',
       'تحديد "نظام بيت التعبئة" الحالي ومن يصدر أرقام الطبالي واللوط والملصقات',
       'Avoids two systems issuing IDs; respects ''no replacement without explicit requirement''.',
       '[{"code":"A","en":"New system issues IDs for the packing house."},{"code":"B","en":"Existing system issues IDs; new system reads/keys them."}]',
       'Decide after identification in Phase 0.','PHM + WHM + IT','{PHM,WHM,ADM}','SOP-RC','{IB-02,ST-02,FR-RC-03,7.1}',
       'Issuing pallet numbers and printing receiving labels (two systems must not issue IDs).',
       'إصدار أرقام الطبالي وطباعة ملصقات الاستلام (لا يجوز أن يصدر نظامان الأرقام).'),
      ('OD-04','high','Phase 0 (boundary) / Phase 5','ERP boundary and integration.','حدود التكامل مع نظام ERP',
       'Duplicate keying vs interface cost (IB-01, H-10).',
       '[{"code":"A","en":"No interface; ERP references captured (Phase 1)."},{"code":"B","en":"File export."},{"code":"C","en":"API."}]',
       'A now; reassess with measured keying time.','WHM + FIN + IT','{WHM,FIN,ADM}','SOP-WS; SOP-PL; SOP-ST','{IB-01,FR-IN-01,FR-IN-02}',
       'Any ERP integration (none is built; references are keyed).','أي تكامل مع ERP (لم يُبنَ أي تكامل؛ تُدخل المراجع يدوياً).'),
      ('OD-05','critical','Phase 0 (pilot crop)','Incoming raw-material grading schedule (tolerances) per crop.',
       'جدول تدريج المواد الخام الواردة (حدود التفاوت) لكل محصول','G3 cannot be configured without it (EV-08).',
       '[{"code":"A","en":"Supply the controlled schedule."},{"code":"B","en":"QA drafts and approves one."}]',
       'Supply the controlled document.','QAM','{QAM}','SOP-RC; SOP-GR','{G3,FR-QG-01,FR-MD-03}',
       'Acceptance against tolerances: an RMA can only be "Accepted — no tolerance set", flagged for QAM.',
       'القبول مقابل حدود التفاوت: لا يُسجّل تقرير القبول إلا "مقبول — دون حدود تفاوت" مع تنبيه لمدير ضمان الجودة.'),
      ('OD-06','high','Phase 2','Product / customer specifications: owner, format, approval.','مواصفات المنتج/العميل: المالك والصيغة والاعتماد',
       'QC-2 and labels depend on them.','[{"code":"A","en":"Sales maintains, QCM approves (proposed)."}]',
       'As proposed.','SAL + QCM','{SAL,QCM}','SOP-PL; SOP-GR','{FR-MD-04,G6,7.3}',
       'Customer specifications (milestone M2).','مواصفات العملاء (المرحلة M2).'),
      ('OD-07','high','Phase 1','Pre-cooling dwell rule by receiving temperature.','قاعدة مدة التبريد الأولي حسب حرارة الاستلام',
       'V-04 enforcement.','[{"code":"A","en":"Rule table (temperature band → minutes)."},{"code":"B","en":"A single 30 min maximum."}]',
       'Rule table if QA can define it; else 30 min max.','QAM + PHM','{QAM,PHM}','SOP-PC','{V-04,K3,E-05}',
       'Temperature-dependent dwell. Meanwhile the documented 30 min maximum raises the alert.',
       'مدة التبريد حسب الحرارة. وحتى القرار يُطبّق الحد الموثق 30 دقيقة للتنبيه.'),
      ('OD-08','high','Phase 1','Temperature limits: confirm SOP storage ranges as operational limits; alarm tolerances; vehicle and product temperature requirements at dispatch.',
       'حدود درجات الحرارة وتحمّلات الإنذار ومتطلبات حرارة المركبة والمنتج عند الشحن','Alerts and dispatch blocks (V-14, V-25).',
       '[{"code":"A","en":"Adopt SOP table with tolerances set by QA."}]','QA to set; this specification invents none.','QAM','{QAM}','SOP-PC; SOP-DS',
       '{V-14,V-25,E-08,X-07}','Temperature alerts and dispatch temperature blocks (milestone M3).','تنبيهات الحرارة ومنع الشحن بسبب الحرارة (المرحلة M3).'),
      ('OD-09','high','Phase 3','Start of the 48 h clock and link to ''Order Received — Max. 48 Hours''; alert lead times.',
       'بداية احتساب مهلة الـ48 ساعة وربطها بملاحظة "استلام الطلب — 48 ساعة كحد أقصى" ومهل التنبيه','V-12 and K5 depend on it (EV-14).',
       '[{"code":"A","en":"From harvest (SOP)."},{"code":"B","en":"From order receipt (manager''s note)."},{"code":"C","en":"Both, as separate limits."}]',
       'C if both rules are intended; confirm.','PHM + SAL','{PHM,SAL}','SOP-PC; SUM-3 #7','{V-12,K5,CP-07,FR-PL-03}',
       'The 48 h age basis and the grading-overdue alert lead time (no early alert is computed).',
       'أساس عمر 48 ساعة ومهلة التنبيه المسبق لتأخر الفرز (لا يُحسب تنبيه مسبق).'),
      ('OD-10','high','Phase 3','Can regraded product be loaded beyond 72 h after harvest?','هل يجوز تحميل المنتج المعاد فرزه بعد 72 ساعة من القطف؟',
       'SOP says > 72 h is strictly not allowed but also describes regrading after long storage.',
       '[{"code":"A","en":"Never beyond 72 h (waste)."},{"code":"B","en":"Allowed after regrade with QA approval."}]',
       'Owner decision; system blocks until decided.','PHM + QAM','{PHM,QAM}','SOP-PC; SOP-GR','{V-12,E-14,ST-15,"SM-FGP AgeBlocked"}',
       'Disposition of age-blocked pallets (milestone M3).','مصير الطبالي الممنوعة بسبب العمر (المرحلة M3).'),
      ('OD-11','high','Phase 2','Waste thresholds: basis of ''1 t'' (per report, shift, day, event); QA/QC signing level; whether electronic sign-off replaces wet signatures.',
       'أساس حد الطن الواحد للهدر ومستوى توقيع الجودة واعتماد التوقيع الإلكتروني','Routing V-17.',
       '[{"code":"A","en":"Per waste report per shift (proposed)."}]','Per report per shift; e-signature accepted.',
       'PHM + FIN + WHM + QAM + QCM','{PHM,FIN,WHM,QAM,QCM}','SOP-WS','{V-17,FR-WS-03,CP-08}',
       'Waste sign-off routing (milestone M2).','مسار توقيعات الهدر (المرحلة M2).'),
      ('OD-12','medium','Phase 1','Which engineer regrades rejected incoming product (department, person)?','أي مهندس يعيد فرز المنتج الوارد المرفوض (القسم والشخص)؟',
       'Task routing and SoD-02.','[{"code":"A","en":"Farm engineer."},{"code":"B","en":"Production Engineer."},{"code":"C","en":"Other."}]',
       null,'PHM + Farm Operations','{PHM}','SOP-RC','{SoD-02,HO-05,ST-05}',
       'Which users receive the Engineer (ENG) role; the regrade step works for whoever holds it.',
       'من يُمنح دور المهندس (ENG)؛ تعمل خطوة إعادة الفرز لمن يحمله.'),
      ('OD-13','high','Phase 2','Who is the ''traceability team'', and who records JC inputs and FG pallets?',
       'من هو "فريق التتبع" ومن يسجل مدخلات بطاقات العمل والطبالي النهائية؟','System user assignment for ST-08/ST-10.',
       '[{"code":"A","en":"Data-entry clerks (Warehouse Mgmt)."},{"code":"B","en":"PH staff."},{"code":"C","en":"Dedicated team."}]',
       null,'PHM + WHM','{PHM,WHM}','SOP-PC; SOP-ST','{ST-08,ST-10,FR-PR-02,FR-FG-01}',
       'Recording of Job Card inputs and FG pallets by TRC/DEC (cells pending).','تسجيل مدخلات بطاقات العمل والطبالي النهائية من TRC/DEC (صلاحيات معلّقة).'),
      ('OD-14','high','Phase 1','Custody of fridge stock: who records moves in and out (PH vs Warehouse store keeper)?',
       'عهدة مخزون الثلاجات: من يسجل الإدخال والإخراج (بيت التعبئة أم أمين المخزن)؟','Stock-move accountability.',
       '[{"code":"A","en":"PH operators."},{"code":"B","en":"Store keeper."},{"code":"C","en":"Data entry."}]',
       null,'PHM + WHM','{PHM,WHM}','SOP-PL; SOP-PC','{ST-06,ST-12,FR-ST-01}',
       'Stock moves by the store keeper (STK cell pending).','نقل المخزون بواسطة أمين المخزن (صلاحية معلّقة).'),
      ('OD-15','high','Phase 2','Who creates and approves Job Cards; JC granularity (per line × product × shift?); reopen window.',
       'من ينشئ ويعتمد بطاقات العمل؟ ودرجة تفصيلها ومهلة إعادة فتحها','ST-08 design.',
       '[{"code":"A","en":"PE creates, PHM approves; one JC per line per product per shift."}]','As proposed.','PHM','{PHM}','Proposed (CP-04)',
       '{ST-08,CP-04,SM-JC}','Job Cards (milestone M2).','بطاقات العمل (المرحلة M2).'),
      ('OD-16','high','Phase 1','Emergency override authority, non-overridable rules, maximum duration, review window; escalation times for tasks and partial approvals.',
       'صلاحية التجاوز الطارئ والقواعد غير القابلة للتجاوز ومدة التجاوز ونافذة المراجعة ومهل التصعيد','X-06 safety and control.',
       '[{"code":"A","en":"As listed in Section 6.5 (proposal)."}]','Approve list in Section 6.5.','PHM + QCM + QAM + Top management','{PHM,QCM,QAM,TOP}','Proposed',
       '{X-06,FR-NC-04,FR-NT-03,V-27,FR-RC-02}',
       'Emergency overrides, escalation timers, expiry of partial vehicle approvals and the late-entry threshold.',
       'التجاوزات الطارئة ومهل التصعيد وانتهاء الموافقات الجزئية للمركبات وحد الإدخال المتأخر.'),
      ('OD-17','medium','Phase 2','Scope of QC-1 versus arrival check and QA acceptance.','نطاق فحص QC-1 مقارنة بفحص الوصول وقبول ضمان الجودة',
       'Avoid duplicate inspection (EV-11).',
       '[{"code":"A","en":"Keep QC-1 as a separate gate."},{"code":"B","en":"Merge with QA acceptance."},{"code":"C","en":"QC-1 only on issue from storage > X h."}]',
       null,'QCM + PHM','{QCM,PHM}','SUM-3 #4','{G4,ST-07,FR-QG-03}',
       'QC-1 release (G4) — the release step as built implements option A.','إفراج QC-1 (G4) — الخطوة المبنية تطبق الخيار A.'),
      ('OD-18','medium','Phase 3','Temperature logger: all loads or export loads only?','مسجل الحرارة: لكل الشحنات أم للتصدير فقط؟','V-13 (EV-23).',
       '[{"code":"A","en":"All loads (SOP-DS)."},{"code":"B","en":"Export loads only (SOP-GR)."}]',null,'QAM + LOG','{QAM,LOG}','SOP-DS; SOP-GR',
       '{V-13,FR-DS-06,CP-10}','Logger requirement at departure (milestone M3).','اشتراط مسجل الحرارة عند المغادرة (المرحلة M3).'),
      ('OD-19','medium','Phase 2','Definition and format of ''box code''.','تعريف وصيغة "رمز الصندوق"','Complaints must quote it (EV-25).',
       '[{"code":"A","en":"Box code = lot + date."},{"code":"B","en":"A printed box serial."}]',null,'PHM + SAL','{PHM,SAL}','SOP-CP',
       '{"7.1 BOX",TQ-01,FR-TR-02}','Trace by box code.','التتبع برمز الصندوق.'),
      ('OD-20','medium','Phase 1','Label formats, barcode type; GS1 SSCC adoption; physical vs electronic QC approval label.',
       'صيغ الملصقات ونوع الباركود واعتماد GS1 SSCC والملصق الورقي أو الإلكتروني لاعتماد الجودة','Customer acceptance of labels.',
       '[{"code":"A","en":"Internal barcode."},{"code":"B","en":"GS1 SSCC."}]',
       'Internal barcode unless customers require SSCC; keep stamped label until customers confirm.','SAL + QAM + PHM','{SAL,QAM,PHM}','SOP-PL; SOP-GR',
       '{CP-13,CP-14,"7.3"}','Barcode on labels: labels print the ID as text, without a barcode, until decided.',
       'الباركود على الملصقات: يُطبع الرقم نصاً بلا باركود حتى القرار.'),
      ('OD-21','medium','Phase 1','Record retention period; mock-recall frequency.','مدة الاحتفاظ بالسجلات وتكرار محاكاة الاستدعاء',
       'Storage sizing and evidence for audits.','[{"code":"A","en":"At least shelf life (ISO 22000 §8.3)."},{"code":"B","en":"Customer / legal periods."}]',
       'QA to set from customer and legal requirements.','QAM (+ legal)','{QAM}','ISO 22000 §8.3','{AT-08,NFR-08,K9}',
       'Retention policy: meanwhile nothing is deleted.','سياسة الاحتفاظ: لا يُحذف شيء حتى القرار.'),
      ('OD-22','high','Phase 0','Applicable certifications, customer standards and regulatory requirements (Jordan and export markets); recall authority.',
       'الشهادات ومعايير العملاء والمتطلبات التنظيمية المطبقة (الأردن وأسواق التصدير) وصلاحية الاستدعاء',
       'Determines which standard clauses are mandatory requirements vs good practice.','[]',
       'QA to list; this specification claims no compliance.','QAM + Top management','{QAM,TOP}','SUM-3 (QA role)','{D-17,E-21,FR-TR-03,STD-28}',
       'Recall initiation (cells pending; milestone M4).','بدء الاستدعاء (صلاحيات معلّقة؛ المرحلة M4).'),
      ('OD-23','high','Phase 1','HACCP study: are any packhouse steps CCPs or OPRPs (e.g. washer-dryer water, cold chain)? Which holds count as food-safety holds?',
       'دراسة HACCP: هل في بيت التعبئة نقاط تحكم حرجة؟ وأي أنواع الحجز تُعد حجز سلامة غذاء؟',
       'The system must record monitoring for any CCP/OPRP but must not define them (EV-36).','[]',
       'QA / food-safety team to confirm from the existing HACCP plan.','QAM','{QAM}','ISO 22000 §8.5; CXC 1-1969 Ch.2','{X-01,STD-14,EV-36}',
       'Classification of holds: the raiser chooses quality / food safety / operational and the record is flagged pending OD-23.',
       'تصنيف الحجز: يختار رافع الحجز النوع ويُعلَّم السجل بانتظار OD-23.'),
      ('OD-24','critical','Phase 0','Hardware and infrastructure: devices, scanners, label printers, Wi-Fi coverage, scale outputs.',
       'الأجهزة والبنية التحتية: الماسحات وطابعات الملصقات وتغطية الشبكة ومخرجات الموازين','Phase 1 cannot start without it.','[]',
       'Survey in Phase 0.','IT + PHM','{ADM,PHM}','CP-13','{NFR-02,NFR-03,NFR-04,IB-04,CP-13}',
       'Device, scanner, printer and scale integration: none is built; IDs are typed or scanned into a text field and labels print from the browser.',
       'تكامل الأجهزة والماسحات والطابعات والموازين: لم يُبنَ؛ تُكتب الأرقام أو تُمسح في حقل نصي وتُطبع الملصقات من المتصفح.'),
      ('OD-25','critical','Phase 0','Build and hosting approach (in-house build with Claude Code, low-code platform, or vendor); hosting, backup, RPO/RTO.',
       'نهج البناء والاستضافة والنسخ الاحتياطي وأهداف الاستعادة','Cost, timeline and support model.','[]',
       'Decide after this specification is approved.','Top management + IT + Operations','{TOP,ADM}','—','{NFR-01,NFR-07,STD-25}',
       'Production deployment: this build is not production-ready.','النشر في بيئة الإنتاج: هذا الإصدار غير جاهز للإنتاج.'),
      ('OD-26','medium','Phase 1','User-interface language(s).','لغة واجهة المستخدم','Usability on the floor.',
       '[{"code":"A","en":"Arabic."},{"code":"B","en":"English."},{"code":"C","en":"Both, selectable per user."}]','Both, selectable per user.','PHM','{PHM}','—','{NFR-05}',
       'Nothing: the interface offers Arabic and English per user while the decision is open.','لا شيء: تتيح الواجهة العربية والإنجليزية لكل مستخدم حتى القرار.'),
      ('OD-27','medium','Phase 0','Pilot crop and pilot period.','المحصول والفترة التجريبية','Phase 1–3 scope.','[]',null,'PHM','{PHM}','—','{"12.1"}',
       'Pilot configuration.','إعداد التجربة.'),
      ('OD-28','medium','Phase 2','Mass-balance tolerance per crop; weekly weight-loss % per crop and its approver.','تحمّل موازنة الكتلة لكل محصول ونسبة فقد الوزن الأسبوعية ومعتمدها',
       'V-20, MB-04.','[]','Set from pilot data.','PHM + FIN','{PHM,FIN}','SOP-WS','{V-20,MB-01,MB-04,K6}',
       'Job Card reconciliation tolerance (milestone M2).','تحمّل تسوية بطاقات العمل (المرحلة M2).'),
      ('OD-29','medium','Phase 1','Weighing method (gross/tare/net); nominal kg per pallet; plausibility tolerance; status of Option 3 (49 boxes).',
       'طريقة الوزن (قائم/فارغ/صافٍ) والوزن الاسمي للطبلية وتحمّل المعقولية وحالة الخيار 3','V-02, V-21 (EV-31).','[]',
       'Weigh 20 pallets per crop in Phase 0.','PHM + WHM','{PHM,WHM}','FCT','{V-02,V-21,EV-31}',
       'Weight plausibility warning (V-21): no warning is computed until a tolerance is set; net kg is entered directly.',
       'تحذير معقولية الوزن (V-21): لا يُحسب حتى تحديد التحمّل؛ يُدخل الوزن الصافي مباشرة.'),
      ('OD-30','high','Phase 0','Crop master: identity of ''Blocky''; storage group per crop; washer-dryer crop list.',
       'سجل المحاصيل: هوية "Blocky" ومجموعة التخزين لكل محصول وقائمة محاصيل الغسالة','Storage rules and routes (EV-29).','[]',null,
       'PHM (+ QAM for storage groups)','{PHM,QAM}','SUM-1; SOP-PC; SUM-3 #5','{FR-MD-01,EV-29,V-07}',
       'The ''Blocky'' crop record stays unapproved and cannot be received.','يبقى سجل محصول "Blocky" غير معتمد ولا يمكن استلامه.'),
      ('OD-31','medium','Phase 1','External supplier produce: same flow? supplier lot reference? approval of suppliers?',
       'منتج الموردين الخارجيين: نفس المسار؟ مرجع لوط المورد؟ اعتماد الموردين؟','Receiving design (EV-27).','[]',null,
       'QAM + PHM (+ Procurement)','{QAM,PHM}','SOP-SR; SOP-TR','{EV-27,STD-06,FR-MD-05}',
       'Supplier approval: supplier loads can be recorded with a reference; approval status is not checked.',
       'اعتماد الموردين: تُسجّل شحنات الموردين مع مرجع؛ ولا يُتحقق من حالة الاعتماد.'),
      ('OD-32','medium','Phase 1','Fridge temperature reading interval; who records; identity and export capability of the computerised record.',
       'فترة قراءة حرارة الثلاجات ومن يسجلها وهوية السجل المحوسب','V-25; IB-03.','[]',null,'QAM + PHM','{QAM,PHM}','SOP-PC',
       '{V-25,FR-ST-04,IB-03,CP-16}','Temperature readings (cells pending; milestone M3).','قراءات الحرارة (صلاحيات معلّقة؛ المرحلة M3).'),
      ('OD-33','medium','Phase 4','Who logs complaints in the system (Sales or QA)?','من يسجل الشكاوى في النظام (المبيعات أم ضمان الجودة)؟','FR-TR-01.',
       '[{"code":"A","en":"Sales."},{"code":"B","en":"QA."}]','SAL.','SAL + QAM','{SAL,QAM}','SOP-CP','{FR-TR-01}',
       'Complaint intake (milestone M4).','استقبال الشكاوى (المرحلة M4).'),
      ('OD-34','low','Phase 4','Is labour productivity capture in scope?','هل قياس إنتاجية العمالة ضمن النطاق؟','K12; crew recording effort.',
       '[{"code":"A","en":"In scope from Phase 2."},{"code":"B","en":"Later."},{"code":"C","en":"Never."}]','Later, after core traceability works.',
       'PHM (+ HR)','{PHM}','SUM-2','{K12}','Labour productivity KPI.','مؤشر إنتاجية العمالة.'),
      ('OD-35','low','Phase 4','Assign the unlabelled labour values (230; 30).','تحديد قيم العمالة غير المعنونة (230؛ 30)',
       'Only if the labour module is in scope.','[]',null,'Owner of the productivity table (not named)','{}','SUM-3 #3','{K12}',
       'Nothing in scope. No owner role is named, so the decision cannot be recorded in the system.',
       'لا شيء ضمن النطاق. لم يُحدد مالك، فلا يمكن تسجيل القرار في النظام.'),
      ('OD-36','high','Phase 0','Current controlled revision of SOP001; who updates it to reference system records.',
       'المراجعة المعتمدة الحالية لدليل SOP001 ومن يحدّثه ليشير إلى سجلات النظام','Document control (EV-17).','[]',
       'QA document control issues one revision.','QAM + PHM','{QAM,PHM}','SOP','{EV-17}',
       'Nothing in the system (document control).','لا شيء في النظام (ضبط الوثائق).'),
      ('OD-37','high','Phase 3','Order source and format; who enters accepted lines; truck schedule input.',
       'مصدر الطلبات وصيغتها ومن يدخل البنود المقبولة وجدول الشاحنات','IB-05, IB-09; ST-00.',
       '[{"code":"A","en":"Sales enters."},{"code":"B","en":"PH planner enters."},{"code":"C","en":"Template upload."}]',
       'Sales enters; template upload as fallback.','SAL + PHM + LOG','{SAL,PHM,LOG}','SOP-FC; SOP-DS','{ST-00,FR-PL-01,IB-05,IB-09}',
       'Order intake (milestone M2).','استقبال الطلبات (المرحلة M2).'),
      ('OD-38','medium','Phase 1','Who inspects incoming vehicles and which ''top management'' role approves vehicle exceptions.',
       'من يفحص المركبات الواردة ومن يعتمد استثناءاتها من الإدارة العليا','FR-RC-02.','[]',null,'Top management + PHM + QAM','{TOP,PHM,QAM}','SOP-TR',
       '{FR-RC-02,ST-01,G1}','Recording incoming vehicle inspections (DEC / QAO cells pending), so arrivals cannot pass G1.',
       'تسجيل فحص المركبات الواردة (صلاحيات DEC / QAO معلّقة)، فلا تجتاز سجلات الوصول البوابة G1.'),
      ('OD-39','low','Phase 3','Loading-window enforcement: hard block or override.','تطبيق نافذة التحميل: منع أم تجاوز','V-15.',
       '[{"code":"A","en":"Block."},{"code":"B","en":"PHM override."}]','PHM override with reason.','PHM','{PHM}','SOP-DS','{V-15,FR-DS-08}',
       'Loading window (milestone M3).','نافذة التحميل (المرحلة M3).'),
      ('OD-40','low','Phase 2','Installed machine models (Ingro, ELIFAB, Aweta) and ELIFAB punnet-filling rate.',
       'طرازات الآلات المركبة (Ingro وELIFAB وAweta) ومعدل تعبئة ELIFAB','Equipment master and capacity (B-09).','[]','Record from nameplates.','PHM','{PHM}',
       'SUM-3 #1, #2','{EV-28,B-09}','Line rate data: rates not documented show "TBC".','بيانات معدلات الخطوط: تظهر المعدلات غير الموثقة "يُحدد لاحقاً".'),
      ('OD-41','medium','Phase 1','Access governance: review frequency, joiner/mover/leaver timing, idle timeout, dual-role (SoD-10) approvals.',
       'حوكمة الوصول: تكرار المراجعة وتوقيت الانضمام والنقل والمغادرة ومهلة الخمول وموافقات الأدوار المزدوجة','Section 6.6.','[]',
       'Quarterly review (proposed).','IT + department heads','{ADM,PHM,WHM,QCM,QAM}','ISO 27002 §5.18','{SoD-10,FR-AC-05,FR-AC-06}',
       'Dual-role exceptions (none allowed meanwhile: the conflicting step is refused) and access reviews.',
       'استثناءات الأدوار المزدوجة (لا يُسمح بأي منها حتى القرار) ومراجعات الوصول.')
    ) as d(code, pri, need, ten, tar, why, opts, rec, own, roles, src, dep, ben, bar)
$$;

create function app.seed_ph_parameters(p_farm uuid) returns void
language sql
as $$
  insert into public.ph_rule_parameters (farm_id, code, area, value_numeric, value_text, unit_code, evidence, basis_label, source,
                                         decision_code, label_en, label_ar, state, effective_from)
  select p_farm, p.code, p.area, p.num, p.txt, p.unit, p.ev, p.basis, p.src, p.od, p.en, p.ar, p.st, now()
    from (values
      ('last_harvest_receipt_time','operational',null::numeric,'17:00','time','C','SOP-documented','SOP-RC (17:00)',null::text,
       'Last harvest receipt; later arrivals are flagged and need a reason (V-03)','آخر موعد لاستلام الحصاد؛ ما بعده يُعلَّم ويتطلب سبباً (V-03)','in_effect'),
      ('precool_max_dwell_minutes','operational',30,null,'min','C','SOP-documented','SOP-PC; SOP-PF',null,
       'Pre-cooling dwell maximum; above it an alert goes to PHM (V-04)','الحد الأقصى لمدة التبريد الأولي؛ ما فوقه ينبه مدير بيت التعبئة (V-04)','in_effect'),
      ('precool_dwell_rule_table','quality',null,null,'min','NYV','Pending decision','SOP-PC (15–30 min by receiving temperature)','OD-07',
       'Dwell by receiving temperature (rule table)','مدة التبريد حسب حرارة الاستلام (جدول القواعد)','pending_decision'),
      ('grading_limit_hours','operational',24,null,'h','C','SOP-documented','SOP-PC',null,
       'Grade within this many hours of receiving; later = grading overdue (V-06)','الفرز خلال هذه الساعات من الاستلام؛ بعدها متأخر (V-06)','in_effect'),
      ('grading_alert_lead_hours','operational',null,null,'h','NYV','Pending decision','FR-PL-03 (example 20 h); OD-09','OD-09',
       'Early alert before the grading limit','تنبيه مسبق قبل حد الفرز','pending_decision'),
      ('fg_age_reason_hours','operational',48,null,'h','C','SOP-documented (clock start pending OD-09)','SOP-PC; SOP-PL','OD-09',
       'Age since harvest above which loading needs a reason (V-12)','العمر منذ القطف الذي يتطلب بعده التحميل سبباً (V-12)','in_effect'),
      ('fg_age_block_hours','operational',72,null,'h','C','SOP-documented','SOP-PC (''strictly not allowed'')',null,
       'Age since harvest above which loading is blocked (V-12)','العمر منذ القطف الذي يُمنع بعده التحميل (V-12)','in_effect'),
      ('qc_approval_validity_hours','quality',24,null,'h','C','SOP-documented','SOP-GR; SOP-DS',null,
       'Validity of a QC approval at dispatch (V-11)','صلاحية اعتماد الجودة عند الشحن (V-11)','in_effect'),
      ('waste_signoff_threshold_kg','operational',1000,null,'kg','C','SOP-documented (basis pending OD-11)','SOP-WS','OD-11',
       'Waste sign-off threshold (V-17)','حد توقيعات الهدر (V-17)','in_effect'),
      ('topmgmt_waste_timeout_hours','operational',24,null,'h','C','SOP-documented','SOP-WS',null,
       'Long-storage waste > 1 t removed if no top-management approval (E-20)','إزالة هدر التخزين الطويل > طن دون موافقة الإدارة العليا (E-20)','in_effect'),
      ('loading_window_start','operational',null,'09:00','time','C','SOP-documented','SOP-DS',null,
       'Loading window start (V-15)','بداية نافذة التحميل (V-15)','in_effect'),
      ('loading_window_end','operational',null,'01:00','time','C','SOP-documented','SOP-DS',null,
       'Loading window end (V-15)','نهاية نافذة التحميل (V-15)','in_effect'),
      ('complaint_validity_hours','quality',24,null,'h','C','SOP-documented','SOP-CP',null,
       'Complaint received later than this after delivery is proposed Invalid (V-18)','الشكوى بعد هذه المدة من التسليم تُقترح غير صالحة (V-18)','in_effect'),
      ('recall_start_hours','quality',6,null,'h','C','SOP-documented','SOP-CP',null,
       'Recall must start within this time for a health-risk incident (E-21)','يجب بدء الاستدعاء خلال هذه المدة لحالة خطر صحي (E-21)','in_effect'),
      ('complaint_resolution_hours','quality',24,null,'h','C','SOP-documented','SOP-CP',null,
       'Complaint investigation and resolution time (V-18)','مدة التحقيق في الشكوى وحلها (V-18)','in_effect'),
      ('shelf_life_keep_days_max','quality',14,null,'d','C','SOP-documented','SOP-GR (10–14 days)',null,
       'Shelf-life samples kept up to (X-04)','الاحتفاظ بعينات العمر التخزيني حتى (X-04)','in_effect'),
      ('weight_plausibility_tolerance_pct','operational',null,null,'%','NYV','Pending decision','FCT; EV-31','OD-29',
       'Weight plausibility tolerance vs nominal kg per pallet (V-21)','تحمّل معقولية الوزن مقارنة بالوزن الاسمي (V-21)','pending_decision'),
      ('late_entry_threshold_minutes','operational',null,null,'min','NYV','Pending decision','V-27','OD-16',
       'Gap between event and entry above which a record is flagged late (V-27)','الفارق بين الحدث والإدخال الذي يُعلَّم بعده السجل متأخراً (V-27)','pending_decision')
    ) as p(code, area, num, txt, unit, ev, basis, src, od, en, ar, st)
$$;

create function app.seed_ph_templates(p_farm uuid) returns void
language sql
as $$
  insert into public.ph_inspection_templates (farm_id, inspection_type, items, evidence, source, note, state)
  values
    (p_farm, 'arrival', '[
      {"code":"covered","en":"Covered on tractor","ar":"مغطاة على الجرار"},
      {"code":"palletised","en":"On pallets in acceptable crates","ar":"على طبالي وفي صناديق مقبولة"},
      {"code":"insects","en":"Insects / insect damage","ar":"حشرات / ضرر حشري"},
      {"code":"disease","en":"Disease","ar":"أمراض"},
      {"code":"temperature","en":"Temperature","ar":"درجة الحرارة"},
      {"code":"appearance","en":"General appearance","ar":"المظهر العام"},
      {"code":"foreign","en":"Foreign contamination","ar":"تلوث بمواد غريبة"},
      {"code":"freshness","en":"Freshness","ar":"الطزاجة"},
      {"code":"spec","en":"Conformance to raw-material specification","ar":"المطابقة لمواصفات المادة الخام"},
      {"code":"gr3_waste","en":"GR3 / waste in crates","ar":"درجة ثالثة / هدر في الصناديق"}]'::jsonb,
     'C', 'SOP-RC (10 items); FR-QG-07', 'Excessive visible waste → reject; destination mandatory (farm/supplier or waste area).', 'in_effect'),
    (p_farm, 'vehicle_in', '[
      {"code":"transport_conditions","en":"Vehicle conforms to the transport procedure (SOP-TR)","ar":"المركبة مطابقة لإجراء النقل (SOP-TR)"}]'::jsonb,
     'NYV', 'SOP-TR', 'The SOP-TR item list for incoming vehicles is not in the supplied documents; QA to supply. One overall item until then.', 'in_effect'),
    (p_farm, 'rma', '[
      {"code":"product_temp","en":"Product temperature","ar":"حرارة المنتج"},
      {"code":"disease","en":"Disease","ar":"أمراض"},
      {"code":"deformities","en":"Deformities","ar":"تشوهات"},
      {"code":"shape","en":"Shape","ar":"الشكل"},
      {"code":"size","en":"Size","ar":"الحجم"},
      {"code":"foreign","en":"Foreign matter / insects","ar":"مواد غريبة / حشرات"},
      {"code":"over_ripe","en":"Over-ripeness / softness","ar":"زيادة النضج / الطراوة"}]'::jsonb,
     'C', 'SOP-RC; SOP-GR', 'Sample size not documented (NYV). Acceptance basis ''mix GR1/GR2, minimum to 0 % waste'' (SOP). Tolerances: OD-05.', 'in_effect'),
    (p_farm, 'recheck', '[
      {"code":"product_temp","en":"Product temperature","ar":"حرارة المنتج"},
      {"code":"disease","en":"Disease","ar":"أمراض"},
      {"code":"deformities","en":"Deformities","ar":"تشوهات"},
      {"code":"shape","en":"Shape","ar":"الشكل"},
      {"code":"size","en":"Size","ar":"الحجم"},
      {"code":"foreign","en":"Foreign matter / insects","ar":"مواد غريبة / حشرات"},
      {"code":"over_ripe","en":"Over-ripeness / softness","ar":"زيادة النضج / الطراوة"}]'::jsonb,
     'C', 'SOP-RC', 'At most one recheck after regrade (V-26).', 'in_effect'),
    (p_farm, 'qc1', '[
      {"code":"quality_grading","en":"Quality and grading check","ar":"فحص الجودة والتدريج"}]'::jsonb,
     'NYV', 'SUM-1; SUM-3', 'Scope of QC-1 pending OD-17. Grade estimate % is a proposal (P).', 'in_effect')
$$;

create or replace function app.seed_phase_structure(p_farm uuid) returns void
language plpgsql as $$
begin
  perform app.seed_phase2_structure(p_farm);
  perform app.seed_task_workflow_v2(p_farm);
  perform app.seed_well_placeholders(p_farm);
  perform app.seed_hardening(p_farm);
  perform app.seed_ph_config(p_farm);
end $$;

-- Read access: packing-house role holders read configuration; writes only through server functions.
create policy ph_roles_select on public.ph_roles for select to authenticated using (app.is_farm_member(farm_id));
create policy ph_actions_select on public.ph_actions for select to authenticated using (app.is_farm_member(farm_id));
create policy ph_permission_cells_select on public.ph_permission_cells for select to authenticated using (app.is_farm_member(farm_id));
create policy ph_open_decisions_select on public.ph_open_decisions for select to authenticated using (app.is_farm_member(farm_id));
create policy ph_decision_approvals_select on public.ph_decision_approvals for select to authenticated using (app.is_farm_member(farm_id));
create policy ph_rule_parameters_select on public.ph_rule_parameters for select to authenticated using (app.is_farm_member(farm_id));
create policy ph_inspection_templates_select on public.ph_inspection_templates for select to authenticated using (app.is_farm_member(farm_id));

-- ---------------------------------------------------------------------------------------------
-- Decisions: an owner role records an option; each remaining owner role approves it; then it is in effect.
-- ---------------------------------------------------------------------------------------------
create function public.ph_record_decision(p_code text, p_option text, p_rationale text, p_activate_roles text[] default '{}',
                                          p_effective_from timestamptz default null, p_role text default null)
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_uid   uuid := app.current_user_id();
  v_farm  uuid;
  d       public.ph_open_decisions;
  v_role  text;
  v_left  text[];
  v_act   text[] := coalesce(p_activate_roles, '{}');
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;
  select d0.farm_id into v_farm from public.ph_open_decisions d0
   where d0.code = p_code and d0.voided_at is null and app.is_farm_member(d0.farm_id) limit 1;
  select * into d from public.ph_open_decisions where farm_id = v_farm and code = p_code and voided_at is null for update;
  if not found then
    raise exception 'Decision % not found', p_code using errcode = 'P0404';
  end if;
  if d.decision_state in ('decided', 'demo_assumption') then
    raise exception 'Decision % is already closed', p_code using errcode = 'P0422';
  end if;
  if cardinality(d.owner_roles) = 0 then
    raise exception 'No owner is named for %; it cannot be decided in the system', p_code
      using errcode = 'P0403', detail = jsonb_build_object('key', 'ph.decision.noOwner', 'decision', p_code)::text;
  end if;
  if coalesce(trim(p_rationale), '') = '' then
    raise exception 'A rationale is required' using errcode = 'P0422';
  end if;
  if coalesce(trim(p_option), '') = '' then
    raise exception 'Choose an option (or describe the decision taken)' using errcode = 'P0422';
  end if;
  if jsonb_array_length(d.options) > 0 and not exists (select 1 from jsonb_array_elements(d.options) o where o ->> 'code' = p_option) then
    raise exception 'Option % is not one of the options of %', p_option, p_code using errcode = 'P0422';
  end if;
  -- Roles whose pending (NYV) cells this decision activates must be among the roles the matrix leaves pending on it.
  if exists (select 1 from unnest(v_act) r
              where not exists (select 1 from public.ph_permission_cells c
                                 where c.farm_id = v_farm and c.decision_code = p_code and c.spec_code = r
                                   and c.state = 'pending_decision' and c.voided_at is null)) then
    raise exception 'This decision can only activate the cells the matrix leaves pending on %', p_code using errcode = 'P0422';
  end if;
  if d.decision_state = 'proposed' and (d.selected_option is distinct from p_option
                                or (select array_agg(x order by x) from unnest(d.activate_roles) x)
                                   is distinct from (select array_agg(x order by x) from unnest(v_act) x)) then
    raise exception 'Decision % was proposed as option % (activating %); approve that, or the proposer withdraws it', p_code,
      d.selected_option, array_to_string(d.activate_roles, ', ') using errcode = 'P0422';
  end if;

  -- One person signs for one owner role; a role is approved once.
  select r into v_role from unnest(app.ph_user_spec_roles(v_uid, v_farm)) r
   where r = any (d.owner_roles) and (p_role is null or r = p_role)
     and not exists (select 1 from public.ph_decision_approvals a
                      where a.decision_id = d.id and a.spec_code = r and a.voided_at is null)
   order by r limit 1;
  if v_role is null then
    raise exception 'You do not hold an owner role of % that still needs to approve (owners: %)', p_code, array_to_string(d.owner_roles, ', ')
      using errcode = 'P0403', detail = jsonb_build_object('key', 'ph.decision.notOwner', 'decision', p_code, 'owners', d.owner_roles)::text;
  end if;
  if exists (select 1 from public.ph_decision_approvals where decision_id = d.id and approved_by = v_uid and voided_at is null) then
    raise exception 'You have already approved %; another owner must approve the remaining roles', p_code
      using errcode = 'P0423', detail = jsonb_build_object('key', 'ph.decision.alreadySigned', 'decision', p_code)::text;
  end if;

  insert into public.ph_decision_approvals (farm_id, decision_id, spec_code, approved_by, option_code, comment)
  values (v_farm, d.id, v_role, v_uid, p_option, p_rationale);

  select coalesce(array_agg(r), '{}') into v_left from unnest(d.owner_roles) r
   where not exists (select 1 from public.ph_decision_approvals a where a.decision_id = d.id and a.spec_code = r and a.voided_at is null);

  perform set_config('app.audit_comment', p_rationale, true);
  update public.ph_open_decisions
     set decision_state = case when cardinality(v_left) = 0 then 'decided' else 'proposed' end,
         selected_option = p_option, activate_roles = v_act, rationale = coalesce(d.rationale, p_rationale),
         proposed_by = coalesce(d.proposed_by, v_uid), proposed_at = coalesce(d.proposed_at, now()),
         decided_at = case when cardinality(v_left) = 0 then now() end,
         effective_from = case when cardinality(v_left) = 0 then coalesce(p_effective_from, now()) end,
         config_version = case when cardinality(v_left) = 0 then app.ph_next(v_farm, 'config_version') end
   where id = d.id;
  if cardinality(v_left) = 0 then
    perform app.ph_apply_decision(v_farm, p_code);
  end if;
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('code', p_code, 'role', v_role, 'remaining', v_left,
                            'status', case when cardinality(v_left) = 0 then 'decided' else 'proposed' end);
end;
$$;
comment on function public.ph_record_decision is
  'An owner role of an open decision records (or approves) an option with a rationale, and names which roles receive the '
  'matrix cells left pending on it. In effect once every owner role has approved the same option and activation; one '
  'person signs for one role. Writes the approval record and audit.';

-- Effects of a closed decision: the NYV cells that name it are activated for the roles the decision lists.
create function app.ph_apply_decision(p_farm uuid, p_code text) returns void
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  d public.ph_open_decisions;
begin
  select * into d from public.ph_open_decisions where farm_id = p_farm and code = p_code and voided_at is null;
  update public.ph_permission_cells c
     set state = 'active', basis = case when d.decision_state = 'demo_assumption' then 'demo-' else '' end || p_code,
         resolved_at = now(), resolved_by = app.current_user_id()
   where c.farm_id = p_farm and c.decision_code = p_code and c.state = 'pending_decision' and c.voided_at is null
     and c.spec_code = any (d.activate_roles);
end;
$$;

-- Record-type owner approves a proposed (P) cell (spec §6.3 legend: "needs approval by the owner of the record type").
create function public.ph_approve_permission_cell(p_cell uuid, p_comment text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_uid   uuid := app.current_user_id();
  c       public.ph_permission_cells;
  v_owner text[];
begin
  select * into c from public.ph_permission_cells where id = p_cell and voided_at is null for update;
  if not found or not app.is_farm_member(c.farm_id) then
    raise exception 'Permission cell not found' using errcode = 'P0404';
  end if;
  if c.state <> 'proposed' then
    raise exception 'Only proposed cells are approved this way (this cell is %)', c.state using errcode = 'P0422';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'A comment is required' using errcode = 'P0422';
  end if;
  select owner_roles into v_owner from public.ph_actions where farm_id = c.farm_id and action_key = c.action_key and voided_at is null;
  if not (app.ph_user_spec_roles(v_uid, c.farm_id) && v_owner) then
    raise exception 'Only the owner of this record type (%) approves its permissions', array_to_string(v_owner, ', ')
      using errcode = 'P0403', detail = jsonb_build_object('key', 'ph.cell.notOwner', 'owners', v_owner)::text;
  end if;
  perform set_config('app.audit_comment', p_comment, true);
  update public.ph_permission_cells set state = 'active', basis = 'P-approved', resolved_by = v_uid, resolved_at = now()
   where id = p_cell;
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('id', p_cell, 'state', 'active');
end;
$$;

-- Effective permission of the signed-in user, for the UI (the database still checks every action).
create function public.ph_my_permissions() returns table (action_key text, basis text)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select a.action_key, app.ph_permission_basis(app.current_user_id(), a.farm_id, a.action_key)
    from public.ph_actions a
   where a.voided_at is null and app.is_farm_member(a.farm_id)
     and app.ph_permission_basis(app.current_user_id(), a.farm_id, a.action_key) is not null
$$;

select app.seed_ph_config(id) from public.farms;
select app.apply_api_grants();
