-- Packing house milestone M2, increment 1: production (ST-08) to finished goods in storage.
-- Job Cards (SM-JC) with inputs issued from QC-1 released incoming pallets (partial issue, GEN-04, T-08), packaging issue,
-- the line-start check G5 (QC + Line Leader, two people), QC-2 online / final inspection G6, finished-goods pallets
-- (SM-FGP, FGP-YYMMDD-NNNNN) with lot composition (GEN-05/06), the FG label (V-09, AT-07), moves into finished-goods
-- fridges (V-07/V-08) and Job Card completion with consumed / returned kg. Reconciliation (MB-01), waste (ST-11), orders
-- (ST-00) and split/merge follow in later increments; their transitions are declared now and refused until built.
-- Checklists come from the product SOPs (draft 001, no effective date) and the QC Function charter, word for word; no
-- grade tolerances exist in any supplied document (OD-05, OD-06), so QC-2 records a judgement flagged for review.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.ph_job_cards (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null,
  line_id                   uuid not null references public.ph_lines(id),
  crop_id                   uuid not null references public.ph_crops(id),
  grade_target              text check (grade_target in ('premium', 'gr1', 'gr2')),
  customer_spec_ref         text,
  planned_date              date not null,
  attribution_method        text not null default 'proportional' check (attribution_method in ('exact', 'time_window', 'proportional')),
  notes                     text,
  line_start_inspection_id  uuid,
  approved_by               uuid references auth.users(id),
  ready_by                  uuid references auth.users(id),
  started_by                uuid references auth.users(id),
  completed_by              uuid references auth.users(id),
  completed_at              timestamptz,
  decision_basis            jsonb not null default '{}'
);
comment on table public.ph_job_cards is
  'Job Card / production order (ST-08, SM-JC, JC-YYMMDD-<line>-NN): one line run for one crop and grade target (order lines '
  'come with ST-00). Created by PE/PHM and approved by PHM (cells proposed, OD-15); executed by the Line Leader. It cannot '
  'start until the line-start check (G5) is recorded by one of QC / Line Leader and confirmed by the other.';
select app.register_table('public.ph_job_cards', 'ph_job_card', false, 'ph_job_card', p_default_policies => false);
create unique index ph_job_cards_code_uq on public.ph_job_cards (farm_id, code) where voided_at is null;

create table public.ph_jc_inputs (
  id            uuid primary key default gen_random_uuid(),
  job_card_id   uuid not null references public.ph_job_cards(id),
  pallet_id     uuid not null references public.ph_incoming_pallets(id),
  issued_kg     numeric(10,2) not null check (issued_kg > 0),
  consumed_kg   numeric(10,2) check (consumed_kg >= 0),
  returned_kg   numeric(10,2) check (returned_kg >= 0),
  closed_at     timestamptz,
  issue_basis   text not null,
  check ((closed_at is null and consumed_kg is null and returned_kg is null)
         or (closed_at is not null and consumed_kg is not null and returned_kg is not null and consumed_kg + returned_kg = issued_kg))
);
comment on table public.ph_jc_inputs is
  'Incoming pallet issued to a Job Card (GEN-04): kg issued, then consumed and returned when the Job Card completes '
  '(consumed + returned = issued). One pallet may be issued to several Job Cards (partial issue, T-08).';
select app.register_table('public.ph_jc_inputs', 'ph_job_card', false, p_default_policies => false);
create index ph_jc_inputs_jc_idx on public.ph_jc_inputs (job_card_id);
create index ph_jc_inputs_pallet_idx on public.ph_jc_inputs (pallet_id);

create table public.ph_jc_packaging (
  id            uuid primary key default gen_random_uuid(),
  job_card_id   uuid not null references public.ph_job_cards(id),
  description   text not null check (length(trim(description)) > 0),
  quantity      numeric(12,2) not null check (quantity > 0),
  unit_id       uuid not null references public.units(id),
  issue_basis   text not null
);
comment on table public.ph_jc_packaging is
  'Packaging issued to a Job Card by the store keeper (SOP-PL). The packaging item is described as issued; packaging '
  'items, stock and the ERP removal (WHM) are not modelled yet.';
select app.register_table('public.ph_jc_packaging', 'ph_job_card', false, p_default_policies => false);
create index ph_jc_packaging_jc_idx on public.ph_jc_packaging (job_card_id);

create table public.ph_fg_pallets (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  job_card_id         uuid not null references public.ph_job_cards(id),
  crop_id             uuid not null references public.ph_crops(id),
  grade               text not null check (grade in ('premium', 'gr1', 'gr2')),
  box_count           integer not null check (box_count > 0),
  net_kg              numeric(10,2) not null check (net_kg > 0),
  weight_unit_id      uuid not null references public.units(id),
  scale_id            uuid not null references public.ph_equipment(id),
  calibration_flag    boolean not null default false,
  plausibility_note   text,
  qc2_inspection_id   uuid not null,
  qc_approved_by      uuid references auth.users(id),
  qc_approved_at      timestamptz,
  location_id         uuid references public.ph_locations(id),
  earliest_harvest_at timestamptz,
  label_print_count   integer not null default 0,
  decision_basis      jsonb not null default '{}'
);
comment on table public.ph_fg_pallets is
  'Finished-goods pallet (ST-10, SM-FGP, FGP-YYMMDD-NNNNN): created only after a QC-2 final Pass for its Job Card (G6), '
  'stamped by QC (approval time starts the 24 h validity, CP-06), labelled with the Section 7.3 fields (V-09) and moved '
  'into a finished-goods fridge (V-07, V-08). Non-order pallets carry a grade (V-10).';
select app.register_table('public.ph_fg_pallets', 'ph_fg_pallet', false, 'ph_fg_pallet', p_default_policies => false);
create unique index ph_fg_pallets_code_uq on public.ph_fg_pallets (farm_id, code) where voided_at is null;
create index ph_fg_pallets_jc_idx on public.ph_fg_pallets (job_card_id);

create table public.ph_fg_pallet_lots (
  id            uuid primary key default gen_random_uuid(),
  fg_pallet_id  uuid not null references public.ph_fg_pallets(id),
  pallet_id     uuid not null references public.ph_incoming_pallets(id),
  lot_id        uuid references public.ph_lots(id),
  kg            numeric(10,2) not null check (kg >= 0),
  share         numeric(7,4) not null check (share > 0 and share <= 1),
  method        text not null check (method in ('exact', 'time_window', 'proportional'))
);
comment on table public.ph_fg_pallet_lots is
  'Composition of a finished-goods pallet (GEN-05/06): incoming pallets and lots with the kg attributed and the method '
  '(proportional to the kg issued to the Job Card unless the line segregates exactly), so traces show their confidence.';
select app.register_table('public.ph_fg_pallet_lots', 'ph_fg_pallet', false, p_default_policies => false);
create index ph_fg_pallet_lots_fg_idx on public.ph_fg_pallet_lots (fg_pallet_id);
create index ph_fg_pallet_lots_ip_idx on public.ph_fg_pallet_lots (pallet_id);

create trigger ph_jc_packaging_append_only before update on public.ph_jc_packaging for each row execute function app.ph_append_only();
create trigger ph_fg_pallet_lots_append_only before update on public.ph_fg_pallet_lots for each row execute function app.ph_append_only();

-- Inspections now also cover the line-start check (G5) and QC-2 (G6) of a Job Card.
alter table public.ph_inspections drop constraint ph_inspections_inspection_type_check;
alter table public.ph_inspections add constraint ph_inspections_inspection_type_check
  check (inspection_type in ('vehicle_in', 'arrival', 'rma', 'recheck', 'qc1', 'line_start', 'qc2'));
alter table public.ph_inspections add column job_card_id uuid references public.ph_job_cards(id);
alter table public.ph_inspections add column qc2_stage text check (qc2_stage in ('online', 'final'));
alter table public.ph_inspections add constraint ph_inspections_qc2_stage_check2 check ((inspection_type = 'qc2') = (qc2_stage is not null));
create index ph_inspections_jc_idx on public.ph_inspections (job_card_id);
alter table public.ph_job_cards add constraint ph_job_cards_line_start_fk foreign key (line_start_inspection_id) references public.ph_inspections(id);
alter table public.ph_fg_pallets add constraint ph_fg_pallets_qc2_fk foreign key (qc2_inspection_id) references public.ph_inspections(id);

-- Checklists per crop: a template may be crop-specific (the product SOPs differ by crop).
alter table public.ph_inspection_templates add column crop_code text;
drop index public.ph_inspection_templates_uq;
create unique index ph_inspection_templates_uq on public.ph_inspection_templates (farm_id, inspection_type, coalesce(crop_code, ''), version_no)
  where voided_at is null;

-- Labels and moves cover finished-goods pallets too.
alter table public.ph_label_prints drop constraint ph_label_prints_entity_type_check;
alter table public.ph_label_prints add constraint ph_label_prints_entity_type_check check (entity_type in ('ph_incoming_pallets', 'ph_fg_pallets'));
alter table public.ph_label_prints drop constraint ph_label_prints_label_type_check;
alter table public.ph_label_prints add constraint ph_label_prints_label_type_check check (label_type in ('receiving', 'fg'));
alter table public.ph_stock_moves alter column pallet_id drop not null;
alter table public.ph_stock_moves add column fg_pallet_id uuid references public.ph_fg_pallets(id);
alter table public.ph_stock_moves add constraint ph_stock_moves_one_subject check (num_nonnulls(pallet_id, fg_pallet_id) = 1);
create index ph_stock_moves_fg_idx on public.ph_stock_moves (fg_pallet_id, moved_at);

do $$
declare t text;
begin
  foreach t in array array['ph_job_cards', 'ph_jc_inputs', 'ph_jc_packaging', 'ph_fg_pallets', 'ph_fg_pallet_lots'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.ph_is_member(farm_id))', t || '_select', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------
create or replace function app.guard_ph_job_cards_built(r jsonb) returns boolean language sql stable as $$ select app.ph_in_rpc() $$;
create function app.guard_ph_jc_plan_ok(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and r ->> 'line_id' is not null and r ->> 'crop_id' is not null and r ->> 'grade_target' is not null $$;
create function app.guard_ph_jc_ready_ok(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc()
     and exists (select 1 from public.ph_jc_inputs i where i.job_card_id = (r ->> 'id')::uuid and i.closed_at is null and i.voided_at is null)
     and exists (select 1 from public.ph_jc_packaging k where k.job_card_id = (r ->> 'id')::uuid and k.voided_at is null) $$;
create function app.guard_ph_jc_line_start_ok(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and exists (select 1 from public.ph_inspections i
                                      where i.id = (r ->> 'line_start_inspection_id')::uuid and i.result = 'pass' and i.voided_at is null) $$;
create function app.guard_ph_jc_inputs_closed(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc()
     and not exists (select 1 from public.ph_jc_inputs i where i.job_card_id = (r ->> 'id')::uuid and i.closed_at is null and i.voided_at is null) $$;
create function app.guard_ph_jc_no_inputs(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc()
     and not exists (select 1 from public.ph_jc_inputs i where i.job_card_id = (r ->> 'id')::uuid and i.voided_at is null) $$;
create function app.guard_ph_fg_qc_ok(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and exists (select 1 from public.ph_inspections i
                                      where i.id = (r ->> 'qc2_inspection_id')::uuid and i.result = 'pass' and i.voided_at is null) $$;
-- Built in later increments (reconciliation and waste: M2.2; allocation, loading, holds, split/merge: M2.3 / M3).
create function app.guard_ph_jc_reconcile_later(r jsonb) returns boolean language sql stable as $$ select false $$;
create function app.guard_ph_fg_later(r jsonb) returns boolean language sql stable as $$ select false $$;

-- ---------------------------------------------------------------------------------------------
-- Workflows and checklists
-- ---------------------------------------------------------------------------------------------
create function app.seed_ph_production(p_farm uuid) returns void
language plpgsql
as $$
begin
  if exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'ph_job_card') then
    return;
  end if;

  perform app.define_workflow(p_farm, 'ph_job_card',
    '[{"code":"draft","ar":"مسودة","en":"Draft","initial":true,"sort":1},
      {"code":"planned","ar":"مخطط","en":"Planned","sort":2},
      {"code":"ready","ar":"جاهز","en":"Ready","sort":3},
      {"code":"line_check_failed","ar":"فشل فحص بدء الخط","en":"Line-start check failed","sort":4},
      {"code":"in_progress","ar":"قيد التشغيل","en":"In progress","sort":5},
      {"code":"paused","ar":"متوقف مؤقتاً","en":"Paused","sort":6},
      {"code":"completed","ar":"مكتمل","en":"Completed","sort":7},
      {"code":"reconciled","ar":"تمت المطابقة","en":"Reconciled","sort":8},
      {"code":"closed","ar":"مغلق","en":"Closed","terminal":true,"sort":9},
      {"code":"cancelled","ar":"ملغى","en":"Cancelled","terminal":true,"sort":10}]',
    '[{"from":"draft","to":"planned","action":"approve","ph":"job_card.approve","guard":"ph_jc_plan_ok","actor":"approved_by"},
      {"from":"planned","to":"ready","action":"execute","ph":"job_card.execute","guard":"ph_jc_ready_ok","actor":"ready_by"},
      {"from":"ready","to":"in_progress","action":"execute","ph":"line_start.submit","guard":"ph_jc_line_start_ok","actor":"started_by"},
      {"from":"ready","to":"line_check_failed","action":"execute","ph":"line_start.submit","guard":"ph_rpc"},
      {"from":"line_check_failed","to":"ready","action":"execute","ph":"job_card.execute","guard":"ph_rpc","req":["comment"]},
      {"from":"in_progress","to":"paused","action":"execute","ph":"job_card.execute","guard":"ph_rpc","req":["comment"]},
      {"from":"paused","to":"in_progress","action":"execute","ph":"job_card.execute","guard":"ph_rpc"},
      {"from":"in_progress","to":"completed","action":"execute","ph":"job_card.execute","guard":"ph_jc_inputs_closed","actor":"completed_by"},
      {"from":"completed","to":"reconciled","action":"approve","ph":"job_card.close","guard":"ph_jc_reconcile_later"},
      {"from":"reconciled","to":"closed","action":"close","ph":"job_card.close","guard":"ph_jc_reconcile_later"},
      {"from":"closed","to":"completed","action":"approve","ph":"job_card.close","guard":"ph_jc_reconcile_later","req":["comment"]},
      {"from":"draft","to":"cancelled","action":"close","ph":"job_card.approve","guard":"ph_jc_no_inputs","req":["comment"]},
      {"from":"planned","to":"cancelled","action":"close","ph":"job_card.approve","guard":"ph_jc_no_inputs","req":["comment"]}]');

  perform app.define_workflow(p_farm, 'ph_fg_pallet',
    '[{"code":"created","ar":"منشأة","en":"Created","initial":true,"sort":1},
      {"code":"qc_approved","ar":"معتمدة من الجودة","en":"QC approved","sort":2},
      {"code":"in_storage","ar":"في التخزين","en":"In storage","sort":3},
      {"code":"allocated","ar":"مخصصة","en":"Allocated","sort":4},
      {"code":"picked","ar":"ملتقطة","en":"Picked","sort":5},
      {"code":"reinspection_required","ar":"تتطلب إعادة فحص","en":"Re-inspection required","sort":6},
      {"code":"dispatch_rejected","ar":"مرفوضة عند الشحن","en":"Dispatch rejected","sort":7},
      {"code":"cooling","ar":"قيد التبريد","en":"Cooling","sort":8},
      {"code":"loaded","ar":"محمّلة","en":"Loaded","sort":9},
      {"code":"dispatched","ar":"مشحونة","en":"Dispatched","terminal":true,"sort":10},
      {"code":"on_hold","ar":"محجوزة","en":"On hold","sort":11},
      {"code":"reworked","ar":"أعيد تشغيلها","en":"Reworked","terminal":true,"sort":12},
      {"code":"waste","ar":"هدر","en":"Waste","terminal":true,"sort":13},
      {"code":"age_blocked","ar":"موقوفة بسبب العمر","en":"Age blocked","sort":14},
      {"code":"split_merged","ar":"مقسومة / مدمجة","en":"Split / merged","terminal":true,"sort":15}]',
    '[{"from":"created","to":"qc_approved","action":"verify","ph":"qc2.submit","guard":"ph_fg_qc_ok","actor":"qc_approved_by"},
      {"from":"qc_approved","to":"in_storage","action":"execute","ph":"stock_move.execute","guard":"ph_rpc"},
      {"from":"qc_approved","to":"in_storage","action":"approve","ph":"stock_move.override_placement","guard":"ph_rpc"},
      {"from":"in_storage","to":"allocated","action":"execute","ph":"load.create","guard":"ph_fg_later"},
      {"from":"allocated","to":"in_storage","action":"execute","ph":"load.create","guard":"ph_fg_later"},
      {"from":"allocated","to":"picked","action":"execute","ph":"load.pick","guard":"ph_fg_later"},
      {"from":"picked","to":"loaded","action":"execute","ph":"load.pick","guard":"ph_fg_later"},
      {"from":"picked","to":"reinspection_required","action":"execute","ph":"load.release_pallet","guard":"ph_fg_later"},
      {"from":"reinspection_required","to":"picked","action":"approve","ph":"load.release_pallet","guard":"ph_fg_later"},
      {"from":"reinspection_required","to":"dispatch_rejected","action":"approve","ph":"load.release_pallet","guard":"ph_fg_later"},
      {"from":"picked","to":"cooling","action":"execute","ph":"load.product_temp","guard":"ph_fg_later"},
      {"from":"cooling","to":"picked","action":"execute","ph":"load.product_temp","guard":"ph_fg_later"},
      {"from":"dispatch_rejected","to":"on_hold","action":"execute","ph":"load.decide_rejected","guard":"ph_fg_later"},
      {"from":"on_hold","to":"reworked","action":"approve","ph":"hold.decide_quality","guard":"ph_fg_later"},
      {"from":"on_hold","to":"in_storage","action":"approve","ph":"hold.release","guard":"ph_fg_later"},
      {"from":"on_hold","to":"waste","action":"approve","ph":"hold.decide_quality","guard":"ph_fg_later"},
      {"from":"in_storage","to":"age_blocked","action":"execute","ph":"stock_move.execute","guard":"ph_fg_later"},
      {"from":"age_blocked","to":"on_hold","action":"execute","ph":"hold.raise","guard":"ph_fg_later"},
      {"from":"in_storage","to":"split_merged","action":"execute","ph":"fg_pallet.split_merge","guard":"ph_fg_later"},
      {"from":"loaded","to":"dispatched","action":"execute","ph":"load.finalise","guard":"ph_fg_later"}]');

  perform app.seed_ph_production_templates(p_farm);
end;
$$;

-- Line-start (G5) and QC-2 (G6) checklists. Item wording is the SOPs' own (draft version 001, effective date blank),
-- so they are labelled C with that source; values the SOPs leave to "company-approved grading standards" are not here.
create function app.seed_ph_production_templates(p_farm uuid) returns void
language sql
as $$
  insert into public.ph_inspection_templates (farm_id, inspection_type, crop_code, items, evidence, source, note, state)
  values
    (p_farm, 'line_start', 'cherry_tomato', '[
      {"code":"sorter_calibration","en":"Elifab sorting machine: calibration for size, color and defect detection verified before start-up","ar":"آلة الفرز Elifab: التحقق من معايرة الحجم واللون وكشف العيوب قبل التشغيل"},
      {"code":"line_clean","en":"Machine and conveyor belts clean, free of product residue or contamination; sorting channels/outlets free of blockages","ar":"الآلة والسيور نظيفة وخالية من بقايا المنتج أو التلوث، ومسارات/مخارج الفرز خالية من الانسدادات"},
      {"code":"packer_settings","en":"Packing machine settings match the required box size (large/small) and the order specification","ar":"إعدادات آلة التعبئة مطابقة لحجم العبوة المطلوب (كبيرة/صغيرة) ومواصفة الطلب"},
      {"code":"packaging_ok","en":"Packaging material free of damage","ar":"مواد التعبئة خالية من التلف"}]'::jsonb,
     'C', 'SOP Cherry Tomato §8 (draft 001)', 'Draft SOP, no effective date. Sorting is checked against the specification agreed within the company, which has not been supplied (OD-05/OD-06).', 'in_effect'),
    (p_farm, 'line_start', 'regular_tomato', '[
      {"code":"sorter_calibration","en":"AWETA sorting machine: calibration for size, color and defect detection verified before start-up","ar":"آلة الفرز AWETA: التحقق من معايرة الحجم واللون وكشف العيوب قبل التشغيل"},
      {"code":"line_clean","en":"Machine and conveyor belts clean, free of product residue or contamination; sorting channels/outlets free of blockages","ar":"الآلة والسيور نظيفة وخالية من بقايا المنتج أو التلوث، ومسارات/مخارج الفرز خالية من الانسدادات"},
      {"code":"color_sorting","en":"Sorting set to be carried out correctly in terms of color","ar":"الفرز مضبوط ليتم بشكل صحيح من حيث اللون"}]'::jsonb,
     'C', 'SOP Tomato §7 (draft 001)', 'Draft SOP, no effective date. The tomato SOP lists no packing-machine item.', 'in_effect'),
    (p_farm, 'line_start', 'blocky', '[
      {"code":"sorter_calibration","en":"AWETA sorting machine: calibration for size, color and defect detection verified before start-up","ar":"آلة الفرز AWETA: التحقق من معايرة الحجم واللون وكشف العيوب قبل التشغيل"},
      {"code":"line_clean","en":"Machine and conveyor belts clean, free of product residue or contamination; sorting channels/outlets free of blockages","ar":"الآلة والسيور نظيفة وخالية من بقايا المنتج أو التلوث، ومسارات/مخارج الفرز خالية من الانسدادات"},
      {"code":"washing","en":"Blocky Capsicum washing process verified","ar":"التحقق من عملية غسيل الفلفل البلوكي"},
      {"code":"product_clean","en":"Before packing, product clean and free of dust and leaves","ar":"قبل التعبئة: المنتج نظيف وخالٍ من الغبار والأوراق"}]'::jsonb,
     'C', 'SOP Blocky Capsicum Color §7 (draft 001)', 'Draft SOP, no effective date. The SOP names the crop "Blocky Capsicum"; the crop master identity is open (OD-30).', 'in_effect'),
    (p_farm, 'line_start', 'sweetbite', '[
      {"code":"color_completion","en":"Color completion 90–100% of the target color (Red/Yellow/Orange), no more than 10% green/undeveloped surface","ar":"اكتمال اللون 90–100% من اللون المستهدف (أحمر/أصفر/برتقالي) دون تجاوز 10% سطح أخضر/غير مكتمل"},
      {"code":"size","en":"Length and diameter (caliper) match the accepted specification","ar":"الطول والقطر (بالقدمة) مطابقان للمواصفة المقبولة"},
      {"code":"stem","en":"Stem/calyx fresh, green and firmly attached","ar":"العنق/الكأس طازج وأخضر ومثبت بإحكام"},
      {"code":"defects","en":"No wrinkling, soft spots, cuts, sunscald, insect damage or decay","ar":"لا تجعد ولا بقع طرية ولا جروح ولا لفحة شمس ولا ضرر حشري ولا تعفن"},
      {"code":"weight_range","en":"Weight range matches the accepted specification","ar":"مدى الوزن مطابق للمواصفة المقبولة"},
      {"code":"packaging_ok","en":"Packaging material integrity (punnets/clamshells free of damage)","ar":"سلامة مواد التعبئة (العلب خالية من التلف)"}]'::jsonb,
     'C', 'SOP Sweet Bite Pepper §8 (draft 001)', 'Draft SOP, no effective date. Accepted size and weight specifications have not been supplied (OD-06).', 'in_effect'),
    (p_farm, 'line_start', 'melon', '[
      {"code":"grade_sorting","en":"Correct grade sorting before packing","ar":"صحة الفرز حسب الدرجة قبل التعبئة"},
      {"code":"packaging_ok","en":"Packaging material integrity (cartons/nets free of damage)","ar":"سلامة مواد التعبئة (الكراتين/الشباك خالية من التلف)"}]'::jsonb,
     'C', 'SOP Melon §7 (draft 001)', 'Draft SOP, no effective date. Melon is not in the crop master yet.', 'in_effect'),
    (p_farm, 'line_start', 'watermelon', '[
      {"code":"grade_sorting","en":"Correct grade sorting before packing","ar":"صحة الفرز حسب الدرجة قبل التعبئة"},
      {"code":"packaging_ok","en":"Packaging material integrity (cartons/nets free of damage)","ar":"سلامة مواد التعبئة (الكراتين/الشباك خالية من التلف)"}]'::jsonb,
     'C', 'SOP Watermelon §7 (draft 001)', 'Draft SOP, no effective date.', 'in_effect'),
    (p_farm, 'line_start', null, '[
      {"code":"product_compliance","en":"Product complies with requirements before packing (G5)","ar":"المنتج مطابق للمتطلبات قبل التعبئة (G5)"}]'::jsonb,
     'NYV', 'Spec G5 (SOP-PL)', 'No product SOP supplied for this crop; QC to supply the checklist.', 'in_effect'),

    (p_farm, 'qc2', 'cherry_tomato', '[
      {"code":"sample","en":"Production sample drawn (2.5% working example, SOP §5)","ar":"سحب عينة إنتاج (2.5% مثال عملي، الإجراء §5)"},
      {"code":"sorting_spec","en":"Sorting correct according to the specification agreed within the company","ar":"الفرز صحيح حسب المواصفة المتفق عليها داخل الشركة"},
      {"code":"critical_defects","en":"No critical defects (rot, cracks, pest damage, immaturity, contamination)","ar":"لا عيوب حرجة (تعفن، تشققات، ضرر آفات، عدم نضج، تلوث)"},
      {"code":"labeling","en":"Labeling correct: variety, grade, weight, batch/lot number, packing date","ar":"البطاقة صحيحة: الصنف، الدرجة، الوزن، رقم الدفعة/اللوت، تاريخ التعبئة"},
      {"code":"net_gross","en":"Net and gross weight accurate","ar":"دقة الوزن الصافي والإجمالي"}]'::jsonb,
     'C', 'SOP Cherry Tomato §5, §8, §11 (draft 001)', 'Draft SOP. Grade criteria are in "company-approved grading standards", not supplied: the result is a QC judgement flagged for review.', 'in_effect'),
    (p_farm, 'qc2', 'regular_tomato', '[
      {"code":"sample","en":"Production sample drawn (2.5% working example, SOP §5)","ar":"سحب عينة إنتاج (2.5% مثال عملي، الإجراء §5)"},
      {"code":"sorting_spec","en":"Sorting correct according to the specification agreed within the company","ar":"الفرز صحيح حسب المواصفة المتفق عليها داخل الشركة"},
      {"code":"color_sorting","en":"Sorting carried out correctly in terms of color","ar":"الفرز تم بشكل صحيح من حيث اللون"},
      {"code":"critical_defects","en":"No critical defects (rot, cracks, pest damage, immaturity, contamination)","ar":"لا عيوب حرجة (تعفن، تشققات، ضرر آفات، عدم نضج، تلوث)"},
      {"code":"labeling","en":"Labeling correct: variety, grade, weight, batch/lot number, packing date","ar":"البطاقة صحيحة: الصنف، الدرجة، الوزن، رقم الدفعة/اللوت، تاريخ التعبئة"},
      {"code":"net_gross","en":"Net and gross weight accurate","ar":"دقة الوزن الصافي والإجمالي"}]'::jsonb,
     'C', 'SOP Tomato §5, §7, §10 (draft 001)', 'Draft SOP. Grade criteria not supplied: QC judgement flagged for review.', 'in_effect'),
    (p_farm, 'qc2', 'blocky', '[
      {"code":"sample","en":"Production sample drawn (2.5% working example, SOP §5)","ar":"سحب عينة إنتاج (2.5% مثال عملي، الإجراء §5)"},
      {"code":"sorting_spec","en":"Sorting correct according to the specification agreed within the company","ar":"الفرز صحيح حسب المواصفة المتفق عليها داخل الشركة"},
      {"code":"color_sorting","en":"Sorting carried out correctly in terms of color","ar":"الفرز تم بشكل صحيح من حيث اللون"},
      {"code":"product_clean","en":"Product clean and free of dust and leaves","ar":"المنتج نظيف وخالٍ من الغبار والأوراق"},
      {"code":"critical_defects","en":"No critical defects (rot, cracks, pest damage, immaturity, contamination)","ar":"لا عيوب حرجة (تعفن، تشققات، ضرر آفات، عدم نضج، تلوث)"},
      {"code":"labeling","en":"Labeling correct: variety, grade, weight, batch/lot number, packing date","ar":"البطاقة صحيحة: الصنف، الدرجة، الوزن، رقم الدفعة/اللوت، تاريخ التعبئة"},
      {"code":"net_gross","en":"Net and gross weight accurate","ar":"دقة الوزن الصافي والإجمالي"}]'::jsonb,
     'C', 'SOP Blocky Capsicum Color §5, §7, §10 (draft 001)', 'Draft SOP. Grade criteria not supplied: QC judgement flagged for review.', 'in_effect'),
    (p_farm, 'qc2', 'sweetbite', '[
      {"code":"sample","en":"2.5% of units inspected on the line at regular intervals (working example, SOP §5)","ar":"فحص 2.5% من الوحدات على الخط على فترات منتظمة (مثال عملي، الإجراء §5)"},
      {"code":"color_completion","en":"Color completion 90–100% of the target color, no more than 10% green/undeveloped surface","ar":"اكتمال اللون 90–100% من اللون المستهدف دون تجاوز 10% سطح أخضر/غير مكتمل"},
      {"code":"color_mix","en":"Color mix ratio correct before sealing packs","ar":"نسبة خلط الألوان صحيحة قبل إغلاق العبوات"},
      {"code":"no_green","en":"No green/immature or damaged units in the final pack","ar":"لا وحدات خضراء/غير ناضجة أو تالفة في العبوة النهائية"},
      {"code":"defects","en":"No wrinkling, soft spots, cuts, sunscald, insect damage or decay","ar":"لا تجعد ولا بقع طرية ولا جروح ولا لفحة شمس ولا ضرر حشري ولا تعفن"},
      {"code":"packaging_ok","en":"Packaging integrity (punnets/clamshells free of damage)","ar":"سلامة العبوات (العلب خالية من التلف)"},
      {"code":"labeling","en":"Labeling correct: variety, color mix, weight, batch/lot number, packing date","ar":"البطاقة صحيحة: الصنف، خلطة الألوان، الوزن، رقم الدفعة/اللوت، تاريخ التعبئة"},
      {"code":"net_gross","en":"Net and gross weight accurate","ar":"دقة الوزن الصافي والإجمالي"}]'::jsonb,
     'C', 'SOP Sweet Bite Pepper §5, §8, §11 (draft 001)', 'Draft SOP. Reject when color completion is below 90% or critical defects are found (SOP §11).', 'in_effect'),
    (p_farm, 'qc2', 'melon', '[
      {"code":"grade_sorting","en":"Correct grade sorting before packing","ar":"صحة الفرز حسب الدرجة قبل التعبئة"},
      {"code":"brix","en":"Brix on the internal sample when performed: Grade A 10%; Grade B 9–10%","ar":"البركس في العينة الداخلية عند إجرائها: الدرجة A ‏10%؛ الدرجة B ‏9–10%"},
      {"code":"critical_defects","en":"No critical defects (rot, cracks, pest damage, immaturity, contamination)","ar":"لا عيوب حرجة (تعفن، تشققات، ضرر آفات، عدم نضج، تلوث)"},
      {"code":"packaging_ok","en":"Packaging integrity (cartons/nets free of damage)","ar":"سلامة العبوات (الكراتين/الشباك خالية من التلف)"},
      {"code":"labeling","en":"Labeling correct: variety, grade, weight, batch/lot number, packing date","ar":"البطاقة صحيحة: الصنف، الدرجة، الوزن، رقم الدفعة/اللوت، تاريخ التعبئة"},
      {"code":"net_gross","en":"Net and gross weight accurate","ar":"دقة الوزن الصافي والإجمالي"}]'::jsonb,
     'C', 'SOP Melon §5, §7, §10 (draft 001)', 'Draft SOP, as written: Brix Grade A "10%", Grade B "9–10%". Melon is not in the crop master yet.', 'in_effect'),
    (p_farm, 'qc2', 'watermelon', '[
      {"code":"grade_sorting","en":"Correct grade sorting before packing","ar":"صحة الفرز حسب الدرجة قبل التعبئة"},
      {"code":"brix","en":"Brix on the internal sample when performed: Grade A 8–13 Brix; Grade B greater than 7 Brix","ar":"البركس في العينة الداخلية عند إجرائها: الدرجة A ‏8–13؛ الدرجة B أكثر من 7"},
      {"code":"critical_defects","en":"No critical defects (rot, cracks, pest damage, immaturity, contamination)","ar":"لا عيوب حرجة (تعفن، تشققات، ضرر آفات، عدم نضج، تلوث)"},
      {"code":"packaging_ok","en":"Packaging integrity (cartons/nets free of damage)","ar":"سلامة العبوات (الكراتين/الشباك خالية من التلف)"},
      {"code":"labeling","en":"Labeling correct: variety, grade, weight, batch/lot number, packing date","ar":"البطاقة صحيحة: الصنف، الدرجة، الوزن، رقم الدفعة/اللوت، تاريخ التعبئة"},
      {"code":"net_gross","en":"Net and gross weight accurate","ar":"دقة الوزن الصافي والإجمالي"}]'::jsonb,
     'C', 'SOP Watermelon §5, §7, §10 (draft 001)', 'Draft SOP, no effective date.', 'in_effect'),
    (p_farm, 'qc2', null, '[
      {"code":"quality","en":"Product quality verified","ar":"التحقق من جودة المنتج"},
      {"code":"packaging","en":"Packaging verified","ar":"التحقق من العبوات"},
      {"code":"labeling","en":"Labeling verified","ar":"التحقق من البطاقات التعريفية"}]'::jsonb,
     'C', 'QC Function REC001 §4.3 (draft 001)', 'No product SOP supplied for this crop: the QC Function charter items only.', 'in_effect')
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
end $$;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
-- The crop-specific checklist when one exists, else the general one for the inspection type.
create function app.ph_template_for(p_farm uuid, p_type text, p_crop uuid) returns uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select t.id from public.ph_inspection_templates t
   where t.farm_id = p_farm and t.inspection_type = p_type and t.state = 'in_effect' and t.voided_at is null
     and (t.crop_code is null or t.crop_code = (select code from public.ph_crops where id = p_crop))
   order by (t.crop_code is not null) desc, t.version_no desc limit 1
$$;

create function app.ph_job_card(p_ref text) returns public.ph_job_cards
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_job_cards;
begin
  select * into r from public.ph_job_cards j
   where (j.id::text = p_ref or upper(j.code) = upper(trim(p_ref))) and j.voided_at is null and app.ph_is_member(j.farm_id);
  if not found then
    raise exception 'Job Card % not found', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'ph.jc.notFound', 'ref', p_ref)::text;
  end if;
  return r;
end;
$$;

create function app.ph_fg_pallet(p_ref text) returns public.ph_fg_pallets
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_fg_pallets;
begin
  select * into r from public.ph_fg_pallets f
   where (f.id::text = p_ref or upper(f.code) = upper(trim(p_ref))) and f.voided_at is null and app.ph_is_member(f.farm_id);
  if not found then
    raise exception 'Finished-goods pallet % not found', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'ph.fg.notFound', 'ref', p_ref)::text;
  end if;
  return r;
end;
$$;

-- kg of an incoming pallet still available to issue: received net kg less kg on open issues and kg already consumed.
create function app.ph_ip_available_kg(p_pallet uuid) returns numeric
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select p.net_kg
         - coalesce((select sum(i.issued_kg) from public.ph_jc_inputs i where i.pallet_id = p.id and i.closed_at is null and i.voided_at is null), 0)
         - coalesce((select sum(i.consumed_kg) from public.ph_jc_inputs i where i.pallet_id = p.id and i.closed_at is not null and i.voided_at is null), 0)
    from public.ph_incoming_pallets p where p.id = p_pallet
$$;

-- Latest QC-2 final inspection of a Job Card: 'pass', 'fail' or null.
create function app.ph_jc_qc2_final(p_jc uuid) returns text
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select i.result from public.ph_inspections i
   where i.job_card_id = p_jc and i.inspection_type = 'qc2' and i.qc2_stage = 'final' and i.voided_at is null
   order by i.event_at desc, i.code desc limit 1
$$;

-- Latest QC-2 result of any stage (a later online Fail also stops new finished pallets until a new final Pass).
create function app.ph_jc_qc2_latest(p_jc uuid) returns public.ph_inspections
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select i.* from public.ph_inspections i
   where i.job_card_id = p_jc and i.inspection_type = 'qc2' and i.voided_at is null
   order by i.event_at desc, i.code desc limit 1
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-08 Job Card: create, approve, cancel
-- ---------------------------------------------------------------------------------------------
create function public.ph_create_job_card(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm  uuid := app.ph_farm_of_user();
  v_basis text;
  v_line  public.ph_lines;
  v_crop  public.ph_crops;
  v_date  date := coalesce((p ->> 'planned_date')::date, app.ph_local_date());
  v_id    uuid := gen_random_uuid();
  v_code  text;
  v_missing text[] := '{}';
begin
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  v_basis := app.ph_authorize(v_farm, 'job_card.create');
  if (p ->> 'line_id') is null then v_missing := v_missing || 'line_id'::text; end if;
  if (p ->> 'crop_id') is null then v_missing := v_missing || 'crop_id'::text; end if;
  if coalesce(p ->> 'grade_target', '') = '' then v_missing := v_missing || 'grade_target'::text; end if;
  if cardinality(v_missing) > 0 then
    raise exception 'Job Card fields missing: %', array_to_string(v_missing, ', ') using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.v01', 'missing', v_missing)::text;
  end if;
  select * into v_line from public.ph_lines where id = (p ->> 'line_id')::uuid and farm_id = v_farm and voided_at is null;
  if not found or v_line.verification_status <> 'verified' then
    raise exception 'Line not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', coalesce(v_line.code, '?'))::text;
  end if;
  select * into v_crop from public.ph_crops where id = (p ->> 'crop_id')::uuid and farm_id = v_farm and voided_at is null;
  if not found or v_crop.verification_status <> 'verified' or v_crop.superseded_at is not null then
    raise exception 'Crop not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', coalesce(v_crop.code, '?'))::text;
  end if;
  if v_crop.decision_code is not null then
    perform app.ph_decision_gate(v_farm, v_crop.decision_code);
  end if;
  -- Line routing (Figure 4.2): a packing line (not the washer), one the crop master allows when it lists any.
  if v_line.kind = 'washer' or (cardinality(v_crop.allowed_lines) > 0 and not (v_line.code = any (v_crop.allowed_lines))) then
    raise exception 'Crop % is routed to line(s) %, not %', v_crop.code, array_to_string(v_crop.allowed_lines, ', '), v_line.code
      using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.lineRoute', 'line', v_line.code, 'allowed', v_crop.allowed_lines)::text;
  end if;
  if (p ->> 'grade_target') not in ('premium', 'gr1', 'gr2') then
    raise exception 'Grade must be Premium, GR1 or GR2 (V-10)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v10')::text;
  end if;
  v_code := 'JC-' || to_char(v_date, 'YYMMDD') || '-' || v_line.code || '-'
            || lpad(app.ph_next(v_farm, 'JC:' || to_char(v_date, 'YYMMDD') || ':' || v_line.code)::text, 2, '0');
  insert into public.ph_job_cards (id, farm_id, code, line_id, crop_id, grade_target, customer_spec_ref, planned_date, attribution_method, notes, decision_basis)
  values (v_id, v_farm, v_code, v_line.id, v_crop.id, p ->> 'grade_target', nullif(trim(p ->> 'customer_spec_ref'), ''), v_date,
          coalesce(nullif(p ->> 'attribution_method', ''), 'proportional'), nullif(trim(p ->> 'notes'), ''),
          jsonb_build_object('job_card.create', v_basis));
  perform app.ph_notify_role(v_farm, 'PHM', 'ph_jc_approval_due', 'ph_job_cards', v_id, jsonb_build_object('code', v_code));
  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;

create function public.ph_approve_job_card(p_jc uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_job_cards;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'job_card.approve');
  if r.status <> 'draft' then
    raise exception 'Only a draft Job Card can be approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  perform app.ph_transition('ph_job_cards', r.id, 'planned', p_comment);
  perform app.ph_notify_role(r.farm_id, 'STK', 'ph_packaging_due', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
  perform app.ph_notify_role(r.farm_id, 'LL', 'ph_jc_planned', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
  return jsonb_build_object('id', r.id, 'code', r.code, 'status', 'planned');
end;
$$;

create function public.ph_cancel_job_card(p_jc uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_job_cards;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'job_card.approve');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  if r.status not in ('draft', 'planned') or exists (select 1 from public.ph_jc_inputs where job_card_id = r.id and voided_at is null) then
    raise exception 'Only a draft or planned Job Card with no inputs issued can be cancelled' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.jc.cancelInputs')::text;
  end if;
  perform app.ph_transition('ph_job_cards', r.id, 'cancelled', p_reason);
  return jsonb_build_object('id', r.id, 'code', r.code, 'status', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Inputs (V-05, GEN-04, T-08) and packaging
-- ---------------------------------------------------------------------------------------------
create function public.ph_issue_to_job_card(p_jc uuid, p_pallet text, p_kg numeric default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_job_cards;
  ip      public.ph_incoming_pallets;
  v_basis text;
  v_avail numeric;
  v_kg    numeric;
  v_id    uuid := gen_random_uuid();
begin
  r := app.ph_job_card(p_jc::text);
  v_basis := app.ph_authorize(r.farm_id, 'job_card.record_inputs');
  -- VR-PH-C13: the spec allows issue at Ready/InProgress (V-05) while Planned→Ready needs inputs; issue is allowed from Planned.
  if r.status not in ('planned', 'ready', 'in_progress') then
    raise exception 'Inputs can be issued to a planned, ready or running Job Card only' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  ip := app.ph_pallet(p_pallet);
  if ip.farm_id <> r.farm_id then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  -- V-05: only QC-1 released pallets that are not on hold (a pallet already issued may be issued again while kg remain).
  if ip.status not in ('released', 'issued') then
    raise exception 'Pallet % is %; only QC-1 released pallets can be issued (V-05)', ip.code, ip.status using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.v05', 'pallet', ip.code, 'status', ip.status)::text;
  end if;
  if (select code from public.ph_crops where id = ip.crop_id) <> (select code from public.ph_crops where id = r.crop_id) then
    raise exception 'Pallet % is a different crop from the Job Card', ip.code using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.jc.crop', 'pallet', ip.code)::text;
  end if;
  if exists (select 1 from public.ph_jc_inputs where job_card_id = r.id and pallet_id = ip.id and closed_at is null and voided_at is null) then
    raise exception 'Pallet % is already issued to this Job Card', ip.code using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.jc.alreadyIssued', 'pallet', ip.code)::text;
  end if;
  v_avail := app.ph_ip_available_kg(ip.id);
  v_kg := coalesce(p_kg, v_avail);
  if v_kg <= 0 or v_kg > v_avail then
    raise exception 'Issue between 0 and % kg', v_avail using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.jc.issueKg', 'available', v_avail)::text;
  end if;
  insert into public.ph_jc_inputs (id, farm_id, job_card_id, pallet_id, issued_kg, issue_basis)
  values (v_id, r.farm_id, r.id, ip.id, v_kg, v_basis);
  if ip.status = 'released' then
    perform app.ph_transition('ph_incoming_pallets', ip.id, 'issued', 'Issued to ' || r.code);
  end if;
  return jsonb_build_object('id', v_id, 'pallet', ip.code, 'issued_kg', v_kg, 'available_after', v_avail - v_kg);
end;
$$;

create function public.ph_issue_packaging(p_jc uuid, p_description text, p_quantity numeric, p_unit text default 'pc') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_job_cards;
  v_basis text;
  v_unit  uuid;
  v_id    uuid := gen_random_uuid();
begin
  r := app.ph_job_card(p_jc::text);
  v_basis := app.ph_authorize(r.farm_id, 'packaging.issue');
  if r.status not in ('planned', 'ready', 'in_progress', 'paused') then
    raise exception 'Packaging is issued to a planned or running Job Card' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  if coalesce(trim(p_description), '') = '' or coalesce(p_quantity, 0) <= 0 then
    raise exception 'Describe the packaging and give a quantity above zero' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.v01', 'missing', array['description', 'quantity'])::text;
  end if;
  select id into v_unit from public.units where farm_id = r.farm_id and code = p_unit and voided_at is null;
  if v_unit is null then raise exception 'Unknown unit %', p_unit using errcode = 'P0422'; end if;
  insert into public.ph_jc_packaging (id, farm_id, job_card_id, description, quantity, unit_id, issue_basis)
  values (v_id, r.farm_id, r.id, trim(p_description), p_quantity, v_unit, v_basis);
  return jsonb_build_object('id', v_id);
end;
$$;

create function public.ph_mark_job_card_ready(p_jc uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_job_cards;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'job_card.execute');
  if r.status <> 'planned' then
    raise exception 'Only a planned Job Card can be made ready' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  if not exists (select 1 from public.ph_jc_inputs where job_card_id = r.id and closed_at is null and voided_at is null) then
    raise exception 'Issue at least one released pallet first' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.needInputs')::text;
  end if;
  if not exists (select 1 from public.ph_jc_packaging where job_card_id = r.id and voided_at is null) then
    raise exception 'Packaging has not been issued' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.needPackaging')::text;
  end if;
  perform app.ph_transition('ph_job_cards', r.id, 'ready');
  perform app.ph_notify_role(r.farm_id, 'QCI', 'ph_line_start_due', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
  return jsonb_build_object('id', r.id, 'status', 'ready');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- G5 line-start check: one of QC / Line Leader records it, the other confirms (two people, SOP-PL "QC + LL")
-- ---------------------------------------------------------------------------------------------
create function public.ph_line_start_check(p_jc uuid, p_result text, p_checklist jsonb, p_reason text default null, p_remarks text default null)
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_job_cards;
  v_basis text;
  v_id    uuid := gen_random_uuid();
  v_code  text;
  v_roles text[];
begin
  r := app.ph_job_card(p_jc::text);
  v_basis := app.ph_authorize(r.farm_id, 'line_start.submit');
  if r.status <> 'ready' or r.line_start_inspection_id is not null then
    raise exception 'The line-start check is recorded once, on a ready Job Card' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  if p_result not in ('pass', 'fail') then raise exception 'Result must be pass or fail' using errcode = 'P0422'; end if;
  if p_result = 'fail' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A failed check needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  v_code := app.ph_code(r.farm_id, 'LSC', 4);
  insert into public.ph_inspections (id, farm_id, code, inspection_type, template_id, job_card_id, result, reason, checklist, remarks, signature_meaning, event_at)
  values (v_id, r.farm_id, v_code, 'line_start', app.ph_template_for(r.farm_id, 'line_start', r.crop_id), r.id, p_result,
          nullif(trim(p_reason), ''), coalesce(p_checklist, '{}'), nullif(trim(p_remarks), ''), 'recorded', clock_timestamp());
  if p_result = 'fail' then
    perform app.ph_transition('ph_job_cards', r.id, 'line_check_failed', p_reason);
    perform app.ph_notify_role(r.farm_id, 'PHM', 'ph_line_start_failed', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
    perform app.ph_notify_role(r.farm_id, 'PE', 'ph_line_start_failed', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
  else
    update public.ph_job_cards set line_start_inspection_id = v_id where id = r.id;
    v_roles := app.ph_user_spec_roles(app.current_user_id(), r.farm_id);
    perform app.ph_notify_role(r.farm_id, case when 'QCI' = any (v_roles) then 'LL' else 'QCI' end, 'ph_line_start_confirm',
                               'ph_job_cards', r.id, jsonb_build_object('code', r.code));
  end if;
  return jsonb_build_object('inspection_id', v_id, 'code', v_code, 'result', p_result);
end;
$$;

create function public.ph_confirm_line_start(p_jc uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r        public.ph_job_cards;
  i        public.ph_inspections;
  v_uid    uuid := app.current_user_id();
  v_mine   text[];
  v_theirs text[];
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'line_start.submit');
  select * into i from public.ph_inspections where id = r.line_start_inspection_id;
  if r.status <> 'ready' or i.id is null or i.result <> 'pass' then
    raise exception 'No passed line-start check to confirm' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.g5.notPassed')::text;
  end if;
  if i.created_by = v_uid then
    raise exception 'The line-start check is confirmed by a second person' using errcode = 'P0423',
      detail = jsonb_build_object('key', 'ph.sod', 'column', 'line_start_recorder')::text;
  end if;
  v_mine := app.ph_user_spec_roles(v_uid, r.farm_id);
  v_theirs := app.ph_user_spec_roles(i.created_by, r.farm_id);
  if not (('QCI' = any (v_theirs) and 'LL' = any (v_mine)) or ('LL' = any (v_theirs) and 'QCI' = any (v_mine))) then
    raise exception 'The line-start check is QC and Line Leader together' using errcode = 'P0423',
      detail = jsonb_build_object('key', 'ph.g5.pair')::text;
  end if;
  perform app.ph_transition('ph_job_cards', r.id, 'in_progress', p_comment);
  perform app.ph_notify_role(r.farm_id, 'QCI', 'ph_qc2_due', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
  return jsonb_build_object('id', r.id, 'status', 'in_progress');
end;
$$;

create function public.ph_line_check_corrected(p_jc uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_job_cards;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'job_card.execute');
  if r.status <> 'line_check_failed' then
    raise exception 'Only a Job Card whose line-start check failed' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Describe the correction' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['comment'])::text;
  end if;
  update public.ph_job_cards set line_start_inspection_id = null where id = r.id;
  perform app.ph_transition('ph_job_cards', r.id, 'ready', p_note);
  perform app.ph_notify_role(r.farm_id, 'QCI', 'ph_line_start_due', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
  return jsonb_build_object('id', r.id, 'status', 'ready');
end;
$$;

create function public.ph_pause_job_card(p_jc uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_job_cards;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'job_card.execute');
  if r.status <> 'in_progress' then
    raise exception 'Only a running Job Card can be paused' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  perform app.ph_transition('ph_job_cards', r.id, 'paused', p_reason);
  return jsonb_build_object('id', r.id, 'status', 'paused');
end;
$$;

create function public.ph_resume_job_card(p_jc uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_job_cards;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'job_card.execute');
  if r.status <> 'paused' then
    raise exception 'Only a paused Job Card can be resumed' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  perform app.ph_transition('ph_job_cards', r.id, 'in_progress');
  return jsonb_build_object('id', r.id, 'status', 'in_progress');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-09 QC-2 online / final inspection (G6). A Fail sends product back to the line for re-sort and stops new finished
-- pallets until a later final Pass; PHM and PE get the re-sort task (T-10), not the operators.
-- ---------------------------------------------------------------------------------------------
create function public.ph_qc2_record(p_jc uuid, p_stage text, p_result text, p_checklist jsonb, p_sample_note text default null,
                                     p_reason text default null, p_remarks text default null, p_attachment_ids uuid[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_job_cards;
  v_id    uuid := gen_random_uuid();
  v_code  text;
  v_basis text;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'qc2.submit');
  if r.status <> 'in_progress' then
    raise exception 'QC-2 is recorded while the Job Card is running' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  if p_stage not in ('online', 'final') then raise exception 'Stage must be online or final' using errcode = 'P0422'; end if;
  if p_result not in ('pass', 'fail') then raise exception 'Result must be pass or fail' using errcode = 'P0422'; end if;
  if p_result = 'fail' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A failed inspection needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  -- No customer specification (OD-06) and no company grading standard has been supplied: the result is a QC judgement.
  v_basis := case when r.customer_spec_ref is null then 'no_tolerance_set' else 'not_applicable' end;
  v_code := app.ph_code(r.farm_id, 'QC2', 4);
  insert into public.ph_inspections (id, farm_id, code, inspection_type, qc2_stage, template_id, job_card_id, result, reason, checklist,
                                     sample_note, tolerance_basis, remarks, signature_meaning, event_at)
  values (v_id, r.farm_id, v_code, 'qc2', p_stage, app.ph_template_for(r.farm_id, 'qc2', r.crop_id), r.id, p_result,
          nullif(trim(p_reason), ''), coalesce(p_checklist, '{}'), nullif(trim(p_sample_note), ''), v_basis, nullif(trim(p_remarks), ''),
          case when p_result = 'pass' then 'approved' else 'rejected' end, clock_timestamp());
  perform app.ph_link_attachments(p_attachment_ids, 'ph_inspections', v_id, r.farm_id);
  if p_result = 'fail' then
    perform app.ph_notify_role(r.farm_id, 'PHM', 'ph_qc2_failed', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
    perform app.ph_notify_role(r.farm_id, 'PE', 'ph_qc2_failed', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
  elsif p_stage = 'final' then
    perform app.ph_notify_role(r.farm_id, 'PHO', 'ph_fg_ready', 'ph_job_cards', r.id, jsonb_build_object('code', r.code));
  end if;
  return jsonb_build_object('inspection_id', v_id, 'code', v_code, 'result', p_result, 'tolerance_basis', v_basis);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-10 Finished-goods pallet: create (after G6), QC stamp, label (V-09), move into a finished-goods fridge
-- ---------------------------------------------------------------------------------------------
create function public.ph_create_fg_pallet(p_jc uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r        public.ph_job_cards;
  q        public.ph_inspections;
  sc       public.ph_equipment;
  v_basis  text;
  v_id     uuid := gen_random_uuid();
  v_code   text;
  v_kg     numeric := (p ->> 'net_kg')::numeric;
  v_boxes  integer := (p ->> 'box_count')::integer;
  v_grade  text := coalesce(nullif(p ->> 'grade', ''), (select grade_target from public.ph_job_cards where id = p_jc));
  v_total  numeric;
  v_unit   uuid;
  v_warn   jsonb := '[]';
  v_note   text;
begin
  r := app.ph_job_card(p_jc::text);
  v_basis := app.ph_authorize(r.farm_id, 'fg_pallet.create');
  if r.status <> 'in_progress' then
    raise exception 'Finished pallets are created while the Job Card is running' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  -- G6: the latest QC-2 record of the Job Card must be a final Pass.
  q := app.ph_jc_qc2_latest(r.id);
  if q.id is null or q.result <> 'pass' or q.qc2_stage <> 'final' then
    raise exception 'QC-2 final inspection has not passed for %', r.code using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.g6.notPassed', 'job_card', r.code)::text;
  end if;
  if v_grade not in ('premium', 'gr1', 'gr2') then
    raise exception 'A pallet not packed for an order carries a grade: Premium, GR1 or GR2 (V-10)' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.v10')::text;
  end if;
  if coalesce(v_kg, 0) <= 0 or coalesce(v_boxes, 0) <= 0 then
    raise exception 'Net weight and box count must be above zero' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v02')::text;
  end if;
  select * into sc from public.ph_equipment where id = (p ->> 'scale_id')::uuid and farm_id = r.farm_id and kind = 'scale' and voided_at is null;
  if not found then
    raise exception 'Scale required' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['scale_id'])::text;
  end if;
  if sc.verification_status <> 'verified' then
    raise exception 'Scale not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', sc.code)::text;
  end if;
  if sc.calibration_due_on is null or sc.calibration_due_on < app.ph_local_date() then
    v_warn := v_warn || jsonb_build_object('key', 'ph.calibration', 'scale', sc.code);
  end if;
  -- V-21: plausibility needs the tolerance from OD-29; until then the weight is recorded as not checked.
  if app.ph_param(r.farm_id, 'weight_plausibility_tolerance_pct') is null then
    v_note := 'Not checked: plausibility tolerance pending OD-29';
  end if;
  select sum(issued_kg) into v_total from public.ph_jc_inputs where job_card_id = r.id and voided_at is null;
  if coalesce(v_total, 0) <= 0 then
    raise exception 'The Job Card has no inputs' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.needInputs')::text;
  end if;
  select id into v_unit from public.units where farm_id = r.farm_id and code = 'kg' and voided_at is null;
  v_code := app.ph_code(r.farm_id, 'FGP', 5);
  insert into public.ph_fg_pallets (id, farm_id, code, job_card_id, crop_id, grade, box_count, net_kg, weight_unit_id, scale_id,
                                    calibration_flag, plausibility_note, qc2_inspection_id, earliest_harvest_at, decision_basis)
  values (v_id, r.farm_id, v_code, r.id, r.crop_id, v_grade, v_boxes, v_kg, v_unit, sc.id,
          sc.calibration_due_on is null or sc.calibration_due_on < app.ph_local_date(), v_note, q.id,
          (select min(ip.harvest_at) from public.ph_jc_inputs i join public.ph_incoming_pallets ip on ip.id = i.pallet_id
            where i.job_card_id = r.id and i.voided_at is null),
          jsonb_build_object('fg_pallet.create', v_basis));
  -- GEN-05/06: composition from the Job Card's inputs, in proportion to the kg issued (method recorded on the Job Card).
  insert into public.ph_fg_pallet_lots (farm_id, fg_pallet_id, pallet_id, lot_id, kg, share, method)
  select r.farm_id, v_id, i.pallet_id, ip.lot_id, round(v_kg * sum(i.issued_kg) / v_total, 2), round(sum(i.issued_kg) / v_total, 4), r.attribution_method
    from public.ph_jc_inputs i join public.ph_incoming_pallets ip on ip.id = i.pallet_id
   where i.job_card_id = r.id and i.voided_at is null
   group by i.pallet_id, ip.lot_id;
  perform app.ph_notify_role(r.farm_id, 'QCI', 'ph_fg_qc_due', 'ph_fg_pallets', v_id, jsonb_build_object('code', v_code));
  return jsonb_build_object('id', v_id, 'code', v_code, 'warnings', v_warn);
end;
$$;

create function public.ph_fg_qc_approve(p_fg uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare f public.ph_fg_pallets;
begin
  f := app.ph_fg_pallet(p_fg::text);
  perform app.ph_authorize(f.farm_id, 'qc2.submit');
  if f.status <> 'created' then
    raise exception 'Only a newly created pallet is stamped' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.fg.state', 'status', f.status)::text;
  end if;
  update public.ph_fg_pallets set qc_approved_at = now() where id = f.id;
  perform app.ph_transition('ph_fg_pallets', f.id, 'qc_approved', p_comment);
  return jsonb_build_object('id', f.id, 'code', f.code, 'qc_approved_at', now(),
                            'valid_until', now() + make_interval(hours => coalesce(app.ph_param(f.farm_id, 'qc_approval_validity_hours'), 24)::int));
end;
$$;

-- V-09: the label prints only when every Section 7.3 field it needs is known.
create function app.ph_fg_label_content(p_fg uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'pallet_no', f.code, 'job_card', j.code, 'grade', f.grade, 'box_count', f.box_count, 'net_kg', f.net_kg,
    'crop', c.name_ar, 'crop_en', c.name_en,
    'varieties', (select coalesce(jsonb_agg(distinct v.name_ar), '[]') from public.ph_fg_pallet_lots x join public.ph_incoming_pallets ip on ip.id = x.pallet_id
                    join public.ph_varieties v on v.id = ip.variety_id where x.fg_pallet_id = f.id),
    'lots', (select coalesce(jsonb_agg(distinct l.code), '[]') from public.ph_fg_pallet_lots x join public.ph_lots l on l.id = x.lot_id where x.fg_pallet_id = f.id),
    'sections', (select coalesce(jsonb_agg(distinct s.block_code || '/' || s.section_code), '[]') from public.ph_fg_pallet_lots x
                   join public.ph_incoming_pallets ip on ip.id = x.pallet_id join public.ph_sources s on s.id = ip.source_id
                  where x.fg_pallet_id = f.id and s.kind = 'own_farm' and s.section_code is not null),
    'suppliers', (select coalesce(jsonb_agg(distinct s.supplier_name), '[]') from public.ph_fg_pallet_lots x
                    join public.ph_incoming_pallets ip on ip.id = x.pallet_id join public.ph_sources s on s.id = ip.source_id
                   where x.fg_pallet_id = f.id and s.kind = 'supplier' and s.supplier_name is not null),
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
   where f.id = p_fg
$$;

create function public.ph_print_fg_label(p_fg uuid, p_reprint_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  f public.ph_fg_pallets;
  v jsonb;
begin
  select * into f from public.ph_fg_pallets where id = p_fg and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Pallet not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(f.farm_id, 'fg_pallet.create');
  if f.status not in ('created', 'qc_approved', 'in_storage') then
    raise exception 'No label for a pallet in status %', f.status using errcode = 'P0422';
  end if;
  if f.label_print_count > 0 and coalesce(trim(p_reprint_reason), '') = '' then
    raise exception 'A reprint needs a reason (logged)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.reprintReason')::text;
  end if;
  v := app.ph_fg_label_content(f.id);
  if jsonb_array_length(v -> 'missing') > 0 then
    raise exception 'FG label fields missing: %', v -> 'missing' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.v09', 'missing', v -> 'missing')::text;
  end if;
  v := v - 'missing';
  insert into public.ph_label_prints (farm_id, entity_type, entity_id, label_type, content, is_reprint, reason)
  values (f.farm_id, 'ph_fg_pallets', f.id, 'fg', v, f.label_print_count > 0, nullif(trim(p_reprint_reason), ''));
  update public.ph_fg_pallets set label_print_count = label_print_count + 1 where id = f.id;
  return v || jsonb_build_object('print_no', f.label_print_count + 1);
end;
$$;

create function public.ph_move_fg_pallet(p_fg text, p_to_location uuid, p_override_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  f        public.ph_fg_pallets;
  v_to     public.ph_locations;
  v_group  uuid;
  v_basis  text;
  v_occ    integer;
  v_over   boolean;
  v_warn   jsonb := '[]';
begin
  f := app.ph_fg_pallet(p_fg);
  if f.status not in ('qc_approved', 'in_storage') then
    raise exception 'Pallet % cannot be moved in status %', f.code, f.status using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.move.state', 'status', f.status)::text;
  end if;
  select * into v_to from public.ph_locations where id = p_to_location and farm_id = f.farm_id and voided_at is null;
  if not found then raise exception 'Unknown location' using errcode = 'P0404'; end if;
  if v_to.verification_status <> 'verified' then
    raise exception 'Location % is not approved', v_to.code using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', v_to.code)::text;
  end if;
  if v_to.purpose <> 'fg_storage' then
    raise exception 'Finished pallets go into a finished-goods fridge' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.move.purpose', 'purpose', v_to.purpose)::text;
  end if;
  if v_to.id = f.location_id then raise exception 'Pallet is already there' using errcode = 'P0422'; end if;
  -- V-07 applies to finished-goods fridges too (ST-06/12).
  select storage_group_id into v_group from public.ph_crops where id = f.crop_id;
  if v_to.storage_group_id is null or v_group is null or v_to.storage_group_id <> v_group then
    if coalesce(trim(p_override_reason), '') = '' then
      raise exception 'Storage group of % does not match the crop (V-07); a PHM override with a reason is needed', v_to.code
        using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v07', 'location', v_to.code)::text;
    end if;
    v_basis := app.ph_authorize(f.farm_id, 'stock_move.override_placement');
  else
    v_basis := app.ph_authorize(f.farm_id, 'stock_move.execute');
  end if;
  select (select count(*) from public.ph_incoming_pallets where location_id = v_to.id and voided_at is null and status in ('stored', 'released', 'on_hold', 'pre_cooling'))
       + (select count(*) from public.ph_fg_pallets where location_id = v_to.id and voided_at is null and status not in ('dispatched', 'reworked', 'waste', 'split_merged'))
    into v_occ;
  v_over := v_to.capacity_pallets is not null and v_occ >= v_to.capacity_pallets;
  if v_over then v_warn := v_warn || jsonb_build_object('key', 'ph.v08', 'capacity', v_to.capacity_pallets, 'occupancy', v_occ); end if;
  insert into public.ph_stock_moves (farm_id, fg_pallet_id, from_location_id, to_location_id, group_override_reason, over_capacity, permission_basis)
  values (f.farm_id, f.id, f.location_id, v_to.id, nullif(trim(p_override_reason), ''), v_over, v_basis);
  update public.ph_fg_pallets set location_id = v_to.id where id = f.id;
  if f.status = 'qc_approved' then
    perform app.ph_transition('ph_fg_pallets', f.id, 'in_storage', p_override_reason);
  end if;
  return jsonb_build_object('id', f.id, 'code', f.code, 'location', v_to.code, 'warnings', v_warn);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Job Card completion: every input closed as consumed + returned = issued; each pallet then goes back to storage with
-- its remaining kg (partial return) or is consumed (SM-IP).
-- ---------------------------------------------------------------------------------------------
create function public.ph_complete_job_card(p_jc uuid, p_closures jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_job_cards;
  c       record;
  x       jsonb;
  v_left  numeric;
  v_ip    public.ph_incoming_pallets;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'job_card.execute');
  if r.status <> 'in_progress' then
    raise exception 'Only a running Job Card can be completed' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  for c in select * from public.ph_jc_inputs where job_card_id = r.id and closed_at is null and voided_at is null for update loop
    select e into x from jsonb_array_elements(coalesce(p_closures, '[]')) e where e ->> 'input_id' = c.id::text;
    if x is null then
      raise exception 'Every issued pallet needs its consumed and returned kg' using errcode = 'P0422',
        detail = jsonb_build_object('key', 'ph.jc.closeAll')::text;
    end if;
    if (x ->> 'consumed_kg')::numeric < 0 or (x ->> 'returned_kg')::numeric < 0
       or (x ->> 'consumed_kg')::numeric + (x ->> 'returned_kg')::numeric <> c.issued_kg then
      raise exception 'Consumed + returned must equal the % kg issued', c.issued_kg using errcode = 'P0422',
        detail = jsonb_build_object('key', 'ph.jc.closeBalance', 'issued', c.issued_kg)::text;
    end if;
    update public.ph_jc_inputs set consumed_kg = (x ->> 'consumed_kg')::numeric, returned_kg = (x ->> 'returned_kg')::numeric, closed_at = now()
     where id = c.id;
  end loop;
  perform app.ph_transition('ph_job_cards', r.id, 'completed');
  update public.ph_job_cards set completed_at = now() where id = r.id;
  -- Pallets with nothing still open on any Job Card leave the 'issued' status.
  for v_ip in select p.* from public.ph_incoming_pallets p
               where p.status = 'issued' and p.id in (select pallet_id from public.ph_jc_inputs where job_card_id = r.id)
                 and not exists (select 1 from public.ph_jc_inputs i where i.pallet_id = p.id and i.closed_at is null and i.voided_at is null)
  loop
    v_left := app.ph_ip_available_kg(v_ip.id);
    perform app.ph_transition('ph_incoming_pallets', v_ip.id, case when v_left > 0 then 'stored' else 'consumed' end,
                              case when v_left > 0 then 'Returned to storage: ' || v_left || ' kg' else 'Fully consumed' end);
  end loop;
  return jsonb_build_object('id', r.id, 'status', 'completed') || (select to_jsonb(b) from (
    select coalesce(sum(consumed_kg), 0) as consumed_kg, coalesce(sum(returned_kg), 0) as returned_kg
      from public.ph_jc_inputs where job_card_id = r.id and voided_at is null) b);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------------------------
create view public.ph_jc_board with (security_invoker = true) as
select j.id, j.farm_id, j.code, j.status, j.workflow_version_id, j.version, j.planned_date, j.grade_target, j.customer_spec_ref,
       j.attribution_method, j.notes, j.line_start_inspection_id, j.completed_at, j.created_at,
       greatest(j.created_at, (select max(t.server_received_at) from public.record_transitions t
                                where t.entity_type = 'ph_job_cards' and t.entity_id = j.id)) as stage_since,
       j.line_id, ln.code as line_code, ln.name_ar as line_name_ar, ln.name_en as line_name_en, ln.kind as line_kind,
       j.crop_id, c.code as crop_code, c.name_ar as crop_name_ar, c.name_en as crop_name_en, c.washer_route,
       cb.full_name as created_by_name, ab.full_name as approved_by_name, rb.full_name as ready_by_name,
       sb.full_name as started_by_name, kb.full_name as completed_by_name,
       (select count(*) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null) as inputs_count,
       (select count(*) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null and i.closed_at is null) as open_inputs,
       (select coalesce(sum(i.issued_kg), 0) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null) as issued_kg,
       (select coalesce(sum(i.consumed_kg), 0) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null) as consumed_kg,
       (select coalesce(sum(i.returned_kg), 0) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null) as returned_kg,
       (select count(*) from public.ph_jc_packaging k where k.job_card_id = j.id and k.voided_at is null) as packaging_count,
       ls.code as line_start_code, ls.result as line_start_result, lsb.full_name as line_start_by_name, ls.event_at as line_start_at,
       (select i.result from public.ph_inspections i where i.job_card_id = j.id and i.inspection_type = 'line_start' and i.voided_at is null
         order by i.event_at desc, i.code desc limit 1) as last_line_start_result,
       q.code as qc2_code, q.qc2_stage, q.result as qc2_result, q.event_at as qc2_at, qb.full_name as qc2_by_name, q.tolerance_basis as qc2_tolerance_basis,
       (select count(*) from public.ph_fg_pallets f where f.job_card_id = j.id and f.voided_at is null) as fg_count,
       (select coalesce(sum(f.net_kg), 0) from public.ph_fg_pallets f where f.job_card_id = j.id and f.voided_at is null) as fg_kg,
       j.decision_basis
  from public.ph_job_cards j
  join public.ph_lines ln on ln.id = j.line_id
  join public.ph_crops c on c.id = j.crop_id
  left join public.user_profiles cb on cb.id = j.created_by
  left join public.user_profiles ab on ab.id = j.approved_by
  left join public.user_profiles rb on rb.id = j.ready_by
  left join public.user_profiles sb on sb.id = j.started_by
  left join public.user_profiles kb on kb.id = j.completed_by
  left join public.ph_inspections ls on ls.id = j.line_start_inspection_id
  left join public.user_profiles lsb on lsb.id = ls.created_by
  left join lateral (select * from public.ph_inspections i where i.job_card_id = j.id and i.inspection_type = 'qc2' and i.voided_at is null
                      order by i.event_at desc, i.code desc limit 1) q on true
  left join public.user_profiles qb on qb.id = q.created_by
 where j.voided_at is null;
comment on view public.ph_jc_board is 'One row per Job Card: line, crop, people at each step, inputs (kg), packaging, G5 and latest QC-2, finished output.';

create view public.ph_jc_input_list with (security_invoker = true) as
select i.id, i.farm_id, i.job_card_id, i.pallet_id, p.code as pallet_code, p.status as pallet_status, l.code as lot_code,
       s.code as source_code, p.harvest_at, i.issued_kg, i.consumed_kg, i.returned_kg, i.closed_at, i.created_at, u.full_name as issued_by_name
  from public.ph_jc_inputs i
  join public.ph_incoming_pallets p on p.id = i.pallet_id
  join public.ph_sources s on s.id = p.source_id
  left join public.ph_lots l on l.id = p.lot_id
  left join public.user_profiles u on u.id = i.created_by
 where i.voided_at is null;

create view public.ph_jc_inspection_list with (security_invoker = true) as
select i.id, i.farm_id, i.job_card_id, i.code, i.inspection_type, i.qc2_stage, i.result, i.reason, i.sample_note, i.remarks, i.checklist,
       i.tolerance_basis, i.event_at, u.full_name as by_name, t.source as template_source, t.evidence as template_evidence, t.crop_code as template_crop
  from public.ph_inspections i
  left join public.user_profiles u on u.id = i.created_by
  left join public.ph_inspection_templates t on t.id = i.template_id
 where i.voided_at is null and i.job_card_id is not null;

create view public.ph_jc_packaging_list with (security_invoker = true) as
select k.id, k.farm_id, k.job_card_id, k.description, k.quantity, un.code as unit_code, k.created_at, u.full_name as issued_by_name
  from public.ph_jc_packaging k join public.units un on un.id = k.unit_id left join public.user_profiles u on u.id = k.created_by
 where k.voided_at is null;

create view public.ph_fg_board with (security_invoker = true) as
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
       f.decision_basis
  from public.ph_fg_pallets f
  join public.ph_job_cards j on j.id = f.job_card_id
  join public.ph_lines ln on ln.id = j.line_id
  join public.ph_crops c on c.id = f.crop_id
  left join public.ph_equipment eq on eq.id = f.scale_id
  left join public.ph_inspections q on q.id = f.qc2_inspection_id
  left join public.user_profiles qb on qb.id = q.created_by
  left join public.user_profiles ab on ab.id = f.qc_approved_by
  left join public.user_profiles cb on cb.id = f.created_by
  left join public.ph_locations loc on loc.id = f.location_id
 where f.voided_at is null;
comment on view public.ph_fg_board is 'One row per finished-goods pallet: Job Card, grade, weight, QC-2 and QC stamp (24 h validity), location, composition by lot.';

-- Incoming pallets: kg issued to production and still available (partial issue).
create or replace view public.ph_ip_board with (security_invoker = true) as
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
       (p.status not in ('returned_to_source', 'waste', 'void', 'consumed', 'arrival_rejected', 'issued')
        and extract(epoch from (now() - p.received_at)) / 3600 > coalesce(app.ph_param(p.farm_id, 'grading_limit_hours'), 1e9)) as grading_overdue,
       p.decision_basis,
       (select count(*) from public.ph_attachments x
         where x.voided_at is null and ((x.entity_type = 'ph_incoming_pallets' and x.entity_id = p.id)
                                      or (x.entity_type = 'ph_inspections' and x.entity_id in (p.arrival_check_id, p.rma_id, p.recheck_id, p.qc1_id)))) as attachment_count,
       app.ph_ip_available_kg(p.id) as available_kg,
       (select coalesce(sum(i.issued_kg), 0) from public.ph_jc_inputs i where i.pallet_id = p.id and i.closed_at is null and i.voided_at is null) as issued_open_kg,
       (select coalesce(sum(i.consumed_kg), 0) from public.ph_jc_inputs i where i.pallet_id = p.id and i.closed_at is not null and i.voided_at is null) as consumed_kg,
       (select string_agg(distinct j.code, ', ') from public.ph_jc_inputs i join public.ph_job_cards j on j.id = i.job_card_id
         where i.pallet_id = p.id and i.voided_at is null) as job_card_codes
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

create or replace view public.ph_location_occupancy with (security_invoker = true) as
select l.id, l.farm_id, l.code, l.name_ar, l.name_en, l.purpose, l.capacity_pallets, l.storage_group_id, g.code as storage_group_code,
       g.name_ar as storage_group_name_ar, g.name_en as storage_group_name_en, l.verification_status, l.sort_order,
       (select count(*) from public.ph_incoming_pallets p where p.location_id = l.id and p.voided_at is null
          and p.status in ('pre_cooling', 'stored', 'released', 'on_hold'))
       + (select count(*) from public.ph_fg_pallets f where f.location_id = l.id and f.voided_at is null
          and f.status not in ('dispatched', 'reworked', 'waste', 'split_merged')) as occupancy
  from public.ph_locations l left join public.ph_storage_groups g on g.id = l.storage_group_id
 where l.voided_at is null;

create or replace view public.ph_stock_move_log with (security_invoker = true) as
select m.id, m.farm_id, m.pallet_id, m.moved_at, lf.code as from_code, lt.code as to_code, u.full_name as by_name,
       m.reason, m.group_override_reason, m.over_capacity, m.permission_basis, m.fg_pallet_id
  from public.ph_stock_moves m
  left join public.ph_locations lf on lf.id = m.from_location_id
  left join public.ph_locations lt on lt.id = m.to_location_id
  left join public.user_profiles u on u.id = m.created_by
 where m.voided_at is null;

-- Stage counts: incoming pallets by stage (production now shows Job Cards), Job Cards, QC-2 queue and finished goods.
create or replace function public.ph_stage_counts() returns table (stage text, total bigint, attention bigint)
language sql stable security invoker set search_path = public, app, pg_temp
as $$
  select 'arrivals', count(*), count(*) filter (where status = 'vehicle_hold' or late_flag)
    from public.ph_arrival_board where status in ('draft', 'vehicle_hold', 'submitted')
  union all
  select b.stage, count(*), count(*) filter (where b.dwell_exceeded or b.grading_overdue or b.calibration_flag
                                                    or b.status in ('qa_rejected', 'on_hold', 'arrival_rejected'))
    from public.ph_ip_board b where b.stage <> 'production' group by b.stage
  union all
  select 'production', count(*), count(*) filter (where status in ('line_check_failed', 'paused') or (status = 'in_progress' and qc2_result = 'fail'))
    from public.ph_jc_board where status in ('draft', 'planned', 'ready', 'line_check_failed', 'in_progress', 'paused', 'completed')
  union all
  select 'qc2', count(*), count(*) filter (where qc2_result = 'fail')
    from public.ph_jc_board where status = 'in_progress'
  union all
  select 'fg_pallets', count(*), count(*) filter (where label_print_count = 0)
    from public.ph_fg_board where status in ('created', 'qc_approved')
  union all
  select 'fg_storage', count(*), count(*) filter (where qc_valid_until < now())
    from public.ph_fg_board where status = 'in_storage'
$$;

create or replace view public.ph_exception_items with (security_invoker = true) as
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
  from public.ph_arrival_board where late_flag and app.ph_local_date(arrived_at) = app.ph_local_date()
union all
select 'E-09', 'ph_job_cards', id, code, farm_id, stage_since, 'high', jsonb_build_object('line', line_code)
  from public.ph_jc_board where status = 'line_check_failed'
union all
select 'E-10', 'ph_job_cards', id, code, farm_id, qc2_at, 'high', jsonb_build_object('stage', qc2_stage)
  from public.ph_jc_board where status in ('in_progress', 'paused') and qc2_result = 'fail'
union all
select 'OD-06', 'ph_inspections', i.id, i.code, i.farm_id, i.event_at, 'low', jsonb_build_object('type', i.inspection_type)
  from public.ph_inspections i where i.voided_at is null and i.inspection_type = 'qc2' and i.result = 'pass' and i.tolerance_basis = 'no_tolerance_set'
    and i.event_at > now() - interval '7 days';

-- ---------------------------------------------------------------------------------------------
-- Actions available to the signed-in user, with the reason when not (Job Card and finished pallet record views)
-- ---------------------------------------------------------------------------------------------
create function public.ph_job_card_actions(p_jc uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_job_cards;
  li      public.ph_inspections;
  q       public.ph_inspections;
  v_uid   uuid := app.current_user_id();
  v_out   jsonb := '[]';
  c       record;
  v_why   jsonb;
  v_mine  text[];
  v_their text[];
  v_has_inputs boolean;
begin
  r := app.ph_job_card(p_jc::text);
  select * into li from public.ph_inspections where id = r.line_start_inspection_id;
  q := app.ph_jc_qc2_latest(r.id);
  v_has_inputs := exists (select 1 from public.ph_jc_inputs where job_card_id = r.id and voided_at is null);
  for c in
    select * from (values
      ('approve', 'job_card.approve', r.status = 'draft'),
      ('cancel', 'job_card.approve', r.status in ('draft', 'planned')),
      ('issue_input', 'job_card.record_inputs', r.status in ('planned', 'ready', 'in_progress')),
      ('issue_packaging', 'packaging.issue', r.status in ('planned', 'ready', 'in_progress', 'paused')),
      ('mark_ready', 'job_card.execute', r.status = 'planned'),
      ('line_start_check', 'line_start.submit', r.status = 'ready' and r.line_start_inspection_id is null),
      ('confirm_start', 'line_start.submit', r.status = 'ready' and r.line_start_inspection_id is not null),
      ('line_corrected', 'job_card.execute', r.status = 'line_check_failed'),
      ('pause', 'job_card.execute', r.status = 'in_progress'),
      ('resume', 'job_card.execute', r.status = 'paused'),
      ('qc2', 'qc2.submit', r.status = 'in_progress'),
      ('create_fg', 'fg_pallet.create', r.status = 'in_progress'),
      ('complete', 'job_card.execute', r.status = 'in_progress'),
      ('reconcile', 'job_card.close', r.status = 'completed')
    ) as x(action, ph_action, applicable)
  loop
    continue when not c.applicable;
    v_why := app.ph_denial(v_uid, r.farm_id, c.ph_action);
    if c.action = 'reconcile' then
      v_why := jsonb_build_object('key', 'ph.later', 'milestone', 'M2.2');
    end if;
    if v_why is null and c.action = 'cancel' and v_has_inputs then
      v_why := jsonb_build_object('key', 'ph.jc.cancelInputs');
    end if;
    if v_why is null and c.action = 'mark_ready' then
      if not exists (select 1 from public.ph_jc_inputs where job_card_id = r.id and closed_at is null and voided_at is null) then
        v_why := jsonb_build_object('key', 'ph.jc.needInputs');
      elsif not exists (select 1 from public.ph_jc_packaging where job_card_id = r.id and voided_at is null) then
        v_why := jsonb_build_object('key', 'ph.jc.needPackaging');
      end if;
    end if;
    if v_why is null and c.action = 'confirm_start' then
      if li.created_by = v_uid then
        v_why := jsonb_build_object('key', 'ph.sod', 'column', 'line_start_recorder');
      else
        v_mine := app.ph_user_spec_roles(v_uid, r.farm_id);
        v_their := app.ph_user_spec_roles(li.created_by, r.farm_id);
        if not (('QCI' = any (v_their) and 'LL' = any (v_mine)) or ('LL' = any (v_their) and 'QCI' = any (v_mine))) then
          v_why := jsonb_build_object('key', 'ph.g5.pair');
        end if;
      end if;
    end if;
    if v_why is null and c.action = 'create_fg' and (q.id is null or q.result <> 'pass' or q.qc2_stage <> 'final') then
      v_why := jsonb_build_object('key', 'ph.g6.notPassed', 'job_card', r.code);
    end if;
    v_out := v_out || jsonb_build_object('action', c.action, 'ph_action', c.ph_action, 'allowed', v_why is null, 'reason', v_why,
                                         'basis', app.ph_permission_basis(v_uid, r.farm_id, c.ph_action));
  end loop;
  return v_out;
end;
$$;

create function public.ph_fg_pallet_actions(p_fg uuid) returns jsonb
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
      ('move', 'stock_move.execute', f.status in ('qc_approved', 'in_storage'))
    ) as x(action, ph_action, applicable)
  loop
    continue when not c.applicable;
    v_why := app.ph_denial(v_uid, f.farm_id, c.ph_action);
    if v_why is null and c.action = 'print_label' and jsonb_array_length(v_miss) > 0 then
      v_why := jsonb_build_object('key', 'ph.v09', 'missing', v_miss);
    end if;
    v_out := v_out || jsonb_build_object('action', c.action, 'ph_action', c.ph_action, 'allowed', v_why is null, 'reason', v_why,
                                         'basis', app.ph_permission_basis(v_uid, f.farm_id, c.ph_action));
  end loop;
  return v_out;
end;
$$;

-- Incoming-pallet actions: issuing to production is now built (from the Job Card).
create or replace function public.ph_pallet_actions(p_pallet uuid) returns jsonb
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
      ('issue_to_job_card', 'job_card.record_inputs', null, r.status in ('released', 'issued') and app.ph_ip_available_kg(r.id) > 0, null)
    ) as x(action, ph_action, gate, applicable, sod)
  loop
    continue when not c.applicable;
    v_why := app.ph_denial(v_uid, r.farm_id, c.ph_action);
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

-- ---------------------------------------------------------------------------------------------
-- Trace (TQ-01 backward / TQ-02 forward, M2.1 scope): incoming pallets, arrivals and lots ↔ Job Cards ↔ finished pallets.
-- ---------------------------------------------------------------------------------------------
create or replace function public.ph_backward_trace(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_ids uuid[];
  v_fg  uuid[];
  v_jc  uuid[];
begin
  -- A finished pallet or Job Card resolves to the incoming pallets it used.
  select array_agg(f.id) into v_fg from public.ph_fg_pallets f
   where app.ph_is_member(f.farm_id) and f.voided_at is null and upper(f.code) = upper(trim(p_ref));
  select array_agg(j.id) into v_jc from public.ph_job_cards j
   where app.ph_is_member(j.farm_id) and j.voided_at is null
     and (upper(j.code) = upper(trim(p_ref)) or j.id in (select job_card_id from public.ph_fg_pallets where id = any (coalesce(v_fg, '{}'))));
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
  -- Forward: every Job Card and finished pallet these incoming pallets went into.
  if v_fg is null then
    select array_agg(distinct i.job_card_id) into v_jc from public.ph_jc_inputs i where i.pallet_id = any (v_ids) and i.voided_at is null;
    select array_agg(distinct x.fg_pallet_id) into v_fg from public.ph_fg_pallet_lots x where x.pallet_id = any (v_ids);
  end if;
  return jsonb_build_object(
    'query', p_ref,
    'scope', 'Backward to arrival and source, forward to Job Cards and finished pallets (M2.1); loads and customers arrive with dispatch (M3)',
    'pallets', (select jsonb_agg(to_jsonb(b) - 'farm_id' order by b.code) from public.ph_ip_board b where b.id = any (v_ids)),
    'job_cards', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'code', j.code, 'status', j.status, 'line', j.line_code,
                                                                'issued_kg', j.issued_kg, 'consumed_kg', j.consumed_kg, 'fg_kg', j.fg_kg) order by j.code), '[]')
                    from public.ph_jc_board j where j.id = any (coalesce(v_jc, '{}'))),
    'fg_pallets', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'code', f.code, 'status', f.status, 'grade', f.grade, 'net_kg', f.net_kg,
                                                                 'job_card', f.job_card_code, 'lots', f.lot_codes, 'location', f.location_code,
                                                                 'composition', f.composition) order by f.code), '[]')
                     from public.ph_fg_board f where f.id = any (coalesce(v_fg, '{}'))),
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

select app.seed_ph_production(id) from public.farms;
select app.apply_api_grants();
