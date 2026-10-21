-- DEMO DATA — PACKING HOUSE PRODUCTION (M2.1) — LOCAL DEVELOPMENT AND THE IN-BROWSER DEMO ONLY. NEVER RUN IN STAGING OR PRODUCTION.
-- Runs after demo_packing_house.sql. Everything lives in the DEMO farm (is_demo = true). Job Card notes, packaging items, box
-- counts and finished-pallet weights below are invented for the demo and are NOT farm data; the checklists are the SOPs' own.
-- Lines are approved here by the demo manager only (on a real farm the owner's checker approves them).
--
-- Records are created through the same server functions the app calls, acting as the demo users, so the status history,
-- audit trail and permission basis are real. Every proposed (P) permission cell used here is in effect only because the
-- demo farm runs the spec's proposals (ph_proposals_in_effect); a real farm stays blocked until the owner approves them.
do $demo$
declare
  v_farm uuid := (select id from public.farms where code = 'DEMO' and is_demo);
  v_tag constant text := ' (تجريبي / demo)';
  ip1 text; ip3 text;
  jc1 uuid; jc2 uuid;
  fg1 uuid;
  f1 uuid;
  sc1 uuid;
  u_pe uuid; u_phm uuid; u_ll uuid; u_stk uuid; u_qci uuid; u_pho uuid;
begin
  if v_farm is null or not exists (select 1 from public.ph_arrivals where farm_id = v_farm) then
    raise notice 'Packing-house receiving demo not present; skipping production demo.';
    return;
  end if;
  if exists (select 1 from public.ph_job_cards where farm_id = v_farm) then
    return;
  end if;
  select id into u_pe from auth.users where email = 'demo.ph.pe@demo.local';
  select id into u_phm from auth.users where email = 'demo.ph.phm@demo.local';
  select id into u_ll from auth.users where email = 'demo.ph.ll@demo.local';
  select id into u_stk from auth.users where email = 'demo.ph.stk@demo.local';
  select id into u_qci from auth.users where email = 'demo.ph.qci@demo.local';
  select id into u_pho from auth.users where email = 'demo.ph.pho@demo.local';
  if u_pe is null or u_ll is null or u_stk is null then
    raise notice 'Production demo users missing (scripts/demo-people.mjs); skipping.';
    return;
  end if;

  -- Pallets from the receiving demo: the released cherry pallet and a stored regular-tomato pallet (the second cherry pallet stays
  -- in storage, waiting for QC-1, so every receiving stage still has a record to try).
  select code into ip1 from public.ph_incoming_pallets where farm_id = v_farm and status = 'released' order by code limit 1;
  select p.code into ip3 from public.ph_incoming_pallets p join public.ph_crops c on c.id = p.crop_id
   where p.farm_id = v_farm and p.status = 'stored' and c.code = 'regular_tomato' order by p.code limit 1;
  select id into sc1 from public.ph_equipment where farm_id = v_farm and code = 'SCALE-R1';
  select id into f1 from public.ph_locations where farm_id = v_farm and code = 'F1';

  -- Demo manager approves the packing lines (master data) and assigns F1 to tomato & cherry finished goods.
  perform set_config('request.jwt.claims', json_build_object('sub', u_phm, 'role', 'authenticated')::text, true);
  perform public.ph_approve_master('ph_lines', id, 'Demo approval (lines per SUM-2)') from public.ph_lines
   where farm_id = v_farm and verification_status <> 'verified';
  perform public.ph_set_location_group(f1, (select id from public.ph_storage_groups where farm_id = v_farm and code = 'tomato_cherry'));

  -- QC-1 releases the regular-tomato pallet (for the afternoon Job Card).
  perform set_config('request.jwt.claims', json_build_object('sub', u_qci, 'role', 'authenticated')::text, true);
  perform public.ph_qc1_release((select array_agg(id) from public.ph_incoming_pallets where farm_id = v_farm and code = ip3),
    '{"quality_grading":"ok"}', 'بيانات تجريبية / Demo data');

  -- Production engineer plans; the manager approves.
  perform set_config('request.jwt.claims', json_build_object('sub', u_pe, 'role', 'authenticated')::text, true);
  jc1 := (public.ph_create_job_card(jsonb_build_object('line_id', (select id from public.ph_lines where farm_id = v_farm and code = 'A'),
          'crop_id', (select crop_id from public.ph_incoming_pallets where farm_id = v_farm and code = ip1), 'grade_target', 'premium',
          'notes', 'تشغيل الصباح' || v_tag)) ->> 'id')::uuid;
  jc2 := (public.ph_create_job_card(jsonb_build_object('line_id', (select id from public.ph_lines where farm_id = v_farm and code = 'B'),
          'crop_id', (select crop_id from public.ph_incoming_pallets where farm_id = v_farm and code = ip3), 'grade_target', 'gr1',
          'notes', 'تشغيل بعد الظهر' || v_tag)) ->> 'id')::uuid;
  perform public.ph_create_job_card(jsonb_build_object('line_id', (select id from public.ph_lines where farm_id = v_farm and code = 'A'),
          'crop_id', (select crop_id from public.ph_incoming_pallets where farm_id = v_farm and code = ip1), 'grade_target', 'gr1',
          'notes', 'بانتظار الاعتماد' || v_tag));
  perform set_config('request.jwt.claims', json_build_object('sub', u_phm, 'role', 'authenticated')::text, true);
  perform public.ph_approve_job_card(jc1, 'خطة اليوم' || v_tag);
  perform public.ph_approve_job_card(jc2, null);

  -- Line leader issues 300 kg of the cherry pallet (partial issue: the rest stays available); the store keeper issues packaging.
  perform set_config('request.jwt.claims', json_build_object('sub', u_ll, 'role', 'authenticated')::text, true);
  perform public.ph_issue_to_job_card(jc1, ip1, 300);
  perform set_config('request.jwt.claims', json_build_object('sub', u_stk, 'role', 'authenticated')::text, true);
  perform public.ph_issue_packaging(jc1, 'علبة 250 غ' || v_tag, 1200);
  perform public.ph_issue_packaging(jc1, 'كرتون خارجي' || v_tag, 100);
  perform set_config('request.jwt.claims', json_build_object('sub', u_ll, 'role', 'authenticated')::text, true);
  perform public.ph_mark_job_card_ready(jc1);

  -- G5: QC records the cherry line-start checklist; the line leader confirms; the line runs.
  perform set_config('request.jwt.claims', json_build_object('sub', u_qci, 'role', 'authenticated')::text, true);
  perform public.ph_line_start_check(jc1, 'pass', '{"sorter_calibration":"ok","line_clean":"ok","packer_settings":"ok","packaging_ok":"ok"}');
  perform set_config('request.jwt.claims', json_build_object('sub', u_ll, 'role', 'authenticated')::text, true);
  perform public.ph_confirm_line_start(jc1, null);

  -- QC-2: an online fail (re-sort task to PHM / PE), then pass, then the final pass (G6).
  perform set_config('request.jwt.claims', json_build_object('sub', u_qci, 'role', 'authenticated')::text, true);
  perform public.ph_qc2_record(jc1, 'online', 'fail', '{"critical_defects":"not_ok","labeling":"ok"}', 'عينة 2.5%' || v_tag,
    'ثمار متشققة في العلب' || v_tag);
  perform public.ph_qc2_record(jc1, 'online', 'pass', '{"critical_defects":"ok","labeling":"ok"}', 'بعد إعادة الفرز' || v_tag);
  perform public.ph_qc2_record(jc1, 'final', 'pass', '{"sample":"ok","sorting_spec":"ok","critical_defects":"ok","labeling":"ok","net_gross":"ok"}',
    'عينة نهائية' || v_tag);

  -- Operator weighs two finished pallets and labels the first; QC stamps it; it goes into F1. The second waits for QC.
  perform set_config('request.jwt.claims', json_build_object('sub', u_pho, 'role', 'authenticated')::text, true);
  fg1 := (public.ph_create_fg_pallet(jc1, jsonb_build_object('box_count', 50, 'net_kg', 140.5, 'scale_id', sc1)) ->> 'id')::uuid;
  perform public.ph_create_fg_pallet(jc1, jsonb_build_object('box_count', 50, 'net_kg', 138, 'scale_id', sc1));
  perform public.ph_print_fg_label(fg1);
  perform set_config('request.jwt.claims', json_build_object('sub', u_qci, 'role', 'authenticated')::text, true);
  perform public.ph_fg_qc_approve(fg1, null);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pho, 'role', 'authenticated')::text, true);
  perform public.ph_move_fg_pallet(fg1::text, f1);
  perform set_config('request.jwt.claims', '', true);
end
$demo$;
