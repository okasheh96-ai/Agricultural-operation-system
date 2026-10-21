-- Packing house M2.2: waste (ST-11, SM-WR, G7, V-16, V-17, SoD-03, E-20) and Job Card reconciliation (MB-01), the lot and
-- arrival balances (MB-02, MB-03 as recorded), and duplicate-submission protection. Every transition has an allowed and a
-- forbidden case; OD-11 and OD-28 keep their steps blocked until decided.
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
create function tests.ws(p_id uuid) returns text language sql as $$ select status from public.ph_waste_records where id = p_id $$;
create function tests.jc_status(p_id uuid) returns text language sql as $$ select status from public.ph_job_cards where id = p_id $$;
create function tests.jc_input(p_jc uuid, p_pallet text) returns uuid language sql as $$
  select i.id from public.ph_jc_inputs i join public.ph_incoming_pallets p on p.id = i.pallet_id
   where i.job_card_id = p_jc and p.code = p_pallet and i.closed_at is null $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- People
select tests.ph_user('w_phm', array['PHM']) as phm \gset
select tests.ph_user('w_pe', array['PE']) as pe \gset
select tests.ph_user('w_ll', array['LL']) as ll \gset
select tests.ph_user('w_stk', array['STK']) as stk \gset
select tests.ph_user('w_pho', array['PHO']) as pho \gset
select tests.ph_user('w_dec', array['DEC']) as dec \gset
select tests.ph_user('w_dec2', array['DEC']) as dec2 \gset
select tests.ph_user('w_qci', array['QCI']) as qci \gset
select tests.ph_user('w_qcm', array['QCM']) as qcm \gset
select tests.ph_user('w_qao', array['QAO']) as qao \gset
select tests.ph_user('w_qam', array['QAM']) as qam \gset
select tests.ph_user('w_whm', array['WHM']) as whm \gset
select tests.ph_user('w_fin', array['FIN']) as fin \gset
select tests.ph_user('w_top', array['TOP']) as top \gset
select tests.ph_user('w_adm', array['ADM']) as adm \gset
select tests.ph_user('w_dec_qci', array['DEC', 'QCI']) as decqci \gset
select tests.ph_user('w_qcm_qam', array['QCM', 'QAM']) as qcmqam \gset
select tests.create_user('w_outsider') as outsider \gset
select tests.grant_role(:'outsider', 'supervisor', 'agriculture');
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

-- ---------------------------------------------------------------------------------------------
-- Fixture: two cherry-tomato pallets released by QC-1, one Job Card running on line A with a QC-2 final pass.
select app.ph_load_sop_reference(tests.farm());
select tests.as_user(:'adm');
select public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"B3S07","name_ar":"قطعة 3 قسم 7","block_code":"3","section_code":"7"}');
select public.ph_save_master('ph_varieties', null, '{"crop_code":"cherry_tomato","code":"V1","name_ar":"صنف اختبار"}');
select tests.as_user(:'phm');
select public.ph_approve_master('ph_crops', tests.ph_crop('cherry_tomato'), 'Checked');
select public.ph_approve_master('ph_locations', id, 'Checked') from public.ph_locations where farm_id = tests.farm();
select public.ph_approve_master('ph_equipment', id, 'Checked') from public.ph_equipment where farm_id = tests.farm();
select public.ph_approve_master('ph_sources', id, 'Checked') from public.ph_sources where farm_id = tests.farm();
select public.ph_approve_master('ph_varieties', id, 'Checked') from public.ph_varieties where farm_id = tests.farm();
select public.ph_approve_master('ph_lines', tests.ph_line('A'), 'Line on the floor');
select tests.as_user(:'qam');
select public.ph_approve_master('ph_storage_groups', id, 'SOP-PC') from public.ph_storage_groups where farm_id = tests.farm();
select tests.as_user(:'phm');
select public.ph_set_location_group(tests.ph_id('ph_locations', 'HF'), tests.ph_id('ph_storage_groups', 'tomato_cherry'));
reset role;
select tests.ph_decide('OD-38', 'Data Entry Clerk inspects incoming vehicles', array['DEC'], array[:'top', :'phm', :'qam']::uuid[]);
select tests.ph_decide('OD-01', 'B', '{}', array[:'phm', :'whm', :'qam']::uuid[]);
select tests.ph_decide('OD-03', 'A', '{}', array[:'phm', :'whm', :'adm']::uuid[]);
select tests.ph_decide('OD-02', 'C', '{}', array[:'qam', :'phm']::uuid[]);
select tests.ph_decide('OD-17', 'A', '{}', array[:'qcm', :'phm']::uuid[]);
update public.ph_rule_parameters set value_text = '23:59' where farm_id = tests.farm() and code = 'last_harvest_receipt_time';

select tests.as_user(:'dec');
select (public.ph_create_arrival(jsonb_build_object('source_id', tests.ph_id('ph_sources', 'B3S07'), 'variety_id', tests.ph_id('ph_varieties', 'V1'),
  'vehicle_plate', '10-8', 'driver_name', 'D', 'harvest_date', app.ph_local_date(), 'harvest_time', '00:05', 'harvest_supervisor', 'S',
  'late_reason', 'test'), gen_random_uuid()) ->> 'id') as arr \gset
select public.ph_record_vehicle_inspection(:'arr', 'pass', '{"transport_conditions":"ok"}');
select public.ph_submit_arrival(:'arr');
select gen_random_uuid() as req \gset
select (public.ph_register_pallet(:'arr', jsonb_build_object('net_kg', 400, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1')), :'req') ->> 'code') as ip1 \gset
select is(public.ph_register_pallet(:'arr', jsonb_build_object('net_kg', 400, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1')), :'req') ->> 'code',
  :'ip1', 'a repeated registration (same request id) returns the first pallet');
select is((select count(*)::int from public.ph_incoming_pallets where arrival_id = :'arr'), 1, '… and creates no second pallet');
select (public.ph_register_pallet(:'arr', jsonb_build_object('net_kg', 380, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code') as ip2 \gset
select tests.as_user(:'qci');
select public.ph_record_arrival_check(:'arr', '{"insects":"none"}',
  (select jsonb_agg(jsonb_build_object('pallet_id', id, 'result', 'pass')) from public.ph_incoming_pallets where arrival_id = :'arr'), 9.5, null);
select tests.as_user(:'pho');
select public.ph_precool_scan(x, 'in'), public.ph_precool_scan(x, 'out') from unnest(array[:'ip1', :'ip2']) x;
select tests.as_user(:'qao');
select (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'Sample') ->> 'id') as photo \gset
select public.ph_submit_rma((select array_agg(id) from public.ph_incoming_pallets where arrival_id = :'arr'), 'accept', '{}', 9, null, null, array[:'photo']::uuid[]);
select tests.as_user(:'pho');
select public.ph_move_pallet(x, tests.ph_id('ph_locations', 'HF')) from unnest(array[:'ip1', :'ip2']) x;
select tests.as_user(:'qci');
select public.ph_qc1_release((select array_agg(id) from public.ph_incoming_pallets where arrival_id = :'arr'), '{"quality_grading":"ok"}');
select tests.as_user(:'pe');
select gen_random_uuid() as jreq \gset
select (public.ph_create_job_card(jsonb_build_object('line_id', tests.ph_line('A'), 'crop_id', tests.ph_crop('cherry_tomato'), 'grade_target', 'premium'),
  :'jreq') ->> 'id') as jc \gset
select is(public.ph_create_job_card(jsonb_build_object('line_id', tests.ph_line('A'), 'crop_id', tests.ph_crop('cherry_tomato'), 'grade_target', 'premium'),
  :'jreq') ->> 'id', :'jc', 'a double-tapped Job Card returns the first one');
select is((select count(*)::int from public.ph_job_cards where farm_id = tests.farm()), 1, '… and only one Job Card exists');
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_create_job_card('{}'::jsonb, %L) $$, :'jreq'), 'P0409', null,
  'a request id cannot be reused by someone else');
select tests.as_user(:'phm');
select public.ph_approve_job_card(:'jc');
select tests.as_user(:'ll');
select public.ph_issue_to_job_card(:'jc', :'ip1', 400);
select tests.as_user(:'stk');
select public.ph_issue_packaging(:'jc', 'Clamshell', 100);
select tests.as_user(:'ll');
select public.ph_mark_job_card_ready(:'jc');
select tests.as_user(:'qci');
select public.ph_line_start_check(:'jc', 'pass', '{}');
select tests.as_user(:'ll');
select public.ph_confirm_line_start(:'jc');
select tests.as_user(:'qci');
select public.ph_qc2_record(:'jc', 'final', 'pass', '{}');
select tests.as_user(:'pho');
select gen_random_uuid() as freq \gset
select (public.ph_create_fg_pallet(:'jc', jsonb_build_object('box_count', 60, 'net_kg', 300, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1')), :'freq') ->> 'id') as fg \gset
select is(public.ph_create_fg_pallet(:'jc', jsonb_build_object('box_count', 60, 'net_kg', 300, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1')), :'freq') ->> 'id',
  :'fg', 'a retried finished pallet (same request id) is the same pallet');
select is((select count(*)::int from public.ph_fg_pallets where job_card_id = :'jc'), 1, '… one finished pallet, not two');

-- ---------------------------------------------------------------------------------------------
-- ST-11 create: DEC records waste from the running Job Card (category and source); QC does not.
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', %L)) $$, :'jc'),
  'P0403', null, 'QC does not record waste (it labels it)');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_create_waste_record(jsonb_build_object('category', 'weight_loss', 'source_type', 'job_card', 'source', %L)) $$, :'jc'),
  'P0428', null, 'weight-loss adjustments wait on OD-28');
select throws_ok(format($$ select public.ph_create_waste_record(jsonb_build_object('category', 'packaging', 'source_type', 'job_card', 'source', %L)) $$, :'jc'),
  'P0422', null, 'packaging waste (counted by the warehouse) is not built');
select throws_ok(format($$ select public.ph_create_waste_record(jsonb_build_object('category', 'long_storage', 'source_type', 'job_card', 'source', %L)) $$, :'jc'),
  'P0422', null, 'long-storage waste needs photos');
select throws_ok($$ select public.ph_create_waste_record('{"category":"processed","source_type":"job_card","source":"JC-NOPE"}') $$,
  'P0404', null, 'an unknown source is refused');
select throws_ok($$ select public.ph_create_waste_record('{"category":"processed","source_type":"job_card"}') $$,
  'P0422', null, 'the source is mandatory');
select gen_random_uuid() as wreq \gset
select (public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', :'jc', 'reference_kg', 40, 'bags', 4),
  :'wreq') ->> 'id') as w1 \gset
select is(public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', :'jc'), :'wreq') ->> 'id',
  :'w1', 'a repeated waste submission returns the first record');
select is(tests.ws(:'w1'), 'awaiting_qc', 'waste submitted: awaiting the QC label');
select is(tests.notifications(:'qci', 'ph_waste_qc_due'), 1, 'QC is asked for the label');
set local role authenticated;
select throws_ok(format($$ insert into public.ph_waste_records (farm_id, code, category, source_type, origin) values (%L, 'X', 'processed', 'location', 'x') $$,
  tests.farm()), '42501', null, 'no direct insert of waste records');
reset role;

-- G7 / V-16: QC label before weighing
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_waste_weigh(%L, 40, %L) $$, :'w1', tests.ph_id('ph_equipment', 'SCALE-R2')), 'P0422', null,
  'V-16: no weight before the QC label');
select throws_ok(format($$ select public.ph_waste_qc(%L, 'approve') $$, :'w1'), 'P0403', null, 'the data entry clerk cannot give the QC label');
select tests.as_user(:'decqci');
select (public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', :'jc')) ->> 'id') as wsod \gset
select throws_ok(format($$ select public.ph_waste_qc(%L, 'approve') $$, :'wsod'), 'P0423', null, 'SoD-03: whoever recorded the waste does not label it');
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_waste_qc(%L, 'refuse') $$, :'wsod'), 'P0422', null, 'a refusal needs a reason');
select is(public.ph_waste_qc(:'wsod', 'refuse', 'Saleable fruit — back to the line') ->> 'status', 'returned_to_line', 'QC refuses: returned to the line');
select is(public.ph_waste_qc(:'w1', 'approve') ->> 'status', 'qc_approved', 'QC approves the waste label');
select throws_ok(format($$ select public.ph_waste_qc(%L, 'approve') $$, :'w1'), 'P0422', null, 'the label is given once');

-- Weighing; routing waits on OD-11 (basis of the 1 t threshold)
select throws_ok(format($$ select public.ph_waste_weigh(%L, 40, %L) $$, :'w1', tests.ph_id('ph_equipment', 'SCALE-R2')), 'P0403', null, 'QC does not weigh');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_waste_weigh(%L, 0, %L) $$, :'w1', tests.ph_id('ph_equipment', 'SCALE-R2')), 'P0422', null, 'weight above zero');
select throws_ok(format($$ select public.ph_waste_weigh(%L, 40, null) $$, :'w1'), 'P0422', null, 'the scale is required');
select is(public.ph_waste_weigh(:'w1', 40, tests.ph_id('ph_equipment', 'SCALE-R2'), 4) -> 'warnings' @> '[{"key":"ph.blocked.open","decision":"OD-11"}]',
  true, 'weighed; routing for sign-off says OD-11 is open');
select is(tests.ws(:'w1'), 'weighed', 'the record waits, weighed, until OD-11 is decided');
select is((select weight_unit_id is not null from public.ph_waste_records where id = :'w1'), true, 'weight stored with its unit');
select is((select count(*)::int from public.ph_exception_items where rule = 'OD-11' and entity_id = :'w1'), 1, 'listed as waiting on OD-11');
select throws_ok(format($$ select public.ph_waste_route_now(%L) $$, :'w1'), 'P0428', null, 'routing is refused while OD-11 is open');
select is(tests.ph_decide('OD-11', 'A', array['QCM', 'QAM'], array[:'phm', :'fin', :'whm', :'qam', :'qcm']::uuid[]), 'decided', 'OD-11 decided by its owners');
select tests.as_user(:'dec');
select is(public.ph_waste_route_now(:'w1') ->> 'status', 'awaiting_sign_off', 'routed after OD-11');
select is((select route from public.ph_waste_records where id = :'w1'), 'small', '40 kg processed waste: PHM sign-off (V-17)');

-- Sign-off (small): PHM only; SoD-03
select tests.as_user(:'whm');
select throws_ok(format($$ select public.ph_waste_signoff(%L) $$, :'w1'), 'P0403', null, 'the warehouse does not sign small waste');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_waste_erp_ref(%L, 'ERP-1') $$, :'w1'), 'P0422', null, 'no ERP reference before sign-off');
select tests.as_user(:'phm');
select is(public.ph_waste_signoff(:'w1', 'Checked') ->> 'status', 'signed_off', 'PHM signs off');
select throws_ok(format($$ select public.ph_waste_signoff(%L) $$, :'w1'), 'P0422', null, 'signed once');
select throws_ok(format($$ select public.ph_waste_erp_ref(%L, 'ERP-1') $$, :'w1'), 'P0403', null, 'the PHM does not post to the ERP');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_waste_erp_ref(%L, ' ') $$, :'w1'), 'P0422', null, 'the ERP reference is required');
select is(public.ph_waste_erp_ref(:'w1', 'ERP-1') ->> 'status', 'erp_posted', 'DEC records the ERP reference');
select throws_ok(format($$ select public.ph_waste_dispose(%L) $$, :'wsod'), 'P0422', null, 'a returned record is not removed');
select is(public.ph_waste_dispose(:'w1', 'Moved to the farm waste area') ->> 'status', 'disposed', 'removal recorded');

-- Large route: above 1 t, every required role signs, one person once
select (public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'location', 'source', 'HF',
  'crop_id', tests.ph_crop('cherry_tomato'))) ->> 'id') as w2 \gset
select tests.as_user(:'qci');
select public.ph_waste_qc(:'w2', 'approve');
select tests.as_user(:'dec2');
select public.ph_waste_weigh(:'w2', 1500, tests.ph_id('ph_equipment', 'SCALE-R2'));
select is((select route from public.ph_waste_records where id = :'w2'), 'large', '1 500 kg: the large route');
select is((select required_signers from public.ph_waste_board where id = :'w2'), array['FIN', 'PHM', 'QAM', 'QCM', 'WHM'],
  'PHM, Warehouse, Finance, QC and QA sign (V-17; QA/QC level per OD-11)');
select tests.as_user(:'phm');
select is(public.ph_waste_signoff(:'w2') ->> 'status', 'awaiting_sign_off', 'PHM signed; others still needed');
select tests.as_user(:'whm');
select public.ph_waste_signoff(:'w2');
select tests.as_user(:'fin');
select public.ph_waste_signoff(:'w2');
select tests.as_user(:'qcmqam');
select is(public.ph_waste_signoff(:'w2') ->> 'status', 'awaiting_sign_off', 'a person holding QCM and QAM signs once');
select throws_ok(format($$ select public.ph_waste_signoff(%L) $$, :'w2'), 'P0422', null, '… and cannot sign the second role too');
select is((select spec_code from public.ph_waste_signoffs where waste_id = :'w2' and created_by = :'qcmqam'), 'QAM', '… as one role (QAM)');
select tests.as_user(:'qam');
select throws_ok(format($$ select public.ph_waste_signoff(%L) $$, :'w2'), 'P0422', null, 'the QAM role has signed already');
select tests.as_user(:'qcm');
select is(public.ph_waste_signoff(:'w2') ->> 'status', 'signed_off', 'the last required signature (QCM) completes the sign-off');
select is((select count(*)::int from public.ph_waste_signoffs where waste_id = :'w2'), 5, 'five signatures recorded');
reset role;
select throws_ok($$ update public.ph_waste_signoffs set comment = 'x' $$, 'P0403', null, 'signatures are never edited');

-- Long-storage above 1 t: top management first (E-20 after 24 h without it)
select tests.as_user(:'dec');
select (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') ->> 'id') as wphoto \gset
select (public.ph_create_waste_record(jsonb_build_object('category', 'long_storage', 'source_type', 'location', 'source', 'HF',
  'crop_id', tests.ph_crop('cherry_tomato'), 'attachment_ids', jsonb_build_array(:'wphoto'))) ->> 'id') as w3 \gset
select tests.as_user(:'qci');
select public.ph_waste_qc(:'w3', 'approve');
select tests.as_user(:'dec');
select public.ph_waste_weigh(:'w3', 1200, tests.ph_id('ph_equipment', 'SCALE-R2'));
select is(tests.ws(:'w3'), 'awaiting_top_mgmt', 'long-storage above 1 t waits for top management');
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_waste_signoff(%L) $$, :'w3'), 'P0422', null, 'no sign-off before top management');
select throws_ok(format($$ select public.ph_waste_topmgmt(%L) $$, :'w3'), 'P0403', null, 'only top management approves it');
reset role;
-- One transaction has one clock: a negative limit stands in for 24 h having passed.
update public.ph_rule_parameters set value_numeric = -1 where farm_id = tests.farm() and code = 'topmgmt_waste_timeout_hours';
select is((select count(*)::int from public.ph_exception_items where rule = 'E-20' and entity_id = :'w3'), 1, 'E-20: overdue without top management');
update public.ph_rule_parameters set value_numeric = 24 where farm_id = tests.farm() and code = 'topmgmt_waste_timeout_hours';
select tests.as_user(:'top');
select is(public.ph_waste_topmgmt(:'w3', 'Approved') ->> 'status', 'awaiting_sign_off', 'top management approves: sign-offs next');
select is((select route from public.ph_waste_records where id = :'w3'), 'top_mgmt', 'route kept');

-- ---------------------------------------------------------------------------------------------
-- MB-01 reconciliation
select tests.as_user(:'dec');
select (public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', :'jc')) ->> 'id') as w4 \gset
select tests.as_user(:'ll');
select public.ph_complete_job_card(:'jc', jsonb_build_array(jsonb_build_object('input_id', tests.jc_input(:'jc', :'ip1'), 'consumed_kg', 360, 'returned_kg', 40)));
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_reconcile_job_card(%L) $$, :'jc'), 'P0422', null, 'not reconciled while Job Card waste is unweighed');
select is((select a -> 'reason' ->> 'key' from jsonb_array_elements(public.ph_job_card_actions(:'jc')) a where a ->> 'action' = 'reconcile'),
  'ph.mb.wastePending', 'the record view says why');
select tests.as_user(:'qci');
select public.ph_waste_qc(:'w4', 'approve');
select tests.as_user(:'dec');
select public.ph_waste_weigh(:'w4', 15, tests.ph_id('ph_equipment', 'SCALE-R2'));
select tests.as_user(:'pe');
select throws_ok(format($$ select public.ph_reconcile_job_card(%L, 'x') $$, :'jc'), 'P0403', null, 'the PE does not reconcile');
select tests.as_user(:'phm');
select is((select variance_kg from public.ph_jc_balance where id = :'jc'), 5.00::numeric,
  'MB-01: 360 consumed − 300 finished − 40 + 15 kg waste = 5 kg unexplained');
select throws_ok(format($$ select public.ph_reconcile_job_card(%L) $$, :'jc'), 'P0422', null, 'without a tolerance (OD-28) a variance needs an explanation');
select is(public.ph_reconcile_job_card(:'jc', 'Spillage at the packer, not weighed') ->> 'tolerance_basis', 'no_tolerance_set', 'reconciled with the explanation');
select is(tests.jc_status(:'jc'), 'reconciled', 'Reconciled');
select is((select explanation from public.ph_jc_reconciliations where job_card_id = :'jc'), 'Spillage at the packer, not weighed', 'explanation kept');
select is((select count(*)::int from public.ph_exception_items where rule = 'MB-01' and entity_id = :'jc'), 1, 'listed for review (no tolerance set)');
select throws_ok(format($$ select public.ph_reconcile_job_card(%L, 'again') $$, :'jc'), 'P0422', null, 'reconciled once');
reset role;
select throws_ok($$ update public.ph_jc_reconciliations set variance_kg = 0 $$, 'P0403', null, 'the reconciliation is never edited');
select tests.as_user(:'pe');
select throws_ok(format($$ select public.ph_close_job_card(%L) $$, :'jc'), 'P0403', null, 'the PE does not close');
select tests.as_user(:'phm');
select is(public.ph_close_job_card(:'jc') ->> 'status', 'closed', 'PHM closes the Job Card');
select throws_ok(format($$ select public.transition_record('ph_job_cards', %L, 'completed') $$, :'jc'), 'P0422', null, 'reopening is refused (OD-15)');
select is((select a -> 'reason' ->> 'decision' from jsonb_array_elements(public.ph_job_card_actions(:'jc')) a where a ->> 'action' = 'reopen'),
  'OD-15', '… and the record view names OD-15');
select throws_ok(format($$ select public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', %L)) $$, :'jc'),
  'P0403', null, 'no new waste against a closed Job Card (and the PHM records none)');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', %L)) $$, :'jc'),
  'P0404', null, 'no new waste against a closed Job Card');

-- ---------------------------------------------------------------------------------------------
-- MB-02 / MB-03 balances from recorded quantities (nothing forced to balance)
select tests.as_user(:'phm');
select is((select accepted_kg from public.ph_lot_balance where id = (select lot_id from public.ph_incoming_pallets where code = :'ip1')), 780.00::numeric,
  'MB-02: the lot accepted 400 + 380 kg');
select is((select consumed_kg from public.ph_lot_balance where id = (select lot_id from public.ph_incoming_pallets where code = :'ip1')), 360.00::numeric,
  '… 360 kg consumed by the Job Card');
select is((select in_stock_kg from public.ph_lot_balance where id = (select lot_id from public.ph_incoming_pallets where code = :'ip1')), 420.00::numeric,
  '… 420 kg still in stock (40 returned + 380 never issued)');
select is((select unexplained_kg from public.ph_lot_balance where id = (select lot_id from public.ph_incoming_pallets where code = :'ip1')), 0.00::numeric,
  '… nothing unexplained at lot level');
select is((select registered_kg from public.ph_arrival_balance where id = :'arr'), 780.00::numeric, 'receiving balance: 780 kg registered');
select is((select accepted_kg from public.ph_arrival_balance where id = :'arr'), 780.00::numeric, '… all accepted');

-- ---------------------------------------------------------------------------------------------
-- RLS and the real farm
select tests.as_user(:'outsider');
set local role authenticated;
select is((select count(*)::int from public.ph_waste_signoffs) + (select count(*)::int from public.ph_jc_reconciliations)
          + (select count(*)::int from public.ph_waste_board) + (select count(*)::int from public.ph_jc_balance)
          + (select count(*)::int from public.ph_lot_balance) + (select count(*)::int from public.ph_arrival_balance), 0,
  'an outsider sees no waste, reconciliation or balance');
reset role;
select tests.as_user(:'qao');
set local role authenticated;
select is((select count(*)::int from public.ph_waste_signoffs), 6, 'packing-house members read the signatures (1 small + 5 large)');
select throws_ok($$ delete from public.ph_waste_records $$, '42501', null, 'no delete on waste records');
reset role;
select is((select count(*)::int from public.audit_events where entity_type = 'ph_waste_records' and entity_id = :'w2'::uuid) >= 4, true,
  'waste changes are in the audit trail');
update public.settings set value = 'false' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'incoming_pallet', 'source', %L)) $$, :'ip2'),
  'P0403', null, 'on a real farm the proposed DEC waste cell does not authorise anyone until approved');

select * from finish();
rollback;
