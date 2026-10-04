-- Verification status, voiding, location tree, Arabic search, area reconciliation (D1), wells, crews.
begin;
select plan(24);

select tests.create_user('admin') as admin \gset
select tests.create_user('agri')  as agri \gset
select tests.create_user('exec')  as exec \gset
select tests.grant_role(:'admin', 'system_admin');
select tests.grant_role(:'exec',  'executive_viewer');

select tests.login(:'admin');
-- Verification
select throws_ok($$ insert into public.species (farm_id, code, name_ar, verification_status) values (tests.farm(), 'SP1', 'طماطم', 'verified') $$,
  'P0403', null, 'master data cannot be created already verified');
insert into public.species (farm_id, code, name_ar) values (tests.farm(), 'SP1', 'طماطم') returning id as sp \gset
select is((select verification_status::text from public.species where id = :'sp'), 'not_yet_verified', 'master data defaults to Not Yet Verified');
select ok(exists (select 1 from public.verification_queue where id = :'sp'), 'unverified records appear in the Verification Queue');
select throws_ok(format($$ update public.species set verification_status = 'verified', version = 1 where id = %L $$, :'sp'),
  'P0403', null, 'verification cannot be set by a plain update');
select throws_ok(format($$ select public.set_verification_status('species', %L, 'verified', '', 1) $$, :'sp'),
  'P0422', null, 'verifying requires a source note');
select is(public.set_verification_status('species', :'sp', 'verified', 'Confirmed by agronomist on site', 1) ->> 'verification_status',
  'verified', 'authorised user verifies with evidence');
select is((select verified_by from public.species where id = :'sp'), :'admin'::uuid, 'verifier recorded');
select ok(not exists (select 1 from public.verification_queue where id = :'sp'), 'verified records leave the queue');
select tests.logout();

select tests.login(:'exec');
select throws_ok(format($$ select public.set_verification_status('species', %L, 'conflicting', 'x', 2) $$, :'sp'),
  'P0403', null, 'a viewer cannot change verification status');
select tests.logout();

-- Voiding
select tests.login(:'admin');
select throws_ok(format($$ select public.void_record('species', %L, ' ', 2) $$, :'sp'), 'P0422', null, 'void needs a reason');
select is((public.void_record('species', :'sp', 'Duplicate of another entry', 2) ->> 'voided')::boolean, true, 'record voided with reason');
select throws_ok(format($$ update public.species set name_en = 'x', version = 3 where id = %L $$, :'sp'),
  'P0422', null, 'voided records cannot be edited');
select is((select count(*)::int from public.species where id = :'sp'), 1, 'voided record is kept, not deleted');

-- Location tree
insert into public.locations (farm_id, type, code, name_ar, area_value, area_unit_id)
values (tests.farm(), 'farm', 'L-FARM', 'المزرعة', 3628, tests.unit('dunum')) returning id as root \gset
insert into public.locations (farm_id, parent_id, type, code, name_ar, area_value, area_unit_id)
values (tests.farm(), :'root', 'production_system', 'L-ORCH', 'البساتين', 1918, tests.unit('dunum')) returning id as orch \gset
insert into public.locations (farm_id, parent_id, type, code, name_ar, area_value, area_unit_id)
values (tests.farm(), :'root', 'production_system', 'L-GH', 'البيوت المحمية', 916.3, tests.unit('dunum')) returning id as gh \gset
insert into public.locations (farm_id, parent_id, type, code, name_ar, area_value, area_unit_id)
values (tests.farm(), :'root', 'production_system', 'L-OF', 'الحقول المكشوفة', 648.7, tests.unit('dunum')) returning id as opf \gset
insert into public.locations (farm_id, parent_id, type, code, name_ar) values (tests.farm(), :'orch', 'block', 'L-B1', 'قطعة ١') returning id as b1 \gset

select is((select path from public.locations where id = :'b1'), array[:'root'::uuid, :'orch'::uuid, :'b1'::uuid], 'path holds the ancestor chain');
select throws_ok(format($$ update public.locations set parent_id = %L, version = 1 where id = %L $$, :'b1', :'orch'),
  'P0422', null, 'a location cannot be moved under its own descendant');
update public.locations set parent_id = :'gh', version = 1 where id = :'b1';
select is((select path[2] from public.locations where id = :'b1'), :'gh'::uuid, 're-parenting rewrites the path');

select is((select components_area from public.location_area_reconciliation where id = :'root'), 3483.0::numeric,
  'D1: components sum to 3,483 D');
select ok((select unreconciled from public.location_area_reconciliation where id = :'root'),
  'D1: the 145 D gap is flagged, not silently reconciled');
select tests.logout();

-- Location-scoped role: department manager limited to the greenhouse subtree
select tests.grant_role(:'agri', 'department_manager', 'agriculture', :'gh');
select tests.login(:'agri');
select lives_ok(format($$ insert into public.locations (farm_id, parent_id, type, code, name_ar, owning_department_id)
  values (tests.farm(), %L, 'house', 'L-H1', 'بيت ١', %L) $$, :'gh', tests.dept('agriculture')), 'scoped manager can add inside their subtree');
select throws_ok(format($$ insert into public.locations (farm_id, parent_id, type, code, name_ar, owning_department_id)
  values (tests.farm(), %L, 'block', 'L-B9', 'قطعة ٩', %L) $$, :'orch', tests.dept('agriculture')), '42501', null,
  'scoped manager cannot add outside their subtree');
select tests.logout();

-- Arabic search normalization
select is(app.normalize_ar('إِدارة المياه'), app.normalize_ar('اداره المياه'), 'alef variants, diacritics and ta marbuta compare equal');
select is(app.normalize_ar('مستشفى'), app.normalize_ar('مستشفي'), 'alef maqsura and ya compare equal');

-- Wells: unnamed temporary codes can never be marked verified
select tests.login(:'admin');
insert into public.water_sources (farm_id, code, kind, is_temporary_code) values (tests.farm(), 'W-T01', 'well', true) returning id as w \gset
insert into public.wells (farm_id, water_source_id) values (tests.farm(), :'w');
select throws_ok(format($$ select public.set_verification_status('water_sources', %L, 'verified', 'site visit', 1) $$, :'w'),
  '23514', null, 'a well with a temporary code and no name cannot be verified');
-- Crew membership is time-bounded with no overlapping periods (VR-C06)
insert into public.workers (farm_id, code, full_name) values (tests.farm(), 'WK-01', 'عامل') returning id as wk \gset
insert into public.crews (farm_id, code, name_ar, department_id) values (tests.farm(), 'CR-A', 'طاقم أ', tests.dept('agriculture')) returning id as ca \gset
insert into public.crews (farm_id, code, name_ar, department_id) values (tests.farm(), 'CR-B', 'طاقم ب', tests.dept('agriculture')) returning id as cb \gset
insert into public.crew_members (farm_id, crew_id, worker_id, valid_from) values (tests.farm(), :'ca', :'wk', now() - interval '10 days');
select throws_ok(format($$ insert into public.crew_members (farm_id, crew_id, worker_id, valid_from) values (tests.farm(), %L, %L, now()) $$, :'cb', :'wk'),
  '23P01', null, 'a worker cannot be in two crews over the same period');
select tests.logout();

select * from finish();
rollback;
