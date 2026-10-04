-- RLS: role × department × location × object × action, delegations, time-bounded roles, privacy.
begin;
select plan(16);

select tests.create_user('admin')     as admin \gset
select tests.create_user('maint_mgr') as maint \gset
select tests.create_user('irr_mgr')   as irr \gset
select tests.create_user('ops')       as ops \gset
select tests.create_user('exec')      as exec \gset
select tests.create_user('outsider')  as outsider \gset
select tests.create_user('expired')   as expired \gset
select tests.create_user('cover')     as cover \gset

select tests.grant_role(:'admin', 'system_admin');
select tests.grant_role(:'maint', 'department_manager', 'maintenance');
select tests.grant_role(:'irr',   'department_manager', 'irrigation_fertilizer');
select tests.grant_role(:'ops',   'operations_manager');
select tests.grant_role(:'exec',  'executive_viewer');
select tests.grant_role(:'expired', 'department_manager', 'maintenance', null, now() - interval '30 days', now() - interval '1 day');
select tests.grant_role(:'cover', 'supervisor', 'agriculture');

-- Visibility
select tests.login(:'outsider');
select is((select count(*)::int from public.departments), 0, 'a user with no role sees no farm data');
select tests.logout();
select tests.login(:'exec');
select is((select count(*)::int from public.departments), 14, 'a farm member sees the departments');
select throws_ok($$ insert into public.locations (farm_id, type, code, name_ar) values (tests.farm(), 'block', 'X1', 'x') $$,
  '42501', null, 'executive viewer is read-only');
select tests.logout();

-- Department scope
select tests.login(:'maint');
select lives_ok(format($$ insert into public.assets (farm_id, code, name_ar, asset_class_id, owning_department_id)
  values (tests.farm(), 'GEN-T1', 'مولد اختبار', %L, %L) $$, tests.asset_class('generator'), tests.dept('maintenance')),
  'department manager creates an asset owned by their department');
select throws_ok(format($$ insert into public.assets (farm_id, code, name_ar, asset_class_id, owning_department_id)
  values (tests.farm(), 'PMP-T1', 'مضخة', %L, %L) $$, tests.asset_class('pump'), tests.dept('irrigation_fertilizer')),
  '42501', null, 'department manager cannot create assets for another department');
select throws_ok(format($$ insert into public.assets (farm_id, code, name_ar, asset_class_id)
  values (tests.farm(), 'PMP-T2', 'مضخة', %L) $$, tests.asset_class('pump')),
  '42501', null, 'a department-scoped role does not cover records without a department');
select tests.logout();

select tests.login(:'irr');
update public.assets set name_en = 'hijack', version = 1 where code = 'GEN-T1';
select tests.logout();
select is((select name_en from public.assets where code = 'GEN-T1'), null,
  'another department''s manager cannot edit the asset (row invisible to UPDATE)');

-- Operations coordinates; it does not own department master data
select tests.login(:'ops');
select throws_ok(format($$ insert into public.assets (farm_id, code, name_ar, asset_class_id, owning_department_id)
  values (tests.farm(), 'GEN-T2', 'مولد', %L, %L) $$, tests.asset_class('generator'), tests.dept('maintenance')),
  '42501', null, 'Operations Manager has no department-internal create authority by default');
select tests.logout();

-- Time-bounded roles
select tests.login(:'expired');
select is((select count(*)::int from public.departments), 0, 'an expired role grants nothing');
select tests.logout();
select throws_ok(format($$ select tests.grant_role(%L, 'department_manager', 'maintenance') $$, :'maint'),
  '23P01', null, 'overlapping periods of the same role assignment are rejected');

-- Delegation: cover gets maint's scope for a period
select tests.login(:'maint');
select lives_ok(format($$ insert into public.delegations (farm_id, from_user_id, to_user_id, valid_from, valid_to, reason)
  values (tests.farm(), %L, %L, now() - interval '1 hour', now() + interval '7 days', 'annual leave') $$, :'maint', :'cover'),
  'a manager can delegate their own scope');
select throws_ok(format($$ insert into public.delegations (farm_id, from_user_id, to_user_id, valid_from, valid_to, reason)
  values (tests.farm(), %L, %L, now(), now() + interval '1 day', 'x') $$, :'irr', :'cover'),
  '42501', null, 'nobody can delegate someone else''s scope without delegation authority');
select tests.logout();
select tests.login(:'cover');
select lives_ok(format($$ insert into public.assets (farm_id, code, name_ar, asset_class_id, owning_department_id)
  values (tests.farm(), 'GEN-T3', 'مولد ٣', %L, %L) $$, tests.asset_class('generator'), tests.dept('maintenance')),
  'the delegate acts within the delegator''s department scope');
select throws_ok(format($$ insert into public.assets (farm_id, code, name_ar, asset_class_id, owning_department_id)
  values (tests.farm(), 'PMP-T4', 'مضخة ٤', %L, %L) $$, tests.asset_class('pump'), tests.dept('irrigation_fertilizer')),
  '42501', null, 'the delegate gains nothing outside that scope');
select tests.logout();

-- Privacy: worker ID numbers
select tests.login(:'maint');
insert into public.workers (farm_id, code, full_name, home_department_id) values (tests.farm(), 'WK-T1', 'عامل اختبار', tests.dept('maintenance')) returning id as wk \gset
insert into public.worker_private (farm_id, worker_id, id_number) values (tests.farm(), :'wk', '9990001111');
select is((select id_number from public.worker_private where worker_id = :'wk'), '9990001111',
  'the worker''s department manager can read the ID number');
select tests.logout();
select tests.login(:'exec');
select is((select count(*)::int from public.worker_private), 0, 'other members cannot see worker ID numbers');
select tests.logout();

select * from finish();
rollback;
