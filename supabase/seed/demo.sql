-- DEMO DATA — LOCAL DEVELOPMENT AND SCREENSHOTS ONLY. NEVER RUN IN STAGING OR PRODUCTION.
-- Lives in a separate farm (code DEMO, is_demo = true) that real users cannot see; the UI shows
-- "بيانات تجريبية / Demo Data" on every screen of this farm. Every name below is invented for the
-- demo and is NOT farm data: no real wells, crops, staff, rates or protocols.
do $demo$
declare
  v_farm uuid;
  v_root uuid; v_gh uuid; v_of uuid; v_ws uuid;
begin
  if exists (select 1 from public.farms where code = 'DEMO') then
    return;
  end if;
  v_farm := app.create_farm_structure('DEMO', 'مزرعة تجريبية', 'Demo farm', true, 'Demo data — not real');

  insert into public.locations (farm_id, type, code, name_ar, name_en, source_note)
  values (v_farm, 'farm', 'DEMO-FARM', 'مزرعة تجريبية', 'Demo farm', 'Demo') returning id into v_root;
  insert into public.locations (farm_id, parent_id, type, code, name_ar, name_en, production_system_id, source_note)
  values (v_farm, v_root, 'production_system', 'DEMO-GH', 'بيوت محمية تجريبية', 'Demo greenhouses',
          (select id from public.production_systems where farm_id = v_farm and code = 'greenhouse'), 'Demo')
  returning id into v_gh;
  insert into public.locations (farm_id, parent_id, type, code, name_ar, name_en, production_system_id, source_note)
  values (v_farm, v_root, 'production_system', 'DEMO-OF', 'حقول مكشوفة تجريبية', 'Demo open fields',
          (select id from public.production_systems where farm_id = v_farm and code = 'open_field'), 'Demo')
  returning id into v_of;
  insert into public.locations (farm_id, parent_id, type, code, name_ar, name_en, owning_department_id, source_note)
  select v_farm, v_gh, 'house', 'DEMO-H' || i, 'بيت تجريبي ' || i, 'Demo house ' || i,
         (select id from public.departments where farm_id = v_farm and code = 'agriculture'), 'Demo'
    from generate_series(1, 4) i;
  insert into public.locations (farm_id, parent_id, type, code, name_ar, name_en, owning_department_id, source_note)
  select v_farm, v_of, 'field', 'DEMO-F' || i, 'حقل تجريبي ' || i, 'Demo field ' || i,
         (select id from public.departments where farm_id = v_farm and code = 'agriculture'), 'Demo'
    from generate_series(1, 3) i;
  insert into public.locations (farm_id, parent_id, type, code, name_ar, name_en, source_note)
  values (v_farm, v_root, 'warehouse', 'DEMO-WH', 'مستودع تجريبي', 'Demo warehouse', 'Demo') returning id into v_ws;

  insert into public.assets (farm_id, code, name_ar, name_en, asset_class_id, owning_department_id, location_id, source_note)
  values
    (v_farm, 'DEMO-TR-1', 'جرار تجريبي ١', 'Demo tractor 1', (select id from public.asset_classes where farm_id = v_farm and code = 'machine'),
     (select id from public.departments where farm_id = v_farm and code = 'fleet'), v_root, 'Demo'),
    (v_farm, 'DEMO-PMP-1', 'مضخة تجريبية ١', 'Demo pump 1', (select id from public.asset_classes where farm_id = v_farm and code = 'pump'),
     (select id from public.departments where farm_id = v_farm and code = 'maintenance'), v_gh, 'Demo'),
    (v_farm, 'DEMO-GEN-1', 'مولد تجريبي ١', 'Demo generator 1', (select id from public.asset_classes where farm_id = v_farm and code = 'generator'),
     (select id from public.departments where farm_id = v_farm and code = 'maintenance'), v_root, 'Demo');

  insert into public.workers (farm_id, code, full_name, full_name_en, home_department_id, source_note)
  select v_farm, 'DEMO-W' || lpad(i::text, 2, '0'), 'عامل تجريبي ' || i, 'Demo worker ' || i,
         (select id from public.departments where farm_id = v_farm and code = 'agriculture'), 'Demo'
    from generate_series(1, 12) i;
  insert into public.crews (farm_id, code, name_ar, name_en, department_id, source_note)
  values (v_farm, 'DEMO-CREW-A', 'طاقم تجريبي أ', 'Demo crew A', (select id from public.departments where farm_id = v_farm and code = 'agriculture'), 'Demo'),
         (v_farm, 'DEMO-CREW-B', 'طاقم تجريبي ب', 'Demo crew B', (select id from public.departments where farm_id = v_farm and code = 'agriculture'), 'Demo');
  insert into public.crew_members (farm_id, crew_id, worker_id, valid_from)
  select v_farm, (select id from public.crews where farm_id = v_farm and code = case when w.n <= 6 then 'DEMO-CREW-A' else 'DEMO-CREW-B' end),
         w.id, now() - interval '30 days'
    from (select id, row_number() over (order by code) n from public.workers where farm_id = v_farm) w;
end
$demo$;
