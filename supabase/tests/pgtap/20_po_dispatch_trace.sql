-- Packhouse operations increment 3, owner acceptance scenario: receive 1,000 kg across two identifiable source lots, split one
-- lot across runs, combine portions in one run, produce several grades, keep a partial pallet, record waste and remaining stock,
-- block dispatch of held stock, dispatch, trace forward and backward, and reconcile the mass. Plus complaints.
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
  execute format('select id from public.%I where farm_id = tests.farm() and code = $1 and voided_at is null', p_table) into v using p_code;
  return v;
end $$;
create function tests.ph_crop(p_code text) returns uuid language sql as $$
  select id from public.ph_crops where farm_id = tests.farm() and code = p_code and superseded_at is null and voided_at is null $$;
create function tests.ph_line(p_code text) returns uuid language sql as $$
  select id from public.ph_lines where farm_id = tests.farm() and code = p_code and voided_at is null $$;
create function tests.fgs(p_code text) returns text language sql as $$ select status from public.ph_fg_pallets where code = p_code $$;
create function tests.jc_input(p_jc uuid, p_pallet text) returns uuid language sql as $$
  select i.id from public.ph_jc_inputs i join public.ph_incoming_pallets p on p.id = i.pallet_id
   where i.job_card_id = p_jc and p.code = p_pallet and i.closed_at is null $$;
create function tests.load_status(p_id uuid) returns text language sql as $$ select status from public.ph_loads where id = p_id $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- People, master data, the receiving decisions
select tests.ph_user('d_phm', array['PHM']) as phm \gset
select tests.ph_user('d_pe', array['PE']) as pe \gset
select tests.ph_user('d_ll', array['LL']) as ll \gset
select tests.ph_user('d_stk', array['STK']) as stk \gset
select tests.ph_user('d_pho', array['PHO']) as pho \gset
select tests.ph_user('d_dec', array['DEC']) as dec \gset
select tests.ph_user('d_qci', array['QCI']) as qci \gset
select tests.ph_user('d_qcm', array['QCM']) as qcm \gset
select tests.ph_user('d_qao', array['QAO']) as qao \gset
select tests.ph_user('d_qam', array['QAM']) as qam \gset
select tests.ph_user('d_whm', array['WHM']) as whm \gset
select tests.ph_user('d_sal', array['SAL']) as sal \gset
select tests.ph_user('d_top', array['TOP']) as top \gset
select tests.ph_user('d_adm', array['ADM']) as adm \gset
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

select app.ph_load_sop_reference(tests.farm());
select tests.as_user(:'adm');
select public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"B1S01","name_ar":"قطعة 1 قسم 1","block_code":"1","section_code":"1"}');
select public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"B2S04","name_ar":"قطعة 2 قسم 4","block_code":"2","section_code":"4"}');
select public.ph_save_master('ph_varieties', null, '{"crop_code":"cherry_tomato","code":"V1","name_ar":"صنف اختبار"}');
select tests.as_user(:'sal');
select (public.ph_save_master('ph_customers', null, '{"code":"Tesco","name_en":"Tesco"}') ->> 'id') as cust \gset
select tests.as_user(:'qcm');
select public.ph_approve_master('ph_customers', :'cust', 'Checked');
select tests.as_user(:'phm');
select public.ph_approve_master('ph_crops', tests.ph_crop('cherry_tomato'), 'Checked');
select public.ph_approve_master(t, id, 'Checked') from (
  select 'ph_locations' t, id from public.ph_locations where farm_id = tests.farm()
  union all select 'ph_equipment', id from public.ph_equipment where farm_id = tests.farm()
  union all select 'ph_sources', id from public.ph_sources where farm_id = tests.farm()
  union all select 'ph_varieties', id from public.ph_varieties where farm_id = tests.farm()
  union all select 'ph_lines', id from public.ph_lines where farm_id = tests.farm()) x;
select tests.as_user(:'qam');
select public.ph_approve_master('ph_storage_groups', id, 'SOP-PC') from public.ph_storage_groups where farm_id = tests.farm();
select tests.as_user(:'phm');
select public.ph_set_location_group(tests.ph_id('ph_locations', 'HF'), tests.ph_id('ph_storage_groups', 'tomato_cherry'));
select public.ph_set_location_group(tests.ph_id('ph_locations', 'F1'), tests.ph_id('ph_storage_groups', 'tomato_cherry'));
select tests.ph_decide('OD-38', 'Data Entry Clerk inspects incoming vehicles', array['DEC'], array[:'top', :'phm', :'qam']::uuid[]);
select tests.ph_decide('OD-01', 'B', '{}', array[:'phm', :'whm', :'qam']::uuid[]);
select tests.ph_decide('OD-03', 'A', '{}', array[:'phm', :'whm', :'adm']::uuid[]);
select tests.ph_decide('OD-02', 'C', '{}', array[:'qam', :'phm']::uuid[]);
select tests.ph_decide('OD-17', 'A', '{}', array[:'qcm', :'phm']::uuid[]);
update public.ph_rule_parameters set value_text = '23:59' where farm_id = tests.farm() and code = 'last_harvest_receipt_time';

-- ---------------------------------------------------------------------------------------------
-- 1,000 kg across two source lots: lot 1 (B1S01) 600 kg in two pallets, lot 2 (B2S04) 400 kg in one pallet
create function tests.receive(p_source text, p_kgs numeric[]) returns text[]
language plpgsql as $$
declare v_arr uuid; k numeric; codes text[] := '{}'; v_photo uuid;
begin
  perform tests.as_user((select id from auth.users where email = 'd_dec@test.local'));
  v_arr := (public.ph_create_arrival(jsonb_build_object('source_id', tests.ph_id('ph_sources', p_source), 'variety_id', tests.ph_id('ph_varieties', 'V1'),
    'vehicle_plate', 'T-' || p_source, 'driver_name', 'D', 'harvest_date', app.ph_local_date(), 'harvest_time', '00:05', 'harvest_supervisor', 'S',
    'late_reason', 'test')) ->> 'id')::uuid;
  perform public.ph_record_vehicle_inspection(v_arr, 'pass', '{"transport_conditions":"ok"}');
  perform public.ph_submit_arrival(v_arr);
  foreach k in array p_kgs loop
    codes := codes || (public.ph_register_pallet(v_arr, jsonb_build_object('net_kg', k, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code');
  end loop;
  perform tests.as_user((select id from auth.users where email = 'd_qci@test.local'));
  perform public.ph_record_arrival_check(v_arr, '{"insects":"none"}',
    (select jsonb_agg(jsonb_build_object('pallet_id', id, 'result', 'pass')) from public.ph_incoming_pallets where arrival_id = v_arr), 9.5, null);
  perform tests.as_user((select id from auth.users where email = 'd_pho@test.local'));
  perform public.ph_precool_scan(x, 'in'), public.ph_precool_scan(x, 'out') from unnest(codes) x;
  perform tests.as_user((select id from auth.users where email = 'd_qao@test.local'));
  v_photo := (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'Sample') ->> 'id')::uuid;
  perform public.ph_submit_rma((select array_agg(id) from public.ph_incoming_pallets where arrival_id = v_arr), 'accept', '{}', 9, null, null, array[v_photo]);
  perform tests.as_user((select id from auth.users where email = 'd_pho@test.local'));
  perform public.ph_move_pallet(x, tests.ph_id('ph_locations', 'HF')) from unnest(codes) x;
  perform tests.as_user((select id from auth.users where email = 'd_qci@test.local'));
  perform public.ph_qc1_release((select array_agg(id) from public.ph_incoming_pallets where arrival_id = v_arr), '{"quality_grading":"ok"}');
  return codes;
end $$;
select (tests.receive('B1S01', array[300, 300]))[1] as ip1, (tests.receive('B2S04', array[400]))[1] as ip3 \gset
select code as ip2 from public.ph_incoming_pallets where farm_id = tests.farm() and code <> :'ip1' and code <> :'ip3' \gset
select is((select sum(net_kg) from public.ph_incoming_pallets where farm_id = tests.farm()), 1000.00::numeric, 'received 1,000 kg');
select is((select count(distinct lot_id)::int from public.ph_incoming_pallets where farm_id = tests.farm()), 2, 'two identifiable source lots');
select lot_id as lot1 from public.ph_incoming_pallets where code = :'ip1' \gset
select lot_id as lot2 from public.ph_incoming_pallets where code = :'ip3' \gset
select code as lot1code from public.ph_lots where id = :'lot1' \gset
select code as lot2code from public.ph_lots where id = :'lot2' \gset

-- ---------------------------------------------------------------------------------------------
-- Two runs. Lot 1 is split across both (ip2: 150 kg to each); run 2 combines lot 1 and lot 2 (same crop, same line route).
create function tests.run(p_grade text, p_issues jsonb) returns uuid
language plpgsql as $$
declare v_jc uuid; i jsonb;
begin
  perform tests.as_user((select id from auth.users where email = 'd_pe@test.local'));
  v_jc := (public.ph_create_job_card(jsonb_build_object('line_id', tests.ph_line('A'), 'crop_id', tests.ph_crop('cherry_tomato'), 'grade_target', p_grade, 'planned_date', app.ph_local_date())) ->> 'id')::uuid;
  perform tests.as_user((select id from auth.users where email = 'd_phm@test.local'));
  perform public.ph_approve_job_card(v_jc);
  perform tests.as_user((select id from auth.users where email = 'd_ll@test.local'));
  for i in select * from jsonb_array_elements(p_issues) loop
    perform public.ph_issue_to_job_card(v_jc, i ->> 'pallet', (i ->> 'kg')::numeric);
  end loop;
  perform tests.as_user((select id from auth.users where email = 'd_stk@test.local'));
  perform public.ph_issue_packaging(v_jc, 'Carton 7 kg', 100);
  perform tests.as_user((select id from auth.users where email = 'd_ll@test.local'));
  perform public.ph_mark_job_card_ready(v_jc);
  perform tests.as_user((select id from auth.users where email = 'd_qci@test.local'));
  perform public.ph_line_start_check(v_jc, 'pass', '{}');
  perform tests.as_user((select id from auth.users where email = 'd_ll@test.local'));
  perform public.ph_confirm_line_start(v_jc);
  perform tests.as_user((select id from auth.users where email = 'd_qci@test.local'));
  perform public.ph_qc2_record(v_jc, 'final', 'pass', '{}');
  return v_jc;
end $$;
select tests.run('premium', jsonb_build_array(jsonb_build_object('pallet', :'ip1', 'kg', 300), jsonb_build_object('pallet', :'ip2', 'kg', 150))) as jc1 \gset
select tests.run('gr1', jsonb_build_array(jsonb_build_object('pallet', :'ip2', 'kg', 150), jsonb_build_object('pallet', :'ip3', 'kg', 300))) as jc2 \gset
select is((select count(distinct job_card_id)::int from public.ph_jc_inputs i join public.ph_incoming_pallets p on p.id = i.pallet_id where p.code = :'ip2'), 2,
  'lot 1 pallet split across two runs (150 + 150 kg)');
select is((select count(distinct p.lot_id)::int from public.ph_jc_inputs i join public.ph_incoming_pallets p on p.id = i.pallet_id where i.job_card_id = :'jc2'), 2,
  'run 2 combines portions of lot 1 and lot 2');

-- Finished pallets in several grades, one partial (fewer boxes), and waste weighed from each run.
select tests.as_user(:'pho');
create function tests.fg(p_jc uuid, p_boxes int, p_kg numeric, p_grade text) returns text language sql as $$
  select public.ph_create_fg_pallet(p_jc, jsonb_build_object('box_count', p_boxes, 'net_kg', p_kg, 'grade', p_grade, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code' $$;
select tests.fg(:'jc1', 50, 350, 'premium') as fga, tests.fg(:'jc1', 10, 70, 'gr1') as fgb \gset
select tests.fg(:'jc2', 40, 280, 'gr1') as fgc, tests.fg(:'jc2', 20, 140, 'gr2') as fgd, tests.fg(:'jc2', 3, 21, 'gr1') as fge \gset
select tests.as_user(:'qci');
select public.ph_fg_qc_approve(id) from public.ph_fg_pallets where farm_id = tests.farm();
select tests.as_user(:'pho');
select public.ph_move_fg_pallet(code, tests.ph_id('ph_locations', 'F1')) from public.ph_fg_pallets where farm_id = tests.farm();
select is((select count(distinct grade)::int from public.ph_fg_pallets where farm_id = tests.farm()), 3, 'three grades produced (premium, G1, G2)');
select is((select box_count from public.ph_fg_pallets where code = :'fge'), 3, 'a partial pallet (3 boxes) is kept as its own pallet');

select tests.as_user(:'dec');
select (public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', :'jc1')) ->> 'id') as w1 \gset
select (public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', :'jc2')) ->> 'id') as w2 \gset
select tests.as_user(:'qci');
select public.ph_waste_qc(:'w1', 'approve'), public.ph_waste_qc(:'w2', 'approve');
select tests.as_user(:'dec');
select public.ph_waste_weigh(:'w1', 25, tests.ph_id('ph_equipment', 'SCALE-R2')), public.ph_waste_weigh(:'w2', 30, tests.ph_id('ph_equipment', 'SCALE-R2'));
-- Run 1 consumed everything issued; run 2 returned 79 kg of lot 2 to stock (remaining stock).
select tests.as_user(:'ll');
select public.ph_complete_job_card(:'jc1', jsonb_build_array(
  jsonb_build_object('input_id', tests.jc_input(:'jc1', :'ip1'), 'consumed_kg', 300, 'returned_kg', 0),
  jsonb_build_object('input_id', tests.jc_input(:'jc1', :'ip2'), 'consumed_kg', 150, 'returned_kg', 0)));
select public.ph_complete_job_card(:'jc2', jsonb_build_array(
  jsonb_build_object('input_id', tests.jc_input(:'jc2', :'ip2'), 'consumed_kg', 150, 'returned_kg', 0),
  jsonb_build_object('input_id', tests.jc_input(:'jc2', :'ip3'), 'consumed_kg', 221, 'returned_kg', 79)));
select tests.as_user(:'phm');
select is((select variance_kg from public.ph_jc_balance where id = :'jc1'), 5.00::numeric, 'MB-01 run 1: 450 consumed − 420 packed − 25 waste = 5 kg to explain');
select is((select variance_kg from public.ph_jc_balance where id = :'jc2'), -100.00::numeric, 'MB-01 run 2: 371 consumed − 441 packed − 30 waste = −100 kg (gain) to explain');
select public.ph_reconcile_job_card(:'jc1', 'Juice and spillage not weighed');
select public.ph_reconcile_job_card(:'jc2', 'Test: boxes over-filled against the declared net weight');
-- Mass: everything received is in finished pallets, waste, stock or an explained variance.
select is(
  (select sum(net_kg) from public.ph_fg_pallets where farm_id = tests.farm() and status <> 'split_merged')
  + (select sum(net_kg) from public.ph_waste_records where farm_id = tests.farm() and net_kg is not null)
  + (select sum(app.ph_ip_available_kg(id)) from public.ph_incoming_pallets where farm_id = tests.farm())
  + (select sum(variance_kg) from public.ph_jc_balance where id in (:'jc1', :'jc2')),
  1000.00::numeric, 'mass reconciles: 861 packed + 55 waste + 179 in stock − 95 explained variance = 1,000 kg');
select is((select in_stock_kg from public.ph_lot_balance where id = :'lot2'), 179.00::numeric, 'remaining stock of lot 2: 100 never issued + 79 returned = 179 kg');
select is((select unexplained_kg from public.ph_lot_balance where id = :'lot1'), 0.00::numeric, 'lot 1 fully explained at lot level');

-- Each source quantity in the finished pallets.
select is((select round(sum(x.kg), 2) from public.ph_fg_pallet_lots x where x.lot_id = :'lot1'), 567.00::numeric,
  'lot 1 in finished pallets: run 1 all 420 kg + run 2 441 × 150/450 = 147 kg (proportional to kg issued) = 567 kg');
select is((select round(sum(x.kg), 2) from public.ph_fg_pallet_lots x where x.lot_id = :'lot2'), 294.00::numeric,
  'lot 2 in finished pallets: 441 × 300/450 = 294 kg');
select is((select round(sum(x.kg), 2) from public.ph_fg_pallet_lots x where x.lot_id in (:'lot1', :'lot2')),
  (select sum(net_kg) from public.ph_fg_pallets where farm_id = tests.farm()), 'every packed kg is attributed to exactly one lot share (no double count)');

-- ---------------------------------------------------------------------------------------------
-- Dispatch: a held pallet cannot be allocated or loaded; the load runs vehicle check → load scan → seal → packing list → departure
select tests.as_user(:'sal');
select (public.ph_create_order_line(jsonb_build_object('customer_name', 'Tesco', 'crop_id', tests.ph_crop('cherry_tomato'), 'pack_spec', '7 kg carton',
  'grade', 'gr1', 'quantity', 350, 'quantity_unit', 'kg', 'required_date', app.ph_local_date() + 1, 'market_type', 'export')) ->> 'id') as ol \gset
select public.ph_set_order_line_refs(:'ol', :'cust', null);
select tests.as_user(:'phm');
select public.ph_decide_order_line(:'ol', 'accept');

select tests.as_user(:'qci');
select is(public.ph_raise_fg_hold('quality', 'Soft fruit seen on the top layer', array[(select id from public.ph_fg_pallets where code = :'fgc')]) ->> 'code' like 'NC-%', true,
  'QC holds a finished pallet');
select is(tests.fgs(:'fgc'), 'on_hold', 'the pallet is on hold');
select tests.as_user(:'pe');
select (public.ph_create_load(jsonb_build_object('customer_id', :'cust', 'destination', 'UK (test)', 'order_line_ids', jsonb_build_array(:'ol'), 'vehicle_plate', 'TR-1')) ->> 'id') as ld \gset
select throws_ok(format($$ select public.ph_allocate_pallet(%L, %L) $$, :'ld', :'fgc'), 'P0422', null, 'held stock: allocation is refused');
select is((select count(*)::int from public.ph_fifo_proposal(:'ol') where code = :'fgc'), 0, 'held stock never appears in the FIFO proposal');
select throws_ok(format($$ select public.ph_allocate_pallet(%L, %L) $$, :'ld', :'fgd'), 'P0422', null, 'a pallet of another grade is refused');
select is(public.ph_allocate_pallet(:'ld', :'fgb') ->> 'pallet', :'fgb', 'G1 pallet from run 1 (lot 1) allocated');
select is(public.ph_allocate_pallet(:'ld', :'fge') ->> 'pallet', :'fge', 'the partial G1 pallet from run 2 (lots 1 + 2) allocated');
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_allocate_pallet(%L, %L) $$, :'ld', :'fga'), 'P0403', null, 'the loader does not allocate');
select is(public.ph_load_scan(:'ld', :'fgb') ->> 'status', 'picked', 'first scan picks');
select throws_ok(format($$ select public.ph_load_scan(%L, %L) $$, :'ld', :'fgb'), 'P0422', null, 'no loading before the vehicle passes G8');
select throws_ok(format($$ select public.ph_load_scan(%L, %L) $$, :'ld', :'fgc'), 'P0422', null, 'held stock: the load scan is refused');
select tests.as_user(:'dec');
select is(public.ph_load_step(:'ld', 'arrive') ->> 'status', 'vehicle_arrived', 'vehicle arrival recorded (DEC)');
select tests.as_user(:'qci');
select is(public.ph_load_step(:'ld', 'inspect', '{"items":{"clean":true,"no_smell":true,"no_contamination":true,"lockable":true,"temperature_ok":false},"temp_c":14}') ->> 'status',
  'waiting_for_temp', 'G8: temperature not reached → waiting for temperature');
select is(public.ph_load_step(:'ld', 'inspect', '{"items":{"clean":true,"no_smell":true,"no_contamination":true,"lockable":true,"temperature_ok":true},"temp_c":9}') ->> 'status',
  'loading', 'G8 re-check passes → loading');
select tests.as_user(:'pho');
select is(public.ph_load_scan(:'ld', :'fgb') ->> 'status', 'loaded', 'second scan loads');
select public.ph_load_scan(:'ld', :'fge'), public.ph_load_scan(:'ld', :'fge');
select tests.as_user(:'dec');
-- Real farm: logger / seal (OD-18) and packing list / departure (no recording role named) are NYV cells.
update public.settings set value = 'false' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';
select throws_ok(format($$ select public.ph_load_step(%L, 'seal', '{"seal_number":"S-1"}') $$, :'ld'), 'P0403', null,
  'seal (V-13) is refused while its cell waits for OD-18');
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';
-- Test fixture standing for the owner's recorded decision on the two NYV cells (the owner screen comes with increment 4).
update public.ph_permission_cells set state = 'active', basis = 'test-owner-decision'
 where farm_id = tests.farm() and spec_code = 'DEC' and action_key in ('load.logger_seal', 'load.finalise');
select throws_ok(format($$ select public.ph_load_step(%L, 'seal', '{}') $$, :'ld'), 'P0422', null, 'V-13: no seal number, no seal');
select is(public.ph_load_step(:'ld', 'seal', '{"seal_number":"S-0001","logger_ids":["LG-7"]}') ->> 'status', 'sealed', 'seal and logger recorded');
select is(public.ph_load_step(:'ld', 'finalise') ->> 'status', 'packing_list_final', 'packing list generated from the scans');
select is((select (packing_list ->> 'total_kg')::numeric from public.ph_loads where id = :'ld'), 91.00::numeric, 'packing list = 70 + 21 kg');
select is(public.ph_load_step(:'ld', 'depart') ->> 'status', 'departed', 'the load departs');
select is((select string_agg(status, ',' order by code) from public.ph_fg_pallets where code in (:'fgb', :'fge')), 'dispatched,dispatched', 'its pallets are dispatched');
select is(tests.fgs(:'fgc'), 'on_hold', 'the held pallet stayed behind');

-- ---------------------------------------------------------------------------------------------
-- Trace forward from lot 1 and backward from the dispatched pallet
select tests.as_user(:'qam');
select is((public.ph_forward_trace(:'lot1code') -> 'customers'), '["Tesco"]'::jsonb, 'forward from lot 1: the customer who received it');
select is((public.ph_forward_trace(:'lot1code') -> 'totals' ->> 'source_kg')::numeric, 600.00::numeric, 'forward from lot 1: 600 kg at source');
select ok(abs((public.ph_forward_trace(:'lot1code') -> 'totals' ->> 'dispatched_kg')::numeric
              - (select sum(x.kg) from public.ph_fg_pallet_lots x join public.ph_fg_pallets f on f.id = x.fg_pallet_id
                  where x.lot_id = :'lot1' and f.code in (:'fgb', :'fge'))) < 0.02,
  'forward from lot 1: dispatched kg = lot 1 share of the two dispatched pallets');
select ok((public.ph_forward_trace(:'lot1code') -> 'totals' ->> 'held_kg')::numeric > 0, 'forward from lot 1: held quantity shown (the held pallet contains lot 1)');
select is((public.ph_forward_trace(:'lot2code') -> 'totals' ->> 'source_kg')::numeric, 400.00::numeric, 'forward from lot 2: 400 kg at source');
select is((select array_agg(x ->> 'code' order by x ->> 'code') from jsonb_array_elements(public.ph_backward_trace(:'fge') -> 'pallets') x),
  (select array_agg(code order by code) from public.ph_incoming_pallets where code in (:'ip2', :'ip3')),
  'backward from the dispatched partial pallet: the incoming pallets of both lots it came from');
select is((select count(*)::int from jsonb_array_elements(public.ph_recall_search(array[:'lot1code', :'lot2code']) -> 'results')), 2, 'recall search over both lots');
select ok((public.ph_recall_search(array[:'lot1code']) -> 'customers') ? 'Tesco', 'recall search names the customers');
select ok(jsonb_array_length(public.ph_trace_timeline(:'fge') -> 'events') > 5, 'trace timeline: chronological events for the dispatched pallet''s chain');
select ok(exists (select 1 from jsonb_array_elements(public.ph_trace_timeline(:'fge') -> 'events') e where e ->> 'to' = 'dispatched'), 'trace timeline: shows the dispatch');
select is((public.ph_trace_people(:'fgb') ->> 'attribution'), 'run_or_team', 'people are attributed at run / team level, not to one packer');
select tests.as_user(:'pho');
select throws_ok($$ select public.ph_recall_search(array['x']) $$, 'P0403', null, 'recall search is a QA / management action');

-- ---------------------------------------------------------------------------------------------
-- Hold release by the authorised quality team only; release returns the pallet to storage
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_hold_step((select hold_id from public.ph_fg_pallets where code = %L), 'decide', 'ok', 'release') $$, :'fgc'),
  'P0403', null, 'the PHM cannot release a quality hold (SoD-05)');
select tests.as_user(:'qcm');
select public.ph_hold_step((select hold_id from public.ph_fg_pallets where code = :'fgc'), 'assign', 'Assess');
select is(public.ph_hold_step((select hold_id from public.ph_fg_pallets where code = :'fgc'), 'decide', 'Re-checked: firm', 'release') ->> 'disposition', 'release',
  'QCM releases');
select is(tests.fgs(:'fgc'), 'in_storage', 'the released pallet is back in storage');

-- ---------------------------------------------------------------------------------------------
-- Complaint on the departed load
select tests.as_user(:'sal');
select (public.ph_create_complaint(jsonb_build_object('customer_id', :'cust', 'load', :'ld', 'description', 'Soft fruit in 2 boxes')) ->> 'id') as cmp \gset
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_complaint_step(%L, 'valid') $$, :'cmp'), 'P0403', null, 'an operator does not judge validity');
select tests.as_user(:'qao');
select is(public.ph_complaint_step(:'cmp', 'valid', '{"note":"Within 24 h"}') ->> 'status', 'investigating', 'QA: valid, under investigation');
select public.ph_complaint_step(:'cmp', 'investigate', '{"investigation":"Trace taken","root_cause":"Over-ripe fruit in lot 1"}');
select ok((select trace_snapshot is not null from public.ph_complaints where id = :'cmp'), 'the trace is kept with the complaint as found');
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_complaint_step(%L, 'confirm', '{}') $$, :'cmp'), 'P0422', null, 'confirmation needs the corrective action');
select is(public.ph_complaint_step(:'cmp', 'confirm', '{"corrective_action":"Tighten colour check at QC-2"}') ->> 'status', 'confirmed', 'PHM confirms with CAPA');
select tests.as_user(:'qam');
select is(public.ph_complaint_step(:'cmp', 'close', '{"note":"CAPA verified"}') ->> 'status', 'closed', 'QAM closes');

select * from finish();
rollback;
