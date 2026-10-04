-- DEMO DATA ONLY (farm DEMO, is_demo). Gives the demo supervisor a realistic 6 AM: tasks planned and
-- assigned by the demo agriculture manager through the real transition engine, a demo warehouse with
-- demo items, and one open breakdown report. Invented names; not farm data.
do $demo$
declare
  f      uuid := (select id from public.farms where code = 'DEMO' and is_demo);
  mgr    uuid := (select id from auth.users where email = 'demo.agri.manager@demo.local');
  sup    uuid := (select id from auth.users where email = 'demo.supervisor@demo.local');
  agri   uuid;
  gen    uuid;
  t      uuid;
  wh     uuid;
  i      int;
  titles text[] := array['تعشيب يدوي — بيت تجريبي ١', 'ربط النباتات — بيت تجريبي ٢', 'جني تجريبي — بيت تجريبي ٣', 'تنظيف الممرات — حقل تجريبي ١'];
begin
  if f is null or mgr is null or exists (select 1 from public.tasks where farm_id = f) then
    return;
  end if;
  agri := (select id from public.departments where farm_id = f and code = 'agriculture');
  gen := (select id from public.task_types where farm_id = f and code = 'general');
  perform set_config('app.acting_user_id', mgr::text, true);

  for i in 1..4 loop
    insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date, priority,
                              crew_id, planned_quantity, quantity_unit_id)
    values (f, gen, agri,
            (select id from public.locations where farm_id = f and code = case when i < 4 then 'DEMO-H' || i else 'DEMO-F1' end),
            titles[i], current_date, case when i = 1 then 2 else 3 end,
            (select id from public.crews where farm_id = f and code = case when i % 2 = 1 then 'DEMO-CREW-A' else 'DEMO-CREW-B' end),
            case when i = 3 then 1 end, case when i = 3 then (select id from public.units where farm_id = f and code = 't') end)
    returning id into t;
    perform public.transition_record('tasks', t, 'assigned', jsonb_build_object('supervisor_id', sup));
  end loop;
  -- One task left in planning for the manager's dispatch screen.
  insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
  values (f, gen, agri, (select id from public.locations where farm_id = f and code = 'DEMO-F2'), 'تجهيز خطوط الري — حقل تجريبي ٢', current_date);

  update public.crews set supervisor_user_id = sup, version = version where farm_id = f;

  -- Demo warehouse stock (demo items only).
  perform set_config('app.acting_user_id', (select id::text from auth.users where email = 'demo.admin@demo.local'), true);
  insert into public.warehouses (farm_id, code, name_ar, name_en, kind, department_id, location_id)
  values (f, 'DEMO-WH-MAIN', 'المستودع التجريبي', 'Demo main warehouse', 'main_agricultural',
          (select id from public.departments where farm_id = f and code = 'main_warehouse'),
          (select id from public.locations where farm_id = f and code = 'DEMO-WH'))
  returning id into wh;
  insert into public.items (farm_id, code, name_ar, name_en, kind, base_unit_id)
  values (f, 'DEMO-MAT-1', 'مادة تجريبية ١', 'Demo material 1', 'material', (select id from public.units where farm_id = f and code = 'kg')),
         (f, 'DEMO-MAT-2', 'مادة تجريبية ٢', 'Demo material 2', 'material', (select id from public.units where farm_id = f and code = 'l'));

  -- One open breakdown report from the field.
  perform set_config('app.acting_user_id', sup::text, true);
  insert into public.problem_reports (farm_id, category_id, priority, description, asset_id, location_id)
  values (f, (select id from public.problem_categories where farm_id = f and code = 'equipment_breakdown'), 1,
          'المضخة التجريبية تصدر صوتاً ولا تضخ', (select id from public.assets where farm_id = f and code = 'DEMO-PMP-1'),
          (select id from public.locations where farm_id = f and code = 'DEMO-GH'));
end
$demo$;
