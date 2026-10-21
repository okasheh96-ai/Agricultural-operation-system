-- Packing house milestone M2, increment 3: order lines and the daily production plan (ST-00, FR-PL-01…04), Job Cards for an
-- accepted order line (V-10), and finished-pallet split / merge with PHM approval (FR-FG-04/05, GEN-07/08, V-22).
-- Documented (C): Sales enters orders and PH management accepts or rejects them with a reason (SOP-FC); the shortage notice
-- windows 24 h local / 48 h export (SOP-FC); market types export / local / retail / LSS. Proposed (P) and therefore refused
-- on a real farm until the record-type owner approves the cell: amend / cancel, split / merge and its approval. Open: the
-- order source and format and planner keying (OD-37), customer specification ownership (OD-06), customer master (FR-MD-04).

set check_function_bodies = off;

-- ---------------------------------------------------------------------------------------------
-- Order lines (ST-00)
-- ---------------------------------------------------------------------------------------------
create table public.ph_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  customer_name      text not null check (length(trim(customer_name)) > 0),
  customer_spec_ref  text,
  crop_id            uuid not null references public.ph_crops(id),
  grade              text not null check (grade in ('premium', 'gr1', 'gr2')),
  pack_spec          text not null check (length(trim(pack_spec)) > 0),
  quantity           numeric(12,2) not null check (quantity > 0),
  quantity_unit_id   uuid not null references public.units(id),
  required_date      date not null,
  market_type        text not null check (market_type in ('export', 'local', 'retail', 'lss')),
  forecast_ref       text,
  notes              text,
  decided_by         uuid references auth.users(id),
  decided_at         timestamptz,
  decision_reason    text,
  shortage_by        uuid references auth.users(id),
  shortage_at        timestamptz,
  shortage_note      text,
  shortage_in_window boolean
);
comment on table public.ph_order_lines is
  'Customer order line (ST-00, OL-YYMMDD-NNNN): entered by Sales (SOP-FC; planner keying on Sales'' behalf is OD-37), '
  'accepted or rejected with a reason by PH management (SOP-FC). The customer is the name Sales gives: the customer master '
  'and specification ownership are not decided (FR-MD-04, OD-06), so nothing about a customer is invented here.';
select app.register_table('public.ph_order_lines', 'ph_order_line', false, 'ph_order_line', p_default_policies => false);
create unique index ph_order_lines_code_uq on public.ph_order_lines (farm_id, code) where voided_at is null;

alter table public.ph_job_cards add column order_line_id uuid references public.ph_order_lines(id);
create index ph_job_cards_order_idx on public.ph_job_cards (order_line_id);

-- A pallet made by a split or merge carries the QC stamp of the pallet it came from: the stamp time is copied so the 24 h
-- validity (CP-06) does not restart, and the person is read through this reference (actor columns are written only by steps).
alter table public.ph_fg_pallets add column qc_stamp_from uuid references public.ph_fg_pallets(id);
comment on column public.ph_fg_pallets.qc_stamp_from is
  'Split / merge child: the originally stamped pallet whose QC approval (person and time) this pallet carries.';

-- ---------------------------------------------------------------------------------------------
-- Finished-pallet split / merge requests (FR-FG-04/05): PHO requests, PHM approves; approval executes.
-- ---------------------------------------------------------------------------------------------
create table public.ph_fg_changes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  kind            text not null check (kind in ('split', 'merge')),
  parent_ids      uuid[] not null check (cardinality(parent_ids) >= 1),
  children        jsonb not null default '[]',
  reason          text not null check (length(trim(reason)) > 0),
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  decision_reason text,
  result_ids      uuid[] not null default '{}'
);
comment on table public.ph_fg_changes is
  'Split or merge of finished pallets (GEN-07/08, FGC-YYMMDD-NNNN): requested by the operator with the quantities, approved '
  'by the PHM (a different person); approval closes the parents and creates the new pallets with inherited composition.';
select app.register_table('public.ph_fg_changes', 'ph_fg_change', false, 'ph_fg_change', p_default_policies => false);
create unique index ph_fg_changes_code_uq on public.ph_fg_changes (farm_id, code) where voided_at is null;

create table public.ph_fg_pallet_links (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid not null references public.ph_fg_pallets(id),
  child_id   uuid not null references public.ph_fg_pallets(id),
  change_id  uuid not null references public.ph_fg_changes(id),
  kind       text not null check (kind in ('split', 'merge'))
);
comment on table public.ph_fg_pallet_links is 'Parent → child finished pallets through a split or merge, so a trace passes through them.';
select app.register_table('public.ph_fg_pallet_links', 'ph_fg_change', false, p_default_policies => false);
create index ph_fg_pallet_links_parent_idx on public.ph_fg_pallet_links (parent_id);
create index ph_fg_pallet_links_child_idx on public.ph_fg_pallet_links (child_id);
create trigger ph_fg_pallet_links_append_only before update on public.ph_fg_pallet_links for each row execute function app.ph_append_only();

do $$
declare t text;
begin
  foreach t in array array['ph_order_lines', 'ph_fg_changes', 'ph_fg_pallet_links'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.ph_is_member(farm_id))', t || '_select', t);
  end loop;
end $$;

create function app.guard_ph_fg_child(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and exists (select 1 from public.ph_fg_pallet_links l where l.child_id = (r ->> 'id')::uuid and l.voided_at is null) $$;

create function app.seed_ph_orders_plan(p_farm uuid) returns void
language plpgsql
as $$
declare v uuid;
begin
  if not exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'ph_order_line') then
    perform app.define_workflow(p_farm, 'ph_order_line',
      '[{"code":"pending_acceptance","ar":"بانتظار القبول","en":"Pending acceptance","initial":true,"sort":1},
        {"code":"accepted","ar":"مقبول","en":"Accepted","sort":2},
        {"code":"rejected","ar":"مرفوض","en":"Rejected","terminal":true,"sort":3},
        {"code":"cancelled","ar":"ملغى","en":"Cancelled","terminal":true,"sort":4}]',
      '[{"from":"pending_acceptance","to":"accepted","action":"approve","ph":"customer_order.accept","guard":"ph_rpc","actor":"decided_by"},
        {"from":"pending_acceptance","to":"rejected","action":"approve","ph":"customer_order.accept","guard":"ph_rpc","actor":"decided_by","req":["comment"]},
        {"from":"accepted","to":"pending_acceptance","action":"execute","ph":"customer_order.amend","guard":"ph_rpc","req":["comment"]},
        {"from":"pending_acceptance","to":"cancelled","action":"close","ph":"customer_order.amend","guard":"ph_rpc","req":["comment"]},
        {"from":"accepted","to":"cancelled","action":"close","ph":"customer_order.amend","guard":"ph_rpc","req":["comment"]}]');
  end if;
  if not exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'ph_fg_change') then
    perform app.define_workflow(p_farm, 'ph_fg_change',
      '[{"code":"requested","ar":"مطلوب","en":"Requested","initial":true,"sort":1},
        {"code":"approved","ar":"معتمد ومنفّذ","en":"Approved and done","terminal":true,"sort":2},
        {"code":"rejected","ar":"مرفوض","en":"Rejected","terminal":true,"sort":3}]',
      '[{"from":"requested","to":"approved","action":"approve","ph":"fg_pallet.split_merge_approve","guard":"ph_rpc","actor":"decided_by","differ":["created_by"]},
        {"from":"requested","to":"rejected","action":"approve","ph":"fg_pallet.split_merge_approve","guard":"ph_rpc","actor":"decided_by","differ":["created_by"],"req":["comment"]}]');
  end if;
  -- Finished-pallet workflow v2: the PHM's approval closes the parents and puts the children (which inherit the QC stamp and
  -- the location) into storage. Pallets started on version 1 keep it and cannot be split or merged.
  if exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'ph_fg_pallet' and voided_at is null)
     and not exists (select 1 from public.allowed_transitions t join public.workflow_versions wv on wv.id = t.workflow_version_id
                      where wv.farm_id = p_farm and wv.workflow_code = 'ph_fg_pallet' and wv.is_active and t.guard = 'ph_fg_child') then
    v := app.ph_clone_workflow_version(p_farm, 'ph_fg_pallet', 'M2.3: split / merge approved by the PHM (FR-FG-04/05)');
    insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action, guard, ph_action)
    values (p_farm, v, 'created', 'in_storage', 'approve', 'ph_fg_child', 'fg_pallet.split_merge_approve'),
           (p_farm, v, 'in_storage', 'split_merged', 'approve', 'ph_rpc', 'fg_pallet.split_merge_approve');
    perform app.activate_workflow_version(v);
  end if;
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
end $$;

create function app.ph_order_line(p_ref text) returns public.ph_order_lines
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_order_lines;
begin
  select * into r from public.ph_order_lines o
   where (o.id::text = p_ref or upper(o.code) = upper(trim(p_ref))) and o.voided_at is null and app.ph_is_member(o.farm_id);
  if not found then
    raise exception 'Order line % not found', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'ph.order.notFound', 'ref', p_ref)::text;
  end if;
  return r;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- FR-PL-01 record, FR-PL-02 accept / reject, amend / cancel (P), FR-PL-04 shortage notice
-- ---------------------------------------------------------------------------------------------
create function public.ph_create_order_line(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm    uuid := app.ph_farm_of_user();
  v_seen    jsonb := app.ph_request_seen(p_request_id, 'ph_create_order_line');
  v_basis   text;
  v_missing text[] := '{}';
  v_crop    public.ph_crops;
  v_unit    uuid;
  v_id      uuid := gen_random_uuid();
  v_code    text;
  f         text;
begin
  if v_seen is not null then return v_seen; end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  v_basis := app.ph_authorize(v_farm, 'customer_order.create');
  -- FR-PL-01 mandatory: customer, product / spec, grade, quantity, required date, market type.
  foreach f in array array['customer_name', 'crop_id', 'pack_spec', 'grade', 'quantity', 'quantity_unit', 'required_date', 'market_type'] loop
    if coalesce(trim(p ->> f), '') = '' then v_missing := v_missing || f; end if;
  end loop;
  if cardinality(v_missing) > 0 then
    raise exception 'Order line fields missing: %', array_to_string(v_missing, ', ') using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.v01', 'missing', v_missing)::text;
  end if;
  select * into v_crop from public.ph_crops where id = (p ->> 'crop_id')::uuid and farm_id = v_farm and voided_at is null;
  if not found or v_crop.verification_status <> 'verified' or v_crop.superseded_at is not null then
    raise exception 'Crop not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', coalesce(v_crop.code, '?'))::text;
  end if;
  if (p ->> 'grade') not in ('premium', 'gr1', 'gr2') then
    raise exception 'Grade must be Premium, GR1 or GR2' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v10')::text;
  end if;
  if (p ->> 'market_type') not in ('export', 'local', 'retail', 'lss') then
    raise exception 'Unknown market type' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['market_type'])::text;
  end if;
  if (p ->> 'quantity')::numeric <= 0 then
    raise exception 'Quantity must be above zero' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v02')::text;
  end if;
  select id into v_unit from public.units where farm_id = v_farm and code = p ->> 'quantity_unit' and code in ('kg', 'pc') and voided_at is null;
  if v_unit is null then
    raise exception 'Quantity is in kg or pieces (boxes)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['quantity_unit'])::text;
  end if;
  if (p ->> 'required_date')::date < app.ph_local_date() then
    raise exception 'The required date is in the past' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.order.pastDate')::text;
  end if;
  v_code := app.ph_code(v_farm, 'OL', 4);
  insert into public.ph_order_lines (id, farm_id, code, customer_name, customer_spec_ref, crop_id, grade, pack_spec, quantity, quantity_unit_id,
                                     required_date, market_type, forecast_ref, notes)
  values (v_id, v_farm, v_code, trim(p ->> 'customer_name'), nullif(trim(p ->> 'customer_spec_ref'), ''), v_crop.id, p ->> 'grade',
          trim(p ->> 'pack_spec'), (p ->> 'quantity')::numeric, v_unit, (p ->> 'required_date')::date, p ->> 'market_type',
          nullif(trim(p ->> 'forecast_ref'), ''), nullif(trim(p ->> 'notes'), ''));
  perform app.ph_notify_role(v_farm, 'PHM', 'ph_order_line_due', 'ph_order_lines', v_id, jsonb_build_object('code', v_code));
  return app.ph_request_done(p_request_id, 'ph_create_order_line', v_farm,
                             jsonb_build_object('id', v_id, 'code', v_code, 'status', 'pending_acceptance', 'basis', v_basis));
end;
$$;

create function public.ph_decide_order_line(p_line uuid, p_decision text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare o public.ph_order_lines;
begin
  o := app.ph_order_line(p_line::text);
  perform app.ph_authorize(o.farm_id, 'customer_order.accept');
  if o.status <> 'pending_acceptance' then
    raise exception 'Only a pending line is accepted or rejected' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.order.state', 'status', o.status)::text;
  end if;
  if p_decision not in ('accept', 'reject') then raise exception 'Decision must be accept or reject' using errcode = 'P0422'; end if;
  if p_decision = 'reject' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A rejection needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  update public.ph_order_lines set decided_at = now(), decision_reason = nullif(trim(p_reason), '') where id = o.id;
  perform app.ph_transition('ph_order_lines', o.id, case when p_decision = 'accept' then 'accepted' else 'rejected' end, nullif(trim(p_reason), ''));
  perform app.ph_notify_role(o.farm_id, 'SAL', 'ph_order_decided', 'ph_order_lines', o.id,
                             jsonb_build_object('code', o.code, 'decision', p_decision));
  return jsonb_build_object('id', o.id, 'status', case when p_decision = 'accept' then 'accepted' else 'rejected' end);
end;
$$;

-- Amendment returns an accepted line to Pending acceptance (P); the changed fields stay in the audit trail.
create function public.ph_amend_order_line(p_line uuid, p jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare o public.ph_order_lines;
begin
  o := app.ph_order_line(p_line::text);
  perform app.ph_authorize(o.farm_id, 'customer_order.amend');
  if o.status not in ('pending_acceptance', 'accepted') then
    raise exception 'Only an open line is amended' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.order.state', 'status', o.status)::text;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'An amendment needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  if (p ? 'quantity' and (p ->> 'quantity')::numeric <= 0) or (p ? 'required_date' and (p ->> 'required_date')::date < app.ph_local_date())
     or (p ? 'grade' and p ->> 'grade' not in ('premium', 'gr1', 'gr2')) then
    raise exception 'Amended values are not valid' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v02')::text;
  end if;
  update public.ph_order_lines
     set quantity = coalesce((p ->> 'quantity')::numeric, quantity), required_date = coalesce((p ->> 'required_date')::date, required_date),
         pack_spec = coalesce(nullif(trim(p ->> 'pack_spec'), ''), pack_spec), grade = coalesce(p ->> 'grade', grade),
         notes = coalesce(nullif(trim(p ->> 'notes'), ''), notes)
   where id = o.id;
  if o.status = 'accepted' then
    perform app.ph_transition('ph_order_lines', o.id, 'pending_acceptance', p_reason);
  end if;
  perform app.ph_notify_role(o.farm_id, 'PHM', 'ph_order_line_due', 'ph_order_lines', o.id, jsonb_build_object('code', o.code));
  return jsonb_build_object('id', o.id, 'status', 'pending_acceptance');
end;
$$;

create function public.ph_cancel_order_line(p_line uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare o public.ph_order_lines;
begin
  o := app.ph_order_line(p_line::text);
  perform app.ph_authorize(o.farm_id, 'customer_order.amend');
  if o.status not in ('pending_acceptance', 'accepted') then
    raise exception 'Only an open line is cancelled' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.order.state', 'status', o.status)::text;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  if exists (select 1 from public.ph_job_cards where order_line_id = o.id and voided_at is null and status not in ('cancelled')) then
    raise exception 'Job Cards are planned for this line' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.order.hasJobCards')::text;
  end if;
  perform app.ph_transition('ph_order_lines', o.id, 'cancelled', p_reason);
  return jsonb_build_object('id', o.id, 'status', 'cancelled');
end;
$$;

-- FR-PL-04: shortage notice to Sales and Logistics; records whether it met the 24 h local / 48 h export window (SOP-FC).
create function public.ph_flag_shortage(p_line uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  o      public.ph_order_lines;
  v_need interval;
  v_due  timestamptz;
  v_ok   boolean;
begin
  o := app.ph_order_line(p_line::text);
  perform app.ph_authorize(o.farm_id, 'customer_order.accept');
  if o.status <> 'accepted' then
    raise exception 'A shortage is flagged on an accepted line' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.order.state', 'status', o.status)::text;
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Describe the shortage' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['comment'])::text;
  end if;
  v_need := case when o.market_type = 'export' then interval '48 hours' else interval '24 hours' end;
  v_due := (o.required_date::timestamp at time zone 'Asia/Amman');
  v_ok := v_due - now() >= v_need;
  update public.ph_order_lines set shortage_by = app.current_user_id(), shortage_at = now(), shortage_note = trim(p_note), shortage_in_window = v_ok
   where id = o.id;
  perform app.ph_notify_role(o.farm_id, r, 'ph_order_shortage', 'ph_order_lines', o.id, jsonb_build_object('code', o.code))
     from unnest(array['SAL', 'LOG']) r;
  return jsonb_build_object('id', o.id, 'in_window', v_ok, 'window_hours', extract(epoch from v_need) / 3600);
end;
$$;

-- A Job Card for an accepted order line: crop and grade come from the line (V-10: the customer pallet references the line).
create function public.ph_create_job_card_for_order(p_line uuid, p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  o      public.ph_order_lines;
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_create_job_card_for_order');
  v_res  jsonb;
begin
  if v_seen is not null then return v_seen; end if;
  o := app.ph_order_line(p_line::text);
  if o.status <> 'accepted' then
    raise exception 'Production is planned for an accepted order line only' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.order.notAccepted', 'status', o.status)::text;
  end if;
  v_res := public.ph_create_job_card(coalesce(p, '{}') || jsonb_build_object('crop_id', o.crop_id, 'grade_target', o.grade,
                                     'customer_spec_ref', coalesce(nullif(p ->> 'customer_spec_ref', ''), o.customer_spec_ref)));
  update public.ph_job_cards set order_line_id = o.id where id = (v_res ->> 'id')::uuid;
  return app.ph_request_done(p_request_id, 'ph_create_job_card_for_order', o.farm_id, v_res || jsonb_build_object('order_line', o.code));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Split / merge
-- ---------------------------------------------------------------------------------------------
create function public.ph_request_fg_split(p_fg uuid, p_children jsonb, p_reason text, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  f      public.ph_fg_pallets;
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_request_fg_split');
  v_box  integer;
  v_kg   numeric;
  v_id   uuid := gen_random_uuid();
  v_code text;
begin
  if v_seen is not null then return v_seen; end if;
  f := app.ph_fg_pallet(p_fg::text);
  perform app.ph_authorize(f.farm_id, 'fg_pallet.split_merge');
  if f.status <> 'in_storage' then
    raise exception 'Only a pallet in storage is split' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.state', 'status', f.status)::text;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  if jsonb_typeof(p_children) <> 'array' or jsonb_array_length(p_children) < 2
     or exists (select 1 from jsonb_array_elements(p_children) c where coalesce((c ->> 'box_count')::int, 0) <= 0 or coalesce((c ->> 'net_kg')::numeric, 0) <= 0) then
    raise exception 'A split makes two or more pallets, each with boxes and kg above zero' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.fg.splitChildren')::text;
  end if;
  select sum((c ->> 'box_count')::int), sum((c ->> 'net_kg')::numeric) into v_box, v_kg from jsonb_array_elements(p_children) c;
  if v_box <> f.box_count or v_kg <> f.net_kg then
    raise exception 'Children (% boxes, % kg) must add up to the parent (% boxes, % kg)', v_box, v_kg, f.box_count, f.net_kg using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.fg.splitSum', 'boxes', f.box_count, 'kg', f.net_kg)::text;
  end if;
  if exists (select 1 from public.ph_fg_changes where status = 'requested' and f.id = any (parent_ids) and voided_at is null) then
    raise exception 'A split or merge is already requested for this pallet' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.changePending')::text;
  end if;
  if not exists (select 1 from public.allowed_transitions t where t.workflow_version_id = f.workflow_version_id and t.guard = 'ph_fg_child' and t.voided_at is null) then
    raise exception 'This pallet was created before split / merge was built' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.versionOld')::text;
  end if;
  v_code := app.ph_code(f.farm_id, 'FGC', 4);
  insert into public.ph_fg_changes (id, farm_id, code, kind, parent_ids, children, reason) values (v_id, f.farm_id, v_code, 'split', array[f.id], p_children, trim(p_reason));
  perform app.ph_notify_role(f.farm_id, 'PHM', 'ph_fg_change_due', 'ph_fg_changes', v_id, jsonb_build_object('code', v_code));
  return app.ph_request_done(p_request_id, 'ph_request_fg_split', f.farm_id, jsonb_build_object('id', v_id, 'code', v_code, 'status', 'requested'));
end;
$$;

-- V-22 / GEN-08: same crop, grade, customer (or none) and storage group. Pallets from different Job Cards are not merged:
-- the merged pallet would need a production-run attribution the specification does not define (VR-PH-C26).
create function public.ph_request_fg_merge(p_fgs uuid[], p_reason text, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen  jsonb := app.ph_request_seen(p_request_id, 'ph_request_fg_merge');
  v_farm  uuid := app.ph_farm_of_user();
  v_n     integer;
  v_id    uuid := gen_random_uuid();
  v_code  text;
begin
  if v_seen is not null then return v_seen; end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  perform app.ph_authorize(v_farm, 'fg_pallet.split_merge');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  select count(*) into v_n from public.ph_fg_pallets where id = any (coalesce(p_fgs, '{}')) and farm_id = v_farm and voided_at is null;
  if v_n < 2 or v_n <> cardinality(p_fgs) then
    raise exception 'A merge takes two or more finished pallets' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.mergeCount')::text;
  end if;
  if exists (select 1 from public.ph_fg_pallets where id = any (p_fgs) and status <> 'in_storage') then
    raise exception 'Only pallets in storage are merged' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.state', 'status', 'not in storage')::text;
  end if;
  if (select count(distinct (f.crop_id, f.grade, coalesce(o.customer_name, ''), coalesce(c.storage_group_id::text, ''))) from public.ph_fg_pallets f
        join public.ph_job_cards j on j.id = f.job_card_id left join public.ph_order_lines o on o.id = j.order_line_id
        join public.ph_crops c on c.id = f.crop_id where f.id = any (p_fgs)) > 1 then
    raise exception 'Pallets differ in crop, grade, customer or storage group (V-22)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v22')::text;
  end if;
  if (select count(distinct job_card_id) from public.ph_fg_pallets where id = any (p_fgs)) > 1 then
    raise exception 'Pallets from different Job Cards are not merged' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.mergeJobCards')::text;
  end if;
  if exists (select 1 from public.ph_fg_changes where status = 'requested' and parent_ids && p_fgs and voided_at is null) then
    raise exception 'A split or merge is already requested for one of these pallets' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.changePending')::text;
  end if;
  if exists (select 1 from public.ph_fg_pallets f where f.id = any (p_fgs) and not exists (select 1 from public.allowed_transitions t
               where t.workflow_version_id = f.workflow_version_id and t.guard = 'ph_fg_child' and t.voided_at is null)) then
    raise exception 'A pallet was created before split / merge was built' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.versionOld')::text;
  end if;
  v_code := app.ph_code(v_farm, 'FGC', 4);
  insert into public.ph_fg_changes (id, farm_id, code, kind, parent_ids, reason) values (v_id, v_farm, v_code, 'merge', p_fgs, trim(p_reason));
  perform app.ph_notify_role(v_farm, 'PHM', 'ph_fg_change_due', 'ph_fg_changes', v_id, jsonb_build_object('code', v_code));
  return app.ph_request_done(p_request_id, 'ph_request_fg_merge', v_farm, jsonb_build_object('id', v_id, 'code', v_code, 'status', 'requested'));
end;
$$;

-- New pallet from parents: inherits job card, crop, grade, QC-2, the older QC stamp, the earliest harvest, the location of
-- the first parent and the composition (pro rata for a split, summed for a merge).
create function app.ph_fg_child(c public.ph_fg_changes, p_parents uuid[], p_boxes integer, p_kg numeric) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  f     public.ph_fg_pallets;
  s     public.ph_fg_pallets;
  v_id  uuid := gen_random_uuid();
  v_all numeric;
begin
  select * into f from public.ph_fg_pallets where id = p_parents[1];
  -- The oldest QC stamp among the parents governs the child (the earlier validity end).
  select * into s from public.ph_fg_pallets where id = any (p_parents) order by qc_approved_at, code limit 1;
  select sum(net_kg) into v_all from public.ph_fg_pallets where id = any (p_parents);
  insert into public.ph_fg_pallets (id, farm_id, code, job_card_id, crop_id, grade, box_count, net_kg, weight_unit_id, scale_id,
                                    calibration_flag, plausibility_note, qc2_inspection_id, qc_approved_at, qc_stamp_from, location_id,
                                    earliest_harvest_at, decision_basis)
  select v_id, f.farm_id, app.ph_code(f.farm_id, 'FGP', 5), f.job_card_id, f.crop_id, f.grade, p_boxes, p_kg, f.weight_unit_id, f.scale_id,
         bool_or(x.calibration_flag), f.plausibility_note, f.qc2_inspection_id, s.qc_approved_at, coalesce(s.qc_stamp_from, s.id),
         f.location_id, min(x.earliest_harvest_at), f.decision_basis || jsonb_build_object(c.kind, c.code)
    from public.ph_fg_pallets x where x.id = any (p_parents);
  insert into public.ph_fg_pallet_lots (farm_id, fg_pallet_id, pallet_id, lot_id, kg, share, method)
  select f.farm_id, v_id, l.pallet_id, l.lot_id, round(sum(l.kg) * p_kg / v_all, 2), round(sum(l.kg) / v_all, 4),
         case when count(distinct l.method) = 1 then min(l.method) else 'proportional' end
    from public.ph_fg_pallet_lots l where l.fg_pallet_id = any (p_parents) and l.voided_at is null
   group by l.pallet_id, l.lot_id;
  insert into public.ph_fg_pallet_links (farm_id, parent_id, child_id, change_id, kind)
  select f.farm_id, p, v_id, c.id, c.kind from unnest(p_parents) p;
  perform app.ph_transition('ph_fg_pallets', v_id, 'in_storage', 'Created by ' || c.kind || ' ' || c.code);
  return v_id;
end;
$$;

create function public.ph_decide_fg_change(p_change uuid, p_decision text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  c     public.ph_fg_changes;
  ch    jsonb;
  p     uuid;
  v_new uuid[] := '{}';
begin
  select * into c from public.ph_fg_changes where id = p_change and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Request not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(c.farm_id, 'fg_pallet.split_merge_approve');
  if c.status <> 'requested' then
    raise exception 'Already decided' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.state', 'status', c.status)::text;
  end if;
  if c.created_by = app.current_user_id() then
    raise exception 'The person who requested it does not approve it' using errcode = 'P0423', detail = jsonb_build_object('key', 'ph.sod', 'column', 'created_by')::text;
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject' using errcode = 'P0422'; end if;
  if p_decision = 'reject' then
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'A rejection needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
    end if;
    update public.ph_fg_changes set decided_at = now(), decision_reason = trim(p_reason) where id = c.id;
    perform app.ph_transition('ph_fg_changes', c.id, 'rejected', p_reason);
    return jsonb_build_object('id', c.id, 'status', 'rejected');
  end if;
  if exists (select 1 from public.ph_fg_pallets where id = any (c.parent_ids) and status <> 'in_storage') then
    raise exception 'A pallet left storage after the request' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.state', 'status', 'not in storage')::text;
  end if;
  if c.kind = 'split' then
    for ch in select * from jsonb_array_elements(c.children) loop
      v_new := v_new || app.ph_fg_child(c, c.parent_ids, (ch ->> 'box_count')::int, (ch ->> 'net_kg')::numeric);
    end loop;
  else
    v_new := array[app.ph_fg_child(c, c.parent_ids, (select sum(box_count)::int from public.ph_fg_pallets where id = any (c.parent_ids)),
                                   (select sum(net_kg) from public.ph_fg_pallets where id = any (c.parent_ids)))];
  end if;
  foreach p in array c.parent_ids loop
    perform app.ph_transition('ph_fg_pallets', p, 'split_merged', c.kind || ' ' || c.code);
  end loop;
  update public.ph_fg_changes set decided_at = now(), decision_reason = nullif(trim(p_reason), ''), result_ids = v_new where id = c.id;
  perform app.ph_transition('ph_fg_changes', c.id, 'approved', p_reason);
  return jsonb_build_object('id', c.id, 'status', 'approved', 'pallets', (select jsonb_agg(code) from public.ph_fg_pallets where id = any (v_new)));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------------------------
create or replace view public.ph_fg_board with (security_invoker = true) as
select f.id, f.farm_id, f.code, f.status, f.workflow_version_id, f.version, f.grade, f.box_count, f.net_kg, f.calibration_flag,
       f.plausibility_note, f.label_print_count, f.created_at, f.earliest_harvest_at, f.qc_approved_at,
       f.qc_approved_at + make_interval(hours => coalesce(app.ph_param(f.farm_id, 'qc_approval_validity_hours'), 24)::int) as qc_valid_until,
       greatest(f.created_at, (select max(t.server_received_at) from public.record_transitions t
                                where t.entity_type = 'ph_fg_pallets' and t.entity_id = f.id)) as stage_since,
       round(extract(epoch from (now() - f.earliest_harvest_at)) / 3600, 1) as age_hours,
       f.job_card_id, j.code as job_card_code, ln.code as line_code,
       f.crop_id, c.code as crop_code, c.name_ar as crop_name_ar, c.name_en as crop_name_en,
       eq.code as scale_code, q.code as qc2_code, q.event_at as qc2_at, qb.full_name as qc2_by_name,
       ab.full_name as qc_approved_by_name, cb.full_name as created_by_name,
       f.location_id, loc.code as location_code, loc.name_ar as location_name_ar, loc.name_en as location_name_en,
       (select coalesce(string_agg(distinct l.code, ', '), '') from public.ph_fg_pallet_lots x join public.ph_lots l on l.id = x.lot_id
         where x.fg_pallet_id = f.id) as lot_codes,
       (select coalesce(jsonb_agg(jsonb_build_object('pallet', ip.code, 'pallet_id', ip.id, 'lot', l.code, 'kg', x.kg, 'share', x.share,
                                                     'method', x.method, 'source', s.code) order by ip.code), '[]')
          from public.ph_fg_pallet_lots x join public.ph_incoming_pallets ip on ip.id = x.pallet_id
          join public.ph_sources s on s.id = ip.source_id left join public.ph_lots l on l.id = x.lot_id
         where x.fg_pallet_id = f.id) as composition,
       f.decision_basis,
       sf.code as qc_stamp_from_code,
       (select coalesce(jsonb_agg(p.code order by p.code), '[]') from public.ph_fg_pallet_links k join public.ph_fg_pallets p on p.id = k.parent_id
         where k.child_id = f.id) as parent_codes,
       (select coalesce(jsonb_agg(ch.code order by ch.code), '[]') from public.ph_fg_pallet_links k join public.ph_fg_pallets ch on ch.id = k.child_id
         where k.parent_id = f.id) as child_codes,
       j.order_line_id, ol.code as order_line_code, ol.customer_name
  from public.ph_fg_pallets f
  join public.ph_job_cards j on j.id = f.job_card_id
  join public.ph_lines ln on ln.id = j.line_id
  join public.ph_crops c on c.id = f.crop_id
  left join public.ph_equipment eq on eq.id = f.scale_id
  left join public.ph_inspections q on q.id = f.qc2_inspection_id
  left join public.user_profiles qb on qb.id = q.created_by
  left join public.ph_fg_pallets sf on sf.id = f.qc_stamp_from
  left join public.user_profiles ab on ab.id = coalesce(f.qc_approved_by, sf.qc_approved_by)
  left join public.user_profiles cb on cb.id = f.created_by
  left join public.ph_locations loc on loc.id = f.location_id
  left join public.ph_order_lines ol on ol.id = j.order_line_id
 where f.voided_at is null;

create view public.ph_order_board with (security_invoker = true) as
select o.id, o.farm_id, o.code, o.status, o.version, o.customer_name, o.customer_spec_ref, o.grade, o.pack_spec, o.quantity, u.code as quantity_unit,
       o.required_date, o.market_type, o.forecast_ref, o.notes, o.created_at, o.decided_at, o.decision_reason,
       o.shortage_at, o.shortage_note, o.shortage_in_window,
       greatest(o.created_at, (select max(t.server_received_at) from public.record_transitions t
                                where t.entity_type = 'ph_order_lines' and t.entity_id = o.id)) as stage_since,
       o.crop_id, c.code as crop_code, c.name_ar as crop_name_ar, c.name_en as crop_name_en,
       cb.full_name as created_by_name, db.full_name as decided_by_name, sb.full_name as shortage_by_name,
       (select count(*) from public.ph_job_cards j where j.order_line_id = o.id and j.voided_at is null and j.status <> 'cancelled') as job_cards,
       (select string_agg(j.code, ', ' order by j.code) from public.ph_job_cards j where j.order_line_id = o.id and j.voided_at is null and j.status <> 'cancelled') as job_card_codes,
       (select count(*) from public.ph_fg_pallets f join public.ph_job_cards j on j.id = f.job_card_id
         where j.order_line_id = o.id and f.voided_at is null and f.status <> 'split_merged') as fg_pallets,
       (select coalesce(sum(f.box_count), 0) from public.ph_fg_pallets f join public.ph_job_cards j on j.id = f.job_card_id
         where j.order_line_id = o.id and f.voided_at is null and f.status <> 'split_merged') as fg_boxes,
       (select coalesce(sum(f.net_kg), 0) from public.ph_fg_pallets f join public.ph_job_cards j on j.id = f.job_card_id
         where j.order_line_id = o.id and f.voided_at is null and f.status <> 'split_merged') as fg_kg
  from public.ph_order_lines o
  join public.ph_crops c on c.id = o.crop_id
  join public.units u on u.id = o.quantity_unit_id
  left join public.user_profiles cb on cb.id = o.created_by
  left join public.user_profiles db on db.id = o.decided_by
  left join public.user_profiles sb on sb.id = o.shortage_by
 where o.voided_at is null;
comment on view public.ph_order_board is 'One row per order line with its decision, shortage notice and the production planned and packed for it.';

create view public.ph_jc_order with (security_invoker = true) as
select j.id as job_card_id, j.farm_id, o.id as order_line_id, o.code as order_line_code, o.customer_name, o.market_type, o.pack_spec, o.required_date
  from public.ph_job_cards j join public.ph_order_lines o on o.id = j.order_line_id
 where j.voided_at is null;

create view public.ph_fg_change_board with (security_invoker = true) as
select c.id, c.farm_id, c.code, c.status, c.version, c.kind, c.parent_ids, c.children, c.reason, c.created_at, c.decided_at, c.decision_reason,
       cb.full_name as requested_by_name, db.full_name as decided_by_name,
       (select jsonb_agg(jsonb_build_object('id', f.id, 'code', f.code, 'box_count', f.box_count, 'net_kg', f.net_kg, 'status', f.status) order by f.code)
          from public.ph_fg_pallets f where f.id = any (c.parent_ids)) as parents,
       (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'code', f.code, 'box_count', f.box_count, 'net_kg', f.net_kg) order by f.code), '[]')
          from public.ph_fg_pallets f where f.id = any (c.result_ids)) as results
  from public.ph_fg_changes c
  left join public.user_profiles cb on cb.id = c.created_by
  left join public.user_profiles db on db.id = c.decided_by
 where c.voided_at is null;

-- FR-PL-03 daily plan for a date: accepted lines due, Job Cards by line, raw stock by crop (oldest first) and FG stock.
create function public.ph_daily_plan(p_date date default null) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with f as (select app.ph_farm_of_user() as farm, coalesce(p_date, app.ph_local_date()) as d)
  select jsonb_build_object(
    'date', f.d,
    'order_lines', (select coalesce(jsonb_agg(to_jsonb(b) - 'farm_id' order by b.required_date, b.code), '[]') from public.ph_order_board b
                     where b.farm_id = f.farm and b.status in ('accepted', 'pending_acceptance') and b.required_date >= f.d),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('code', l.code, 'name_ar', l.name_ar, 'name_en', l.name_en, 'kind', l.kind,
                      'job_cards', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'code', j.code, 'status', j.status, 'crop_name_ar', j.crop_name_ar,
                                             'crop_name_en', j.crop_name_en, 'grade_target', j.grade_target, 'issued_kg', j.issued_kg, 'fg_kg', j.fg_kg,
                                             'order_line', (select o.code from public.ph_job_cards x join public.ph_order_lines o on o.id = x.order_line_id where x.id = j.id))
                                             order by j.code), '[]')
                                      from public.ph_jc_board j where j.farm_id = f.farm and j.line_id = l.id and j.planned_date = f.d and j.status <> 'cancelled'))
                      order by l.sort_order), '[]')
                from public.ph_lines l where l.farm_id = f.farm and l.voided_at is null and l.kind <> 'washer' and l.verification_status = 'verified'),
    'raw_stock', (select coalesce(jsonb_agg(x order by x ->> 'oldest_received'), '[]') from (
                   select jsonb_build_object('crop_code', b.crop_code, 'crop_name_ar', b.crop_name_ar, 'crop_name_en', b.crop_name_en,
                            'released_kg', sum(b.available_kg) filter (where b.status in ('released', 'issued')),
                            'stored_kg', sum(b.available_kg) filter (where b.status = 'stored'),
                            'pallets', count(*), 'oldest_received', min(b.received_at), 'oldest_age_hours', max(b.age_hours)) as x
                     from public.ph_ip_board b where b.farm_id = f.farm and b.status in ('stored', 'released', 'issued') and coalesce(b.available_kg, 0) > 0
                    group by b.crop_code, b.crop_name_ar, b.crop_name_en) s),
    'fg_stock', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('crop_code', g.crop_code, 'crop_name_ar', g.crop_name_ar, 'crop_name_en', g.crop_name_en, 'grade', g.grade,
                           'pallets', count(*), 'boxes', sum(g.box_count), 'kg', sum(g.net_kg), 'oldest_qc_at', min(g.qc_approved_at)) as x
                    from public.ph_fg_board g where g.farm_id = f.farm and g.status = 'in_storage'
                   group by g.crop_code, g.crop_name_ar, g.crop_name_en, g.grade) s))
    from f
$$;

-- FG label: a customer pallet carries the customer and order line; the parents of a split or merge stay traceable.
create or replace function app.ph_fg_label_content(p_fg uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'pallet_no', f.code, 'job_card', j.code, 'grade', f.grade, 'box_count', f.box_count, 'net_kg', f.net_kg,
    'crop', c.name_ar, 'crop_en', c.name_en,
    'customer', o.customer_name, 'order_line', o.code, 'pack_spec', o.pack_spec,
    'varieties', (select coalesce(jsonb_agg(distinct v.name_ar), '[]') from public.ph_fg_pallet_lots x join public.ph_incoming_pallets ip on ip.id = x.pallet_id
                    join public.ph_varieties v on v.id = ip.variety_id where x.fg_pallet_id = f.id),
    'lots', (select coalesce(jsonb_agg(distinct l.code), '[]') from public.ph_fg_pallet_lots x join public.ph_lots l on l.id = x.lot_id where x.fg_pallet_id = f.id),
    'sections', (select coalesce(jsonb_agg(distinct s.block_code || '/' || s.section_code), '[]') from public.ph_fg_pallet_lots x
                   join public.ph_incoming_pallets ip on ip.id = x.pallet_id join public.ph_sources s on s.id = ip.source_id
                  where x.fg_pallet_id = f.id and s.kind = 'own_farm' and s.section_code is not null),
    'suppliers', (select coalesce(jsonb_agg(distinct s.supplier_name), '[]') from public.ph_fg_pallet_lots x
                    join public.ph_incoming_pallets ip on ip.id = x.pallet_id join public.ph_sources s on s.id = ip.source_id
                   where x.fg_pallet_id = f.id and s.kind = 'supplier' and s.supplier_name is not null),
    'parents', (select coalesce(jsonb_agg(distinct p.code), '[]') from public.ph_fg_pallet_links k join public.ph_fg_pallets p on p.id = k.parent_id
                 where k.child_id = f.id),
    'harvest_date', to_char(f.earliest_harvest_at at time zone 'Asia/Amman', 'YYYY-MM-DD'),
    'packed_on', to_char(f.created_at at time zone 'Asia/Amman', 'YYYY-MM-DD'),
    'missing', array_remove(array[
        case when exists (select 1 from public.ph_fg_pallet_lots x where x.fg_pallet_id = f.id and x.lot_id is null) then 'lot' end,
        case when exists (select 1 from public.ph_fg_pallet_lots x join public.ph_incoming_pallets ip on ip.id = x.pallet_id
                            join public.ph_sources s on s.id = ip.source_id
                           where x.fg_pallet_id = f.id and s.kind = 'own_farm' and s.section_code is null) then 'section' end,
        case when exists (select 1 from public.ph_fg_pallet_lots x join public.ph_incoming_pallets ip on ip.id = x.pallet_id
                            join public.ph_sources s on s.id = ip.source_id
                           where x.fg_pallet_id = f.id and s.kind = 'supplier' and s.supplier_name is null) then 'supplier' end,
        case when f.earliest_harvest_at is null then 'harvest_date' end], null),
    'barcode', null, 'barcode_note', 'Barcode type pending OD-20')
    from public.ph_fg_pallets f join public.ph_job_cards j on j.id = f.job_card_id join public.ph_crops c on c.id = f.crop_id
    left join public.ph_order_lines o on o.id = j.order_line_id
   where f.id = p_fg
$$;

-- Finished-pallet actions: split and merge requests (the PHM decides them on the request).
create or replace function public.ph_fg_pallet_actions(p_fg uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  f      public.ph_fg_pallets;
  v_uid  uuid := app.current_user_id();
  v_out  jsonb := '[]';
  c      record;
  v_why  jsonb;
  v_miss jsonb;
begin
  f := app.ph_fg_pallet(p_fg::text);
  v_miss := app.ph_fg_label_content(f.id) -> 'missing';
  for c in
    select * from (values
      ('print_label', 'fg_pallet.create', f.status in ('created', 'qc_approved', 'in_storage')),
      ('qc_approve', 'qc2.submit', f.status = 'created'),
      ('move', 'stock_move.execute', f.status in ('qc_approved', 'in_storage')),
      ('split', 'fg_pallet.split_merge', f.status = 'in_storage'),
      ('merge', 'fg_pallet.split_merge', f.status = 'in_storage'),
      ('record_waste', 'waste.create', f.status in ('created', 'qc_approved', 'in_storage'))
    ) as x(action, ph_action, applicable)
  loop
    continue when not c.applicable;
    v_why := app.ph_denial(v_uid, f.farm_id, c.ph_action);
    if v_why is null and c.action = 'print_label' and jsonb_array_length(v_miss) > 0 then
      v_why := jsonb_build_object('key', 'ph.v09', 'missing', v_miss);
    end if;
    if v_why is null and c.action in ('split', 'merge') then
      if exists (select 1 from public.ph_fg_changes where status = 'requested' and f.id = any (parent_ids) and voided_at is null) then
        v_why := jsonb_build_object('key', 'ph.fg.changePending');
      elsif not exists (select 1 from public.allowed_transitions t where t.workflow_version_id = f.workflow_version_id and t.guard = 'ph_fg_child' and t.voided_at is null) then
        v_why := jsonb_build_object('key', 'ph.fg.versionOld');
      end if;
    end if;
    v_out := v_out || jsonb_build_object('action', c.action, 'ph_action', c.ph_action, 'allowed', v_why is null, 'reason', v_why,
                                         'basis', app.ph_permission_basis(v_uid, f.farm_id, c.ph_action));
  end loop;
  return v_out;
end;
$$;

-- Trace now also passes through split / merge (parents and children) and lists the waste and order lines involved.
create or replace function public.ph_backward_trace(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_ids uuid[];
  v_fg  uuid[];
  v_jc  uuid[];
  v_rel uuid[];
begin
  select array_agg(f.id) into v_fg from public.ph_fg_pallets f
   where app.ph_is_member(f.farm_id) and f.voided_at is null and upper(f.code) = upper(trim(p_ref));
  -- A finished pallet brings its ancestors and descendants through splits and merges (GEN-07/08).
  if v_fg is not null then
    with recursive up(id) as (select unnest(v_fg) union select l.parent_id from public.ph_fg_pallet_links l join up on l.child_id = up.id),
                   down(id) as (select unnest(v_fg) union select l.child_id from public.ph_fg_pallet_links l join down on l.parent_id = down.id)
    select array_agg(distinct id) into v_rel from (select id from up union select id from down) x;
    v_fg := v_rel;
  end if;
  select array_agg(j.id) into v_jc from public.ph_job_cards j
   where app.ph_is_member(j.farm_id) and j.voided_at is null
     and (upper(j.code) = upper(trim(p_ref)) or j.id in (select job_card_id from public.ph_fg_pallets where id = any (coalesce(v_fg, '{}')))
          or j.order_line_id in (select o.id from public.ph_order_lines o where upper(o.code) = upper(trim(p_ref))));
  select array_agg(distinct p.id) into v_ids from public.ph_incoming_pallets p
    left join public.ph_arrivals a on a.id = p.arrival_id
    left join public.ph_lots l on l.id = p.lot_id
   where app.ph_is_member(p.farm_id) and p.voided_at is null
     and (upper(p.code) = upper(trim(p_ref)) or upper(a.code) = upper(trim(p_ref)) or upper(l.code) = upper(trim(p_ref))
          or p.id in (select pallet_id from public.ph_fg_pallet_lots where fg_pallet_id = any (coalesce(v_fg, '{}')))
          or (v_fg is null and p.id in (select pallet_id from public.ph_jc_inputs where job_card_id = any (coalesce(v_jc, '{}')) and voided_at is null)));
  if v_ids is null then
    raise exception 'Nothing found for %', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'ph.trace.notFound', 'ref', p_ref)::text;
  end if;
  if v_fg is null then
    select array_agg(distinct i.job_card_id) into v_jc from public.ph_jc_inputs i where i.pallet_id = any (v_ids) and i.voided_at is null;
    select array_agg(distinct x.fg_pallet_id) into v_fg from public.ph_fg_pallet_lots x where x.pallet_id = any (v_ids);
  end if;
  return jsonb_build_object(
    'query', p_ref,
    'scope', 'Backward to arrival and source, forward to Job Cards, finished pallets (through splits and merges), waste and order lines; loads and customers'' deliveries arrive with dispatch (M3)',
    'pallets', (select jsonb_agg(to_jsonb(b) - 'farm_id' order by b.code) from public.ph_ip_board b where b.id = any (v_ids)),
    'job_cards', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'code', j.code, 'status', j.status, 'line', j.line_code,
                                                                'issued_kg', j.issued_kg, 'consumed_kg', j.consumed_kg, 'fg_kg', j.fg_kg,
                                                                'order_line', (select o.code from public.ph_job_cards x join public.ph_order_lines o on o.id = x.order_line_id where x.id = j.id),
                                                                'customer', (select o.customer_name from public.ph_job_cards x join public.ph_order_lines o on o.id = x.order_line_id where x.id = j.id))
                                              order by j.code), '[]')
                    from public.ph_jc_board j where j.id = any (coalesce(v_jc, '{}'))),
    'fg_pallets', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'code', f.code, 'status', f.status, 'grade', f.grade, 'net_kg', f.net_kg,
                                                                 'job_card', f.job_card_code, 'lots', f.lot_codes, 'location', f.location_code,
                                                                 'composition', f.composition,
                                                                 'parents', (select coalesce(jsonb_agg(p.code), '[]') from public.ph_fg_pallet_links k
                                                                               join public.ph_fg_pallets p on p.id = k.parent_id where k.child_id = f.id)) order by f.code), '[]')
                     from public.ph_fg_board f where f.id = any (coalesce(v_fg, '{}'))),
    'waste', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'status', w.status, 'category', w.category, 'net_kg', w.net_kg,
                                                            'reference_kg', w.reference_kg, 'source', w.source_code) order by w.code), '[]')
                from public.ph_waste_board w
               where (w.source_type = 'job_card' and w.source_id = any (coalesce(v_jc, '{}')))
                  or (w.source_type = 'incoming_pallet' and w.source_id = any (v_ids))
                  or (w.source_type = 'fg_pallet' and w.source_id = any (coalesce(v_fg, '{}')))),
    'inspections', (select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'type', i.inspection_type, 'result', i.result, 'at', i.event_at,
                                                                  'by', u.full_name, 'pallet', coalesce(p.code, j.code), 'tolerance_basis', i.tolerance_basis)
                                              order by i.event_at), '[]')
                      from public.ph_inspections i
                      left join public.ph_inspection_subjects s on s.inspection_id = i.id
                      left join public.ph_incoming_pallets p on p.id = s.pallet_id
                      left join public.ph_job_cards j on j.id = i.job_card_id
                      left join public.user_profiles u on u.id = i.created_by
                     where i.voided_at is null and (s.pallet_id = any (v_ids) or i.job_card_id = any (coalesce(v_jc, '{}')))),
    'moves', (select coalesce(jsonb_agg(jsonb_build_object('pallet', coalesce(p.code, f.code), 'from', lf.code, 'to', lt.code, 'at', m.moved_at, 'by', u.full_name)
                                        order by m.moved_at), '[]')
                from public.ph_stock_moves m
                left join public.ph_incoming_pallets p on p.id = m.pallet_id
                left join public.ph_fg_pallets f on f.id = m.fg_pallet_id
                left join public.ph_locations lf on lf.id = m.from_location_id left join public.ph_locations lt on lt.id = m.to_location_id
                left join public.user_profiles u on u.id = m.created_by
               where m.pallet_id = any (v_ids) or m.fg_pallet_id = any (coalesce(v_fg, '{}'))),
    'holds', (select coalesce(jsonb_agg(jsonb_build_object('code', h.code, 'type', h.hold_type, 'status', h.status, 'disposition', h.disposition,
                                                            'pallet', p.code)), '[]')
                from public.ph_hold_items hi join public.ph_holds h on h.id = hi.hold_id join public.ph_incoming_pallets p on p.id = hi.pallet_id
               where hi.pallet_id = any (v_ids)));
end;
$$;

-- Orders stage on the board.
create or replace function public.ph_stage_counts() returns table (stage text, total bigint, attention bigint)
language sql stable security invoker set search_path = public, app, pg_temp
as $$
  select 'orders', count(*), count(*) filter (where status = 'pending_acceptance' or (status = 'accepted' and required_date <= app.ph_local_date() + 1 and fg_pallets = 0))
    from public.ph_order_board where status in ('pending_acceptance', 'accepted')
  union all
  select 'arrivals', count(*), count(*) filter (where status = 'vehicle_hold' or late_flag)
    from public.ph_arrival_board where status in ('draft', 'vehicle_hold', 'submitted')
  union all
  select b.stage, count(*), count(*) filter (where b.dwell_exceeded or b.grading_overdue or b.calibration_flag
                                                    or b.status in ('qa_rejected', 'on_hold', 'arrival_rejected'))
    from public.ph_ip_board b where b.stage <> 'production' group by b.stage
  union all
  select 'production', count(*), count(*) filter (where status in ('line_check_failed', 'paused') or (status = 'in_progress' and qc2_result = 'fail'))
    from public.ph_jc_board where status in ('draft', 'planned', 'ready', 'line_check_failed', 'in_progress', 'paused', 'completed', 'reconciled')
  union all
  select 'qc2', count(*), count(*) filter (where qc2_result = 'fail')
    from public.ph_jc_board where status = 'in_progress'
  union all
  select 'fg_pallets', count(*), count(*) filter (where label_print_count = 0)
    from public.ph_fg_board where status in ('created', 'qc_approved')
  union all
  select 'fg_storage', count(*), count(*) filter (where qc_valid_until < now())
    from public.ph_fg_board where status = 'in_storage'
  union all
  select 'waste', count(*), count(*) filter (where top_mgmt_overdue or (status = 'weighed'))
    from public.ph_waste_board where status not in ('disposed', 'returned_to_line')
$$;

select app.seed_ph_orders_plan(id) from public.farms;
select app.apply_api_grants();
