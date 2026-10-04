-- Phase 2 per-farm structure: workflows (task, problem_report, issue_request), the Phase 2 permission
-- matrix, generic task types and problem categories. Structure only; tier C items are marked
-- not_yet_verified and listed in docs/VERIFICATION_REGISTER.md (VR-C15..C20).

set check_function_bodies = off;

create function app.define_workflow(p_farm uuid, p_code text, p_statuses jsonb, p_transitions jsonb) returns uuid
language plpgsql
as $$
declare
  v_wf uuid;
  s    jsonb;
  t    jsonb;
  arr  text := 'select coalesce(array(select jsonb_array_elements_text(coalesce($1, ''[]''))), ''{}'')';
  v_req text[]; v_diff text[]; v_pay text[]; v_clear text[];
begin
  insert into public.workflow_versions (farm_id, workflow_code, version_no, is_active, note)
  values (p_farm, p_code, 1, true, 'Initial definition (Master Prompt §3.5)') returning id into v_wf;
  for s in select * from jsonb_array_elements(p_statuses) loop
    insert into public.workflow_statuses (farm_id, workflow_version_id, code, name_ar, name_en, is_initial, is_terminal, sort_order)
    values (p_farm, v_wf, s ->> 'code', s ->> 'ar', s ->> 'en', coalesce((s ->> 'initial')::boolean, false),
            coalesce((s ->> 'terminal')::boolean, false), coalesce((s ->> 'sort')::int, 0));
  end loop;
  for t in select * from jsonb_array_elements(p_transitions) loop
    execute arr into v_req using t -> 'req';
    execute arr into v_diff using t -> 'differ';
    execute arr into v_pay using t -> 'payload';
    execute arr into v_clear using t -> 'clear';
    insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action,
      required_fields, must_differ_from, set_actor_column, payload_columns, clear_columns, counter_column, guard, scope_column)
    values (p_farm, v_wf, t ->> 'from', t ->> 'to', t ->> 'action', v_req, v_diff, t ->> 'actor', v_pay, v_clear,
            t ->> 'counter', t ->> 'guard', t ->> 'scope');
  end loop;
  update public.workflow_versions set published_at = now() where id = v_wf;
  return v_wf;
end;
$$;

create function app.grant_permissions(p_farm uuid, p_role text, p_object text, p_actions text[]) returns void
language sql
as $$
  insert into public.role_permissions (farm_id, role_id, object_type, action)
  select p_farm, r.id, p_object, a
    from public.roles r, unnest(p_actions) a
   where r.farm_id = p_farm and r.code = p_role
     and not exists (select 1 from public.role_permissions rp
                      where rp.role_id = r.id and rp.object_type = p_object and rp.action = a and rp.voided_at is null)
$$;

create function app.seed_phase2_structure(p_farm uuid) returns void
language plpgsql
as $$
declare
  r    text;
  dept uuid;
  verif constant jsonb := '{}';
begin
  if exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'task') then
    return;
  end if;

  perform app.define_workflow(p_farm, 'task',
    '[{"code":"draft","ar":"مسودة","en":"Draft","initial":true,"sort":1},
      {"code":"planned","ar":"مخطط","en":"Planned","sort":2},
      {"code":"assigned","ar":"مُسند","en":"Assigned","sort":3},
      {"code":"in_progress","ar":"قيد التنفيذ","en":"In progress","sort":4},
      {"code":"blocked","ar":"متوقف","en":"Blocked","sort":5},
      {"code":"completed","ar":"منجز","en":"Completed","sort":6},
      {"code":"pending_verification","ar":"بانتظار التحقق","en":"Pending verification","sort":7},
      {"code":"verified","ar":"تم التحقق","en":"Verified","sort":8},
      {"code":"closed","ar":"مغلق","en":"Closed","terminal":true,"sort":9},
      {"code":"cancelled","ar":"ملغى","en":"Cancelled","terminal":true,"sort":10}]',
    '[{"from":"draft","to":"planned","action":"plan","req":["planned_date","location_id"]},
      {"from":"draft","to":"assigned","action":"dispatch","req":["planned_date","location_id","supervisor_id"],"actor":"assigned_by","payload":["supervisor_id","crew_id"]},
      {"from":"planned","to":"assigned","action":"dispatch","req":["supervisor_id"],"actor":"assigned_by","payload":["supervisor_id","crew_id"]},
      {"from":"assigned","to":"in_progress","action":"execute","actor":"started_by"},
      {"from":"assigned","to":"blocked","action":"execute","req":["blocked_reason"],"payload":["blocked_reason","blocked_note","blocked_problem_report_id","blocked_issue_request_id"]},
      {"from":"in_progress","to":"blocked","action":"execute","req":["blocked_reason"],"payload":["blocked_reason","blocked_note","blocked_problem_report_id","blocked_issue_request_id"]},
      {"from":"blocked","to":"in_progress","action":"execute","clear":["blocked_reason","blocked_note","blocked_problem_report_id","blocked_issue_request_id"]},
      {"from":"in_progress","to":"pending_verification","action":"execute","actor":"completed_by","payload":["actual_quantity","quantity_unit_id","completion_note"],"guard":"task_requires_verification"},
      {"from":"in_progress","to":"completed","action":"execute","actor":"completed_by","payload":["actual_quantity","quantity_unit_id","completion_note"],"guard":"task_no_verification"},
      {"from":"pending_verification","to":"verified","action":"verify","differ":["completed_by"],"actor":"verified_by"},
      {"from":"pending_verification","to":"in_progress","action":"verify","req":["comment"],"counter":"rejection_count"},
      {"from":"verified","to":"closed","action":"close","actor":"closed_by"},
      {"from":"completed","to":"closed","action":"close","actor":"closed_by"},
      {"from":"verified","to":"in_progress","action":"review","req":["comment"]},
      {"from":"completed","to":"in_progress","action":"review","req":["comment"]},
      {"from":"draft","to":"cancelled","action":"plan","req":["comment"]},
      {"from":"planned","to":"cancelled","action":"plan","req":["comment"]},
      {"from":"assigned","to":"cancelled","action":"plan","req":["comment"]},
      {"from":"blocked","to":"cancelled","action":"plan","req":["comment"]}]');

  perform app.define_workflow(p_farm, 'problem_report',
    '[{"code":"open","ar":"مفتوح","en":"Open","initial":true,"sort":1},
      {"code":"acknowledged","ar":"تم الاستلام","en":"Acknowledged","sort":2},
      {"code":"converted","ar":"حُوّل إلى عمل","en":"Converted to work","terminal":true,"sort":3},
      {"code":"resolved","ar":"تمت المعالجة","en":"Resolved","terminal":true,"sort":4},
      {"code":"rejected","ar":"مرفوض","en":"Rejected","terminal":true,"sort":5}]',
    '[{"from":"open","to":"acknowledged","action":"review","actor":"acknowledged_by"},
      {"from":"open","to":"converted","action":"review","guard":"problem_report_triaged"},
      {"from":"acknowledged","to":"converted","action":"review","guard":"problem_report_triaged"},
      {"from":"open","to":"resolved","action":"review","req":["comment"],"actor":"resolved_by"},
      {"from":"acknowledged","to":"resolved","action":"review","req":["comment"],"actor":"resolved_by"},
      {"from":"open","to":"rejected","action":"review","req":["comment"]},
      {"from":"acknowledged","to":"rejected","action":"review","req":["comment"]}]');

  perform app.define_workflow(p_farm, 'issue_request',
    '[{"code":"requested","ar":"مطلوب","en":"Requested","initial":true,"sort":1},
      {"code":"approved","ar":"معتمد","en":"Approved","sort":2},
      {"code":"partially_issued","ar":"صُرف جزئياً","en":"Partially issued","sort":3},
      {"code":"issued","ar":"صُرف","en":"Issued","sort":4},
      {"code":"received","ar":"تم الاستلام","en":"Received","terminal":true,"sort":5},
      {"code":"rejected","ar":"مرفوض","en":"Rejected","terminal":true,"sort":6},
      {"code":"cancelled","ar":"ملغى","en":"Cancelled","terminal":true,"sort":7}]',
    '[{"from":"requested","to":"approved","action":"approve","scope":"department_id"},
      {"from":"requested","to":"issued","action":"execute","scope":"warehouse_department_id","guard":"issue_approval_not_required"},
      {"from":"requested","to":"partially_issued","action":"execute","scope":"warehouse_department_id","guard":"issue_approval_not_required"},
      {"from":"approved","to":"issued","action":"execute","scope":"warehouse_department_id"},
      {"from":"approved","to":"partially_issued","action":"execute","scope":"warehouse_department_id"},
      {"from":"partially_issued","to":"issued","action":"execute","scope":"warehouse_department_id"},
      {"from":"issued","to":"received","action":"execute","scope":"department_id"},
      {"from":"partially_issued","to":"received","action":"execute","scope":"department_id"},
      {"from":"requested","to":"rejected","action":"execute","scope":"warehouse_department_id","req":["comment"]},
      {"from":"approved","to":"rejected","action":"execute","scope":"warehouse_department_id","req":["comment"]},
      {"from":"requested","to":"cancelled","action":"execute","scope":"department_id","req":["comment"]},
      {"from":"approved","to":"cancelled","action":"execute","scope":"department_id","req":["comment"]}]');

  -- Everyone may view Phase 2 records (boards, pickers); RLS select policies are farm membership.
  for r in select code from public.roles where farm_id = p_farm loop
    perform app.grant_permissions(p_farm, r, o, array['view'])
       from unnest(array['task', 'plan', 'work_order', 'problem_report', 'task_type', 'problem_category',
                         'warehouse', 'item', 'issue_request', 'stock', 'escalation_rule']) o;
  end loop;

  -- Execution in the field (own department via user_roles scope).
  foreach r in array array['supervisor', 'maintenance_technician', 'irrigation_user', 'fleet_user', 'packing_house_user'] loop
    perform app.grant_permissions(p_farm, r, 'task', array['create', 'execute']);
    perform app.grant_permissions(p_farm, r, 'issue_request', array['create', 'execute']);
  end loop;
  -- Department management: plan, dispatch, verify, close, triage.
  foreach r in array array['department_manager', 'maintenance_manager'] loop
    perform app.grant_permissions(p_farm, r, 'task', array['create', 'plan', 'dispatch', 'execute', 'review', 'verify', 'close', 'void']);
    perform app.grant_permissions(p_farm, r, 'plan', array['create', 'configure', 'void']);
    perform app.grant_permissions(p_farm, r, 'work_order', array['create', 'configure', 'void']);
    perform app.grant_permissions(p_farm, r, 'problem_report', array['review']);
    perform app.grant_permissions(p_farm, r, 'issue_request', array['create', 'execute', 'approve']);
    perform app.grant_permissions(p_farm, r, 'task_type', array['create', 'configure', 'verify']);
    perform app.grant_permissions(p_farm, r, 'stock', array['execute', 'approve']);
  end loop;
  perform app.grant_permissions(p_farm, 'warehouse_user', 'stock', array['execute']);
  perform app.grant_permissions(p_farm, 'warehouse_user', 'issue_request', array['execute']);
  -- Operations coordinates: cross-department requests (draft tasks, work orders), triage routing, comments.
  -- No department-internal plan/verify/close by default (§3.6).
  perform app.grant_permissions(p_farm, 'operations_manager', 'task', array['create']);
  perform app.grant_permissions(p_farm, 'operations_manager', 'work_order', array['create']);
  perform app.grant_permissions(p_farm, 'operations_manager', 'problem_report', array['review']);
  -- Administration configures; it does not execute or verify operational work.
  perform app.grant_permissions(p_farm, 'system_admin', o, array['create', 'configure', 'verify', 'void'])
     from unnest(array['task_type', 'problem_category', 'escalation_rule', 'warehouse', 'item']) o;

  perform set_config('app.in_verify', 'on', true);
  insert into public.task_types (farm_id, code, name_ar, name_en, department_id, requires_verification, source_note)
  values
    (p_farm, 'general', 'مهمة عامة', 'General task', null, true, 'Generic type until activity types are configured (tier C, VR-C15)'),
    (p_farm, 'maintenance_repair', 'إصلاح عطل', 'Breakdown repair',
     (select id from public.departments where farm_id = p_farm and code = 'maintenance'), true,
     'Generic corrective-maintenance type (tier C, VR-C15)');

  insert into public.problem_categories (farm_id, code, name_ar, name_en, default_department_id, sort_order, source_note)
  select p_farm, c.code, c.ar, c.en, (select id from public.departments where farm_id = p_farm and code = c.dept), c.ord,
         'Default routing is a working assumption (tier C, VR-C16)'
    from (values
      ('equipment_breakdown', 'عطل معدة / آلية', 'Equipment breakdown', 'maintenance', 1),
      ('irrigation_water', 'ري / مياه', 'Irrigation / water', 'irrigation_fertilizer', 2),
      ('crop_pest_disease', 'آفة / مرض في المحصول', 'Crop pest / disease', 'plant_protection', 3),
      ('quality', 'جودة', 'Quality', 'qc', 4),
      ('material_shortage', 'نقص مواد', 'Material shortage', 'main_warehouse', 5),
      ('safety', 'سلامة', 'Safety', 'operations', 6),
      ('other', 'أخرى', 'Other', 'operations', 7)
    ) as c(code, ar, en, dept, ord);
  perform set_config('app.in_verify', 'off', true);

  insert into public.settings (farm_id, key, value, evidence_tier, note)
  values (p_farm, 'issue_request_requires_approval', 'false', 'C', 'Approval points/thresholds are unknown (E5); configurable');
end;
$$;

create or replace function app.seed_phase_structure(p_farm uuid) returns void
language plpgsql as $$ begin perform app.seed_phase2_structure(p_farm); end $$;

-- Farms that already exist (e.g. a seeded production farm) get the Phase 2 structure now.
select app.seed_phase2_structure(id) from public.farms;
