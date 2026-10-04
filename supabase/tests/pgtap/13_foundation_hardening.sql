-- Audit 2026-10-05: every probe that succeeded before must now be refused; legitimate paths keep working.
begin;
select plan(24);

select tests.create_user('mgr')   as mgr \gset
select tests.create_user('sup')   as sup \gset
select tests.create_user('sup2')  as sup2 \gset
select tests.create_user('cover') as cover \gset
select tests.create_user('ops')   as ops \gset
select tests.create_user('qa')    as qa \gset
select tests.create_user('admin') as admin \gset
select tests.create_user('mmgr')  as mmgr \gset
select tests.grant_role(:'mgr', 'department_manager', 'agriculture');
select tests.grant_role(:'sup', 'supervisor', 'agriculture');
select tests.grant_role(:'sup2', 'supervisor', 'agriculture');
select tests.grant_role(:'cover', 'supervisor', 'agriculture');
select tests.grant_role(:'ops', 'operations_manager');
select tests.grant_role(:'qa', 'qa_user', 'qa');
select tests.grant_role(:'admin', 'system_admin');
select tests.grant_role(:'mmgr', 'department_manager', 'maintenance');
select tests.location('BLK-H') as loc \gset
insert into public.workers (farm_id, code, full_name) values (tests.farm(), 'W-H1', 'عامل') returning id as w \gset
select app.create_farm_structure('F2', 'مزرعة ٢', 'Farm 2', false, 'test tenant') as f2 \gset
insert into public.locations (farm_id, type, code, name_ar) values (:'f2', 'block', 'F2-B1', 'x') returning id as loc2 \gset
insert into public.workers (farm_id, code, full_name) values (:'f2', 'F2-W1', 'x') returning id as w2 \gset

-- ── C1: columns written by workflow steps ─────────────────────────────────────────────
select tests.login(:'mgr');
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'c1', current_date) returning id as t \gset
select throws_ok(format($$ insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, completed_by) values (tests.farm(), %L, %L, %L, 'x', %L) $$,
  tests.task_type('general'), tests.dept('agriculture'), :'loc', :'sup'), 'P0403', null, 'C1: a task cannot be created with a step actor filled in');
select public.transition_record('tasks', :'t', 'assigned', jsonb_build_object('supervisor_id', :'mgr'));
select public.transition_record('tasks', :'t', 'in_progress');
select public.transition_record('tasks', :'t', 'pending_verification', '{}', 'done');
select throws_ok(format($$ update public.tasks set completed_by = %L, version = version where id = %L $$, :'sup', :'t'), 'P0403', null,
  'C1: who completed a task cannot be rewritten');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'verified') $$, :'t'), 'P0423', null,
  'C1: so the executor still cannot verify their own work');
select throws_ok(format($$ update public.tasks set rejection_count = 5, version = version where id = %L $$, :'t'), 'P0403', null,
  'C1: step counters cannot be reset');
select throws_ok(format($$ update public.tasks set supervisor_id = %L, version = version where id = %L $$, :'sup', :'t'), 'P0403', null,
  'C1: reassignment is not a silent edit');
select lives_ok(format($$ update public.tasks set title = 'عنوان مصحح', version = version where id = %L $$, :'t'),
  'C1: ordinary planning fields remain editable');
-- a task executed by sup and verified by mgr: its quantity cannot change afterwards
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'c1b', current_date) returning id as t2 \gset
select public.transition_record('tasks', :'t2', 'assigned', jsonb_build_object('supervisor_id', :'sup'));
select tests.logout();
select tests.login(:'sup');
select public.transition_record('tasks', :'t2', 'in_progress');
select public.transition_record('tasks', :'t2', 'pending_verification', jsonb_build_object('actual_quantity', 2, 'quantity_unit_id', tests.unit('dunum')));
select tests.logout();
select tests.login(:'mgr');
select public.transition_record('tasks', :'t2', 'verified');
select throws_ok(format($$ update public.tasks set actual_quantity = 999, version = version where id = %L $$, :'t2'), 'P0403', null,
  'C1: a verified quantity cannot be changed (only by reopening, which forces re-verification)');

-- ── Reassignment as a recorded step ───────────────────────────────────────────────────
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'b3', current_date) returning id as t3 \gset
select public.transition_record('tasks', :'t3', 'assigned', jsonb_build_object('supervisor_id', :'sup2'));
select throws_ok(format($$ select public.reassign_task(%L, %L, null, ' ') $$, :'t3', :'sup'), 'P0422', null, 'reassignment needs a reason');
select lives_ok(format($$ select public.reassign_task(%L, %L, null, 'المشرف غائب') $$, :'t3', :'sup'), 'planner reassigns with a reason');
select tests.logout();
select is((select (payload ->> 'reassigned')::boolean from public.record_transitions where entity_id = :'t3' and from_status = to_status), true,
  'reassignment appears in the status history');
select tests.login(:'sup2');
select throws_ok(format($$ select public.reassign_task(%L, %L, null, 'x') $$, :'t3', :'sup2'), 'P0403', null, 'a supervisor cannot reassign work');
select tests.logout();

-- ── B3: assignee authority and execution scope ────────────────────────────────────────
select tests.login(:'mgr');
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'b3b', current_date) returning id as t4 \gset
select throws_ok(format($$ select public.transition_record('tasks', %L, 'assigned', jsonb_build_object('supervisor_id', %L)) $$, :'t4', :'qa'),
  'P0422', null, 'B3: work cannot be assigned to someone without execution authority in that department');
select tests.logout();
select tests.login(:'sup2');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'in_progress') $$, :'t3'), 'P0403', null,
  'B3: another supervisor cannot start a task assigned to someone else');
select throws_ok(format($$ insert into public.labour_entries (farm_id, task_id, worker_id, hours) values (tests.farm(), %L, %L, 1) $$, :'t3', :'w'),
  'P0403', null, 'B3: ...nor record work on it');
select tests.logout();
select tests.login(:'mgr');
select lives_ok(format($$ insert into public.labour_entries (farm_id, task_id, worker_id, hours) values (tests.farm(), %L, %L, 1) $$, :'t3', :'w'),
  'B3: a planner of the department may record on it');
select tests.logout();
select tests.login(:'sup');
insert into public.delegations (farm_id, from_user_id, to_user_id, valid_from, valid_to, reason)
values (tests.farm(), :'sup', :'cover', now() - interval '1 hour', now() + interval '1 day', 'إجازة');
select tests.logout();
select tests.login(:'cover');
select lives_ok(format($$ select public.transition_record('tasks', %L, 'in_progress') $$, :'t3'), 'B3: the assignee''s delegate may act');
select tests.logout();

-- ── C2: QA independence; Operations routes, departments review ────────────────────────
select tests.login(:'sup');
insert into public.problem_reports (farm_id, category_id, description, owning_department_id) values (tests.farm(), tests.category('quality'), 'qa item', tests.dept('qa')) returning id as prq \gset
insert into public.problem_reports (farm_id, category_id, description) values (tests.farm(), tests.category('equipment_breakdown'), 'pump') returning id as prm \gset
select tests.logout();
select tests.login(:'ops');
select is(app.has_permission(tests.farm(), 'problem_report', 'dispatch', tests.dept('qa')), false, 'C2: farm-wide grants do not reach the independent QA department');
select throws_ok(format($$ select public.transition_record('problem_reports', %L, 'rejected', '{}', 'x') $$, :'prq'), 'P0403', null,
  'C2: Operations cannot close a QA-owned report');
select throws_ok(format($$ select public.transition_record('problem_reports', %L, 'resolved', '{}', 'x') $$, :'prm'), 'P0403', null,
  'C2: Operations cannot resolve a department''s report on its behalf');
select lives_ok(format($$ select public.route_problem_report(%L, %L, 'يحتاج قسم الري') $$, :'prm', tests.dept('irrigation_fertilizer')),
  'C2: Operations routes a report to another department with a reason');
select throws_ok(format($$ insert into public.tasks (farm_id, task_type_id, department_id, title) values (tests.farm(), %L, %L, 'x') $$,
  tests.task_type('general'), tests.dept('qa')), '42501', null, 'C2: Operations cannot create work inside QA');
select tests.logout();
select tests.login(:'admin');
select is(app.has_permission(tests.farm(), 'location', 'configure', tests.dept('qa')), true, 'C2: System Administrator still configures QA master data (flagged role)');
select tests.logout();

-- ── B4: references stay inside the farm ──────────────────────────────────────────────
select tests.login(:'mgr');
select throws_ok(format($$ insert into public.tasks (farm_id, task_type_id, department_id, location_id, title) values (tests.farm(), %L, %L, %L, 'x') $$,
  tests.task_type('general'), tests.dept('agriculture'), :'loc2'), 'P0422', null, 'B4: a task cannot point at another farm''s location');
select throws_ok(format($$ insert into public.labour_entries (farm_id, task_id, worker_id, hours) values (tests.farm(), %L, %L, 1) $$, :'t3', :'w2'),
  'P0422', null, 'B4: labour cannot be recorded for another farm''s worker');
select tests.logout();

select * from finish();
rollback;
