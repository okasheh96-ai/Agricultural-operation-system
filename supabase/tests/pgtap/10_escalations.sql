-- Escalation: ships unconfigured; a configured rule fires once per record (idempotent scheduler run).
begin;
select plan(6);

select is((select count(*)::int from public.escalation_rules where farm_id = tests.farm()), 0,
  'no escalation thresholds ship configured (never invented)');

select tests.create_user('ops') as ops \gset
select tests.create_user('sup') as sup \gset
select tests.grant_role(:'ops', 'operations_manager');
select tests.grant_role(:'sup', 'supervisor', 'agriculture');

-- Test-only fixture rules (§8.1: escalation tests use a fixture, production ships unconfigured).
insert into public.escalation_rules (farm_id, entity_type, condition, max_priority, after_minutes, notify_role_id)
values (tests.farm(), 'problem_reports', 'unacknowledged', 1, 30, tests.role('operations_manager')),
       (tests.farm(), 'tasks', 'overdue', 4, 60, tests.role('operations_manager'));

select tests.login(:'sup');
insert into public.problem_reports (farm_id, category_id, priority, description) values (tests.farm(), tests.category('safety'), 1, 'تسرب') returning id as p1 \gset
insert into public.problem_reports (farm_id, category_id, priority, description) values (tests.farm(), tests.category('safety'), 3, 'بسيط') returning id as p3 \gset
select tests.logout();
-- Age the reports by an hour (fixture only: bypass the stamp trigger).
set local session_replication_role = replica;
update public.problem_reports set created_at = now() - interval '1 hour' where id in (:'p1', :'p3');
set local session_replication_role = origin;

select tests.location('BLK-ESC') as loc \gset
select tests.create_user('mgr') as mgr \gset
select tests.grant_role(:'mgr', 'department_manager', 'agriculture');
select tests.login(:'mgr');
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'متأخرة', current_date - 2) returning id as t \gset
select public.transition_record('tasks', :'t', 'assigned', jsonb_build_object('supervisor_id', :'sup'));
select tests.logout();

select is(app.run_escalations(), 2, 'the P1 unacknowledged report and the overdue task escalate');
select is(tests.notifications(:'ops', 'escalation_unacknowledged'), 1, 'Operations Manager notified of the report');
select is(tests.notifications(:'ops', 'escalation_overdue'), 1, 'Operations Manager notified of the overdue task');
select is(app.run_escalations(), 0, 're-running the scheduler never duplicates escalations');
select ok(not exists (select 1 from public.escalations where entity_id = :'p3'), 'a P3 report is outside the P1 rule');

select * from finish();
rollback;
