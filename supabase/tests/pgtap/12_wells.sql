-- Wells (Irrigation & Water): status changes need authority and a reason, are kept as history, and a well can
-- be verified only after its real identity is entered.
begin;
select plan(9);

select tests.create_user('wmgr') as wmgr \gset
select tests.create_user('irr')  as irr \gset
select tests.create_user('sup')  as sup \gset
select tests.grant_role(:'wmgr', 'department_manager', 'wells');
select tests.grant_role(:'irr', 'irrigation_user', 'irrigation_fertilizer');
select tests.grant_role(:'sup', 'supervisor', 'agriculture');
select (select id from public.water_sources where farm_id = tests.farm() and code = 'W-03') as w \gset

select tests.login(:'sup');
select is((select count(*)::int from public.water_sources where kind = 'well'), 14, 'every farm member sees the 14 wells');
select throws_ok(format($$ select public.transition_record('water_sources', %L, 'active', '{}', 'x') $$, :'w'), 'P0403', null,
  'a supervisor cannot change a well''s status');
select tests.logout();

select tests.login(:'irr');
select throws_ok(format($$ select public.transition_record('water_sources', %L, 'active', '{}', 'x') $$, :'w'), 'P0403', null,
  'irrigation users have no well-status authority until it is confirmed (E1)');
select tests.logout();

select tests.login(:'wmgr');
select throws_ok(format($$ select public.transition_record('water_sources', %L, 'active') $$, :'w'), 'P0422', null, 'a status change needs a reason');
select is(public.transition_record('water_sources', :'w', 'under_maintenance', '{}', 'المضخة معطلة — تمت المعاينة') ->> 'to_status',
  'under_maintenance', 'the Wells department records the real status with a reason');
select throws_ok(format($$ select public.set_verification_status('water_sources', %L, 'verified', 'site visit', (select version from public.water_sources where id = %L)) $$, :'w', :'w'),
  '23514', null, 'an unnamed well with a temporary code cannot be verified');
update public.water_sources set code = 'BEER-NORTH-3', name_ar = 'البئر الشمالي ٣', is_temporary_code = false, version = version where id = :'w';
select is(public.set_verification_status('water_sources', :'w', 'verified', 'Confirmed with the wells foreman on site',
  (select version from public.water_sources where id = :'w')) ->> 'verification_status', 'verified', 'verified once its real identity is entered');
select tests.logout();

select is((select count(*)::int from public.record_transitions where entity_id = :'w'), 1, 'status history kept');
select is((select count(*)::int from public.water_sources where farm_id = tests.farm() and status = 'active'), 0, 'still no well is Active by assumption');

select * from finish();
rollback;
