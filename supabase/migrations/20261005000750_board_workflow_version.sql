-- The field app mirrors transition rules offline per workflow version (records finish on the version
-- they started under), so the board exposes each task's workflow version.
create or replace view public.task_board with (security_invoker = true) as
select t.id, t.farm_id, t.code, t.title, t.status, t.priority, t.version,
       t.department_id, d.code as department_code, d.name_ar as department_name_ar, d.name_en as department_name_en,
       t.task_type_id, tt.name_ar as task_type_name_ar, tt.name_en as task_type_name_en, tt.requires_verification,
       t.location_id, l.code as location_code, l.name_ar as location_name_ar, l.name_en as location_name_en,
       t.asset_id, a.code as asset_code,
       t.planned_date, t.window_start, t.window_end,
       t.supervisor_id, sp.full_name as supervisor_name, t.crew_id, c.code as crew_code, c.name_ar as crew_name_ar, c.name_en as crew_name_en,
       t.blocked_reason, t.blocked_note, t.blocked_problem_report_id, t.rejection_count,
       t.completed_by, t.actual_quantity, t.planned_quantity, t.quantity_unit_id,
       t.work_order_id, t.source_problem_report_id,
       (t.status in ('planned', 'assigned', 'in_progress', 'blocked')
        and t.planned_date is not null and app.task_due_at(t.planned_date, t.window_end) < now()) as is_overdue,
       t.updated_at,
       t.workflow_version_id, t.instructions, l.path as location_path
  from public.tasks t
  join public.departments d on d.id = t.department_id
  join public.task_types tt on tt.id = t.task_type_id
  left join public.locations l on l.id = t.location_id
  left join public.assets a on a.id = t.asset_id
  left join public.user_profiles sp on sp.id = t.supervisor_id
  left join public.crews c on c.id = t.crew_id
 where t.voided_at is null;

select app.apply_api_grants();
