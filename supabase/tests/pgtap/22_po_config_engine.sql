-- Packhouse operations increment 5: the configuration engine, through the owner's no-code acceptance scenario.
-- The Owner adds a new customer and a 6 kg pack (maker-checker), inserts a reinspection before dispatch for that customer only,
-- with a temperature field, assigned to QC, with an authorised release; adds an "outstanding inspections" card to management;
-- the rule blocks departure until done; then the Owner retires it and the old shipment history stays readable.
-- Plus: validation, versions pinned per record, tasks (board, escalation, recurring), KPI definitions (whitelist, injection).
-- Customer and pack codes, temperatures and limits below are invented test data, not farm data.
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
create function tests.as_name(p_name text) returns void language sql as $$
  select tests.as_user((select id from auth.users where email = p_name || '@test.local')) $$;
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
create function tests.run_of(p_load uuid) returns public.ph_op_instances language sql as $$
  select * from public.ph_op_instances where subject_id = p_load and cancelled_at is null order by created_at desc limit 1 $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- People and the receiving set-up (as in 20_po_dispatch_trace)
select tests.ph_user('e_own', array['OWN']) as own \gset
select tests.ph_user('e_phm', array['PHM']) as phm \gset
select tests.ph_user('e_pe', array['PE']) as pe \gset
select tests.ph_user('e_ll', array['LL']) as ll \gset
select tests.ph_user('e_stk', array['STK']) as stk \gset
select tests.ph_user('e_pho', array['PHO']) as pho \gset
select tests.ph_user('e_dec', array['DEC']) as dec \gset
select tests.ph_user('e_qci', array['QCI']) as qci \gset
select tests.ph_user('e_qcm', array['QCM']) as qcm \gset
select tests.ph_user('e_qcx', array['QCI', 'QCM']) as qcx \gset
select tests.ph_user('e_qao', array['QAO']) as qao \gset
select tests.ph_user('e_qam', array['QAM']) as qam \gset
select tests.ph_user('e_whm', array['WHM']) as whm \gset
select tests.ph_user('e_sal', array['SAL']) as sal \gset
select tests.ph_user('e_top', array['TOP']) as top \gset
select tests.ph_user('e_adm', array['ADM']) as adm \gset
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

select app.ph_load_sop_reference(tests.farm());
select tests.as_user(:'adm');
select public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"B1S01","name_ar":"قطعة 1 قسم 1","block_code":"1","section_code":"1"}');
select public.ph_save_master('ph_varieties', null, '{"crop_code":"cherry_tomato","code":"V1","name_ar":"صنف اختبار"}');
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
update public.ph_permission_cells set state = 'active', basis = 'test-owner-decision'
 where farm_id = tests.farm() and spec_code = 'DEC' and action_key in ('load.logger_seal', 'load.finalise');

-- One lot of 700 kg, one G1 run, four finished pallets (test quantities).
select tests.as_user(:'dec');
select (public.ph_create_arrival(jsonb_build_object('source_id', tests.ph_id('ph_sources', 'B1S01'), 'variety_id', tests.ph_id('ph_varieties', 'V1'),
  'vehicle_plate', 'T-1', 'driver_name', 'D', 'harvest_date', app.ph_local_date(), 'harvest_time', '00:05', 'harvest_supervisor', 'S', 'late_reason', 'test')) ->> 'id') as arr \gset
select public.ph_record_vehicle_inspection(:'arr', 'pass', '{"transport_conditions":"ok"}');
select public.ph_submit_arrival(:'arr');
select public.ph_register_pallet(:'arr', jsonb_build_object('net_kg', 350, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code' as ip1 \gset
select public.ph_register_pallet(:'arr', jsonb_build_object('net_kg', 350, 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code' as ip2 \gset
select tests.as_user(:'qci');
select public.ph_record_arrival_check(:'arr', '{"insects":"none"}',
  (select jsonb_agg(jsonb_build_object('pallet_id', id, 'result', 'pass')) from public.ph_incoming_pallets where arrival_id = :'arr'), 9.5, null);
select tests.as_user(:'pho');
select public.ph_precool_scan(x, 'in'), public.ph_precool_scan(x, 'out') from unnest(array[:'ip1', :'ip2']) x;
select tests.as_user(:'qao');
select (public.ph_upload_attachment('photo', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'Sample') ->> 'id') as photo \gset
select public.ph_submit_rma((select array_agg(id) from public.ph_incoming_pallets where arrival_id = :'arr'), 'accept', '{}', 9, null, null, array[:'photo']::uuid[]);
select tests.as_user(:'pho');
select public.ph_move_pallet(x, tests.ph_id('ph_locations', 'HF')) from unnest(array[:'ip1', :'ip2']) x;
select tests.as_user(:'qci');
select public.ph_qc1_release((select array_agg(id) from public.ph_incoming_pallets where arrival_id = :'arr'), '{"quality_grading":"ok"}');
select tests.as_user(:'pe');
select (public.ph_create_job_card(jsonb_build_object('line_id', tests.ph_line('A'), 'crop_id', tests.ph_crop('cherry_tomato'), 'grade_target', 'gr1', 'planned_date', app.ph_local_date())) ->> 'id') as jc \gset
select tests.as_user(:'phm');
select public.ph_approve_job_card(:'jc');
select tests.as_user(:'ll');
select public.ph_issue_to_job_card(:'jc', :'ip1', 350), public.ph_issue_to_job_card(:'jc', :'ip2', 350);
select tests.as_user(:'stk');
select public.ph_issue_packaging(:'jc', 'Carton 6 kg', 100);
select tests.as_user(:'ll');
select public.ph_mark_job_card_ready(:'jc');
select tests.as_user(:'qci');
select public.ph_line_start_check(:'jc', 'pass', '{}');
select tests.as_user(:'ll');
select public.ph_confirm_line_start(:'jc');
select tests.as_user(:'qci');
select public.ph_qc2_record(:'jc', 'final', 'pass', '{}');
select tests.as_user(:'pho');
create function tests.fg(p_jc uuid, p_boxes int, p_kg numeric) returns text language sql as $$
  select public.ph_create_fg_pallet(p_jc, jsonb_build_object('box_count', p_boxes, 'net_kg', p_kg, 'grade', 'gr1', 'scale_id', tests.ph_id('ph_equipment', 'SCALE-R1'))) ->> 'code' $$;
select tests.fg(:'jc', 25, 150) as fga, tests.fg(:'jc', 25, 150) as fgb, tests.fg(:'jc', 25, 150) as fgc, tests.fg(:'jc', 25, 150) as fgd \gset
select tests.as_user(:'qci');
select public.ph_fg_qc_approve(id) from public.ph_fg_pallets where farm_id = tests.farm();
select tests.as_user(:'pho');
select public.ph_move_fg_pallet(code, tests.ph_id('ph_locations', 'F1')) from public.ph_fg_pallets where farm_id = tests.farm();

-- =============================================================================================
-- 1. The Owner adds a new customer and a 6 kg pack; a second person approves each (maker-checker)
-- =============================================================================================
select tests.as_user(:'own');
select (public.ph_save_master('ph_customers', null, '{"code":"NEWCO","name_en":"New Customer (test)","market_type":"export"}') ->> 'id') as newco \gset
select (public.ph_save_master('ph_pack_formats', null, '{"code":"C6KG","name_ar":"كرتونة 6 كغ","name_en":"6 kg carton","kind":"carton","nominal_net_kg":6,"crop_code":"cherry_tomato"}') ->> 'id') as pack6 \gset
select is(app.ph_approved('ph_customers', :'newco', tests.farm()), false, 'a new customer is not usable until approved');
select throws_ok(format($$ select public.ph_approve_master('ph_pack_formats', %L, 'self') $$, :'pack6'), 'P0423', null,
  'the Owner cannot approve the pack format they entered (maker-checker)');
select tests.as_user(:'qcm');
select public.ph_approve_master('ph_customers', :'newco', 'Customer specification received (test)');
select tests.as_user(:'phm');
select public.ph_approve_master('ph_pack_formats', :'pack6', 'Carton checked (test)');
select is(app.ph_approved('ph_customers', :'newco', tests.farm()) and app.ph_approved('ph_pack_formats', :'pack6', tests.farm()), true,
  'customer and 6 kg pack approved by a second person');
select tests.as_user(:'sal');
select (public.ph_save_master('ph_customers', null, '{"code":"OTHERCO","name_en":"Other customer (test)"}') ->> 'id') as otherco \gset
select tests.as_user(:'qcm');
select public.ph_approve_master('ph_customers', :'otherco', 'Checked');

-- =============================================================================================
-- 2. The Owner builds the reinspection in Settings: validation first, then publish
-- =============================================================================================
select tests.as_user(:'pho');
select throws_ok($$ select public.ph_op_save_draft('REINSP', '{"name_ar":"x"}') $$, 'P0403', null, 'an operator cannot edit operations settings');
select tests.as_user(:'own');
select is(public.ph_op_save_draft('REINSP', jsonb_build_object('name_ar', 'إعادة فحص قبل الشحن', 'name_en', 'Reinspection before dispatch', 'subject_kind', 'load',
  'definition', jsonb_build_object(
    'trigger', jsonb_build_object('hook', 'dispatch.before_depart', 'conditions', jsonb_build_array(jsonb_build_object('field', 'customer_codez', 'op', 'eq', 'value', 'NEWCO'))),
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'reinspect', 'kind', 'form', 'role', 'QCI', 'name_ar', 'إعادة الفحص',
        'fields', jsonb_build_array(jsonb_build_object('key', 'pulp_temp', 'type', 'number', 'unit', 'degF', 'label_ar', 'حرارة اللب')),
        'on_fail', jsonb_build_object('action', 'block', 'goto', 'nowhere')),
      jsonb_build_object('key', 'release', 'kind', 'approval', 'role', 'PHO', 'name_ar', 'الإفراج'))))) -> 'errors' @>
  '[{"key":"unknownConditionField"},{"key":"unknownUnit"},{"key":"brokenRoute"},{"key":"approverRole"}]'::jsonb, true,
  'the validator lists every problem: unknown condition field, unknown unit, broken route, a non-quality approver');
select throws_ok($$ select public.ph_op_publish('REINSP') $$, 'P0422', null, 'an invalid draft cannot be published');

\set reinsp_def '{"trigger":{"hook":"dispatch.before_depart","conditions":[{"field":"customer_code","op":"eq","value":"NEWCO"}]},"task":{"due_minutes":60,"priority":"high"},"steps":[{"key":"reinspect","kind":"form","role":"QCI","name_ar":"إعادة الفحص","name_en":"Reinspection","fields":[{"key":"pulp_temp","type":"number","unit":"degC","label_ar":"حرارة اللب","label_en":"Pulp temperature","required":true,"min":-5,"max":40},{"key":"result","type":"select","label_ar":"النتيجة","required":true,"options":[{"value":"pass","label_ar":"مطابق","label_en":"Conforms"},{"value":"fail","label_ar":"غير مطابق","label_en":"Does not conform"}]}],"pass_if":[{"field":"result","op":"eq","value":"pass"}],"on_fail":{"action":"hold"}},{"key":"release","kind":"approval","role":"QCM","name_ar":"الإفراج المعتمد","name_en":"Authorised release"}]}'
select is(jsonb_array_length(public.ph_op_save_draft('REINSP', jsonb_build_object('definition', :'reinsp_def'::jsonb)) -> 'errors'), 0, 'the corrected draft validates');
select is(public.ph_op_publish('REINSP', null, 'Owner scenario (test)') ->> 'version', '1', 'published as version 1');
select is((select array_agg(spec_code || ':' || evidence || ':' || state order by action_key) from public.ph_permission_cells
            where farm_id = tests.farm() and action_key like 'op\_reinsp.%' and voided_at is null),
  array['QCI:O:active', 'QCM:O:active'], 'each step is an action in the authority matrix with the role the Owner chose (labelled O)');
select ok(exists (select 1 from public.ph_access_events where event = 'operation_published' and after ->> 'code' = 'REINSP'), 'publishing is audited');

-- The "outstanding inspections" card on the management overview.
select is(jsonb_array_length(public.ph_kpi_save('OUTSTANDING_INSP', jsonb_build_object('title_ar', 'فحوصات معلّقة', 'title_en', 'Outstanding inspections',
  'dataset', 'op_runs', 'measure', 'count', 'window', 'open_now', 'unit', 'runs',
  'filters', jsonb_build_array(jsonb_build_object('field', 'op_code', 'op', 'eq', 'value', 'REINSP'),
                               jsonb_build_object('field', 'run_state', 'op', 'neq', 'value', 'completed'),
                               jsonb_build_object('field', 'run_state', 'op', 'neq', 'value', 'cancelled')),
  'roles', jsonb_build_array('PHM', 'OWN', 'QCM')), true, 'Owner scenario (test)') -> 'errors'), 0, 'the KPI card validates and is published');

-- =============================================================================================
-- 3. The rule applies to that customer only, starts a task for QC, and blocks departure until done
-- =============================================================================================
create function tests.order_line(p_cust uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_name('e_sal');
  v := (public.ph_create_order_line(jsonb_build_object('customer_name', 'test', 'crop_id', tests.ph_crop('cherry_tomato'), 'pack_spec', '6 kg carton',
         'grade', 'gr1', 'quantity', 300, 'quantity_unit', 'kg', 'required_date', app.ph_local_date() + 1, 'market_type', 'export')) ->> 'id')::uuid;
  perform public.ph_set_order_line_refs(v, p_cust, (select id from public.ph_pack_formats where farm_id = tests.farm() and code = 'C6KG'));
  perform tests.as_name('e_phm');
  perform public.ph_decide_order_line(v, 'accept');
  return v;
end $$;
select tests.order_line(:'newco') as ol1, tests.order_line(:'otherco') as ol2 \gset
select tests.as_user(:'pe');
select (public.ph_create_load(jsonb_build_object('customer_id', :'newco', 'destination', 'Test', 'order_line_ids', jsonb_build_array(:'ol1'), 'vehicle_plate', 'TR-1')) ->> 'id') as ld1 \gset
select (public.ph_create_load(jsonb_build_object('customer_id', :'otherco', 'destination', 'Test', 'order_line_ids', jsonb_build_array(:'ol2'), 'vehicle_plate', 'TR-2')) ->> 'id') as ld2 \gset
select is((select count(*)::int from public.ph_op_instances where subject_id = :'ld1'), 1, 'a load for the new customer starts a reinspection run');
select is((select count(*)::int from public.ph_op_instances where subject_id = :'ld2'), 0, 'a load for another customer does not');
select is(app.po_hook_blockers(tests.farm(), 'dispatch.before_depart', to_jsonb((select l from public.ph_loads l where id = :'ld2'))), '[]'::jsonb,
  'nothing waits before the other customer''s departure');
select (tests.run_of(:'ld1')).id as run1 \gset
select is((select current_step from public.ph_op_instances where id = :'run1'), 'reinspect', 'the run starts at the reinspection step');
select is((select assignee_role || ':' || priority || ':' || (due_at is not null)::text from public.ph_tasks where op_instance_id = :'run1'), 'QCI:high:true',
  'a task reaches QC with the deadline and priority from the definition');
select ok(exists (select 1 from public.notifications n where n.entity_id = :'run1'), 'QC is notified');
select tests.as_user(:'qci');
select is((select count(*)::int from public.ph_task_board where op_instance_id = :'run1' and is_mine), 1, 'the QC inspector sees it on their task board');
select tests.as_user(:'phm');
select is((public.ph_my_kpi_cards() -> 0 -> 'result' -> 'rows' -> 0 ->> 'value')::numeric, 1::numeric, 'management card: 1 outstanding inspection');

-- Allocate two pallets; the inspection fails → the reusable "hold" action holds them (they leave the load).
select tests.as_user(:'pe');
select public.ph_allocate_pallet(:'ld1', :'fga'), public.ph_allocate_pallet(:'ld1', :'fgb');
select tests.as_user(:'ll');
select throws_ok(format($$ select public.ph_op_record_step(%L, 'reinspect', '{"pulp_temp":"8","result":"pass"}') $$, :'run1'), 'P0403', null,
  'a line leader cannot record the QC step');
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_op_record_step(%L, 'reinspect', '{"result":"pass"}') $$, :'run1'), 'P0422', null, 'the temperature field is required');
select throws_ok(format($$ select public.ph_op_record_step(%L, 'reinspect', '{"pulp_temp":"80","result":"pass"}') $$, :'run1'), 'P0422', null,
  'the temperature must be inside the range the Owner set');
select throws_ok(format($$ select public.ph_op_record_step(%L, 'release', '{}', 'approve') $$, :'run1'), 'P0409', null, 'steps run in order');
select is(public.ph_op_record_step(:'run1', 'reinspect', '{"pulp_temp":"11.5","result":"fail"}', null, 'Soft fruit (test)') ->> 'passed', 'false', 'reinspection fails');
select is(tests.fgs(:'fga') || ',' || tests.fgs(:'fgb'), 'on_hold,on_hold', 'failure: the load''s allocated pallets are put on a quality hold');
select is((select count(*)::int from public.ph_load_pallets where load_id = :'ld1' and removed_at is null), 0, 'held pallets leave the load');
select is((select run_state from public.ph_op_runs where id = :'run1'), 'failed', 'the run is failed (blocks)');

-- QC releases the hold through the normal hold workflow; pallets are allocated and loaded again.
select tests.as_user(:'qcm');
select public.ph_hold_step(hold_id, 'assign', 'Assess'), public.ph_hold_step(hold_id, 'decide', 'Re-checked (test)', 'release')
  from (select distinct hold_id from public.ph_fg_pallets where code in (:'fga', :'fgb')) h;
select tests.as_user(:'pe');
select public.ph_allocate_pallet(:'ld1', :'fga'), public.ph_allocate_pallet(:'ld1', :'fgb');
select tests.as_user(:'pho');
select public.ph_load_scan(:'ld1', :'fga'), public.ph_load_scan(:'ld1', :'fgb');
select tests.as_user(:'dec');
select public.ph_load_step(:'ld1', 'arrive');
select tests.as_user(:'qci');
select public.ph_load_step(:'ld1', 'inspect', '{"items":{"clean":true,"no_smell":true,"no_contamination":true,"lockable":true,"temperature_ok":true},"temp_c":9}');
select tests.as_user(:'pho');
select public.ph_load_scan(:'ld1', :'fga'), public.ph_load_scan(:'ld1', :'fgb');
select tests.as_user(:'dec');
select public.ph_load_step(:'ld1', 'seal', '{"seal_number":"S-1"}');
select is(public.ph_load_step(:'ld1', 'finalise') ->> 'status', 'packing_list_final', 'the load is sealed and its packing list final');
select throws_ok(format($$ select public.ph_load_step(%L, 'depart') $$, :'ld1'), 'P0422', null, 'departure is blocked while the reinspection is not done');
select is((select status from public.ph_loads where id = :'ld1'), 'packing_list_final', 'the load did not depart');

-- Pass, then the authorised release by someone else from the quality team.
select tests.as_user(:'qcx');
select is(public.ph_op_record_step(:'run1', 'reinspect', '{"pulp_temp":"8.0","result":"pass"}') ->> 'next_step', 'release', 'the reinspection passes → release step');
select throws_ok(format($$ select public.ph_op_record_step(%L, 'release', '{}', 'approve') $$, :'run1'), 'P0423', null,
  'the person who inspected does not release (segregation of duties)');
select tests.as_user(:'qci');
select throws_ok(format($$ select public.ph_op_record_step(%L, 'release', '{}', 'approve') $$, :'run1'), 'P0403', null, 'an inspector without the release role cannot release');
select tests.as_user(:'qcm');
select throws_ok(format($$ select public.ph_op_record_step(%L, 'release', '{}', 'reject') $$, :'run1'), 'P0422', null, 'a rejection needs a reason');
select is(public.ph_op_record_step(:'run1', 'release', '{}', 'approve', 'Released (test)') ->> 'completed', 'true', 'QCM releases: the run is completed');
select is((select completed_at is not null from public.ph_tasks where op_instance_id = :'run1'), true, 'its task is done');
select is((select string_agg((h ->> 'step') || ':' || (h ->> 'passed'), ',') from public.ph_op_instances i, jsonb_array_elements(i.step_history) h where i.id = :'run1'),
  'reinspect:false,reinspect:true,release:true', 'every attempt is kept on the run: the failed reinspection, the pass, the release');
select tests.as_user(:'phm');
select is((public.ph_my_kpi_cards() -> 0 -> 'result' -> 'rows' -> 0 ->> 'value')::numeric, 0::numeric, 'management card: 0 outstanding');
select tests.as_user(:'dec');
select is(public.ph_load_step(:'ld1', 'depart') ->> 'status', 'departed', 'now the load departs');

-- =============================================================================================
-- 4. Versions: a new version applies to new records; existing records keep the version they started on
-- =============================================================================================
select tests.as_user(:'own');
select public.ph_op_save_draft('REINSP', jsonb_build_object('definition', jsonb_set(:'reinsp_def'::jsonb, '{steps,1,disabled}', 'true'::jsonb), 'change_note', 'Release step retired (test)'));
select is(public.ph_op_publish('REINSP', null, 'Release step retired (test)') ->> 'version', '2', 'version 2: the release step is retired');
select tests.as_user(:'pe');
select (public.ph_create_load(jsonb_build_object('customer_id', :'newco', 'order_line_ids', jsonb_build_array(:'ol1'), 'vehicle_plate', 'TR-3')) ->> 'id') as ld3 \gset
select (tests.run_of(:'ld3')).id as run3 \gset
select is((select version_no from public.ph_op_runs where id = :'run3'), 2, 'a new load runs version 2');
select is((select version_no from public.ph_op_runs where id = :'run1'), 1, 'the departed load keeps version 1');
select tests.as_user(:'qci');
select is(public.ph_op_record_step(:'run3', 'reinspect', '{"pulp_temp":"7","result":"pass"}') ->> 'completed', 'true', 'version 2 completes without the retired step');
select tests.as_user(:'own');
select is(public.ph_op_rollback('REINSP', 1, 'Back to the release step (test)') ->> 'version', '3', 'rollback publishes version 1''s definition as version 3');
select is((select definition = :'reinsp_def'::jsonb from public.ph_op_versions v join public.ph_op_types t on t.id = v.op_type_id
            where t.code = 'REINSP' and v.version_no = 3), true, 'version 3 equals version 1');
select is((select string_agg(state, ',' order by version_no) from public.ph_op_versions v join public.ph_op_types t on t.id = v.op_type_id where t.code = 'REINSP'),
  'superseded,superseded,published', 'one version in effect; earlier ones superseded, never edited');
select throws_ok($$ select public.ph_op_publish('REINSP', now() - interval '1 day') $$, 'P0422', null, 'nothing to publish without a draft');

-- =============================================================================================
-- 5. Retire through Settings: new loads are not held; the old shipment history stays readable
-- =============================================================================================
select tests.as_user(:'pe');
select (public.ph_create_load(jsonb_build_object('customer_id', :'newco', 'order_line_ids', jsonb_build_array(:'ol1'), 'vehicle_plate', 'TR-4')) ->> 'id') as ld4 \gset
select tests.as_user(:'own');
select throws_ok($$ select public.ph_op_retire('REINSP', '') $$, 'P0422', null, 'retiring needs a reason');
select is((public.ph_op_retire('REINSP', 'Customer requirement ended (test)') ->> 'open_runs_cancelled')::int, 1, 'retired; the open run on load 4 is cancelled');
select is(app.po_hook_blockers(tests.farm(), 'dispatch.before_depart', to_jsonb((select l from public.ph_loads l where id = :'ld4'))), '[]'::jsonb,
  'load 4 no longer waits for the reinspection');
select tests.as_user(:'pe');
select (public.ph_create_load(jsonb_build_object('customer_id', :'newco', 'order_line_ids', jsonb_build_array(:'ol1'), 'vehicle_plate', 'TR-5')) ->> 'id') as ld5 \gset
select is((select count(*)::int from public.ph_op_instances where subject_id = :'ld5'), 0, 'a new load for that customer starts no run');
select tests.as_user(:'qam');
select is((select run_state || ':' || version_no || ':' || op_retired::text from public.ph_op_runs where id = :'run1'), 'completed:1:true',
  'old history: the departed load''s run is readable with its version, marked retired');
select is((select step_values -> 'reinspect' -> 'values' ->> 'pulp_temp' from public.ph_op_runs where id = :'run1'), '8.0', 'old history: the recorded temperature is kept');
select is((select step_values -> 'release' ->> 'by_name' from public.ph_op_runs where id = :'run1'), 'e_qcm', 'old history: who released it');
select is((select status from public.ph_loads where id = :'ld1'), 'departed', 'the shipment record is unchanged');
select is((public.ph_subject_ops('load', :'ld1') -> 0 ->> 'run_state'), 'completed', 'the dispatch screen still lists the load''s completed run');

-- A load created before an operation exists gets its run when the dispatch screen opens (or at the next scheduler tick).
select tests.as_user(:'own');
select public.ph_op_save_draft('SEALCHK', jsonb_build_object('name_ar', 'تحقق ثانٍ من الختم', 'subject_kind', 'load', 'definition', jsonb_build_object(
  'trigger', jsonb_build_object('hook', 'dispatch.before_depart'),
  'steps', jsonb_build_array(jsonb_build_object('key', 'check', 'kind', 'form', 'role', 'DEC', 'name_ar', 'تحقق',
    'fields', jsonb_build_array(jsonb_build_object('key', 'ok', 'type', 'check', 'label_ar', 'سليم', 'required', true)))))));
select public.ph_op_publish('SEALCHK');
select is((app.po_hook_blockers(tests.farm(), 'dispatch.before_depart', to_jsonb((select l from public.ph_loads l where id = :'ld5'))) -> 0 ->> 'state'), 'not_started',
  'an existing load waits for the new operation (not started yet)');
select tests.as_user(:'pe');
select is((public.ph_subject_ops('load', :'ld5') -> 0 ->> 'op_code'), 'SEALCHK', 'opening the load starts the run');
select is(public.po_scheduler_tick() ->> 'created', '0', 'the scheduler tick starts runs for other open loads');
select is((select count(*)::int from public.ph_op_instances i join public.ph_op_versions v on v.id = i.op_version_id join public.ph_op_types t on t.id = v.op_type_id
            where t.code = 'SEALCHK' and i.subject_id in (:'ld2', :'ld4')), 2, 'both other open loads now have the run');

-- A manual operation (started from the menu); hook operations cannot be started by hand.
select tests.as_user(:'own');
select public.ph_op_save_draft('FLOORCHK', jsonb_build_object('name_ar', 'جولة أرضية', 'definition', jsonb_build_object('trigger', jsonb_build_object('hook', 'manual'),
  'steps', jsonb_build_array(jsonb_build_object('key', 'walk', 'kind', 'form', 'role', 'PE', 'name_ar', 'جولة',
    'fields', jsonb_build_array(jsonb_build_object('key', 'areas', 'type', 'rows', 'label_ar', 'المناطق', 'required', true)))))));
select public.ph_op_publish('FLOORCHK');
select tests.as_user(:'pe');
select throws_ok($$ select public.ph_op_start('SEALCHK') $$, 'P0422', null, 'an operation tied to a hook is not started by hand');
select (public.ph_op_start('FLOORCHK', 'Morning round (test)') ->> 'id') as floor \gset
select ok((select code from public.ph_op_instances where id = :'floor') like 'OP-%', 'a manual operation starts from the menu');
select throws_ok(format($$ select public.ph_op_record_step(%L, 'walk', '{"areas":[]}') $$, :'floor'), 'P0422', null, 'a required list needs at least one row');
select is(public.ph_op_record_step(:'floor', 'walk', '{"areas":[{"value":"Line A"}]}') ->> 'completed', 'true', 'with one row the round completes');
select tests.as_user(:'pho');
select throws_ok($$ select public.ph_op_start('FLOORCHK') $$, 'P0403', null, 'only the step''s role can start it');

-- =============================================================================================
-- 6. Tasks: board, assignment, escalation, recurring work
-- =============================================================================================
select tests.as_user(:'pho');
select throws_ok($$ select public.ph_task_create('{"title":"x","assignee_role":"LL"}') $$, 'P0403', null, 'an operator does not assign tasks');
select tests.as_user(:'phm');
select throws_ok($$ select public.ph_task_create('{"title":"x"}') $$, 'P0422', null, 'a task needs an assignee');
select (public.ph_task_create(jsonb_build_object('title', 'Check carton stock (test)', 'assignee_role', 'LL', 'due_at', now() - interval '2 hours',
  'escalate_after_min', 30, 'escalate_to_role', 'PE'), '00000000-0000-4000-8000-000000000221') ->> 'id') as tk \gset
select is(public.ph_task_create(jsonb_build_object('title', 'Check carton stock (test)', 'assignee_role', 'LL'), '00000000-0000-4000-8000-000000000221') ->> 'id', :'tk',
  'the same request twice creates one task');
select tests.as_user(:'ll');
select is((select task_state from public.ph_task_board where id = :'tk' and is_mine), 'overdue', 'the line leader sees the overdue task as theirs');
select tests.as_user(:'pho');
select is((select count(*)::int from public.ph_task_board where id = :'tk'), 0, 'an operator does not see other people''s tasks');
select throws_ok(format($$ select public.ph_task_step(%L, 'complete') $$, :'tk'), 'P0403', null, 'only the assignee completes');
select set_config('request.jwt.claims', '', true);
select is((public.po_scheduler_tick() ->> 'escalated')::int, 1, 'the scheduler escalates the overdue task');
select ok(exists (select 1 from public.notifications where entity_id = :'tk' and kind = 'po_task_escalated'), 'the escalation role is notified');
select tests.as_user(:'ll');
select public.ph_task_step(:'tk', 'comment', '{"body":"Counted 40 cartons (test)"}');
select is(public.ph_task_step(:'tk', 'complete', '{"note":"Done"}') ->> 'step', 'complete', 'the line leader completes it');
select is((select task_state || ':' || jsonb_array_length(comments)::text from public.ph_task_board where id = :'tk'), 'done:1', 'done, with its comment');
select tests.as_user(:'ll');
select throws_ok(format($$ select public.ph_task_step(%L, 'complete') $$, (select id from public.ph_tasks where op_instance_id = :'run1')), 'P0403', null,
  'a task that belongs to someone else cannot be completed');
select tests.as_user(:'qci');
select (select id from public.ph_tasks where op_instance_id = (select id from public.ph_op_instances i where i.code like 'OP-%' and i.subject_id is null limit 1)) as optk \gset
select tests.as_user(:'pe');
select throws_ok(format($$ select public.ph_task_step(%L, 'complete') $$, :'optk'), 'P0422', null, 'an operation''s task completes only by recording the operation');
select tests.as_user(:'phm');
select (public.ph_task_template_save('{"title":"Daily scale check (test)","assignee_role":"QCI","every_days":1,"at_time":"06:00"}') ->> 'id') as tpl \gset
update public.ph_task_templates set next_run_at = now() - interval '1 minute' where id = :'tpl';
select set_config('request.jwt.claims', '', true);
select is((public.po_scheduler_tick() ->> 'created')::int, 1, 'the scheduler creates the recurring task when due');
select ok((select next_run_at > now() from public.ph_task_templates where id = :'tpl'), 'and schedules the next one');
select is((select assignee_role from public.ph_tasks where template_id = :'tpl'), 'QCI', 'assigned to the template''s role');

-- =============================================================================================
-- 7. KPI definitions: whitelist only, values bound as parameters, role visibility
-- =============================================================================================
select tests.as_user(:'own');
select ok(public.ph_kpi_validate('{"dataset":"pg_authid","measure":"count","window":"today","title_ar":"x"}') @> '[{"key":"kpiDataset"}]', 'unknown dataset refused');
select ok(public.ph_kpi_validate('{"dataset":"output","measure":"sum","field":"farm_id","window":"today","title_ar":"x"}') @> '[{"key":"kpiField"}]',
  'a measure can only sum a listed numeric column');
select ok(public.ph_kpi_validate('{"dataset":"output","measure":"count","window":"today","title_ar":"x","filters":[{"field":"grade); drop table x; --","op":"eq","value":"1"}]}')
  @> '[{"key":"kpiFilterField"}]', 'an identifier outside the whitelist is refused');
select ok(public.ph_kpi_validate('{"dataset":"output","measure":"rate_per_hour","field":"kg","window":"open_now","title_ar":"x"}') @> '[{"key":"kpiRateWindow"}]',
  'a rate needs a time window');
select is((public.ph_kpi_eval('{"dataset":"loads","measure":"count","window":"today","title_ar":"x","filters":[{"field":"customer","op":"eq","value":"x'' or ''1''=''1"}]}')
           -> 'rows' -> 0 ->> 'value'), '0', 'a filter value is a bound parameter: the injection attempt matches nothing');
select is((public.ph_kpi_eval('{"dataset":"output","measure":"sum","field":"kg","window":"today","title_ar":"x"}') -> 'rows' -> 0 ->> 'value'), null,
  'a sum over no records is unknown, not zero');
select is((public.ph_kpi_eval('{"dataset":"loads","measure":"count","window":"today","title_ar":"x","group_by":"status"}') -> 'rows'),
  (select jsonb_agg(jsonb_build_object('group', status, 'value', n, 'n', n) order by status) from (select status, count(*)::numeric n from public.ph_loads
     where farm_id = tests.farm() and created_at >= lower(app.po_day_window(app.ph_local_date())) group by status) x),
  'grouped count matches the loads table');
select is((public.ph_kpi_eval('{"dataset":"fg_stock","measure":"sum","field":"net_kg","window":"30d","title_ar":"x","filters":[{"field":"net_kg","op":"gte","value":"100"}]}')
           -> 'rows' -> 0 ->> 'value')::numeric, 600::numeric, 'sum with a numeric filter: 4 × 150 kg');
select throws_ok($$ select public.ph_kpi_eval('{"dataset":"nope","measure":"count","window":"today","title_ar":"x"}') $$, 'P0422', null, 'an invalid definition is not evaluated');
select tests.as_user(:'pe');
select is((select count(*)::int from jsonb_array_elements(public.ph_my_kpi_cards()) c where c ->> 'code' = 'OUTSTANDING_INSP'), 0,
  'the card is shown only to the roles chosen for it');
select tests.as_user(:'phm');
select throws_ok($$ select public.ph_kpi_save('X1', '{"dataset":"loads","measure":"count","window":"today","title_ar":"x"}', true) $$, 'P0403', null,
  'publishing KPI cards is a settings permission');
select tests.as_user(:'own');
select public.ph_kpi_retire('OUTSTANDING_INSP', 'Replaced (test)');
select tests.as_user(:'phm');
select is(jsonb_array_length(public.ph_my_kpi_cards()), 0, 'a retired card leaves the overview');

select tests.as_user(:'own');
select ok(public.ph_config_catalog() -> 'hooks' @> '[{"hook":"dispatch.before_depart","subject_kind":"load"}]', 'the editor catalog lists the hook points');
select ok(public.ph_config_catalog() -> 'units' @> '[{"code":"degC"}]', 'degree Celsius is an approved unit for temperature fields');
select tests.as_user(tests.create_user('e_nobody'));
select throws_ok($$ select public.ph_config_catalog() $$, 'P0403', null, 'the catalog is for packhouse users only');

-- Clients have no direct write on the new tables.
select is((select count(*)::int from information_schema.role_table_grants where grantee = 'authenticated'
            and table_name in ('ph_op_types', 'ph_op_versions', 'ph_op_instances', 'ph_tasks', 'ph_task_comments', 'ph_task_templates', 'ph_kpi_defs')
            and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0, 'no insert / update / delete for API users on the engine tables');
select is((select count(*)::int from pg_tables where tablename in ('ph_op_types', 'ph_op_versions', 'ph_op_instances', 'ph_tasks', 'ph_task_comments', 'ph_task_templates', 'ph_kpi_defs')
            and not rowsecurity), 0, 'RLS on every engine table');

select * from finish();
rollback;
