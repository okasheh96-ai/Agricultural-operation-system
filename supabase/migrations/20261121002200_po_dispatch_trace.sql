-- Packhouse operations, increment 3: dispatch (ST-13 / ST-14, SM-LD, FR-DS-01…10), holds on finished pallets, forward trace and
-- recall search (FR-TR-03), complaints (FR-TR-01/05), and the people a finished pallet came through (run / team level).
-- Owner instruction 2026-11-21 asks for dispatch and complaints, which is the owner starting M3/M4 (C-06). Every rule keeps its
-- spec label; the cells the spec leaves NYV (logger and seal, packing list, departure by DEC) stay unusable on a real farm until
-- the owner records a decision. The loading-window parameters contradict FR-DS-08's wording (C-09): the window is recorded and
-- flagged, never used to block.

set check_function_bodies = off;

-- =============================================================================================
-- 1. Finished-pallet workflow: the dispatch transitions declared in M2 (guard ph_fg_later) become usable through the server
--    functions below. Updating the guard in place is what the "later" guard was for; no pallet changes state by this.
-- =============================================================================================
create function app.seed_po_dispatch(p_farm uuid) returns void
language plpgsql
as $$
declare v uuid;
begin
  if exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'ph_load') then
    return;
  end if;
  -- A new finished-pallet workflow version: the dispatch moves declared in M2 (guard ph_fg_later) become usable through the server
  -- functions below, plus a hold from storage or allocation (QC/QA), re-inspection found during the load scan (V-11, by the
  -- loader) and a picked pallet returned to storage. Published versions are never edited; pallets made on an earlier version keep
  -- it (and stay out of dispatch, as declared then).
  if exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'ph_fg_pallet' and voided_at is null) then
    v := app.ph_clone_workflow_version(p_farm, 'ph_fg_pallet', 'PO-3: dispatch, finished-pallet holds (SM-FGP ST-12…ST-14)');
    update public.allowed_transitions set guard = 'ph_rpc'
     where workflow_version_id = v and guard = 'ph_fg_later'
       and (from_status, to_status) in (('in_storage', 'allocated'), ('allocated', 'in_storage'), ('allocated', 'picked'), ('picked', 'loaded'),
                                        ('picked', 'reinspection_required'), ('reinspection_required', 'picked'),
                                        ('reinspection_required', 'dispatch_rejected'), ('picked', 'cooling'), ('cooling', 'picked'),
                                        ('dispatch_rejected', 'on_hold'), ('on_hold', 'in_storage'), ('on_hold', 'waste'), ('loaded', 'dispatched'));
    insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action, guard, ph_action)
    values (p_farm, v, 'in_storage', 'on_hold', 'execute', 'ph_rpc', 'hold.raise'),
           (p_farm, v, 'allocated', 'on_hold', 'execute', 'ph_rpc', 'hold.raise'),
           (p_farm, v, 'picked', 'reinspection_required', 'execute', 'ph_rpc', 'load.pick'),
           (p_farm, v, 'picked', 'in_storage', 'execute', 'ph_rpc', 'load.create');
    perform app.activate_workflow_version(v);
  end if;

  perform app.define_workflow(p_farm, 'ph_load',
    '[{"code":"planned","ar":"مخطط","en":"Planned","initial":true,"sort":1},
      {"code":"vehicle_arrived","ar":"وصلت المركبة","en":"Vehicle arrived","sort":2},
      {"code":"waiting_for_temp","ar":"بانتظار الحرارة","en":"Waiting for temperature","sort":3},
      {"code":"vehicle_rejected","ar":"مركبة مرفوضة","en":"Vehicle rejected","terminal":true,"sort":4},
      {"code":"loading","ar":"قيد التحميل","en":"Loading","sort":5},
      {"code":"sealed","ar":"مختومة","en":"Sealed","sort":6},
      {"code":"packing_list_final","ar":"قائمة التعبئة نهائية","en":"Packing list final","sort":7},
      {"code":"departed","ar":"غادرت","en":"Departed","terminal":true,"sort":8},
      {"code":"cancelled","ar":"ملغاة","en":"Cancelled","terminal":true,"sort":9}]',
    '[{"from":"planned","to":"vehicle_arrived","action":"execute","ph":"load.vehicle_arrival","guard":"ph_rpc"},
      {"from":"planned","to":"cancelled","action":"close","ph":"load.cancel","guard":"ph_rpc","req":["comment"]},
      {"from":"vehicle_arrived","to":"loading","action":"verify","ph":"load.vehicle_inspection","guard":"ph_rpc"},
      {"from":"vehicle_arrived","to":"waiting_for_temp","action":"verify","ph":"load.vehicle_inspection","guard":"ph_rpc"},
      {"from":"vehicle_arrived","to":"vehicle_rejected","action":"verify","ph":"load.vehicle_inspection","guard":"ph_rpc","req":["comment"]},
      {"from":"waiting_for_temp","to":"loading","action":"verify","ph":"load.vehicle_inspection","guard":"ph_rpc"},
      {"from":"waiting_for_temp","to":"vehicle_rejected","action":"verify","ph":"load.vehicle_inspection","guard":"ph_rpc","req":["comment"]},
      {"from":"loading","to":"sealed","action":"execute","ph":"load.logger_seal","guard":"ph_rpc"},
      {"from":"sealed","to":"packing_list_final","action":"execute","ph":"load.finalise","guard":"ph_rpc"},
      {"from":"packing_list_final","to":"departed","action":"execute","ph":"load.finalise","guard":"ph_rpc"}]');

  perform app.define_workflow(p_farm, 'ph_complaint',
    '[{"code":"received","ar":"مستلمة","en":"Received","initial":true,"sort":1},
      {"code":"invalid","ar":"غير صالحة","en":"Not valid","terminal":true,"sort":2},
      {"code":"investigating","ar":"قيد التحقيق","en":"Investigating","sort":3},
      {"code":"confirmed","ar":"مؤكدة — إجراء تصحيحي","en":"Confirmed — corrective action","sort":4},
      {"code":"closed","ar":"مغلقة","en":"Closed","terminal":true,"sort":5}]',
    '[{"from":"received","to":"investigating","action":"verify","ph":"complaint.validity","guard":"ph_rpc"},
      {"from":"received","to":"invalid","action":"verify","ph":"complaint.validity","guard":"ph_rpc","req":["comment"]},
      {"from":"investigating","to":"confirmed","action":"approve","ph":"complaint.confirm","guard":"ph_rpc"},
      {"from":"investigating","to":"invalid","action":"approve","ph":"complaint.confirm","guard":"ph_rpc","req":["comment"]},
      {"from":"confirmed","to":"closed","action":"close","ph":"complaint.close","guard":"ph_rpc"}]');

  insert into public.ph_actions (farm_id, action_key, object_code, label_en, label_ar, owner_roles, milestone, source, sort_order, scope_kind, category)
  select p_farm, a.k, split_part(a.k, '.', 1), a.en, a.ar, a.own, 'PO-3', a.src, 950 + row_number() over (), 'farm', a.cat
    from (values
      ('load.vehicle_arrival', 'Record the dispatch vehicle''s arrival', 'تسجيل وصول مركبة الشحن', '{PHM}'::text[], 'SM-LD Figure 8.6 "Arrival (DEC)"', 'create'),
      ('load.cancel', 'Cancel a planned load', 'إلغاء حمولة مخططة', '{PHM}', 'SM-LD Figure 8.6 "Cancel (PHM)"', 'approve'),
      ('trace.recall_search', 'Run a forward trace / recall search', 'تشغيل تتبع أمامي / بحث استدعاء', '{QAM}', 'FR-TR-03', 'view')
    ) as a(k, en, ar, own, src, cat)
   where not exists (select 1 from public.ph_actions where farm_id = p_farm and action_key = a.k);
  insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
  select p_farm, m.k, m.r, 'P', 'proposed', 'P', m.note
    from (values ('load.vehicle_arrival', 'DEC', 'SM-LD state table names DEC.'), ('load.cancel', 'PHM', 'SM-LD state table names PHM.'),
                 ('trace.recall_search', 'QAM', 'FR-TR-03.'), ('trace.recall_search', 'QAO', null), ('trace.recall_search', 'QCM', null),
                 ('trace.recall_search', 'PHM', null)) as m(k, r, note)
   where not exists (select 1 from public.ph_permission_cells c where c.farm_id = p_farm and c.action_key = m.k and c.spec_code = m.r);
end;
$$;

-- =============================================================================================
-- 2. Tables
-- =============================================================================================
create table public.ph_loads (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null,
  customer_id              uuid references public.ph_customers(id),
  customer_text            text,
  destination              text,
  planned_loading_at       timestamptz,
  vehicle_plate            text,
  driver_name              text,
  vehicle_arrived_at       timestamptz,
  vehicle_check            jsonb,
  vehicle_temp_c           numeric(5,1),
  loading_started_at       timestamptz,
  outside_window           boolean,
  seal_number              text,
  logger_ids               text[],
  logger_note              text,
  packing_list             jsonb,
  departed_at              timestamptz,
  notes                    text,
  check (customer_id is not null or length(trim(coalesce(customer_text, ''))) > 0)
);
comment on table public.ph_loads is
  'Dispatch load (SM-LD, LD-YYMMDD-NNN): order lines and allocated finished pallets for one vehicle; vehicle inspection (G8), '
  'loading by scan, logger and seal (V-13), packing list from the scans (FR-DS-07) and departure (FR-DS-10).';
select app.register_table('public.ph_loads', 'ph_load', false, 'ph_load', p_default_policies => false);
create unique index ph_loads_code_uq on public.ph_loads (farm_id, code) where voided_at is null;

create table public.ph_load_lines (
  id             uuid primary key default gen_random_uuid(),
  load_id        uuid not null references public.ph_loads(id),
  order_line_id  uuid not null references public.ph_order_lines(id)
);
comment on table public.ph_load_lines is 'Order lines a load serves.';
select app.register_table('public.ph_load_lines', 'ph_load', false, p_default_policies => false);
create unique index ph_load_lines_uq on public.ph_load_lines (load_id, order_line_id) where voided_at is null;

create table public.ph_load_pallets (
  id               uuid primary key default gen_random_uuid(),
  load_id          uuid not null references public.ph_loads(id),
  fg_pallet_id     uuid not null references public.ph_fg_pallets(id),
  order_line_id    uuid references public.ph_order_lines(id),
  fifo_reason      text,
  picked_at        timestamptz,
  loaded_at        timestamptz,
  product_temp_c   numeric(5,1),
  removed_at       timestamptz,
  removed_reason   text,
  replacement_of   uuid references public.ph_load_pallets(id)
);
comment on table public.ph_load_pallets is
  'A finished pallet allocated to a load (FR-DS-01), picked, scanned onto the vehicle (FR-DS-02) or removed with a reason '
  '(re-inspection, dispatch rejection, change). Removed rows stay for the trace.';
select app.register_table('public.ph_load_pallets', 'ph_load', false, p_default_policies => false);
create unique index ph_load_pallets_active_uq on public.ph_load_pallets (fg_pallet_id) where voided_at is null and removed_at is null;
create index ph_load_pallets_load_idx on public.ph_load_pallets (load_id);

alter table public.ph_fg_pallets
  add column hold_id          uuid references public.ph_holds(id),
  add column held_from_status text;

-- Hold items: an incoming pallet or a finished pallet.
alter table public.ph_hold_items alter column pallet_id drop not null;
alter table public.ph_hold_items add column fg_pallet_id uuid references public.ph_fg_pallets(id);
alter table public.ph_hold_items add constraint ph_hold_items_one_subject check ((pallet_id is null) <> (fg_pallet_id is null));
create index ph_hold_items_fg_idx on public.ph_hold_items (fg_pallet_id);

create table public.ph_complaints (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  customer_id        uuid references public.ph_customers(id),
  customer_text      text,
  received_at        timestamptz not null,
  delivered_at       timestamptz,
  load_id            uuid references public.ph_loads(id),
  fg_pallet_ids      uuid[] not null default '{}',
  description        text not null check (length(trim(description)) > 0),
  late_flag          boolean not null default false,
  validity_note      text,
  investigation      text,
  root_cause         text,
  corrective_action  text,
  trace_snapshot     jsonb,
  closure_note       text,
  check (customer_id is not null or length(trim(coalesce(customer_text, ''))) > 0)
);
comment on table public.ph_complaints is
  'Customer complaint (FR-TR-01/05, CMP-YYMMDD-NNN): intake by Sales, validity by QC/QA (24 h rule V-18 flagged, not enforced), '
  'investigation with the trace kept as found, confirmation by the PHM, closure by the QAM. Recall authority is OD-22.';
select app.register_table('public.ph_complaints', 'ph_complaint', false, 'ph_complaint', p_default_policies => false);
create unique index ph_complaints_code_uq on public.ph_complaints (farm_id, code) where voided_at is null;

do $$
declare t text;
begin
  foreach t in array array['ph_loads', 'ph_load_lines', 'ph_load_pallets', 'ph_complaints'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.ph_is_member(farm_id))', t || '_select', t);
  end loop;
end $$;

-- =============================================================================================
-- 3. Helpers
-- =============================================================================================
create function app.ph_load(p_ref text) returns public.ph_loads
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_loads;
begin
  select * into r from public.ph_loads l
   where (l.id::text = p_ref or upper(l.code) = upper(trim(p_ref))) and l.voided_at is null and app.ph_is_member(l.farm_id);
  if not found then
    raise exception 'Load % not found', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'po.load.notFound', 'ref', p_ref)::text;
  end if;
  return r;
end;
$$;

create function app.ph_fg(p_ref text) returns public.ph_fg_pallets
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_fg_pallets;
begin
  select * into r from public.ph_fg_pallets f
   where (f.id::text = p_ref or upper(f.code) = upper(trim(p_ref))) and f.voided_at is null and app.ph_is_member(f.farm_id);
  if not found then
    raise exception 'Finished pallet % not found', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'po.fg.notFound', 'ref', p_ref)::text;
  end if;
  return r;
end;
$$;

-- A status change through the engine, answering with the new status (as the other packhouse functions do).
create function app.po_step(p_table text, p_id uuid, p_to text, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
begin
  return coalesce(app.ph_transition(p_table, p_id, p_to, p_comment), '{}') || jsonb_build_object('id', p_id, 'status', p_to);
end;
$$;

-- When the QC stamp of a finished pallet was given (split / merge children carry their source's stamp).
create function app.ph_fg_stamp_at(p_fg uuid) returns timestamptz
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with recursive s(id, stamp_from, at, depth) as (
    select id, qc_stamp_from, qc_approved_at, 0 from public.ph_fg_pallets where id = p_fg
    union all
    select f.id, f.qc_stamp_from, f.qc_approved_at, s.depth + 1 from public.ph_fg_pallets f join s on f.id = s.stamp_from where s.depth < 20
  )
  select at from s where at is not null order by depth limit 1
$$;

-- Earliest harvest age of a finished pallet in hours (V-12 uses it; clock start is OD-09).
create function app.ph_fg_age_hours(p_fg uuid) returns numeric
language sql stable security definer set search_path = public, app, pg_temp
as $$ select round(extract(epoch from now() - earliest_harvest_at) / 3600.0, 1) from public.ph_fg_pallets where id = p_fg $$;

-- Owner-defined checks attached to a hook point (the configuration engine fills this registry; empty means no extra checks).
create table app.po_hook_checks (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null,
  hook         text not null,
  check_fn     text not null,
  created_at   timestamptz not null default now()
);
alter table app.po_hook_checks enable row level security;
revoke all on app.po_hook_checks from public, anon, authenticated;
comment on table app.po_hook_checks is
  'Hook point → check function. Built-in workflows call app.po_hook_blockers(hook, record) before a protected step; each '
  'registered check returns the reasons that step must wait for (e.g. an owner-defined reinspection before dispatch).';

create function app.po_hook_blockers(p_farm uuid, p_hook text, p_record jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  h   app.po_hook_checks;
  r   jsonb;
  out jsonb := '[]';
begin
  for h in select * from app.po_hook_checks where farm_id = p_farm and hook = p_hook order by created_at loop
    execute format('select %s($1, $2)', h.check_fn) into r using p_farm, p_record;
    if r is not null and jsonb_array_length(r) > 0 then out := out || r; end if;
  end loop;
  return out;
end;
$$;

-- =============================================================================================
-- 4. Holds on finished pallets (QC / QA raise; QCM / QAM decide; same SM-NC record as incoming pallets)
-- =============================================================================================
create function public.ph_raise_fg_hold(p_type text, p_reason text, p_fg uuid[]) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm  uuid;
  v_id    uuid := gen_random_uuid();
  v_code  text;
  v_basis text;
  r       public.ph_fg_pallets;
begin
  if coalesce(cardinality(p_fg), 0) = 0 then raise exception 'Select at least one pallet (SM-NC: ≥1 item)' using errcode = 'P0422'; end if;
  select farm_id into v_farm from public.ph_fg_pallets where id = p_fg[1] and voided_at is null and app.ph_is_member(farm_id);
  if v_farm is null then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  v_basis := app.ph_authorize(v_farm, 'hold.raise');
  if p_type not in ('quality', 'food_safety', 'operational') then raise exception 'Unknown hold type' using errcode = 'P0422'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422'; end if;
  if p_type <> 'operational' and not (app.ph_user_spec_roles(app.current_user_id(), v_farm) && array['QCI', 'QAO']) then
    raise exception 'Quality and food-safety holds are raised by QC / QA' using errcode = 'P0403', detail = jsonb_build_object('key', 'ph.hold.typeRole')::text;
  end if;
  v_code := app.ph_code(v_farm, 'NC', 3);
  insert into public.ph_holds (id, farm_id, code, hold_type, type_basis, reason)
  values (v_id, v_farm, v_code, p_type,
          case when app.ph_decision_open(v_farm, 'OD-23') is null then 'OD-23 decided' else 'Chosen by raiser; classification pending OD-23' end,
          trim(p_reason));
  for r in select * from public.ph_fg_pallets where id = any (p_fg) loop
    if r.farm_id <> v_farm or r.status not in ('in_storage', 'allocated') then
      raise exception 'Pallet % cannot be held in status %', r.code, r.status using errcode = 'P0422',
        detail = jsonb_build_object('key', 'po.fg.holdState', 'pallet', r.code, 'status', r.status)::text;
    end if;
    insert into public.ph_hold_items (farm_id, hold_id, fg_pallet_id) values (v_farm, v_id, r.id);
    -- An allocated pallet leaves its load (the load keeps the removed row for the trace).
    update public.ph_load_pallets set removed_at = now(), removed_reason = 'Hold ' || v_code
     where fg_pallet_id = r.id and removed_at is null and voided_at is null;
    update public.ph_fg_pallets set hold_id = v_id, held_from_status = 'in_storage' where id = r.id;
    perform app.ph_transition('ph_fg_pallets', r.id, 'on_hold', p_reason);
  end loop;
  perform app.ph_notify_role(v_farm, case when p_type = 'food_safety' then 'QAM' else 'QCM' end, 'ph_hold_raised', 'ph_holds', v_id, jsonb_build_object('code', v_code));
  return jsonb_build_object('id', v_id, 'code', v_code, 'basis', v_basis);
end;
$$;

-- Hold steps: as M1, and a release / waste decision also moves held finished pallets (back to storage, or to waste).
create or replace function public.ph_hold_step(p_hold uuid, p_step text, p_note text default null, p_disposition text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  h     public.ph_holds;
  it    record;
  v_wr  uuid;
begin
  select * into h from public.ph_holds where id = p_hold and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Hold not found' using errcode = 'P0404'; end if;
  case p_step
    when 'assign' then
      return app.ph_transition('ph_holds', h.id, 'under_assessment', p_note);
    when 'decide' then
      if p_disposition not in ('release', 'waste') then
        raise exception 'Disposition % needs Job Cards or returns, built in a later milestone', coalesce(p_disposition, '?') using errcode = 'P0422',
          detail = jsonb_build_object('key', 'ph.hold.dispositionLater', 'disposition', p_disposition)::text;
      end if;
      if coalesce(trim(p_note), '') = '' then raise exception 'A disposition note is required' using errcode = 'P0422'; end if;
      perform app.ph_authorize(h.farm_id, case when h.hold_type = 'food_safety' then 'hold.decide_food_safety' else 'hold.decide_quality' end);
      update public.ph_holds set disposition = p_disposition, disposition_note = trim(p_note) where id = h.id;
      perform app.ph_transition('ph_holds', h.id, 'disposition_decided', p_note);
      for it in select i.id, p.id as pallet_id, p.status, p.held_from_status, p.crop_id, p.net_kg
                  from public.ph_hold_items i join public.ph_incoming_pallets p on p.id = i.pallet_id
                 where i.hold_id = h.id and i.voided_at is null and p.status = 'on_hold' loop
        if p_disposition = 'release' then
          perform app.ph_transition('ph_incoming_pallets', it.pallet_id, it.held_from_status, p_note);
          update public.ph_incoming_pallets set hold_id = null, held_from_status = null where id = it.pallet_id;
          update public.ph_hold_items set outcome = 'released' where id = it.id;
        else
          v_wr := app.ph_create_waste(h.farm_id, 'incoming_pallet', it.pallet_id, it.crop_id, it.net_kg, 'Hold ' || h.code || ' disposed as waste');
          update public.ph_incoming_pallets set waste_record_id = v_wr where id = it.pallet_id;
          perform app.ph_transition('ph_incoming_pallets', it.pallet_id, 'waste', p_note);
          update public.ph_hold_items set outcome = 'waste' where id = it.id;
        end if;
      end loop;
      for it in select i.id, f.id as fg_id, f.crop_id, f.net_kg
                  from public.ph_hold_items i join public.ph_fg_pallets f on f.id = i.fg_pallet_id
                 where i.hold_id = h.id and i.voided_at is null and f.status = 'on_hold' loop
        if p_disposition = 'release' then
          -- Release returns the pallet to storage (G9): only the authorised quality team (hold.release) may do this.
          perform app.ph_authorize(h.farm_id, 'hold.release');
          perform app.ph_transition('ph_fg_pallets', it.fg_id, 'in_storage', p_note);
          update public.ph_fg_pallets set hold_id = null, held_from_status = null where id = it.fg_id;
          update public.ph_hold_items set outcome = 'released' where id = it.id;
        else
          perform app.ph_create_waste(h.farm_id, 'fg_pallet', it.fg_id, it.crop_id, it.net_kg, 'Hold ' || h.code || ' disposed as waste');
          perform app.ph_transition('ph_fg_pallets', it.fg_id, 'waste', p_note);
          update public.ph_hold_items set outcome = 'waste' where id = it.id;
        end if;
      end loop;
      return jsonb_build_object('id', h.id, 'status', 'disposition_decided', 'disposition', p_disposition);
    when 'execute' then
      if coalesce(trim(p_note), '') = '' then raise exception 'Describe what was done' using errcode = 'P0422'; end if;
      update public.ph_holds set execution_note = trim(p_note) where id = h.id;
      return app.ph_transition('ph_holds', h.id, 'disposition_executed', p_note);
    when 'verify' then
      update public.ph_holds set verification_note = nullif(trim(p_note), '') where id = h.id;
      return app.ph_transition('ph_holds', h.id, 'verified', p_note);
    when 'close' then
      update public.ph_holds set closure_note = coalesce(nullif(trim(p_note), ''), 'CAPA: not linked') where id = h.id;
      return app.ph_transition('ph_holds', h.id, 'closed', p_note);
    when 'cancel' then
      if exists (select 1 from public.ph_hold_items i left join public.ph_incoming_pallets p on p.id = i.pallet_id
                   left join public.ph_fg_pallets f on f.id = i.fg_pallet_id
                  where i.hold_id = h.id and (p.status = 'on_hold' or f.status = 'on_hold')) then
        raise exception 'Release or dispose the held pallets through a disposition before cancelling' using errcode = 'P0422';
      end if;
      return app.ph_transition('ph_holds', h.id, 'cancelled', p_note);
    else
      raise exception 'Unknown hold step %', p_step using errcode = 'P0422';
  end case;
end;
$$;

-- =============================================================================================
-- 5. Loads: create & allocate (FIFO proposal), pick / load scan, vehicle check, product temperature, seal, packing list, departure
-- =============================================================================================
-- FIFO-eligible finished pallets for an order line: in storage, matching crop and grade, not held, within the QC validity and
-- the age block (V-11, V-12), oldest harvest first.
create function public.ph_fifo_proposal(p_order_line uuid) returns table (fg_pallet_id uuid, code text, net_kg numeric, box_count integer,
  location_code text, age_hours numeric, qc_age_hours numeric, rank integer)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select f.id, f.code, f.net_kg, f.box_count, l.code, app.ph_fg_age_hours(f.id),
         round(extract(epoch from now() - app.ph_fg_stamp_at(f.id)) / 3600.0, 1),
         (row_number() over (order by f.earliest_harvest_at nulls last, f.created_at))::int
    from public.ph_order_lines o
    join public.ph_fg_pallets f on f.farm_id = o.farm_id and f.crop_id in (select id from public.ph_crops c where c.farm_id = o.farm_id
                                                                         and c.code = (select code from public.ph_crops where id = o.crop_id))
    left join public.ph_locations l on l.id = f.location_id
   where o.id = p_order_line and app.ph_is_member(o.farm_id) and f.voided_at is null and f.status = 'in_storage' and f.grade = o.grade
     and coalesce(app.ph_fg_age_hours(f.id), 0) < coalesce(app.ph_param(o.farm_id, 'fg_age_block_hours'), 1e9)
$$;

create function public.ph_create_load(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_create_load');
  v_farm uuid := app.ph_farm_of_user();
  v_id   uuid := gen_random_uuid();
  v_code text;
  v_basis text;
  ol     uuid;
  v_cust uuid := nullif(p ->> 'customer_id', '')::uuid;
begin
  if v_seen is not null then return v_seen; end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  v_basis := app.ph_authorize(v_farm, 'load.create');
  if jsonb_array_length(coalesce(p -> 'order_line_ids', '[]')) = 0 then
    raise exception 'A load serves at least one accepted order line' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.noLines')::text;
  end if;
  if v_cust is not null and not app.ph_approved('ph_customers', v_cust, v_farm) then
    raise exception 'Customer not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'customer')::text;
  end if;
  v_code := app.ph_code(v_farm, 'LD', 3);
  insert into public.ph_loads (id, farm_id, code, customer_id, customer_text, destination, planned_loading_at, vehicle_plate, driver_name, notes)
  values (v_id, v_farm, v_code, v_cust, nullif(trim(p ->> 'customer_text'), ''), nullif(trim(p ->> 'destination'), ''),
          nullif(p ->> 'planned_loading_at', '')::timestamptz, nullif(trim(p ->> 'vehicle_plate'), ''), nullif(trim(p ->> 'driver_name'), ''),
          nullif(trim(p ->> 'notes'), ''));
  for ol in select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'order_line_ids') x loop
    if not exists (select 1 from public.ph_order_lines where id = ol and farm_id = v_farm and status = 'accepted' and voided_at is null) then
      raise exception 'Only accepted order lines can be loaded' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.lineNotAccepted')::text;
    end if;
    insert into public.ph_load_lines (farm_id, load_id, order_line_id) values (v_farm, v_id, ol);
  end loop;
  return app.ph_request_done(p_request_id, 'ph_create_load', v_farm, jsonb_build_object('id', v_id, 'code', v_code, 'basis', v_basis));
end;
$$;

-- Allocate a pallet to a load (FR-DS-01). Held, age-blocked or non-matching pallets are refused; a non-FIFO choice needs a reason.
create function public.ph_allocate_pallet(p_load uuid, p_fg text, p_order_line uuid default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  l       public.ph_loads := app.ph_load(p_load::text);
  f       public.ph_fg_pallets := app.ph_fg(p_fg);
  v_ol    uuid := coalesce(p_order_line, (select order_line_id from public.ph_load_lines where load_id = l.id and voided_at is null limit 1));
  v_rank  integer;
  v_age   numeric := app.ph_fg_age_hours(f.id);
begin
  perform app.ph_authorize(l.farm_id, 'load.create');
  if l.status not in ('planned', 'vehicle_arrived', 'waiting_for_temp', 'loading') then
    raise exception 'The load is %', l.status using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.state', 'status', l.status)::text;
  end if;
  if f.status = 'on_hold' or f.hold_id is not null then
    raise exception 'Pallet % is on hold: released only by the authorised quality team', f.code using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.fg.held', 'pallet', f.code)::text;
  end if;
  if f.status <> 'in_storage' then
    raise exception 'Pallet % is % and cannot be allocated', f.code, f.status using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.fg.notInStorage', 'pallet', f.code, 'status', f.status)::text;
  end if;
  if v_age is not null and v_age >= coalesce(app.ph_param(l.farm_id, 'fg_age_block_hours'), 1e9) then
    raise exception 'Pallet % is % h from harvest: loading is blocked (V-12)', f.code, v_age using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.fg.ageBlocked', 'pallet', f.code, 'hours', v_age)::text;
  end if;
  if v_ol is null or not exists (select 1 from public.ph_load_lines where load_id = l.id and order_line_id = v_ol and voided_at is null) then
    raise exception 'The order line is not on this load' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.lineNotOnLoad')::text;
  end if;
  if (select grade from public.ph_order_lines where id = v_ol) <> f.grade then
    raise exception 'Grade % does not match the order line', f.grade using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.gradeMismatch')::text;
  end if;
  select rank into v_rank from public.ph_fifo_proposal(v_ol) where fg_pallet_id = f.id;
  if v_rank is not null and v_rank > 1 and coalesce(trim(p_reason), '') = ''
     and exists (select 1 from public.ph_fifo_proposal(v_ol) x where x.rank < v_rank
                  and not exists (select 1 from public.ph_load_pallets lp where lp.fg_pallet_id = x.fg_pallet_id and lp.removed_at is null and lp.voided_at is null)) then
    raise exception 'An older pallet is available (FIFO): give a reason to load this one' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.load.fifoReason')::text;
  end if;
  insert into public.ph_load_pallets (farm_id, load_id, fg_pallet_id, order_line_id, fifo_reason)
  values (l.farm_id, l.id, f.id, v_ol, nullif(trim(p_reason), ''));
  perform app.ph_transition('ph_fg_pallets', f.id, 'allocated', 'Load ' || l.code);
  return jsonb_build_object('load', l.code, 'pallet', f.code, 'age_hours', v_age,
    'age_warning', v_age is not null and v_age >= coalesce(app.ph_param(l.farm_id, 'fg_age_reason_hours'), 1e9));
end;
$$;

create function public.ph_deallocate_pallet(p_load uuid, p_fg text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  l  public.ph_loads := app.ph_load(p_load::text);
  f  public.ph_fg_pallets := app.ph_fg(p_fg);
begin
  perform app.ph_authorize(l.farm_id, 'load.create');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if f.status not in ('allocated', 'picked') then
    raise exception 'Pallet % is %', f.code, f.status using errcode = 'P0422', detail = jsonb_build_object('key', 'po.fg.notAllocated')::text;
  end if;
  update public.ph_load_pallets set removed_at = now(), removed_reason = p_reason
   where load_id = l.id and fg_pallet_id = f.id and removed_at is null and voided_at is null;
  perform app.ph_transition('ph_fg_pallets', f.id, 'in_storage', p_reason);
  return jsonb_build_object('pallet', f.code, 'removed', true);
end;
$$;

-- Scan: first scan picks, second scan (with the vehicle loading) loads. V-11: a QC stamp older than the validity sends the pallet
-- to re-inspection instead of onto the vehicle.
create function public.ph_load_scan(p_load uuid, p_fg text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  l       public.ph_loads := app.ph_load(p_load::text);
  f       public.ph_fg_pallets := app.ph_fg(p_fg);
  lp      public.ph_load_pallets;
  v_valid numeric := app.ph_param(l.farm_id, 'qc_approval_validity_hours');
  v_qc    timestamptz := app.ph_fg_stamp_at(f.id);
begin
  perform app.ph_authorize(l.farm_id, 'load.pick');
  select * into lp from public.ph_load_pallets where load_id = l.id and fg_pallet_id = f.id and removed_at is null and voided_at is null;
  if f.status = 'on_hold' or f.hold_id is not null then
    raise exception 'Pallet % is on hold and cannot be dispatched', f.code using errcode = 'P0422', detail = jsonb_build_object('key', 'po.fg.held', 'pallet', f.code)::text;
  end if;
  if not found then
    raise exception 'Pallet % is not allocated to this load', f.code using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.notAllocated', 'pallet', f.code)::text;
  end if;
  if f.status = 'allocated' then
    update public.ph_load_pallets set picked_at = now() where id = lp.id;
    perform app.ph_transition('ph_fg_pallets', f.id, 'picked', 'Load ' || l.code);
    return jsonb_build_object('pallet', f.code, 'status', 'picked');
  elsif f.status = 'picked' then
    if l.status <> 'loading' then
      raise exception 'The vehicle has not passed its inspection (G8)' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.notLoading')::text;
    end if;
    if v_valid is not null and (v_qc is null or now() - v_qc > make_interval(hours => v_valid::int)) then
      perform app.ph_transition('ph_fg_pallets', f.id, 'reinspection_required', 'QC approval older than ' || v_valid || ' h (V-11)');
      perform app.ph_notify_role(l.farm_id, 'QCI', 'po_reinspection', 'ph_fg_pallets', f.id, jsonb_build_object('code', f.code, 'load', l.code));
      return jsonb_build_object('pallet', f.code, 'status', 'reinspection_required');
    end if;
    update public.ph_load_pallets set loaded_at = now() where id = lp.id;
    perform app.ph_transition('ph_fg_pallets', f.id, 'loaded', 'Load ' || l.code);
    return jsonb_build_object('pallet', f.code, 'status', 'loaded');
  end if;
  raise exception 'Pallet % is %', f.code, f.status using errcode = 'P0422', detail = jsonb_build_object('key', 'po.fg.notAllocated')::text;
end;
$$;

-- QC decision on a pallet that needs re-inspection (FR-DS-05): re-approve (stamp renewed) or reject (→ hold, replacement proposed).
create function public.ph_dispatch_recheck(p_fg text, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  f    public.ph_fg_pallets := app.ph_fg(p_fg);
  lp   public.ph_load_pallets;
  v_h  jsonb;
begin
  perform app.ph_authorize(f.farm_id, 'load.release_pallet');
  if f.status <> 'reinspection_required' then
    raise exception 'Pallet % is %', f.code, f.status using errcode = 'P0422', detail = jsonb_build_object('key', 'po.fg.notReinspection')::text;
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Record what was checked' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if p_decision = 'approve' then
    update public.ph_fg_pallets set qc_approved_at = now(), qc_stamp_from = null where id = f.id;
    perform app.ph_transition('ph_fg_pallets', f.id, 'picked', p_note);
    return jsonb_build_object('pallet', f.code, 'status', 'picked');
  elsif p_decision = 'reject' then
    perform app.ph_transition('ph_fg_pallets', f.id, 'dispatch_rejected', p_note);
    select * into lp from public.ph_load_pallets where fg_pallet_id = f.id and removed_at is null and voided_at is null;
    update public.ph_load_pallets set removed_at = now(), removed_reason = 'Dispatch rejected: ' || p_note where id = lp.id;
    return jsonb_build_object('pallet', f.code, 'status', 'dispatch_rejected', 'replacement', (select to_jsonb(x) from public.ph_fifo_proposal(lp.order_line_id) x
             where not exists (select 1 from public.ph_load_pallets y where y.fg_pallet_id = x.fg_pallet_id and y.removed_at is null and y.voided_at is null)
             order by x.rank limit 1));
  end if;
  raise exception 'Decision is approve or reject' using errcode = 'P0422';
end;
$$;

-- PHM / QC route a dispatch-rejected pallet into a hold (FR-DS-05 → SM-NC).
create function public.ph_dispatch_rejected_to_hold(p_fg text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  f     public.ph_fg_pallets := app.ph_fg(p_fg);
  v_id  uuid := gen_random_uuid();
  v_code text;
begin
  perform app.ph_authorize(f.farm_id, 'load.decide_rejected');
  if f.status <> 'dispatch_rejected' then
    raise exception 'Pallet % is %', f.code, f.status using errcode = 'P0422';
  end if;
  v_code := app.ph_code(f.farm_id, 'NC', 3);
  insert into public.ph_holds (id, farm_id, code, hold_type, type_basis, reason) values (v_id, f.farm_id, v_code, 'quality', 'Dispatch rejection (FR-DS-05)', p_reason);
  insert into public.ph_hold_items (farm_id, hold_id, fg_pallet_id) values (f.farm_id, v_id, f.id);
  update public.ph_fg_pallets set hold_id = v_id, held_from_status = 'in_storage' where id = f.id;
  perform app.ph_transition('ph_fg_pallets', f.id, 'on_hold', p_reason);
  return jsonb_build_object('hold', v_code);
end;
$$;

create function public.ph_load_step(p_load uuid, p_step text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  l        public.ph_loads := app.ph_load(p_load::text);
  v_items  jsonb;
  v_ok     boolean;
  v_temp   boolean;
  v_left   text[];
  v_block  jsonb;
  v_ws     text := app.ph_param_text(l.farm_id, 'loading_window_start');
  v_we     text := app.ph_param_text(l.farm_id, 'loading_window_end');
  v_t      time := (now() at time zone 'Asia/Amman')::time;
begin
  case p_step
  when 'arrive' then
    if coalesce(trim(p ->> 'vehicle_plate'), l.vehicle_plate, '') = '' then
      raise exception 'Record the vehicle plate' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.plate')::text;
    end if;
    update public.ph_loads set vehicle_arrived_at = now(), vehicle_plate = coalesce(nullif(trim(p ->> 'vehicle_plate'), ''), vehicle_plate),
           driver_name = coalesce(nullif(trim(p ->> 'driver_name'), ''), driver_name) where id = l.id;
    return app.po_step('ph_loads', l.id, 'vehicle_arrived', null);
  when 'inspect' then
    -- G8 (FR-DS-03): temperature, cleanliness, smell, contamination, lockable. A vehicle that cannot be locked never reaches Loading.
    v_items := coalesce(p -> 'items', '{}');
    v_ok := coalesce((v_items ->> 'clean')::boolean, false) and coalesce((v_items ->> 'no_smell')::boolean, false)
            and coalesce((v_items ->> 'no_contamination')::boolean, false) and coalesce((v_items ->> 'lockable')::boolean, false);
    v_temp := coalesce((v_items ->> 'temperature_ok')::boolean, false);
    update public.ph_loads set vehicle_check = v_items, vehicle_temp_c = nullif(p ->> 'temp_c', '')::numeric where id = l.id;
    if not v_ok then
      return app.po_step('ph_loads', l.id, 'vehicle_rejected', coalesce(nullif(trim(p ->> 'note'), ''), 'Vehicle check failed (G8)'));
    elsif not v_temp then
      return app.po_step('ph_loads', l.id, 'waiting_for_temp', 'Vehicle temperature not reached (V-14)');
    end if;
    update public.ph_loads set loading_started_at = now(),
           outside_window = case when v_ws is not null and v_we is not null
                                 then not (case when v_ws::time > v_we::time then v_t >= v_ws::time or v_t < v_we::time
                                                else v_t >= v_ws::time and v_t < v_we::time end) end
     where id = l.id;
    return app.po_step('ph_loads', l.id, 'loading', null);
  when 'product_temp' then
    perform app.ph_authorize(l.farm_id, 'load.product_temp');
    update public.ph_load_pallets set product_temp_c = (p ->> 'temp_c')::numeric
     where load_id = l.id and fg_pallet_id = (app.ph_fg(p ->> 'fg')).id and removed_at is null;
    return jsonb_build_object('recorded', true);
  when 'seal' then
    -- V-13: no departure without a seal number; the logger (scope OD-18) is recorded when present.
    if coalesce(trim(p ->> 'seal_number'), '') = '' then
      raise exception 'Record the seal number (V-13)' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.seal')::text;
    end if;
    if not exists (select 1 from public.ph_load_pallets where load_id = l.id and loaded_at is not null and removed_at is null and voided_at is null) then
      raise exception 'Nothing is loaded yet' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.empty')::text;
    end if;
    select array_agg(f.code) into v_left from public.ph_load_pallets lp join public.ph_fg_pallets f on f.id = lp.fg_pallet_id
     where lp.load_id = l.id and lp.removed_at is null and lp.voided_at is null and lp.loaded_at is null;
    if v_left is not null then
      raise exception 'Load or de-allocate these pallets first: %', array_to_string(v_left, ', ') using errcode = 'P0422',
        detail = jsonb_build_object('key', 'po.load.notAllLoaded', 'pallets', v_left)::text;
    end if;
    update public.ph_loads set seal_number = trim(p ->> 'seal_number'),
           logger_ids = coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'logger_ids', '[]'))), '{}'),
           logger_note = nullif(trim(p ->> 'logger_note'), '') where id = l.id;
    return app.po_step('ph_loads', l.id, 'sealed', null);
  when 'finalise' then
    update public.ph_loads set packing_list = (
      select jsonb_build_object('pallets', jsonb_agg(jsonb_build_object('code', f.code, 'grade', f.grade, 'boxes', f.box_count, 'net_kg', f.net_kg,
                                  'lots', (select coalesce(jsonb_agg(distinct lo.code), '[]') from public.ph_fg_pallet_lots x left join public.ph_lots lo on lo.id = x.lot_id where x.fg_pallet_id = f.id))
                                  order by f.code),
                                'total_kg', sum(f.net_kg), 'total_boxes', sum(f.box_count), 'seal', l.seal_number, 'loggers', to_jsonb(l.logger_ids))
        from public.ph_load_pallets lp join public.ph_fg_pallets f on f.id = lp.fg_pallet_id
       where lp.load_id = l.id and lp.loaded_at is not null and lp.removed_at is null and lp.voided_at is null)
     where id = l.id;
    return app.po_step('ph_loads', l.id, 'packing_list_final', null);
  when 'depart' then
    -- Owner-defined checks attached before dispatch (e.g. a customer-specific reinspection with an authorised release) must pass.
    v_block := app.po_hook_blockers(l.farm_id, 'dispatch.before_depart', to_jsonb(l));
    if jsonb_array_length(v_block) > 0 then
      raise exception 'Departure waits for: %', (select string_agg(x ->> 'label', '; ') from jsonb_array_elements(v_block) x)
        using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.hookBlocked', 'blockers', v_block)::text;
    end if;
    update public.ph_loads set departed_at = now() where id = l.id;
    perform app.ph_transition('ph_fg_pallets', lp.fg_pallet_id, 'dispatched', 'Load ' || l.code)
       from public.ph_load_pallets lp where lp.load_id = l.id and lp.loaded_at is not null and lp.removed_at is null and lp.voided_at is null;
    return app.po_step('ph_loads', l.id, 'departed', null);
  when 'cancel' then
    if exists (select 1 from public.ph_load_pallets where load_id = l.id and removed_at is null and voided_at is null) then
      raise exception 'De-allocate the pallets before cancelling' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.hasPallets')::text;
    end if;
    return app.po_step('ph_loads', l.id, 'cancelled', coalesce(p ->> 'reason', ''));
  end case;
  raise exception 'Unknown step' using errcode = 'P0422';
end;
$$;

create view public.ph_load_board with (security_invoker = true) as
  select l.id, l.farm_id, l.code, l.status, l.version, l.customer_id, coalesce(c.code, l.customer_text) as customer, l.destination,
         l.planned_loading_at, l.vehicle_plate, l.driver_name, l.vehicle_arrived_at, l.vehicle_temp_c, l.loading_started_at, l.outside_window,
         l.seal_number, l.logger_ids, l.departed_at, l.packing_list, l.created_at,
         (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'grade', o.grade, 'quantity', o.quantity)), '[]')
            from public.ph_load_lines ll join public.ph_order_lines o on o.id = ll.order_line_id where ll.load_id = l.id and ll.voided_at is null) as order_lines,
         (select coalesce(jsonb_agg(jsonb_build_object('fg_pallet_id', f.id, 'code', f.code, 'status', f.status, 'grade', f.grade, 'net_kg', f.net_kg,
                                    'boxes', f.box_count, 'picked_at', lp.picked_at, 'loaded_at', lp.loaded_at, 'product_temp_c', lp.product_temp_c,
                                    'fifo_reason', lp.fifo_reason, 'removed_at', lp.removed_at, 'removed_reason', lp.removed_reason) order by lp.created_at), '[]')
            from public.ph_load_pallets lp join public.ph_fg_pallets f on f.id = lp.fg_pallet_id where lp.load_id = l.id and lp.voided_at is null) as pallets,
         (select coalesce(sum(f.net_kg), 0) from public.ph_load_pallets lp join public.ph_fg_pallets f on f.id = lp.fg_pallet_id
           where lp.load_id = l.id and lp.removed_at is null and lp.voided_at is null) as allocated_kg
    from public.ph_loads l left join public.ph_customers c on c.id = l.customer_id
   where l.voided_at is null;

-- =============================================================================================
-- 6. Forward trace and recall search (FR-TR-03): from a source to stock, loads and customers, with kg attributed
-- =============================================================================================
create function public.ph_forward_trace(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_ips uuid[];
  v_fg0 uuid[];
  v_farm uuid := app.ph_farm_of_user();
begin
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  -- The source: a lot, an arrival, an incoming pallet, a source (block / supplier) code, or a finished pallet / Job Card.
  select array_agg(distinct p.id) into v_ips from public.ph_incoming_pallets p
    left join public.ph_arrivals a on a.id = p.arrival_id left join public.ph_lots l on l.id = p.lot_id
    left join public.ph_sources s on s.id = a.source_id
   where p.farm_id = v_farm and p.voided_at is null
     and (upper(p.code) = upper(trim(p_ref)) or upper(a.code) = upper(trim(p_ref)) or upper(l.code) = upper(trim(p_ref)) or upper(s.code) = upper(trim(p_ref)));
  select array_agg(f.id) into v_fg0 from public.ph_fg_pallets f
   where f.farm_id = v_farm and f.voided_at is null
     and (upper(f.code) = upper(trim(p_ref)) or f.job_card_id in (select id from public.ph_job_cards where upper(code) = upper(trim(p_ref)) and farm_id = v_farm));
  if v_ips is null and v_fg0 is null then
    raise exception 'Nothing found for %', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'ph.trace.notFound', 'ref', p_ref)::text;
  end if;
  return (
    with recursive
    direct as (   -- kg of the source in each finished pallet made directly from it
      select x.fg_pallet_id as id, sum(x.kg) as kg from public.ph_fg_pallet_lots x where x.pallet_id = any (coalesce(v_ips, '{}')) group by 1
      union all
      select f.id, f.net_kg from public.ph_fg_pallets f where f.id = any (coalesce(v_fg0, '{}'))
    ),
    tree(id, kg, depth) as (   -- through splits and merges, pro rata to the child's share of its parents
      select id, kg, 0 from direct
      union all
      select k.child_id, t.kg * (c.net_kg / nullif((select sum(pp.net_kg) from public.ph_fg_pallet_links kk join public.ph_fg_pallets pp on pp.id = kk.parent_id
                                                      where kk.change_id = k.change_id and kk.child_id = k.child_id), 0))
, t.depth + 1
        from tree t join public.ph_fg_pallet_links k on k.parent_id = t.id join public.ph_fg_pallets c on c.id = k.child_id
       where t.depth < 20
    ),
    leaf as (   -- pallets that still exist (not split / merged away), with the attributed kg
      select f.id, f.code, f.status, f.grade, f.net_kg, round(sum(t.kg), 2) as kg_from_source, lo.code as location,
             (select l.code from public.ph_load_pallets lp join public.ph_loads l on l.id = lp.load_id where lp.fg_pallet_id = f.id and lp.removed_at is null and lp.voided_at is null limit 1) as load_code,
             (select coalesce(c.code, l.customer_text) from public.ph_load_pallets lp join public.ph_loads l on l.id = lp.load_id left join public.ph_customers c on c.id = l.customer_id
               where lp.fg_pallet_id = f.id and lp.removed_at is null and lp.voided_at is null limit 1) as customer,
             (select l.departed_at from public.ph_load_pallets lp join public.ph_loads l on l.id = lp.load_id where lp.fg_pallet_id = f.id and lp.removed_at is null and lp.voided_at is null limit 1) as departed_at
        from tree t join public.ph_fg_pallets f on f.id = t.id left join public.ph_locations lo on lo.id = f.location_id
       where f.status <> 'split_merged'
       group by f.id, f.code, f.status, f.grade, f.net_kg, lo.code
    )
    select jsonb_build_object(
      'query', p_ref,
      'source_pallets', (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'net_kg', p.net_kg, 'status', p.status) order by p.code), '[]')
                           from public.ph_incoming_pallets p where p.id = any (coalesce(v_ips, '{}'))),
      'fg_pallets', (select coalesce(jsonb_agg(to_jsonb(leaf) order by leaf.code), '[]') from leaf),
      'loads', (select coalesce(jsonb_agg(distinct jsonb_build_object('code', load_code, 'customer', customer, 'departed_at', departed_at)), '[]') from leaf where load_code is not null),
      'customers', (select coalesce(jsonb_agg(distinct customer), '[]') from leaf where customer is not null and departed_at is not null),
      'totals', jsonb_build_object(
        'source_kg', case when v_ips is not null then (select sum(net_kg) from public.ph_incoming_pallets where id = any (v_ips)) end,
        'dispatched_kg', (select coalesce(sum(kg_from_source), 0) from leaf where status = 'dispatched'),
        'held_kg', (select coalesce(sum(kg_from_source), 0) from leaf where status in ('on_hold', 'reinspection_required', 'dispatch_rejected', 'age_blocked')),
        'in_stock_kg', (select coalesce(sum(kg_from_source), 0) from leaf where status in ('in_storage', 'qc_approved', 'created')),
        'on_loads_kg', (select coalesce(sum(kg_from_source), 0) from leaf where status in ('allocated', 'picked', 'loaded'))),
      'attribution', 'Kilograms are attributed through the recorded composition (exact, time window or proportional per Job Card) and pro rata through splits and merges.'
    )
  );
end;
$$;

-- Recall search: everything from the given sources (lot / arrival / pallet / source codes), one forward trace per code, summed.
create function public.ph_recall_search(p_refs text[]) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  r     text;
  res   jsonb := '[]';
  v_farm uuid := app.ph_farm_of_user();
begin
  perform app.ph_authorize(v_farm, 'trace.recall_search');
  foreach r in array coalesce(p_refs, '{}') loop
    begin
      res := res || jsonb_build_array(public.ph_forward_trace(r));
    exception when sqlstate 'P0404' then
      res := res || jsonb_build_array(jsonb_build_object('query', r, 'not_found', true));
    end;
  end loop;
  return jsonb_build_object('results', res,
    'customers', (select coalesce(jsonb_agg(distinct c), '[]') from jsonb_array_elements(res) x, jsonb_array_elements_text(coalesce(x -> 'customers', '[]')) c),
    'held_kg', (select coalesce(sum((x -> 'totals' ->> 'held_kg')::numeric), 0) from jsonb_array_elements(res) x),
    'in_stock_kg', (select coalesce(sum((x -> 'totals' ->> 'in_stock_kg')::numeric), 0) from jsonb_array_elements(res) x),
    'dispatched_kg', (select coalesce(sum((x -> 'totals' ->> 'dispatched_kg')::numeric), 0) from jsonb_array_elements(res) x));
end;
$$;

-- Who worked on the line while a finished pallet's Job Card ran: run / team level, never a claim that one person packed it.
create function public.ph_trace_people(p_fg text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  f   public.ph_fg_pallets := app.ph_fg(p_fg);
  jc  public.ph_job_cards;
  v_from timestamptz;
  v_to   timestamptz;
begin
  select * into jc from public.ph_job_cards where id = f.job_card_id;
  select min(server_received_at) into v_from from public.record_transitions where entity_type = 'ph_job_cards' and entity_id = jc.id and to_status = 'in_progress';
  v_to := coalesce(jc.completed_at, f.created_at);
  return jsonb_build_object(
    'pallet', f.code, 'job_card', jc.code, 'line', (select code from public.ph_lines where id = jc.line_id), 'from', v_from, 'to', v_to,
    'attribution', 'run_or_team',
    'shifts', (select coalesce(jsonb_agg(distinct s.code), '[]') from public.ph_line_shifts ls join public.ph_shifts s on s.id = ls.shift_id
                where ls.line_id = jc.line_id and ls.voided_at is null and s.planned_start < coalesce(v_to, now()) and s.planned_end > coalesce(v_from, f.created_at - interval '12 hours')),
    'workers', case when app.ph_can(f.farm_id, 'labour.view_people', jc.line_id) then
                 (select coalesce(jsonb_agg(distinct jsonb_build_object('code', w.code, 'name', w.full_name)), '[]')
                    from public.ph_labour_intervals li join public.ph_line_shifts ls on ls.id = li.line_shift_id join public.workers w on w.id = li.worker_id
                    join public.ph_task_kinds k on k.id = li.task_kind_id and k.counts_as_packing
                   where ls.line_id = jc.line_id and li.voided_at is null and li.started_at < coalesce(v_to, now())
                     and coalesce(li.ended_at, 'infinity') > coalesce(v_from, f.created_at - interval '12 hours'))
               else null end,
    'workers_restricted', not app.ph_can(f.farm_id, 'labour.view_people', jc.line_id));
end;
$$;

-- =============================================================================================
-- 7. Complaints
-- =============================================================================================
create function public.ph_create_complaint(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_create_complaint');
  v_farm uuid := app.ph_farm_of_user();
  v_id   uuid := gen_random_uuid();
  v_code text;
  v_load uuid;
  v_late boolean;
  v_del  timestamptz := nullif(p ->> 'delivered_at', '')::timestamptz;
begin
  if v_seen is not null then return v_seen; end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  perform app.ph_authorize(v_farm, 'complaint.create');
  if coalesce(trim(p ->> 'description'), '') = '' then
    raise exception 'Describe the complaint' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.complaint.description')::text;
  end if;
  if (p ->> 'load') is not null then v_load := (app.ph_load(p ->> 'load')).id; end if;
  v_late := v_del is not null and now() - v_del > make_interval(hours => coalesce(app.ph_param(v_farm, 'complaint_validity_hours'), 1e6)::int);
  v_code := app.ph_code(v_farm, 'CMP', 3);
  insert into public.ph_complaints (id, farm_id, code, customer_id, customer_text, received_at, delivered_at, load_id, fg_pallet_ids, description, late_flag)
  values (v_id, v_farm, v_code, nullif(p ->> 'customer_id', '')::uuid, nullif(trim(p ->> 'customer_text'), ''), now(), v_del, v_load,
          coalesce(array(select (app.ph_fg(x #>> '{}')).id from jsonb_array_elements(coalesce(p -> 'fg_pallets', '[]')) x), '{}'),
          trim(p ->> 'description'), v_late);
  perform app.ph_notify_role(v_farm, 'QCI', 'po_complaint', 'ph_complaints', v_id, jsonb_build_object('code', v_code));
  perform app.ph_notify_role(v_farm, 'QAO', 'po_complaint', 'ph_complaints', v_id, jsonb_build_object('code', v_code));
  return app.ph_request_done(p_request_id, 'ph_create_complaint', v_farm, jsonb_build_object('id', v_id, 'code', v_code, 'late_flag', v_late));
end;
$$;

create function public.ph_complaint_step(p_complaint uuid, p_step text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  c     public.ph_complaints;
  v_ref text;
begin
  select * into c from public.ph_complaints where id = p_complaint and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Complaint not found' using errcode = 'P0404'; end if;
  case p_step
  when 'valid' then
    update public.ph_complaints set validity_note = nullif(trim(p ->> 'note'), '') where id = c.id;
    return app.po_step('ph_complaints', c.id, 'investigating', p ->> 'note');
  when 'invalid' then
    update public.ph_complaints set validity_note = trim(p ->> 'note') where id = c.id;
    return app.po_step('ph_complaints', c.id, 'invalid', p ->> 'note');
  when 'investigate' then
    perform app.ph_authorize(c.farm_id, 'complaint.investigate');
    v_ref := coalesce((select code from public.ph_loads where id = c.load_id), (select code from public.ph_fg_pallets where id = c.fg_pallet_ids[1]));
    update public.ph_complaints set investigation = nullif(trim(p ->> 'investigation'), ''), root_cause = nullif(trim(p ->> 'root_cause'), ''),
           trace_snapshot = case when v_ref is not null then public.ph_backward_trace(coalesce((select code from public.ph_fg_pallets where id = c.fg_pallet_ids[1]),
                                    (select f.code from public.ph_load_pallets lp join public.ph_fg_pallets f on f.id = lp.fg_pallet_id where lp.load_id = c.load_id and lp.removed_at is null limit 1)))
                                 else trace_snapshot end
     where id = c.id;
    return jsonb_build_object('id', c.id, 'investigation', true);
  when 'confirm' then
    if coalesce(trim(p ->> 'corrective_action'), '') = '' then
      raise exception 'Record the corrective action' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.complaint.capa')::text;
    end if;
    update public.ph_complaints set corrective_action = trim(p ->> 'corrective_action'), root_cause = coalesce(nullif(trim(p ->> 'root_cause'), ''), root_cause) where id = c.id;
    return app.po_step('ph_complaints', c.id, 'confirmed', p ->> 'note');
  when 'close' then
    update public.ph_complaints set closure_note = nullif(trim(p ->> 'note'), '') where id = c.id;
    return app.po_step('ph_complaints', c.id, 'closed', p ->> 'note');
  end case;
  raise exception 'Unknown step' using errcode = 'P0422';
end;
$$;

create view public.ph_complaint_board with (security_invoker = true) as
  select c.id, c.farm_id, c.code, c.status, c.version, coalesce(cu.code, c.customer_text) as customer, c.received_at, c.delivered_at, c.late_flag,
         l.code as load_code, c.description, c.validity_note, c.investigation, c.root_cause, c.corrective_action, c.closure_note,
         (select coalesce(jsonb_agg(f.code), '[]') from public.ph_fg_pallets f where f.id = any (c.fg_pallet_ids)) as fg_pallets
    from public.ph_complaints c left join public.ph_customers cu on cu.id = c.customer_id left join public.ph_loads l on l.id = c.load_id
   where c.voided_at is null;

-- Order lines take the customer master and a pack format (OD-06 still decides spec ownership; the free text stays for history).
create or replace function public.ph_set_order_line_refs(p_line uuid, p_customer uuid, p_pack uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare o public.ph_order_lines := app.ph_order_line(p_line::text);
begin
  perform app.ph_authorize(o.farm_id, 'customer_order.create');
  if p_customer is not null and not app.ph_approved('ph_customers', p_customer, o.farm_id) then
    raise exception 'Customer not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'customer')::text;
  end if;
  if p_pack is not null and not app.ph_approved('ph_pack_formats', p_pack, o.farm_id) then
    raise exception 'Pack format not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'pack format')::text;
  end if;
  update public.ph_order_lines set customer_id = coalesce(p_customer, customer_id), pack_format_id = coalesce(p_pack, pack_format_id) where id = o.id;
  return jsonb_build_object('id', o.id);
end;
$$;


-- Chronological timeline for the trace screen: every status change the engine recorded for the incoming pallets, Job Cards,
-- finished pallets (incl. split / merge parents and children) and loads connected to the searched code, with who and when.
create function public.ph_trace_timeline(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  b    jsonb;
  f    jsonb;
  ids  uuid[] := '{}';
  v_farm uuid := app.ph_farm_of_user();
begin
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  begin b := public.ph_backward_trace(p_ref); exception when sqlstate 'P0404' then b := null; end;
  begin f := public.ph_forward_trace(p_ref); exception when sqlstate 'P0404' then f := null; end;
  if b is null and f is null then
    raise exception 'Nothing found for %', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'ph.trace.notFound', 'ref', p_ref)::text;
  end if;
  ids := ids || coalesce(array(select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(b -> 'pallets', '[]')) x), '{}')
             || coalesce(array(select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(b -> 'job_cards', '[]')) x), '{}')
             || coalesce(array(select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(b -> 'fg_pallets', '[]')) x), '{}')
             || coalesce(array(select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(f -> 'fg_pallets', '[]')) x), '{}');
  ids := ids || coalesce(array(select distinct lp.load_id from public.ph_load_pallets lp where lp.fg_pallet_id = any (ids) and lp.voided_at is null), '{}');
  return jsonb_build_object(
    'query', p_ref,
    'backward', b,
    'forward', f,
    'events', (select coalesce(jsonb_agg(e order by e ->> 'at'), '[]') from (
        select jsonb_build_object('at', t.server_received_at, 'entity_type', t.entity_type, 'entity_id', t.entity_id,
               'code', coalesce(ip.code, jc.code, fg.code, ld.code), 'from', t.from_status, 'to', t.to_status, 'comment', t.comment,
               'by', u.full_name) as e
          from public.record_transitions t
          left join public.ph_incoming_pallets ip on t.entity_type = 'ph_incoming_pallets' and ip.id = t.entity_id
          left join public.ph_job_cards jc on t.entity_type = 'ph_job_cards' and jc.id = t.entity_id
          left join public.ph_fg_pallets fg on t.entity_type = 'ph_fg_pallets' and fg.id = t.entity_id
          left join public.ph_loads ld on t.entity_type = 'ph_loads' and ld.id = t.entity_id
          left join public.user_profiles u on u.id = t.actor_user_id
         where t.farm_id = v_farm and t.entity_id = any (ids)
        union all
        select jsonb_build_object('at', x.created_at, 'entity_type', 'created:' || x.kind, 'entity_id', x.id, 'code', x.code, 'from', null, 'to', 'created',
               'qty', x.kg, 'by', (select full_name from public.user_profiles where id = x.created_by))
          from (select id, code, created_at, created_by, net_kg as kg, 'ph_incoming_pallets' as kind from public.ph_incoming_pallets where id = any (ids)
                union all select id, code, created_at, created_by, net_kg, 'ph_fg_pallets' from public.ph_fg_pallets where id = any (ids)
                union all select id, code, created_at, created_by, null, 'ph_job_cards' from public.ph_job_cards where id = any (ids)
                union all select id, code, created_at, created_by, null, 'ph_loads' from public.ph_loads where id = any (ids)) x
      ) q),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'parent', p.code, 'parent_kg', p.net_kg, 'child', c.code, 'child_kg', c.net_kg,
                                                            'change', ch.code, 'at', ch.decided_at) order by ch.decided_at), '[]')
                from public.ph_fg_pallet_links k join public.ph_fg_pallets p on p.id = k.parent_id join public.ph_fg_pallets c on c.id = k.child_id
                join public.ph_fg_changes ch on ch.id = k.change_id
               where k.voided_at is null and (k.parent_id = any (ids) or k.child_id = any (ids)))
  );
end;
$$;

create or replace function app.seed_phase_structure(p_farm uuid) returns void
language plpgsql as $$
begin
  perform app.seed_phase2_structure(p_farm);
  perform app.seed_task_workflow_v2(p_farm);
  perform app.seed_well_placeholders(p_farm);
  perform app.seed_hardening(p_farm);
  perform app.seed_ph_config(p_farm);
  perform app.seed_ph_receiving(p_farm);
  perform app.seed_ph_production(p_farm);
  perform app.seed_ph_waste_reconciliation(p_farm);
  perform app.seed_ph_orders_plan(p_farm);
  perform app.seed_po_shift_core(p_farm);
  perform app.seed_po_dispatch(p_farm);
end $$;

select app.seed_po_dispatch(id) from public.farms;
select app.apply_api_grants();
