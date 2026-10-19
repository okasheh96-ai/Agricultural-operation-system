-- Packing house 2/3: master data (spec §9.1, FR-MD-01…06). Structure only. The values documented in the SOP / Summary
-- (crops on the lines, storage groups, locations and capacities, lines, receiving scales) are loaded only by an explicit
-- owner action (app.ph_load_sop_reference) and arrive Not Yet Verified; nothing is usable until approved by a second
-- person (maker-checker, SoD-07). Sources (blocks/sections, suppliers) and varieties are never pre-loaded: the spec marks
-- them Not Yet Verified (FR-MD-05).

set check_function_bodies = off;

create table public.ph_storage_groups (
  id        uuid primary key default gen_random_uuid(),
  code      text not null,
  name_ar   text not null,
  name_en   text,
  evidence  text not null default 'C' check (evidence in ('C', 'P', 'NYV')),
  search_text text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.ph_storage_groups is
  'Storage groups kept separate in the fridges (SOP-PC, EV-21): tomato & cherry, mini cucumber, pepper & sweet bite, '
  'eggplant, mango, onion. Data owner QAM. Placement checks compare a fridge''s current group with the crop''s (V-07).';
select app.register_table('public.ph_storage_groups', 'ph_master', true, p_default_policies => false);
create unique index ph_storage_groups_uq on public.ph_storage_groups (farm_id, code) where voided_at is null;

create table public.ph_crops (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null,
  version_no             integer not null default 1 check (version_no > 0),
  name_ar                text not null,
  name_en                text,
  storage_group_id       uuid references public.ph_storage_groups(id),
  doc_temp_min_c         numeric(5,1),
  doc_temp_max_c         numeric(5,1),
  doc_temp_note          text,
  boxes_per_pallet       integer check (boxes_per_pallet is null or boxes_per_pallet > 0),
  nominal_kg_per_pallet  numeric(10,2) check (nominal_kg_per_pallet is null or nominal_kg_per_pallet > 0),
  washer_route           text not null default 'unknown' check (washer_route in ('yes', 'no', 'unknown')),
  allowed_lines          text[] not null default '{}',
  decision_code          text,
  superseded_at          timestamptz,
  search_text text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored,
  check (doc_temp_min_c is null or doc_temp_max_c is null or doc_temp_min_c <= doc_temp_max_c)
);
comment on table public.ph_crops is
  'Crop master for the packing house (FR-MD-01): storage group, documented temperature range (a reference, not an alarm '
  'limit — OD-08), boxes per pallet, nominal kg per pallet (plausibility only, OD-29), washer route and allowed lines '
  '(Figure 4.2). One row per version: a change creates a new version and records keep the version they used. A crop '
  'cannot be received until a second person approves it.';
select app.register_table('public.ph_crops', 'ph_master', true, p_default_policies => false);
create unique index ph_crops_uq on public.ph_crops (farm_id, code, version_no) where voided_at is null;

create table public.ph_varieties (
  id       uuid primary key default gen_random_uuid(),
  crop_code text not null,
  code     text not null,
  name_ar  text not null,
  name_en  text,
  search_text text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.ph_varieties is 'Varieties under a crop, as written on the harvesting tag (spec §9.1; owner Farm Operations).';
select app.register_table('public.ph_varieties', 'ph_master', true, p_default_policies => false);
create unique index ph_varieties_uq on public.ph_varieties (farm_id, crop_code, code) where voided_at is null;

create table public.ph_sources (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('own_farm', 'supplier')),
  code           text not null,
  name_ar        text not null,
  name_en        text,
  block_code     text,
  section_code   text,
  supplier_name  text,
  location_id    uuid references public.locations(id),
  search_text text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, '') || ' ' || coalesce(supplier_name, ''))) stored,
  check (kind <> 'own_farm' or (block_code is not null and section_code is not null)),
  check (kind <> 'supplier' or supplier_name is not null)
);
comment on table public.ph_sources is
  'Where incoming product comes from (FR-MD-05): own-farm block + section, or an external supplier. Own and supplier crop '
  'are reported separately (SOP-SR). The real block/section list is not in the supplied documents (NYV); none is seeded.';
select app.register_table('public.ph_sources', 'ph_master', true, p_default_policies => false);
create unique index ph_sources_uq on public.ph_sources (farm_id, code) where voided_at is null;

create table public.ph_locations (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  name_ar           text not null,
  name_en           text,
  purpose           text not null check (purpose in ('precooling', 'harvest_storage', 'fg_storage', 'sorting', 'line', 'waste_area', 'loading_bay', 'other')),
  capacity_pallets  integer check (capacity_pallets is null or capacity_pallets > 0),
  storage_group_id  uuid references public.ph_storage_groups(id),
  sort_order        integer not null default 0,
  search_text text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.ph_locations is
  'Packing-house locations (FR-MD-02): pre-cooling, Harvest Fridge, Fridges 1–7, sorting area, waste area, loading bays, '
  'with pallet capacity and the current storage group (set by PHM, FR-ST-06). Occupancy is computed from stock moves.';
select app.register_table('public.ph_locations', 'ph_master', true, p_default_policies => false);
create unique index ph_locations_uq on public.ph_locations (farm_id, code) where voided_at is null;

create table public.ph_lines (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  name_ar       text not null,
  name_en       text,
  kind          text not null check (kind in ('washer', 'machine_grading', 'manual')),
  nominal_rate  text,
  rate_evidence text not null default 'NYV' check (rate_evidence in ('C', 'P', 'NYV')),
  crop_codes    text[] not null default '{}',
  sort_order    integer not null default 0
);
comment on table public.ph_lines is
  'Production lines and the washer-dryer (Figure 4.2, SUM-1/2): Line A ELIFAB, Line B Aweta, Line C manual. Rates are '
  'running rates as documented, kept as text with their evidence label (punnet filling: TBC, OD-40). Used from M2.';
select app.register_table('public.ph_lines', 'ph_master', true, p_default_policies => false);
create unique index ph_lines_uq on public.ph_lines (farm_id, code) where voided_at is null;

create table public.ph_equipment (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  name_ar            text not null,
  name_en            text,
  kind               text not null check (kind in ('scale', 'thermometer', 'printer', 'scanner', 'other')),
  location_id        uuid references public.ph_locations(id),
  calibration_due_on date,
  search_text text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.ph_equipment is
  'Scales, thermometers, printers (FR-MD-06). A weight recorded with a scale whose calibration is overdue (or unknown) is '
  'flagged for QA review; it is never blocked.';
select app.register_table('public.ph_equipment', 'ph_master', true, p_default_policies => false);
create unique index ph_equipment_uq on public.ph_equipment (farm_id, code) where voided_at is null;

do $$
declare t text;
begin
  foreach t in array array['ph_storage_groups', 'ph_crops', 'ph_varieties', 'ph_sources', 'ph_locations', 'ph_lines', 'ph_equipment'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.is_farm_member(farm_id))', t || '_select', t);
  end loop;
end $$;

-- Which matrix action governs maker and checker for each master table (spec §6.3 "Master data" rows).
create function app.ph_master_area(p_table text) returns text
language sql immutable
as $$
  select case p_table
    when 'ph_storage_groups' then 'md_quality'
    when 'ph_crops' then 'md_operational'
    when 'ph_varieties' then 'md_operational'
    when 'ph_sources' then 'md_operational'
    when 'ph_locations' then 'md_operational'
    when 'ph_lines' then 'md_operational'
    when 'ph_equipment' then 'md_operational'
  end
$$;

-- Maker: create or change a master record. A change to an approved crop creates a new version (FR-MD-01); a change to any
-- other approved record sends it back for approval. Only listed columns can be written.
create function public.ph_save_master(p_table text, p_id uuid, p_values jsonb, p_farm uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_area  text := app.ph_master_area(p_table);
  v_cols  text[] := case p_table
    when 'ph_storage_groups' then array['code', 'name_ar', 'name_en']
    when 'ph_crops' then array['code', 'name_ar', 'name_en', 'storage_group_id', 'doc_temp_min_c', 'doc_temp_max_c', 'doc_temp_note',
                               'boxes_per_pallet', 'nominal_kg_per_pallet', 'washer_route', 'allowed_lines']
    when 'ph_varieties' then array['crop_code', 'code', 'name_ar', 'name_en']
    when 'ph_sources' then array['kind', 'code', 'name_ar', 'name_en', 'block_code', 'section_code', 'supplier_name']
    when 'ph_locations' then array['code', 'name_ar', 'name_en', 'purpose', 'capacity_pallets', 'sort_order']
    when 'ph_lines' then array['code', 'name_ar', 'name_en', 'kind', 'nominal_rate', 'crop_codes']
    when 'ph_equipment' then array['code', 'name_ar', 'name_en', 'kind', 'location_id', 'calibration_due_on']
  end;
  rec     jsonb;
  v_farm  uuid;
  v_new   uuid;
  v_key   text;
  v_sets  text := '';
  v_occ   integer;
  v_ins   text[];
begin
  if v_area is null then
    raise exception 'Unknown packing-house master table %', p_table using errcode = 'P0422';
  end if;
  if exists (select 1 from jsonb_object_keys(p_values) k where k <> all (v_cols)) then
    raise exception 'Only these fields can be set: %', array_to_string(v_cols, ', ') using errcode = 'P0422';
  end if;

  if p_id is null then
    v_farm := coalesce(p_farm, (select farm_id from public.user_roles where user_id = app.current_user_id() and voided_at is null limit 1));
    perform app.ph_authorize(v_farm, v_area || '.edit');
    v_ins := array(select jsonb_object_keys(p_values)) || array['id', 'farm_id', 'verification_status'];
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
                   p_table, (select string_agg(quote_ident(c), ', ') from unnest(v_ins) c),
                   (select string_agg(quote_ident(c), ', ') from unnest(v_ins) c), p_table)
      into v_new using p_values || jsonb_build_object('id', gen_random_uuid(), 'farm_id', v_farm, 'verification_status', 'not_yet_verified');
    return jsonb_build_object('id', v_new, 'created', true);
  end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1 and voided_at is null for update', p_table) into rec using p_id;
  if rec is null or not app.is_farm_member((rec ->> 'farm_id')::uuid) then
    raise exception 'Record not found' using errcode = 'P0404';
  end if;
  v_farm := (rec ->> 'farm_id')::uuid;
  perform app.ph_authorize(v_farm, v_area || '.edit');

  if p_table = 'ph_crops' and rec ->> 'verification_status' = 'verified' then
    if (rec ->> 'superseded_at') is not null then
      raise exception 'This crop version is superseded; change the current version' using errcode = 'P0422';
    end if;
    v_ins := v_cols || array['id', 'farm_id', 'version_no', 'verification_status', 'decision_code'];
    execute format('insert into public.ph_crops (%s) select %s from jsonb_populate_record(null::public.ph_crops, $1) returning id',
                   (select string_agg(quote_ident(c), ', ') from unnest(v_ins) c), (select string_agg(quote_ident(c), ', ') from unnest(v_ins) c))
      into v_new using rec || p_values || jsonb_build_object('id', gen_random_uuid(),
           'version_no', (select max(version_no) + 1 from public.ph_crops where farm_id = v_farm and code = rec ->> 'code'),
           'verification_status', 'not_yet_verified');
    return jsonb_build_object('id', v_new, 'new_version', true);
  end if;

  if p_table = 'ph_locations' and p_values ? 'capacity_pallets' and (p_values ->> 'capacity_pallets') is not null then
    select count(*) into v_occ from public.ph_incoming_pallets where location_id = p_id and status in ('pre_cooling', 'accepted', 'stored', 'on_hold', 'released');
    if v_occ > (p_values ->> 'capacity_pallets')::int then
      raise exception 'Capacity % is below the current occupancy (% pallets)', p_values ->> 'capacity_pallets', v_occ using errcode = 'P0422';
    end if;
  end if;

  foreach v_key in array array(select jsonb_object_keys(p_values)) loop
    v_sets := v_sets || format('%1$I = (jsonb_populate_record(null::public.%2$I, $1)).%1$I, ', v_key, p_table);
  end loop;
  perform set_config('app.in_verify', 'on', true);
  execute format('update public.%I set %s verification_status = ''not_yet_verified'', verified_by = null, verified_at = null '
                 'where id = $2', p_table, v_sets) using p_values, p_id;
  perform set_config('app.in_verify', 'off', true);
  return jsonb_build_object('id', p_id, 'updated', true);
end;
$$;

-- Checker: approve a master record (SoD-07: not the person who created or last changed it).
create function public.ph_approve_master(p_table text, p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_area  text := app.ph_master_area(p_table);
  v_uid   uuid := app.current_user_id();
  rec     jsonb;
  v_farm  uuid;
begin
  if v_area is null then
    raise exception 'Unknown packing-house master table %', p_table using errcode = 'P0422';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'An approval note (what was checked, against what) is required' using errcode = 'P0422';
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 and voided_at is null for update', p_table) into rec using p_id;
  if rec is null or not app.is_farm_member((rec ->> 'farm_id')::uuid) then
    raise exception 'Record not found' using errcode = 'P0404';
  end if;
  v_farm := (rec ->> 'farm_id')::uuid;
  perform app.ph_authorize(v_farm, v_area || '.approve');
  if (rec ->> 'created_by')::uuid = v_uid or (rec ->> 'updated_by')::uuid = v_uid then
    raise exception 'Segregation of duties (SoD-07): the person who entered this record cannot approve it'
      using errcode = 'P0423', detail = jsonb_build_object('key', 'ph.sod', 'column', 'maker')::text;
  end if;
  if rec ->> 'verification_status' = 'verified' then
    raise exception 'Already approved' using errcode = 'P0422';
  end if;
  if (rec ->> 'decision_code') is not null then
    perform app.ph_decision_gate(v_farm, rec ->> 'decision_code');
  end if;

  perform set_config('app.in_verify', 'on', true);
  perform set_config('app.audit_comment', p_note, true);
  execute format('update public.%I set verification_status = ''verified'', verified_by = $1, verified_at = now(), '
                 'source_note = $2 where id = $3', p_table) using v_uid, p_note, p_id;
  if p_table = 'ph_crops' then
    update public.ph_crops set superseded_at = now()
     where farm_id = v_farm and code = rec ->> 'code' and id <> p_id and superseded_at is null and verification_status = 'verified';
  end if;
  perform set_config('app.in_verify', 'off', true);
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('id', p_id, 'approved', true);
end;
$$;

-- The approved, current crop version for a code (records reference the row they used).
create function app.ph_current_crop(p_farm uuid, p_code text) returns uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select id from public.ph_crops
   where farm_id = p_farm and code = p_code and verification_status = 'verified' and superseded_at is null and voided_at is null
   order by version_no desc limit 1
$$;

-- ---------------------------------------------------------------------------------------------
-- SOP / Summary reference values, loaded only by an explicit owner action, as Not Yet Verified records.
-- ---------------------------------------------------------------------------------------------
create function app.ph_load_sop_reference(p_farm uuid) returns void
language plpgsql
as $$
begin
  if exists (select 1 from public.ph_crops where farm_id = p_farm) then
    raise notice 'Packing-house reference data already present; skipping.';
    return;
  end if;

  insert into public.ph_storage_groups (farm_id, code, name_ar, name_en, evidence, source_note)
  values
    (p_farm, 'tomato_cherry', 'طماطم وشيري', 'Tomato & cherry', 'C', 'SOP-PC storage groups (EV-21)'),
    (p_farm, 'mini_cucumber', 'خيار صغير', 'Mini cucumber', 'C', 'SOP-PC storage groups (EV-21)'),
    (p_farm, 'pepper_sweetbite', 'فلفل وسويت بايت', 'Pepper & sweet bite', 'C', 'SOP-PC storage groups (EV-21)'),
    (p_farm, 'eggplant', 'باذنجان', 'Eggplant', 'C', 'SOP-PC storage groups (EV-21)'),
    (p_farm, 'mango', 'مانجو', 'Mango', 'C', 'SOP-PC storage groups (EV-21)'),
    (p_farm, 'onion', 'بصل', 'Onion', 'C', 'Spec §9.1 "(+ onion)"; SOP-PC temperature table');

  -- Crops on the documented routes (Figure 4.2). Temperatures: SOP-PC documented ranges (EV-22), a reference only.
  insert into public.ph_crops (farm_id, code, name_ar, name_en, storage_group_id, doc_temp_min_c, doc_temp_max_c, doc_temp_note,
                               boxes_per_pallet, nominal_kg_per_pallet, washer_route, allowed_lines, decision_code, source_note)
  select p_farm, c.code, c.ar, c.en, (select id from public.ph_storage_groups g where g.farm_id = p_farm and g.code = c.grp),
         c.tmin, c.tmax, c.tnote, c.boxes, c.kg, c.washer, c.lines, c.od, c.src
    from (values
      ('cherry_tomato', 'طماطم شيري', 'Cherry tomato', 'tomato_cherry', 10.0, 12.0, 'SOP-PC: tomato 10–12 °C', 70, 400.00, 'yes', '{A}'::text[], null::text,
       'Route Line A ELIFAB (Figure 4.2, SUM-1); 70 boxes/pallet (FCT); nominal 400 kg recomputed from FCT (EV-31, OD-29)'),
      ('regular_tomato', 'طماطم عادية', 'Regular tomato', 'tomato_cherry', 10.0, 12.0, 'SOP-PC: tomato 10–12 °C', 35, 700.00, 'yes', '{B}',
       null, 'Route Line B Aweta (Figure 4.2); 35 boxes (FCT); nominal 700 kg recomputed (EV-31, OD-29)'),
      ('blocky', 'بلوكي', 'Blocky', null, null, null, 'Pepper or tomato type not confirmed (EV-29)', 35, null, 'yes', '{B}',
       'OD-30', 'Crop identity open (EV-29, OD-30): storage group and temperature unknown'),
      ('sweetbite', 'سويت بايت', 'Sweetbite', 'pepper_sweetbite', null, null, 'Not in the SOP temperature table', 35, 350.00, 'yes', '{C}',
       null, 'Route washer → Line C manual (Figure 4.2); group pepper & sweet bite (SOP-PC); nominal 350 kg recomputed (EV-31, OD-29)'),
      ('eggplant', 'باذنجان', 'Eggplant', 'eggplant', 10.0, 12.0, 'SOP-PC: eggplant 10–12 °C', 35, 450.00, 'no', '{C}',
       null, 'Route Line C manual, not washed (Figure 4.2); nominal 450 kg recomputed (EV-31, OD-29)'),
      ('mini_cucumber', 'خيار صغير', 'Mini cucumber', 'mini_cucumber', 10.0, 12.0, 'SOP-PC: mini cucumber 10–12 °C', 35, 450.00, 'no', '{C}',
       null, 'Route Line C manual, not washed (Figure 4.2); nominal 450 kg recomputed (EV-31, OD-29)'),
      ('watermelon', 'بطيخ', 'Watermelon', null, null, null, 'Not in the SOP temperature table; storage group not stated', null, null, 'no', '{C}',
       null, 'Route Line C manual, not washed (Figure 4.2); group, boxes and weight not documented')
    ) as c(code, ar, en, grp, tmin, tmax, tnote, boxes, kg, washer, lines, od, src);

  insert into public.ph_locations (farm_id, code, name_ar, name_en, purpose, capacity_pallets, sort_order, source_note)
  values
    (p_farm, 'PRECOOL', 'التبريد الأولي', 'Pre-cooling', 'precooling', 16, 1, 'SUM-2; SOP-PC: 16 pallets'),
    (p_farm, 'HF', 'ثلاجة الحصاد', 'Harvest Fridge', 'harvest_storage', 64, 2, 'FCT; SUM-2: 64 pallets, FIFO to production'),
    (p_farm, 'F1', 'ثلاجة 1', 'Fridge 1', 'fg_storage', 60, 11, 'FCT; SOP-PC: F1–4 finished goods / dispatch, 60 pallets each'),
    (p_farm, 'F2', 'ثلاجة 2', 'Fridge 2', 'fg_storage', 60, 12, 'FCT; SOP-PC'),
    (p_farm, 'F3', 'ثلاجة 3', 'Fridge 3', 'fg_storage', 60, 13, 'FCT; SOP-PC'),
    (p_farm, 'F4', 'ثلاجة 4', 'Fridge 4', 'fg_storage', 60, 14, 'FCT; SOP-PC'),
    (p_farm, 'F5', 'ثلاجة 5', 'Fridge 5', 'harvest_storage', 60, 15, 'FCT; SOP-PC: F5–7 harvest goods not graded the same day'),
    (p_farm, 'F6', 'ثلاجة 6', 'Fridge 6', 'harvest_storage', 60, 16, 'FCT; SOP-PC'),
    (p_farm, 'F7', 'ثلاجة 7', 'Fridge 7', 'harvest_storage', 60, 17, 'FCT; SOP-PC'),
    (p_farm, 'SORT', 'منطقة الفرز', 'Sorting area', 'sorting', null, 20, 'SUM-1: QC-1 in the sorting area; capacity not stated'),
    (p_farm, 'WASTE', 'منطقة الهدر', 'Waste area', 'waste_area', null, 30, 'SOP-WS; capacity not stated'),
    (p_farm, 'LOADING', 'منطقة التحميل', 'Loading bay', 'loading_bay', null, 40, 'SOP-DS; number of bays not stated');

  insert into public.ph_lines (farm_id, code, name_ar, name_en, kind, nominal_rate, rate_evidence, crop_codes, sort_order, source_note)
  values
    (p_farm, 'WASHER', 'غسالة ومجفف (Ingro)', 'Washer-dryer (Ingro)', 'washer', 'Throughput not stated', 'NYV',
     '{cherry_tomato,regular_tomato,blocky,sweetbite}', 1, 'SUM-2: washes Sweetbite, Cherry, Blocky, Regular tomato; feeds Lines A–C'),
    (p_farm, 'A', 'الخط A (ELIFAB)', 'Line A (ELIFAB)', 'machine_grading', 'Grading 1.2 t/h (cherry only); punnet filling TBC (OD-40)', 'C',
     '{cherry_tomato}', 2, 'SUM-2'),
    (p_farm, 'B', 'الخط B (Aweta)', 'Line B (Aweta)', 'machine_grading', '2.2 t/h per product (meaning of "per product" to confirm)', 'C',
     '{regular_tomato,blocky}', 3, 'SUM-2'),
    (p_farm, 'C', 'الخط C (يدوي)', 'Line C (manual)', 'manual', 'Labour targets 40–210 kg/h/worker by category', 'C',
     '{sweetbite,eggplant,watermelon,mini_cucumber}', 4, 'SUM-2; Figure 4.2');

  insert into public.ph_equipment (farm_id, code, name_ar, name_en, kind, calibration_due_on, source_note)
  values
    (p_farm, 'SCALE-R1', 'ميزان الاستلام 1', 'Receiving scale 1', 'scale', null, 'SUM-1: 3 gates, 3 scales — identifiers temporary, calibration date unknown'),
    (p_farm, 'SCALE-R2', 'ميزان الاستلام 2', 'Receiving scale 2', 'scale', null, 'SUM-1: 3 gates, 3 scales — identifiers temporary, calibration date unknown'),
    (p_farm, 'SCALE-R3', 'ميزان الاستلام 3', 'Receiving scale 3', 'scale', null, 'SUM-1: 3 gates, 3 scales — identifiers temporary, calibration date unknown');
end;
$$;
comment on function app.ph_load_sop_reference is
  'Loads the packing-house values documented in SOP001 / Summary Rev 2.2 / the fridge capacity table as Not Yet Verified '
  'master records with their source. Owner action only (Master Prompt §5.3); every record still needs approval.';
revoke all on function app.ph_load_sop_reference(uuid) from public;

select app.apply_api_grants();
