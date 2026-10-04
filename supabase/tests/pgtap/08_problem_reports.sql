-- Breakdown scenario (§8.1): problem reported in the field → triaged to Maintenance → work order + task
-- → assigned → completed → verified by a different user → closed, with a complete history.
begin;
select plan(19);

select tests.create_user('sup')   as sup \gset
select tests.create_user('mmgr')  as mmgr \gset
select tests.create_user('tech')  as tech \gset
select tests.create_user('ops')   as ops \gset
select tests.create_user('viewer') as viewer \gset
select tests.grant_role(:'sup', 'supervisor', 'agriculture');
select tests.grant_role(:'mmgr', 'maintenance_manager', 'maintenance');
select tests.grant_role(:'mmgr', 'department_manager', 'maintenance');
select tests.grant_role(:'tech', 'maintenance_technician', 'maintenance');
select tests.grant_role(:'ops', 'operations_manager');
select tests.grant_role(:'viewer', 'executive_viewer');
select tests.location('BLK-PR') as loc \gset
insert into public.assets (farm_id, code, name_ar, asset_class_id, location_id, owning_department_id)
values (tests.farm(), 'PMP-9', 'مضخة', tests.asset_class('pump'), :'loc', tests.dept('maintenance')) returning id as pump \gset

select tests.login(:'sup');
insert into public.problem_reports (farm_id, category_id, priority, description, asset_id, location_id)
values (tests.farm(), tests.category('equipment_breakdown'), 1, 'المضخة لا تعمل', :'pump', :'loc') returning id as pr \gset
select tests.logout();
select is((select owning_department_id from public.problem_reports where id = :'pr'), tests.dept('maintenance'),
  'breakdown routed to Maintenance by its category');
select is((select status from public.problem_reports where id = :'pr'), 'open', 'report starts open');

select tests.login(:'viewer');
select lives_ok(format($$ insert into public.problem_reports (farm_id, category_id, description) values (tests.farm(), %L, 'any user can report') $$,
  tests.category('other')), 'anyone on the farm can raise a problem');
select tests.logout();

select tests.login(:'sup');
select throws_ok(format($$ select public.transition_record('problem_reports', %L, 'acknowledged') $$, :'pr'), 'P0403', null,
  'the reporter cannot triage');
select tests.logout();

select tests.login(:'mmgr');
select is(public.transition_record('problem_reports', :'pr', 'acknowledged') ->> 'to_status', 'acknowledged', 'Maintenance acknowledges');
select throws_ok(format($$ select public.transition_record('problem_reports', %L, 'converted') $$, :'pr'), 'P0422', null,
  'cannot mark converted without a triage decision');
select throws_ok(format($$ select public.transition_record('problem_reports', %L, 'resolved') $$, :'pr'), 'P0422', null,
  'resolving without work needs a comment');
select public.triage_problem_report(:'pr', tests.dept('maintenance'), tests.task_type('maintenance_repair'),
  'إصلاح المضخة PMP-9', null, current_date, 'عطل في المحرك', true) as triage \gset
select tests.logout();

select is((select status from public.problem_reports where id = :'pr'), 'converted', 'report converted to work');
select is((select count(*)::int from public.work_orders where source_problem_report_id = :'pr'), 1, 'work order created from the report');
select is((select status from public.tasks where source_problem_report_id = :'pr'), 'planned', 'repair task planned in Maintenance');

select tests.login(:'mmgr');
select throws_ok(format($$ select public.triage_problem_report(%L, %L, %L, 'again') $$, :'pr', tests.dept('maintenance'), tests.task_type('maintenance_repair')),
  'P0422', null, 'a converted report cannot be triaged twice');
select (select id from public.tasks where source_problem_report_id = :'pr') as job \gset
select public.transition_record('tasks', :'job', 'assigned', jsonb_build_object('supervisor_id', :'tech'));
select tests.logout();

select tests.login(:'tech');
select public.transition_record('tasks', :'job', 'in_progress');
select public.transition_record('tasks', :'job', 'pending_verification', '{}', 'تم تبديل الحشوة');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'verified') $$, :'job'), 'P0403', null,
  'the technician cannot verify their own repair');
select tests.logout();

select tests.login(:'mmgr');
select public.transition_record('tasks', :'job', 'verified');
select is(public.transition_record('tasks', :'job', 'closed') ->> 'to_status', 'closed', 'repair verified by a different user and closed');
select tests.logout();
select is((select count(*)::int from public.record_transitions where entity_id = :'job'), 6,
  'full status history: planned, assigned, in progress, pending verification, verified, closed');
select ok((select count(*) from public.audit_events where entity_id = :'job') >= 6, 'audit trail present for every change');

-- Operations routes a report to the department that owns the fix; it does not triage on that department's behalf (audit C2).
select tests.login(:'sup');
insert into public.problem_reports (farm_id, category_id, description, location_id) values (tests.farm(), tests.category('other'), 'باب المستودع مكسور', :'loc') returning id as pr2 \gset
select tests.logout();
select tests.login(:'ops');
select throws_ok(format($$ select public.triage_problem_report(%L, %L, %L, 'x', null, current_date) $$, :'pr2', tests.dept('maintenance'), tests.task_type('maintenance_repair')),
  'P0403', null, 'Operations cannot turn a report into work for a department');
select lives_ok(format($$ select public.route_problem_report(%L, %L, 'عطل باب — اختصاص الصيانة') $$, :'pr2', tests.dept('maintenance')),
  'Operations routes the report to Maintenance with a reason');
select tests.logout();
select is((select owning_department_id from public.problem_reports where id = :'pr2'), tests.dept('maintenance'), 'report re-routed to Maintenance');

-- A report that names equipment inherits its location (so the repair can be planned and assigned).
select tests.login(:'sup');
insert into public.problem_reports (farm_id, category_id, description, asset_id) values (tests.farm(), tests.category('equipment_breakdown'), 'تسرب', :'pump') returning id as pr3 \gset
select tests.logout();
select is((select location_id from public.problem_reports where id = :'pr3'), :'loc'::uuid, 'report takes the equipment''s location');

select * from finish();
rollback;
