-- Packing house 3/3 (milestone M1): receiving to QC-1 release — ST-01…ST-07, gates G1–G4, holds (X-01, SM-NC),
-- lots per OD-02, photo evidence (AT-05, V-23) and receiving labels (AT-07). Writes happen only through the server
-- functions below; every status change goes through transition_record() with the packing-house matrix and decision
-- gates. API users have read access (packing-house roles) and no direct insert/update.

set check_function_bodies = off;

alter table public.ph_crops add column label_code text check (label_code is null or label_code ~ '^[A-Z0-9]{1,8}$');
comment on column public.ph_crops.label_code is
  'Short crop code printed in pallet and lot numbers (spec §7.1 example CT). Not documented for real crops: until set, '
  'the crop code is used.';

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.ph_lots (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  crop_id          uuid not null references public.ph_crops(id),
  source_id        uuid not null references public.ph_sources(id),
  harvest_date     date not null,
  decision_basis   text not null
);
comment on table public.ph_lots is
  'Raw-material lot = crop × source × harvest date (OD-02 options A/C), created at QA acceptance. Not created at all while '
  'OD-02 is open or decided as option B (lot per Job Card).';
select app.register_table('public.ph_lots', 'ph_lot', false, p_default_policies => false);
create unique index ph_lots_code_uq on public.ph_lots (farm_id, code) where voided_at is null;

create table public.ph_arrivals (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null,
  arrived_at           timestamptz not null default now(),
  gate_no              text,
  source_id            uuid not null references public.ph_sources(id),
  variety_id           uuid references public.ph_varieties(id),
  harvest_date         date,
  harvest_time         time,
  harvest_supervisor   text,
  supplier_ref         text,
  vehicle_plate        text not null,
  driver_name          text not null,
  dispatch_note_no     text,
  dispatched_pallets   integer check (dispatched_pallets is null or dispatched_pallets >= 0),
  dispatched_boxes     integer check (dispatched_boxes is null or dispatched_boxes >= 0),
  late_flag            boolean not null default false,
  late_reason          text,
  vehicle_result       text check (vehicle_result in ('pass', 'fail')),
  vehicle_inspection_id uuid,
  remarks              text,
  decision_basis       jsonb not null default '{}',
  submitted_by         uuid references auth.users(id),
  closed_by            uuid references auth.users(id),
  check (not late_flag or coalesce(trim(late_reason), '') <> '')
);
comment on table public.ph_arrivals is
  'One vehicle load at the gate (ST-01, ARR-YYMMDD-NNNN): harvesting-tag data (V-01), vehicle and driver, optional farm '
  'dispatch note (CP-02), late-arrival flag (V-03) and the incoming vehicle check (G1). Pallets can be registered only '
  'once the arrival has passed G1.';
select app.register_table('public.ph_arrivals', 'ph_arrival', false, 'ph_arrival', p_default_policies => false);
create unique index ph_arrivals_code_uq on public.ph_arrivals (farm_id, code) where voided_at is null;

create table public.ph_incoming_pallets (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,
  arrival_id            uuid not null references public.ph_arrivals(id),
  crop_id               uuid not null references public.ph_crops(id),
  variety_id            uuid references public.ph_varieties(id),
  source_id             uuid not null references public.ph_sources(id),
  harvest_at            timestamptz,
  box_count             integer not null check (box_count > 0),
  net_kg                numeric(10,2) not null check (net_kg > 0),
  weight_unit_id        uuid not null references public.units(id),
  scale_id              uuid not null references public.ph_equipment(id),
  received_at           timestamptz not null default now(),
  calibration_flag      boolean not null default false,
  plausibility_note     text,
  lot_id                uuid references public.ph_lots(id),
  location_id           uuid references public.ph_locations(id),
  arrival_check_id      uuid,
  arrival_check_result  text check (arrival_check_result in ('pass', 'reject')),
  reject_destination    text check (reject_destination in ('farm_or_supplier', 'waste_area')),
  precool_in_at         timestamptz,
  precool_out_at        timestamptz,
  rma_id                uuid,
  qa_reject_reason      text,
  qa_decided_by         uuid references auth.users(id),
  regraded_by           uuid references auth.users(id),
  regrade_done_at       timestamptz,
  pre_regrade_net_kg    numeric(10,2),
  reweighed_by          uuid references auth.users(id),
  recheck_id            uuid,
  rechecked_by          uuid references auth.users(id),
  qc1_id                uuid,
  released_by           uuid references auth.users(id),
  hold_id               uuid,
  held_from_status      text,
  void_requested_by     uuid references auth.users(id),
  void_request_reason   text,
  void_approved_by      uuid references auth.users(id),
  disposition_by        uuid references auth.users(id),
  waste_record_id       uuid,
  label_print_count     integer not null default 0,
  decision_basis        jsonb not null default '{}',
  check (precool_out_at is null or precool_in_at is not null)
);
comment on table public.ph_incoming_pallets is
  'One field pallet as received (IP, SM-IP §8.1). Registered at the scale with weight, scale ID and a printed number per '
  'crop / source / day (SOP-RC; CP-01 under OD-01). Its status moves only through gates G2 (arrival check), pre-cooling, '
  'G3 (QA acceptance, with the regrade loop), storage and G4 (QC-1 release). Nothing is deleted: errors are voided with a '
  'reason by maker (DEC) and checker (WHM).';
select app.register_table('public.ph_incoming_pallets', 'ph_incoming_pallet', false, 'ph_incoming_pallet', p_default_policies => false);
create unique index ph_incoming_pallets_code_uq on public.ph_incoming_pallets (farm_id, code) where voided_at is null;
create index ph_incoming_pallets_arrival_idx on public.ph_incoming_pallets (arrival_id);

create table public.ph_inspections (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  inspection_type    text not null check (inspection_type in ('vehicle_in', 'arrival', 'rma', 'recheck', 'qc1')),
  template_id        uuid not null references public.ph_inspection_templates(id),
  arrival_id         uuid references public.ph_arrivals(id),
  result             text not null check (result in ('pass', 'fail', 'accept', 'reject', 'mixed')),
  reason             text,
  checklist          jsonb not null default '{}',
  product_temp_c     numeric(5,1),
  sample_note        text,
  tolerance_basis    text not null default 'not_applicable' check (tolerance_basis in ('not_applicable', 'no_tolerance_set')),
  qam_review_flag    boolean not null default false,
  remarks            text,
  event_at           timestamptz not null default now(),
  signature_meaning  text not null check (signature_meaning in ('recorded', 'approved', 'rejected', 'released')),
  cosigned_by        uuid references auth.users(id),
  cosign_comment     text,
  check (result not in ('fail', 'reject') or coalesce(trim(reason), '') <> '')
);
comment on table public.ph_inspections is
  'QC/QA inspection records (spec §9.3 InspectionRecord): incoming vehicle check, arrival visual check (G2), raw-material '
  'acceptance (G3, RMA), recheck after regrade and QC-1 release (G4). Each stores its checklist template version (AT-06), '
  'the inspector (created_by) and the meaning of the signature. An RMA is co-signed by QC/QA (rma.cosign).';
select app.register_table('public.ph_inspections', 'ph_inspection', false, 'ph_inspection', p_default_policies => false);
create unique index ph_inspections_code_uq on public.ph_inspections (farm_id, code) where voided_at is null;

create table public.ph_inspection_subjects (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references public.ph_inspections(id),
  pallet_id       uuid not null references public.ph_incoming_pallets(id),
  result          text not null check (result in ('pass', 'reject', 'accept', 'release')),
  destination     text check (destination in ('farm_or_supplier', 'waste_area')),
  remarks         text,
  check (result <> 'reject' or destination is not null or inspection_id is not null)
);
comment on table public.ph_inspection_subjects is 'Pallets covered by an inspection, with the per-pallet result (e.g. G2 per pallet; all pallets of an RMA).';
select app.register_table('public.ph_inspection_subjects', 'ph_inspection', false, p_default_policies => false);
create index ph_inspection_subjects_pallet_idx on public.ph_inspection_subjects (pallet_id);

create table public.ph_vehicle_exception_approvals (
  id           uuid primary key default gen_random_uuid(),
  arrival_id   uuid not null references public.ph_arrivals(id),
  spec_code    text not null check (spec_code in ('PHM', 'QAM', 'TOP')),
  decision     text not null check (decision in ('approve', 'refuse')),
  approved_by  uuid not null references auth.users(id),
  comment      text not null check (length(trim(comment)) > 0)
);
comment on table public.ph_vehicle_exception_approvals is
  'Three-party approval of a non-compliant incoming vehicle (SOP-TR, E-02): PHM, QA and top management each approve, or '
  'any one refuses. Expiry of partial approvals waits for OD-16.';
select app.register_table('public.ph_vehicle_exception_approvals', 'ph_arrival', false, p_default_policies => false);
create unique index ph_vehicle_exception_approvals_uq on public.ph_vehicle_exception_approvals (arrival_id, spec_code) where voided_at is null;

create table public.ph_stock_moves (
  id                    uuid primary key default gen_random_uuid(),
  pallet_id             uuid not null references public.ph_incoming_pallets(id),
  from_location_id      uuid references public.ph_locations(id),
  to_location_id        uuid references public.ph_locations(id),
  moved_at              timestamptz not null default now(),
  reason                text,
  group_override_reason text,
  over_capacity         boolean not null default false,
  permission_basis      text not null
);
comment on table public.ph_stock_moves is
  'Location history of every pallet (CP-09, FR-ST-01): from, to, when, by whom, with the storage-group override reason '
  '(V-07) and capacity warning (V-08). Append-only.';
select app.register_table('public.ph_stock_moves', 'ph_stock_move', false, p_default_policies => false);
create index ph_stock_moves_pallet_idx on public.ph_stock_moves (pallet_id, moved_at);

create table public.ph_location_group_changes (
  id               uuid primary key default gen_random_uuid(),
  location_id      uuid not null references public.ph_locations(id),
  from_group_id    uuid references public.ph_storage_groups(id),
  to_group_id      uuid references public.ph_storage_groups(id),
  pallets_present  integer not null,
  reason           text
);
comment on table public.ph_location_group_changes is 'History of fridge storage-group assignments (FR-ST-06); a change with pallets present needs a reason.';
select app.register_table('public.ph_location_group_changes', 'ph_stock_move', false, p_default_policies => false);

create table public.ph_holds (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  hold_type           text not null check (hold_type in ('quality', 'food_safety', 'operational')),
  type_basis          text not null,
  reason              text not null check (length(trim(reason)) > 0),
  disposition         text check (disposition in ('release', 'regrade', 'rework', 'waste', 'return', 'concession')),
  disposition_note    text,
  execution_note      text,
  verification_note   text,
  closure_note        text,
  assigned_by         uuid references auth.users(id),
  decided_by          uuid references auth.users(id),
  executed_by         uuid references auth.users(id),
  verified_by         uuid references auth.users(id),
  closed_by           uuid references auth.users(id)
);
comment on table public.ph_holds is
  'Hold / nonconformity (X-01, SM-NC, NC-YYMMDD-NNN). Raised by QCI/QAO (any type) or PHM (operational); disposition by '
  'QCM/QAM, food-safety holds by QAM only; executed by the Packing House, verified by QC/QA, closed by QAM. Which holds '
  'count as food-safety is pending OD-23 and recorded in type_basis.';
select app.register_table('public.ph_holds', 'ph_hold', false, 'ph_hold', p_default_policies => false);
create unique index ph_holds_code_uq on public.ph_holds (farm_id, code) where voided_at is null;

create table public.ph_hold_items (
  id          uuid primary key default gen_random_uuid(),
  hold_id     uuid not null references public.ph_holds(id),
  pallet_id   uuid not null references public.ph_incoming_pallets(id),
  outcome     text check (outcome in ('released', 'waste'))
);
comment on table public.ph_hold_items is 'Pallets under a hold (GEN-11) and what happened to each.';
select app.register_table('public.ph_hold_items', 'ph_hold', false, p_default_policies => false);
create index ph_hold_items_pallet_idx on public.ph_hold_items (pallet_id);

create table public.ph_waste_records (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  category        text not null check (category in ('processed', 'long_storage', 'packaging', 'weight_loss')),
  source_type     text not null check (source_type in ('incoming_pallet', 'job_card', 'fg_pallet', 'location')),
  source_id       uuid,
  crop_id         uuid references public.ph_crops(id),
  reference_kg    numeric(10,2),
  bags            integer,
  net_kg          numeric(10,2),
  origin          text not null,
  erp_ref         text
);
comment on table public.ph_waste_records is
  'Waste record (ST-11, SM-WR, WR-YYMMDD-NNNN). In M1 created automatically, as a draft, when incoming product is rejected '
  'a second time (E-04) or a hold is disposed as waste, so nothing leaves the quantity chain (CP-01). reference_kg is the '
  'source weight; the waste is weighed after QC approval (V-16) in milestone M2.';
select app.register_table('public.ph_waste_records', 'ph_waste', false, 'ph_waste', p_default_policies => false);
create unique index ph_waste_records_code_uq on public.ph_waste_records (farm_id, code) where voided_at is null;

create table public.ph_attachments (
  id             uuid primary key default gen_random_uuid(),
  entity_type    text check (entity_type in ('ph_arrivals', 'ph_incoming_pallets', 'ph_inspections', 'ph_holds')),
  entity_id      uuid,
  kind           text not null check (kind in ('photo', 'video', 'document')),
  mime_type      text not null,
  size_bytes     integer not null check (size_bytes > 0),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  caption        text,
  supersedes_id  uuid references public.ph_attachments(id),
  check ((entity_type is null) = (entity_id is null))
);
comment on table public.ph_attachments is
  'Evidence files (AT-05): uploader, time, size and SHA-256 of the content. Content is never replaced; a newer file '
  'supersedes an older one. Uploaded unlinked, then linked once to the record they support (e.g. an RMA).';
select app.register_table('public.ph_attachments', 'ph_attachment', false, p_default_policies => false);
create index ph_attachments_entity_idx on public.ph_attachments (entity_type, entity_id);

create table public.ph_attachment_blobs (
  attachment_id uuid primary key references public.ph_attachments(id),
  content       bytea not null
);
comment on table public.ph_attachment_blobs is
  'File content kept in the database because Storage is not available in the local stack (VR-S01). Insert-only; read '
  'through ph_attachment_content(). Production should move content to Storage.';
alter table public.ph_attachment_blobs enable row level security;
create trigger ph_attachment_blobs_immutable before update or delete on public.ph_attachment_blobs
  for each row execute function app.forbid_audit_change();

create table public.ph_label_prints (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('ph_incoming_pallets')),
  entity_id    uuid not null,
  label_type   text not null check (label_type in ('receiving')),
  content      jsonb not null,
  is_reprint   boolean not null,
  reason       text,
  check (not is_reprint or coalesce(trim(reason), '') <> '')
);
comment on table public.ph_label_prints is 'Every label print and reprint with the exact content printed (AT-07); reprints need a reason.';
select app.register_table('public.ph_label_prints', 'ph_label', false, p_default_policies => false);
create index ph_label_prints_entity_idx on public.ph_label_prints (entity_type, entity_id);

-- Append-only operational ledgers: no update after insert.
create function app.ph_append_only() returns trigger
language plpgsql as $$
begin
  if not app.flag('in_void') then
    raise exception '% is append-only', tg_table_name using errcode = 'P0403';
  end if;
  return new;
end;
$$;
create trigger ph_stock_moves_append_only before update on public.ph_stock_moves for each row execute function app.ph_append_only();
create trigger ph_label_prints_append_only before update on public.ph_label_prints for each row execute function app.ph_append_only();
create trigger ph_vehicle_exception_approvals_append_only before update on public.ph_vehicle_exception_approvals for each row execute function app.ph_append_only();
create trigger ph_decision_approvals_append_only before update on public.ph_decision_approvals for each row execute function app.ph_append_only();

-- An attachment is linked once; its content facts never change.
create function app.ph_attachment_guard() returns trigger
language plpgsql as $$
begin
  if (old.entity_id is not null and (new.entity_id, new.entity_type) is distinct from (old.entity_id, old.entity_type))
     or new.sha256 <> old.sha256 or new.size_bytes <> old.size_bytes or new.mime_type <> old.mime_type
     or new.supersedes_id is distinct from old.supersedes_id then
    raise exception 'Attachments cannot be changed; upload a new file that supersedes it' using errcode = 'P0403';
  end if;
  return new;
end;
$$;
create trigger ph_attachments_guard before update on public.ph_attachments for each row execute function app.ph_attachment_guard();

-- Read access for packing-house role holders (VR-PH-C02); no insert/update policies: writes go through functions.
do $$
declare t text;
begin
  foreach t in array array['ph_lots', 'ph_arrivals', 'ph_incoming_pallets', 'ph_inspections', 'ph_inspection_subjects',
                           'ph_vehicle_exception_approvals', 'ph_stock_moves', 'ph_location_group_changes', 'ph_holds',
                           'ph_hold_items', 'ph_waste_records', 'ph_attachments', 'ph_label_prints'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.ph_is_member(farm_id))', t || '_select', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Guards (app.guard_<name>(record)). Every packing-house transition requires the server-function marker, so the
-- validations in those functions cannot be skipped.
-- ---------------------------------------------------------------------------------------------
create function app.guard_ph_rpc(r jsonb) returns boolean language sql stable as $$ select app.ph_in_rpc() $$;
create function app.guard_ph_arrival_ready(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and (r ->> 'vehicle_result' = 'pass' or app.ph_vehicle_exception_state((r ->> 'id')::uuid) = 'approved')
$$;
create function app.guard_ph_vehicle_approved(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and app.ph_vehicle_exception_state((r ->> 'id')::uuid) = 'approved' $$;
create function app.guard_ph_vehicle_refused(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and app.ph_vehicle_exception_state((r ->> 'id')::uuid) = 'refused' $$;
create function app.guard_ph_dest_farm(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and r ->> 'reject_destination' = 'farm_or_supplier' $$;
create function app.guard_ph_dest_waste(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and r ->> 'reject_destination' = 'waste_area' $$;
create function app.guard_ph_precool_entry(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and r ->> 'arrival_check_result' = 'pass' $$;
create function app.guard_ph_regrade_done(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and (r ->> 'regrade_done_at') is not null $$;
create function app.guard_ph_release_to_stored(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and r ->> 'held_from_status' = 'stored' $$;
create function app.guard_ph_release_to_registered(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and r ->> 'held_from_status' = 'registered' $$;
create function app.guard_ph_hold_quality(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and coalesce((select hold_type from public.ph_holds h where h.id = coalesce((r ->> 'hold_id')::uuid, (r ->> 'id')::uuid)), '') <> 'food_safety' $$;
create function app.guard_ph_hold_food_safety(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and (select hold_type from public.ph_holds h where h.id = coalesce((r ->> 'hold_id')::uuid, (r ->> 'id')::uuid)) = 'food_safety' $$;
create function app.guard_ph_void_ok(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and (r ->> 'void_requested_by') is not null and (r ->> 'arrival_check_result') is null $$;
create function app.guard_ph_rma_cosign(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and r ->> 'inspection_type' = 'rma' $$;
create function app.guard_ph_hold_evidence(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and coalesce(trim(r ->> 'execution_note'), '') <> '' $$;
-- Issue to a Job Card (SM-IP Released → Issued) and the waste workflow arrive with milestone M2.
create function app.guard_ph_job_cards_built(r jsonb) returns boolean language sql stable as $$ select false $$;
create function app.guard_ph_waste_m2(r jsonb) returns boolean language sql stable as $$ select false $$;

create function app.ph_vehicle_exception_state(p_arrival uuid) returns text
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select case
    when exists (select 1 from public.ph_vehicle_exception_approvals where arrival_id = p_arrival and decision = 'refuse' and voided_at is null) then 'refused'
    when (select count(distinct spec_code) from public.ph_vehicle_exception_approvals
           where arrival_id = p_arrival and decision = 'approve' and voided_at is null) = 3 then 'approved'
    when exists (select 1 from public.ph_vehicle_exception_approvals where arrival_id = p_arrival and voided_at is null) then 'partial'
    else 'none' end
$$;

-- ---------------------------------------------------------------------------------------------
-- Workflows per farm
-- ---------------------------------------------------------------------------------------------
create function app.seed_ph_receiving(p_farm uuid) returns void
language plpgsql
as $$
begin
  if exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'ph_incoming_pallet') then
    return;
  end if;

  perform app.define_workflow(p_farm, 'ph_arrival',
    '[{"code":"draft","ar":"مسودة","en":"Draft","initial":true,"sort":1},
      {"code":"vehicle_hold","ar":"محجوز — المركبة","en":"On hold — vehicle","sort":2},
      {"code":"submitted","ar":"اجتاز البوابة","en":"Passed gate (G1)","sort":3},
      {"code":"not_accepted","ar":"غير مقبول","en":"Not accepted","terminal":true,"sort":4},
      {"code":"closed","ar":"مغلق","en":"Closed","terminal":true,"sort":5}]',
    '[{"from":"draft","to":"vehicle_hold","action":"execute","ph":"arrival.vehicle_inspection","guard":"ph_rpc"},
      {"from":"draft","to":"submitted","action":"execute","ph":"arrival.create","guard":"ph_arrival_ready","actor":"submitted_by"},
      {"from":"vehicle_hold","to":"draft","action":"approve","ph":"arrival.vehicle_exception","guard":"ph_vehicle_approved"},
      {"from":"vehicle_hold","to":"not_accepted","action":"approve","ph":"arrival.vehicle_exception","guard":"ph_vehicle_refused","req":["comment"]},
      {"from":"submitted","to":"closed","action":"execute","ph":"arrival.create","guard":"ph_rpc","actor":"closed_by"}]');

  perform app.define_workflow(p_farm, 'ph_incoming_pallet',
    '[{"code":"registered","ar":"مسجلة","en":"Registered","initial":true,"sort":1},
      {"code":"arrival_rejected","ar":"مرفوضة عند الوصول","en":"Arrival rejected","sort":2},
      {"code":"returned_to_source","ar":"أُعيدت للمصدر","en":"Returned to source","terminal":true,"sort":3},
      {"code":"pre_cooling","ar":"في التبريد الأولي","en":"Pre-cooling","sort":4},
      {"code":"awaiting_qa","ar":"بانتظار ضمان الجودة","en":"Awaiting QA","sort":5},
      {"code":"qa_rejected","ar":"رفضها ضمان الجودة","en":"QA rejected","sort":6},
      {"code":"in_regrade","ar":"قيد إعادة الفرز","en":"In regrade","sort":7},
      {"code":"awaiting_recheck","ar":"بانتظار إعادة الفحص","en":"Awaiting recheck","sort":8},
      {"code":"accepted","ar":"مقبولة","en":"Accepted","sort":9},
      {"code":"stored","ar":"مخزنة","en":"Stored","sort":10},
      {"code":"released","ar":"مُفرج عنها للإنتاج","en":"Released to production","sort":11},
      {"code":"issued","ar":"مصروفة لبطاقة عمل","en":"Issued","sort":12},
      {"code":"consumed","ar":"مستهلكة","en":"Consumed","terminal":true,"sort":13},
      {"code":"on_hold","ar":"محجوزة","en":"On hold","sort":14},
      {"code":"waste","ar":"هدر","en":"Waste","terminal":true,"sort":15},
      {"code":"void","ar":"ملغاة","en":"Void","terminal":true,"sort":16}]',
    '[{"from":"registered","to":"arrival_rejected","action":"execute","ph":"arrival_check.submit","guard":"ph_rpc","req":["reject_destination"]},
      {"from":"arrival_rejected","to":"returned_to_source","action":"execute","ph":"incoming_pallet.record_disposition","guard":"ph_dest_farm","actor":"disposition_by"},
      {"from":"arrival_rejected","to":"waste","action":"execute","ph":"incoming_pallet.record_disposition","guard":"ph_dest_waste","actor":"disposition_by"},
      {"from":"registered","to":"pre_cooling","action":"execute","ph":"precool.record","guard":"ph_precool_entry"},
      {"from":"pre_cooling","to":"awaiting_qa","action":"execute","ph":"precool.record","guard":"ph_rpc"},
      {"from":"awaiting_qa","to":"accepted","action":"approve","ph":"rma.decide","guard":"ph_rpc","differ":["created_by"],"actor":"qa_decided_by"},
      {"from":"awaiting_qa","to":"qa_rejected","action":"approve","ph":"rma.decide","guard":"ph_rpc","differ":["created_by"],"actor":"qa_decided_by","req":["qa_reject_reason"]},
      {"from":"qa_rejected","to":"in_regrade","action":"execute","ph":"regrade.execute","guard":"ph_rpc","actor":"regraded_by"},
      {"from":"in_regrade","to":"awaiting_recheck","action":"execute","ph":"regrade.reweigh","guard":"ph_regrade_done","actor":"reweighed_by"},
      {"from":"awaiting_recheck","to":"accepted","action":"approve","ph":"rma.recheck","guard":"ph_rpc","differ":["regraded_by","created_by","reweighed_by"],"actor":"rechecked_by"},
      {"from":"awaiting_recheck","to":"waste","action":"approve","ph":"rma.recheck","guard":"ph_rpc","differ":["regraded_by","created_by","reweighed_by"],"actor":"rechecked_by"},
      {"from":"accepted","to":"stored","action":"execute","ph":"stock_move.execute","guard":"ph_rpc"},
      {"from":"accepted","to":"stored","action":"approve","ph":"stock_move.override_placement","guard":"ph_rpc"},
      {"from":"stored","to":"released","action":"approve","ph":"qc1.release","guard":"ph_rpc","gate":"OD-17:A","actor":"released_by"},
      {"from":"released","to":"issued","action":"execute","ph":"job_card.record_inputs","guard":"ph_job_cards_built"},
      {"from":"issued","to":"stored","action":"execute","ph":"job_card.record_inputs","guard":"ph_job_cards_built"},
      {"from":"issued","to":"consumed","action":"execute","ph":"job_card.record_inputs","guard":"ph_job_cards_built"},
      {"from":"registered","to":"on_hold","action":"review","ph":"hold.raise","guard":"ph_rpc"},
      {"from":"stored","to":"on_hold","action":"review","ph":"hold.raise","guard":"ph_rpc"},
      {"from":"on_hold","to":"stored","action":"approve","ph":"hold.release","guard":"ph_release_to_stored"},
      {"from":"on_hold","to":"registered","action":"approve","ph":"hold.release","guard":"ph_release_to_registered"},
      {"from":"on_hold","to":"waste","action":"approve","ph":"hold.decide_quality","guard":"ph_hold_quality"},
      {"from":"on_hold","to":"waste","action":"approve","ph":"hold.decide_food_safety","guard":"ph_hold_food_safety"},
      {"from":"registered","to":"void","action":"approve","ph":"incoming_pallet.void_approve","guard":"ph_void_ok","differ":["void_requested_by"],"actor":"void_approved_by"}]');

  perform app.define_workflow(p_farm, 'ph_inspection',
    '[{"code":"submitted","ar":"مُسجّل","en":"Recorded","initial":true,"sort":1},
      {"code":"cosigned","ar":"موقّع بالتشارك","en":"Co-signed","terminal":true,"sort":2}]',
    '[{"from":"submitted","to":"cosigned","action":"verify","ph":"rma.cosign","guard":"ph_rma_cosign","differ":["created_by"],"actor":"cosigned_by"}]');

  perform app.define_workflow(p_farm, 'ph_hold',
    '[{"code":"open","ar":"مفتوح","en":"Open","initial":true,"sort":1},
      {"code":"under_assessment","ar":"قيد التقييم","en":"Under assessment","sort":2},
      {"code":"disposition_decided","ar":"تقرر المصير","en":"Disposition decided","sort":3},
      {"code":"disposition_executed","ar":"نُفذ المصير","en":"Disposition executed","sort":4},
      {"code":"verified","ar":"تم التحقق","en":"Verified","sort":5},
      {"code":"closed","ar":"مغلق","en":"Closed","terminal":true,"sort":6},
      {"code":"cancelled","ar":"ملغى","en":"Cancelled","terminal":true,"sort":7}]',
    '[{"from":"open","to":"under_assessment","action":"review","ph":"hold.assign","guard":"ph_rpc","actor":"assigned_by"},
      {"from":"under_assessment","to":"disposition_decided","action":"approve","ph":"hold.decide_quality","guard":"ph_hold_quality","actor":"decided_by"},
      {"from":"under_assessment","to":"disposition_decided","action":"approve","ph":"hold.decide_food_safety","guard":"ph_hold_food_safety","actor":"decided_by"},
      {"from":"disposition_decided","to":"disposition_executed","action":"execute","ph":"hold.execute","guard":"ph_rpc","actor":"executed_by"},
      {"from":"disposition_executed","to":"verified","action":"verify","ph":"hold.verify","guard":"ph_hold_evidence","actor":"verified_by"},
      {"from":"verified","to":"closed","action":"close","ph":"hold.close","guard":"ph_rpc","actor":"closed_by"},
      {"from":"open","to":"cancelled","action":"close","ph":"hold.cancel","guard":"ph_rpc","req":["comment"]}]');

  perform app.define_workflow(p_farm, 'ph_waste',
    '[{"code":"draft","ar":"مسودة","en":"Draft","initial":true,"sort":1},
      {"code":"awaiting_qc","ar":"بانتظار الجودة","en":"Awaiting QC","sort":2},
      {"code":"returned_to_line","ar":"أُعيد للخط","en":"Returned to line","terminal":true,"sort":3},
      {"code":"qc_approved","ar":"اعتمدته الجودة","en":"QC approved","sort":4},
      {"code":"weighed","ar":"موزون","en":"Weighed","sort":5},
      {"code":"awaiting_top_mgmt","ar":"بانتظار الإدارة العليا","en":"Awaiting top management","sort":6},
      {"code":"removed_on_timeout","ar":"أُزيل بعد انقضاء 24 ساعة","en":"Removed under 24 h rule","sort":7},
      {"code":"awaiting_sign_off","ar":"بانتظار التوقيعات","en":"Awaiting sign-off","sort":8},
      {"code":"signed_off","ar":"مُوقّع","en":"Signed off","sort":9},
      {"code":"erp_posted","ar":"مُرحّل في ERP","en":"ERP posted","sort":10},
      {"code":"disposed","ar":"تم التخلص منه","en":"Disposed","terminal":true,"sort":11}]',
    '[{"from":"draft","to":"awaiting_qc","action":"execute","ph":"waste.create","guard":"ph_waste_m2"},
      {"from":"awaiting_qc","to":"qc_approved","action":"verify","ph":"waste.qc_label","guard":"ph_waste_m2"},
      {"from":"awaiting_qc","to":"returned_to_line","action":"verify","ph":"waste.qc_label","guard":"ph_waste_m2","req":["comment"]},
      {"from":"qc_approved","to":"weighed","action":"execute","ph":"waste.create","guard":"ph_waste_m2"},
      {"from":"weighed","to":"awaiting_sign_off","action":"execute","ph":"waste.create","guard":"ph_waste_m2"},
      {"from":"weighed","to":"awaiting_top_mgmt","action":"execute","ph":"waste.create","guard":"ph_waste_m2"},
      {"from":"awaiting_top_mgmt","to":"awaiting_sign_off","action":"approve","ph":"waste.topmgmt","guard":"ph_waste_m2"},
      {"from":"awaiting_top_mgmt","to":"removed_on_timeout","action":"execute","ph":"waste.topmgmt","guard":"ph_waste_m2"},
      {"from":"removed_on_timeout","to":"awaiting_sign_off","action":"execute","ph":"waste.topmgmt","guard":"ph_waste_m2"},
      {"from":"awaiting_sign_off","to":"signed_off","action":"approve","ph":"waste.signoff_small","guard":"ph_waste_m2"},
      {"from":"signed_off","to":"erp_posted","action":"execute","ph":"waste.erp_ref","guard":"ph_waste_m2"},
      {"from":"erp_posted","to":"disposed","action":"execute","ph":"waste.create","guard":"ph_waste_m2"}]');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create function app.ph_local_date(p_at timestamptz default now()) returns date
language sql stable as $$ select (p_at at time zone 'Asia/Amman')::date $$;

create function app.ph_code(p_farm uuid, p_prefix text, p_width integer, p_at timestamptz default now()) returns text
language sql security definer set search_path = public, app, pg_temp
as $$
  select p_prefix || '-' || to_char(app.ph_local_date(p_at), 'YYMMDD') || '-'
         || lpad(app.ph_next(p_farm, p_prefix || ':' || to_char(app.ph_local_date(p_at), 'YYMMDD'))::text, p_width, '0')
$$;

-- Runs a status change on behalf of a packing-house server function (sets the marker the guards require).
create function app.ph_transition(p_table text, p_id uuid, p_to text, p_comment text default null, p_payload jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v jsonb;
begin
  perform set_config('app.ph_rpc', 'on', true);
  v := public.transition_record(p_table, p_id, p_to, p_payload, p_comment);
  perform set_config('app.ph_rpc', 'off', true);
  return v;
end;
$$;

create function app.ph_template(p_farm uuid, p_type text) returns uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select id from public.ph_inspection_templates
   where farm_id = p_farm and inspection_type = p_type and state = 'in_effect' and voided_at is null
   order by version_no desc limit 1
$$;

-- Notify every holder of a packing-house role (queues are roles; individuals are never invented).
create function app.ph_notify_role(p_farm uuid, p_spec_code text, p_kind text, p_entity_type text, p_entity uuid, p_params jsonb)
returns void
language sql security definer set search_path = public, app, pg_temp
as $$
  insert into public.notifications (farm_id, user_id, kind, entity_type, entity_id, params)
  select distinct p_farm, ur.user_id, p_kind, p_entity_type, p_entity, p_params
    from public.user_roles ur join public.ph_roles pr on pr.role_id = ur.role_id and pr.voided_at is null
   where ur.farm_id = p_farm and pr.spec_code = p_spec_code and ur.voided_at is null
     and ur.valid_from <= now() and (ur.valid_to is null or ur.valid_to > now())
$$;

create function app.ph_farm_of_user() returns uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select ur.farm_id from public.user_roles ur join public.roles r on r.id = ur.role_id
   where ur.user_id = app.current_user_id() and ur.voided_at is null and r.code like 'ph\_%'
     and ur.valid_from <= now() and (ur.valid_to is null or ur.valid_to > now())
   limit 1
$$;

create function app.ph_pallet(p_ref text) returns public.ph_incoming_pallets
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_incoming_pallets;
begin
  select * into r from public.ph_incoming_pallets p
   where (p.id::text = p_ref or upper(p.code) = upper(trim(p_ref))) and p.voided_at is null and app.ph_is_member(p.farm_id);
  if not found then
    raise exception 'Unknown pallet %', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'ph.unknownPallet', 'ref', p_ref)::text;
  end if;
  return r;
end;
$$;

create function app.ph_add_basis(p_basis jsonb, p_gate text, p_result text) returns jsonb
language sql immutable as $$ select coalesce(p_basis, '{}') || jsonb_build_object(split_part(p_gate, ':', 1), p_result) $$;

-- Links unlinked uploads of the current user to a record; returns how many photos/videos were linked.
create function app.ph_link_attachments(p_ids uuid[], p_entity_type text, p_entity uuid, p_farm uuid) returns integer
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v integer;
begin
  if exists (select 1 from unnest(coalesce(p_ids, '{}')) i
              where not exists (select 1 from public.ph_attachments a where a.id = i and a.farm_id = p_farm and a.voided_at is null
                                  and (a.entity_id is null and a.created_by = app.current_user_id()
                                       or (a.entity_type = p_entity_type and a.entity_id = p_entity)))) then
    raise exception 'Attachment not found or already linked to another record' using errcode = 'P0422';
  end if;
  update public.ph_attachments set entity_type = p_entity_type, entity_id = p_entity
   where id = any (coalesce(p_ids, '{}')) and entity_id is null;
  select count(*) into v from public.ph_attachments
   where entity_type = p_entity_type and entity_id = p_entity and kind in ('photo', 'video') and voided_at is null;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-01 Arrival & incoming vehicle (G1)
-- ---------------------------------------------------------------------------------------------
create function public.ph_create_arrival(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm   uuid := app.ph_farm_of_user();
  v_src    public.ph_sources;
  v_id     uuid := gen_random_uuid();
  v_code   text;
  v_cut    text;
  v_late   boolean;
  v_basis  text;
  v_missing text[] := '{}';
begin
  v_basis := app.ph_authorize(v_farm, 'arrival.create');
  select * into v_src from public.ph_sources where id = (p ->> 'source_id')::uuid and farm_id = v_farm and voided_at is null;
  if not found then
    raise exception 'Choose the source (block/section or supplier)' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.v01', 'missing', array['source_id'])::text;
  end if;
  if v_src.verification_status <> 'verified' then
    raise exception 'Source % is not approved yet', v_src.code using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.notApproved', 'record', v_src.code)::text;
  end if;
  if coalesce(trim(p ->> 'vehicle_plate'), '') = '' then v_missing := v_missing || 'vehicle_plate'::text; end if;
  if coalesce(trim(p ->> 'driver_name'), '') = '' then v_missing := v_missing || 'driver_name'::text; end if;
  -- V-01: harvesting-tag fields (own farm) or supplier reference (supplier loads).
  if v_src.kind = 'own_farm' then
    if (p ->> 'variety_id') is null then v_missing := v_missing || 'variety_id'::text; end if;
    if (p ->> 'harvest_date') is null then v_missing := v_missing || 'harvest_date'::text; end if;
    if (p ->> 'harvest_time') is null then v_missing := v_missing || 'harvest_time'::text; end if;
    if coalesce(trim(p ->> 'harvest_supervisor'), '') = '' then v_missing := v_missing || 'harvest_supervisor'::text; end if;
  elsif coalesce(trim(p ->> 'supplier_ref'), '') = '' then
    v_missing := v_missing || 'supplier_ref'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception 'Harvesting-tag / arrival fields missing (V-01, E-01): %', array_to_string(v_missing, ', ')
      using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', v_missing)::text;
  end if;
  if (p ->> 'variety_id') is not null and not exists (select 1 from public.ph_varieties where id = (p ->> 'variety_id')::uuid
                                                       and farm_id = v_farm and verification_status = 'verified' and voided_at is null) then
    raise exception 'Variety not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved')::text;
  end if;
  if (p ->> 'harvest_date')::date > app.ph_local_date() then
    raise exception 'Harvest date cannot be in the future' using errcode = 'P0422';
  end if;

  -- V-03: receipt after the documented last-harvest time is flagged and needs a reason.
  v_cut := app.ph_param_text(v_farm, 'last_harvest_receipt_time');
  v_late := v_cut is not null and (now() at time zone 'Asia/Amman')::time > v_cut::time;
  if v_late and coalesce(trim(p ->> 'late_reason'), '') = '' then
    raise exception 'Arrival after % needs a reason (V-03)', v_cut using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.v03', 'cutoff', v_cut)::text;
  end if;

  v_code := app.ph_code(v_farm, 'ARR', 4);
  insert into public.ph_arrivals (id, farm_id, code, gate_no, source_id, variety_id, harvest_date, harvest_time, harvest_supervisor,
                                  supplier_ref, vehicle_plate, driver_name, dispatch_note_no, dispatched_pallets, dispatched_boxes,
                                  late_flag, late_reason, remarks, decision_basis)
  values (v_id, v_farm, v_code, nullif(trim(p ->> 'gate_no'), ''), v_src.id, (p ->> 'variety_id')::uuid, (p ->> 'harvest_date')::date,
          (p ->> 'harvest_time')::time, nullif(trim(p ->> 'harvest_supervisor'), ''), nullif(trim(p ->> 'supplier_ref'), ''),
          trim(p ->> 'vehicle_plate'), trim(p ->> 'driver_name'), nullif(trim(p ->> 'dispatch_note_no'), ''),
          (p ->> 'dispatched_pallets')::int, (p ->> 'dispatched_boxes')::int,
          v_late, case when v_late then trim(p ->> 'late_reason') end, nullif(trim(p ->> 'remarks'), ''),
          jsonb_build_object('arrival.create', v_basis));
  return jsonb_build_object('id', v_id, 'code', v_code, 'late', v_late);
end;
$$;

create function public.ph_record_vehicle_inspection(p_arrival uuid, p_result text, p_checklist jsonb, p_reason text default null,
                                                     p_remarks text default null)
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  a      public.ph_arrivals;
  v_id   uuid := gen_random_uuid();
  v_code text;
begin
  select * into a from public.ph_arrivals where id = p_arrival and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Arrival not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(a.farm_id, 'arrival.vehicle_inspection');
  if a.status <> 'draft' or a.vehicle_result is not null then
    raise exception 'The vehicle of this arrival has already been inspected' using errcode = 'P0422';
  end if;
  if p_result not in ('pass', 'fail') then raise exception 'Result must be pass or fail' using errcode = 'P0422'; end if;

  v_code := app.ph_code(a.farm_id, 'VIN', 4);
  insert into public.ph_inspections (id, farm_id, code, inspection_type, template_id, arrival_id, result, reason, checklist, remarks, signature_meaning)
  values (v_id, a.farm_id, v_code, 'vehicle_in', app.ph_template(a.farm_id, 'vehicle_in'), a.id, p_result, nullif(trim(p_reason), ''),
          coalesce(p_checklist, '{}'), nullif(trim(p_remarks), ''), 'recorded');
  update public.ph_arrivals set vehicle_result = p_result, vehicle_inspection_id = v_id where id = a.id;
  if p_result = 'fail' then
    perform app.ph_transition('ph_arrivals', a.id, 'vehicle_hold', p_reason);
    foreach v_code in array array['PHM', 'QAM', 'TOP'] loop
      perform app.ph_notify_role(a.farm_id, v_code, 'ph_vehicle_exception', 'ph_arrivals', a.id, jsonb_build_object('code', a.code));
    end loop;
  end if;
  return jsonb_build_object('inspection_id', v_id, 'result', p_result);
end;
$$;

-- E-02: PHM, QA and top management each approve; any one refusal closes the arrival as Not accepted.
create function public.ph_vehicle_exception_decide(p_arrival uuid, p_decision text, p_comment text, p_role text default null)
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  a       public.ph_arrivals;
  v_role  text;
  v_state text;
begin
  select * into a from public.ph_arrivals where id = p_arrival and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Arrival not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(a.farm_id, 'arrival.vehicle_exception');
  if a.status <> 'vehicle_hold' then raise exception 'The arrival is not on vehicle hold' using errcode = 'P0422'; end if;
  if p_decision not in ('approve', 'refuse') then raise exception 'Decision must be approve or refuse' using errcode = 'P0422'; end if;
  if coalesce(trim(p_comment), '') = '' then raise exception 'A comment is required' using errcode = 'P0422'; end if;
  if exists (select 1 from public.ph_vehicle_exception_approvals where arrival_id = a.id and approved_by = app.current_user_id() and voided_at is null) then
    raise exception 'You have already signed this exception; the other parties must sign' using errcode = 'P0423',
      detail = jsonb_build_object('key', 'ph.decision.alreadySigned')::text;
  end if;
  select r into v_role from unnest(app.ph_user_spec_roles(app.current_user_id(), a.farm_id)) r
   where r in ('PHM', 'QAM', 'TOP') and (p_role is null or r = p_role)
     and app.ph_permission_basis(app.current_user_id(), a.farm_id, 'arrival.vehicle_exception') is not null
     and exists (select 1 from public.ph_permission_cells c where c.farm_id = a.farm_id and c.action_key = 'arrival.vehicle_exception'
                   and c.spec_code = r and c.voided_at is null and (c.state = 'active' or (c.state = 'proposed' and app.ph_proposals_in_effect(a.farm_id))))
     and not exists (select 1 from public.ph_vehicle_exception_approvals x where x.arrival_id = a.id and x.spec_code = r and x.voided_at is null)
   order by r limit 1;
  if v_role is null then
    raise exception 'Your role has already signed this exception' using errcode = 'P0422';
  end if;
  insert into public.ph_vehicle_exception_approvals (farm_id, arrival_id, spec_code, decision, approved_by, comment)
  values (a.farm_id, a.id, v_role, p_decision, app.current_user_id(), p_comment);
  v_state := app.ph_vehicle_exception_state(a.id);
  if v_state = 'refused' then
    perform app.ph_transition('ph_arrivals', a.id, 'not_accepted', p_comment);
  elsif v_state = 'approved' then
    perform app.ph_transition('ph_arrivals', a.id, 'draft', p_comment);
  end if;
  return jsonb_build_object('role', v_role, 'state', v_state);
end;
$$;

-- G1 passed: tag complete and vehicle passed (or exception approved). Pallets can now be registered.
create function public.ph_submit_arrival(p_arrival uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare a public.ph_arrivals;
begin
  select * into a from public.ph_arrivals where id = p_arrival and voided_at is null and app.ph_is_member(farm_id);
  if not found then raise exception 'Arrival not found' using errcode = 'P0404'; end if;
  if a.status = 'draft' and a.vehicle_result is null then
    raise exception 'Record the incoming vehicle inspection first (G1)' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.g1.vehicle')::text;
  end if;
  return app.ph_transition('ph_arrivals', a.id, 'submitted');
end;
$$;

create function public.ph_close_arrival(p_arrival uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare a public.ph_arrivals;
begin
  select * into a from public.ph_arrivals where id = p_arrival and voided_at is null and app.ph_is_member(farm_id);
  if not found then raise exception 'Arrival not found' using errcode = 'P0404'; end if;
  if not exists (select 1 from public.ph_incoming_pallets where arrival_id = a.id and voided_at is null) then
    raise exception 'Register the pallets of this arrival before closing it' using errcode = 'P0422';
  end if;
  return app.ph_transition('ph_arrivals', a.id, 'closed', p_comment);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-02 Weighing & Incoming Pallet registration (CP-01 under OD-01; IDs under OD-03)
-- ---------------------------------------------------------------------------------------------
create function public.ph_register_pallet(p_arrival uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  a        public.ph_arrivals;
  c        public.ph_crops;
  s        public.ph_sources;
  sc       public.ph_equipment;
  v_id     uuid := gen_random_uuid();
  v_basis  jsonb;
  v_code   text;
  v_kg     numeric := (p ->> 'net_kg')::numeric;
  v_boxes  integer;
  v_tol    numeric;
  v_note   text;
  v_warn   jsonb := '[]';
  v_harv   timestamptz;
begin
  select * into a from public.ph_arrivals where id = p_arrival and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Arrival not found' using errcode = 'P0404'; end if;
  v_basis := jsonb_build_object('incoming_pallet.register', app.ph_authorize(a.farm_id, 'incoming_pallet.register'));
  -- Registering every pallet before QA acceptance is option B of OD-01; who issues IDs is OD-03.
  v_basis := app.ph_add_basis(v_basis, 'OD-01', app.ph_decision_gate(a.farm_id, 'OD-01:B'));
  v_basis := app.ph_add_basis(v_basis, 'OD-03', app.ph_decision_gate(a.farm_id, 'OD-03:A'));
  if a.status <> 'submitted' then
    raise exception 'Pallets are registered only after the arrival passes the gate (G1)' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.g1.notPassed', 'status', a.status)::text;
  end if;

  select * into c from public.ph_crops where id = coalesce((p ->> 'crop_id')::uuid,
      (select app.ph_current_crop(a.farm_id, v.crop_code) from public.ph_varieties v where v.id = a.variety_id))
    and farm_id = a.farm_id and voided_at is null;
  if not found then raise exception 'Choose the crop' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['crop_id'])::text; end if;
  if c.verification_status <> 'verified' or c.superseded_at is not null then
    raise exception 'Crop % is not approved for receiving (FR-MD-01)', c.code using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.notApproved', 'record', c.code)::text;
  end if;
  select * into s from public.ph_sources where id = coalesce((p ->> 'source_id')::uuid, a.source_id) and farm_id = a.farm_id
     and verification_status = 'verified' and voided_at is null;
  if not found then raise exception 'Source not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved')::text; end if;

  -- V-02: net weight > 0 with the scale ID.
  select * into sc from public.ph_equipment where id = (p ->> 'scale_id')::uuid and farm_id = a.farm_id and kind = 'scale' and voided_at is null;
  if not found then raise exception 'Choose the scale used (V-02)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v02')::text; end if;
  if v_kg is null or v_kg <= 0 then
    raise exception 'Net weight must be greater than 0 (V-02)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v02')::text;
  end if;
  v_boxes := coalesce((p ->> 'box_count')::int, c.boxes_per_pallet);
  if v_boxes is null or v_boxes <= 0 then
    raise exception 'Enter the box count' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.boxes')::text;
  end if;

  -- V-21 plausibility (non-blocking, needs confirmation) only once OD-29 has set a tolerance.
  v_tol := app.ph_param(a.farm_id, 'weight_plausibility_tolerance_pct');
  if v_tol is null or c.nominal_kg_per_pallet is null then
    v_note := 'Not checked: plausibility tolerance pending OD-29';
  elsif abs(v_kg - c.nominal_kg_per_pallet) / c.nominal_kg_per_pallet * 100 > v_tol then
    if not coalesce((p ->> 'confirm_plausibility')::boolean, false) then
      raise exception 'Weight differs from the nominal % kg by more than % %%; confirm to continue (V-21)', c.nominal_kg_per_pallet, v_tol
        using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v21', 'nominal', c.nominal_kg_per_pallet, 'tolerance', v_tol)::text;
    end if;
    v_note := 'Outside plausibility tolerance; confirmed by the registrar';
    v_warn := v_warn || jsonb_build_object('key', 'ph.v21');
  else
    v_note := 'Within plausibility tolerance';
  end if;

  if s.kind = 'own_farm' and a.harvest_date is not null and a.harvest_time is not null then
    v_harv := (a.harvest_date + a.harvest_time) at time zone 'Asia/Amman';
  elsif a.harvest_date is not null then
    v_harv := (a.harvest_date::timestamp) at time zone 'Asia/Amman';
  end if;

  -- Printed number per crop / source / day (SOP-RC; format proposed in §7.1).
  v_code := coalesce(c.label_code, upper(c.code)) || '-' || to_char(app.ph_local_date(), 'YYMMDD') || '-' || upper(s.code) || '-'
            || lpad(app.ph_next(a.farm_id, 'ip:' || c.code || ':' || s.code || ':' || to_char(app.ph_local_date(), 'YYMMDD'))::text, 3, '0');

  insert into public.ph_incoming_pallets (id, farm_id, code, arrival_id, crop_id, variety_id, source_id, harvest_at, box_count, net_kg,
                                          weight_unit_id, scale_id, calibration_flag, plausibility_note, decision_basis)
  values (v_id, a.farm_id, v_code, a.id, c.id, a.variety_id, s.id, v_harv, v_boxes, v_kg,
          (select id from public.units where farm_id = a.farm_id and code = 'kg'), sc.id,
          sc.calibration_due_on is null or sc.calibration_due_on < app.ph_local_date(), v_note, v_basis);
  if sc.calibration_due_on is null or sc.calibration_due_on < app.ph_local_date() then
    v_warn := v_warn || jsonb_build_object('key', 'ph.calibration', 'scale', sc.code);
  end if;
  perform app.ph_notify_role(a.farm_id, 'QCI', 'ph_arrival_check_due', 'ph_incoming_pallets', v_id, jsonb_build_object('code', v_code));
  return jsonb_build_object('id', v_id, 'code', v_code, 'warnings', v_warn);
end;
$$;

-- Weight correction before the QA decision (reason mandatory). After the decision: correction record (milestone M4).
create function public.ph_edit_pallet_weight(p_pallet uuid, p_net_kg numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_incoming_pallets;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(r.farm_id, 'incoming_pallet.edit_weight');
  if r.status not in ('registered', 'pre_cooling', 'awaiting_qa') then
    raise exception 'After the QA decision a weight is changed only through a correction record (later milestone)' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.afterQa')::text;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422'; end if;
  if p_net_kg is null or p_net_kg <= 0 then raise exception 'Net weight must be greater than 0 (V-02)' using errcode = 'P0422'; end if;
  perform set_config('app.audit_comment', p_reason, true);
  update public.ph_incoming_pallets set net_kg = p_net_kg where id = r.id;
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('id', r.id, 'net_kg', p_net_kg);
end;
$$;

-- Void a pallet registered in error: DEC requests, WHM approves (maker ≠ checker), only before any check.
create function public.ph_request_void(p_pallet uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_incoming_pallets;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(r.farm_id, 'incoming_pallet.void_request');
  if r.status <> 'registered' or r.arrival_check_result is not null then
    raise exception 'A pallet can be voided only before any check (FR-RC-06)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.voidAfterCheck')::text;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422'; end if;
  update public.ph_incoming_pallets set void_requested_by = app.current_user_id(), void_request_reason = trim(p_reason) where id = r.id;
  perform app.ph_notify_role(r.farm_id, 'WHM', 'ph_void_requested', 'ph_incoming_pallets', r.id, jsonb_build_object('code', r.code));
  return jsonb_build_object('id', r.id, 'void_requested', true);
end;
$$;

create function public.ph_approve_void(p_pallet uuid, p_comment text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_incoming_pallets;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id);
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  if r.void_requested_by is null then raise exception 'No void request on this pallet' using errcode = 'P0422'; end if;
  if coalesce(trim(p_comment), '') = '' then raise exception 'A comment is required' using errcode = 'P0422'; end if;
  return app.ph_transition('ph_incoming_pallets', r.id, 'void', p_comment);
end;
$$;

-- Receiving label (SOP-RC fields + proposed additions); every print logged with its content (AT-07).
create function public.ph_print_label(p_pallet uuid, p_reprint_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_incoming_pallets;
  v       jsonb;
  v_basis text;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(r.farm_id, 'incoming_pallet.print_label');
  v_basis := app.ph_decision_gate(r.farm_id, 'OD-03:A');
  if r.status in ('void', 'returned_to_source', 'waste', 'consumed') then
    raise exception 'No label for a pallet in status %', r.status using errcode = 'P0422';
  end if;
  if r.label_print_count > 0 and coalesce(trim(p_reprint_reason), '') = '' then
    raise exception 'A reprint needs a reason (logged)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.reprintReason')::text;
  end if;
  select jsonb_build_object(
           'pallet_no', r.code, 'source', s.code, 'block', s.block_code, 'section', s.section_code, 'supplier', s.supplier_name,
           'received_at', to_char(r.received_at at time zone 'Asia/Amman', 'YYYY-MM-DD HH24:MI'), 'net_kg', r.net_kg,
           'crop', c.name_ar, 'crop_en', c.name_en, 'variety', v2.name_ar, 'variety_en', v2.name_en,
           'harvest_at', to_char(r.harvest_at at time zone 'Asia/Amman', 'YYYY-MM-DD HH24:MI'), 'status', r.status,
           'barcode', null, 'barcode_note', 'Barcode type pending OD-20', 'id_basis', v_basis)
    into v
    from public.ph_sources s, public.ph_crops c left join public.ph_varieties v2 on v2.id = r.variety_id
   where s.id = r.source_id and c.id = r.crop_id;
  insert into public.ph_label_prints (farm_id, entity_type, entity_id, label_type, content, is_reprint, reason)
  values (r.farm_id, 'ph_incoming_pallets', r.id, 'receiving', v, r.label_print_count > 0, nullif(trim(p_reprint_reason), ''));
  update public.ph_incoming_pallets set label_print_count = label_print_count + 1 where id = r.id;
  return v || jsonb_build_object('print_no', r.label_print_count + 1);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-03 Arrival visual check (G2): checklist per arrival, Pass / Reject per pallet; reject needs a destination.
-- ---------------------------------------------------------------------------------------------
create function public.ph_record_arrival_check(p_arrival uuid, p_checklist jsonb, p_results jsonb, p_product_temp numeric default null,
                                               p_remarks text default null, p_attachment_ids uuid[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  a        public.ph_arrivals;
  v_id     uuid := gen_random_uuid();
  v_code   text;
  x        jsonb;
  r        public.ph_incoming_pallets;
  v_pass   integer := 0;
  v_rej    integer := 0;
begin
  select * into a from public.ph_arrivals where id = p_arrival and voided_at is null and app.ph_is_member(farm_id);
  if not found then raise exception 'Arrival not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(a.farm_id, 'arrival_check.submit');
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then
    raise exception 'Record a result for at least one pallet' using errcode = 'P0422';
  end if;
  for x in select * from jsonb_array_elements(p_results) loop
    select * into r from public.ph_incoming_pallets where id = (x ->> 'pallet_id')::uuid and arrival_id = a.id and voided_at is null;
    if not found then raise exception 'Pallet % is not part of arrival %', x ->> 'pallet_id', a.code using errcode = 'P0422'; end if;
    if r.status <> 'registered' or r.arrival_check_result is not null then
      raise exception 'Pallet % already has an arrival-check result', r.code using errcode = 'P0422';
    end if;
    if x ->> 'result' not in ('pass', 'reject') then raise exception 'Result must be pass or reject' using errcode = 'P0422'; end if;
    if x ->> 'result' = 'reject' and coalesce(x ->> 'destination', '') not in ('farm_or_supplier', 'waste_area') then
      raise exception 'A rejected pallet needs a destination: farm/supplier or waste area (ST-03)' using errcode = 'P0422',
        detail = jsonb_build_object('key', 'ph.g2.destination', 'pallet', r.code)::text;
    end if;
  end loop;

  v_code := app.ph_code(a.farm_id, 'ARC', 4);
  select count(*) filter (where e ->> 'result' = 'pass'), count(*) filter (where e ->> 'result' = 'reject')
    into v_pass, v_rej from jsonb_array_elements(p_results) e;
  insert into public.ph_inspections (id, farm_id, code, inspection_type, template_id, arrival_id, result, reason, checklist,
                                     product_temp_c, remarks, signature_meaning)
  values (v_id, a.farm_id, v_code, 'arrival', app.ph_template(a.farm_id, 'arrival'), a.id,
          case when v_rej = 0 then 'pass' when v_pass = 0 then 'reject' else 'mixed' end,
          case when v_rej > 0 then coalesce(nullif(trim(p_remarks), ''), 'Rejected at arrival check') end,
          coalesce(p_checklist, '{}'), p_product_temp, nullif(trim(p_remarks), ''), 'recorded');
  perform app.ph_link_attachments(p_attachment_ids, 'ph_inspections', v_id, a.farm_id);

  for x in select * from jsonb_array_elements(p_results) loop
    insert into public.ph_inspection_subjects (farm_id, inspection_id, pallet_id, result, destination, remarks)
    values (a.farm_id, v_id, (x ->> 'pallet_id')::uuid, x ->> 'result', nullif(x ->> 'destination', ''), nullif(trim(x ->> 'remarks'), ''));
    update public.ph_incoming_pallets
       set arrival_check_id = v_id, arrival_check_result = x ->> 'result',
           reject_destination = case when x ->> 'result' = 'reject' then x ->> 'destination' end
     where id = (x ->> 'pallet_id')::uuid;
    if x ->> 'result' = 'reject' then
      perform app.ph_transition('ph_incoming_pallets', (x ->> 'pallet_id')::uuid, 'arrival_rejected', x ->> 'remarks');
      perform app.ph_notify_role(a.farm_id, 'PHM', 'ph_arrival_rejected', 'ph_incoming_pallets', (x ->> 'pallet_id')::uuid,
                                 jsonb_build_object('code', (select code from public.ph_incoming_pallets where id = (x ->> 'pallet_id')::uuid)));
      perform app.ph_notify_role(a.farm_id, 'FRM', 'ph_arrival_rejected', 'ph_incoming_pallets', (x ->> 'pallet_id')::uuid,
                                 jsonb_build_object('code', (select code from public.ph_incoming_pallets where id = (x ->> 'pallet_id')::uuid)));
    end if;
  end loop;
  return jsonb_build_object('inspection_id', v_id, 'code', v_code, 'passed', v_pass, 'rejected', v_rej);
end;
$$;

-- E-03: record what physically happened to an arrival-rejected pallet (returned to source, or to the waste area).
create function public.ph_record_disposition(p_pallet uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r     public.ph_incoming_pallets;
  v_wr  uuid;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  if r.status <> 'arrival_rejected' then raise exception 'Only arrival-rejected pallets get a disposition here' using errcode = 'P0422'; end if;
  if r.reject_destination = 'waste_area' then
    v_wr := app.ph_create_waste(r.farm_id, 'incoming_pallet', r.id, r.crop_id, r.net_kg, 'Arrival check rejection (E-03)');
    update public.ph_incoming_pallets set waste_record_id = v_wr where id = r.id;
    return app.ph_transition('ph_incoming_pallets', r.id, 'waste', p_comment) || jsonb_build_object('waste_record_id', v_wr);
  end if;
  return app.ph_transition('ph_incoming_pallets', r.id, 'returned_to_source', p_comment);
end;
$$;

create function app.ph_create_waste(p_farm uuid, p_source_type text, p_source uuid, p_crop uuid, p_reference_kg numeric, p_origin text)
returns uuid
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.ph_waste_records (id, farm_id, code, category, source_type, source_id, crop_id, reference_kg, origin)
  values (v_id, p_farm, app.ph_code(p_farm, 'WR', 4), 'processed', p_source_type, p_source, p_crop, p_reference_kg, p_origin);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-04 Pre-cooling: scan in after G2 pass, scan out; dwell above the documented maximum alerts the PHM (V-04, E-05).
-- ---------------------------------------------------------------------------------------------
create function public.ph_precool_scan(p_pallet text, p_direction text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_incoming_pallets;
  v_loc   public.ph_locations;
  v_basis text;
  v_occ   integer;
  v_dwell numeric;
  v_max   numeric;
  v_warn  jsonb := '[]';
begin
  r := app.ph_pallet(p_pallet);
  v_basis := app.ph_authorize(r.farm_id, 'precool.record');
  if p_direction = 'in' then
    if r.status <> 'registered' or r.arrival_check_result is distinct from 'pass' then
      raise exception 'Pallet % has not passed the arrival check (G2)', r.code using errcode = 'P0422',
        detail = jsonb_build_object('key', 'ph.g2.notPassed', 'pallet', r.code)::text;
    end if;
    select * into v_loc from public.ph_locations where farm_id = r.farm_id and purpose = 'precooling' and verification_status = 'verified'
       and voided_at is null order by sort_order limit 1;
    if not found then raise exception 'No approved pre-cooling location' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.noLocation')::text; end if;
    select count(*) into v_occ from public.ph_incoming_pallets where location_id = v_loc.id and status = 'pre_cooling';
    update public.ph_incoming_pallets set precool_in_at = now(), location_id = v_loc.id where id = r.id;
    insert into public.ph_stock_moves (farm_id, pallet_id, from_location_id, to_location_id, reason, over_capacity, permission_basis)
    values (r.farm_id, r.id, r.location_id, v_loc.id, 'Pre-cooling entry', v_loc.capacity_pallets is not null and v_occ >= v_loc.capacity_pallets, v_basis);
    if v_loc.capacity_pallets is not null and v_occ >= v_loc.capacity_pallets then
      v_warn := v_warn || jsonb_build_object('key', 'ph.v08', 'capacity', v_loc.capacity_pallets, 'occupancy', v_occ);
    end if;
    perform app.ph_transition('ph_incoming_pallets', r.id, 'pre_cooling');
    return jsonb_build_object('id', r.id, 'code', r.code, 'status', 'pre_cooling', 'warnings', v_warn);
  elsif p_direction = 'out' then
    if r.status <> 'pre_cooling' then raise exception 'Pallet % is not in pre-cooling', r.code using errcode = 'P0422'; end if;
    v_dwell := round(extract(epoch from (now() - r.precool_in_at)) / 60, 1);
    v_max := app.ph_param(r.farm_id, 'precool_max_dwell_minutes');
    update public.ph_incoming_pallets set precool_out_at = now(), location_id = null where id = r.id;
    insert into public.ph_stock_moves (farm_id, pallet_id, from_location_id, to_location_id, reason, permission_basis)
    values (r.farm_id, r.id, r.location_id, null, 'Pre-cooling exit — awaiting QA sample', v_basis);
    perform app.ph_transition('ph_incoming_pallets', r.id, 'awaiting_qa');
    if v_max is not null and v_dwell > v_max then
      perform app.ph_notify_role(r.farm_id, 'PHM', 'ph_dwell_exceeded', 'ph_incoming_pallets', r.id,
                                 jsonb_build_object('code', r.code, 'minutes', v_dwell, 'max', v_max));
      v_warn := v_warn || jsonb_build_object('key', 'ph.v04', 'minutes', v_dwell, 'max', v_max);
    end if;
    perform app.ph_notify_role(r.farm_id, 'QAO', 'ph_rma_due', 'ph_incoming_pallets', r.id, jsonb_build_object('code', r.code));
    return jsonb_build_object('id', r.id, 'code', r.code, 'status', 'awaiting_qa', 'dwell_minutes', v_dwell, 'warnings', v_warn);
  end if;
  raise exception 'Direction must be in or out' using errcode = 'P0422';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-05 QA raw-material acceptance (G3) and the regrade loop (E-04)
-- ---------------------------------------------------------------------------------------------
create function app.ph_assign_lot(p_pallet uuid) returns text
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r      public.ph_incoming_pallets;
  c      public.ph_crops;
  s      public.ph_sources;
  v_gate text;
  v_lot  uuid;
  v_code text;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet;
  -- OD-02: lot at QA acceptance under options A and C; under B (or while open) no raw lot.
  begin
    v_gate := app.ph_decision_gate(r.farm_id, 'OD-02:A|C');
  exception when sqlstate 'P0428' then
    return null;
  end;
  if r.harvest_at is null then
    return null;
  end if;
  select * into c from public.ph_crops where id = r.crop_id;
  select * into s from public.ph_sources where id = r.source_id;
  v_code := 'L-' || coalesce(c.label_code, upper(c.code)) || '-' || to_char(app.ph_local_date(r.harvest_at), 'YYMMDD') || '-' || upper(s.code);
  select id into v_lot from public.ph_lots where farm_id = r.farm_id and code = v_code and voided_at is null;
  if v_lot is null then
    insert into public.ph_lots (farm_id, code, crop_id, source_id, harvest_date, decision_basis)
    values (r.farm_id, v_code, r.crop_id, r.source_id, app.ph_local_date(r.harvest_at), v_gate) returning id into v_lot;
  end if;
  update public.ph_incoming_pallets set lot_id = v_lot, decision_basis = app.ph_add_basis(decision_basis, 'OD-02', v_gate) where id = r.id;
  return v_code;
end;
$$;

create function public.ph_submit_rma(p_pallets uuid[], p_decision text, p_checklist jsonb, p_product_temp numeric, p_sample_note text,
                                     p_reason text, p_attachment_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm   uuid;
  v_id     uuid := gen_random_uuid();
  v_code   text;
  r        public.ph_incoming_pallets;
  v_photos integer;
  v_lots   text[] := '{}';
  v_lot    text;
  v_first  public.ph_incoming_pallets;
  v_p      uuid;
begin
  if coalesce(cardinality(p_pallets), 0) = 0 then raise exception 'Select the pallets sampled' using errcode = 'P0422'; end if;
  select * into v_first from public.ph_incoming_pallets where id = p_pallets[1] and voided_at is null and app.ph_is_member(farm_id);
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  v_farm := v_first.farm_id;
  perform app.ph_authorize(v_farm, 'rma.submit');
  perform app.ph_authorize(v_farm, 'rma.decide');
  if p_decision not in ('accept', 'reject') then raise exception 'Decision must be accept or reject' using errcode = 'P0422'; end if;
  if p_decision = 'reject' and coalesce(trim(p_reason), '') = '' then raise exception 'A rejection needs a reason' using errcode = 'P0422'; end if;
  -- One RMA covers one section/source and harvest day of one crop (SOP-RC: sample per section).
  if exists (select 1 from public.ph_incoming_pallets p where p.id = any (p_pallets)
              and (p.farm_id <> v_farm or p.status <> 'awaiting_qa' or p.voided_at is not null or p.crop_id <> v_first.crop_id
                   or p.source_id <> v_first.source_id
                   or app.ph_local_date(coalesce(p.harvest_at, p.received_at)) <> app.ph_local_date(coalesce(v_first.harvest_at, v_first.received_at)))) then
    raise exception 'All pallets of one RMA must be awaiting QA and share crop, source and harvest day' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.rma.mixed')::text;
  end if;

  v_code := app.ph_code(v_farm, 'RMA', 4);
  insert into public.ph_inspections (id, farm_id, code, inspection_type, template_id, result, reason, checklist, product_temp_c, sample_note,
                                     tolerance_basis, qam_review_flag, remarks, signature_meaning)
  values (v_id, v_farm, v_code, 'rma', app.ph_template(v_farm, 'rma'), p_decision, nullif(trim(p_reason), ''), coalesce(p_checklist, '{}'),
          p_product_temp, nullif(trim(p_sample_note), ''),
          -- FR-QG-01: no tolerance set exists while OD-05 is open → "Accepted — no tolerance set", flagged for QAM.
          'no_tolerance_set', p_decision = 'accept', null, case p_decision when 'accept' then 'approved' else 'rejected' end);
  -- V-23: photo / video evidence is mandatory on raw-material acceptance.
  v_photos := app.ph_link_attachments(p_attachment_ids, 'ph_inspections', v_id, v_farm);
  if v_photos = 0 then
    raise exception 'Attach at least one photo or video of the sample (V-23)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v23')::text;
  end if;

  foreach v_p in array p_pallets loop
    insert into public.ph_inspection_subjects (farm_id, inspection_id, pallet_id, result)
    values (v_farm, v_id, v_p, p_decision);
    update public.ph_incoming_pallets set rma_id = v_id,
           qa_reject_reason = case when p_decision = 'reject' then trim(p_reason) end where id = v_p;
    perform app.ph_transition('ph_incoming_pallets', v_p, case p_decision when 'accept' then 'accepted' else 'qa_rejected' end, p_reason);
    if p_decision = 'accept' then
      v_lot := app.ph_assign_lot(v_p);
      if v_lot is not null and not v_lot = any (v_lots) then v_lots := v_lots || v_lot; end if;
    else
      select * into r from public.ph_incoming_pallets where id = v_p;
      perform app.ph_notify_role(v_farm, 'ENG', 'ph_regrade_due', 'ph_incoming_pallets', r.id, jsonb_build_object('code', r.code));
      perform app.ph_notify_role(v_farm, 'PHM', 'ph_qa_rejected', 'ph_incoming_pallets', r.id, jsonb_build_object('code', r.code));
    end if;
  end loop;
  perform app.ph_notify_role(v_farm, 'QCI', 'ph_rma_cosign_due', 'ph_inspections', v_id, jsonb_build_object('code', v_code));
  return jsonb_build_object('inspection_id', v_id, 'code', v_code, 'lots', v_lots, 'no_tolerance_set', true);
end;
$$;

create function public.ph_cosign_rma(p_inspection uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare i public.ph_inspections;
begin
  select * into i from public.ph_inspections where id = p_inspection and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Inspection not found' using errcode = 'P0404'; end if;
  update public.ph_inspections set cosign_comment = nullif(trim(p_comment), '') where id = i.id;
  return app.ph_transition('ph_inspections', i.id, 'cosigned', p_comment);
end;
$$;

create function public.ph_start_regrade(p_pallet uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_incoming_pallets;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id);
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  return app.ph_transition('ph_incoming_pallets', r.id, 'in_regrade');
end;
$$;

create function public.ph_complete_regrade(p_pallet uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_incoming_pallets;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(r.farm_id, 'regrade.execute');
  if r.status <> 'in_regrade' then raise exception 'Pallet is not in regrade' using errcode = 'P0422'; end if;
  if r.regraded_by is distinct from app.current_user_id() then
    raise exception 'The engineer who started the regrade marks it complete' using errcode = 'P0403';
  end if;
  perform set_config('app.audit_comment', coalesce(p_note, ''), true);
  update public.ph_incoming_pallets set regrade_done_at = now() where id = r.id;
  perform set_config('app.audit_comment', '', true);
  perform app.ph_notify_role(r.farm_id, 'DEC', 'ph_reweigh_due', 'ph_incoming_pallets', r.id, jsonb_build_object('code', r.code));
  return jsonb_build_object('id', r.id, 'regrade_done', true);
end;
$$;

create function public.ph_reweigh(p_pallet uuid, p_net_kg numeric, p_scale uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r  public.ph_incoming_pallets;
  sc public.ph_equipment;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  select * into sc from public.ph_equipment where id = p_scale and farm_id = r.farm_id and kind = 'scale' and voided_at is null;
  if not found then raise exception 'Choose the scale used (V-02)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v02')::text; end if;
  if p_net_kg is null or p_net_kg <= 0 then raise exception 'Net weight must be greater than 0 (V-02)' using errcode = 'P0422'; end if;
  update public.ph_incoming_pallets
     set pre_regrade_net_kg = net_kg, net_kg = p_net_kg, scale_id = sc.id,
         calibration_flag = calibration_flag or sc.calibration_due_on is null or sc.calibration_due_on < app.ph_local_date()
   where id = r.id;
  perform app.ph_transition('ph_incoming_pallets', r.id, 'awaiting_recheck', 'Re-weighed after regrade: ' || p_net_kg || ' kg');
  perform app.ph_notify_role(r.farm_id, 'QAO', 'ph_recheck_due', 'ph_incoming_pallets', r.id, jsonb_build_object('code', r.code));
  return jsonb_build_object('id', r.id, 'net_kg', p_net_kg);
end;
$$;

-- Recheck after regrade (D-05): accept, or a second rejection to waste with a waste record (V-26: no third check).
create function public.ph_recheck(p_pallet uuid, p_decision text, p_checklist jsonb, p_reason text default null,
                                  p_attachment_ids uuid[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r      public.ph_incoming_pallets;
  v_id   uuid := gen_random_uuid();
  v_code text;
  v_wr   uuid;
  v_lot  text;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(r.farm_id, 'rma.recheck');
  if r.status <> 'awaiting_recheck' then
    raise exception 'Pallet % is not awaiting recheck (at most one recheck, V-26)', r.code using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.v26')::text;
  end if;
  if p_decision not in ('accept', 'reject') then raise exception 'Decision must be accept or reject' using errcode = 'P0422'; end if;
  if p_decision = 'reject' and coalesce(trim(p_reason), '') = '' then raise exception 'A rejection needs a reason' using errcode = 'P0422'; end if;
  v_code := app.ph_code(r.farm_id, 'RCK', 4);
  insert into public.ph_inspections (id, farm_id, code, inspection_type, template_id, result, reason, checklist, tolerance_basis,
                                     qam_review_flag, signature_meaning)
  values (v_id, r.farm_id, v_code, 'recheck', app.ph_template(r.farm_id, 'recheck'), p_decision, nullif(trim(p_reason), ''),
          coalesce(p_checklist, '{}'), 'no_tolerance_set', p_decision = 'accept', case p_decision when 'accept' then 'approved' else 'rejected' end);
  perform app.ph_link_attachments(p_attachment_ids, 'ph_inspections', v_id, r.farm_id);
  insert into public.ph_inspection_subjects (farm_id, inspection_id, pallet_id, result) values (r.farm_id, v_id, r.id, p_decision);
  update public.ph_incoming_pallets set recheck_id = v_id where id = r.id;
  if p_decision = 'accept' then
    perform app.ph_transition('ph_incoming_pallets', r.id, 'accepted', p_reason);
    v_lot := app.ph_assign_lot(r.id);
  else
    v_wr := app.ph_create_waste(r.farm_id, 'incoming_pallet', r.id, r.crop_id, r.net_kg, 'Second QA rejection after regrade (E-04)');
    update public.ph_incoming_pallets set waste_record_id = v_wr where id = r.id;
    perform app.ph_transition('ph_incoming_pallets', r.id, 'waste', p_reason);
    perform app.ph_notify_role(r.farm_id, 'PHM', 'ph_second_rejection', 'ph_incoming_pallets', r.id, jsonb_build_object('code', r.code));
    perform app.ph_notify_role(r.farm_id, 'FRM', 'ph_second_rejection', 'ph_incoming_pallets', r.id, jsonb_build_object('code', r.code));
  end if;
  return jsonb_build_object('inspection_id', v_id, 'code', v_code, 'waste_record_id', v_wr, 'lot', v_lot);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-06 Harvest storage: moves by scan with storage-group (V-07) and capacity (V-08) checks
-- ---------------------------------------------------------------------------------------------
create function public.ph_move_pallet(p_pallet text, p_to_location uuid, p_override_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r        public.ph_incoming_pallets;
  v_to     public.ph_locations;
  v_group  uuid;
  v_basis  text;
  v_occ    integer;
  v_over   boolean;
  v_warn   jsonb := '[]';
begin
  r := app.ph_pallet(p_pallet);
  if r.status not in ('accepted', 'stored', 'released') then
    raise exception 'Pallet % cannot be moved to storage in status %', r.code, r.status using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.move.state', 'status', r.status)::text;
  end if;
  select * into v_to from public.ph_locations where id = p_to_location and farm_id = r.farm_id and voided_at is null;
  if not found then raise exception 'Unknown location' using errcode = 'P0404'; end if;
  if v_to.verification_status <> 'verified' then
    raise exception 'Location % is not approved', v_to.code using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', v_to.code)::text;
  end if;
  if v_to.purpose not in ('harvest_storage', 'sorting') then
    raise exception 'Incoming pallets are stored in harvest storage (Harvest Fridge, Fridges 5–7) or taken to sorting' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.move.purpose', 'purpose', v_to.purpose)::text;
  end if;
  if v_to.id = r.location_id then raise exception 'Pallet is already there' using errcode = 'P0422'; end if;

  -- V-07: storage group of the fridge must match the crop's; otherwise the PHM moves it with an override and a reason.
  select storage_group_id into v_group from public.ph_crops where id = r.crop_id;
  if v_to.purpose = 'harvest_storage' and (v_to.storage_group_id is null or v_group is null or v_to.storage_group_id <> v_group) then
    if coalesce(trim(p_override_reason), '') = '' then
      raise exception 'Storage group of % does not match the crop (V-07); a PHM override with a reason is needed', v_to.code
        using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v07', 'location', v_to.code)::text;
    end if;
    v_basis := app.ph_authorize(r.farm_id, 'stock_move.override_placement');
  else
    v_basis := app.ph_authorize(r.farm_id, 'stock_move.execute');
  end if;
  -- V-08: capacity is a warning, recorded with the move.
  select count(*) into v_occ from public.ph_incoming_pallets where location_id = v_to.id and status in ('stored', 'released', 'on_hold', 'pre_cooling');
  v_over := v_to.capacity_pallets is not null and v_occ >= v_to.capacity_pallets;
  if v_over then v_warn := v_warn || jsonb_build_object('key', 'ph.v08', 'capacity', v_to.capacity_pallets, 'occupancy', v_occ); end if;

  insert into public.ph_stock_moves (farm_id, pallet_id, from_location_id, to_location_id, group_override_reason, over_capacity, permission_basis)
  values (r.farm_id, r.id, r.location_id, v_to.id, nullif(trim(p_override_reason), ''), v_over, v_basis);
  update public.ph_incoming_pallets set location_id = v_to.id where id = r.id;
  if r.status = 'accepted' then
    perform app.ph_transition('ph_incoming_pallets', r.id, 'stored', p_override_reason);
  end if;
  return jsonb_build_object('id', r.id, 'code', r.code, 'location', v_to.code, 'warnings', v_warn);
end;
$$;

-- FR-ST-06: PHM changes a fridge's storage group; with pallets present only with a reason (listed in the history).
create function public.ph_set_location_group(p_location uuid, p_group uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  l     public.ph_locations;
  v_occ integer;
begin
  select * into l from public.ph_locations where id = p_location and voided_at is null and app.is_farm_member(farm_id) for update;
  if not found then raise exception 'Unknown location' using errcode = 'P0404'; end if;
  perform app.ph_authorize(l.farm_id, 'stock_move.assign_group');
  if p_group is not null and not exists (select 1 from public.ph_storage_groups where id = p_group and farm_id = l.farm_id and voided_at is null) then
    raise exception 'Unknown storage group' using errcode = 'P0404';
  end if;
  select count(*) into v_occ from public.ph_incoming_pallets where location_id = l.id and status in ('stored', 'released', 'on_hold');
  if v_occ > 0 and coalesce(trim(p_reason), '') = '' then
    raise exception '% pallets are in %; changing its group needs a reason', v_occ, l.code using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.groupChangeReason', 'pallets', v_occ)::text;
  end if;
  insert into public.ph_location_group_changes (farm_id, location_id, from_group_id, to_group_id, pallets_present, reason)
  values (l.farm_id, l.id, l.storage_group_id, p_group, v_occ, nullif(trim(p_reason), ''));
  perform set_config('app.audit_comment', coalesce(p_reason, ''), true);
  update public.ph_locations set storage_group_id = p_group where id = l.id;
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('id', l.id, 'pallets_present', v_occ);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-07 QC-1 release (G4; scope pending OD-17 — the step as built is option A, a separate gate)
-- ---------------------------------------------------------------------------------------------
create function public.ph_qc1_release(p_pallets uuid[], p_checklist jsonb, p_remarks text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid;
  v_id   uuid := gen_random_uuid();
  v_code text;
  v_p    uuid;
begin
  if coalesce(cardinality(p_pallets), 0) = 0 then raise exception 'Select the pallets to release' using errcode = 'P0422'; end if;
  select farm_id into v_farm from public.ph_incoming_pallets where id = p_pallets[1] and voided_at is null and app.ph_is_member(farm_id);
  if v_farm is null then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(v_farm, 'qc1.release');
  perform app.ph_decision_gate(v_farm, 'OD-17:A');
  if exists (select 1 from public.ph_incoming_pallets where id = any (p_pallets) and (status <> 'stored' or farm_id <> v_farm)) then
    raise exception 'Only stored pallets that are not on hold can be released (G4)' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.g4.state')::text;
  end if;
  v_code := app.ph_code(v_farm, 'QC1', 4);
  insert into public.ph_inspections (id, farm_id, code, inspection_type, template_id, result, checklist, remarks, signature_meaning)
  values (v_id, v_farm, v_code, 'qc1', app.ph_template(v_farm, 'qc1'), 'pass', coalesce(p_checklist, '{}'), nullif(trim(p_remarks), ''), 'released');
  foreach v_p in array p_pallets loop
    insert into public.ph_inspection_subjects (farm_id, inspection_id, pallet_id, result) values (v_farm, v_id, v_p, 'release');
    update public.ph_incoming_pallets set qc1_id = v_id where id = v_p;
    perform app.ph_transition('ph_incoming_pallets', v_p, 'released', p_remarks);
  end loop;
  return jsonb_build_object('inspection_id', v_id, 'code', v_code, 'released', cardinality(p_pallets));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- X-01 Holds (SM-NC) on incoming pallets
-- ---------------------------------------------------------------------------------------------
create function public.ph_raise_hold(p_type text, p_reason text, p_pallets uuid[]) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm  uuid;
  v_id    uuid := gen_random_uuid();
  v_code  text;
  v_basis text;
  r       public.ph_incoming_pallets;
  v_tb    text;
begin
  if coalesce(cardinality(p_pallets), 0) = 0 then raise exception 'Select at least one pallet (SM-NC: ≥1 item)' using errcode = 'P0422'; end if;
  select farm_id into v_farm from public.ph_incoming_pallets where id = p_pallets[1] and voided_at is null and app.ph_is_member(farm_id);
  if v_farm is null then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  v_basis := app.ph_authorize(v_farm, 'hold.raise');
  if p_type not in ('quality', 'food_safety', 'operational') then raise exception 'Unknown hold type' using errcode = 'P0422'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422'; end if;
  -- The PHM raises operational holds only (§6.3 note); quality and food-safety holds are QC/QA's.
  if p_type <> 'operational' and not (app.ph_user_spec_roles(app.current_user_id(), v_farm) && array['QCI', 'QAO']) then
    raise exception 'Quality and food-safety holds are raised by QC / QA' using errcode = 'P0403',
      detail = jsonb_build_object('key', 'ph.hold.typeRole')::text;
  end if;
  v_tb := case when app.ph_decision_open(v_farm, 'OD-23') is null then 'OD-23 decided' else 'Chosen by raiser; classification pending OD-23' end;
  v_code := app.ph_code(v_farm, 'NC', 3);
  insert into public.ph_holds (id, farm_id, code, hold_type, type_basis, reason) values (v_id, v_farm, v_code, p_type, v_tb, trim(p_reason));
  for r in select * from public.ph_incoming_pallets where id = any (p_pallets) loop
    if r.farm_id <> v_farm or r.status not in ('registered', 'stored') then
      raise exception 'Pallet % cannot be held in status % (SM-IP: Registered or Stored)', r.code, r.status using errcode = 'P0422',
        detail = jsonb_build_object('key', 'ph.hold.state', 'pallet', r.code, 'status', r.status)::text;
    end if;
    insert into public.ph_hold_items (farm_id, hold_id, pallet_id) values (v_farm, v_id, r.id);
    update public.ph_incoming_pallets set hold_id = v_id, held_from_status = r.status where id = r.id;
    perform app.ph_transition('ph_incoming_pallets', r.id, 'on_hold', p_reason);
  end loop;
  perform app.ph_notify_role(v_farm, case when p_type = 'food_safety' then 'QAM' else 'QCM' end, 'ph_hold_raised', 'ph_holds', v_id,
                             jsonb_build_object('code', v_code));
  if p_type <> 'food_safety' then
    perform app.ph_notify_role(v_farm, 'QAM', 'ph_hold_raised', 'ph_holds', v_id, jsonb_build_object('code', v_code));
  end if;
  return jsonb_build_object('id', v_id, 'code', v_code, 'basis', v_basis);
end;
$$;

-- One step of SM-NC. decide: disposition release (items return to their prior state, G9) or waste (waste record); the
-- other dispositions need Job Cards / returns (later milestones) and are refused rather than half-done.
create function public.ph_hold_step(p_hold uuid, p_step text, p_note text default null, p_disposition text default null) returns jsonb
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
      -- Food-safety holds: QAM only (SM-NC); quality / operational holds: QCM or QAM.
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
      return jsonb_build_object('id', h.id, 'status', 'disposition_decided', 'disposition', p_disposition);
    when 'execute' then
      if coalesce(trim(p_note), '') = '' then raise exception 'Describe what was done' using errcode = 'P0422'; end if;
      update public.ph_holds set execution_note = trim(p_note) where id = h.id;
      return app.ph_transition('ph_holds', h.id, 'disposition_executed', p_note);
    when 'verify' then
      update public.ph_holds set verification_note = nullif(trim(p_note), '') where id = h.id;
      return app.ph_transition('ph_holds', h.id, 'verified', p_note);
    when 'close' then
      update public.ph_holds set closure_note = coalesce(nullif(trim(p_note), ''), 'CAPA: not linked (CAPA module is a later milestone)') where id = h.id;
      return app.ph_transition('ph_holds', h.id, 'closed', p_note);
    when 'cancel' then
      if exists (select 1 from public.ph_hold_items i join public.ph_incoming_pallets p on p.id = i.pallet_id
                  where i.hold_id = h.id and p.status = 'on_hold') then
        raise exception 'Release or dispose the held pallets through a disposition before cancelling' using errcode = 'P0422';
      end if;
      return app.ph_transition('ph_holds', h.id, 'cancelled', p_note);
    else
      raise exception 'Unknown hold step %', p_step using errcode = 'P0422';
  end case;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Attachments (AT-05)
-- ---------------------------------------------------------------------------------------------
create function public.ph_upload_attachment(p_kind text, p_mime text, p_base64 text, p_caption text default null,
                                            p_entity_type text default null, p_entity uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm  uuid := app.ph_farm_of_user();
  v_bytes bytea;
  v_id    uuid := gen_random_uuid();
  v_hash  text;
  v_max   constant integer := 5 * 1024 * 1024;
  v_check uuid;
begin
  if v_farm is null then raise exception 'Not permitted for your role' using errcode = 'P0403'; end if;
  if p_kind not in ('photo', 'video', 'document') then raise exception 'Unknown attachment kind' using errcode = 'P0422'; end if;
  if p_mime !~ '^(image/(jpeg|png|webp)|video/(mp4|webm)|application/pdf)$' then
    raise exception 'File type % is not accepted', p_mime using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fileType')::text;
  end if;
  v_bytes := decode(p_base64, 'base64');
  if length(v_bytes) = 0 or length(v_bytes) > v_max then
    raise exception 'File must be between 1 byte and 5 MB (compress photos on the device, NFR-10)' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.fileSize')::text;
  end if;
  v_hash := encode(sha256(v_bytes), 'hex');
  if p_entity_type is not null then
    if p_entity_type not in ('ph_arrivals', 'ph_incoming_pallets', 'ph_inspections', 'ph_holds') then
      raise exception 'Attachments are not accepted on %', p_entity_type using errcode = 'P0422';
    end if;
    execute format('select id from public.%I where id = $1 and farm_id = $2', p_entity_type) into v_check using p_entity, v_farm;
    if v_check is null then raise exception 'Record not found' using errcode = 'P0404'; end if;
  end if;
  insert into public.ph_attachments (id, farm_id, entity_type, entity_id, kind, mime_type, size_bytes, sha256, caption)
  values (v_id, v_farm, p_entity_type, p_entity, p_kind, p_mime, length(v_bytes), v_hash, nullif(trim(p_caption), ''));
  insert into public.ph_attachment_blobs (attachment_id, content) values (v_id, v_bytes);
  return jsonb_build_object('id', v_id, 'sha256', v_hash, 'size_bytes', length(v_bytes));
end;
$$;

create function public.ph_attachment_content(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select jsonb_build_object('mime_type', a.mime_type, 'base64', encode(b.content, 'base64'), 'sha256', a.sha256)
    from public.ph_attachments a join public.ph_attachment_blobs b on b.attachment_id = a.id
   where a.id = p_id and a.voided_at is null and app.ph_is_member(a.farm_id)
     and (a.entity_id is not null or a.created_by = app.current_user_id())
$$;

-- ---------------------------------------------------------------------------------------------
-- Read models for the workflow dashboard
-- ---------------------------------------------------------------------------------------------
create function app.ph_ip_stage(p_status text, p_check text) returns text
language sql immutable as $$
  select case
    when p_status = 'registered' and p_check is null then 'arrival_check'
    when p_status = 'registered' then 'precooling'
    when p_status = 'pre_cooling' then 'precooling'
    when p_status in ('awaiting_qa', 'qa_rejected', 'in_regrade', 'awaiting_recheck') then 'qa_acceptance'
    when p_status in ('accepted', 'stored') then 'storage'
    when p_status = 'released' then 'qc1_released'
    when p_status = 'issued' then 'production'
    when p_status in ('on_hold', 'arrival_rejected') then 'exceptions'
    else 'closed' end
$$;

create view public.ph_ip_board with (security_invoker = true) as
select p.id, p.farm_id, p.code, p.status, p.workflow_version_id, p.version,
       app.ph_ip_stage(p.status, p.arrival_check_result) as stage,
       greatest(p.received_at, (select max(t.server_received_at) from public.record_transitions t
                                 where t.entity_type = 'ph_incoming_pallets' and t.entity_id = p.id),
                ac.event_at) as stage_since,
       p.arrival_id, a.code as arrival_code, a.arrived_at, a.vehicle_plate, a.driver_name, a.gate_no, a.late_flag,
       a.harvest_supervisor,
       p.source_id, s.code as source_code, s.kind as source_kind, s.name_ar as source_name_ar, s.name_en as source_name_en,
       s.block_code, s.section_code, s.supplier_name,
       p.crop_id, c.code as crop_code, c.name_ar as crop_name_ar, c.name_en as crop_name_en, c.version_no as crop_version,
       c.nominal_kg_per_pallet, v.name_ar as variety_name_ar, v.name_en as variety_name_en,
       p.harvest_at, p.box_count, p.net_kg, p.pre_regrade_net_kg, p.received_at, p.calibration_flag, p.plausibility_note,
       eq.code as scale_code, p.created_by as registered_by, rb.full_name as registered_by_name,
       l.code as lot_code, p.lot_id,
       loc.code as location_code, loc.name_ar as location_name_ar, loc.name_en as location_name_en,
       p.arrival_check_result, ac.code as arrival_check_code, ac.event_at as arrival_check_at, acb.full_name as arrival_checked_by_name,
       p.reject_destination,
       p.precool_in_at, p.precool_out_at,
       round(extract(epoch from (coalesce(p.precool_out_at, case when p.status = 'pre_cooling' then now() end) - p.precool_in_at)) / 60, 1) as dwell_minutes,
       coalesce(round(extract(epoch from (coalesce(p.precool_out_at, case when p.status = 'pre_cooling' then now() end) - p.precool_in_at)) / 60, 1)
                > app.ph_param(p.farm_id, 'precool_max_dwell_minutes'), false) as dwell_exceeded,
       rma.code as rma_code, rma.event_at as rma_at, rma.result as rma_result, rma.status as rma_status, rma.qam_review_flag,
       qdb.full_name as qa_decided_by_name, p.qa_reject_reason,
       rgb.full_name as regraded_by_name, p.regrade_done_at, rwb.full_name as reweighed_by_name,
       rck.code as recheck_code, rck.result as recheck_result, rcb.full_name as rechecked_by_name,
       q1.code as qc1_code, q1.event_at as qc1_at, rlb.full_name as released_by_name,
       h.code as hold_code, h.hold_type, h.status as hold_status, p.held_from_status, p.hold_id,
       p.void_requested_by, p.void_request_reason, p.label_print_count, p.waste_record_id, wr.code as waste_code,
       round(extract(epoch from (now() - p.received_at)) / 3600, 1) as age_hours,
       (p.status not in ('returned_to_source', 'waste', 'void', 'consumed', 'arrival_rejected')
        and extract(epoch from (now() - p.received_at)) / 3600 > coalesce(app.ph_param(p.farm_id, 'grading_limit_hours'), 1e9)) as grading_overdue,
       p.decision_basis,
       (select count(*) from public.ph_attachments x
         where x.voided_at is null and ((x.entity_type = 'ph_incoming_pallets' and x.entity_id = p.id)
                                      or (x.entity_type = 'ph_inspections' and x.entity_id in (p.arrival_check_id, p.rma_id, p.recheck_id, p.qc1_id)))) as attachment_count
  from public.ph_incoming_pallets p
  join public.ph_arrivals a on a.id = p.arrival_id
  join public.ph_sources s on s.id = p.source_id
  join public.ph_crops c on c.id = p.crop_id
  left join public.ph_varieties v on v.id = p.variety_id
  left join public.ph_equipment eq on eq.id = p.scale_id
  left join public.user_profiles rb on rb.id = p.created_by
  left join public.ph_lots l on l.id = p.lot_id
  left join public.ph_locations loc on loc.id = p.location_id
  left join public.ph_inspections ac on ac.id = p.arrival_check_id
  left join public.user_profiles acb on acb.id = ac.created_by
  left join public.ph_inspections rma on rma.id = p.rma_id
  left join public.user_profiles qdb on qdb.id = p.qa_decided_by
  left join public.user_profiles rgb on rgb.id = p.regraded_by
  left join public.user_profiles rwb on rwb.id = p.reweighed_by
  left join public.ph_inspections rck on rck.id = p.recheck_id
  left join public.user_profiles rcb on rcb.id = p.rechecked_by
  left join public.ph_inspections q1 on q1.id = p.qc1_id
  left join public.user_profiles rlb on rlb.id = p.released_by
  left join public.ph_holds h on h.id = p.hold_id
  left join public.ph_waste_records wr on wr.id = p.waste_record_id
 where p.voided_at is null;
comment on view public.ph_ip_board is 'One row per incoming pallet for the workflow dashboard: stage, timers (dwell V-04, grading V-06), people who acted at each gate.';

create view public.ph_arrival_board with (security_invoker = true) as
select a.id, a.farm_id, a.code, a.status, a.workflow_version_id, a.version, a.arrived_at, a.gate_no,
       a.source_id, s.code as source_code, s.kind as source_kind, s.name_ar as source_name_ar, s.name_en as source_name_en,
       s.block_code, s.section_code, s.supplier_name,
       a.variety_id, v.crop_code, v.name_ar as variety_name_ar, v.name_en as variety_name_en,
       a.harvest_date, a.harvest_time, a.harvest_supervisor, a.supplier_ref, a.vehicle_plate, a.driver_name,
       a.dispatch_note_no, a.dispatched_pallets, a.dispatched_boxes, a.late_flag, a.late_reason, a.remarks,
       a.vehicle_result, vi.code as vehicle_inspection_code, vib.full_name as vehicle_inspected_by_name, vi.reason as vehicle_fail_reason,
       app.ph_vehicle_exception_state(a.id) as exception_state,
       (select coalesce(jsonb_agg(jsonb_build_object('role', x.spec_code, 'decision', x.decision, 'by', u.full_name, 'at', x.created_at)
                                  order by x.created_at), '[]')
          from public.ph_vehicle_exception_approvals x left join public.user_profiles u on u.id = x.approved_by
         where x.arrival_id = a.id and x.voided_at is null) as exception_signatures,
       a.created_by, cb.full_name as created_by_name, a.created_at,
       (select count(*) from public.ph_incoming_pallets p where p.arrival_id = a.id and p.voided_at is null and p.status <> 'void') as pallets_registered,
       (select coalesce(sum(p.net_kg), 0) from public.ph_incoming_pallets p where p.arrival_id = a.id and p.voided_at is null and p.status <> 'void') as registered_kg,
       (select count(*) from public.ph_incoming_pallets p where p.arrival_id = a.id and p.status = 'registered' and p.arrival_check_result is null and p.voided_at is null) as pallets_awaiting_check,
       a.decision_basis
  from public.ph_arrivals a
  join public.ph_sources s on s.id = a.source_id
  left join public.ph_varieties v on v.id = a.variety_id
  left join public.ph_inspections vi on vi.id = a.vehicle_inspection_id
  left join public.user_profiles vib on vib.id = vi.created_by
  left join public.user_profiles cb on cb.id = a.created_by
 where a.voided_at is null;
comment on view public.ph_arrival_board is 'Arrivals with tag data, vehicle check, three-party exception signatures and pallet counts (ST-01, ST-02).';

-- Live stage counts for the workflow bar (same rule as the board rows, so tab counts equal the rows shown).
create function public.ph_stage_counts() returns table (stage text, total bigint, attention bigint)
language sql stable security invoker set search_path = public, app, pg_temp
as $$
  select 'arrivals', count(*), count(*) filter (where status = 'vehicle_hold' or late_flag)
    from public.ph_arrival_board where status in ('draft', 'vehicle_hold', 'submitted')
  union all
  select b.stage, count(*), count(*) filter (where b.dwell_exceeded or b.grading_overdue or b.calibration_flag
                                                    or b.status in ('qa_rejected', 'on_hold', 'arrival_rejected'))
    from public.ph_ip_board b group by b.stage
$$;

create view public.ph_exception_items with (security_invoker = true) as
select 'E-05'::text as rule, 'ph_incoming_pallets'::text as entity_type, id as entity_id, code, farm_id, precool_in_at as since, 'high'::text as severity,
       jsonb_build_object('minutes', dwell_minutes) as params
  from public.ph_ip_board where status = 'pre_cooling' and dwell_exceeded
union all
select 'E-06', 'ph_incoming_pallets', id, code, farm_id, received_at, 'high', jsonb_build_object('hours', age_hours)
  from public.ph_ip_board where grading_overdue
union all
select 'E-02', 'ph_arrivals', id, code, farm_id, arrived_at, 'high', jsonb_build_object('signatures', exception_signatures)
  from public.ph_arrival_board where status = 'vehicle_hold'
union all
select 'E-03', 'ph_incoming_pallets', id, code, farm_id, arrival_check_at, 'medium', jsonb_build_object('destination', reject_destination)
  from public.ph_ip_board where status = 'arrival_rejected'
union all
select 'E-04', 'ph_incoming_pallets', id, code, farm_id, stage_since, 'medium', jsonb_build_object('status', status)
  from public.ph_ip_board where status in ('qa_rejected', 'in_regrade', 'awaiting_recheck')
union all
select 'X-01', 'ph_holds', h.id, h.code, h.farm_id, h.created_at, case when h.hold_type = 'food_safety' then 'high' else 'medium' end,
       jsonb_build_object('type', h.hold_type, 'status', h.status)
  from public.ph_holds h where h.voided_at is null and h.status not in ('closed', 'cancelled')
union all
select 'OD-05', 'ph_inspections', i.id, i.code, i.farm_id, i.event_at, 'low', jsonb_build_object('type', i.inspection_type)
  from public.ph_inspections i where i.voided_at is null and i.qam_review_flag and i.inspection_type in ('rma', 'recheck')
union all
select 'FR-MD-06', 'ph_incoming_pallets', id, code, farm_id, received_at, 'low', jsonb_build_object('scale', scale_code)
  from public.ph_ip_board where calibration_flag and status not in ('returned_to_source', 'waste', 'void', 'consumed')
union all
select 'V-03', 'ph_arrivals', id, code, farm_id, arrived_at, 'low', jsonb_build_object('reason', late_reason)
  from public.ph_arrival_board where late_flag and app.ph_local_date(arrived_at) = app.ph_local_date();
comment on view public.ph_exception_items is
  'Exception queue (FR-RP-02 for M1 scope): dwell exceeded (E-05), grading overdue (E-06), vehicle exceptions (E-02), '
  'arrival rejections awaiting disposition (E-03), the regrade loop (E-04), open holds (X-01), RMAs accepted without a '
  'tolerance set (OD-05, QAM review), weights from scales with unknown/overdue calibration (FR-MD-06), late arrivals (V-03).';

create view public.ph_location_occupancy with (security_invoker = true) as
select l.id, l.farm_id, l.code, l.name_ar, l.name_en, l.purpose, l.capacity_pallets, l.storage_group_id, g.code as storage_group_code,
       g.name_ar as storage_group_name_ar, g.name_en as storage_group_name_en, l.verification_status, l.sort_order,
       (select count(*) from public.ph_incoming_pallets p where p.location_id = l.id and p.voided_at is null
          and p.status in ('pre_cooling', 'stored', 'released', 'on_hold')) as occupancy
  from public.ph_locations l left join public.ph_storage_groups g on g.id = l.storage_group_id
 where l.voided_at is null;
comment on view public.ph_location_occupancy is 'Occupancy per location = pallets whose current location it is (FR-MD-02, FR-ST-05).';

-- Status and change history of one record (record_transitions + field-level audit), for the History panel.
create function public.ph_record_history(p_entity_type text, p_id uuid) returns table (
  at timestamptz, kind text, from_status text, to_status text, actor text, comment text, permission_basis text, decision_basis text,
  changes jsonb)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select t.server_received_at, 'transition', t.from_status, t.to_status, u.full_name, t.comment, t.permission_basis, t.decision_basis, null::jsonb
    from public.record_transitions t left join public.user_profiles u on u.id = t.actor_user_id
   where t.entity_type = p_entity_type and t.entity_id = p_id and app.ph_is_member(t.farm_id)
  union all
  select e.server_received_at, e.action, null, null, coalesce(u.full_name, e.actor_kind), e.comment, null, null,
         (select jsonb_object_agg(k, jsonb_build_object('from', e.before -> k, 'to', e.after -> k))
            from jsonb_object_keys(e.after) k
           where e.before is not null and (e.before -> k) is distinct from (e.after -> k)
             and k not in ('version', 'updated_at', 'updated_by', 'status'))
    from public.audit_events e left join public.user_profiles u on u.id = e.actor_user_id
   where e.entity_type = p_entity_type and e.entity_id = p_id and app.ph_is_member(e.farm_id) and e.action <> 'transition'
  order by 1
$$;

-- Backward trace to arrival (TQ-01, M1 scope): from a pallet, arrival or lot code.
create function public.ph_backward_trace(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_ids uuid[];
begin
  select array_agg(p.id) into v_ids from public.ph_incoming_pallets p
    left join public.ph_arrivals a on a.id = p.arrival_id
    left join public.ph_lots l on l.id = p.lot_id
   where app.ph_is_member(p.farm_id) and p.voided_at is null
     and (upper(p.code) = upper(trim(p_ref)) or upper(a.code) = upper(trim(p_ref)) or upper(l.code) = upper(trim(p_ref)));
  if v_ids is null then
    raise exception 'Nothing found for %', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'ph.trace.notFound', 'ref', p_ref)::text;
  end if;
  return jsonb_build_object(
    'query', p_ref,
    'scope', 'Backward to arrival and source (TQ-01 up to M1: Job Cards, FG pallets and loads arrive in later milestones)',
    'pallets', (select jsonb_agg(to_jsonb(b) - 'farm_id' order by b.code) from public.ph_ip_board b where b.id = any (v_ids)),
    'inspections', (select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'type', i.inspection_type, 'result', i.result, 'at', i.event_at,
                                                                  'by', u.full_name, 'pallet', p.code, 'tolerance_basis', i.tolerance_basis)
                                              order by i.event_at), '[]')
                      from public.ph_inspection_subjects s join public.ph_inspections i on i.id = s.inspection_id
                      join public.ph_incoming_pallets p on p.id = s.pallet_id left join public.user_profiles u on u.id = i.created_by
                     where s.pallet_id = any (v_ids)),
    'moves', (select coalesce(jsonb_agg(jsonb_build_object('pallet', p.code, 'from', lf.code, 'to', lt.code, 'at', m.moved_at, 'by', u.full_name)
                                        order by m.moved_at), '[]')
                from public.ph_stock_moves m join public.ph_incoming_pallets p on p.id = m.pallet_id
                left join public.ph_locations lf on lf.id = m.from_location_id left join public.ph_locations lt on lt.id = m.to_location_id
                left join public.user_profiles u on u.id = m.created_by
               where m.pallet_id = any (v_ids)),
    'holds', (select coalesce(jsonb_agg(jsonb_build_object('code', h.code, 'type', h.hold_type, 'status', h.status, 'disposition', h.disposition,
                                                            'pallet', p.code)), '[]')
                from public.ph_hold_items hi join public.ph_holds h on h.id = hi.hold_id join public.ph_incoming_pallets p on p.id = hi.pallet_id
               where hi.pallet_id = any (v_ids)));
end;
$$;

-- What the signed-in user can do on a pallet now, and why not (permission, decision, segregation of duties, state).
create function public.ph_pallet_actions(p_pallet uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  r      public.ph_incoming_pallets;
  a      public.ph_arrivals;
  v_uid  uuid := app.current_user_id();
  v_out  jsonb := '[]';
  c      record;
  v_why  jsonb;
begin
  select * into r from public.ph_incoming_pallets where id = p_pallet and voided_at is null and app.ph_is_member(farm_id);
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  select * into a from public.ph_arrivals where id = r.arrival_id;
  for c in
    select * from (values
      ('arrival_check', 'arrival_check.submit', null::text, r.status = 'registered' and r.arrival_check_result is null, null::text),
      ('precool_in', 'precool.record', null, r.status = 'registered' and r.arrival_check_result = 'pass', null),
      ('precool_out', 'precool.record', null, r.status = 'pre_cooling', null),
      ('rma', 'rma.decide', null, r.status = 'awaiting_qa', 'created_by'),
      ('regrade_start', 'regrade.execute', null, r.status = 'qa_rejected', null),
      ('regrade_complete', 'regrade.execute', null, r.status = 'in_regrade' and r.regrade_done_at is null, null),
      ('reweigh', 'regrade.reweigh', null, r.status = 'in_regrade' and r.regrade_done_at is not null, null),
      ('recheck', 'rma.recheck', null, r.status = 'awaiting_recheck', 'recheck'),
      ('move', 'stock_move.execute', null, r.status in ('accepted', 'stored', 'released'), null),
      ('qc1_release', 'qc1.release', 'OD-17:A', r.status = 'stored', null),
      ('raise_hold', 'hold.raise', null, r.status in ('registered', 'stored'), null),
      ('record_disposition', 'incoming_pallet.record_disposition', null, r.status = 'arrival_rejected', null),
      ('edit_weight', 'incoming_pallet.edit_weight', null, r.status in ('registered', 'pre_cooling', 'awaiting_qa'), null),
      ('print_label', 'incoming_pallet.print_label', 'OD-03:A', r.status not in ('void', 'returned_to_source', 'waste', 'consumed'), null),
      ('void_request', 'incoming_pallet.void_request', null, r.status = 'registered' and r.arrival_check_result is null and r.void_requested_by is null, null),
      ('void_approve', 'incoming_pallet.void_approve', null, r.status = 'registered' and r.void_requested_by is not null, 'void'),
      ('issue_to_job_card', 'job_card.record_inputs', null, r.status = 'released', 'later')
    ) as x(action, ph_action, gate, applicable, sod)
  loop
    continue when not c.applicable;
    v_why := null;
    if c.sod = 'later' then
      v_why := jsonb_build_object('key', 'ph.later', 'milestone', 'M2');
    else
      v_why := app.ph_denial(v_uid, r.farm_id, c.ph_action);
    end if;
    if v_why is null and c.gate is not null and app.ph_decision_open(r.farm_id, c.gate) is not null then
      v_why := jsonb_build_object('key', 'ph.blocked.open', 'decision', split_part(c.gate, ':', 1));
    end if;
    if v_why is null and c.sod = 'created_by' and r.created_by = v_uid then
      v_why := jsonb_build_object('key', 'ph.sod', 'column', 'created_by');
    end if;
    if v_why is null and c.sod = 'recheck' and v_uid in (r.regraded_by, r.created_by, r.reweighed_by) then
      v_why := jsonb_build_object('key', 'ph.sod', 'column', case when v_uid = r.regraded_by then 'regraded_by' when v_uid = r.created_by then 'created_by' else 'reweighed_by' end);
    end if;
    if v_why is null and c.sod = 'void' and r.void_requested_by = v_uid then
      v_why := jsonb_build_object('key', 'ph.sod', 'column', 'void_requested_by');
    end if;
    if v_why is null and c.action = 'arrival_check' and a.status <> 'submitted' then
      v_why := jsonb_build_object('key', 'ph.g1.notPassed', 'status', a.status);
    end if;
    if v_why is null and c.action = 'regrade_complete' and r.regraded_by is distinct from v_uid then
      v_why := jsonb_build_object('key', 'ph.regrade.otherEngineer');
    end if;
    v_out := v_out || jsonb_build_object('action', c.action, 'ph_action', c.ph_action, 'allowed', v_why is null, 'reason', v_why,
                                         'basis', app.ph_permission_basis(v_uid, r.farm_id, c.ph_action));
  end loop;
  return v_out;
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
end $$;

-- Packing-house tables are written only by the server functions above (RLS has no write policy either); the grant
-- refresh every migration ends with keeps it that way.
create or replace function app.apply_api_grants() returns void
language plpgsql
as $$
declare t text;
begin
  revoke all on all tables in schema public from anon;
  revoke all on all functions in schema public from anon;
  grant select, insert, update on all tables in schema public to authenticated;
  revoke delete, truncate on all tables in schema public from authenticated;
  revoke insert, update on public.audit_events, public.record_transitions, public.processed_mutations,
    public.sync_conflicts, public.notifications, public.escalations, public.stock_movements,
    public.stock_balances from authenticated;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ph\_%' loop
    execute format('revoke insert, update on public.%I from authenticated', t);
  end loop;
  revoke select on public.ph_attachment_blobs from authenticated;
  revoke execute on function public.bootstrap_first_admin(uuid, uuid, text) from authenticated;
  perform app.refresh_tenant_refs();
end;
$$;

select app.seed_ph_receiving(id) from public.farms;
select app.apply_api_grants();
