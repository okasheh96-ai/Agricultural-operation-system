-- Farm structure as a function, so the real farm and a separate, clearly flagged demo farm get the
-- identical structure (departments, roles, permission matrix, settings, units, production systems,
-- asset classes, workflows). Structure only — no farm values (Master Prompt §5.3).
-- Later phases add their structure through app.seed_phase_structure(), called at the end.

create function app.seed_phase_structure(p_farm uuid) returns void
language plpgsql as $$ begin null; end $$;
comment on function app.seed_phase_structure is 'Replaced by later phases to add their per-farm structure.';

create function app.create_farm_structure(
  p_code text, p_name_ar text, p_name_en text, p_is_demo boolean, p_source_note text
) returns uuid
language plpgsql
as $fn$
declare
  v_farm uuid;
  v_wf   uuid;
  v_role record;
  v_obj  text;
  v_act  text;
  s      text;
  t      text;
  -- Objects every member may view (field pickers, boards).
  view_objects text[] := array['farm', 'department', 'role', 'role_permission', 'user', 'user_role', 'unit',
    'production_system', 'location', 'asset_class', 'asset', 'water_source', 'crop_master', 'worker', 'crew',
    'setting', 'workflow'];
  admin_objects text[] := array['farm', 'department', 'role', 'role_permission', 'user', 'user_role', 'delegation',
    'device', 'setting', 'workflow', 'unit', 'production_system', 'location', 'asset_class', 'asset',
    'water_source', 'crop_master', 'worker', 'crew'];
  dept_objects text[] := array['location', 'asset', 'water_source', 'worker', 'crew'];
  st text[] := array['not_yet_verified', 'active', 'inactive', 'under_maintenance'];
begin
  -- Seeded master rows that are confirmed by the owner are inserted as verified with a source note.
  perform set_config('app.in_verify', 'on', true);

  insert into public.farms (code, name_ar, name_en, is_demo, verification_status, source_note)
  values (p_code, p_name_ar, p_name_en, p_is_demo, 'not_yet_verified', p_source_note)
  returning id into v_farm;

  -- Departments: existence is tier A (owner brief §1.3); Arabic wording is tier D (E46).
  insert into public.departments (farm_id, code, name_ar, name_en, kind, is_independent, sort_order, verification_status, source_note)
  select v_farm, d.code, d.name_ar, d.name_en, d.kind, d.indep, d.ord, 'to_be_confirmed_on_site',
         'Department confirmed by owner (tier A); Arabic label pending site wording (E46)'
    from (values
      ('main_warehouse',            'المستودع الرئيسي',        'Main Warehouse',                    'service',            false, 1),
      ('plant_protection',          'وقاية النبات',            'Plant Protection',                  'production_support', false, 2),
      ('agriculture',               'الإنتاج الزراعي',          'Agriculture / Agricultural Production', 'production',     false, 3),
      ('fleet',                     'الحركة والآليات',          'Movement / Fleet',                  'service',            false, 4),
      ('wells',                     'الآبار',                  'Wells',                             'service',            false, 5),
      ('irrigation_fertilizer',     'الري وتوزيع الأسمدة',      'Irrigation + Fertilizer Distribution', 'service',         false, 6),
      ('maintenance',               'الصيانة',                 'Maintenance',                       'service',            false, 7),
      ('maintenance_warehouse',     'مستودع الصيانة',           'Maintenance Warehouse',             'service',            false, 8),
      ('packing_house_maintenance', 'صيانة بيت التعبئة',        'Packing House Maintenance',         'service',            false, 9),
      ('qc',                        'مراقبة الجودة',            'QC – Quality Control',              'quality',            false, 10),
      ('qa',                        'ضمان الجودة',              'QA – Quality Assurance',            'quality',            true,  11),
      ('operations',                'العمليات',                 'Operations',                        'coordination',       false, 12),
      ('cattle',                    'عمليات الماشية',           'Cattle Operation',                  'production',         false, 13),
      ('packing_house',             'بيت التعبئة',              'Packing House',                     'production',         false, 14)
    ) as d(code, name_ar, name_en, kind, indep, ord);

  insert into public.roles (farm_id, code, name_ar, name_en)
  select v_farm, r.code, r.name_ar, r.name_en
    from (values
      ('system_admin',           'مدير النظام',              'System Administrator'),
      ('operations_manager',     'مدير العمليات',            'Operations Manager'),
      ('department_manager',     'مدير قسم',                 'Department Manager'),
      ('supervisor',             'مشرف / فورمان',            'Supervisor / Foreman'),
      ('maintenance_manager',    'مدير الصيانة',             'Maintenance Manager'),
      ('maintenance_technician', 'فني صيانة',                'Maintenance Technician'),
      ('warehouse_user',         'مستخدم مستودع',            'Warehouse User'),
      ('irrigation_user',        'مستخدم ري',                'Irrigation User'),
      ('fleet_user',             'مستخدم الحركة والآليات',    'Fleet / Movement User'),
      ('qc_user',                'مستخدم مراقبة الجودة',      'QC User'),
      ('qa_user',                'مستخدم ضمان الجودة',        'QA User'),
      ('packing_house_user',     'مستخدم بيت التعبئة',        'Packing House User'),
      ('executive_viewer',       'مشاهد إداري',               'Management / Executive Viewer')
    ) as r(code, name_ar, name_en);

  -- Permission matrix, Phase 1 objects (tier C — VR-C01..C04; documented in docs/PERMISSIONS.md).
  for v_role in select id, code from public.roles where farm_id = v_farm loop
    foreach v_obj in array view_objects loop
      insert into public.role_permissions (farm_id, role_id, object_type, action) values (v_farm, v_role.id, v_obj, 'view');
    end loop;

    if v_role.code = 'system_admin' then
      foreach v_obj in array admin_objects loop
        foreach v_act in array array['create', 'configure', 'verify', 'void'] loop
          insert into public.role_permissions (farm_id, role_id, object_type, action) values (v_farm, v_role.id, v_obj, v_act);
        end loop;
      end loop;
      insert into public.role_permissions (farm_id, role_id, object_type, action) values
        (v_farm, v_role.id, 'delegation', 'view'), (v_farm, v_role.id, 'device', 'view'),
        (v_farm, v_role.id, 'audit_log', 'view'), (v_farm, v_role.id, 'sync_conflict', 'review'),
        (v_farm, v_role.id, 'worker_private', 'view'), (v_farm, v_role.id, 'worker_private', 'create'),
        (v_farm, v_role.id, 'worker_private', 'configure');
    elsif v_role.code = 'department_manager' then
      foreach v_obj in array dept_objects loop
        foreach v_act in array array['create', 'configure', 'verify', 'void'] loop
          insert into public.role_permissions (farm_id, role_id, object_type, action) values (v_farm, v_role.id, v_obj, v_act);
        end loop;
      end loop;
      insert into public.role_permissions (farm_id, role_id, object_type, action) values
        (v_farm, v_role.id, 'worker_private', 'view'), (v_farm, v_role.id, 'worker_private', 'create'),
        (v_farm, v_role.id, 'worker_private', 'configure'),
        (v_farm, v_role.id, 'delegation', 'view'), (v_farm, v_role.id, 'delegation', 'create'),
        (v_farm, v_role.id, 'delegation', 'configure');
    elsif v_role.code = 'maintenance_manager' then
      insert into public.role_permissions (farm_id, role_id, object_type, action) values
        (v_farm, v_role.id, 'asset', 'create'), (v_farm, v_role.id, 'asset', 'configure');
    elsif v_role.code = 'qa_user' then
      insert into public.role_permissions (farm_id, role_id, object_type, action) values (v_farm, v_role.id, 'audit_log', 'view');
    end if;
  end loop;

  insert into public.settings (farm_id, key, value, evidence_tier, note) values
    (v_farm, 'default_locale',          '"ar"',        'A', 'Arabic-first, owner requirement'),
    (v_farm, 'timezone',                '"Asia/Amman"', 'A', 'Farm is in Jordan'),
    (v_farm, 'currency',                '"JOD"',       'C', 'Default currency; SAR configurable (VR-C08)'),
    (v_farm, 'numerals',                '"western"',   'C', 'Western Arabic numerals by default; Eastern optional'),
    (v_farm, 'calendar_display',        '"gregorian"', 'C', 'Hijri display optional'),
    (v_farm, 'clock_skew_flag_seconds', '300',         'C', 'Device vs server time difference that is flagged (VR-C07)'),
    (v_farm, 'sign_in_method',          '"email"',     'C', 'Phone OTP has per-SMS cost in Jordan (E41)'),
    (v_farm, 'record_of_truth',
       '{"materials":"not_yet_verified","material_distribution":"not_yet_verified","harvest":"not_yet_verified","costs":"not_yet_verified"}',
       'D', 'Which system (this one or FarmERP) is the record of truth per data type (E38)');

  insert into public.units (farm_id, code, name_ar, name_en, dimension, to_base_factor, verification_status, verified_at, source_note)
  select v_farm, u.code, u.name_ar, u.name_en, u.dim, u.f, 'verified', now(), u.src
    from (values
      ('m2',    'متر مربع',  'Square metre', 'area',   1::numeric,  'SI'),
      ('dunum', 'دونم',      'Dunum',        'area',   1000,        'Metric dunum = 1,000 m² (Master Prompt §3.9)'),
      ('ha',    'هكتار',     'Hectare',      'area',   10000,       'SI-accepted; derived display'),
      ('m3',    'متر مكعب',  'Cubic metre',  'volume', 1,           'SI'),
      ('l',     'لتر',       'Litre',        'volume', 0.001,       'SI-accepted'),
      ('kg',    'كيلوغرام',  'Kilogram',     'mass',   1,           'SI'),
      ('g',     'غرام',      'Gram',         'mass',   0.001,       'SI'),
      ('t',     'طن',        'Tonne',        'mass',   1000,        'SI-accepted'),
      ('pc',    'قطعة',      'Piece',        'count',  1,           'Count'),
      ('m',     'متر',       'Metre',        'length', 1,           'SI'),
      ('km',    'كيلومتر',   'Kilometre',    'length', 1000,        'SI'),
      ('h',     'ساعة',      'Hour',         'time',   1,           'Time')
    ) as u(code, name_ar, name_en, dim, f, src);

  insert into public.production_systems (farm_id, code, name_ar, name_en, sort_order, verification_status, verified_at, source_note)
  select v_farm, p.code, p.name_ar, p.name_en, p.ord, p.vs::app.verification_status,
         case when p.vs = 'verified' then now() end, p.src
    from (values
      ('orchard',       'البساتين',     'Orchard',       1, 'not_yet_verified', 'Reported by industry study v1 (tier B)'),
      ('greenhouse',    'البيوت المحمية', 'Greenhouse',   2, 'not_yet_verified', 'Reported by industry study v1 (tier B)'),
      ('open_field',    'الحقول المكشوفة', 'Open Field',   3, 'not_yet_verified', 'Reported by industry study v1 (tier B)'),
      ('packing_house', 'بيت التعبئة',   'Packing House', 4, 'verified',         'Owner brief §1.6 (tier A)'),
      ('cattle',        'الماشية',       'Cattle',        5, 'verified',         'Owner brief §1.4.13 (tier A)'),
      ('support',       'الخدمات المساندة', 'Support',     6, 'not_yet_verified', 'Working assumption for workshops, offices, stores (tier C)')
    ) as p(code, name_ar, name_en, ord, vs, src);

  insert into public.asset_classes (farm_id, code, name_ar, name_en, verification_status, verified_at, source_note)
  select v_farm, a.code, a.name_ar, a.name_en, a.vs::app.verification_status,
         case when a.vs = 'verified' then now() end, a.src
    from (values
      ('vehicle',             'مركبة',            'Vehicle',             'verified',         'Owner brief §1.4.4'),
      ('machine',             'آلية زراعية',       'Machine',             'verified',         'Owner brief §1.4.4'),
      ('equipment',           'معدّة',            'Equipment',           'verified',         'Owner brief §1.4.4'),
      ('bus',                 'حافلة',            'Bus',                 'verified',         'Owner brief §1.4.4'),
      ('generator',           'مولّد',            'Generator',           'verified',         'Owner brief §1.4.7'),
      ('packhouse_equipment', 'معدات بيت التعبئة', 'Packhouse Equipment', 'verified',         'Owner brief §1.6'),
      ('cold_room',           'غرفة تبريد',        'Cold Room',           'verified',         'Owner brief §1.6 (refrigeration / cold storage)'),
      ('pump',                'مضخة',             'Pump',                'not_yet_verified', 'Implied by wells/irrigation; not stated'),
      ('other_transport',     'وسيلة نقل أخرى',    'Other transport asset', 'verified',       'Catch-all class (Master Prompt §2.3.4)'),
      ('other',               'أخرى',             'Other',               'verified',         'Catch-all class')
    ) as a(code, name_ar, name_en, vs, src);

  -- Asset / water-source status workflow v1 (Master Prompt §3.5): any change between statuses, with a reason.
  insert into public.workflow_versions (farm_id, workflow_code, version_no, is_active, note)
  values (v_farm, 'asset_status', 1, true, 'Initial: Active, Inactive, Under Maintenance, Not Yet Verified')
  returning id into v_wf;

  insert into public.workflow_statuses (farm_id, workflow_version_id, code, name_ar, name_en, is_initial, sort_order) values
    (v_farm, v_wf, 'not_yet_verified',  'غير مؤكد بعد', 'Not Yet Verified',  true,  1),
    (v_farm, v_wf, 'active',            'فعّال',        'Active',            false, 2),
    (v_farm, v_wf, 'inactive',          'غير فعّال',    'Inactive',          false, 3),
    (v_farm, v_wf, 'under_maintenance', 'تحت الصيانة',  'Under Maintenance', false, 4);

  foreach s in array st loop
    foreach t in array st loop
      if s <> t then
        insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action, required_fields)
        values (v_farm, v_wf, s, t, 'configure', array['comment']);
      end if;
    end loop;
  end loop;

  update public.workflow_versions set published_at = now() where id = v_wf;

  perform set_config('app.in_verify', 'off', true);
  perform app.seed_phase_structure(v_farm);
  return v_farm;
end;
$fn$;
revoke all on function app.create_farm_structure(text, text, text, boolean, text) from public;
