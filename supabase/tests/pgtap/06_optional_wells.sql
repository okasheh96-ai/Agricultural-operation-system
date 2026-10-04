-- The placeholder script is idempotent: the structure already holds the 14 wells (VR-C05, owner instruction 2026-10-05).
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
