-- Packing house receiving (M1): ST-01…ST-07 through the API as each role. Acceptance scenarios T-02…T-07 plus G1–G4,
-- SoD-01/02/05, holds (SM-NC), void (FR-RC-06), labels (AT-07), photo evidence (V-23, AT-05), RLS and audit.
-- Every transition has an allowed and a forbidden case.
begin;
select no_plan();

create function tests.ph_user(p_name text, p_codes text[]) returns uuid
language plpgsql as $$
declare v uuid; c text;
begin
  v := tests.create_user(p_name);
  foreach c in array p_codes loop perform tests.grant_role(v, 'ph_' || lower(c)); end loop;
  return v;
end $$;
create function tests.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;
create function tests.ph_decide(p_code text, p_option text, p_activate text[], p_users uuid[]) returns text
language plpgsql as $$
declare u uuid; v jsonb;
begin
  foreach u in array p_users loop
    perform tests.as_user(u);
    v := public.ph_record_decision(p_code, p_option, 'Test decision', p_activate);
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return v ->> 'status';
end $$;
create function tests.ph_id(p_table text, p_code text) returns uuid language plpgsql as $$
declare v uuid;
begin
  execute format('select id from public.%I where farm_id = tests.farm() and code = $1', p_table) into v using p_code;
  return v;
end $$;
create function tests.ph_status(p_code text) returns text language sql as $$
  select status from public.ph_incoming_pallets where farm_id = tests.farm() and code = p_code $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- People (one per role, plus people holding two roles for the segregation-of-duties tests)
select tests.ph_user('r_phm', array['PHM']) as phm \gset
select tests.ph_user('r_whm', array['WHM']) as whm \gset
select tests.ph_user('r_dec', array['DEC']) as dec \gset
select tests.ph_user('r_qci', array['QCI']) as qci \gset
select tests.ph_user('r_qcm', array['QCM']) as qcm \gset
select tests.ph_user('r_qao', array['QAO']) as qao \gset
select tests.ph_user('r_qam', array['QAM']) as qam \gset
select tests.ph_user('r_pho', array['PHO']) as pho \gset
select tests.ph_user('r_eng', array['ENG']) as eng \gset
select tests.ph_user('r_top', array['TOP']) as top \gset
select tests.ph_user('r_adm', array['ADM']) as adm \gset
select tests.ph_user('r_dec_qao', array['DEC', 'QAO']) as decqao \gset
select tests.ph_user('r_eng_qci', array['ENG', 'QCI']) as engqci \gset
select tests.ph_user('r_dec_whm', array['DEC', 'WHM']) as decwhm \gset
select tests.create_user('outsider') as outsider \gset
select tests.grant_role(:'outsider', 'supervisor', 'agriculture');

-- The owner puts the spec's proposals in effect for this test farm (the default on a real farm is off; 14_ph_config tests that).
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

-- ---------------------------------------------------------------------------------------------
-- Master data: owner import of the documented values, then maker-checker approval.
select app.ph_load_sop_reference(tests.farm());
select is((select count(*)::int from public.ph_crops where farm_id = tests.farm() and verification_status = 'verified'), 0,
  'imported reference data is Not Yet Verified');
select tests.as_user(:'phm');
select lives_ok(format($$ select public.ph_approve_master('ph_crops', %L, 'Checked against SUM-2 and FCT') $$,
  (select id from public.ph_crops where farm_id = tests.farm() and code = 'cherry_tomato')), 'PHM approves a crop (checker)');
select lives_ok(format($$ select public.ph_approve_master('ph_crops', %L, 'Checked') $$,
  (select id from public.ph_crops where farm_id = tests.farm() and code = 'eggplant')), 'PHM approves eggplant');
select throws_ok(format($$ select public.ph_approve_master('ph_crops', %L, 'Checked') $$,
  (select id from public.ph_crops where farm_id = tests.farm() and code = 'blocky')), 'P0428', null,
  'Blocky cannot be approved while OD-30 is open');
select lives_ok($$ select public.ph_approve_master('ph_locations', id, 'Capacity per FCT') from public.ph_locations where farm_id = tests.farm() $$,
  'PHM approves the locations');
select lives_ok($$ select public.ph_approve_master('ph_equipment', id, 'Scale present on the floor') from public.ph_equipment where farm_id = tests.farm() $$,
  'PHM approves the scales');
select throws_ok(format($$ select public.ph_approve_master('ph_storage_groups', %L, 'x') $$,
  (select id from public.ph_storage_groups where farm_id = tests.farm() and code = 'tomato_cherry')), 'P0403', null,
  'storage groups are quality master data: the PHM cannot approve them');
select tests.as_user(:'qam');
select lives_ok($$ select public.ph_approve_master('ph_storage_groups', id, 'SOP-PC groups') from public.ph_storage_groups where farm_id = tests.farm() $$,
  'QAM approves the storage groups');
select tests.as_user(:'adm');
select lives_ok($$ select public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"B2S05","name_ar":"قطعة 2 قسم 5","block_code":"2","section_code":"5"}') $$,
  'ADM enters a source (maker)');
select lives_ok($$ select public.ph_save_master('ph_sources', null, '{"kind":"supplier","code":"SUP1","name_ar":"مورد اختبار","supplier_name":"Test supplier"}') $$,
  'ADM enters a supplier source');
select lives_ok($$ select public.ph_save_master('ph_varieties', null, '{"crop_code":"cherry_tomato","code":"V1","name_ar":"صنف اختبار"}') $$,
  'ADM enters a variety');
select throws_ok($$ select public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"X","name_ar":"x","block_code":"1","section_code":"1","verification_status":"verified"}') $$,
  'P0422', null, 'the maker cannot set approval fields');
select throws_ok(format($$ select public.ph_approve_master('ph_sources', %L, 'own entry') $$, tests.ph_id('ph_sources', 'B2S05')), 'P0403', null,
  'ADM has no checker cell');
select tests.as_user(:'phm');
select lives_ok($$ select public.ph_approve_master('ph_sources', id, 'Block/section confirmed') from public.ph_sources where farm_id = tests.farm() $$,
  'PHM approves sources');
select lives_ok($$ select public.ph_approve_master('ph_varieties', id, 'Variety on the tag') from public.ph_varieties where farm_id = tests.farm() $$,
  'PHM approves the variety');
-- Version on change (FR-MD-01): earlier records keep the old version.
select tests.as_user(:'adm');
select is(public.ph_save_master('ph_crops', (select id from public.ph_crops where farm_id = tests.farm() and code = 'eggplant'),
  '{"boxes_per_pallet": 36}') ->> 'new_version', 'true', 'changing an approved crop creates a new version');
select tests.as_user(:'phm');
select is((select count(*)::int from public.ph_crops where farm_id = tests.farm() and code = 'eggplant' and verification_status = 'verified'
            and superseded_at is null), 1, 'until approved, the old version stays current');
select tests.as_user(:'adm');
select throws_ok(format($$ select public.ph_approve_master('ph_crops', %L, 'mine') $$,
  (select id from public.ph_crops where farm_id = tests.farm() and code = 'eggplant' and version_no = 2)), 'P0403', null, 'the maker cannot approve');
reset role;
select set_config('request.jwt.claims', '', true);

-- PHM assigns fridge storage groups (FR-ST-06).
select tests.as_user(:'phm');
select lives_ok(format($$ select public.ph_set_location_group(%L, %L) $$, tests.ph_id('ph_locations', 'HF'), tests.ph_id('ph_storage_groups', 'tomato_cherry')),
  'PHM sets the Harvest Fridge group to tomato & cherry');
select lives_ok(format($$ select public.ph_set_location_group(%L, %L) $$, tests.ph_id('ph_locations', 'F5'), tests.ph_id('ph_storage_groups', 'eggplant')),
  'PHM sets Fridge 5 to eggplant');
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_set_location_group(%L, null) $$, tests.ph_id('ph_locations', 'F6')), 'P0403', null,
  'an operator cannot change a fridge group');

-- ---------------------------------------------------------------------------------------------
-- ST-01 Arrival & G1
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_create_arrival(jsonb_build_object('source_id', %L, 'vehicle_plate', '10-1', 'driver_name', 'D',
    'harvest_date', current_date, 'harvest_time', '08:00', 'harvest_supervisor', 'S', 'late_reason', 'test')) $$, tests.ph_id('ph_sources', 'B2S05')),
  'P0422', null, 'V-01 / E-01: an own-farm arrival needs every tag field (variety missing)');
select is(public.ph_create_arrival(jsonb_build_object('source_id', tests.ph_id('ph_sources', 'B2S05'), 'variety_id',
    (select id from public.ph_varieties where farm_id = tests.farm() and code = 'V1'), 'vehicle_plate', '10-1', 'driver_name', 'D', 'harvest_date', current_date,
    'harvest_time', '06:30', 'harvest_supervisor', 'Tag supervisor', 'late_reason', 'test run')) ->> 'code' like 'ARR-%', true, 'DEC creates an arrival');
select (select id from public.ph_arrivals where farm_id = tests.farm() order by created_at desc limit 1) as arr1 \gset
select is((select status from public.ph_arrivals where id = :'arr1'), 'draft', 'arrival starts as draft');
reset role;
update public.ph_rule_parameters set value_text = '00:00' where farm_id = tests.farm() and code = 'last_harvest_receipt_time';
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_create_arrival(jsonb_build_object('source_id', %L, 'supplier_ref', 'DN-1', 'vehicle_plate', '1', 'driver_name', 'D')) $$,
  tests.ph_id('ph_sources', 'SUP1')), 'P0422', null, 'V-03: an arrival after the last-harvest time needs a reason');
select is((public.ph_create_arrival(jsonb_build_object('source_id', tests.ph_id('ph_sources', 'SUP1'), 'supplier_ref', 'DN-1', 'vehicle_plate', '20-2',
  'driver_name', 'D2', 'late_reason', 'Truck delayed'))) ->> 'late', 'true', 'late arrival flagged with its reason');
reset role;
update public.ph_rule_parameters set value_text = '17:00' where farm_id = tests.farm() and code = 'last_harvest_receipt_time';

select tests.as_user(:'qao');
select throws_ok(format($$ select public.ph_record_vehicle_inspection(%L, 'pass', '{}') $$, :'arr1'), 'P0403', null,
  'vehicle inspection recorder is pending OD-38: refused');
reset role;
select is(tests.ph_decide('OD-38', 'Data Entry Clerk inspects incoming vehicles', array['DEC'], array[:'top', :'phm', :'qam']::uuid[]), 'decided', 'OD-38 decided');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_submit_arrival(%L) $$, :'arr1'), 'P0422', null, 'G1: cannot pass the gate before the vehicle check');
select lives_ok(format($$ select public.ph_record_vehicle_inspection(%L, 'pass', '{"transport_conditions":"ok"}') $$, :'arr1'), 'DEC records vehicle pass');
select is(public.ph_submit_arrival(:'arr1') ->> 'to_status', 'submitted', 'arrival passes G1');
select is((select submitted_by from public.ph_arrivals where id = :'arr1'), :'dec'::uuid, 'who passed the gate is recorded');

-- T-05 Non-compliant incoming vehicle: three approvals, or one refusal.
select (public.ph_create_arrival(jsonb_build_object('source_id', tests.ph_id('ph_sources', 'SUP1'), 'supplier_ref', 'DN-2', 'vehicle_plate', '30-3',
  'driver_name', 'D3', 'late_reason', 'n/a')) ->> 'id') as arr2 \gset
select lives_ok(format($$ select public.ph_record_vehicle_inspection(%L, 'fail', '{"transport_conditions":"dirty"}', 'Dirty floor') $$, :'arr2'),
  'vehicle fails the inspection');
select is((select status from public.ph_arrivals where id = :'arr2'), 'vehicle_hold', 'arrival on hold — vehicle');
select throws_ok(format($$ select public.ph_submit_arrival(%L) $$, :'arr2'), 'P0422', null, 'a held arrival cannot pass G1');
select throws_ok(format($$ select public.ph_vehicle_exception_decide(%L, 'approve', 'ok') $$, :'arr2'), 'P0403', null, 'DEC cannot approve the exception');
select tests.as_user(:'phm');
select is(public.ph_vehicle_exception_decide(:'arr2', 'approve', 'Pre-approved by phone') ->> 'state', 'partial', 'PHM approves (1 of 3)');
select throws_ok(format($$ select public.ph_vehicle_exception_decide(%L, 'approve', 'again') $$, :'arr2'), 'P0423', null, 'the same person cannot sign twice');
select tests.as_user(:'qam');
select is(public.ph_vehicle_exception_decide(:'arr2', 'approve', 'QA agrees') ->> 'state', 'partial', 'QA approves (2 of 3)');
select tests.as_user(:'top');
select is(public.ph_vehicle_exception_decide(:'arr2', 'approve', 'Top management agrees') ->> 'state', 'approved', 'top management approves (3 of 3)');
select is((select status from public.ph_arrivals where id = :'arr2'), 'draft', 'exception approved: arrival back to draft');
select tests.as_user(:'dec');
select is(public.ph_submit_arrival(:'arr2') ->> 'to_status', 'submitted', 'arrival with an approved exception passes G1');
select (public.ph_create_arrival(jsonb_build_object('source_id', tests.ph_id('ph_sources', 'SUP1'), 'supplier_ref', 'DN-3', 'vehicle_plate', '40-4',
  'driver_name', 'D4', 'late_reason', 'n/a')) ->> 'id') as arr3 \gset
select lives_ok(format($$ select public.ph_record_vehicle_inspection(%L, 'fail', '{}', 'Not lockable') $$, :'arr3'), 'second vehicle fails');
select tests.as_user(:'phm');
select is(public.ph_vehicle_exception_decide(:'arr3', 'refuse', 'Not acceptable') ->> 'state', 'refused', 'one refusal');
select is((select status from public.ph_arrivals where id = :'arr3'), 'not_accepted', 'refusal closes the arrival as Not accepted');

-- ---------------------------------------------------------------------------------------------
-- ST-02 Registration (gated by OD-01 / OD-03)
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_register_pallet(%L, jsonb_build_object('net_kg', 400, 'scale_id', %L)) $$,
  :'arr1', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0428', null, 'registration before QA acceptance is blocked while OD-01 is open');
reset role;
select is(tests.ph_decide('OD-01', 'B', '{}', array[:'phm', :'whm', :'qam']::uuid[]), 'decided', 'OD-01 decided: option B');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_register_pallet(%L, jsonb_build_object('net_kg', 400, 'scale_id', %L)) $$,
  :'arr1', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0428', null, 'still blocked: who issues pallet IDs is OD-03');
reset role;
select is(tests.ph_decide('OD-03', 'A', '{}', array[:'phm', :'whm', :'adm']::uuid[]), 'decided', 'OD-03 decided: option A');
select tests.as_user(:'qao');
select throws_ok(format($$ select public.ph_register_pallet(%L, jsonb_build_object('net_kg', 400, 'scale_id', %L)) $$,
  :'arr1', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0403', null, 'only DEC registers pallets');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_register_pallet(%L, jsonb_build_object('net_kg', 0, 'scale_id', %L)) $$,
  :'arr1', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0422', null, 'V-02: net weight must be > 0');
select throws_ok(format($$ select public.ph_register_pallet(%L, jsonb_build_object('net_kg', 400)) $$, :'arr1'), 'P0422', null, 'V-02: the scale is required');
select throws_ok(format($$ select public.ph_register_pallet(%L, jsonb_build_object('net_kg', 400, 'scale_id', %L)) $$,
  :'arr3', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0422', null, 'G1: no registration on a not-accepted arrival');
select throws_ok(format($$ select public.ph_register_pallet(%L, jsonb_build_object('net_kg', 400, 'scale_id', %L, 'crop_id', %L)) $$,
  :'arr1', tests.ph_id('ph_equipment', 'SCALE-R1'), (select id from public.ph_crops where farm_id = tests.farm() and code = 'watermelon')),
  'P0422', null, 'FR-MD-01: an unapproved crop cannot be received');
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 400, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1')))) as reg1 \gset
select is((:'reg1'::jsonb) ->> 'code', 'CHERRY_TOMATO-' || to_char(app.ph_local_date(), 'YYMMDD') || '-B2S05-001',
  'printed number per crop / source / day (SOP-RC)');
select is((:'reg1'::jsonb) -> 'warnings' -> 0 ->> 'key', 'ph.calibration', 'scale with unknown calibration flags the weight for QA (FR-MD-06)');
select (:'reg1'::jsonb ->> 'code') as ip1 \gset
select is(tests.ph_status(:'ip1'), 'registered', 'pallet registered');
select is((select box_count from public.ph_incoming_pallets where farm_id = tests.farm() and code = :'ip1'), 70, 'box count defaults from the crop (cherry 70)');
select is((select decision_basis ->> 'OD-01' from public.ph_incoming_pallets where farm_id = tests.farm() and code = :'ip1'), 'OD-01=B',
  'the record carries the decision it was created under');
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 396, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R2'))) ->> 'code') as ip2 \gset
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 402, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R2'))) ->> 'code') as ip3 \gset
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 380, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R2'))) ->> 'code') as ip4 \gset
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 390, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R2'))) ->> 'code') as ip5 \gset
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 410, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R2'))) ->> 'code') as ip6 \gset
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 405, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R3'),
  'crop_id', (select id from public.ph_crops where farm_id = tests.farm() and code = 'eggplant' and version_no = 1))) ->> 'code') as ipegg \gset
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 300, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R3'))) ->> 'code') as ipvoid \gset

-- The API cannot bypass the server functions.
select tests.login(:'qao');
select throws_ok(format($$ insert into public.ph_incoming_pallets (farm_id, code, arrival_id, crop_id, source_id, box_count, net_kg, weight_unit_id, scale_id)
  values (tests.farm(), 'X', %L, %L, %L, 1, 1, tests.unit('kg'), %L) $$, :'arr1', (select crop_id from public.ph_incoming_pallets where code = :'ip1'),
  tests.ph_id('ph_sources', 'B2S05'), tests.ph_id('ph_equipment', 'SCALE-R1')), '42501', null, 'no direct insert');
select throws_ok(format($$ update public.ph_incoming_pallets set net_kg = 1 where code = %L $$, :'ip1'), '42501', null, 'no direct update');
select throws_ok(format($$ select public.transition_record('ph_incoming_pallets', %L, 'pre_cooling') $$, tests.ph_id('ph_incoming_pallets', :'ip1')),
  'P0403', null, 'direct transition by a role without the cell is refused');
select tests.logout();
select tests.login(:'pho');
select throws_ok(format($$ select public.transition_record('ph_incoming_pallets', %L, 'pre_cooling') $$, tests.ph_id('ph_incoming_pallets', :'ip1')),
  'P0422', null, 'direct transition skipping the server function (and G2) is refused');
select tests.logout();

-- Weight edit before the QA decision (reason), labels (AT-07)
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_edit_pallet_weight(%L, 401, '') $$, tests.ph_id('ph_incoming_pallets', :'ip1')), 'P0422', null, 'weight edit needs a reason');
select lives_ok(format($$ select public.ph_edit_pallet_weight(%L, 400.5, 'Re-read the scale display') $$, tests.ph_id('ph_incoming_pallets', :'ip1')),
  'DEC corrects the weight before the QA decision');
select is((public.ph_print_label(tests.ph_id('ph_incoming_pallets', :'ip1'))) ->> 'pallet_no', :'ip1', 'receiving label printed with the pallet number');
select throws_ok(format($$ select public.ph_print_label(%L) $$, tests.ph_id('ph_incoming_pallets', :'ip1')), 'P0422', null, 'a reprint needs a reason');
select is((public.ph_print_label(tests.ph_id('ph_incoming_pallets', :'ip1'), 'Label torn')) ->> 'print_no', '2', 'reprint with reason');
select is((select count(*)::int from public.ph_label_prints where entity_id = tests.ph_id('ph_incoming_pallets', :'ip1') and is_reprint), 1,
  'the reprint is logged with its content');
reset role;
select throws_ok($$ update public.ph_label_prints set reason = 'x' $$, 'P0403', null, 'label log is append-only');

-- FR-RC-06 Void (DEC requests, WHM approves, maker ≠ checker)
select tests.as_user(:'dec');
select lives_ok(format($$ select public.ph_request_void(%L, 'Registered twice') $$, tests.ph_id('ph_incoming_pallets', :'ipvoid')), 'DEC requests a void');
select throws_ok(format($$ select public.ph_approve_void(%L, 'ok') $$, tests.ph_id('ph_incoming_pallets', :'ipvoid')), 'P0403', null, 'DEC cannot approve it');
select tests.as_user(:'whm');
select is(public.ph_approve_void(tests.ph_id('ph_incoming_pallets', :'ipvoid'), 'Duplicate confirmed') ->> 'to_status', 'void', 'WHM approves: Void');
select is((select count(*)::int from public.ph_incoming_pallets where farm_id = tests.farm() and code = :'ipvoid'), 1, 'the voided pallet keeps its ID (GEN-12)');
select tests.as_user(:'decwhm');
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 300, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R3'))) ->> 'code') as ipvoid2 \gset
select lives_ok(format($$ select public.ph_request_void(%L, 'Error') $$, tests.ph_id('ph_incoming_pallets', :'ipvoid2')), 'requested');
select throws_ok(format($$ select public.ph_approve_void(%L, 'self') $$, tests.ph_id('ph_incoming_pallets', :'ipvoid2')), 'P0423', null,
  'the requester cannot approve their own void even holding WHM');

-- ---------------------------------------------------------------------------------------------
-- ST-03 Arrival check (G2) — T-02
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_record_arrival_check(%L, '{}', jsonb_build_array(jsonb_build_object('pallet_id', %L, 'result', 'pass'))) $$,
  :'arr1', tests.ph_id('ph_incoming_pallets', :'ip1')), 'P0403', null, 'only QC/QA record the arrival check');
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_record_arrival_check(%L, '{}', jsonb_build_array(jsonb_build_object('pallet_id', %L, 'result', 'reject'))) $$,
  :'arr1', tests.ph_id('ph_incoming_pallets', :'ip2')), 'P0422', null, 'a rejected pallet needs a destination');
select is((public.ph_record_arrival_check(:'arr1', '{"insects":"none"}', jsonb_build_array(
    jsonb_build_object('pallet_id', tests.ph_id('ph_incoming_pallets', :'ip1'), 'result', 'pass'),
    jsonb_build_object('pallet_id', tests.ph_id('ph_incoming_pallets', :'ip2'), 'result', 'reject', 'destination', 'farm_or_supplier', 'remarks', 'Excessive waste'),
    jsonb_build_object('pallet_id', tests.ph_id('ph_incoming_pallets', :'ip3'), 'result', 'reject', 'destination', 'waste_area', 'remarks', 'Rotten'),
    jsonb_build_object('pallet_id', tests.ph_id('ph_incoming_pallets', :'ip4'), 'result', 'pass'),
    jsonb_build_object('pallet_id', tests.ph_id('ph_incoming_pallets', :'ip5'), 'result', 'pass'),
    jsonb_build_object('pallet_id', tests.ph_id('ph_incoming_pallets', :'ip6'), 'result', 'pass'),
    jsonb_build_object('pallet_id', tests.ph_id('ph_incoming_pallets', :'ipegg'), 'result', 'pass')), 6.5) ->> 'rejected')::int, 2,
  'QCI records G2 per pallet (5 pass, 2 reject)');
select is(tests.ph_status(:'ip2'), 'arrival_rejected', 'T-02: rejected pallet → Arrival rejected');
select ok(tests.notifications(:'phm', 'ph_arrival_rejected') >= 2, 'PHM notified of arrival rejections (E-03)');
select throws_ok(format($$ select public.ph_record_arrival_check(%L, '{}', jsonb_build_array(jsonb_build_object('pallet_id', %L, 'result', 'pass'))) $$,
  :'arr1', tests.ph_id('ph_incoming_pallets', :'ip1')), 'P0422', null, 'a pallet gets one arrival-check result');
select tests.as_user(:'dec');
select is(public.ph_record_disposition(tests.ph_id('ph_incoming_pallets', :'ip2'), 'Truck returned it') ->> 'to_status', 'returned_to_source',
  'T-02: disposition → Returned to source');
select is(public.ph_record_disposition(tests.ph_id('ph_incoming_pallets', :'ip3')) ->> 'to_status', 'waste', 'waste-area destination → Waste');
select isnt((select waste_record_id from public.ph_incoming_pallets where code = :'ip3'), null, 'rejected quantity stays in the chain: waste record (CP-01)');

-- ---------------------------------------------------------------------------------------------
-- ST-04 Pre-cooling
select tests.as_user(:'pho');
select is(public.ph_precool_scan(:'ip1', 'in') ->> 'status', 'pre_cooling', 'operator scans the pallet into pre-cooling');
select throws_ok(format($$ select public.ph_precool_scan(%L, 'in') $$, :'ip2'), 'P0422', null, 'a pallet without G2 pass cannot enter pre-cooling');
select throws_ok($$ select public.ph_precool_scan('NOPE-1', 'in') $$, 'P0404', null, 'unknown barcode → error, no move');
select tests.as_user(:'qao');
select throws_ok(format($$ select public.ph_precool_scan(%L, 'out') $$, :'ip1'), 'P0403', null, 'QA does not record pre-cooling');
reset role;
update public.ph_incoming_pallets set precool_in_at = now() - interval '35 minutes' where code = :'ip1';
select is((select dwell_exceeded from public.ph_ip_board where code = :'ip1'), true, 'V-04: dwell above 30 min shows on the board');
select tests.as_user(:'pho');
select is(public.ph_precool_scan(:'ip1', 'out') -> 'warnings' -> 0 ->> 'key', 'ph.v04', 'exit after 35 min warns (V-04)');
select is(tests.notifications(:'phm', 'ph_dwell_exceeded'), 1, 'E-05: PHM alerted');
select is(tests.ph_status(:'ip1'), 'awaiting_qa', 'pallet awaits QA acceptance');
select lives_ok($$ select public.ph_precool_scan(x, 'in'), public.ph_precool_scan(x, 'out')
                   from unnest(array[$$ || quote_literal(:'ip4') || ',' || quote_literal(:'ip5') || ',' || quote_literal(:'ip6') || ',' || quote_literal(:'ipegg') || $$]) x $$,
  'four more pallets through pre-cooling');

-- ---------------------------------------------------------------------------------------------
-- ST-05 QA acceptance (G3) with photo evidence (V-23); SoD-01; lot per OD-02
select tests.as_user(:'qao');
select (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'Sample, section 5') ->> 'id') as photo1 \gset
select is((select sha256 from public.ph_attachments where id = :'photo1') ~ '^[0-9a-f]{64}$', true, 'photo stored with its SHA-256 (AT-05)');
select throws_ok($$ select public.ph_upload_attachment('photo', 'text/html', 'PGgxPng8L2gxPg==') $$, 'P0422', null, 'only image/video/PDF types');
select throws_ok(format($$ select public.ph_submit_rma(array[%L]::uuid[], 'accept', '{}', 9, 'n=10', null, '{}') $$, tests.ph_id('ph_incoming_pallets', :'ip1')),
  'P0422', null, 'V-23: no photo, no RMA');
select throws_ok(format($$ select public.ph_submit_rma(array[%L, %L]::uuid[], 'accept', '{}', 9, null, null, array[%L]::uuid[]) $$,
  tests.ph_id('ph_incoming_pallets', :'ip1'), tests.ph_id('ph_incoming_pallets', :'ipegg'), :'photo1'), 'P0422', null,
  'one RMA covers one crop / source / day');
select is((public.ph_submit_rma(array[tests.ph_id('ph_incoming_pallets', :'ip1'), tests.ph_id('ph_incoming_pallets', :'ip4')], 'accept',
  '{"disease":"none","size":"ok"}', 9.5, 'Sample of 2 crates', null, array[:'photo1']::uuid[])) ->> 'no_tolerance_set', 'true',
  'QAO accepts — recorded as "no tolerance set" while OD-05 is open');
select is(tests.ph_status(:'ip1'), 'accepted', 'accepted into raw stock');
select is((select qa_decided_by from public.ph_incoming_pallets where code = :'ip1'), :'qao'::uuid, 'QA decision-maker recorded');
select is((select lot_id from public.ph_incoming_pallets where code = :'ip1'), null, 'no lot while OD-02 is open');
select is((select qam_review_flag from public.ph_inspections where id = (select rma_id from public.ph_incoming_pallets where code = :'ip1')), true,
  'RMA without a tolerance set is flagged for QAM');
select throws_ok(format($$ select public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgo=', null, 'user_profiles', %L) $$, :'qao'),
  'P0422', null, 'attachments only on packing-house records');
select is((public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgo=', 'Pallet tag', 'ph_incoming_pallets', tests.ph_id('ph_incoming_pallets', :'ip1'))) ->> 'size_bytes',
  '8', 'a photo can be attached to a pallet directly');
-- Co-signature (verify) by QC, not by the QAO who decided.
select throws_ok(format($$ select public.ph_cosign_rma(%L) $$, (select rma_id from public.ph_incoming_pallets where code = :'ip1')), 'P0403', null,
  'the QAO has no co-sign cell');
select tests.as_user(:'qci');
select is(public.ph_cosign_rma((select rma_id from public.ph_incoming_pallets where code = :'ip1'), 'Agree') ->> 'to_status', 'cosigned', 'QCI co-signs the RMA');
reset role;
select is(tests.ph_decide('OD-02', 'C', '{}', array[:'qam', :'phm']::uuid[]), 'decided', 'OD-02 decided: option C');
-- SoD-01: the registrar cannot record the QA acceptance (a person holding DEC and QAO).
select tests.as_user(:'decqao');
select (public.ph_register_pallet(:'arr1', jsonb_build_object('net_kg', 399, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code') as ipsod \gset
select tests.as_user(:'qci');
select lives_ok(format($$ select public.ph_record_arrival_check(%L, '{}', jsonb_build_array(jsonb_build_object('pallet_id', %L, 'result', 'pass'))) $$,
  :'arr1', tests.ph_id('ph_incoming_pallets', :'ipsod')), 'G2 pass');
select tests.as_user(:'pho');
select lives_ok(format($$ select public.ph_precool_scan(%L, 'in'), public.ph_precool_scan(%L, 'out') $$, :'ipsod', :'ipsod'), 'pre-cooled');
select tests.as_user(:'decqao');
select (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') ->> 'id') as photo2 \gset
select throws_ok(format($$ select public.ph_submit_rma(array[%L]::uuid[], 'accept', '{}', 9, null, null, array[%L]::uuid[]) $$,
  tests.ph_id('ph_incoming_pallets', :'ipsod'), :'photo2'), 'P0423', null, 'SoD-01: the person who registered the weight cannot accept it');
select tests.as_user(:'qao');
select (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') ->> 'id') as photo3 \gset
select is((public.ph_submit_rma(array[tests.ph_id('ph_incoming_pallets', :'ipsod')], 'accept', '{}', 9, null, null, array[:'photo3']::uuid[])) -> 'lots' ->> 0,
  'L-CHERRY_TOMATO-' || to_char(app.ph_local_date(), 'YYMMDD') || '-B2S05', 'another QAO accepts; lot = crop × source × harvest date (OD-02 C)');

-- T-03 QA reject → regrade → re-weigh → recheck by a different person → accepted
select (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') ->> 'id') as photo4 \gset
select throws_ok(format($$ select public.ph_submit_rma(array[%L]::uuid[], 'reject', '{}', 9, null, '', array[%L]::uuid[]) $$,
  tests.ph_id('ph_incoming_pallets', :'ip5'), :'photo4'), 'P0422', null, 'a rejection needs a reason');
select lives_ok(format($$ select public.ph_submit_rma(array[%L, %L]::uuid[], 'reject', '{"over_ripe":"high"}', 9, null, 'Over-ripe', array[%L]::uuid[]) $$,
  tests.ph_id('ph_incoming_pallets', :'ip5'), tests.ph_id('ph_incoming_pallets', :'ip6'), :'photo4'), 'QAO rejects two pallets');
select is(tests.ph_status(:'ip5'), 'qa_rejected', 'QA rejected');
select ok(tests.notifications(:'eng', 'ph_regrade_due') >= 2, 'engineer notified automatically (E-04)');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_start_regrade(%L) $$, tests.ph_id('ph_incoming_pallets', :'ip5')), 'P0403', null, 'only the engineer regrades');
select tests.as_user(:'engqci');
select is(public.ph_start_regrade(tests.ph_id('ph_incoming_pallets', :'ip5')) ->> 'to_status', 'in_regrade', 'engineer starts the regrade');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_reweigh(%L, 350, %L) $$, tests.ph_id('ph_incoming_pallets', :'ip5'), tests.ph_id('ph_equipment', 'SCALE-R1')),
  'P0422', null, 're-weigh only after the engineer marks the regrade complete');
select tests.as_user(:'eng');
select throws_ok(format($$ select public.ph_complete_regrade(%L) $$, tests.ph_id('ph_incoming_pallets', :'ip5')), 'P0403', null,
  'only the engineer who started it marks it complete');
select tests.as_user(:'engqci');
select lives_ok(format($$ select public.ph_complete_regrade(%L, 'Removed soft fruit') $$, tests.ph_id('ph_incoming_pallets', :'ip5')), 'regrade complete');
select tests.as_user(:'dec');
select is(public.ph_reweigh(tests.ph_id('ph_incoming_pallets', :'ip5'), 352.5, tests.ph_id('ph_equipment', 'SCALE-R1')) ->> 'net_kg', '352.5', 'DEC re-weighs');
select is((select pre_regrade_net_kg from public.ph_incoming_pallets where code = :'ip5'), 390.00::numeric, 'weight before regrade kept');
select tests.as_user(:'engqci');
select throws_ok(format($$ select public.ph_recheck(%L, 'accept', '{}') $$, tests.ph_id('ph_incoming_pallets', :'ip5')), 'P0423', null,
  'SoD-02: the engineer who regraded cannot recheck (even holding QCI)');
select tests.as_user(:'qci');
select lives_ok(format($$ select public.ph_recheck(%L, 'accept', '{"size":"ok"}') $$, tests.ph_id('ph_incoming_pallets', :'ip5')), 'a different QC recheck accepts');
select is(tests.ph_status(:'ip5'), 'accepted', 'T-03: accepted after regrade, new weight stored');
select isnt((select lot_id from public.ph_incoming_pallets where code = :'ip5'), null, 'lot assigned on acceptance after recheck');

-- T-04 second rejection → waste with a waste record; no third check
select tests.as_user(:'eng');
select lives_ok(format($$ select public.ph_start_regrade(%L), public.ph_complete_regrade(%L) $$, tests.ph_id('ph_incoming_pallets', :'ip6'),
  tests.ph_id('ph_incoming_pallets', :'ip6')), 'regrade of the second pallet');
select tests.as_user(:'dec');
select lives_ok(format($$ select public.ph_reweigh(%L, 300, %L) $$, tests.ph_id('ph_incoming_pallets', :'ip6'), tests.ph_id('ph_equipment', 'SCALE-R2')), 're-weighed');
select tests.as_user(:'qao');
select throws_ok(format($$ select public.ph_recheck(%L, 'reject', '{}') $$, tests.ph_id('ph_incoming_pallets', :'ip6')), 'P0422', null, 'rejection needs a reason');
select isnt(public.ph_recheck(tests.ph_id('ph_incoming_pallets', :'ip6'), 'reject', '{}', 'Still over-ripe') ->> 'waste_record_id', null,
  'second rejection creates a waste record automatically');
select is(tests.ph_status(:'ip6'), 'waste', 'T-04: second rejection → Waste');
select throws_ok(format($$ select public.ph_recheck(%L, 'accept', '{}') $$, tests.ph_id('ph_incoming_pallets', :'ip6')), 'P0422', null,
  'V-26: no third check');
select is((select status from public.ph_waste_records where id = (select waste_record_id from public.ph_incoming_pallets where code = :'ip6')), 'draft',
  'waste record waits as draft for the waste workflow (M2)');

-- ---------------------------------------------------------------------------------------------
-- ST-06 Storage (V-07 / V-08) — T-07
select tests.as_user(:'qao');
select (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') ->> 'id') as photo5 \gset
select lives_ok(format($$ select public.ph_submit_rma(array[%L]::uuid[], 'accept', '{}', 10, null, null, array[%L]::uuid[]) $$,
  tests.ph_id('ph_incoming_pallets', :'ipegg'), :'photo5'), 'eggplant accepted');
select tests.as_user(:'pho');
select is(public.ph_move_pallet(:'ip1', tests.ph_id('ph_locations', 'HF')) ->> 'location', 'HF', 'cherry tomato into the Harvest Fridge (group matches)');
select is(tests.ph_status(:'ip1'), 'stored', 'Accepted → Stored');
select throws_ok(format($$ select public.ph_move_pallet(%L, %L) $$, :'ipegg', tests.ph_id('ph_locations', 'HF')), 'P0422', null,
  'T-07: eggplant into the tomato fridge is blocked (V-07)');
select throws_ok(format($$ select public.ph_move_pallet(%L, %L, 'Fridge 5 full') $$, :'ipegg', tests.ph_id('ph_locations', 'HF')), 'P0403', null,
  'an operator cannot override placement');
select throws_ok(format($$ select public.ph_move_pallet(%L, %L) $$, :'ip4', tests.ph_id('ph_locations', 'F1')), 'P0422', null,
  'raw pallets do not go into finished-goods fridges');
select tests.as_user(:'phm');
select is(public.ph_move_pallet(:'ipegg', tests.ph_id('ph_locations', 'HF'), 'Fridge 5 cooling unit down') ->> 'location', 'HF',
  'T-07: PHM override with reason succeeds');
select is((select count(*)::int from public.ph_stock_moves where pallet_id = tests.ph_id('ph_incoming_pallets', :'ipegg')
            and group_override_reason = 'Fridge 5 cooling unit down' and permission_basis = 'P:PHM'), 1, '… and is logged with the move and the PHM''s basis');
reset role;
update public.ph_locations set capacity_pallets = 1 where farm_id = tests.farm() and code = 'F6';
update public.ph_locations set storage_group_id = tests.ph_id('ph_storage_groups', 'tomato_cherry') where farm_id = tests.farm() and code = 'F6';
select tests.as_user(:'pho');
select is(public.ph_move_pallet(:'ip4', tests.ph_id('ph_locations', 'F6')) -> 'warnings', '[]'::jsonb, 'first pallet into F6');
select is(public.ph_move_pallet(:'ip5', tests.ph_id('ph_locations', 'F6')) -> 'warnings' -> 0 ->> 'key', 'ph.v08', 'V-08: beyond capacity warns');
select is((select count(*)::int from public.ph_stock_moves where pallet_id = tests.ph_id('ph_incoming_pallets', :'ip5')
            and to_location_id = tests.ph_id('ph_locations', 'F6') and over_capacity), 1, '… and the warning is recorded on the move');
reset role;
select is((select occupancy::int from public.ph_location_occupancy where farm_id = tests.farm() and code = 'F6'), 2, 'occupancy = pallets whose last move is there');
-- T-06 grading overdue
update public.ph_incoming_pallets set received_at = now() - interval '25 hours' where code = :'ip4';
select is((select grading_overdue from public.ph_ip_board where code = :'ip4'), true, 'T-06: 25 h after receiving the pallet is grading-overdue');
select is((select count(*)::int from public.ph_exception_items where rule = 'E-06' and code = :'ip4'), 1, '… and is on the exception board');

-- ---------------------------------------------------------------------------------------------
-- ST-07 QC-1 release (G4, OD-17)
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_qc1_release(array[%L]::uuid[], '{}') $$, tests.ph_id('ph_incoming_pallets', :'ip1')), 'P0428', null,
  'QC-1 is blocked while OD-17 is open');
reset role;
select is(tests.ph_decide('OD-17', 'A', '{}', array[:'qcm', :'phm']::uuid[]), 'decided', 'OD-17 decided: QC-1 separate gate');
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_qc1_release(array[%L]::uuid[], '{}') $$, tests.ph_id('ph_incoming_pallets', :'ip1')), 'P0403', null,
  'only QC releases');
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_qc1_release(array[%L]::uuid[], '{}') $$, tests.ph_id('ph_incoming_pallets', :'ipsod')), 'P0422', null,
  'only stored pallets can be released');
select is((public.ph_qc1_release(array[tests.ph_id('ph_incoming_pallets', :'ip1')], '{"quality_grading":"ok"}', 'Good')) ->> 'released', '1', 'QCI releases');
select is(tests.ph_status(:'ip1'), 'released', 'Released to production');
select is((select permission_basis from public.record_transitions where entity_id = tests.ph_id('ph_incoming_pallets', :'ip1') and to_status = 'released'),
  'qc1.release C:QCI', 'history records the matrix cell used');
select is((select decision_basis from public.record_transitions where entity_id = tests.ph_id('ph_incoming_pallets', :'ip1') and to_status = 'released'),
  'OD-17=A', '… and the decision that opened the gate');
select is((select a ->> 'reason' from jsonb_array_elements(public.ph_pallet_actions(tests.ph_id('ph_incoming_pallets', :'ip1'))) a
            where a ->> 'action' = 'issue_to_job_card'), '{"key": "ph.later", "milestone": "M2"}', 'issue to a Job Card is labelled as a later milestone');

-- ---------------------------------------------------------------------------------------------
-- X-01 Holds (SM-NC; SoD-05)
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_raise_hold('quality', 'Soft fruit', array[%L]::uuid[]) $$, tests.ph_id('ph_incoming_pallets', :'ip4')), 'P0403', null,
  'PHM raises operational holds only');
select (public.ph_raise_hold('operational', 'Pallet damaged, needs re-stacking', array[tests.ph_id('ph_incoming_pallets', :'ip4')]) ->> 'id') as hold1 \gset
select is(tests.ph_status(:'ip4'), 'on_hold', 'pallet on hold');
select is((select count(*)::int from jsonb_array_elements(public.ph_pallet_actions(tests.ph_id('ph_incoming_pallets', :'ip4'))) a
            where a ->> 'action' <> 'print_label'), 0, 'a held pallet offers no onward action (only a label reprint)');
select throws_ok(format($$ select public.ph_hold_step(%L, 'assign') $$, :'hold1'), 'P0403', null, 'PHM cannot assess the hold');
select tests.as_user(:'qcm');
select is(public.ph_hold_step(:'hold1', 'assign') ->> 'to_status', 'under_assessment', 'QCM takes it into assessment');
select throws_ok(format($$ select public.ph_hold_step(%L, 'decide', 'x', 'regrade') $$, :'hold1'), 'P0422', null,
  'dispositions that need Job Cards are refused until M2 (not half-done)');
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_hold_step(%L, 'decide', 'Release', 'release') $$, :'hold1'), 'P0403', null,
  'SoD-05: the PHM cannot release a hold');
select tests.as_user(:'qcm');
select is(public.ph_hold_step(:'hold1', 'decide', 'Re-stacked, product fine', 'release') ->> 'status', 'disposition_decided', 'QCM decides: release');
select is(tests.ph_status(:'ip4'), 'stored', 'G9: the pallet returns to its prior state (Stored)');
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_hold_step(%L, 'verify', 'checked') $$, :'hold1'), 'P0422', null, 'cannot verify before execution');
select tests.as_user(:'phm');
select is(public.ph_hold_step(:'hold1', 'execute', 'Pallet re-stacked by PH staff') ->> 'to_status', 'disposition_executed', 'PH executes');
select tests.as_user(:'qci');
select is(public.ph_hold_step(:'hold1', 'verify', 'Checked on the floor') ->> 'to_status', 'verified', 'QC verifies');
select throws_ok(format($$ select public.ph_hold_step(%L, 'close') $$, :'hold1'), 'P0403', null, 'only QAM closes');
select tests.as_user(:'qam');
select is(public.ph_hold_step(:'hold1', 'close') ->> 'to_status', 'closed', 'QAM closes');
-- Food-safety hold: QAM only; waste disposition creates a waste record.
select tests.as_user(:'qao');
select (public.ph_raise_hold('food_safety', 'Suspected contamination', array[tests.ph_id('ph_incoming_pallets', :'ip5')]) ->> 'id') as hold2 \gset
select is((select type_basis from public.ph_holds where id = :'hold2'), 'Chosen by raiser; classification pending OD-23', 'type flagged pending OD-23');
select tests.as_user(:'qam');
select lives_ok(format($$ select public.ph_hold_step(%L, 'assign') $$, :'hold2'), 'QAM assesses');
select tests.as_user(:'qcm');
select throws_ok(format($$ select public.ph_hold_step(%L, 'decide', 'Dispose', 'waste') $$, :'hold2'), 'P0403', null, 'food-safety disposition: QAM only');
select tests.as_user(:'qam');
select lives_ok(format($$ select public.ph_hold_step(%L, 'decide', 'Dispose of the pallet', 'waste') $$, :'hold2'), 'QAM decides waste');
select is(tests.ph_status(:'ip5'), 'waste', 'held pallet → Waste');
select isnt((select waste_record_id from public.ph_incoming_pallets where code = :'ip5'), null, 'with a waste record');

-- ---------------------------------------------------------------------------------------------
-- Read models, RLS, audit, append-only
select tests.as_user(:'pho');
select is((select a ->> 'allowed' from jsonb_array_elements(public.ph_pallet_actions(tests.ph_id('ph_incoming_pallets', :'ip4'))) a
            where a ->> 'action' = 'qc1_release'), 'false', 'an operator sees QC-1 as unavailable …');
select is((select a -> 'reason' ->> 'key' from jsonb_array_elements(public.ph_pallet_actions(tests.ph_id('ph_incoming_pallets', :'ip4'))) a
            where a ->> 'action' = 'qc1_release'), 'ph.denied.noRole', '… with the reason (role)');
select tests.logout();
select tests.login(:'outsider');
select is((select count(*)::int from public.ph_incoming_pallets), 0, 'RLS: a farm user without a packing-house role sees no pallets');
select is((select coalesce(sum(total), 0)::int from public.ph_stage_counts()), 0, '… and every stage count is zero');
select tests.logout();
select tests.login(:'qci');
select ok((select count(*) from public.ph_incoming_pallets) > 5, 'RLS: a packing-house role sees the pallets');
select ok((select total from public.ph_stage_counts() where stage = 'storage') >= 2, 'stage counts come from the records');
select throws_ok($$ select count(*) from public.ph_attachment_blobs $$, '42501', null, 'file content is not readable directly (only through the function)');
select tests.logout();
select ok((select count(*) from public.audit_events where entity_type = 'ph_incoming_pallets' and action = 'transition') > 10,
  'AT-01: every status change is in the audit trail');
select tests.as_user(:'qci');
select ok((select count(*) from public.ph_record_history('ph_incoming_pallets', tests.ph_id('ph_incoming_pallets', :'ip1'))) >= 5, 'history readable per record');
select throws_ok($$ update public.audit_events set comment = 'x' where entity_type = 'ph_incoming_pallets' $$, 'P0403', null, 'AT-02: audit is append-only');
select throws_ok($$ update public.ph_stock_moves set reason = 'x' $$, 'P0403', null, 'stock moves are append-only');
select throws_ok(format($$ update public.ph_attachments set sha256 = repeat('0', 64) where id = %L $$, :'photo1'), 'P0403', null,
  'an attachment cannot be replaced (AT-05)');
select throws_ok(format($$ delete from public.ph_incoming_pallets where code = %L $$, :'ip1'), 'P0403', null, 'V-28: no physical deletion');
select is((public.ph_backward_trace(:'ip1') -> 'pallets' -> 0 ->> 'arrival_code'), (select code from public.ph_arrivals where id = :'arr1'),
  'backward trace from a pallet reaches its arrival (TQ-01, M1 scope)');
select is(jsonb_array_length(public.ph_backward_trace((select code from public.ph_arrivals where id = :'arr1')) -> 'pallets'), 10,
  'trace from an arrival returns all its pallets, including rejected and voided ones');
select tests.as_user(:'outsider');
select throws_ok(format($$ select public.ph_backward_trace(%L) $$, :'ip1'), 'P0404', null, 'no trace for a user without a packing-house role');
select set_config('request.jwt.claims', '', true);
select tests.login(:'qam');
select throws_ok(format($$ update public.ph_holds set reason = 'x' where id = %L $$, :'hold1'), '42501', null,
  'a hold cannot be edited through the API, not even by QAM (changes go through its workflow)');
select tests.logout();

select * from finish();
rollback;
