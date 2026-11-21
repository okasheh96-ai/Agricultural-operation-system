-- Packhouse operations, increment 6: grading specification (S-07), AWETA preventive maintenance and cleaning (S-08, S-09),
-- accountability policy (S-04 p.4 / S-06 p.2), spreadsheet import with an exception queue.
-- Every value below comes from the owner-supplied documents (supabase/seed/reference/*.json, page references inside).
-- None of them is approved in its source: the specification waits for QA approval (OD-43), the schedules generate no work
-- until approved (OD-44), and the accountability policy is a draft that is not in force until the Owner decides its scope
-- (OD-42, conflict C-02).

set check_function_bodies = off;

-- =============================================================================================
-- 1. Grading specification
-- =============================================================================================
create table public.ph_specs (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  version_no    integer not null default 1,
  title         text not null,
  state         text not null check (state in ('awaiting_approval', 'approved', 'superseded')),
  source_ref    text not null,
  data          jsonb not null,
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz,
  approval_note text
);
comment on table public.ph_specs is 'Grading specifications as supplied (S-07), versioned; QA approves (OD-43). Until approved, checks are labelled "awaiting approval".';
select app.register_table('public.ph_specs', 'ph_config', false, p_default_policies => false);
create unique index ph_specs_uq on public.ph_specs (farm_id, code, version_no) where voided_at is null;

create table public.ph_spec_rules (
  id            uuid primary key default gen_random_uuid(),
  spec_id       uuid not null references public.ph_specs(id),
  product_code  text not null,
  grade         text not null check (grade in ('premium', 'gr1', 'gr2')),
  criterion     text not null check (criterion in ('colour_stage', 'colour_coverage', 'diameter', 'length', 'weight')),
  customer      text,
  band          integer not null default 1,
  min_value     numeric,
  max_value     numeric,
  min_exclusive boolean not null default false,
  unit          text not null,
  text_value    text,
  note          text,
  page          integer not null,
  inactive      boolean not null default false
);
comment on table public.ph_spec_rules is 'Size and colour bands per product and grade (a customer row overrides the standard row for that criterion).';
select app.register_table('public.ph_spec_rules', 'ph_config', false, p_default_policies => false);

create table public.ph_spec_tolerances (
  id           uuid primary key default gen_random_uuid(),
  spec_id      uuid not null references public.ph_specs(id),
  product_code text not null,
  grade        text not null check (grade in ('premium', 'gr1', 'gr2')),
  category     text not null check (category in ('colour', 'minor', 'major', 'unacceptable')),
  max_pct      numeric not null,
  page         integer not null
);
comment on table public.ph_spec_tolerances is 'Maximum % of units per defect category per consignment.';
select app.register_table('public.ph_spec_tolerances', 'ph_config', false, p_default_policies => false);

-- =============================================================================================
-- 2. Preventive maintenance and cleaning
-- =============================================================================================
create table public.ph_pm_plans (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  kind             text not null check (kind in ('maintenance', 'cleaning')),
  machine_label    text not null,
  title_en         text not null,
  title_ar         text not null,
  role_code        text not null,
  state            text not null check (state in ('pending_approval', 'approved', 'retired')),
  data             jsonb not null,
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  approval_note    text,
  ups_installed_on date
);
comment on table public.ph_pm_plans is 'Maintenance / cleaning plans as supplied (S-08, S-09). No work is generated until approved (OD-44).';
select app.register_table('public.ph_pm_plans', 'ph_config', false, p_default_policies => false);
create unique index ph_pm_plans_uq on public.ph_pm_plans (farm_id, code) where voided_at is null;

create table public.ph_pm_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.ph_pm_plans(id),
  code            text not null,
  trigger_kind    text not null check (trigger_kind in ('daily_before_start', 'before_start_and_8h', 'daily', 'daily_end', 'hours_or_calendar', 'hours', 'pre_season', 'age_months')),
  interval_hours  numeric,
  interval_days   integer,
  interval_months integer,
  title_en        text not null,
  title_ar        text not null,
  do_en           text not null,
  do_ar           text not null,
  sort_order      integer not null default 0
);
comment on table public.ph_pm_items is 'One scheduled check of a plan: when it is due (hours, calendar or daily) and what to do.';
select app.register_table('public.ph_pm_items', 'ph_config', false, p_default_policies => false);

create table public.ph_pm_meter (
  id            uuid primary key default gen_random_uuid(),
  machine_label text not null,
  hours         numeric not null check (hours >= 0),
  read_at       timestamptz not null default now(),
  note          text
);
comment on table public.ph_pm_meter is 'Machine running-hours readings (hour-based intervals are measured against these).';
select app.register_table('public.ph_pm_meter', 'ph_ops', false, p_default_policies => false);

create table public.ph_pm_done (
  id       uuid primary key default gen_random_uuid(),
  item_id  uuid not null references public.ph_pm_items(id),
  task_id  uuid references public.ph_tasks(id),
  done_at  timestamptz not null default now(),
  hours_at numeric,
  note     text
);
comment on table public.ph_pm_done is 'Completed scheduled checks (from the task board), with the running hours at completion.';
select app.register_table('public.ph_pm_done', 'ph_ops', false, p_default_policies => false);

alter table public.ph_tasks add column pm_item_id uuid references public.ph_pm_items(id);

-- =============================================================================================
-- 3. Accountability (draft policy) and spreadsheet import
-- =============================================================================================
create table public.ph_acc_policy (
  id            uuid primary key default gen_random_uuid(),
  version_no    integer not null,
  state         text not null check (state in ('draft_inactive', 'active', 'retired')),
  scope_roles   text[] not null,
  warnings_before_hr integer not null,
  text_en       text not null,
  text_ar       text not null,
  source_ref    text not null,
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  decision_note text
);
comment on table public.ph_acc_policy is 'Accountability process (S-04 p.4 / S-06 p.2). Draft and inactive until the Owner decides the scope (OD-42, C-02).';
select app.register_table('public.ph_acc_policy', 'ph_people', false, p_default_policies => false);

create table public.ph_acc_violations (
  id             uuid primary key default gen_random_uuid(),
  policy_id      uuid not null references public.ph_acc_policy(id),
  person_id      uuid not null references public.user_profiles(id),
  occurred_on    date not null,
  description    text not null check (length(trim(description)) > 0),
  sequence_no    integer not null,
  outcome        text not null check (outcome in ('verbal_warning', 'hr_referred')),
  hr_decision    text,
  hr_decided_by  uuid references auth.users(id),
  hr_decided_at  timestamptz
);
comment on table public.ph_acc_violations is 'Violations under an active accountability policy: the first N are internal verbal warnings, each later one is referred to HR, who decides. Restricted.';
select app.register_table('public.ph_acc_violations', 'ph_people', false, p_default_policies => false);

create table public.ph_import_batches (
  id           uuid primary key default gen_random_uuid(),
  target_table text not null,
  file_name    text,
  rows_total   integer not null,
  rows_saved   integer not null,
  rows_skipped integer not null,
  rows_failed  integer not null
);
comment on table public.ph_import_batches is 'Spreadsheet imports: one row per uploaded file.';
select app.register_table('public.ph_import_batches', 'ph_config', false, p_default_policies => false);

create table public.ph_import_exceptions (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.ph_import_batches(id),
  row_no      integer not null,
  data        jsonb not null,
  error       text not null,
  resolved_at timestamptz,
  resolution  text
);
comment on table public.ph_import_exceptions is 'Rows an import could not save, kept for review: fix and retry, or dismiss with a reason.';
select app.register_table('public.ph_import_exceptions', 'ph_config', false, p_default_policies => false);

do $$
declare t text;
begin
  foreach t in array array['ph_specs', 'ph_spec_rules', 'ph_spec_tolerances', 'ph_pm_plans', 'ph_pm_items', 'ph_pm_meter', 'ph_pm_done', 'ph_import_batches', 'ph_import_exceptions', 'ph_acc_policy'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.ph_is_member(farm_id))', t || '_select', t);
  end loop;
end $$;
-- Violations: only people who hold the view authority (managers, the Owner, whoever the Owner names for HR decisions).
create policy ph_acc_violations_select on public.ph_acc_violations for select to authenticated
  using (app.ph_is_member(farm_id) and (app.ph_can(farm_id, 'acc.view') or app.ph_can(farm_id, 'acc.hr_decide')));

-- =============================================================================================
-- 4. Actions, cells and the documents as data
-- =============================================================================================
create function app.seed_po_increment6(p_farm uuid) returns void
language plpgsql as $fn$
declare
  s7   jsonb := $json${"spec": "S-07", "title": "Produce Grading — Standards & Specifications (Master SOP for Quality Inspectors)", "dated": "October 2026", "approval": "none stated (no revision, approver, signature or effective date) — imported awaiting QA approval (OD-43)", "grades": {"premium_g1": "Premium / Grade 1 (G1)", "g2": "Grade 2 (G2)"}, "customers": ["Tesco", "Thanet Earth", "LSS", "Abay", "DBS", "Export", "DC"], "override_note": "Any override of the maximum defect tolerance per consignment will be communicated between Commercial and Packing House management (p.3, pp.7–19) — OD-47.", "procedure": [{"step": 1, "en": "Check packaging: food-grade, clean, intact and carefully stacked; labels present", "page": 4}, {"step": 2, "en": "Assess appearance: colour, gloss, skin, stem/calyx and shape against the product description", "page": 4}, {"step": 3, "en": "Cut & taste: internal flesh and seeds; sensory check for flavour, texture and aroma", "page": 4}, {"step": 4, "en": "Measure size: diameter, length or weight against the grade and customer ranges", "page": 4}, {"step": 5, "en": "Sort defects: classify each defective unit as Minor, Major or Unacceptable", "page": 4}, {"step": 6, "en": "Grade or reject: compare defect % with grade tolerances", "page": 4}], "rule": "A lot meets a grade only if each defect category is within that grade's maximum tolerance. Any unacceptable defect above the limit means rejection. Exception: for Tomato and Cherry Tomato, live insects are evaluated internally and are not an automatic rejection (p.4, C-05).", "common": {"packaging": ["As per order requirement", "Food-grade material, delivered clean and intact", "Carefully stacked so product beneath is not damaged", "Peppers: 5 kg carton with lid recommended"], "chemicals": ["Pre- and post-harvest chemicals must be registered and approved for use in Jordan", "Residues: Jordan and Codex standards (tomatoes, peppers)", "Residues: Global GAP standards (eggplant, mini cucumber)"], "food_safety": ["All products may be eaten raw without peeling", "Product may therefore be periodically tested for bacteria", "Cherry tomato is also tested for chemical residue"], "page": 5}, "tomato_scale": {"page": 6, "en": "Stage 1 = fully green → stage 6 = fully red-ripe; accepted stage 3–5; stage 6 accepted with conditions"}, "inspector_checklist": {"page": 21, "items": ["Draw a representative sample from every consignment", "Check packaging first: dirty, collapsed or unsuitable packaging is an unacceptable defect", "Grade colour / maturity and size (or weight) into Premium / G1 or G2", "Confirm the product meets its quality description: appearance, internal, sensory, shape", "Record each defect as Minor, Major or Unacceptable and calculate % per category", "Accept the grade only if every defect category is within tolerance", "When packing for Tesco, Thanet Earth, LSS, Abay, DBS, Export or DC, apply that customer's limits"]}, "products": [{"code": "regular_tomato", "name_en": "Tomato", "pages": [7, 8], "summary": "Round shape, colour maturity stage 3–5 (G2 up to stage 6)", "attributes": {"Description": "Glossy red; graded evenly for colour within each package", "Internal": "Yellow/green seeds in a clear reddish gel", "Sensory": "Predominantly sweet; may be slightly acidic", "Shape": "Uniformly round to round–slightly squat; not ridged or deformed", "Maturity": "Firm texture, juicy flesh; not excessively soft, wrinkly or bladdery (over-mature)"}, "rules": [{"grade": "premium_g1", "criterion": "colour_stage", "min": 3, "max": 5, "unit": "stage", "page": 7, "note": "Stage 6 only when packed for the DC and there is no softness"}, {"grade": "premium_g1", "criterion": "colour_stage", "min": 3, "max": 6, "unit": "stage", "customer": "DC", "page": 7, "note": "DC: stage 3–6 (stage 6 only with no softness) — p.7"}, {"grade": "g2", "criterion": "colour_stage", "min": 3, "max": 6, "unit": "stage", "page": 7, "note": "Stage 6 accepted for every destination, soft or not"}, {"grade": "premium_g1", "criterion": "diameter", "min": 6, "max": 10, "unit": "cm", "page": 7}, {"grade": "g2", "criterion": "diameter", "min": 3, "max": 6, "unit": "cm", "page": 7, "band": 1}, {"grade": "g2", "criterion": "diameter", "min": 10, "max": 15, "unit": "cm", "page": 7, "band": 2}, {"grade": "any", "criterion": "weight", "min": 60, "max": 100, "unit": "g", "customer": "LSS", "page": 7, "note": "LSS Mixed (band 1)", "band": 1}, {"grade": "any", "criterion": "weight", "min": 150, "max": 300, "unit": "g", "customer": "LSS", "page": 7, "note": "LSS Mixed (band 2)", "band": 2}, {"grade": "any", "criterion": "weight", "min": 100, "max": 150, "unit": "g", "customer": "LSS", "page": 7, "note": "LSS Medium"}, {"grade": "any", "criterion": "weight", "min": 100, "max": 250, "unit": "g", "customer": "Export", "page": 7}], "tolerances": {"premium": {"colour": 3}, "premium_g1": {"colour": 10, "minor": 5, "major": 0, "unacceptable": 0}, "g2": {"colour": 20, "minor": 25, "major": 3, "unacceptable": 2}, "page": 8}, "defects": {"colour": ["Premium / G1: outside stage 3–5 (stage 6 allowed for DC if not soft)", "G2: outside stage 3–6"], "minor": ["Incorrect size, shape, colour or maturity that detracts from appearance", "Over 10% of surface with abnormal colour, healed injury, scar or blemish", "Cracking wider than 3 mm or longer than 2 cm"], "major": ["Injury breaking the skin; excessive softness; shrivel; abnormal texture or internal tissue; soiling over 30%", "Physiological disorders: puffiness, internal white tissue, sunscald, blotchy ripening, gold flecking, catface", "Rot or mould on stalk or calyx; pests, internal rot; musty flavours or aromas"], "unacceptable": ["Rot or mould growth on the body of the fruit", "Evidence of live insects (will be evaluated internally)", "Evidence of non-organic foreign bodies", "Foreign, chemical or musty deposits, powders, flavours or aromas", "Dirty, collapsed or unsuitable packaging"]}, "flags": ["C-05: live insects evaluated internally, not automatic rejection", "C-04/OD-45: band limits touch (e.g. 6 cm, 10 cm)"]}, {"code": "cherry_tomato", "name_en": "Cherry Tomato (Balahi)", "pages": [9, 10], "summary": "Round, oval or plum-shaped; colour maturity stage 3–6", "attributes": {"Description": "Glossy red; graded evenly for colour within each package", "Internal": "Yellow/green seeds in a clear reddish gel", "Sensory": "Predominantly sweet; may be slightly acidic", "Shape": "Round, oval or plum-shaped; not pointed, ridged or otherwise deformed", "Maturity": "Firm texture, juicy flesh; not soft, wrinkly or bladdery (over-mature)", "Food safety": "Periodically tested for bacteria and chemical residue"}, "rules": [{"grade": "premium_g1", "criterion": "colour_stage", "min": 3, "max": 6, "unit": "stage", "page": 9, "note": "Stage 6 only with no softness; stage 6 not allowed for long-distance shipping (OD-48)"}, {"grade": "g2", "criterion": "colour_stage", "min": 3, "max": 6, "unit": "stage", "page": 9, "note": "Stage 6 only with no softness; stage 6 not allowed for long-distance shipping (OD-48)"}, {"grade": "premium_g1", "criterion": "diameter", "min": 2, "max": 2.5, "unit": "cm", "page": 9}, {"grade": "premium_g1", "criterion": "length", "min": 2.5, "max": 5, "unit": "cm", "page": 9}, {"grade": "g2", "criterion": "diameter", "text": "Not specified", "unit": "cm", "page": 9}, {"grade": "g2", "criterion": "length", "min": 5, "max_exclusive": true, "unit": "cm", "page": 9, "note": "More than 5 cm", "band": 1, "min_exclusive": true}, {"grade": "g2", "criterion": "length", "min": 1.5, "max": 2.5, "unit": "cm", "page": 9, "band": 2}], "tolerances": {"premium": {"colour": 3}, "premium_g1": {"colour": 10, "minor": 5, "major": 0, "unacceptable": 0}, "g2": {"colour": 20, "minor": 25, "major": 3, "unacceptable": 1}, "page": 10}, "defects": {"colour": ["Outside colour stage 3–6, or stage 6 with softness"], "minor": ["Over 10% of surface with dry or healed scar or blemish", "Cracking wider than 1 mm or longer than 1 cm", "Incorrect size, shape, colour or maturity that detracts from appearance"], "major": ["Injury breaking the skin; softness from over-maturity; shrivel; soiling over 10%", "Physiological disorders: puffiness, internal white tissue, sunscald, blotchy ripening, gold flecking, catface", "Dehydration, rot or mould on the stalk or calyx"], "unacceptable": ["Rot or mould growth on the body of the fruit", "Evidence of live insects (will be evaluated internally)", "Evidence of non-organic foreign bodies", "Foreign, chemical or musty deposits, powders, flavours or aromas", "Dirty, collapsed or unsuitable packaging"]}, "flags": ["C-05: live insects evaluated internally", "OD-48: long-distance shipping not defined", "G2 unacceptable tolerance is 1% (p.10, p.20)"]}, {"code": "blocky", "name_en": "Colour Pepper (Blocky)", "pages": [11, 12], "summary": "Blocky bell shape; red, yellow or orange", "attributes": {"Description": "Smooth, glossy red, yellow or orange skin; intact calyx and neatly trimmed stem", "Internal": "Clean, open seed cavity", "Sensory": "Peppery, sweet flavour", "Shape": "Typical bell / blocky shape", "Maturity": "Firm, glossy, crisp and juicy flesh; faint green background tinge acceptable", "Packaging": "5 kg carton"}, "rules": [{"grade": "premium_g1", "criterion": "colour_coverage", "min": 70, "max": 100, "unit": "%", "page": 11}, {"grade": "g2", "criterion": "colour_coverage", "min": 50, "max": 70, "unit": "%", "page": 11}, {"grade": "premium_g1", "criterion": "diameter", "min": 7, "max": 11, "unit": "cm", "page": 11}, {"grade": "premium_g1", "criterion": "length", "min": 7, "max": 13, "unit": "cm", "page": 11}, {"grade": "g2", "criterion": "diameter", "min": 5, "unit": "cm", "page": 11, "note": "Min 5 cm"}, {"grade": "g2", "criterion": "length", "min": 5, "unit": "cm", "page": 11, "note": "Min 5 cm"}], "tolerances": {"premium_g1": {"minor": 5, "major": 0, "unacceptable": 0}, "g2": {"minor": 25, "major": 3, "unacceptable": 2}, "page": 12}, "defects": {"minor": ["Over 10% of surface with dry or healed scar or blemish not breaking the skin", "Incorrect size, shape, colour or maturity that detracts from appearance"], "major": ["Fresh or wet injury, cut, puncture or damage breaking the skin", "Softness from over-maturity; shrivelled or wrinkled skin", "Soiling over 30% of surface; rot or mould on the stalk"], "unacceptable": ["Rot or mould growth on the body of the fruit", "Evidence of live insects", "Evidence of non-organic foreign bodies", "Foreign, chemical or musty deposits, powders, flavours or aromas", "Dirty, collapsed or unsuitable packaging"]}, "flags": ["C-04/OD-45: colour 70% is both G1 and G2 limit"]}, {"code": "sweetbite", "name_en": "Sweet Bite Mini Pepper", "pages": [13, 14], "summary": "Small cone-shaped snack pepper; red, yellow or orange", "attributes": {"Description": "Smooth, glossy red, yellow or orange skin; intact calyx and neatly trimmed stem", "Internal": "Clean, open seed cavity", "Sensory": "Peppery, sweet flavour", "Shape": "Typical cone shape", "Maturity": "Firm, glossy, crisp and juicy flesh; faint green background tinge acceptable", "Packaging": "5 kg carton"}, "rules": [{"grade": "premium_g1", "criterion": "colour_coverage", "min": 70, "max": 100, "unit": "%", "page": 13}, {"grade": "g2", "criterion": "colour_coverage", "min": 50, "max": 70, "unit": "%", "page": 13}, {"grade": "any", "criterion": "weight", "min": 25, "max": 45, "unit": "g", "customer": "Thanet Earth", "page": 13}, {"grade": "any", "criterion": "weight", "min": 25, "max": 45, "unit": "g", "customer": "Tesco", "page": 13}, {"grade": "any", "criterion": "colour_coverage", "min": 90, "max": 100, "unit": "%", "customer": "DBS", "page": 13}, {"grade": "premium_g1", "criterion": "weight", "min": 19, "max": 45, "unit": "g", "page": 13, "inactive": true, "note": "19–45 g will be added as G1 upon customer approval (R-GR-05) — inactive"}], "tolerances": {"premium_g1": {"minor": 5, "major": 0, "unacceptable": 0}, "g2": {"minor": 25, "major": 3, "unacceptable": 2}, "page": 14}, "defects": {"minor": ["Over 10% of surface with dry or healed scar or blemish not breaking the skin", "Incorrect size, shape, colour or maturity that detracts from appearance"], "major": ["Fresh or wet injury, cut, puncture or damage breaking the skin", "Softness from over-maturity; shrivelled or wrinkled skin", "Soiling over 30% of surface; rot or mould on the stalk"], "unacceptable": ["Rot or mould growth on the body of the fruit", "Evidence of live insects", "Evidence of non-organic foreign bodies", "Foreign, chemical or musty deposits, powders, flavours or aromas", "Dirty, collapsed or unsuitable packaging"]}, "flags": ["Size not specified in the standard grading (p.20)"]}, {"code": "mini_cucumber", "name_en": "Mini Cucumber", "pages": [15, 16], "summary": "Straight cylindrical, uniform mid-dark green", "attributes": {"Description": "Uniform mid-dark green skin, no pale green; firm, smooth, may be slightly ridged but not wrinkled", "Internal": "Whitish to pale green crisp flesh; small white seeds; not watery or gelatinous", "Sensory": "Crisp, juicy; mild watery flavour; fresh aroma", "Shape": "Straight cylindrical, rounded ends; no banana-shaped, beaked or bottle-necked fruit", "Maturity": "Firm-bodied, glossy, crisp; not softening or springy; no pale or yellowed skin"}, "rules": [{"grade": "premium_g1", "criterion": "colour_coverage", "min": 100, "max": 100, "unit": "%", "page": 15}, {"grade": "g2", "criterion": "colour_coverage", "min": 90, "max": 100, "unit": "%", "page": 15}, {"grade": "premium_g1", "criterion": "diameter", "min": 1, "max": 2.5, "unit": "cm", "customer": "Abay", "page": 15}, {"grade": "premium_g1", "criterion": "diameter", "min": 1, "max": 2.5, "unit": "cm", "customer": "Tesco", "page": 15}, {"grade": "premium_g1", "criterion": "diameter", "min": 1, "max": 2.5, "unit": "cm", "customer": "Thanet Earth", "page": 15}, {"grade": "premium_g1", "criterion": "diameter", "min": 1, "max": 3, "unit": "cm", "customer": "DC", "page": 15}, {"grade": "premium_g1", "criterion": "length", "min": 7, "max": 10, "unit": "cm", "customer": "Abay", "page": 15}, {"grade": "premium_g1", "criterion": "length", "min": 7, "max": 13, "unit": "cm", "customer": "Thanet Earth", "page": 15}, {"grade": "premium_g1", "criterion": "length", "min": 7, "max": 12, "unit": "cm", "customer": "Tesco", "page": 15}, {"grade": "premium_g1", "criterion": "length", "min": 6, "max": 13, "unit": "cm", "customer": "DC", "page": 15}, {"grade": "g2", "criterion": "diameter", "max": 3.5, "unit": "cm", "page": 15, "note": "Max 3.5 cm"}, {"grade": "g2", "criterion": "length", "min": 13, "min_exclusive": true, "unit": "cm", "page": 15, "note": "More than 13 cm"}], "tolerances": {"premium_g1": {"minor": 5, "major": 0, "unacceptable": 0}, "g2": {"minor": 25, "major": 3, "unacceptable": 2}, "page": 16}, "defects": {"minor": ["More than 10% of surface area non-green", "Over 10% of surface with dry or healed scar or blemish not breaking the skin", "Incorrect size, shape, colour or maturity that detracts from appearance"], "major": ["Fresh or wet injury, cut, puncture or damage breaking the skin", "Shrivelled or wrinkled skin (age or dehydration)", "Excessive soiling over 10% of surface area"], "unacceptable": ["Rot or mould growth on the body of the fruit", "Evidence of live insects", "Evidence of non-organic foreign bodies", "Foreign, chemical or musty deposits, powders, flavours or aromas", "Dirty, collapsed or unsuitable packaging"]}, "flags": ["G1 size is per customer only; no customer-free G1 size is stated (p.15, p.20 note †)"]}, {"code": "eggplant", "name_en": "Eggplant", "pages": [17, 18], "summary": "Elongated pear / oval shape, glossy dark purple", "attributes": {"Description": "Deep, uniform purplish-black glossy skin; fresh green stem and calyx", "Internal": "White to cream flesh with predominantly white seeds", "Sensory": "Firm to slightly spongy; little natural aroma before cooking", "Shape": "Elongated pear to oval, tapering to cylindrical at stem end; no curvature", "Maturity": "No dark brown seeds; not soft, wrinkled or bladdery; calyx not brown, yellow or rotting"}, "rules": [{"grade": "premium_g1", "criterion": "colour_coverage", "min": 100, "max": 100, "unit": "%", "page": 17}, {"grade": "g2", "criterion": "colour_coverage", "min": 90, "max": 100, "unit": "%", "page": 17}, {"grade": "premium_g1", "criterion": "diameter", "min": 8, "max": 10, "unit": "cm", "page": 17}, {"grade": "premium_g1", "criterion": "length", "min": 15, "max": 20, "unit": "cm", "page": 17}, {"grade": "g2", "criterion": "diameter", "min": 5, "unit": "cm", "page": 17, "note": "Min 5 cm"}, {"grade": "g2", "criterion": "length", "min": 10, "unit": "cm", "page": 17, "note": "Min 10 cm"}, {"grade": "any", "criterion": "weight", "min": 350, "max": 700, "unit": "g", "customer": "LSS", "page": 17}], "tolerances": {"premium_g1": {"minor": 5, "major": 0, "unacceptable": 0}, "g2": {"minor": 25, "major": 3, "unacceptable": 2}, "page": 18}, "defects": {"minor": ["Healed scar or blemish over 10% of surface or longer than 5 cm", "Incorrect size, shape, colour or maturity that detracts from appearance", "Bruising over 10 mm affecting the flesh; soiling over 20% of surface", "Non-organic foreign bodies"], "major": ["Fresh or wet injury breaking the skin; shrivelled or wrinkled skin", "Excessive soiling over 15% of surface area", "Brown spots on over 10% of the surface"], "unacceptable": ["Rot or mould growth on the head", "Evidence of live insects", "Foreign, chemical or musty deposits, powders, flavours or aromas", "Dirty, collapsed or unsuitable packaging"]}, "flags": ["C-03: non-organic foreign bodies listed as Minor here, Unacceptable for every other product"]}, {"code": "chestnut_pumpkin", "name_en": "Chestnut Pumpkin", "pages": [19], "summary": "Round ribbed shape, graded by weight", "attributes": {}, "rules": [{"grade": "premium_g1", "criterion": "colour_coverage", "min": 100, "max": 100, "unit": "%", "page": 19}, {"grade": "g2", "criterion": "colour_coverage", "min": 90, "max": 100, "unit": "%", "page": 19}, {"grade": "premium_g1", "criterion": "weight", "min": 150, "max": 500, "unit": "g", "page": 19}, {"grade": "g2", "criterion": "weight", "min": 70, "unit": "g", "page": 19, "note": "Min 70 g"}], "tolerances": {"premium_g1": {"minor": 5, "major": 0, "unacceptable": 0}, "g2": {"minor": 25, "major": 3, "unacceptable": 2}, "page": 20, "note": "General tolerances from the summary (p.20); the specification has no product-specific defect page"}, "defects": {}, "flags": ["No quality-description or defect page for this product; tolerances from the p.20 general note"]}]}$json$::jsonb;
  aw   jsonb := $json${"machine": "AWETA G MV-D 4/20+1 | 363428 | Serial 60484", "plans": [{"code": "S-08", "kind": "maintenance", "title_en": "Preventive maintenance", "title_ar": "الصيانة الوقائية", "role": "MNT", "rule_en": "Maintenance team only. Isolate energy before work. Refit guards and test readiness before restart.", "rule_ar": "قسم الصيانة فقط. اعزل الطاقة قبل التدخل. أعد الحواجز واختبر الجاهزية قبل إعادة التشغيل.", "footer_en": ["8-hour recheck applies to 16-hour days. Hours/calendar, whichever comes first. Do not wait if a fault appears.", "Use point-specific lubricant/quantity; no double dosing or sealed-bearing greasing. Parts by condition and verified number. Timing-unit lubrication awaits AWETA confirmation.", "Proposed Jordan site plan for 10/16-hour days; 30/120/500 h are not OEM-approved intervals. Confirm CUP match to serial 60484; available drawing: 60483. Source: prior plan (CUP/CLD)."], "items": [{"code": "daily_before_start", "trigger": "daily_before_start", "en": "Daily before start", "ar": "يوميًا قبل التشغيل", "do_en": "Check guards, alarms, leaks/noise and oil level/delivery.", "do_ar": "افحص الحواجز والأعطال والتسريب والصوت؛ مستوى الزيت ووصوله."}, {"code": "before_start_8h", "trigger": "before_start_and_8h", "en": "Before start + at 8 h (16-hour days)", "ar": "قبل التشغيل + عند 8 ساعات", "do_en": "Verify weight with QC using a reference weight; check camera and cabinet cooling.", "do_ar": "اختبر الوزن مع QC بوزن مرجعي؛ افحص الكاميرا وتبريد الخزائن."}, {"code": "h30_d7", "trigger": "hours_or_calendar", "hours": 30, "days": 7, "en": "Every 30 h or 7 days", "ar": "كل 30 ساعة أو 7 أيام", "do_en": "Inspect/clean cabinet filters to their instructions; replace damaged filters with matching ones. Earlier if dirty.", "do_ar": "افحص ونظّف فلاتر الخزائن حسب نوعها؛ استبدل التالف بفلتر مطابق. أبكر عند الاتساخ."}, {"code": "h100", "trigger": "hours", "hours": 100, "en": "Every 100 h", "ar": "كل 100 ساعة", "do_en": "Service carrier-chain and hook/cam lubrication per manual; verify automatic oiling.", "do_ar": "راجع تزييت سلاسل الحوامل وخطافاتها/كاماتها حسب الدليل، وعمل التزييت الآلي."}, {"code": "h120_m1", "trigger": "hours_or_calendar", "hours": 120, "months": 1, "en": "Every 120 h or 1 month", "ar": "كل 120 ساعة أو شهر", "do_en": "Inspect/lubricate fitted chains per manual; inspect cups, shafts, sprockets and outlets.", "do_ar": "افحص وزيّت السلاسل الموجودة حسب الدليل؛ افحص الكاسات والمحاور والتروس والمخارج."}, {"code": "h500_m6", "trigger": "hours_or_calendar", "hours": 500, "months": 6, "en": "Every 500 h or 6 months", "ar": "كل 500 ساعة أو 6 أشهر", "do_en": "Check bearing heat/noise/vibration, encoder chain and transfer brush.", "do_ar": "افحص حرارة وصوت واهتزاز البيرنجات، سلسلة حساس الموضع وفرشاة الانتقال."}, {"code": "pre_season", "trigger": "pre_season", "en": "Pre-season / long shutdown", "ar": "قبل الموسم / بعد توقف طويل", "do_en": "Inspect safety, drives and grading; back up settings and test run.", "do_ar": "فحص شامل للأمان ونقل الحركة والفرز؛ نسخ احتياطي وتشغيل اختباري."}, {"code": "ups_battery", "trigger": "age_months", "months": 36, "en": "UPS battery: within 36 months", "ar": "بطارية UPS: خلال 36 شهرًا", "do_en": "Check battery age; replace with a matching battery within 36 months of age.", "do_ar": "راجع عمر البطارية واستبدلها ببطارية مطابقة للنظام خلال 36 شهرًا من عمرها."}]}, {"code": "S-09", "kind": "cleaning", "title_en": "Machine cleaning guide", "title_ar": "دليل تنظيف الماكينة", "role": "CLN", "rule_en": "Before cleaning: authorized person stops and isolates the machine. Never clean moving parts.", "rule_ar": "قبل أي تنظيف: أوقف الماكينة واعزل الطاقة بواسطة المخوّل. لا تنظّف أثناء الحركة.", "prohibited_en": "Cleaning team: do not — no hoses, pressure washing or steam. No electrical cabinet access, lubrication, part replacement or restart.", "prohibited_ar": "ممنوع على فريق النظافة: خرطوم ماء، ضغط عالٍ أو بخار. لا فتح لخزائن الكهرباء، لا تزييت، لا تبديل قطع ولا إعادة تشغيل.", "footer_en": ["Clean earlier after dust/debris buildup. Hours or calendar, whichever is first. 30/120 h are proposed site intervals from the prior plan."], "items": [{"code": "end_of_day", "trigger": "daily_end", "en": "1 | End of each day", "ar": "1 | نهاية كل يوم", "do_en": "Remove produce and debris from belts, cups and beneath the line. Use a soft brush and vacuum; wipe accessible surfaces with a clean cloth.", "do_ar": "أزل الثمار والبقايا من السيور والكاسات وتحت الخط. استخدم فرشاة ناعمة وشفطًا؛ امسح الأسطح المتاحة بقماش نظيف."}, {"code": "camera_daily", "trigger": "daily", "en": "2 | Camera: check daily", "ar": "2 | الكاميرا: افحص يوميًا", "do_en": "If dirty, wipe accessible outer glass with a lens cloth and approved cleaner. Do not open or move the camera.", "do_ar": "عند الاتساخ: امسح الزجاج الخارجي المتاح بقماش عدسات ومنظّف معتمد للسطح. لا تفتح أو تحرّك الكاميرا."}, {"code": "h30_d7", "trigger": "hours_or_calendar", "hours": 30, "days": 7, "en": "3 | Every 30 h or 7 days", "ar": "3 | كل 30 ساعة أو 7 أيام", "do_en": "Deep-clean carriers, belts, singulator and weighing area using brush, vacuum and cloth. Do not press on the weighing unit. Technician handles guards.", "do_ar": "نظّف الحوامل والسيور والتفريد ومنطقة الوزن بفرشاة ناعمة وشفط وقماش. لا تضغط على جهاز الوزن. الفني يفتح الحواجز اللازمة."}, {"code": "h120_m1", "trigger": "hours_or_calendar", "hours": 120, "months": 1, "en": "4 | Every 120 h or 1 month", "ar": "4 | كل 120 ساعة أو شهر", "do_en": "Brush debris and tangles off transfer/outlet brushes. Report damaged brushes to the technician.", "do_ar": "أزل البقايا والتشابك من فرش الانتقال والمخارج بفرشاة تنظيف. بلّغ الفني عن أي فرشاة تالفة."}], "after_en": "5 | After cleaning: tell Maintenance cleaning is complete and report damage. Maintenance refits guards and checks readiness before restart.", "after_ar": "5 | بعد التنظيف: أبلغ الفني بانتهاء التنظيف وأي تلف. قسم الصيانة يعيد الحواجز ويفحص جاهزية الماكينة قبل تشغيلها."}]}$json$::jsonb;
  v_spec uuid;
  p jsonb; r jsonb; g text; c text; pl jsonb; it jsonb; v_plan uuid; i integer;
begin
  insert into public.ph_actions (farm_id, action_key, object_code, label_en, label_ar, owner_roles, milestone, source, sort_order, scope_kind, category)
  select p_farm, a.k, split_part(a.k, '.', 1), a.en, a.ar, a.own, 'PO-6', a.src, 1200 + row_number() over (), 'farm', a.cat
    from (values
      ('spec.approve', 'Approve a grading specification', 'اعتماد مواصفة الفرز', '{QAM}'::text[], 'S-07; OD-43', 'quality'),
      ('pm.approve', 'Approve a maintenance or cleaning schedule', 'اعتماد جدول صيانة أو تنظيف', '{OWN}', 'S-08, S-09; OD-44', 'approve'),
      ('pm.meter', 'Record machine running hours', 'تسجيل ساعات تشغيل الماكينة', '{OWN}', 'S-08, S-09', 'create'),
      ('pm.preseason', 'Start a pre-season / long-shutdown check', 'بدء فحص ما قبل الموسم / بعد توقف طويل', '{OWN}', 'S-08', 'create'),
      ('acc.view', 'See the accountability register', 'عرض سجل المساءلة', '{OWN}', 'S-04 p.4, S-06 p.2', 'view'),
      ('acc.record', 'Record a violation and issue the warning', 'تسجيل مخالفة وإصدار الإنذار', '{OWN}', 'S-04 p.4, S-06 p.2', 'create'),
      ('acc.hr_decide', 'Record the HR decision on a referred violation', 'تسجيل قرار الموارد البشرية في مخالفة محالة', '{OWN}', 'S-04 p.4: "HR reviews each case"', 'approve'),
      ('import.run', 'Import a spreadsheet into master data', 'استيراد جدول بيانات إلى البيانات الأساسية', '{OWN}', 'Owner instruction 2026-11-21', 'administer')
    ) as a(k, en, ar, own, src, cat)
   where not exists (select 1 from public.ph_actions where farm_id = p_farm and action_key = a.k);
  -- Proposed cells (labelled P; usable only where proposals are in effect, or after an Owner decision).
  insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
  select p_farm, m.k, m.r, 'P', 'proposed', 'P', m.note
    from (values ('spec.approve', 'QAM', 'OD-43: QA approves the specification'),
                 ('pm.approve', 'PHM', 'OD-44: maintenance owner not named'), ('pm.meter', 'MNT', null), ('pm.meter', 'PE', null), ('pm.meter', 'LL', null),
                 ('pm.preseason', 'MNT', null), ('pm.preseason', 'PHM', null),
                 ('acc.view', 'PHM', 'S-04 p.4: the Packhouse Managers issue warnings'), ('acc.record', 'PHM', 'S-04 p.4'),
                 ('import.run', 'PHM', null)) as m(k, r, note)
   where exists (select 1 from public.ph_roles where farm_id = p_farm and spec_code = m.r)
     and not exists (select 1 from public.ph_permission_cells c where c.farm_id = p_farm and c.action_key = m.k and c.spec_code = m.r);
  insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
  select p_farm, k, 'OWN', 'O', 'active', 'O', 'Owner role'
    from unnest(array['pm.approve', 'pm.meter', 'pm.preseason', 'acc.view', 'import.run']) k
   where exists (select 1 from public.ph_roles where farm_id = p_farm and spec_code = 'OWN')
     and not exists (select 1 from public.ph_permission_cells c where c.farm_id = p_farm and c.action_key = k and c.spec_code = 'OWN');

  -- S-07 as version 1, awaiting approval.
  if not exists (select 1 from public.ph_specs where farm_id = p_farm and code = 'S-07') then
    insert into public.ph_specs (farm_id, code, version_no, title, state, source_ref, data)
    values (p_farm, 'S-07', 1, s7 ->> 'title', 'awaiting_approval', 'Produce_Grading_Final_Updated.pdf (' || (s7 ->> 'dated') || ')', s7)
    returning id into v_spec;
    for p in select * from jsonb_array_elements(s7 -> 'products') loop
      for r in select * from jsonb_array_elements(p -> 'rules') loop
        foreach g in array case r ->> 'grade' when 'premium_g1' then array['premium', 'gr1'] when 'g2' then array['gr2'] else array['premium', 'gr1', 'gr2'] end loop
          insert into public.ph_spec_rules (farm_id, spec_id, product_code, grade, criterion, customer, band, min_value, max_value, min_exclusive, unit, text_value, note, page, inactive)
          values (p_farm, v_spec, p ->> 'code', g, r ->> 'criterion', r ->> 'customer', coalesce((r ->> 'band')::int, 1), (r ->> 'min')::numeric, (r ->> 'max')::numeric,
                  coalesce((r ->> 'min_exclusive')::boolean, false), r ->> 'unit', r ->> 'text', r ->> 'note', (r ->> 'page')::int, coalesce((r ->> 'inactive')::boolean, false));
        end loop;
      end loop;
      -- Tolerances: Premium and G1 share every category except colour (Premium 3 %, G1 10 %).
      foreach g in array array['premium', 'gr1', 'gr2'] loop
        foreach c in array array['colour', 'minor', 'major', 'unacceptable'] loop
          insert into public.ph_spec_tolerances (farm_id, spec_id, product_code, grade, category, max_pct, page)
          select p_farm, v_spec, p ->> 'code', g, c,
                 coalesce(case when g = 'premium' then p -> 'tolerances' -> 'premium' ->> c end,
                          case when g in ('premium', 'gr1') then p -> 'tolerances' -> 'premium_g1' ->> c else p -> 'tolerances' -> 'g2' ->> c end)::numeric,
                 (p -> 'tolerances' ->> 'page')::int
           where coalesce(case when g = 'premium' then p -> 'tolerances' -> 'premium' ->> c end,
                          case when g in ('premium', 'gr1') then p -> 'tolerances' -> 'premium_g1' ->> c else p -> 'tolerances' -> 'g2' ->> c end) is not null;
        end loop;
      end loop;
    end loop;
  end if;

  -- S-08 / S-09, pending approval.
  for pl in select * from jsonb_array_elements(aw -> 'plans') loop
    continue when exists (select 1 from public.ph_pm_plans where farm_id = p_farm and code = pl ->> 'code' and voided_at is null);
    insert into public.ph_pm_plans (farm_id, code, kind, machine_label, title_en, title_ar, role_code, state, data)
    values (p_farm, pl ->> 'code', pl ->> 'kind', aw ->> 'machine', pl ->> 'title_en', pl ->> 'title_ar', pl ->> 'role', 'pending_approval', pl)
    returning id into v_plan;
    i := 0;
    for it in select * from jsonb_array_elements(pl -> 'items') loop
      i := i + 1;
      insert into public.ph_pm_items (farm_id, plan_id, code, trigger_kind, interval_hours, interval_days, interval_months, title_en, title_ar, do_en, do_ar, sort_order)
      values (p_farm, v_plan, it ->> 'code', it ->> 'trigger', (it ->> 'hours')::numeric, (it ->> 'days')::int, (it ->> 'months')::int,
              it ->> 'en', it ->> 'ar', it ->> 'do_en', it ->> 'do_ar', i);
    end loop;
  end loop;

  -- Accountability policy v1: draft, not in force; scope as in S-04 (C-02 conflict noted).
  if not exists (select 1 from public.ph_acc_policy where farm_id = p_farm) then
    insert into public.ph_acc_policy (farm_id, version_no, state, scope_roles, warnings_before_hr, text_en, text_ar, source_ref)
    values (p_farm, 1, 'draft_inactive', '{LL,PE}', 3,
      'This process applies to Line Supervisors and Production Engineers. First three violations: the Packhouse Managers issue one internal verbal warning for each of the first three violations. All three warnings are handled within the packhouse. Fourth and subsequent violations: after the third internal verbal warning, the Packhouse Managers refer every further violation to Human Resources (HR). HR reviews each case individually and determines what action to take.',
      'تنطبق هذه الإجراءات على مشرفي الخطوط. المخالفات الثلاث الأولى: يُصدر مدراء بيت التعبئة إنذاراً شفهياً داخلياً واحداً عن كل مخالفة من المخالفات الثلاث الأولى. تُعالَج الإنذارات الثلاثة جميعها داخل بيت التعبئة. المخالفة الرابعة وما يليها: بعد الإنذار الشفهي الداخلي الثالث، يُحيل مدراء بيت التعبئة كل مخالفة لاحقة إلى قسم الموارد البشرية (HR). يراجع قسم الموارد البشرية كل حالة بشكل منفرد ويقرر الإجراء الواجب اتخاذه.',
      'S-04 p.4 (EN: Line Supervisors and Production Engineers) / S-06 p.2 (AR: line supervisors only) — conflict C-02, decision OD-42');
  end if;
end $fn$;

-- =============================================================================================
-- 5. Specification functions
-- =============================================================================================
create function public.ph_spec_approve(p_spec uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare s public.ph_specs;
begin
  select * into s from public.ph_specs where id = p_spec and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Specification not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(s.farm_id, 'spec.approve');
  if coalesce(trim(p_note), '') = '' then raise exception 'An approval note is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if s.state <> 'awaiting_approval' then raise exception 'Only a specification awaiting approval can be approved' using errcode = 'P0422'; end if;
  update public.ph_specs set state = 'superseded' where farm_id = s.farm_id and code = s.code and state = 'approved' and voided_at is null;
  perform set_config('app.in_verify', 'on', true);
  update public.ph_specs set state = 'approved', approved_by = app.current_user_id(), approved_at = now(), approval_note = p_note where id = s.id;
  perform set_config('app.in_verify', 'off', true);
  insert into public.ph_access_events (farm_id, event, after, reason) values (s.farm_id, 'spec_approved', jsonb_build_object('code', s.code, 'version', s.version_no), p_note);
  return jsonb_build_object('id', s.id, 'state', 'approved');
end;
$$;

-- Advisory grade check for QC: measurements against the bands of each grade (customer rows override the standard row for
-- their criterion), defect % against tolerances. A suggestion only — the release is the inspector's decision.
create function public.ph_spec_check(p_product text, p_customer text, p_measures jsonb, p_defects jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  s      public.ph_specs;
  g      text;
  crit   text;
  v      numeric;
  ok     boolean;
  bnd    boolean;
  rr     record;
  out    jsonb := '[]';
  checks jsonb;
  reasons jsonb;
  boundary jsonb;
  sample numeric := nullif(p_defects ->> 'sample', '')::numeric;
  pct    numeric;
  tol    record;
  review boolean;
  stage6 boolean := (p_measures ->> 'colour_stage') = '6';
  soft   boolean := coalesce((p_measures ->> 'soft')::boolean, false);
begin
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  select * into s from public.ph_specs where farm_id = v_farm and code = 'S-07' and state in ('approved', 'awaiting_approval') and voided_at is null
   order by (state = 'approved') desc, version_no desc limit 1;
  if not found then raise exception 'No grading specification' using errcode = 'P0404'; end if;
  foreach g in array array['premium', 'gr1', 'gr2'] loop
    checks := '[]'; reasons := '[]'; boundary := '[]'; review := false;
    foreach crit in array array['colour_stage', 'colour_coverage', 'diameter', 'length', 'weight'] loop
      continue when coalesce(p_measures ->> crit, '') = '';
      v := (p_measures ->> crit)::numeric;
      ok := null; bnd := false;
      for rr in
        select * from public.ph_spec_rules r
         where r.spec_id = s.id and r.product_code = p_product and r.grade = g and r.criterion = crit and not r.inactive and r.voided_at is null
           and (r.min_value is not null or r.max_value is not null)
           and ((p_customer is not null and r.customer = p_customer)
                or (r.customer is null and not exists (select 1 from public.ph_spec_rules x where x.spec_id = s.id and x.product_code = p_product and x.grade = g
                       and x.criterion = crit and x.customer = p_customer and not x.inactive and x.voided_at is null)))
      loop
        if (rr.min_value is null or (case when rr.min_exclusive then v > rr.min_value else v >= rr.min_value end)) and (rr.max_value is null or v <= rr.max_value) then
          ok := true;
          -- Boundary (C-04 / OD-45): v is where this band ends and another grade's band begins (they touch only at v).
          if coalesce(rr.min_value, v) < coalesce(rr.max_value, v + 1) and exists (
               select 1 from public.ph_spec_rules o
                where o.spec_id = s.id and o.product_code = p_product and o.criterion = crit and o.grade <> g and not o.inactive and o.voided_at is null
                  and (o.customer is null or o.customer = p_customer)
                  and ((rr.max_value = v and o.min_value = v and coalesce(o.max_value, v + 1) > v)
                    or (rr.min_value = v and o.max_value = v and coalesce(o.min_value, v - 1) < v))) then
            bnd := true;
          end if;
        elsif ok is null then ok := false;
        end if;
      end loop;
      continue when ok is null;  -- not specified for this grade / customer
      checks := checks || jsonb_build_object('criterion', crit, 'value', v, 'ok', ok);
      if not ok then reasons := reasons || to_jsonb(crit); end if;
      if ok and bnd then boundary := boundary || to_jsonb(crit); end if;
    end loop;
    -- Stage 6 conditions (S-07 p.7, p.9, p.20).
    if stage6 and p_product = 'cherry_tomato' and soft then reasons := reasons || to_jsonb('stage6_soft'::text); end if;
    if stage6 and p_product = 'regular_tomato' and g in ('premium', 'gr1') and (soft or coalesce(p_customer, '') <> 'DC') then reasons := reasons || to_jsonb('stage6_dc_not_soft'::text); end if;
    -- Defect tolerances.
    if sample is not null and sample > 0 then
      for tol in select category, max_pct from public.ph_spec_tolerances where spec_id = s.id and product_code = p_product and grade = g and voided_at is null loop
        continue when coalesce(p_defects ->> tol.category, '') = '';
        pct := round(100.0 * (p_defects ->> tol.category)::numeric / sample, 2);
        checks := checks || jsonb_build_object('criterion', 'defect_' || tol.category, 'value', pct, 'max', tol.max_pct, 'ok', pct <= tol.max_pct);
        if pct > tol.max_pct then reasons := reasons || to_jsonb('defect_' || tol.category); end if;
      end loop;
    end if;
    if coalesce((p_defects ->> 'live_insects')::numeric, 0) > 0 then
      if p_product in ('regular_tomato', 'cherry_tomato') then review := true;  -- C-05: evaluated internally
      else reasons := reasons || to_jsonb('live_insects'::text); end if;
    end if;
    out := out || jsonb_build_object('grade', g, 'checks', checks, 'fails', reasons, 'boundary', boundary, 'qa_review', review,
      'result', case when jsonb_array_length(reasons) > 0 then 'fails' when review then 'qa_review' when jsonb_array_length(boundary) > 0 then 'boundary' else 'meets' end);
  end loop;
  return jsonb_build_object('spec', s.code, 'version', s.version_no, 'state', s.state, 'product', p_product, 'customer', p_customer, 'grades', out);
end;
$$;

-- =============================================================================================
-- 6. Maintenance / cleaning functions
-- =============================================================================================
create function public.ph_pm_approve(p_plan uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare pl public.ph_pm_plans;
begin
  select * into pl from public.ph_pm_plans where id = p_plan and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Plan not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(pl.farm_id, 'pm.approve');
  if coalesce(trim(p_note), '') = '' then raise exception 'An approval note is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if pl.state <> 'pending_approval' then raise exception 'This plan is not waiting for approval' using errcode = 'P0422'; end if;
  perform set_config('app.in_verify', 'on', true);
  update public.ph_pm_plans set state = 'approved', approved_by = app.current_user_id(), approved_at = now(), approval_note = p_note where id = pl.id;
  perform set_config('app.in_verify', 'off', true);
  insert into public.ph_access_events (farm_id, event, after, reason) values (pl.farm_id, 'pm_plan_approved', jsonb_build_object('code', pl.code), p_note);
  return jsonb_build_object('id', pl.id, 'state', 'approved');
end;
$$;

create function public.ph_pm_meter_record(p_hours numeric, p_note text default null, p_ups_installed_on date default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  v_last numeric;
  v_label text;
begin
  perform app.ph_authorize(v_farm, 'pm.meter');
  select machine_label into v_label from public.ph_pm_plans where farm_id = v_farm and voided_at is null limit 1;
  if v_label is null then raise exception 'No maintenance plan' using errcode = 'P0404'; end if;
  if p_hours is not null then
    select hours into v_last from public.ph_pm_meter where farm_id = v_farm and voided_at is null order by read_at desc limit 1;
    if v_last is not null and p_hours < v_last then
      raise exception 'Running hours cannot go down (last reading %)', v_last using errcode = 'P0422', detail = jsonb_build_object('key', 'po.pm.hoursDown', 'last', v_last)::text;
    end if;
    insert into public.ph_pm_meter (farm_id, machine_label, hours, note) values (v_farm, v_label, p_hours, nullif(trim(p_note), ''));
  end if;
  if p_ups_installed_on is not null then
    update public.ph_pm_plans set ups_installed_on = p_ups_installed_on where farm_id = v_farm and code = 'S-08' and voided_at is null;
  end if;
  return jsonb_build_object('hours', p_hours);
end;
$$;

create function app.po_pm_hours(p_farm uuid) returns numeric
language sql stable as $$ select hours from public.ph_pm_meter where farm_id = p_farm and voided_at is null order by read_at desc, hours desc limit 1 $$;

-- Due state of one item: whether a new task is needed now and why (null = not due).
create function app.po_pm_due(it public.ph_pm_items, pl public.ph_pm_plans) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  d        public.ph_pm_done;
  v_hours  numeric := app.po_pm_hours(it.farm_id);
  v_base_h numeric;
  v_base_t timestamptz;
  today    date := app.ph_local_date();
begin
  if pl.state <> 'approved' then return null; end if;
  if exists (select 1 from public.ph_tasks where pm_item_id = it.id and completed_at is null and cancelled_at is null and voided_at is null) then return null; end if;
  select * into d from public.ph_pm_done where item_id = it.id and voided_at is null order by done_at desc limit 1;
  case it.trigger_kind
    when 'daily_before_start', 'before_start_and_8h', 'daily', 'daily_end' then
      if exists (select 1 from public.ph_tasks where pm_item_id = it.id and voided_at is null and (created_at at time zone 'Asia/Amman')::date = today) then return null; end if;
      return 'daily';
    when 'hours_or_calendar', 'hours' then
      v_base_t := coalesce(d.done_at, pl.approved_at);
      -- Hours baseline: at the last completion; else the reading at approval (or the first reading after it).
      v_base_h := coalesce(d.hours_at,
        (select hours from public.ph_pm_meter m where m.farm_id = it.farm_id and m.voided_at is null and m.read_at <= v_base_t order by read_at desc, hours desc limit 1),
        (select hours from public.ph_pm_meter m where m.farm_id = it.farm_id and m.voided_at is null and m.read_at > v_base_t order by read_at, hours limit 1));
      if it.interval_hours is not null and v_hours is not null and v_base_h is not null and v_hours - v_base_h >= it.interval_hours then return 'hours'; end if;
      if it.trigger_kind = 'hours_or_calendar' and (
           (it.interval_days is not null and now() >= v_base_t + make_interval(days => it.interval_days))
        or (it.interval_months is not null and now() >= v_base_t + make_interval(months => it.interval_months))) then return 'calendar'; end if;
      return null;
    when 'age_months' then
      if pl.ups_installed_on is null then return null; end if;
      if coalesce(d.done_at::date, pl.ups_installed_on) + make_interval(months => it.interval_months) - interval '30 days' <= now() then return 'age'; end if;
      return null;
    else return null;  -- pre-season: started by a person
  end case;
end;
$$;

create function app.po_pm_task(it public.ph_pm_items, pl public.ph_pm_plans, p_reason text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.ph_tasks (id, farm_id, code, title, details, assignee_role, due_at, priority, source, pm_item_id)
  values (v_id, it.farm_id, app.ph_code(it.farm_id, 'TSK', 4), it.title_ar || ' — ' || pl.title_ar,
          it.do_ar || E'\n' || it.do_en || E'\n\n' || coalesce(pl.data ->> 'rule_ar', '') || E'\n' || coalesce(pl.data ->> 'rule_en', '')
            || case when pl.kind = 'cleaning' then E'\n\n' || coalesce(pl.data ->> 'prohibited_ar', '') || E'\n' || coalesce(pl.data ->> 'prohibited_en', '') else '' end
            || E'\n(' || pl.code || ', ' || p_reason || ')',
          pl.role_code, case when it.trigger_kind in ('hours_or_calendar', 'hours', 'age_months') then now() end,
          case when p_reason in ('hours', 'calendar', 'age') then 'high' else 'normal' end, 'schedule', it.id);
  perform app.ph_notify_role(it.farm_id, pl.role_code, 'po_task', 'ph_tasks', v_id, jsonb_build_object('code', pl.code, 'item', it.code));
  return v_id;
end;
$$;

create function public.po_pm_tick() returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare it public.ph_pm_items; pl public.ph_pm_plans; why text; n integer := 0;
begin
  for pl in select * from public.ph_pm_plans where state = 'approved' and voided_at is null loop
    perform set_config('app.acting_user_id', pl.approved_by::text, true);
    for it in select * from public.ph_pm_items where plan_id = pl.id and voided_at is null order by sort_order loop
      why := app.po_pm_due(it, pl);
      continue when why is null;
      perform app.po_pm_task(it, pl, why);
      n := n + 1;
    end loop;
  end loop;
  return jsonb_build_object('created', n);
end;
$$;
revoke all on function public.po_pm_tick() from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'po_auth') then grant execute on function public.po_pm_tick() to po_auth; end if; end $$;

create function public.ph_pm_start_preseason() returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_farm uuid := app.ph_farm_of_user(); it public.ph_pm_items; pl public.ph_pm_plans; v_id uuid;
begin
  perform app.ph_authorize(v_farm, 'pm.preseason');
  select i.* into it from public.ph_pm_items i join public.ph_pm_plans p on p.id = i.plan_id where p.farm_id = v_farm and i.trigger_kind = 'pre_season' and i.voided_at is null limit 1;
  select * into pl from public.ph_pm_plans where id = it.plan_id;
  if pl.state <> 'approved' then raise exception 'The maintenance schedule is not approved yet (OD-44)' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.pm.notApproved')::text; end if;
  if exists (select 1 from public.ph_tasks where pm_item_id = it.id and completed_at is null and cancelled_at is null) then
    raise exception 'A pre-season check is already open' using errcode = 'P0409';
  end if;
  v_id := app.po_pm_task(it, pl, 'pre_season');
  return jsonb_build_object('task_id', v_id);
end;
$$;

-- Completing a scheduled task records it with the running hours; after cleaning, Maintenance gets the restart check
-- (S-09 step 5: the cleaning team never restarts the machine).
create function app.po_pm_on_task_done() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare it public.ph_pm_items; pl public.ph_pm_plans; v_id uuid := gen_random_uuid();
begin
  if new.pm_item_id is null or old.completed_at is not null or new.completed_at is null then return new; end if;
  select * into it from public.ph_pm_items where id = new.pm_item_id;
  select * into pl from public.ph_pm_plans where id = it.plan_id;
  insert into public.ph_pm_done (farm_id, item_id, task_id, done_at, hours_at, note)
  values (new.farm_id, it.id, new.id, new.completed_at, app.po_pm_hours(new.farm_id), new.completion_note);
  if pl.kind = 'cleaning' then
    insert into public.ph_tasks (id, farm_id, code, title, details, assignee_role, priority, source)
    values (v_id, new.farm_id, app.ph_code(new.farm_id, 'TSK', 4), 'بعد التنظيف: إعادة الحواجز وفحص الجاهزية قبل التشغيل — ' || it.title_ar,
            coalesce(pl.data ->> 'after_ar', '') || E'\n' || coalesce(pl.data ->> 'after_en', '') || E'\n(' || pl.code || ', ' || new.code || ')',
            'MNT', 'high', 'rule');
    perform app.ph_notify_role(new.farm_id, 'MNT', 'po_task', 'ph_tasks', v_id, jsonb_build_object('code', new.code));
  end if;
  return new;
end;
$$;
create trigger ph_tasks_pm_done after update of completed_at on public.ph_tasks for each row execute function app.po_pm_on_task_done();

create view public.ph_pm_board with (security_invoker = true) as
  select i.id as item_id, i.farm_id, p.id as plan_id, p.code as plan_code, p.kind, p.state as plan_state, p.role_code, i.code, i.trigger_kind,
         i.interval_hours, i.interval_days, i.interval_months, i.title_en, i.title_ar, i.do_en, i.do_ar, i.sort_order,
         (select max(d.done_at) from public.ph_pm_done d where d.item_id = i.id and d.voided_at is null) as last_done_at,
         (select d.hours_at from public.ph_pm_done d where d.item_id = i.id and d.voided_at is null order by d.done_at desc limit 1) as last_done_hours,
         (select t.id from public.ph_tasks t where t.pm_item_id = i.id and t.completed_at is null and t.cancelled_at is null and t.voided_at is null limit 1) as open_task_id
    from public.ph_pm_items i join public.ph_pm_plans p on p.id = i.plan_id
   where i.voided_at is null and p.voided_at is null;

-- =============================================================================================
-- 7. Accountability functions
-- =============================================================================================
create function public.ph_acc_decide(p_policy uuid, p_scope text[], p_note text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare pol public.ph_acc_policy;
begin
  select * into pol from public.ph_acc_policy where id = p_policy and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Policy not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(pol.farm_id, 'settings.authority');
  if coalesce(trim(p_note), '') = '' then raise exception 'A decision note is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if p_scope is null or cardinality(p_scope) = 0 or not (p_scope <@ array['LL', 'PE']) then
    raise exception 'Choose who the policy applies to (line supervisors, production engineers)' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.acc.scope')::text;
  end if;
  update public.ph_acc_policy set state = 'active', scope_roles = p_scope, decided_by = app.current_user_id(), decided_at = now(), decision_note = p_note where id = pol.id;
  insert into public.ph_access_events (farm_id, event, after, reason) values (pol.farm_id, 'accountability_activated', jsonb_build_object('scope', p_scope), p_note);
  return jsonb_build_object('state', 'active', 'scope', p_scope);
end;
$$;

create function public.ph_acc_record(p_person uuid, p_occurred_on date, p_description text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  pol    public.ph_acc_policy;
  v_n    integer;
  v_id   uuid := gen_random_uuid();
begin
  perform app.ph_authorize(v_farm, 'acc.record');
  select * into pol from public.ph_acc_policy where farm_id = v_farm and state = 'active' and voided_at is null order by version_no desc limit 1;
  if not found then
    raise exception 'The accountability policy is a draft and not in force (OD-42)' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.acc.inactive')::text;
  end if;
  if not (app.ph_user_spec_roles(p_person, v_farm) && pol.scope_roles) then
    raise exception 'The policy does not apply to this person''s role' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.acc.outOfScope')::text;
  end if;
  if p_person = app.current_user_id() then raise exception 'You cannot record a violation for yourself' using errcode = 'P0423'; end if;
  select count(*) + 1 into v_n from public.ph_acc_violations where farm_id = v_farm and person_id = p_person and policy_id = pol.id and voided_at is null;
  insert into public.ph_acc_violations (id, farm_id, policy_id, person_id, occurred_on, description, sequence_no, outcome)
  values (v_id, v_farm, pol.id, p_person, p_occurred_on, trim(p_description), v_n, case when v_n <= pol.warnings_before_hr then 'verbal_warning' else 'hr_referred' end);
  return jsonb_build_object('id', v_id, 'sequence_no', v_n, 'outcome', case when v_n <= pol.warnings_before_hr then 'verbal_warning' else 'hr_referred' end);
end;
$$;

create function public.ph_acc_hr_decision(p_violation uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v public.ph_acc_violations;
begin
  select * into v from public.ph_acc_violations where id = p_violation and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(v.farm_id, 'acc.hr_decide');
  if v.outcome <> 'hr_referred' then raise exception 'Only referred violations get an HR decision' using errcode = 'P0422'; end if;
  if coalesce(trim(p_decision), '') = '' then raise exception 'Write the decision' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  update public.ph_acc_violations set hr_decision = trim(p_decision), hr_decided_by = app.current_user_id(), hr_decided_at = now() where id = v.id;
  return jsonb_build_object('id', v.id);
end;
$$;

create view public.ph_acc_register with (security_invoker = true) as
  select v.id, v.farm_id, v.person_id, up.full_name as person_name, v.occurred_on, v.description, v.sequence_no, v.outcome, v.hr_decision, v.hr_decided_at,
         v.created_at, rp.full_name as recorded_by_name
    from public.ph_acc_violations v join public.user_profiles up on up.id = v.person_id left join public.user_profiles rp on rp.id = v.created_by
   where v.voided_at is null;

-- =============================================================================================
-- 8. Spreadsheet import (master data through the normal maker step; approval stays with a second person)
-- =============================================================================================
create function public.ph_import_rows(p_table text, p_rows jsonb, p_file text default null, p_update_existing boolean default false) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm   uuid := app.ph_farm_of_user();
  v_batch  uuid := gen_random_uuid();
  r        jsonb;
  i        integer := 0;
  n_saved  integer := 0; n_skip integer := 0; n_fail integer := 0;
  v_existing uuid;
  seen     text[] := '{}';
  v_code   text;
  results  jsonb := '[]';
begin
  perform app.ph_authorize(v_farm, 'import.run');
  if not exists (select 1 from app.ph_master_tables where table_name = p_table) then
    raise exception 'This table cannot be imported' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.import.table')::text;
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Send between 1 and 2,000 rows' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.import.rows')::text;
  end if;
  insert into public.ph_import_batches (id, farm_id, target_table, file_name, rows_total, rows_saved, rows_skipped, rows_failed)
  values (v_batch, v_farm, p_table, p_file, jsonb_array_length(p_rows), 0, 0, 0);
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_code := nullif(trim(r ->> 'code'), '');
    if v_code is not null and lower(v_code) = any (seen) then
      insert into public.ph_import_exceptions (farm_id, batch_id, row_no, data, error) values (v_farm, v_batch, i, r, 'Duplicate code in the file');
      n_fail := n_fail + 1; results := results || jsonb_build_object('row', i, 'status', 'duplicate'); continue;
    end if;
    seen := seen || lower(coalesce(v_code, ''));
    execute format('select id from public.%I where farm_id = $1 and lower(code) = lower($2) and voided_at is null limit 1', p_table) into v_existing using v_farm, v_code;
    if v_existing is not null and not p_update_existing then
      n_skip := n_skip + 1; results := results || jsonb_build_object('row', i, 'status', 'exists'); continue;
    end if;
    begin
      perform public.ph_save_master(p_table, v_existing, r - 'id' - 'farm_id', v_farm);
      n_saved := n_saved + 1; results := results || jsonb_build_object('row', i, 'status', case when v_existing is null then 'created' else 'updated' end);
    exception when others then
      insert into public.ph_import_exceptions (farm_id, batch_id, row_no, data, error) values (v_farm, v_batch, i, r, sqlerrm);
      n_fail := n_fail + 1; results := results || jsonb_build_object('row', i, 'status', 'failed', 'error', sqlerrm);
    end;
  end loop;
  update public.ph_import_batches set rows_saved = n_saved, rows_skipped = n_skip, rows_failed = n_fail where id = v_batch;
  return jsonb_build_object('batch_id', v_batch, 'saved', n_saved, 'skipped', n_skip, 'failed', n_fail, 'rows', results);
end;
$$;

create function public.ph_import_resolve(p_exception uuid, p_action text, p_data jsonb default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare e public.ph_import_exceptions; b public.ph_import_batches;
begin
  select * into e from public.ph_import_exceptions where id = p_exception and voided_at is null and resolved_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Not found or already resolved' using errcode = 'P0404'; end if;
  select * into b from public.ph_import_batches where id = e.batch_id;
  perform app.ph_authorize(e.farm_id, 'import.run');
  if p_action = 'retry' then
    perform public.ph_save_master(b.target_table, null, coalesce(p_data, e.data) - 'id' - 'farm_id', e.farm_id);
    update public.ph_import_exceptions set resolved_at = now(), resolution = 'saved after correction', data = coalesce(p_data, e.data) where id = e.id;
  elsif p_action = 'dismiss' then
    if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
    update public.ph_import_exceptions set resolved_at = now(), resolution = 'dismissed: ' || trim(p_reason) where id = e.id;
  else
    raise exception 'Unknown action' using errcode = 'P0422';
  end if;
  return jsonb_build_object('id', e.id, 'action', p_action);
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
  perform app.seed_po_identity(p_farm);
  perform app.seed_po_config_engine(p_farm);
  perform app.seed_po_backup(p_farm);
  perform app.seed_po_increment6(p_farm);
end $$;

select app.seed_po_increment6(id) from public.farms;
-- People the active accountability policy applies to (for the record form). Only those allowed to record see the list.
create function public.ph_acc_people() returns table (id uuid, full_name text, roles text[])
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare v_farm uuid := app.ph_farm_of_user(); pol public.ph_acc_policy;
begin
  perform app.ph_authorize(v_farm, 'acc.record');
  select * into pol from public.ph_acc_policy where farm_id = v_farm and state = 'active' and voided_at is null order by version_no desc limit 1;
  if not found then return; end if;
  return query
    select up.id, up.full_name, app.ph_user_spec_roles(up.id, v_farm)
      from public.user_profiles up
     where up.id <> app.current_user_id()
       and app.ph_user_spec_roles(up.id, v_farm) && pol.scope_roles
     order by up.full_name;
end;
$$;

select app.apply_api_grants();
revoke all on function public.po_pm_tick() from anon, authenticated;
