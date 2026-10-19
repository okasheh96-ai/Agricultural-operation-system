-- DEMO DATA — PACKING HOUSE — LOCAL DEVELOPMENT AND SCREENSHOTS ONLY. NEVER RUN IN STAGING OR PRODUCTION.
-- Runs after scripts/demo-users.mjs (demo.ph.*@demo.local users). Everything lives in the DEMO farm (is_demo = true), whose
-- every screen says "بيانات تجريبية / Demo Data". Sources, varieties, vehicles, drivers and supervisors below are invented
-- for the demo and are NOT farm data; crops, locations, capacities and scales come from the documented SOP values
-- (app.ph_load_sop_reference) and are approved here by demo users only.
--
-- Open decisions that would otherwise block receiving get a DEMO ASSUMPTION (refused on any non-demo farm): the spec's
-- recommendation where it gives one, otherwise the option the receiving flow is built for — never a management decision.
--
-- Records are created through the same server functions the app calls, acting as the demo users, so the status history,
-- audit trail and permission basis are real.
do $demo$
declare
  v_farm uuid := (select id from public.farms where code = 'DEMO' and is_demo);
  v_photo constant text := 'iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAAsklEQVR42u3YsQnDABAEwe0f1acKLFyBcjUgrgB74MOLNnmY7vN4ve/1eb1/26fO3qfO3qfO3qfO3qfO3qfO3qfO3qfO3qfO3qfO3qfO3qfO3qfO3qfO3qfO3qcOD+JBPIgH8SAexIN4kDo8iAfxIB7Eg3gQD+JB6vAgHsSDeBAP4kE8iAf5cTyIB/EgHsSDeBAP4kE8SB0exIN4EA/iQTyIB/EgdXgQD+JBPIgH8aCf2D+SUVeF+guPWAAAAABJRU5ErkJggg==';
  v_caption constant text := 'صورة تجريبية — ليست عينة حقيقية / Demo placeholder image, not a real sample';
  v_rationale constant text := 'افتراض تجريبي وليس قراراً إدارياً / DEMO ASSUMPTION — not a management decision. ';
  a1 uuid; a2 uuid; a3 uuid; a4 uuid;
  p jsonb;
  ids uuid[] := '{}';
  v uuid;
  ph text;
  sc1 uuid; sc2 uuid; sc3 uuid; hf uuid; f6 uuid;
  v_ct uuid; v_rt uuid; v_mc uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  codes text[] := '{}';

  -- helpers as closures over the session
begin
  if v_farm is null then
    raise notice 'Demo farm not found; skipping packing-house demo.';
    return;
  end if;
  if exists (select 1 from public.ph_arrivals where farm_id = v_farm) then
    return;
  end if;
  if not exists (select 1 from auth.users where email = 'demo.ph.dec@demo.local') then
    raise notice 'Packing-house demo users missing (scripts/demo-users.mjs); skipping.';
    return;
  end if;

  -- Documented reference values, short label codes for the demo, approvals by demo users.
  perform app.ph_load_sop_reference(v_farm);
  update public.ph_crops set label_code = c.lc from (values ('cherry_tomato', 'CT'), ('regular_tomato', 'RT'), ('eggplant', 'EG'),
    ('mini_cucumber', 'MC'), ('sweetbite', 'SB')) as c(code, lc) where ph_crops.farm_id = v_farm and ph_crops.code = c.code;

  update public.ph_open_decisions d
     set decision_state = 'demo_assumption', selected_option = x.opt, activate_roles = x.act,
         rationale = v_rationale || x.why, decided_at = now(), effective_from = now()
    from (values
      ('OD-01', 'B', '{}'::text[], 'Spec recommendation B (register every pallet at the scale).'),
      ('OD-02', 'C', '{}', 'Spec recommendation C (raw lot at QA acceptance, Job Card as batch).'),
      ('OD-03', 'A', '{}', 'The spec makes no recommendation; option A lets the demo issue pallet numbers.'),
      ('OD-17', 'A', '{}', 'The spec makes no recommendation; option A (separate QC-1 gate) is how the demo flow is built.'),
      ('OD-38', 'Data Entry Clerk inspects incoming vehicles', '{DEC}', 'The spec names no inspector; the demo lets the data entry clerk record it.')
    ) as x(code, opt, act, why)
   where d.farm_id = v_farm and d.code = x.code;
  perform app.ph_apply_decision(v_farm, 'OD-38');

  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.adm@demo.local'), 'role', 'authenticated')::text, true);
  perform public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"DEMO-B1S01","name_ar":"قطعة تجريبية 1 — قسم 01","name_en":"Demo block 1 — section 01","block_code":"DEMO-1","section_code":"01"}');
  perform public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"DEMO-B1S02","name_ar":"قطعة تجريبية 1 — قسم 02","name_en":"Demo block 1 — section 02","block_code":"DEMO-1","section_code":"02"}');
  perform public.ph_save_master('ph_sources', null, '{"kind":"own_farm","code":"DEMO-B2S01","name_ar":"قطعة تجريبية 2 — قسم 01","name_en":"Demo block 2 — section 01","block_code":"DEMO-2","section_code":"01"}');
  perform public.ph_save_master('ph_sources', null, '{"kind":"supplier","code":"DEMO-SUP","name_ar":"مورد تجريبي","name_en":"Demo supplier","supplier_name":"مورد تجريبي / Demo supplier"}');
  perform public.ph_save_master('ph_varieties', null, '{"crop_code":"cherry_tomato","code":"DEMO-CT-1","name_ar":"صنف شيري تجريبي","name_en":"Demo cherry variety"}');
  perform public.ph_save_master('ph_varieties', null, '{"crop_code":"regular_tomato","code":"DEMO-RT-1","name_ar":"صنف طماطم تجريبي","name_en":"Demo tomato variety"}');
  perform public.ph_save_master('ph_varieties', null, '{"crop_code":"mini_cucumber","code":"DEMO-MC-1","name_ar":"صنف خيار تجريبي","name_en":"Demo cucumber variety"}');

  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.phm@demo.local'), 'role', 'authenticated')::text, true);
  perform public.ph_approve_master('ph_crops', id, 'Demo approval (documented route and pallet values)') from public.ph_crops
   where farm_id = v_farm and code in ('cherry_tomato', 'regular_tomato', 'eggplant', 'mini_cucumber', 'sweetbite');
  perform public.ph_approve_master('ph_locations', id, 'Demo approval (capacity per fridge table)') from public.ph_locations where farm_id = v_farm;
  perform public.ph_approve_master('ph_equipment', id, 'Demo approval') from public.ph_equipment where farm_id = v_farm;
  perform public.ph_approve_master('ph_sources', id, 'Demo approval') from public.ph_sources where farm_id = v_farm;
  perform public.ph_approve_master('ph_varieties', id, 'Demo approval') from public.ph_varieties where farm_id = v_farm;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.qam@demo.local'), 'role', 'authenticated')::text, true);
  perform public.ph_approve_master('ph_storage_groups', id, 'Demo approval (SOP-PC groups)') from public.ph_storage_groups where farm_id = v_farm;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.phm@demo.local'), 'role', 'authenticated')::text, true);
  select id into hf from public.ph_locations where farm_id = v_farm and code = 'HF';
  select id into f6 from public.ph_locations where farm_id = v_farm and code = 'F6';
  perform public.ph_set_location_group(hf, (select id from public.ph_storage_groups where farm_id = v_farm and code = 'tomato_cherry'));
  perform public.ph_set_location_group((select id from public.ph_locations where farm_id = v_farm and code = 'F5'),
                                       (select id from public.ph_storage_groups where farm_id = v_farm and code = 'eggplant'));
  perform public.ph_set_location_group(f6, (select id from public.ph_storage_groups where farm_id = v_farm and code = 'mini_cucumber'));
  perform public.ph_set_location_group((select id from public.ph_locations where farm_id = v_farm and code = 'F7'),
                                       (select id from public.ph_storage_groups where farm_id = v_farm and code = 'pepper_sweetbite'));

  select id into sc1 from public.ph_equipment where farm_id = v_farm and code = 'SCALE-R1';
  select id into sc2 from public.ph_equipment where farm_id = v_farm and code = 'SCALE-R2';
  select id into sc3 from public.ph_equipment where farm_id = v_farm and code = 'SCALE-R3';
  select id into v_ct from public.ph_varieties where farm_id = v_farm and code = 'DEMO-CT-1';
  select id into v_rt from public.ph_varieties where farm_id = v_farm and code = 'DEMO-RT-1';
  select id into v_mc from public.ph_varieties where farm_id = v_farm and code = 'DEMO-MC-1';
  select id into s1 from public.ph_sources where farm_id = v_farm and code = 'DEMO-B1S01';
  select id into s2 from public.ph_sources where farm_id = v_farm and code = 'DEMO-B1S02';
  select id into s3 from public.ph_sources where farm_id = v_farm and code = 'DEMO-B2S01';
  select id into s4 from public.ph_sources where farm_id = v_farm and code = 'DEMO-SUP';

  -- ---------------------------------------------------------------------------------------------
  -- Arrivals (data entry clerk)
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.dec@demo.local'), 'role', 'authenticated')::text, true);
  a1 := (public.ph_create_arrival(jsonb_build_object('source_id', s1, 'variety_id', v_ct, 'gate_no', '1', 'harvest_date', app.ph_local_date(),
          'harvest_time', '06:30', 'harvest_supervisor', 'مشرف حصاد تجريبي', 'vehicle_plate', 'DEMO 10-111', 'driver_name', 'سائق تجريبي 1',
          'late_reason', 'بيانات تجريبية / Demo data')) ->> 'id')::uuid;
  perform public.ph_record_vehicle_inspection(a1, 'pass', '{"transport_conditions":"ok"}');
  perform public.ph_submit_arrival(a1);
  a2 := (public.ph_create_arrival(jsonb_build_object('source_id', s2, 'variety_id', v_rt, 'gate_no', '2', 'harvest_date', app.ph_local_date(),
          'harvest_time', '07:15', 'harvest_supervisor', 'مشرف حصاد تجريبي', 'vehicle_plate', 'DEMO 21-222', 'driver_name', 'سائق تجريبي 2',
          'dispatch_note_no', 'DEMO-DN-002', 'dispatched_pallets', 4, 'dispatched_boxes', 140, 'late_reason', 'بيانات تجريبية / Demo data')) ->> 'id')::uuid;
  perform public.ph_record_vehicle_inspection(a2, 'pass', '{"transport_conditions":"ok"}');
  perform public.ph_submit_arrival(a2);
  a3 := (public.ph_create_arrival(jsonb_build_object('source_id', s4, 'supplier_ref', 'DEMO-SUP-REF-17', 'gate_no', '3', 'vehicle_plate', 'DEMO 33-333',
          'driver_name', 'سائق تجريبي 3', 'late_reason', 'بيانات تجريبية / Demo data')) ->> 'id')::uuid;
  perform public.ph_record_vehicle_inspection(a3, 'fail', '{"transport_conditions":"not ok"}', 'أرضية المركبة غير نظيفة / Vehicle floor not clean (demo)');
  a4 := (public.ph_create_arrival(jsonb_build_object('source_id', s3, 'variety_id', v_mc, 'gate_no', '1', 'harvest_date', app.ph_local_date(),
          'harvest_time', '08:00', 'harvest_supervisor', 'مشرف حصاد تجريبي', 'vehicle_plate', 'DEMO 44-444', 'driver_name', 'سائق تجريبي 4',
          'late_reason', 'بيانات تجريبية / Demo data')) ->> 'id')::uuid;
  perform public.ph_record_vehicle_inspection(a4, 'pass', '{"transport_conditions":"ok"}');
  perform public.ph_submit_arrival(a4);
  perform public.ph_create_arrival(jsonb_build_object('source_id', s2, 'variety_id', v_rt, 'gate_no', '2', 'harvest_date', app.ph_local_date(),
          'harvest_time', '09:40', 'harvest_supervisor', 'مشرف حصاد تجريبي', 'vehicle_plate', 'DEMO 55-555', 'driver_name', 'سائق تجريبي 5',
          'late_reason', 'بيانات تجريبية / Demo data'));

  -- Registration at the scale
  foreach p in array array['{"net_kg":402.5,"s":1}', '{"net_kg":398,"s":1}', '{"net_kg":405,"s":2}', '{"net_kg":391,"s":2}',
                           '{"net_kg":400,"s":3}', '{"net_kg":377,"s":3}']::jsonb[] loop
    codes := codes || (public.ph_register_pallet(a1, jsonb_build_object('net_kg', p -> 'net_kg',
                       'scale_id', case p ->> 's' when '1' then sc1 when '2' then sc2 else sc3 end)) ->> 'code');
  end loop;
  foreach p in array array['{"net_kg":701,"b":35}', '{"net_kg":688,"b":35}', '{"net_kg":695,"b":34}', '{"net_kg":712,"b":35}']::jsonb[] loop
    codes := codes || (public.ph_register_pallet(a2, jsonb_build_object('net_kg', p -> 'net_kg', 'box_count', p -> 'b', 'scale_id', sc2)) ->> 'code');
  end loop;
  foreach p in array array['{"net_kg":448}', '{"net_kg":452}']::jsonb[] loop
    codes := codes || (public.ph_register_pallet(a4, jsonb_build_object('net_kg', p -> 'net_kg', 'scale_id', sc1)) ->> 'code');
  end loop;
  -- codes: 1–6 cherry (arrival 1), 7–10 regular tomato (arrival 2), 11–12 mini cucumber (arrival 4)
  perform public.ph_print_label((select id from public.ph_incoming_pallets where farm_id = v_farm and code = codes[1]));

  -- Arrival check (QC)
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.qci@demo.local'), 'role', 'authenticated')::text, true);
  perform public.ph_record_arrival_check(a1, '{"covered":"ok","palletised":"ok","insects":"ok","disease":"ok","temperature":"ok","appearance":"ok","foreign":"ok","freshness":"ok","spec":"ok","gr3_waste":"ok"}',
    (select jsonb_agg(jsonb_build_object('pallet_id', id, 'result', case when code = codes[6] then 'reject' else 'pass' end,
                      'destination', case when code = codes[6] then 'farm_or_supplier' end,
                      'remarks', case when code = codes[6] then 'هدر مرئي مفرط (تجريبي) / Excessive visible waste (demo)' end))
       from public.ph_incoming_pallets where farm_id = v_farm and code = any (codes[1:6])), 9.5, 'بيانات تجريبية / Demo data');
  perform public.ph_record_arrival_check(a2, '{"covered":"ok","palletised":"ok","insects":"ok","disease":"ok","temperature":"ok","appearance":"ok","foreign":"ok","freshness":"ok","spec":"ok","gr3_waste":"ok"}',
    (select jsonb_agg(jsonb_build_object('pallet_id', id, 'result', 'pass')) from public.ph_incoming_pallets
      where farm_id = v_farm and code = any (codes[9:10])), 11.0, 'بيانات تجريبية / Demo data');
  perform public.ph_record_arrival_check(a4, '{"covered":"ok","palletised":"ok","insects":"ok","disease":"ok","temperature":"ok","appearance":"ok","foreign":"ok","freshness":"ok","spec":"ok","gr3_waste":"ok"}',
    (select jsonb_agg(jsonb_build_object('pallet_id', id, 'result', 'pass')) from public.ph_incoming_pallets
      where farm_id = v_farm and code = codes[11]), 10.5, 'بيانات تجريبية / Demo data');

  -- Pre-cooling (operator)
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.pho@demo.local'), 'role', 'authenticated')::text, true);
  foreach ph in array array[codes[1], codes[2], codes[3], codes[9], codes[10], codes[11]] loop
    perform public.ph_precool_scan(ph, 'in');
    perform public.ph_precool_scan(ph, 'out');
  end loop;
  perform public.ph_precool_scan(codes[4], 'in');

  -- QA acceptance with photo evidence (QA officer); co-signature (QC)
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.qao@demo.local'), 'role', 'authenticated')::text, true);
  v := (public.ph_upload_attachment('photo', 'image/png', v_photo, v_caption) ->> 'id')::uuid;
  perform public.ph_submit_rma((select array_agg(id) from public.ph_incoming_pallets where farm_id = v_farm and code in (codes[1], codes[2])), 'accept',
    '{"product_temp":"ok","disease":"none","deformities":"few","shape":"ok","size":"ok","foreign":"none","over_ripe":"none"}', 9.0,
    'عينة من صندوقين (تجريبي) / 2 crates sampled (demo)', null, array[v]);
  v := (public.ph_upload_attachment('photo', 'image/png', v_photo, v_caption) ->> 'id')::uuid;
  perform public.ph_submit_rma((select array_agg(id) from public.ph_incoming_pallets where farm_id = v_farm and code = codes[10]), 'accept',
    '{"product_temp":"ok","disease":"none","size":"ok"}', 11.0, null, null, array[v]);
  v := (public.ph_upload_attachment('photo', 'image/png', v_photo, v_caption) ->> 'id')::uuid;
  perform public.ph_submit_rma((select array_agg(id) from public.ph_incoming_pallets where farm_id = v_farm and code = codes[9]), 'reject',
    '{"over_ripe":"high"}', 11.5, null, 'نضج زائد (تجريبي) / Over-ripe (demo)', array[v]);
  v := (public.ph_upload_attachment('photo', 'image/png', v_photo, v_caption) ->> 'id')::uuid;
  perform public.ph_submit_rma((select array_agg(id) from public.ph_incoming_pallets where farm_id = v_farm and code = codes[11]), 'accept',
    '{"product_temp":"ok","disease":"none"}', 10.5, null, null, array[v]);
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.qci@demo.local'), 'role', 'authenticated')::text, true);
  perform public.ph_cosign_rma((select rma_id from public.ph_incoming_pallets where farm_id = v_farm and code = codes[1]), 'تجريبي / Demo');

  -- Regrade started by the engineer
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.eng@demo.local'), 'role', 'authenticated')::text, true);
  perform public.ph_start_regrade((select id from public.ph_incoming_pallets where farm_id = v_farm and code = codes[9]));

  -- Storage (operator)
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.pho@demo.local'), 'role', 'authenticated')::text, true);
  perform public.ph_move_pallet(codes[1], hf);
  perform public.ph_move_pallet(codes[2], hf);
  perform public.ph_move_pallet(codes[10], hf);
  perform public.ph_move_pallet(codes[11], f6);

  -- QC-1 release of one pallet; a quality hold on another (QC)
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.qci@demo.local'), 'role', 'authenticated')::text, true);
  perform public.ph_qc1_release(array[(select id from public.ph_incoming_pallets where farm_id = v_farm and code = codes[1])],
    '{"quality_grading":"ok"}', 'بيانات تجريبية / Demo data');
  perform public.ph_raise_hold('quality', 'ليونة في بعض الثمار — بانتظار التقييم (تجريبي) / Some soft fruit — pending assessment (demo)',
    array[(select id from public.ph_incoming_pallets where farm_id = v_farm and code = codes[11])]);

  -- One partial signature on the vehicle exception (PHM)
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'demo.ph.phm@demo.local'), 'role', 'authenticated')::text, true);
  perform public.ph_vehicle_exception_decide(a3, 'approve', 'موافقة مبدئية (تجريبي) / Pre-approved by phone (demo)');
  perform set_config('request.jwt.claims', '', true);

  -- Back-date a few events so the timers show (owner update of event times — demo only).
  update public.ph_arrivals set arrived_at = now() - interval '7 hours' where id = a1;
  update public.ph_arrivals set arrived_at = now() - interval '27 hours' where id = a2;
  update public.ph_incoming_pallets set received_at = now() - interval '27 hours' where farm_id = v_farm and code = any (codes[7:10]);
  update public.ph_incoming_pallets set received_at = now() - interval '6 hours' where farm_id = v_farm and code = any (codes[1:6]);
  update public.ph_incoming_pallets set precool_in_at = now() - interval '42 minutes' where farm_id = v_farm and code = codes[4];
end
$demo$;
