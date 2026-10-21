-- Packing house M2.3: order lines (ST-00, FR-PL-01/02/04), Job Cards for an accepted line (V-10), the daily plan (FR-PL-03),
-- finished-pallet split / merge with PHM approval (FR-FG-04/05, GEN-07/08, V-22) and the trace through them. Every new
-- transition has an allowed and a forbidden case; proposed cells stop working when proposals are not in effect.
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
create function tests.ol(p_id uuid) returns text language sql as $$ select status from public.ph_order_lines where id = p_id $$;
create function tests.fgs(p_id uuid) returns text language sql as $$ select status from public.ph_fg_pallets where id = p_id $$;
create function tests.fgc(p_id uuid) returns text language sql as $$ select status from public.ph_fg_changes where id = p_id $$;
create function tests.order_line(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('customer_name', 'Customer A (test)', 'crop_id', tests.ph_crop('cherry_tomato'), 'pack_spec', '250 g punnet',
                            'grade', 'premium', 'quantity', 300, 'quantity_unit', 'kg', 'required_date', app.ph_local_date() + 5,
                            'market_type', 'local') || p_extra $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- People
select tests.ph_user('o_phm', array['PHM']) as phm \gset
select tests.ph_user('o_pe', array['PE']) as pe \gset
select tests.ph_user('o_ll', array['LL']) as ll \gset
select tests.ph_user('o_stk', array['STK']) as stk \gset
select tests.ph_user('o_pho', array['PHO']) as pho \gset
select tests.ph_user('o_pho_phm', array['PHO', 'PHM']) as phophm \gset
select tests.ph_user('o_dec', array['DEC']) as dec \gset
select tests.ph_user('o_qci', array['QCI']) as qci \gset
select tests.ph_user('o_qcm', array['QCM']) as qcm \gset
select tests.ph_user('o_qao', array['QAO']) as qao \gset
select tests.ph_user('o_qam', array['QAM']) as qam \gset
select tests.ph_user('o_whm', array['WHM']) as whm \gset
select tests.ph_user('o_sal', array['SAL']) as sal \gset
select tests.ph_user('o_log', array['LOG']) as log \gset
select tests.ph_user('o_top', array['TOP']) as top \gset
select tests.ph_user('o_adm', array['ADM']) as adm \gset
select tests.create_user('o_outsider') as outsider \gset
select tests.grant_role(:'outsider', 'supervisor', 'agriculture');
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

-- ---------------------------------------------------------------------------------------------
-- Master data and the receiving decisions (as in the M2.1 / M2.2 tests)
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
select public.ph_set_location_group(tests.ph_id('ph_locations', 'F1'), tests.ph_id('ph_storage_groups', 'tomato_cherry'));
reset role;
select tests.ph_decide('OD-38', 'Data Entry Clerk inspects incoming vehicles', array['DEC'], array[:'top', :'phm', :'qam']::uuid[]);
select tests.ph_decide('OD-01', 'B', '{}', array[:'phm', :'whm', :'qam']::uuid[]);
select tests.ph_decide('OD-03', 'A', '{}', array[:'phm', :'whm', :'adm']::uuid[]);
select tests.ph_decide('OD-02', 'C', '{}', array[:'qam', :'phm']::uuid[]);
select tests.ph_decide('OD-17', 'A', '{}', array[:'qcm', :'phm']::uuid[]);
update public.ph_rule_parameters set value_text = '23:59' where farm_id = tests.farm() and code = 'last_harvest_receipt_time';

-- ---------------------------------------------------------------------------------------------
-- ST-00 order lines: Sales enters (C), PH management accepts or rejects with a reason (C)
select tests.as_user(:'pho');
select throws_ok($$ select public.ph_create_order_line(tests.order_line()) $$, 'P0403', null, 'an operator does not enter orders');
select tests.as_user(:'sal');
select throws_ok($$ select public.ph_create_order_line(tests.order_line() - 'customer_name' - 'market_type') $$, 'P0422', null,
  'FR-PL-01: customer and market type are mandatory');
select throws_ok($$ select public.ph_create_order_line(tests.order_line(jsonb_build_object('required_date', app.ph_local_date() - 1))) $$, 'P0422', null,
  'a required date in the past is refused');
select throws_ok($$ select public.ph_create_order_line(tests.order_line('{"quantity_unit":"t"}')) $$, 'P0422', null,
  'quantity is in kg or pieces');
select throws_ok($$ select public.ph_create_order_line(tests.order_line('{"grade":"extra"}')) $$, 'P0422', null, 'grade is Premium, GR1 or GR2');
select throws_ok($$ select public.ph_create_order_line(tests.order_line('{"market_type":"airfreight"}')) $$, 'P0422', null, 'market type is from the list');
select gen_random_uuid() as oreq \gset
select (public.ph_create_order_line(tests.order_line(), :'oreq') ->> 'id') as ol1 \gset
select is(public.ph_create_order_line(tests.order_line(), :'oreq') ->> 'id', :'ol1', 'a repeated order entry (same request id) returns the first line');
select is((select count(*)::int from public.ph_order_lines where farm_id = tests.farm()), 1, '… and creates no second line');
select is(tests.ol(:'ol1'), 'pending_acceptance', 'new line waits for acceptance');
select matches((select code from public.ph_order_lines where id = :'ol1'), '^OL-\d{6}-\d{4}$', 'code OL-YYMMDD-NNNN');
select is(tests.notifications(:'phm', 'ph_order_line_due'), 1, 'PH management is asked to decide');
select (public.ph_create_order_line(tests.order_line('{"customer_name":"Customer B (test)","grade":"gr1"}')) ->> 'id') as ol2 \gset
select (public.ph_create_order_line(tests.order_line('{"market_type":"export","quantity":40,"quantity_unit":"pc"}')) ->> 'id') as ol3 \gset

select throws_ok(format($$ select public.ph_decide_order_line(%L, 'accept') $$, :'ol1'), 'P0403', null, 'Sales does not accept its own order line');
select tests.as_user(:'phm');
set local role authenticated;
select throws_ok(format($$ select public.transition_record('ph_order_lines', %L, 'accepted', '{}', null) $$, :'ol1'), 'P0422', null,
  'the line cannot be accepted outside the decision function');
select throws_ok(format($$ update public.ph_order_lines set status = 'accepted' where id = %L $$, :'ol1'), '42501', null, 'no direct status write');
reset role;
select throws_ok(format($$ select public.ph_decide_order_line(%L, 'reject') $$, :'ol2'), 'P0422', null, 'a rejection needs a reason');
select is(public.ph_decide_order_line(:'ol2', 'reject', 'Not in season for GR1') ->> 'status', 'rejected', 'PHM rejects with a reason');
select is((select decision_reason from public.ph_order_lines where id = :'ol2'), 'Not in season for GR1', 'the reason is kept');
select is((select decided_by from public.ph_order_lines where id = :'ol2'), :'phm'::uuid, 'who decided is recorded');
select is(public.ph_decide_order_line(:'ol1', 'accept') ->> 'status', 'accepted', 'PHM accepts the line');
select throws_ok(format($$ select public.ph_decide_order_line(%L, 'accept') $$, :'ol1'), 'P0422', null, 'an accepted line is not decided again');
select throws_ok(format($$ select public.ph_decide_order_line(%L, 'accept') $$, :'ol2'), 'P0422', null, 'a rejected line is final');
select is(tests.notifications(:'sal', 'ph_order_decided'), 2, 'Sales hears both decisions');
select public.ph_decide_order_line(:'ol3', 'accept');

-- Amend (P) returns an accepted line to pending; cancel (P) needs a reason and no planned Job Cards.
select tests.as_user(:'sal');
select throws_ok(format($$ select public.ph_amend_order_line(%L, '{"quantity":50}', '') $$, :'ol3'), 'P0422', null, 'an amendment needs a reason');
select throws_ok(format($$ select public.ph_amend_order_line(%L, '{"quantity":0}', 'Fewer boxes') $$, :'ol3'), 'P0422', null, 'amended values are checked');
select is(public.ph_amend_order_line(:'ol3', '{"quantity":50}', 'Customer asked for 50 boxes') ->> 'status', 'pending_acceptance',
  'amending an accepted line returns it to pending acceptance');
select is((select quantity from public.ph_order_lines where id = :'ol3'), 50.00::numeric, 'the new quantity is stored');
select throws_ok(format($$ select public.ph_cancel_order_line(%L, '') $$, :'ol3'), 'P0422', null, 'a cancellation needs a reason');
select is(public.ph_cancel_order_line(:'ol3', 'Customer withdrew') ->> 'status', 'cancelled', 'Sales cancels the line');
select throws_ok(format($$ select public.ph_amend_order_line(%L, '{"quantity":60}', 'Again') $$, :'ol3'), 'P0422', null, 'a cancelled line is not amended');
select throws_ok(format($$ select public.ph_cancel_order_line(%L, 'Again') $$, :'ol2'), 'P0422', null, 'a rejected line is not cancelled');

-- FR-PL-04 shortage notice (24 h local / 48 h export, SOP-FC)
select throws_ok(format($$ select public.ph_flag_shortage(%L, 'Short by 50 kg') $$, :'ol1'), 'P0403', null, 'Sales does not flag the shortage');
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_flag_shortage(%L, '') $$, :'ol1'), 'P0422', null, 'the shortage must be described');
select throws_ok(format($$ select public.ph_flag_shortage(%L, 'Short') $$, :'ol3'), 'P0422', null, 'no shortage on a cancelled line');
select is((public.ph_flag_shortage(:'ol1', 'Short by 50 kg: rain stopped the harvest') ->> 'in_window')::boolean, true,
  'flagged five days ahead: inside the 24 h local notice window');
select is(tests.notifications(:'sal', 'ph_order_shortage') + tests.notifications(:'log', 'ph_order_shortage'), 2, 'Sales and Logistics are told');

-- ---------------------------------------------------------------------------------------------
-- Production for the order line
select tests.as_user(:'dec');
select (public.ph_create_arrival(jsonb_build_object('source_id', tests.ph_id('ph_sources', 'B3S07'), 'variety_id', tests.ph_id('ph_varieties', 'V1'),
  'vehicle_plate', '10-8', 'driver_name', 'D', 'harvest_date', app.ph_local_date(), 'harvest_time', '00:05', 'harvest_supervisor', 'S',
  'late_reason', 'test')) ->> 'id') as arr \gset
select public.ph_record_vehicle_inspection(:'arr', 'pass', '{"transport_conditions":"ok"}');
select public.ph_submit_arrival(:'arr');
select (public.ph_register_pallet(:'arr', jsonb_build_object('net_kg', 400, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code') as ip1 \gset
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
select throws_ok(format($$ select public.ph_create_job_card_for_order(%L, jsonb_build_object('line_id', tests.ph_line('A'))) $$, :'ol2'), 'P0422', null,
  'no production for a rejected line');
select throws_ok(format($$ select public.ph_create_job_card_for_order(%L, jsonb_build_object('line_id', tests.ph_line('A'))) $$, :'ol3'), 'P0422', null,
  'no production for a cancelled line');
select gen_random_uuid() as jreq \gset
select (public.ph_create_job_card_for_order(:'ol1', jsonb_build_object('line_id', tests.ph_line('A'), 'crop_id', gen_random_uuid(), 'grade_target', 'gr2'),
  :'jreq') ->> 'id') as jc \gset
select is(public.ph_create_job_card_for_order(:'ol1', jsonb_build_object('line_id', tests.ph_line('A')), :'jreq') ->> 'id', :'jc',
  'a repeated plan (same request id) returns the first Job Card');
select is((select count(*)::int from public.ph_job_cards where farm_id = tests.farm()), 1, '… one Job Card');
select is((select order_line_id from public.ph_job_cards where id = :'jc'), :'ol1'::uuid, 'the Job Card references the order line (V-10)');
select is((select grade_target || '/' || (crop_id = tests.ph_crop('cherry_tomato'))::text from public.ph_job_cards where id = :'jc'), 'premium/true',
  'crop and grade come from the order line, not the form');
select is((select job_card_codes from public.ph_order_board where id = :'ol1'), (select code from public.ph_job_cards where id = :'jc'), 'the order board lists it');
select tests.as_user(:'sal');
select throws_ok(format($$ select public.ph_cancel_order_line(%L, 'Withdrawn') $$, :'ol1'), 'P0422', null, 'a line with planned Job Cards is not cancelled');

select tests.as_user(:'phm');
select public.ph_approve_job_card(:'jc');
select tests.as_user(:'ll');
select public.ph_issue_to_job_card(:'jc', :'ip1', 400);
select tests.as_user(:'stk');
select public.ph_issue_packaging(:'jc', 'Punnet 250 g', 100);
select tests.as_user(:'ll');
select public.ph_mark_job_card_ready(:'jc');
select tests.as_user(:'qci');
select public.ph_line_start_check(:'jc', 'pass', '{}');
select tests.as_user(:'ll');
select public.ph_confirm_line_start(:'jc');
select tests.as_user(:'qci');
select public.ph_qc2_record(:'jc', 'final', 'pass', '{}');
select tests.as_user(:'pho');
select (public.ph_create_fg_pallet(:'jc', jsonb_build_object('box_count', 60, 'net_kg', 300, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'id') as fg1 \gset
select (public.ph_create_fg_pallet(:'jc', jsonb_build_object('box_count', 20, 'net_kg', 60, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'id') as fg2 \gset
select (public.ph_create_fg_pallet(:'jc', jsonb_build_object('box_count', 10, 'net_kg', 40, 'grade', 'gr1', 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'id') as fg3 \gset
select is((app.ph_fg_label_content(:'fg1') ->> 'customer') || ' / ' || (app.ph_fg_label_content(:'fg1') ->> 'order_line'),
  'Customer A (test) / ' || (select code from public.ph_order_lines where id = :'ol1'), 'the FG label carries the customer and order line');
select tests.as_user(:'qci');
select public.ph_fg_qc_approve(x) from unnest(array[:'fg1', :'fg2', :'fg3']::uuid[]) x;
select tests.as_user(:'pho');
select public.ph_move_fg_pallet(code, tests.ph_id('ph_locations', 'F1')) from public.ph_fg_pallets where id in (:'fg1', :'fg2', :'fg3');
select is((select count(*)::int from public.ph_fg_pallets where job_card_id = :'jc' and status = 'in_storage'), 3, 'three finished pallets in F1');
select is((select fg_pallets::int || '/' || fg_kg from public.ph_order_board where id = :'ol1'), '3/400.00', 'the order board shows what is packed for it');

-- ---------------------------------------------------------------------------------------------
-- Split (FR-FG-04): the operator requests with the quantities, the PHM approves; approval executes.
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_request_fg_split(%L, '[{"box_count":30,"net_kg":150},{"box_count":30,"net_kg":150}]', 'Two orders') $$, :'fg1'),
  'P0403', null, 'the split is executed by the operator, not requested by the PHM');
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_request_fg_split(%L, '[{"box_count":60,"net_kg":300}]', 'One') $$, :'fg1'), 'P0422', null,
  'a split makes two or more pallets');
select throws_ok(format($$ select public.ph_request_fg_split(%L, '[{"box_count":30,"net_kg":150},{"box_count":20,"net_kg":150}]', 'Two') $$, :'fg1'), 'P0422', null,
  'the children must add up to the parent');
select throws_ok(format($$ select public.ph_request_fg_split(%L, '[{"box_count":30,"net_kg":150},{"box_count":30,"net_kg":150}]', '') $$, :'fg1'), 'P0422', null,
  'a split needs a reason');
select gen_random_uuid() as sreq \gset
select (public.ph_request_fg_split(:'fg1', '[{"box_count":40,"net_kg":200},{"box_count":20,"net_kg":100}]', 'Two delivery drops', :'sreq') ->> 'id') as sp \gset
select is(public.ph_request_fg_split(:'fg1', '[{"box_count":40,"net_kg":200},{"box_count":20,"net_kg":100}]', 'Two delivery drops', :'sreq') ->> 'id', :'sp',
  'a repeated split request (same request id) is the same request');
select is((select count(*)::int from public.ph_fg_changes where farm_id = tests.farm()), 1, '… one request');
select throws_ok(format($$ select public.ph_request_fg_split(%L, '[{"box_count":30,"net_kg":150},{"box_count":30,"net_kg":150}]', 'Again') $$, :'fg1'), 'P0422', null,
  'one open request per pallet');
select is((select a -> 'reason' ->> 'key' from jsonb_array_elements(public.ph_fg_pallet_actions(:'fg1')) a where a ->> 'action' = 'split'),
  'ph.fg.changePending', 'the record view says a request is open');
select is(tests.notifications(:'phm', 'ph_fg_change_due'), 1, 'the PHM is asked to approve');
select is(tests.fgs(:'fg1'), 'in_storage', 'nothing changes until the PHM approves');
select throws_ok(format($$ select public.ph_decide_fg_change(%L, 'approve') $$, :'sp'), 'P0403', null, 'the operator does not approve');
set local role authenticated;
select throws_ok(format($$ select public.transition_record('ph_fg_changes', %L, 'approved', '{}', null) $$, :'sp'), 'P0403', null,
  'no approval outside the decision function');
reset role;
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_decide_fg_change(%L, 'reject') $$, :'sp'), 'P0422', null, 'a rejection needs a reason');
select ok((public.ph_decide_fg_change(:'sp', 'approve', 'Checked on the floor') -> 'pallets') is not null, 'PHM approves the split');
select is(tests.fgc(:'sp'), 'approved', 'request approved and done');
select is((select decided_by from public.ph_fg_changes where id = :'sp'), :'phm'::uuid, 'who approved is recorded');
select is(tests.fgs(:'fg1'), 'split_merged', 'the parent pallet is closed as split');
select is((select count(*)::int from public.ph_fg_pallet_links where parent_id = :'fg1' and kind = 'split'), 2, 'two children are linked to it');
select is((select string_agg(box_count || ':' || net_kg, ',' order by net_kg) from public.ph_fg_pallets f
            where id in (select child_id from public.ph_fg_pallet_links where parent_id = :'fg1')), '20:100.00,40:200.00', 'children have the requested quantities');
select is((select count(*)::int from public.ph_fg_pallets f join public.ph_fg_pallets p on p.id = :'fg1'
            where f.id in (select child_id from public.ph_fg_pallet_links where parent_id = :'fg1')
              and f.status = 'in_storage' and f.location_id = p.location_id and f.qc_approved_at = p.qc_approved_at
              and f.qc_stamp_from = p.id and f.job_card_id = p.job_card_id and f.grade = p.grade), 2,
  'children inherit storage, the QC stamp (and its 24 h clock), Job Card and grade');
select is((select count(*)::int from public.ph_fg_board b where b.id in (select child_id from public.ph_fg_pallet_links where parent_id = :'fg1')
            and b.qc_approved_by_name = (select full_name from public.user_profiles where id = :'qci')), 2,
  '… and show who stamped the original pallet');
select is((select qc_approved_by from public.ph_fg_pallets where id in (select child_id from public.ph_fg_pallet_links where parent_id = :'fg1') limit 1), null,
  '… without writing the step''s actor column');
select is((select sum(l.kg) from public.ph_fg_pallet_lots l where l.fg_pallet_id in (select child_id from public.ph_fg_pallet_links where parent_id = :'fg1')),
  (select sum(kg) from public.ph_fg_pallet_lots where fg_pallet_id = :'fg1'), 'the composition is split pro rata, nothing lost or added');
select throws_ok(format($$ select public.ph_decide_fg_change(%L, 'approve') $$, :'sp'), 'P0422', null, 'an approved request is not decided again');
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_request_fg_split(%L, '[{"box_count":30,"net_kg":150},{"box_count":30,"net_kg":150}]', 'Again') $$, :'fg1'), 'P0422', null,
  'a split pallet cannot be split again');

-- SoD: a person holding both roles does not approve their own request.
select tests.as_user(:'phophm');
select (public.ph_request_fg_split(:'fg2', '[{"box_count":10,"net_kg":30},{"box_count":10,"net_kg":30}]', 'Half pallets') ->> 'id') as sp2 \gset
select throws_ok(format($$ select public.ph_decide_fg_change(%L, 'approve') $$, :'sp2'), 'P0423', null, 'the requester does not approve their own split');
select tests.as_user(:'phm');
select is(public.ph_decide_fg_change(:'sp2', 'reject', 'Keep full pallets') ->> 'status', 'rejected', 'the PHM rejects with a reason');
select is(tests.fgs(:'fg2'), 'in_storage', 'a rejected split leaves the pallet as it was');

-- ---------------------------------------------------------------------------------------------
-- Merge (FR-FG-05, V-22): same crop, grade, customer and storage group; from the same Job Card.
select tests.as_user(:'pho');
select (select array_agg(child_id order by child_id) from public.ph_fg_pallet_links where parent_id = :'fg1')::text as kids \gset
select throws_ok(format($$ select public.ph_request_fg_merge(array[%L]::uuid[], 'One') $$, :'fg2'), 'P0422', null, 'a merge takes two or more pallets');
select throws_ok(format($$ select public.ph_request_fg_merge(array[%L, %L]::uuid[], 'Mixed') $$, :'fg2', :'fg3'), 'P0422', null,
  'V-22: different grades are not merged');
select throws_ok(format($$ select public.ph_request_fg_merge(array[%L, %L]::uuid[], 'Closed') $$, :'fg1', :'fg2'), 'P0422', null,
  'a closed (split) pallet is not merged');
select throws_ok(format($$ select public.ph_request_fg_merge(%L::uuid[], '') $$, :'kids'), 'P0422', null, 'a merge needs a reason');
select (public.ph_request_fg_merge(:'kids'::uuid[], 'Customer took a full pallet after all') ->> 'id') as mg \gset
select tests.as_user(:'phm');
select is(jsonb_array_length(public.ph_decide_fg_change(:'mg', 'approve') -> 'pallets'), 1, 'PHM approves: one merged pallet');
select (select (result_ids)[1] from public.ph_fg_changes where id = :'mg') as merged \gset
select is((select box_count || ':' || net_kg from public.ph_fg_pallets where id = :'merged'), '60:300.00', 'the merged pallet holds both');
select is((select count(*)::int from public.ph_fg_pallets where id = any (:'kids'::uuid[]) and status = 'split_merged'), 2, 'both merged pallets are closed');
select is((select sum(kg) from public.ph_fg_pallet_lots where fg_pallet_id = :'merged'), 300.00::numeric, 'composition carried over');

-- Trace through the split and the merge, to the order line and customer
select is((select jsonb_agg(f ->> 'code' order by f ->> 'code') from jsonb_array_elements(public.ph_backward_trace((select code from public.ph_fg_pallets where id = :'merged')) -> 'fg_pallets') f)
           @> (select jsonb_agg(code) from public.ph_fg_pallets where id in (:'fg1', :'merged')), true,
  'the trace of the merged pallet reaches the original pallet through the split');
select is(public.ph_backward_trace((select code from public.ph_fg_pallets where id = :'merged')) -> 'pallets' -> 0 ->> 'code', :'ip1',
  '… and back to the incoming pallet');
select is(public.ph_backward_trace((select code from public.ph_fg_pallets where id = :'merged')) -> 'job_cards' -> 0 ->> 'customer', 'Customer A (test)',
  '… and to the order line''s customer');
select is(jsonb_array_length(public.ph_backward_trace((select code from public.ph_order_lines where id = :'ol1')) -> 'job_cards'), 1,
  'an order line code traces to its Job Card');

-- ---------------------------------------------------------------------------------------------
-- FR-PL-03 daily plan and the board
select is((select count(*)::int from jsonb_array_elements(public.ph_daily_plan() -> 'order_lines')), 1, 'the plan lists the open accepted line');
select is((select count(*)::int from jsonb_array_elements(public.ph_daily_plan() -> 'lines') l, jsonb_array_elements(l -> 'job_cards') j
            where j ->> 'order_line' = (select code from public.ph_order_lines where id = :'ol1')), 1, '… the Job Card on its line');
select is((select (x ->> 'released_kg')::numeric from jsonb_array_elements(public.ph_daily_plan() -> 'raw_stock') x), 380.00::numeric,
  '… the raw stock still released (the 380 kg pallet)');
select is((select sum((x ->> 'kg')::numeric) from jsonb_array_elements(public.ph_daily_plan() -> 'fg_stock') x), 400.00::numeric, '… and the finished stock');
select is((select total::int from public.ph_stage_counts() where stage = 'orders'), 1, 'the board counts open order lines');

-- ---------------------------------------------------------------------------------------------
-- RLS, audit and the real farm
select tests.as_user(:'outsider');
set local role authenticated;
select is((select count(*)::int from public.ph_order_lines) + (select count(*)::int from public.ph_order_board) + (select count(*)::int from public.ph_fg_changes)
          + (select count(*)::int from public.ph_fg_pallet_links) + (select count(*)::int from public.ph_fg_change_board)
          + (select count(*)::int from public.ph_jc_order), 0, 'an outsider sees no order, split or merge');
select is(jsonb_array_length(public.ph_daily_plan() -> 'order_lines'), 0, '… and an empty plan');
reset role;
select tests.as_user(:'sal');
set local role authenticated;
select throws_ok(format($$ insert into public.ph_order_lines (farm_id, code, customer_name, crop_id, grade, pack_spec, quantity, quantity_unit_id, required_date, market_type)
  values (%L, 'X', 'X', %L, 'gr1', 'x', 1, (select id from public.units limit 1), current_date + 3, 'local') $$, tests.farm(), tests.ph_crop('cherry_tomato')),
  '42501', null, 'no direct insert of order lines');
select throws_ok($$ delete from public.ph_fg_pallet_links $$, '42501', null, 'no delete of split / merge links');
select is((select count(*)::int from public.ph_fg_change_board), 3, 'members read split / merge requests');
reset role;
select is((select count(*)::int from public.audit_events where entity_type = 'ph_order_lines' and entity_id = :'ol3'::uuid) >= 3, true,
  'order-line changes are in the audit trail');
update public.settings set value = 'false' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';
select tests.as_user(:'sal');
select isnt(public.ph_create_order_line(tests.order_line()) ->> 'id', null, 'on a real farm Sales still enters orders (documented cell)');
select throws_ok(format($$ select public.ph_amend_order_line(%L, '{"quantity":250}', 'Less') $$, :'ol1'), 'P0403', null,
  'on a real farm amendment is a proposal and refused');
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_request_fg_split(%L, '[{"box_count":10,"net_kg":30},{"box_count":10,"net_kg":30}]', 'Half') $$, :'fg2'), 'P0403', null,
  'on a real farm split / merge is a proposal and refused');

select * from finish();
rollback;
