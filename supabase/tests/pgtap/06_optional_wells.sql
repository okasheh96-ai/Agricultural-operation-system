-- The optional placeholder script (VR-C05) creates 14 unnamed, unverified wells, none Active.
begin;
select plan(4);
\ir ../../seed/optional_well_placeholders.sql
select is((select count(*)::int from public.water_sources where kind = 'well'), 14, '14 wells (confirmed count)');
select is((select count(*)::int from public.water_sources where status = 'active'), 0, 'no well is assumed Active');
select is((select count(*)::int from public.water_sources where is_temporary_code and name_ar is null), 14,
  'codes flagged temporary, names left empty');
select is((select count(*)::int from public.wells), 14, 'each has its well detail row');
select * from finish();
rollback;
