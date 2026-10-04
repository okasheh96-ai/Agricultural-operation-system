-- Audit trail: every change recorded with the real actor; append-only; no deletes.
begin;
select plan(10);

select tests.create_user('admin') as admin \gset
select tests.grant_role(:'admin', 'system_admin');

select tests.login(:'admin');
insert into public.locations (farm_id, type, code, name_ar) values (tests.farm(), 'block', 'B-T1', 'قطعة اختبار') returning id as loc \gset
select tests.logout();

select is((select actor_user_id from public.audit_events where entity_id = :'loc' and action = 'insert'),
  :'admin'::uuid, 'insert is audited with the signed-in actor');

select tests.login(:'admin');
update public.locations set name_en = 'Test block', version = 1 where id = :'loc';
select tests.logout();

select is((select before ->> 'name_en' from public.audit_events where entity_id = :'loc' and action = 'update'), null,
  'update audit keeps the old value');
select is((select after ->> 'name_en' from public.audit_events where entity_id = :'loc' and action = 'update'), 'Test block',
  'update audit keeps the new value');
select is((select version from public.locations where id = :'loc'), 2, 'version increments on update');

select throws_ok($$ update public.audit_events set comment = 'x' $$, 'P0403', null,
  'audit rows cannot be updated, even by the owner');
select throws_ok($$ delete from public.audit_events $$, 'P0403', null,
  'audit rows cannot be deleted, even by the owner');
select throws_ok(format($$ delete from public.locations where id = %L $$, :'loc'), 'P0403', null,
  'operational/master records are never hard-deleted');

select tests.login(:'admin');
select throws_ok($$ insert into public.audit_events (actor_kind, action, entity_type, entity_id) values ('user','insert','x',gen_random_uuid()) $$,
  '42501', null, 'the API role cannot write audit rows directly');
select tests.logout();

set local role service_role;
select throws_ok($$ insert into public.locations (farm_id, type, code, name_ar) values (tests.farm(), 'block', 'B-SVC', 'x') $$,
  'P0403', null, 'elevated writes without a real acting user are refused');
select set_config('app.acting_user_id', :'admin', true);
select lives_ok($$ insert into public.locations (farm_id, type, code, name_ar) values (tests.farm(), 'block', 'B-SVC', 'x') $$,
  'elevated writes that pass the real acting user are accepted and attributed');
reset role;

select * from finish();
rollback;
