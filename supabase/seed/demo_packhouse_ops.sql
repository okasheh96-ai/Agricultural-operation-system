-- DEMO DATA — PACKHOUSE OPERATIONS (shift, labour sheet, output, stops, order timing) — LOCAL DEVELOPMENT, TESTS AND THE IN-BROWSER
-- DEMO ONLY. NEVER RUN IN STAGING OR PRODUCTION. Everything lives in the DEMO farm (is_demo = true). Workers, pack weights, shift
-- times, box counts, stop causes and order quantities are invented and labelled "(تجريبي / demo)". Customer codes are the ones S-07
-- names (Tesco, Thanet Earth, LSS, Abay, DBS, Export, DC); everything attached to them here is invented.
-- Times are relative to now() so the demo always shows a running shift (yesterday's shift is closed and submitted).
-- Records are created through the same server functions the app calls, acting as the demo users.
do $demo$
declare
  v_farm uuid := (select id from public.farms where code = 'DEMO' and is_demo);
  v_tag constant text := ' (تجريبي / demo)';
  u_phm uuid; u_pe uuid; u_lla uuid; u_llb uuid; u_ll uuid; u_adm uuid; u_sal uuid; u_qcm uuid; u_qci uuid; u_mnt uuid;
  l_a uuid; l_b uuid; l_c uuid;
  pf5 uuid; pf7 uuid; pf25 uuid; c_belt uuid; c_mat uuid; pk_ctn uuid; pk_pal uuid;
  t_pack uuid; t_other uuid; t_team uuid;
  sh_y uuid; sh_t uuid; ls_ya uuid; ls_yb uuid; ls_ta uuid; ls_tb uuid; ls_tc uuid;
  w uuid[] := '{}'; v uuid; i integer;
  ol_a uuid; ol_b uuid; ol_c uuid; ol_d uuid;
  team uuid; st uuid; iv jsonb;
  t0 timestamptz := date_trunc('minute', now());
  crop_ch uuid; crop_rt uuid; crop_sb uuid;
begin
  if v_farm is null then raise notice 'Demo farm missing; skipping.'; return; end if;
  if exists (select 1 from public.ph_shifts where farm_id = v_farm) then return; end if;
  select id into u_phm from auth.users where email = 'demo.ph.phm@demo.local';
  select id into u_pe from auth.users where email = 'demo.ph.pe@demo.local';
  select id into u_ll from auth.users where email = 'demo.ph.ll@demo.local';
  select id into u_lla from auth.users where email = 'demo.ph.lla@demo.local';
  select id into u_llb from auth.users where email = 'demo.ph.llb@demo.local';
  select id into u_adm from auth.users where email = 'demo.ph.adm@demo.local';
  select id into u_sal from auth.users where email = 'demo.ph.sal@demo.local';
  select id into u_qcm from auth.users where email = 'demo.ph.qcm@demo.local';
  select id into u_qci from auth.users where email = 'demo.ph.qci@demo.local';
  select id into u_mnt from auth.users where email = 'demo.ph.mnt@demo.local';
  if u_lla is null or u_pe is null or u_adm is null or u_mnt is null then
    raise notice 'Packhouse ops demo users missing (scripts/demo-people.mjs); skipping.';
    return;
  end if;
  select id into l_a from public.ph_lines where farm_id = v_farm and code = 'A';
  select id into l_b from public.ph_lines where farm_id = v_farm and code = 'B';
  select id into l_c from public.ph_lines where farm_id = v_farm and code = 'C';
  if l_a is null then raise notice 'Packing-house reference data missing; skipping.'; return; end if;
  -- Line scope: the two line supervisors cover one line each.
  update public.user_roles set ph_line_id = l_a where user_id = u_lla and farm_id = v_farm;
  update public.user_roles set ph_line_id = l_b where user_id = u_llb and farm_id = v_farm;

  -- Master data: entered by the admin, approved by the PHM (maker ≠ checker).
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  pf5 := (public.ph_save_master('ph_pack_formats', null, jsonb_build_object('code', 'CTN-5KG', 'name_ar', 'كرتونة 5 كغم' || v_tag,
          'name_en', '5 kg carton' || v_tag, 'kind', 'carton', 'nominal_net_kg', 5)) ->> 'id')::uuid;
  pf7 := (public.ph_save_master('ph_pack_formats', null, jsonb_build_object('code', 'CTN-7KG', 'name_ar', 'كرتونة 7 كغم' || v_tag,
          'name_en', '7 kg carton' || v_tag, 'kind', 'carton', 'nominal_net_kg', 7)) ->> 'id')::uuid;
  pf25 := (public.ph_save_master('ph_pack_formats', null, jsonb_build_object('code', 'PUN-10X250', 'name_ar', 'كرتونة 10 علب × 250 غ' || v_tag,
          'name_en', '10 × 250 g punnets' || v_tag, 'kind', 'punnet_carton', 'nominal_net_kg', 2.5, 'units_per_pack', 10)) ->> 'id')::uuid;
  c_belt := (public.ph_save_master('ph_downtime_causes', null, jsonb_build_object('code', 'MECH-BELT', 'name_ar', 'عطل ميكانيكي — سير' || v_tag,
             'name_en', 'Mechanical — belt' || v_tag, 'category', 'mechanical')) ->> 'id')::uuid;
  c_mat := (public.ph_save_master('ph_downtime_causes', null, jsonb_build_object('code', 'NO-PRODUCT', 'name_ar', 'انتظار المنتج' || v_tag,
            'name_en', 'Waiting for product' || v_tag, 'category', 'material')) ->> 'id')::uuid;
  pk_ctn := (public.ph_save_master('ph_packaging_items', null, jsonb_build_object('code', 'CTN-7KG', 'name_ar', 'كرتون 7 كغم' || v_tag,
             'name_en', '7 kg carton' || v_tag, 'kind', 'carton')) ->> 'id')::uuid;
  pk_pal := (public.ph_save_master('ph_packaging_items', null, jsonb_build_object('code', 'PALLET-EU', 'name_ar', 'منصة' || v_tag,
             'name_en', 'Pallet' || v_tag, 'kind', 'pallet')) ->> 'id')::uuid;
  perform public.ph_save_master('ph_shift_templates', null, jsonb_build_object('code', 'DAY', 'name_ar', 'وردية نهارية' || v_tag,
          'name_en', 'Day shift' || v_tag, 'starts_at', '06:00', 'ends_at', '16:00', 'sort_order', 1));
  perform public.ph_save_master('ph_shift_templates', null, jsonb_build_object('code', 'EVE', 'name_ar', 'وردية مسائية' || v_tag,
          'name_en', 'Evening shift' || v_tag, 'starts_at', '16:00', 'ends_at', '02:00', 'sort_order', 2));
  perform set_config('request.jwt.claims', json_build_object('sub', u_sal, 'role', 'authenticated')::text, true);
  perform public.ph_save_master('ph_customers', null, jsonb_build_object('code', c.code, 'name_en', c.code, 'notes', 'Customer code named in S-07; details invented for the demo'))
     from (values ('Tesco'), ('Thanet Earth'), ('LSS'), ('Abay'), ('DBS'), ('Export'), ('DC')) as c(code);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phm, 'role', 'authenticated')::text, true);
  perform public.ph_approve_master(t, id, 'Demo approval' || v_tag)
     from (select 'ph_pack_formats' as t, id from public.ph_pack_formats where farm_id = v_farm
           union all select 'ph_downtime_causes', id from public.ph_downtime_causes where farm_id = v_farm
           union all select 'ph_packaging_items', id from public.ph_packaging_items where farm_id = v_farm
           union all select 'ph_shift_templates', id from public.ph_shift_templates where farm_id = v_farm) x;
  perform set_config('request.jwt.claims', json_build_object('sub', u_qcm, 'role', 'authenticated')::text, true);
  perform public.ph_approve_master('ph_customers', id, 'Demo approval' || v_tag) from public.ph_customers where farm_id = v_farm;
  select id into crop_ch from public.ph_crops where farm_id = v_farm and code = 'cherry_tomato' and superseded_at is null and verification_status = 'verified';
  select id into crop_rt from public.ph_crops where farm_id = v_farm and code = 'regular_tomato' and superseded_at is null and verification_status = 'verified';
  select id into crop_sb from public.ph_crops where farm_id = v_farm and code = 'sweetbite' and superseded_at is null and verification_status = 'verified';
  if crop_rt is null then crop_rt := crop_ch; end if;
  if crop_sb is null then crop_sb := crop_ch; end if;

  -- Demo workers (invented).
  for i in 1..14 loop
    insert into public.workers (farm_id, code, full_name, full_name_en)
    values (v_farm, 'W' || lpad(i::text, 3, '0'), 'عامل تجريبي ' || lpad(i::text, 2, '0'), 'Demo worker ' || lpad(i::text, 2, '0'))
    returning id into v;
    w := w || v;
  end loop;
  select id into t_pack from public.ph_task_kinds where farm_id = v_farm and code = 'packing';
  select id into t_other from public.ph_task_kinds where farm_id = v_farm and code = 'other_duty';
  select id into t_team from public.ph_task_kinds where farm_id = v_farm and code = 'shared_sorting';

  -- Orders (Sales enters, PHM accepts, engineer plans).
  perform set_config('request.jwt.claims', json_build_object('sub', u_sal, 'role', 'authenticated')::text, true);
  ol_a := (public.ph_create_order_line(jsonb_build_object('customer_name', 'Tesco', 'crop_id', crop_ch, 'grade', 'gr1',
           'pack_spec', '7 kg carton' || v_tag, 'quantity', 1400, 'quantity_unit', 'kg', 'required_date', app.ph_local_date(),
           'market_type', 'export', 'notes', 'Demo order' || v_tag)) ->> 'id')::uuid;
  ol_b := (public.ph_create_order_line(jsonb_build_object('customer_name', 'LSS', 'crop_id', crop_rt, 'grade', 'gr1',
           'pack_spec', '5 kg carton' || v_tag, 'quantity', 900, 'quantity_unit', 'kg', 'required_date', app.ph_local_date(),
           'market_type', 'lss', 'notes', 'Demo order' || v_tag)) ->> 'id')::uuid;
  ol_c := (public.ph_create_order_line(jsonb_build_object('customer_name', 'Thanet Earth', 'crop_id', crop_sb, 'grade', 'gr1',
           'pack_spec', '5 kg carton' || v_tag, 'quantity', 800, 'quantity_unit', 'kg', 'required_date', app.ph_local_date(),
           'market_type', 'export', 'notes', 'Demo order' || v_tag)) ->> 'id')::uuid;
  ol_d := (public.ph_create_order_line(jsonb_build_object('customer_name', 'DC', 'crop_id', crop_ch, 'grade', 'gr2',
           'pack_spec', '7 kg carton' || v_tag, 'quantity', 120, 'quantity_unit', 'pc', 'required_date', app.ph_local_date() + 1,
           'market_type', 'local', 'notes', 'Demo order' || v_tag)) ->> 'id')::uuid;
  update public.ph_order_lines set customer_id = (select id from public.ph_customers where farm_id = v_farm and code = customer_name)
   where id in (ol_a, ol_b, ol_c, ol_d);
  update public.ph_order_lines set pack_format_id = pf7 where id in (ol_a, ol_d);
  update public.ph_order_lines set pack_format_id = pf5 where id in (ol_b, ol_c);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phm, 'role', 'authenticated')::text, true);
  perform public.ph_decide_order_line(x, 'accept') from unnest(array[ol_a, ol_b, ol_c, ol_d]) x;

  -- Yesterday: a closed shift, both sheets submitted, one order completed over plan, one stop with a cause.
  perform set_config('request.jwt.claims', json_build_object('sub', u_pe, 'role', 'authenticated')::text, true);
  sh_y := (public.ph_open_shift(jsonb_build_object('shift_date', app.ph_local_date(t0 - interval '1 day'), 'planned_start', t0 - interval '30 hours',
           'planned_end', t0 - interval '20 hours', 'engineer_user_id', u_pe)) ->> 'id')::uuid;
  ls_ya := (public.ph_open_line_shift(sh_y, l_a, u_lla) ->> 'id')::uuid;
  ls_yb := (public.ph_open_line_shift(sh_y, l_b, u_llb) ->> 'id')::uuid;
  perform public.ph_labour_start(ls_ya, w[1:4], t_pack, (t0 - interval '29 hours')::text);
  perform public.ph_labour_start(ls_yb, w[5:7], t_pack, (t0 - interval '29 hours')::text);
  for i in 1..4 loop
    perform public.ph_record_output(jsonb_build_object('line_shift_id', ls_ya, 'worker_id', w[i], 'grade', 'gr1', 'pack_format_id', pf7,
            'boxes', 30 + i * 4, 'period_end', t0 - interval '25 hours'));
    perform public.ph_record_output(jsonb_build_object('line_shift_id', ls_ya, 'worker_id', w[i], 'grade', 'gr2', 'pack_format_id', pf7,
            'boxes', 6 + i, 'period_end', t0 - interval '22 hours'));
  end loop;
  for i in 5..7 loop
    perform public.ph_record_output(jsonb_build_object('line_shift_id', ls_yb, 'worker_id', w[i], 'grade', 'gr1', 'pack_format_id', pf5,
            'boxes', 50 + i * 3, 'period_end', t0 - interval '23 hours'));
  end loop;
  update public.ph_labour_intervals set ended_at = t0 - interval '21 hours' where line_shift_id in (ls_ya, ls_yb) and ended_at is null;
  st := (public.ph_report_stop(jsonb_build_object('line_ids', jsonb_build_array(l_a), 'observed_fault', 'السير ينزلق' || v_tag,
         'stopped_at', t0 - interval '26 hours')) ->> 'id')::uuid;
  perform public.ph_stop_step(st, 'restart', jsonb_build_object('restarted_at', t0 - interval '25 hours 35 minutes'));
  perform public.ph_stop_step(st, 'cause', jsonb_build_object('cause_id', c_belt, 'note', 'Demo cause' || v_tag));
  perform public.ph_record_order_plan(ol_b, jsonb_build_object('planned_duration_min', 360, 'planned_start_at', t0 - interval '29 hours',
          'promised_loading_at', t0 - interval '22 hours', 'line_id', l_b));
  perform public.ph_order_step(ol_b, 'start', (t0 - interval '29 hours')::text);
  perform public.ph_order_step(ol_b, 'complete', (t0 - interval '22 hours 30 minutes')::text, 'تأخر وصول المنتج من الثلاجة' || v_tag);
  perform set_config('request.jwt.claims', json_build_object('sub', u_lla, 'role', 'authenticated')::text, true);
  perform public.ph_submit_line_shift(ls_ya, '{"full_pallets":3,"partial_pallets":1}', 'Demo sheet' || v_tag);
  perform set_config('request.jwt.claims', json_build_object('sub', u_llb, 'role', 'authenticated')::text, true);
  perform public.ph_submit_line_shift(ls_yb, '{"full_pallets":2,"partial_pallets":0}', 'Demo sheet' || v_tag);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pe, 'role', 'authenticated')::text, true);
  perform public.ph_close_shift(sh_y, 'Demo handover: order completed; no open stops' || v_tag);

  -- Today: a running shift; lines A and B have sheets, line C opened, the washer not opened.
  sh_t := (public.ph_open_shift(jsonb_build_object('shift_date', app.ph_local_date(t0), 'planned_start', t0 - interval '5 hours',
           'planned_end', t0 + interval '5 hours', 'engineer_user_id', u_pe)) ->> 'id')::uuid;
  ls_ta := (public.ph_open_line_shift(sh_t, l_a, u_lla) ->> 'id')::uuid;
  ls_tb := (public.ph_open_line_shift(sh_t, l_b, u_llb) ->> 'id')::uuid;
  ls_tc := (public.ph_open_line_shift(sh_t, l_c, u_ll) ->> 'id')::uuid;
  perform public.ph_record_order_plan(ol_a, jsonb_build_object('planned_duration_min', 420, 'planned_start_at', t0 - interval '4 hours 30 minutes',
          'promised_loading_at', t0 + interval '2 hours', 'line_id', l_a));
  perform public.ph_record_order_plan(ol_c, jsonb_build_object('planned_duration_min', 300, 'planned_start_at', t0 - interval '4 hours',
          'promised_loading_at', t0 + interval '3 hours', 'line_id', l_c));
  perform public.ph_order_step(ol_a, 'start', (t0 - interval '4 hours 30 minutes')::text);
  perform public.ph_order_step(ol_c, 'start', (t0 - interval '4 hours')::text);
  perform public.ph_packaging_move(jsonb_build_object('item_id', pk_ctn, 'kind', 'requested', 'quantity', 200, 'order_line_id', ol_a));
  perform public.ph_packaging_move(jsonb_build_object('item_id', pk_ctn, 'kind', 'received', 'quantity', 160, 'order_line_id', ol_a));

  perform set_config('request.jwt.claims', json_build_object('sub', u_lla, 'role', 'authenticated')::text, true);
  perform public.ph_record_readiness(ls_ta, '{"line_ready":"ok","packaging_inside":"ok","hygiene_workwear":"ok","first_pack_weighed":"ok"}');
  perform public.ph_first_pack_check(jsonb_build_object('line_shift_id', ls_ta, 'pack_format_id', pf7, 'order_line_id', ol_a, 'measured_kg', 7.05,
          'machine_setting_ok', true));
  perform public.ph_labour_start(ls_ta, w[1:4], t_pack, (t0 - interval '4 hours 30 minutes')::text, null, ol_a);
  for i in 1..4 loop
    perform public.ph_record_output(jsonb_build_object('line_shift_id', ls_ta, 'worker_id', w[i], 'order_line_id', ol_a, 'grade', 'gr1',
            'pack_format_id', pf7, 'boxes', 18 + i * 2, 'period_end', t0 - interval '2 hours'));
    perform public.ph_record_output(jsonb_build_object('line_shift_id', ls_ta, 'worker_id', w[i], 'order_line_id', ol_a, 'grade', 'gr1',
            'pack_format_id', pf7, 'boxes', 12 + i, 'period_end', t0 - interval '30 minutes'));
  end loop;
  -- W004 moved to another duty for the last hour.
  select id into v from public.ph_labour_intervals where line_shift_id = ls_ta and worker_id = w[4] and ended_at is null;
  perform public.ph_labour_move(v, ls_ta, t_other, (t0 - interval '1 hour')::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_llb, 'role', 'authenticated')::text, true);
  perform public.ph_labour_start(ls_tb, w[5:7], t_pack, (t0 - interval '4 hours')::text);
  for i in 5..7 loop
    perform public.ph_record_output(jsonb_build_object('line_shift_id', ls_tb, 'worker_id', w[i], 'grade', 'gr1', 'pack_format_id', pf5,
            'boxes', 25 + i, 'period_end', t0 - interval '1 hour 30 minutes'));
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', u_ll, 'role', 'authenticated')::text, true);
  team := (public.ph_team_start(ls_tc, t_team, w[8:10], (t0 - interval '4 hours')::text, 'فرز سويت بايت' || v_tag, ol_c) ->> 'id')::uuid;
  perform public.ph_record_output(jsonb_build_object('line_shift_id', ls_tc, 'team_session_id', team, 'grade', 'gr1', 'pack_format_id', pf5,
          'boxes', 64, 'period_end', t0 - interval '2 hours'));
  perform public.ph_record_output(jsonb_build_object('line_shift_id', ls_tc, 'team_session_id', team, 'grade', 'gr2', 'pack_format_id', pf5,
          'boxes', 9, 'period_end', t0 - interval '2 hours'));
  perform public.ph_labour_start(ls_tc, array[w[11]], t_team, (t0 - interval '2 hours')::text, null, null, team);

  -- An open stop on line B now; a QC observation routed to the engineer.
  perform set_config('request.jwt.claims', json_build_object('sub', u_pe, 'role', 'authenticated')::text, true);
  perform public.ph_report_stop(jsonb_build_object('line_ids', jsonb_build_array(l_b), 'observed_fault', 'الميزان لا يقرأ' || v_tag,
          'stopped_at', t0 - interval '25 minutes'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_qci, 'role', 'authenticated')::text, true);
  perform public.ph_report_issue(jsonb_build_object('line_shift_id', ls_ta, 'kind', 'qc_observation',
          'description', 'وزن العبوة على الملصق لا يطابق الطلبية' || v_tag));
  perform set_config('request.jwt.claims', '', true);
end;
$demo$;
