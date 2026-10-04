-- Unplanned field work: a supervisor creates a task, assigns it to themselves and records material that
-- was not planned — without gaining a planner's dispatch authority over anyone else's work.
begin;
select plan(11);

select tests.create_user('sup')  as sup \gset
select tests.create_user('sup2') as sup2 \gset
select tests.create_user('msup') as msup \gset
select tests.create_user('mgr')  as mgr \gset
select tests.create_user('admin') as admin \gset
select tests.grant_role(:'sup', 'supervisor', 'agriculture');
select tests.grant_role(:'sup2', 'supervisor', 'agriculture');
select tests.grant_role(:'msup', 'supervisor', 'maintenance');
select tests.grant_role(:'mgr', 'department_manager', 'agriculture');
select tests.grant_role(:'admin', 'system_admin');
select tests.location('BLK-Q') as loc \gset

select is((select version_no from public.workflow_versions where farm_id = tests.farm() and workflow_code = 'task' and is_active), 2,
  'task workflow v2 is the active version for new tasks');

select tests.login(:'sup');
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date, supervisor_id)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'إزالة أعشاب طارئة', current_date, :'sup') returning id as t \gset
select is(public.transition_record('tasks', :'t', 'assigned') ->> 'to_status', 'assigned', 'a supervisor self-assigns unplanned work');
select tests.logout();
select is((select assigned_by from public.tasks where id = :'t'), :'sup'::uuid, 'self-assignment recorded as the assigner');

select tests.login(:'sup');
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date, supervisor_id)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'مهمة لزميل', current_date, :'sup2') returning id as t2 \gset
select throws_ok(format($$ select public.transition_record('tasks', %L, 'assigned') $$, :'t2'), 'P0422', null,
  'a supervisor cannot assign work to someone else (no dispatch authority)');
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'بدون مشرف', current_date) returning id as t3 \gset
select throws_ok(format($$ select public.transition_record('tasks', %L, 'assigned', jsonb_build_object('supervisor_id', %L)) $$, :'t3', :'sup'),
  'P0422', null, 'self-assignment needs the supervisor set on the task itself, not smuggled in a payload');
select tests.logout();

select tests.login(:'mgr');
select is(public.transition_record('tasks', :'t2', 'assigned') ->> 'to_status', 'assigned', 'the planner''s dispatch rule still assigns to others');
select tests.logout();

select tests.login(:'admin');
select throws_ok(format($$ select public.transition_record('tasks', %L, 'assigned') $$, :'t3'), 'P0403', null,
  'administration has neither rule (no execution authority)');
select tests.logout();

-- Unplanned material recorded while working; locked afterwards.
insert into public.items (farm_id, code, name_ar, kind, base_unit_id) values (tests.farm(), 'MAT-Q', 'مادة', 'material', tests.unit('kg')) returning id as item \gset
select tests.login(:'sup');
select public.transition_record('tasks', :'t', 'in_progress');
select lives_ok(format($$ insert into public.material_consumptions (farm_id, task_id, item_id, unit_id, actual_qty) values (tests.farm(), %L, %L, %L, 3) $$,
  :'t', :'item', tests.unit('kg')), 'unplanned material recorded during work');
select throws_ok(format($$ insert into public.material_consumptions (farm_id, task_id, item_id, unit_id, planned_qty) values (tests.farm(), %L, %L, %L, 3) $$,
  :'t', :'item', tests.unit('kg')), 'P0422', null, 'planned quantities cannot be added once work has started');
select public.transition_record('tasks', :'t', 'pending_verification');
select throws_ok(format($$ insert into public.material_consumptions (farm_id, task_id, item_id, unit_id, actual_qty) values (tests.farm(), %L, %L, %L, 1) $$,
  :'t', :'item', tests.unit('kg')), 'P0422', null, 'no material can be added after completion');
select tests.logout();

select tests.login(:'msup');
select throws_ok(format($$ insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, supervisor_id) values (tests.farm(), %L, %L, %L, 'x', %L) $$,
  tests.task_type('general'), tests.dept('agriculture'), :'loc', :'msup'), '42501', null, 'self-service stays inside the supervisor''s own department');
select tests.logout();

select * from finish();
rollback;
