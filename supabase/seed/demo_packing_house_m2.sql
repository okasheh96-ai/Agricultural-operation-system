-- DEMO DATA — PACKING HOUSE M2.2 / M2.3 (waste, orders) — LOCAL DEVELOPMENT AND THE IN-BROWSER DEMO ONLY. NEVER RUN IN STAGING OR PRODUCTION.
-- Runs after demo_packing_house_production.sql. Everything lives in the DEMO farm (is_demo = true). Customer names, order
-- quantities, waste weights and the ERP reference format are invented for the demo and are NOT farm data.
--
-- OD-11 (basis of the 1 t waste threshold, QA/QC signing level, e-signature) is open. So that the waste sign-off can be tried,
-- the demo farm records a LABELLED DEMO ASSUMPTION: the proposed option A ("per waste report per shift") with the QC and QA
-- managers as signatories. A trigger refuses demo assumptions on any farm that is not a demo farm; on a real farm the routing
-- stays blocked until the owners record OD-11.
--
-- Records are created through the same server functions the app calls, acting as the demo users.
do $demo$
declare
  v_farm uuid := (select id from public.farms where code = 'DEMO' and is_demo);
  v_tag constant text := ' (تجريبي / demo)';
  jc1 uuid;
  sc1 uuid;
  ol1 uuid; ol3 uuid;
  w2 uuid; w3 uuid;
  photo uuid;
  u_sal uuid; u_phm uuid; u_pe uuid; u_dec uuid; u_qci uuid; u_whm uuid;
begin
  if v_farm is null or not exists (select 1 from public.ph_job_cards where farm_id = v_farm) then
    raise notice 'Packing-house production demo not present; skipping the M2 demo.';
    return;
  end if;
  if exists (select 1 from public.ph_order_lines where farm_id = v_farm) then
    return;
  end if;
  select id into u_sal from auth.users where email = 'demo.ph.sal@demo.local';
  select id into u_phm from auth.users where email = 'demo.ph.phm@demo.local';
  select id into u_pe from auth.users where email = 'demo.ph.pe@demo.local';
  select id into u_dec from auth.users where email = 'demo.ph.dec@demo.local';
  select id into u_qci from auth.users where email = 'demo.ph.qci@demo.local';
  select id into u_whm from auth.users where email = 'demo.ph.whm@demo.local';
  if u_sal is null or u_whm is null then
    raise notice 'M2 demo users missing (scripts/demo-people.mjs); skipping.';
    return;
  end if;
  select id into sc1 from public.ph_equipment where farm_id = v_farm and code = 'SCALE-R1';
  select id into jc1 from public.ph_job_cards where farm_id = v_farm and status = 'in_progress' order by code limit 1;

  -- OD-11 demo assumption (labelled; see the header).
  update public.ph_open_decisions
     set decision_state = 'demo_assumption', selected_option = 'A', activate_roles = '{QCM,QAM}',
         rationale = 'DEMO ASSUMPTION — not a management decision. Proposed option A (per waste report per shift); QC and QA managers sign large waste so the sign-off can be tried.',
         decided_at = now(), effective_from = now()
   where farm_id = v_farm and code = 'OD-11';
  perform app.ph_apply_decision(v_farm, 'OD-11');

  -- ST-00 order lines: Sales enters three; the manager accepts one (the engineer plans a Job Card for it) and rejects one.
  perform set_config('request.jwt.claims', json_build_object('sub', u_sal, 'role', 'authenticated')::text, true);
  ol1 := (public.ph_create_order_line(jsonb_build_object('customer_name', 'عميل تجريبي أ / Demo customer A', 'crop_id',
          (select id from public.ph_crops where farm_id = v_farm and code = 'cherry_tomato' and superseded_at is null), 'grade', 'premium',
          'pack_spec', 'علبة 250 غ' || v_tag, 'quantity', 600, 'quantity_unit', 'kg', 'required_date', app.ph_local_date() + 2,
          'market_type', 'local', 'notes', 'بيانات تجريبية' || v_tag)) ->> 'id')::uuid;
  perform public.ph_create_order_line(jsonb_build_object('customer_name', 'عميل تجريبي ب / Demo customer B', 'crop_id',
          (select id from public.ph_crops where farm_id = v_farm and code = 'regular_tomato' and superseded_at is null), 'grade', 'gr1',
          'pack_spec', 'كرتون 5 كغ' || v_tag, 'quantity', 120, 'quantity_unit', 'pc', 'required_date', app.ph_local_date() + 4,
          'market_type', 'export', 'notes', 'بيانات تجريبية' || v_tag));
  ol3 := (public.ph_create_order_line(jsonb_build_object('customer_name', 'عميل تجريبي ج / Demo customer C', 'crop_id',
          (select id from public.ph_crops where farm_id = v_farm and code = 'cherry_tomato' and superseded_at is null), 'grade', 'gr2',
          'pack_spec', 'صندوق مفتوح' || v_tag, 'quantity', 200, 'quantity_unit', 'kg', 'required_date', app.ph_local_date() + 1,
          'market_type', 'lss')) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phm, 'role', 'authenticated')::text, true);
  perform public.ph_decide_order_line(ol1, 'accept', null);
  perform public.ph_decide_order_line(ol3, 'reject', 'لا تتوفر كمية من الدرجة الثانية' || v_tag);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pe, 'role', 'authenticated')::text, true);
  perform public.ph_create_job_card_for_order(ol1, jsonb_build_object('line_id', (select id from public.ph_lines where farm_id = v_farm and code = 'A'),
    'planned_date', app.ph_local_date() + 1, 'notes', 'لطلب العميل أ' || v_tag));

  -- ST-11 waste from the running cherry Job Card: one waiting for the QC label; one labelled, weighed and waiting for the PHM.
  perform set_config('request.jwt.claims', json_build_object('sub', u_dec, 'role', 'authenticated')::text, true);
  perform public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', jc1,
    'reference_kg', 15, 'bags', 2, 'notes', 'فرز الخط' || v_tag));
  w2 := (public.ph_create_waste_record(jsonb_build_object('category', 'processed', 'source_type', 'job_card', 'source', jc1,
    'reference_kg', 9, 'bags', 1, 'notes', 'ثمار متشققة' || v_tag)) ->> 'id')::uuid;
  -- Long-storage waste from the holding fridge, with its photo (SOP-WS): weighed, routed to all signatories, the warehouse manager signed.
  photo := (public.ph_upload_attachment('photo', 'image/png',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'صورة تجريبية' || v_tag) ->> 'id')::uuid;
  w3 := (public.ph_create_waste_record(jsonb_build_object('category', 'long_storage', 'source_type', 'location', 'source', 'HF',
    'crop_id', (select id from public.ph_crops where farm_id = v_farm and code = 'regular_tomato' and superseded_at is null),
    'reference_kg', 40, 'bags', 4, 'notes', 'تخزين طويل' || v_tag, 'attachment_ids', jsonb_build_array(photo))) ->> 'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', u_qci, 'role', 'authenticated')::text, true);
  perform public.ph_waste_qc(w2, 'approve', null);
  perform public.ph_waste_qc(w3, 'approve', null);
  perform set_config('request.jwt.claims', json_build_object('sub', u_dec, 'role', 'authenticated')::text, true);
  perform public.ph_waste_weigh(w2, 8.6, sc1, 1);
  perform public.ph_waste_weigh(w3, 42.4, sc1, 4);
  perform set_config('request.jwt.claims', json_build_object('sub', u_whm, 'role', 'authenticated')::text, true);
  perform public.ph_waste_signoff(w3, 'بيانات تجريبية' || v_tag);
  perform set_config('request.jwt.claims', '', true);
end
$demo$;
