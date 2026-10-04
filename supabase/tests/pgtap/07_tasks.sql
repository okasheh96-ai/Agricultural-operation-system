-- Task workflow end to end: create → assign → execute (labour, machine, block/unblock) → complete →
-- reject → verify (segregation of duties) → close; entry locking; reassignment; overdue on the board.
begin;
select plan(34);

select tests.create_user('mgr')      as mgr \gset
select tests.create_user('sup')      as sup \gset
select tests.create_user('ops')      as ops \gset
select tests.create_user('msup')     as msup \gset
select tests.create_user('viewer')   as viewer \gset
select tests.grant_role(:'mgr', 'department_manager', 'agriculture');
select tests.grant_role(:'sup', 'supervisor', 'agriculture');
select tests.grant_role(:'ops', 'operations_manager');
select tests.grant_role(:'msup', 'supervisor', 'maintenance');
select tests.grant_role(:'viewer', 'executive_viewer');

select tests.location('BLK-1') as loc \gset
insert into public.workers (farm_id, code, full_name, home_department_id) values (tests.farm(), 'W-1', 'عامل', tests.dept('agriculture')) returning id as w1 \gset
insert into public.workers (farm_id, code, full_name, home_department_id) values (tests.farm(), 'W-M', 'عامل صيانة', tests.dept('maintenance')) returning id as wm \gset
insert into public.assets (farm_id, code, name_ar, asset_class_id) values (tests.farm(), 'TR-1', 'جرار', tests.asset_class('machine')) returning id as tractor \gset

-- Create
select tests.login(:'mgr');
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'تعشيب القطعة ١', current_date) returning id as t \gset
select is((select status from public.tasks where id = :'t'), 'draft', 'new task starts as draft');
select tests.logout();

select tests.login(:'ops');
select lives_ok(format($$ insert into public.tasks (farm_id, task_type_id, department_id, title) values (tests.farm(), %L, %L, 'طلب من العمليات') $$,
  tests.task_type('general'), tests.dept('agriculture')), 'Operations can raise a cross-department request (draft task)');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'planned') $$, :'t'), 'P0403', null,
  'Operations cannot plan inside a department');
select tests.logout();

select tests.login(:'msup');
select throws_ok(format($$ insert into public.tasks (farm_id, task_type_id, department_id, title) values (tests.farm(), %L, %L, 'x') $$,
  tests.task_type('general'), tests.dept('agriculture')), '42501', null, 'a supervisor cannot create work in another department');
select tests.logout();

-- Assign (6 AM dispatch)
select tests.login(:'mgr');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'assigned') $$, :'t'), 'P0422', null,
  'assigning requires a supervisor');
select is(public.transition_record('tasks', :'t', 'assigned', jsonb_build_object('supervisor_id', :'sup')) ->> 'to_status', 'assigned',
  'planner dispatches straight from draft with a supervisor');
select tests.logout();
select is((select supervisor_id from public.tasks where id = :'t'), :'sup'::uuid, 'supervisor written from the transition payload');
select is((select assigned_by from public.tasks where id = :'t'), :'mgr'::uuid, 'dispatcher recorded');
select is(tests.notifications(:'sup', 'task_assigned'), 1, 'supervisor notified of the assignment');

-- Execute
select tests.login(:'sup');
select lives_ok(format($$ insert into public.labour_entries (farm_id, task_id, worker_id, hours) values (tests.farm(), %L, %L, 2.5) $$, :'t', :'w1'),
  'supervisor records labour once the task is assigned');
select lives_ok(format($$ insert into public.labour_entries (farm_id, task_id, worker_id, hours) values (tests.farm(), %L, %L, 1) $$, :'t', :'wm'),
  'workers from another department can be recorded on this task (cross-department crew)');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'blocked') $$, :'t'), 'P0422', null, 'blocking needs a reason');
select is(public.transition_record('tasks', :'t', 'blocked', '{"blocked_reason":"equipment","blocked_note":"الجرار معطل"}') ->> 'to_status',
  'blocked', 'task blocked with a reason before it could start (machine unavailable)');
select tests.logout();
select is((select blocked_reason from public.tasks where id = :'t'), 'equipment', 'block reason stored on the task');
select ok((select status = 'blocked' from public.task_board where id = :'t'), 'blocked task visible on the board');

select tests.login(:'sup');
select is(public.transition_record('tasks', :'t', 'in_progress') ->> 'to_status', 'in_progress', 'work resumes');
select tests.logout();
select is((select blocked_reason from public.tasks where id = :'t'), null, 'resuming clears the block details');

select tests.login(:'viewer');
select throws_ok(format($$ insert into public.labour_entries (farm_id, task_id, worker_id, hours) values (tests.farm(), %L, %L, 1) $$, :'t', :'w1'),
  'P0403', null, 'a viewer cannot record work');
select tests.logout();

select tests.login(:'sup');
insert into public.machine_entries (farm_id, task_id, asset_id, hours) values (tests.farm(), :'t', :'tractor', 1.5);
select throws_ok(format($$ select public.transition_record('tasks', %L, 'completed') $$, :'t'), 'P0422', null,
  'a type that requires verification cannot skip it');
select is(public.transition_record('tasks', :'t', 'pending_verification', jsonb_build_object('actual_quantity', 1.5, 'quantity_unit_id', tests.unit('dunum')), 'تم') ->> 'to_status',
  'pending_verification', 'supervisor completes the task');
select throws_ok(format($$ insert into public.labour_entries (farm_id, task_id, worker_id, hours) values (tests.farm(), %L, %L, 1) $$, :'t', :'w1'),
  'P0422', null, 'execution records are locked after completion');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'verified') $$, :'t'), 'P0403', null,
  'a supervisor has no verification authority');
select tests.logout();

-- Reject, then verify by a different person
select tests.login(:'mgr');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'in_progress') $$, :'t'), 'P0422', null, 'rejection needs a reason');
select is(public.transition_record('tasks', :'t', 'in_progress', '{}', 'المساحة غير مكتملة') ->> 'to_status', 'in_progress', 'verifier rejects');
select tests.logout();
select is((select rejection_count from public.tasks where id = :'t'), 1, 'rejection counted');
select is(tests.notifications(:'sup', 'task_rejected'), 1, 'executor notified of the rejection');

select tests.login(:'sup');
select public.transition_record('tasks', :'t', 'pending_verification', jsonb_build_object('actual_quantity', 2, 'quantity_unit_id', tests.unit('dunum')));
select tests.logout();
select tests.login(:'mgr');
select is(public.transition_record('tasks', :'t', 'verified') ->> 'to_status', 'verified', 'a different authorised person verifies');
select is(public.transition_record('tasks', :'t', 'closed') ->> 'to_status', 'closed', 'department closes the verified task');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'in_progress', '{}', 'x') $$, :'t'), 'P0422', null,
  'closed tasks cannot be reopened');

-- Segregation of duties on the manager's own execution, and the per-type logged exception
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'مهمة ينفذها المدير', current_date) returning id as t2 \gset
select public.transition_record('tasks', :'t2', 'assigned', jsonb_build_object('supervisor_id', :'mgr'));
select public.transition_record('tasks', :'t2', 'in_progress');
select public.transition_record('tasks', :'t2', 'pending_verification');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'verified') $$, :'t2'), 'P0423', null,
  'the executor cannot verify their own work');
select tests.logout();
update public.task_types set allow_self_verification = true, version = version where id = tests.task_type('general');
select tests.login(:'mgr');
select is((public.transition_record('tasks', :'t2', 'verified') ->> 'sod_exception')::boolean, true,
  'self-verification allowed only when the task type permits it, and flagged');
select tests.logout();
select ok((select sod_exception from public.record_transitions where entity_id = :'t2' and to_status = 'verified'),
  'the exception is recorded in the history');

-- Overdue on the board, reassignment
select tests.login(:'mgr');
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'مهمة الأمس', current_date - 1) returning id as t3 \gset
select public.transition_record('tasks', :'t3', 'assigned', jsonb_build_object('supervisor_id', :'sup'));
select ok((select is_overdue from public.task_board where id = :'t3'), 'yesterday''s unfinished task shows as overdue');
update public.tasks set supervisor_id = :'mgr', version = 2 where id = :'t3';
select tests.logout();
select is((select supervisor_id from public.tasks where id = :'t3'), :'mgr'::uuid, 'planner reassigns an absent supervisor''s task (audited update)');

select * from finish();
rollback;
