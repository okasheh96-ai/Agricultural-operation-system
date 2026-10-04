-- transition_record(): allowed and forbidden transitions, permission, required fields, history,
-- idempotency, optimistic concurrency, offline conflicts, clock skew, versioning, segregation of duties.
begin;
select plan(22);

select tests.create_user('admin') as admin \gset
select tests.create_user('maint') as maint \gset
select tests.create_user('exec')  as exec \gset
select tests.create_user('cover') as cover \gset
select tests.grant_role(:'admin', 'system_admin');
select tests.grant_role(:'maint', 'maintenance_manager', 'maintenance');
select tests.grant_role(:'exec',  'executive_viewer');
select tests.grant_role(:'cover', 'supervisor', 'agriculture');

select tests.login(:'maint');
insert into public.assets (farm_id, code, name_ar, asset_class_id, owning_department_id)
values (tests.farm(), 'GEN-01T', 'مولد', tests.asset_class('generator'), tests.dept('maintenance')) returning id as a \gset
select is((select status from public.assets where id = :'a'), 'not_yet_verified', 'new assets start Not Yet Verified, never Active');

select throws_ok(format($$ update public.assets set status = 'active', version = 1 where id = %L $$, :'a'),
  'P0403', null, 'clients cannot write status directly');
select throws_ok(format($$ insert into public.assets (farm_id, code, name_ar, asset_class_id, owning_department_id, status)
  values (tests.farm(), 'GEN-02T', 'x', %L, %L, 'active') $$, tests.asset_class('generator'), tests.dept('maintenance')),
  'P0403', null, 'clients cannot create records in a non-initial status');

select throws_ok(format($$ select public.transition_record('assets', %L, 'active') $$, :'a'),
  'P0422', 'A comment is required for this change', 'required reason is enforced');
select throws_ok(format($$ select public.transition_record('assets', %L, 'retired', '{}', 'why') $$, :'a'),
  'P0422', null, 'a transition not in the workflow is forbidden');

select is(public.transition_record('assets', :'a', 'active', '{}', 'Confirmed running on site', 1) ->> 'to_status', 'active',
  'allowed transition succeeds');
select tests.logout();

select is((select status from public.assets where id = :'a'), 'active', 'status written');
select is((select count(*)::int from public.record_transitions where entity_id = :'a'), 1, 'history row written');
select is((select comment from public.audit_events where entity_id = :'a' and action = 'transition'),
  'Confirmed running on site', 'audit row carries the reason');

select tests.login(:'exec');
select throws_ok(format($$ select public.transition_record('assets', %L, 'inactive', '{}', 'x') $$, :'a'),
  'P0403', null, 'a role without the action cannot transition');
select tests.logout();

select tests.login(:'maint');
select throws_ok(format($$ select public.transition_record('assets', %L, 'inactive', '{}', 'x', 1) $$, :'a'),
  'P0409', null, 'stale version is rejected (optimistic concurrency)');

-- Idempotency: same key twice → one effect
select public.transition_record('assets', :'a', 'under_maintenance', '{}', 'Pump seal', null,
  '11111111-1111-1111-1111-111111111111', now(), 'dev-1') ->> 'to_status' as first \gset
select is((public.transition_record('assets', :'a', 'under_maintenance', '{}', 'Pump seal', null,
  '11111111-1111-1111-1111-111111111111', now(), 'dev-1') ->> 'replayed')::boolean, true, 'replayed key returns the stored result');
select tests.logout();
select is((select count(*)::int from public.record_transitions where idempotency_key = '11111111-1111-1111-1111-111111111111'), 1,
  'a replayed mutation applies once');

-- Offline replay that the server rejects → conflict queue, not lost
select tests.login(:'maint');
select is(public.sync_transition('assets', :'a', 'under_maintenance', '22222222-2222-2222-2222-222222222222', now()) ->> 'outcome',
  'conflict', 'rejected offline change is reported as a conflict');
select tests.logout();
select is((select reason_code from public.sync_conflicts where idempotency_key = '22222222-2222-2222-2222-222222222222'), 'P0422',
  'conflict stored with a readable reason');

-- Clock skew flagged
select tests.login(:'maint');
select is((public.sync_transition('assets', :'a', 'active', '33333333-3333-3333-3333-333333333333', now() - interval '2 hours',
  '{}', 'Repaired') ->> 'clock_skew_flag')::boolean, true, 'large device/server clock difference is flagged');
select tests.logout();

-- Workflow versioning + segregation of duties: v2 adds "creator may not activate"
insert into public.workflow_versions (farm_id, workflow_code, version_no, note) values (tests.farm(), 'asset_status', 2, 'test SoD') returning id as v2 \gset
insert into public.workflow_statuses (farm_id, workflow_version_id, code, name_ar, is_initial)
select farm_id, :'v2', code, name_ar, is_initial from public.workflow_statuses
 where workflow_version_id = (select id from public.workflow_versions where farm_id = tests.farm() and workflow_code = 'asset_status' and version_no = 1);
insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action, required_fields, must_differ_from)
values (tests.farm(), :'v2', 'not_yet_verified', 'active', 'configure', array['comment'], array['created_by']);
update public.workflow_versions set is_active = false, version = version where farm_id = tests.farm() and workflow_code = 'asset_status' and version_no = 1;
update public.workflow_versions set is_active = true, published_at = now(), version = version where id = :'v2';

select throws_ok(format($$ insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action)
  values (tests.farm(), %L, 'active', 'inactive', 'configure') $$, :'v2'), 'P0422', null, 'published workflow versions are frozen');

select tests.login(:'maint');
insert into public.assets (farm_id, code, name_ar, asset_class_id, owning_department_id)
values (tests.farm(), 'GEN-03T', 'مولد ٣', tests.asset_class('generator'), tests.dept('maintenance')) returning id as b \gset
select is((select workflow_version_id from public.assets where id = :'b'), :'v2'::uuid, 'new records start on the active version');
select is(public.transition_record('assets', :'a', 'inactive', '{}', 'Seasonal stop') ->> 'to_status', 'inactive',
  'in-flight records finish on their original version');
select throws_ok(format($$ select public.transition_record('assets', %L, 'active', '{}', 'self-approve') $$, :'b'),
  'P0423', null, 'segregation of duties: the creator cannot perform this step');
-- maint delegates to cover; cover still may not act on maint's own record
insert into public.delegations (farm_id, from_user_id, to_user_id, valid_from, valid_to, reason)
values (tests.farm(), :'maint', :'cover', now() - interval '1 hour', now() + interval '1 day', 'leave');
select tests.logout();

select tests.login(:'cover');
select throws_ok(format($$ select public.transition_record('assets', %L, 'active', '{}', 'via delegation') $$, :'b'),
  'P0423', null, 'a delegation cannot be used on the delegator''s own record');
select tests.logout();

select tests.login(:'admin');
select is(public.transition_record('assets', :'b', 'active', '{}', 'Verified by second person') ->> 'to_status', 'active',
  'a different authorised person can perform the step');
select tests.logout();

select * from finish();
rollback;
