-- Packing house M2.1: production (ST-08), line start (G5), QC-2 (ST-09, G6), finished-goods pallets (ST-10) into storage.
-- Acceptance scenarios T-08 (one pallet split across two Job Cards), T-09 (line start fail → correct → pass) and T-10 (QC-2
-- fail → re-sort task for PHM/PE, not the operators), V-05, V-07, V-09, V-10, the two-person line start, RLS and audit.
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
  execute format('select id from public.%I where farm_id = tests.farm() and code = $1 and voided_at is null', p_table) into v using p_code;
  return v;
end $$;
create function tests.ph_status(p_code text) returns text language sql as $$
  select status from public.ph_incoming_pallets where farm_id = tests.farm() and code = p_code $$;
create function tests.jc_status(p_id uuid) returns text language sql as $$ select status from public.ph_job_cards where id = p_id $$;
create function tests.fg_status(p_id uuid) returns text language sql as $$ select status from public.ph_fg_pallets where id = p_id $$;
create function tests.ph_crop(p_code text) returns uuid language sql as $$
  select id from public.ph_crops where farm_id = tests.farm() and code = p_code and superseded_at is null and voided_at is null $$;
create function tests.ph_line(p_code text) returns uuid language sql as $$
  select id from public.ph_lines where farm_id = tests.farm() and code = p_code and voided_at is null $$;
create function tests.jc_input(p_jc uuid, p_pallet text) returns uuid language sql as $$
  select i.id from public.ph_jc_inputs i join public.ph_incoming_pallets p on p.id = i.pallet_id
   where i.job_card_id = p_jc and p.code = p_pallet and i.closed_at is null $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- People
select tests.ph_user('m_phm', array['PHM']) as phm \gset
select tests.ph_user('m_pe', array['PE']) as pe \gset
select tests.ph_user('m_ll', array['LL']) as ll \gset
select tests.ph_user('m_stk', array['STK']) as stk \gset
select tests.ph_user('m_pho', array['PHO']) as pho \gset
select tests.ph_user('m_dec', array['DEC']) as dec \gset
select tests.ph_user('m_qci', array['QCI']) as qci \gset
select tests.ph_user('m_qci2', array['QCI']) as qci2 \gset
select tests.ph_user('m_qcm', array['QCM']) as qcm \gset
select tests.ph_user('m_qao', array['QAO']) as qao \gset
select tests.ph_user('m_qam', array['QAM']) as qam \gset
select tests.ph_user('m_whm', array['WHM']) as whm \gset
select tests.ph_user('m_top', array['TOP']) as top \gset
select tests.ph_user('m_adm', array['ADM']) as adm \gset
select tests.ph_user('m_ll_qci', array['LL', 'QCI']) as llqci \gset
select tests.create_user('m_outsider') as outsider \gset
select tests.grant_role(:'outsider', 'supervisor', 'agriculture');
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

-- ---------------------------------------------------------------------------------------------
-- Receiving fixture: three cherry-tomato pallets through M1 to QC-1 release (two released, one kept stored).
select app.ph_load_sop_reference(tests.farm());
select tests.as_user(:'adm');
select public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"B3S07","name_ar":"قطعة 3 قسم 7","block_code":"3","section_code":"7"}');
select public.ph_save_master('ph_varieties', null, '{"crop_code":"cherry_tomato","code":"V1","name_ar":"صنف اختبار"}');
select tests.as_user(:'phm');
select public.ph_approve_master('ph_crops', tests.ph_crop(c), 'Checked') from unnest(array['cherry_tomato', 'regular_tomato']) c;
select public.ph_approve_master('ph_locations', id, 'Checked') from public.ph_locations where farm_id = tests.farm();
select public.ph_approve_master('ph_equipment', id, 'Checked') from public.ph_equipment where farm_id = tests.farm();
select public.ph_approve_master('ph_sources', id, 'Checked') from public.ph_sources where farm_id = tests.farm();
select public.ph_approve_master('ph_varieties', id, 'Checked') from public.ph_varieties where farm_id = tests.farm();
select public.ph_approve_master('ph_lines', tests.ph_line(l), 'Line on the floor') from unnest(array['WASHER', 'A', 'B']) l;
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
  'vehicle_plate', '10-7', 'driver_name', 'D', 'harvest_date', app.ph_local_date(), 'harvest_time', '00:05', 'harvest_supervisor', 'S',
  'late_reason', 'test')) ->> 'id') as arr \gset
select public.ph_record_vehicle_inspection(:'arr', 'pass', '{"transport_conditions":"ok"}');
select public.ph_submit_arrival(:'arr');
select (public.ph_register_pallet(:'arr', jsonb_build_object('net_kg', 400, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code') as ip1 \gset
select (public.ph_register_pallet(:'arr', jsonb_build_object('net_kg', 396, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code') as ip2 \gset
select (public.ph_register_pallet(:'arr', jsonb_build_object('net_kg', 402, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code') as ip3 \gset
select tests.as_user(:'qci');
select public.ph_record_arrival_check(:'arr', '{"insects":"none"}',
  (select jsonb_agg(jsonb_build_object('pallet_id', id, 'result', 'pass')) from public.ph_incoming_pallets where arrival_id = :'arr'), 9.5, null);
select tests.as_user(:'pho');
select public.ph_precool_scan(x, 'in'), public.ph_precool_scan(x, 'out') from unnest(array[:'ip1', :'ip2', :'ip3']) x;
select tests.as_user(:'qao');
select (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'Sample') ->> 'id') as photo \gset
select public.ph_submit_rma((select array_agg(id) from public.ph_incoming_pallets where arrival_id = :'arr'), 'accept', '{}', 9, null, null, array[:'photo']::uuid[]);
select tests.as_user(:'pho');
select public.ph_move_pallet(x, tests.ph_id('ph_locations', 'HF')) from unnest(array[:'ip1', :'ip2', :'ip3']) x;
select tests.as_user(:'qci');
select public.ph_qc1_release(array[tests.ph_id('ph_incoming_pallets', :'ip1'), tests.ph_id('ph_incoming_pallets', :'ip2')], '{"quality_grading":"ok"}');
reset role;
select is(array[tests.ph_status(:'ip1'), tests.ph_status(:'ip2'), tests.ph_status(:'ip3')], array['released', 'released', 'stored'],
  'fixture: two pallets released by QC-1, one stored');
select isnt((select lot_id from public.ph_incoming_pallets where code = :'ip1'), null, 'fixture: pallets carry a raw lot (OD-02 = C)');

-- ---------------------------------------------------------------------------------------------
-- Checklists come from the product SOPs, crop by crop
select is((select source from public.ph_inspection_templates where farm_id = tests.farm() and inspection_type = 'line_start' and crop_code = 'cherry_tomato'),
  'SOP Cherry Tomato §8 (draft 001)', 'line-start checklist for cherry tomato cites its SOP');
select is((select evidence from public.ph_inspection_templates where farm_id = tests.farm() and inspection_type = 'line_start' and crop_code is null),
  'NYV', 'the generic line-start checklist (no SOP for the crop) is Not Yet Verified');
select is((select inspection_type from public.ph_inspection_templates where id = app.ph_template_for(tests.farm(), 'qc2', tests.ph_crop('cherry_tomato'))
            and crop_code = 'cherry_tomato'), 'qc2', 'the crop-specific QC-2 checklist is preferred');
select is((select crop_code from public.ph_inspection_templates where id = app.ph_template_for(tests.farm(), 'qc2', tests.ph_crop('eggplant'))),
  null, 'a crop without an SOP falls back to the QC Function items');

-- ---------------------------------------------------------------------------------------------
-- ST-08 Job Card: create (PE / PHM), approve (PHM)
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_create_job_card(jsonb_build_object('line_id', %L, 'crop_id', %L, 'grade_target', 'premium')) $$,
  tests.ph_line('A'), tests.ph_crop('cherry_tomato')), 'P0403', null, 'an operator cannot create a Job Card');
select tests.as_user(:'pe');
select throws_ok(format($$ select public.ph_create_job_card(jsonb_build_object('line_id', %L, 'crop_id', %L)) $$,
  tests.ph_line('A'), tests.ph_crop('cherry_tomato')), 'P0422', null, 'a Job Card needs a grade target');
select throws_ok(format($$ select public.ph_create_job_card(jsonb_build_object('line_id', %L, 'crop_id', %L, 'grade_target', 'premium')) $$,
  tests.ph_line('B'), tests.ph_crop('cherry_tomato')), 'P0422', null, 'cherry tomato is routed to Line A only (Figure 4.2)');
select throws_ok(format($$ select public.ph_create_job_card(jsonb_build_object('line_id', %L, 'crop_id', %L, 'grade_target', 'premium')) $$,
  tests.ph_line('WASHER'), tests.ph_crop('cherry_tomato')), 'P0422', null, 'the washer is not a packing line');
select throws_ok(format($$ select public.ph_create_job_card(jsonb_build_object('line_id', %L, 'crop_id', %L, 'grade_target', 'premium')) $$,
  tests.ph_line('C'), tests.ph_crop('sweetbite')), 'P0422', null, 'an unapproved line or crop cannot be planned');
select throws_ok(format($$ select public.ph_create_job_card(jsonb_build_object('line_id', %L, 'crop_id', %L, 'grade_target', 'gr3')) $$,
  tests.ph_line('A'), tests.ph_crop('cherry_tomato')), 'P0422', null, 'V-10: grade is Premium, GR1 or GR2');
select (public.ph_create_job_card(jsonb_build_object('line_id', tests.ph_line('A'), 'crop_id', tests.ph_crop('cherry_tomato'), 'grade_target', 'premium',
  'notes', 'Morning run'))) as jc1r \gset
select ok((:'jc1r'::jsonb ->> 'code') ~ ('^JC-' || to_char(app.ph_local_date(), 'YYMMDD') || '-A-01$'), 'Job Card number is JC-YYMMDD-<line>-NN');
select (:'jc1r'::jsonb ->> 'id') as jc1 \gset
select (public.ph_create_job_card(jsonb_build_object('line_id', tests.ph_line('A'), 'crop_id', tests.ph_crop('cherry_tomato'), 'grade_target', 'gr1')) ->> 'id') as jc2 \gset
select is(tests.jc_status(:'jc1'), 'draft', 'a new Job Card is a draft');
select is(tests.notifications(:'phm', 'ph_jc_approval_due'), 2, 'the PHM is asked to approve');
set local role authenticated;
select throws_ok(format($$ insert into public.ph_job_cards (farm_id, code, line_id, crop_id, planned_date) values (%L, 'X', %L, %L, current_date) $$,
  tests.farm(), tests.ph_line('A'), tests.ph_crop('cherry_tomato')), '42501', null, 'no direct insert: Job Cards are created by the server');
select throws_ok(format($$ update public.ph_job_cards set notes = 'x' where id = %L $$, :'jc1'), '42501', null, 'no direct update');
reset role;
select throws_ok(format($$ select public.ph_approve_job_card(%L) $$, :'jc1'), 'P0403', null, 'the PE cannot approve (PHM only)');
select tests.as_user(:'phm');
select throws_ok(format($$ select public.transition_record('ph_job_cards', %L, 'planned') $$, :'jc1'), 'P0422', null,
  'the generic transition endpoint cannot move a Job Card, even for the PHM (server function only)');
select is(public.ph_approve_job_card(:'jc1') ->> 'status', 'planned', 'PHM approves: Planned');
select is((select approved_by from public.ph_job_cards where id = :'jc1'), :'phm'::uuid, 'approver recorded');
select is((select permission_basis from public.record_transitions where entity_id = :'jc1' and to_status = 'planned'), 'job_card.approve P:PHM',
  'history records the matrix cell (proposed) used');
select throws_ok(format($$ select public.ph_approve_job_card(%L) $$, :'jc1'), 'P0422', null, 'a planned Job Card cannot be approved again');
select public.ph_approve_job_card(:'jc2');
select is(tests.notifications(:'stk', 'ph_packaging_due'), 2, 'the store keeper is asked for packaging');

-- ---------------------------------------------------------------------------------------------
-- Inputs: V-05, partial issue (GEN-04, T-08)
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_issue_to_job_card(%L, %L, 100) $$, :'jc1', :'ip1'), 'P0403', null, 'an operator does not issue inputs');
select tests.as_user(:'ll');
select throws_ok(format($$ select public.ph_issue_to_job_card(%L, %L, 100) $$, :'jc1', :'ip3'), 'P0422', null,
  'V-05: a pallet not released by QC-1 cannot be issued');
select is((public.ph_issue_to_job_card(:'jc1', :'ip1', 250)) ->> 'available_after', '150.00', 'LL issues 250 kg of pallet 1 to Job Card 1');
select is(tests.ph_status(:'ip1'), 'issued', 'the pallet is Issued');
select throws_ok(format($$ select public.ph_issue_to_job_card(%L, %L, 10) $$, :'jc1', :'ip1'), 'P0422', null, 'the same pallet cannot be issued twice to one Job Card');
select throws_ok(format($$ select public.ph_issue_to_job_card(%L, %L, 151) $$, :'jc2', :'ip1'), 'P0422', null, 'cannot issue more than remains');
select is((public.ph_issue_to_job_card(:'jc2', :'ip1', 150)) ->> 'issued_kg', '150', 'T-08: the remaining 150 kg go to Job Card 2');
select is((select available_kg from public.ph_ip_board where code = :'ip1'), 0.00, 'nothing left to issue from pallet 1');
select lives_ok(format($$ select public.ph_issue_to_job_card(%L, %L) $$, :'jc1', :'ip2'), 'pallet 2 issued whole');
select throws_ok(format($$ select public.ph_issue_packaging(%L, 'Clamshell 250 g', 400) $$, :'jc1'), 'P0403', null, 'the Line Leader does not issue packaging (SOP-PL: store keeper)');
select throws_ok(format($$ select public.ph_mark_job_card_ready(%L) $$, :'jc1'), 'P0422', null, 'not Ready without packaging');
select tests.as_user(:'stk');
select throws_ok(format($$ select public.ph_issue_packaging(%L, '', 400) $$, :'jc1'), 'P0422', null, 'packaging needs a description');
select lives_ok(format($$ select public.ph_issue_packaging(%L, 'Clamshell 250 g', 400) $$, :'jc1'), 'store keeper issues packaging');
select lives_ok(format($$ select public.ph_issue_packaging(%L, 'Carton', 40) $$, :'jc2'), '… to both Job Cards');
reset role;
select throws_ok($$ update public.ph_jc_packaging set quantity = 1 $$, 'P0403', null, 'packaging issues are append-only');
select tests.as_user(:'pe');
select throws_ok(format($$ select public.ph_mark_job_card_ready(%L) $$, :'jc1'), 'P0403', null, 'the PE does not execute the Job Card');
select tests.as_user(:'ll');
select is(public.ph_mark_job_card_ready(:'jc1') ->> 'status', 'ready', 'LL: Ready (inputs and packaging present)');
select throws_ok(format($$ select public.ph_mark_job_card_ready(%L) $$, :'jc1'), 'P0422', null, 'already Ready');

-- ---------------------------------------------------------------------------------------------
-- G5 line start: T-09 (fail → correct → pass) and the two-person rule (QC + Line Leader)
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_line_start_check(%L, 'pass', '{}') $$, :'jc1'), 'P0403', null, 'an operator cannot record the line-start check');
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_line_start_check(%L, 'fail', '{}') $$, :'jc1'), 'P0422', null, 'a failed check needs a reason');
select is(public.ph_line_start_check(:'jc1', 'fail', '{"line_clean":"not ok"}', 'Residue on conveyor') ->> 'result', 'fail', 'QC records a failed line start');
select is(tests.jc_status(:'jc1'), 'line_check_failed', 'T-09: Job Card blocked (line check failed)');
select is(tests.notifications(:'phm', 'ph_line_start_failed') + tests.notifications(:'pe', 'ph_line_start_failed'), 2, 'PHM and PE alerted (E-09)');
select is((select count(*)::int from public.ph_exception_items where rule = 'E-09' and entity_id = :'jc1'), 1, '… and it is on the exception board');
select throws_ok(format($$ select public.ph_confirm_line_start(%L) $$, :'jc1'), 'P0422', null, 'a failed check cannot be confirmed');
select tests.as_user(:'ll');
select throws_ok(format($$ select public.ph_line_check_corrected(%L, '') $$, :'jc1'), 'P0422', null, 'the correction must be described');
select is(public.ph_line_check_corrected(:'jc1', 'Conveyor cleaned') ->> 'status', 'ready', 'LL corrects: back to Ready');
select tests.as_user(:'qci');
select is(public.ph_line_start_check(:'jc1', 'pass', '{"sorter_calibration":"ok","line_clean":"ok","packer_settings":"ok","packaging_ok":"ok"}') ->> 'result',
  'pass', 'QC records a passed line start');
select is((select t.crop_code from public.ph_inspections i join public.ph_inspection_templates t on t.id = i.template_id
            where i.job_card_id = :'jc1' and i.inspection_type = 'line_start' and i.result = 'pass'), 'cherry_tomato', 'recorded against the cherry tomato SOP checklist');
select is(tests.jc_status(:'jc1'), 'ready', 'still Ready until the second person confirms');
select is(tests.notifications(:'ll', 'ph_line_start_confirm'), 1, 'the Line Leader is asked to confirm');
select throws_ok(format($$ select public.ph_line_start_check(%L, 'pass', '{}') $$, :'jc1'), 'P0422', null, 'the check is recorded once');
select throws_ok(format($$ select public.ph_confirm_line_start(%L) $$, :'jc1'), 'P0423', null, 'the recorder cannot confirm their own check');
select tests.as_user(:'qci2');
select throws_ok(format($$ select public.ph_confirm_line_start(%L) $$, :'jc1'), 'P0423', null, 'a second QC is not enough: QC and Line Leader together');
select tests.as_user(:'ll');
select is(public.ph_confirm_line_start(:'jc1') ->> 'status', 'in_progress', 'LL confirms: In progress');
select is((select started_by from public.ph_job_cards where id = :'jc1'), :'ll'::uuid, 'who started the line is recorded');
-- The same person holding both roles still cannot be both signatures.
select tests.as_user(:'stk');
select public.ph_issue_packaging(:'jc2', 'Clamshell 250 g', 100);
select tests.as_user(:'llqci');
select public.ph_mark_job_card_ready(:'jc2');
select public.ph_line_start_check(:'jc2', 'pass', '{}');
select throws_ok(format($$ select public.ph_confirm_line_start(%L) $$, :'jc2'), 'P0423', null, 'one person with both roles cannot sign twice');
select is((select a -> 'reason' ->> 'key' from jsonb_array_elements(public.ph_job_card_actions(:'jc2')) a where a ->> 'action' = 'confirm_start'),
  'ph.sod', 'the record view explains why');
select tests.as_user(:'ll');
select is((select (a ->> 'allowed')::boolean from jsonb_array_elements(public.ph_job_card_actions(:'jc2')) a where a ->> 'action' = 'confirm_start'),
  true, 'another Line Leader may confirm');
select public.ph_confirm_line_start(:'jc2');

-- ---------------------------------------------------------------------------------------------
-- Pause / resume
select throws_ok(format($$ select public.ph_pause_job_card(%L, '') $$, :'jc1'), 'P0422', null, 'a pause needs a reason');
select is(public.ph_pause_job_card(:'jc1', 'Breakdown') ->> 'status', 'paused', 'LL pauses the line');
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_qc2_record(%L, 'online', 'pass', '{}') $$, :'jc1'), 'P0422', null, 'no QC-2 on a paused line');
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_resume_job_card(%L) $$, :'jc1'), 'P0403', null, 'an operator cannot resume');
select tests.as_user(:'ll');
select is(public.ph_resume_job_card(:'jc1') ->> 'status', 'in_progress', 'LL resumes');

-- ---------------------------------------------------------------------------------------------
-- ST-09 QC-2 (G6) and T-10
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_create_fg_pallet(%L, jsonb_build_object('box_count', 70, 'net_kg', 180, 'scale_id', %L)) $$,
  :'jc1', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0422', null, 'G6: no finished pallet before a QC-2 final pass');
select throws_ok(format($$ select public.ph_qc2_record(%L, 'online', 'pass', '{}') $$, :'jc1'), 'P0403', null, 'only QC records QC-2');
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_qc2_record(%L, 'online', 'fail', '{}') $$, :'jc1'), 'P0422', null, 'a failed QC-2 needs a reason');
select is(public.ph_qc2_record(:'jc1', 'online', 'fail', '{"critical_defects":"cracks"}', 'n = 2.5 %', 'Cracked fruit in punnets') ->> 'result',
  'fail', 'QC-2 online inspection fails');
select is(tests.notifications(:'phm', 'ph_qc2_failed') + tests.notifications(:'pe', 'ph_qc2_failed'), 2,
  'T-10: the re-sort task goes to PHM and PE');
select is(tests.notifications(:'pho', 'ph_qc2_failed') + tests.notifications(:'ll', 'ph_qc2_failed'), 0, '… not to the operators');
select is((select count(*)::int from public.ph_exception_items where rule = 'E-10' and entity_id = :'jc1'), 1, 'QC-2 fail is on the exception board');
select is(public.ph_qc2_record(:'jc1', 'final', 'pass', '{"sorting_spec":"ok"}') ->> 'tolerance_basis', 'no_tolerance_set',
  'after re-sort, the final inspection passes, recorded as "no tolerance set" (no grading standard supplied, OD-05/06)');
select is((select count(*)::int from public.ph_exception_items where rule = 'OD-06' and code = (select qc2_code from public.ph_jc_board where id = :'jc1')),
  1, 'a pass without a tolerance is listed for QA review');

-- ---------------------------------------------------------------------------------------------
-- ST-10 Finished-goods pallet
select throws_ok(format($$ select public.ph_create_fg_pallet(%L, jsonb_build_object('box_count', 70, 'net_kg', 180, 'scale_id', %L)) $$,
  :'jc1', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0403', null, 'QC does not create finished pallets');
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_create_fg_pallet(%L, jsonb_build_object('box_count', 70, 'net_kg', 180, 'scale_id', %L, 'grade', 'gr3')) $$,
  :'jc1', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0422', null, 'V-10: a grade outside Premium/GR1/GR2 is refused');
select throws_ok(format($$ select public.ph_create_fg_pallet(%L, jsonb_build_object('box_count', 70, 'net_kg', 0, 'scale_id', %L)) $$,
  :'jc1', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0422', null, 'net weight above zero');
select throws_ok(format($$ select public.ph_create_fg_pallet(%L, jsonb_build_object('box_count', 70, 'net_kg', 180)) $$, :'jc1'), 'P0422', null,
  'the scale is required');
select (public.ph_create_fg_pallet(:'jc1', jsonb_build_object('box_count', 70, 'net_kg', 180, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1')))) as fg1r \gset
select ok((:'fg1r'::jsonb ->> 'code') ~ ('^FGP-' || to_char(app.ph_local_date(), 'YYMMDD') || '-[0-9]{5}$'), 'pallet number FGP-YYMMDD-NNNNN');
select (:'fg1r'::jsonb ->> 'id') as fg1 \gset
select is(tests.fg_status(:'fg1'), 'created', 'finished pallet Created');
select is((select grade from public.ph_fg_pallets where id = :'fg1'), 'premium', 'grade taken from the Job Card target');
select is((select plausibility_note from public.ph_fg_pallets where id = :'fg1'), 'Not checked: plausibility tolerance pending OD-29',
  'no plausibility check while OD-29 is open');
select is((select count(*)::int from public.ph_fg_pallet_lots where fg_pallet_id = :'fg1'), 2, 'composition: both incoming pallets of the Job Card');
select is((select sum(share) from public.ph_fg_pallet_lots where fg_pallet_id = :'fg1'), 1.0000, 'shares add up to 1');
select is((select kg from public.ph_fg_pallet_lots l join public.ph_incoming_pallets p on p.id = l.pallet_id where l.fg_pallet_id = :'fg1' and p.code = :'ip1'),
  round(180 * 250 / 646.0, 2), 'GEN-05/06: kg attributed in proportion to kg issued');
select is((select distinct method from public.ph_fg_pallet_lots where fg_pallet_id = :'fg1'), 'proportional', '… and the method is recorded');
reset role;
select throws_ok($$ update public.ph_fg_pallet_lots set kg = 1 $$, 'P0403', null, 'composition is append-only');
select tests.as_user(:'pho');
set local role authenticated;
select throws_ok(format($$ insert into public.ph_fg_pallets (farm_id, code, job_card_id, crop_id, grade, box_count, net_kg, weight_unit_id, scale_id, qc2_inspection_id)
  select farm_id, 'X', job_card_id, crop_id, grade, 1, 1, weight_unit_id, scale_id, qc2_inspection_id from public.ph_fg_pallets where id = %L $$, :'fg1'),
  '42501', null, 'no direct insert of finished pallets');
reset role;
-- Label (V-09, AT-07)
select is((public.ph_print_fg_label(:'fg1')) ->> 'print_no', '1', 'operator prints the FG label');
select is((select content ->> 'harvest_date' from public.ph_label_prints where entity_id = :'fg1'), to_char(app.ph_local_date(), 'YYYY-MM-DD'),
  'label carries the harvest date');
select is((select jsonb_array_length(content -> 'lots') from public.ph_label_prints where entity_id = :'fg1'), 1, '… the lot');
select is((select content -> 'sections' ->> 0 from public.ph_label_prints where entity_id = :'fg1'), '3/7', '… and block / section');
select is((select content ->> 'barcode_note' from public.ph_label_prints where entity_id = :'fg1'), 'Barcode type pending OD-20', 'no barcode until OD-20');
select throws_ok(format($$ select public.ph_print_fg_label(%L) $$, :'fg1'), 'P0422', null, 'a reprint needs a reason');
select is((public.ph_print_fg_label(:'fg1', 'Label torn')) ->> 'print_no', '2', 'reprint with a reason');
select is((select count(*)::int from public.ph_label_prints where entity_id = :'fg1' and is_reprint and reason = 'Label torn'), 1, 'reprint logged');
select (public.ph_create_fg_pallet(:'jc1', jsonb_build_object('box_count', 70, 'net_kg', 175, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'id') as fg2 \gset
reset role;
update public.ph_fg_pallets set earliest_harvest_at = null where id = :'fg2';
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_print_fg_label(%L) $$, :'fg2'), 'P0422', null, 'V-09: no label while a mandatory field is unknown');
select is((select a -> 'reason' ->> 'key' from jsonb_array_elements(public.ph_fg_pallet_actions(:'fg2')) a where a ->> 'action' = 'print_label'),
  'ph.v09', 'the record view names the missing field');
-- QC stamp (CP-06: 24 h validity from approval)
select throws_ok(format($$ select public.ph_fg_qc_approve(%L) $$, :'fg1'), 'P0403', null, 'an operator cannot stamp the pallet');
select throws_ok(format($$ select public.ph_move_fg_pallet(%L, %L) $$, :'fg1', tests.ph_id('ph_locations', 'F1')), 'P0422', null,
  'a pallet without the QC stamp cannot go to storage');
select tests.as_user(:'qci');
select is((public.ph_fg_qc_approve(:'fg1')) ->> 'code', :'fg1r'::jsonb ->> 'code', 'QC stamps the pallet');
select is(tests.fg_status(:'fg1'), 'qc_approved', 'QC approved');
select is((select qc_approved_by from public.ph_fg_pallets where id = :'fg1'), :'qci'::uuid, 'who stamped it is recorded');
select is((select round(extract(epoch from (qc_valid_until - qc_approved_at)) / 3600) from public.ph_fg_board where id = :'fg1'), 24::numeric,
  'valid for the 24 h the SOP gives (CP-06)');
select throws_ok(format($$ select public.ph_fg_qc_approve(%L) $$, :'fg1'), 'P0422', null, 'cannot be stamped twice');
-- Storage (V-07)
select tests.as_user(:'pho');
select throws_ok(format($$ select public.ph_move_fg_pallet(%L, %L) $$, :'fg1', tests.ph_id('ph_locations', 'HF')), 'P0422', null,
  'finished pallets go into a finished-goods fridge');
select throws_ok(format($$ select public.ph_move_fg_pallet(%L, %L) $$, :'fg1', tests.ph_id('ph_locations', 'F1')), 'P0422', null,
  'V-07: F1 has no storage group for this crop');
select throws_ok(format($$ select public.ph_move_fg_pallet(%L, %L, 'Urgent') $$, :'fg1', tests.ph_id('ph_locations', 'F1')), 'P0403', null,
  'only the PHM may override placement');
select tests.as_user(:'phm');
select public.ph_set_location_group(tests.ph_id('ph_locations', 'F1'), tests.ph_id('ph_storage_groups', 'tomato_cherry'));
select tests.as_user(:'pho');
select is((public.ph_move_fg_pallet(:'fg1r'::jsonb ->> 'code', tests.ph_id('ph_locations', 'F1'))) ->> 'location', 'F1', 'operator scans the pallet into F1');
select is(tests.fg_status(:'fg1'), 'in_storage', 'In storage');
select is((select count(*)::int from public.ph_stock_moves where fg_pallet_id = :'fg1' and permission_basis = 'P:PHO'), 1, 'the move is logged');
select is((select occupancy::int from public.ph_location_occupancy where farm_id = tests.farm() and code = 'F1'), 1, 'F1 occupancy counts it');
select throws_ok(format($$ select public.transition_record('ph_fg_pallets', %L, 'allocated') $$, :'fg1'), 'P0403', null,
  'allocation to a load is not built yet (M3) and is refused');

-- ---------------------------------------------------------------------------------------------
-- Completion: consumed + returned = issued for every input; returns go back to storage (SM-IP); T-08 closes
select throws_ok(format($$ select public.ph_complete_job_card(%L, '[]') $$, :'jc1'), 'P0403', null, 'an operator cannot complete the Job Card');
select tests.as_user(:'ll');
select throws_ok(format($$ select public.ph_complete_job_card(%L, '[]') $$, :'jc1'), 'P0422', null, 'every issued pallet must be closed');
select throws_ok(format($$ select public.ph_complete_job_card(%L, jsonb_build_array(
    jsonb_build_object('input_id', %L, 'consumed_kg', 240, 'returned_kg', 20),
    jsonb_build_object('input_id', %L, 'consumed_kg', 396, 'returned_kg', 0))) $$, :'jc1', tests.jc_input(:'jc1', :'ip1'), tests.jc_input(:'jc1', :'ip2')),
  'P0422', null, 'consumed + returned must equal issued');
select is(public.ph_complete_job_card(:'jc1', jsonb_build_array(
    jsonb_build_object('input_id', tests.jc_input(:'jc1', :'ip1'), 'consumed_kg', 240, 'returned_kg', 10),
    jsonb_build_object('input_id', tests.jc_input(:'jc1', :'ip2'), 'consumed_kg', 396, 'returned_kg', 0))) ->> 'consumed_kg', '636.00',
  'LL completes Job Card 1');
select is(tests.jc_status(:'jc1'), 'completed', 'Completed');
select is(tests.ph_status(:'ip2'), 'consumed', 'pallet 2 fully consumed');
select is(tests.ph_status(:'ip1'), 'issued', 'pallet 1 is still issued to Job Card 2');
select throws_ok(format($$ select public.ph_create_fg_pallet(%L, jsonb_build_object('box_count', 1, 'net_kg', 1, 'scale_id', %L)) $$,
  :'jc1', tests.ph_id('ph_equipment', 'SCALE-R1')), 'P0403', null, 'no new finished pallets on a completed Job Card (LL has no cell either)');
select tests.as_user(:'qci');
select public.ph_qc2_record(:'jc2', 'final', 'pass', '{}');
select tests.as_user(:'ll');
select public.ph_complete_job_card(:'jc2', jsonb_build_array(jsonb_build_object('input_id', tests.jc_input(:'jc2', :'ip1'), 'consumed_kg', 100, 'returned_kg', 50)));
select is(tests.ph_status(:'ip1'), 'stored', 'T-08: pallet 1 returns to storage with its remaining kg');
select is((select available_kg from public.ph_ip_board where code = :'ip1'), 60.00, '… 60 kg (10 + 50 returned)');
select is((select sum(consumed_kg + returned_kg) from public.ph_jc_inputs where pallet_id = tests.ph_id('ph_incoming_pallets', :'ip1')),
  (select sum(issued_kg) from public.ph_jc_inputs where pallet_id = tests.ph_id('ph_incoming_pallets', :'ip1')), 'T-08: consumed + returned = issued');
select throws_ok(format($$ select public.ph_issue_to_job_card(%L, %L, 10) $$, :'jc2', :'ip1'), 'P0422', null,
  'a returned pallet needs QC-1 release again before it is issued');
-- Reconciliation (MB-01) runs through its own server function (M2.2, tests in 17_ph_waste_reconciliation)
select tests.as_user(:'phm');
select is((select (a ->> 'allowed')::boolean from jsonb_array_elements(public.ph_job_card_actions(:'jc1')) a where a ->> 'action' = 'reconcile'),
  true, 'the PHM may reconcile a completed Job Card');
select throws_ok(format($$ select public.transition_record('ph_job_cards', %L, 'reconciled') $$, :'jc1'), 'P0422', null,
  'the generic transition endpoint cannot mark it reconciled without the MB-01 record');

-- ---------------------------------------------------------------------------------------------
-- Cancel
select tests.as_user(:'pe');
select (public.ph_create_job_card(jsonb_build_object('line_id', tests.ph_line('B'), 'crop_id', tests.ph_crop('regular_tomato'), 'grade_target', 'gr2')) ->> 'id') as jc3 \gset
select throws_ok(format($$ select public.ph_cancel_job_card(%L, 'Plan changed') $$, :'jc3'), 'P0403', null, 'the PE cannot cancel');
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_cancel_job_card(%L, '') $$, :'jc3'), 'P0422', null, 'cancelling needs a reason');
select is(public.ph_cancel_job_card(:'jc3', 'Plan changed') ->> 'status', 'cancelled', 'PHM cancels a draft');
select throws_ok(format($$ select public.ph_cancel_job_card(%L, 'x') $$, :'jc1'), 'P0422', null, 'a completed Job Card cannot be cancelled');

-- ---------------------------------------------------------------------------------------------
-- Read models and trace
select tests.as_user(:'pe');
select is((select total::int from public.ph_stage_counts() where stage = 'fg_storage'), 1, 'stage count: finished goods in storage');
select is((select total::int from public.ph_stage_counts() where stage = 'production'), 2, 'stage count: Job Cards in production (completed included)');
select is((select issued_kg from public.ph_jc_board where id = :'jc1'), 646.00, 'board: kg issued');
select is((select jsonb_array_length(public.ph_backward_trace(:'fg1r'::jsonb ->> 'code') -> 'pallets')), 2,
  'TQ-01: a finished pallet traces back to its two incoming pallets');
select is((public.ph_backward_trace(:'fg1r'::jsonb ->> 'code') -> 'job_cards' -> 0 ->> 'code'), :'jc1r'::jsonb ->> 'code', '… through its Job Card');
select is((select jsonb_array_length(public.ph_backward_trace(:'ip1') -> 'job_cards')), 2, 'TQ-02: pallet 1 traces forward to both Job Cards');
select is((select jsonb_array_length(public.ph_backward_trace(:'ip1') -> 'fg_pallets')), 2, '… and to the finished pallets it went into');
select is((select a ->> 'allowed' from jsonb_array_elements(public.ph_pallet_actions(tests.ph_id('ph_incoming_pallets', :'ip1'))) a
            where a ->> 'action' = 'issue_to_job_card'), null, 'a stored pallet offers no issue');

-- ---------------------------------------------------------------------------------------------
-- RLS: only packing-house members read production records
select tests.as_user(:'outsider');
set local role authenticated;
select is((select count(*)::int from public.ph_job_cards) + (select count(*)::int from public.ph_jc_inputs) + (select count(*)::int from public.ph_jc_packaging)
          + (select count(*)::int from public.ph_fg_pallets) + (select count(*)::int from public.ph_fg_pallet_lots), 0, 'an outsider sees no production records');
select is((select count(*)::int from public.ph_jc_board) + (select count(*)::int from public.ph_fg_board), 0, '… and nothing on the boards');
reset role;
select tests.as_user(:'qao');
set local role authenticated;
select is((select count(*)::int from public.ph_job_cards), 3, 'a packing-house member reads the Job Cards');
select is((select count(*)::int from public.ph_fg_pallet_lots), 4, '… and the composition');
select throws_ok($$ delete from public.ph_job_cards $$, '42501', null, 'no delete on Job Cards');
select throws_ok($$ delete from public.ph_fg_pallets $$, '42501', null, 'no delete on finished pallets');
select throws_ok($$ update public.ph_jc_inputs set consumed_kg = 0 $$, '42501', null, 'no direct update of inputs');
reset role;
select is((select count(*)::int from public.audit_events where entity_type = 'ph_job_cards' and entity_id = :'jc1'::uuid) > 5, true,
  'every Job Card change is in the audit trail');

-- A real farm: the spec's proposed cells are not in effect until the owner approves them.
update public.settings set value = 'false' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';
select tests.as_user(:'pe');
select throws_ok(format($$ select public.ph_create_job_card(jsonb_build_object('line_id', %L, 'crop_id', %L, 'grade_target', 'premium')) $$,
  tests.ph_line('A'), tests.ph_crop('cherry_tomato')), 'P0403', null, 'proposed cells (P) do not authorise anyone on a real farm');
select tests.as_user(:'qci');
select is((select a -> 'reason' ->> 'key' from jsonb_array_elements(public.ph_fg_pallet_actions(:'fg2')) a where a ->> 'action' = 'qc_approve'),
  null, 'documented cells (C) stay in effect: QC still stamps pallets');

select * from finish();
rollback;
