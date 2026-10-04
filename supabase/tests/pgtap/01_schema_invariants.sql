-- Structural guarantees that must hold for every table, now and in later phases.
begin;
select plan(11);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is enabled on every public table');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('DELETE', 'TRUNCATE')),
  0, 'the API role can never delete or truncate');

select is(
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'),
  0, 'anonymous users have no table access');

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and data_type in ('real', 'double precision')),
  0, 'no floating-point columns (quantities and money are numeric)');

select is(
  (select count(*)::int from app.registered_tables r
    where not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                       where c.relname = r.table_name and t.tgname = r.table_name || '_audit')),
  0, 'every registered table has an audit trigger');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and obj_description(c.oid, 'pg_class') is null),
  0, 'every table documents its operational purpose');

select is((select count(*)::int from public.departments where farm_id = tests.farm()), 14,
  'seed: 13 departments + Packing House unit');
select ok((select is_independent from public.departments where id = tests.dept('qa')),
  'seed: QA is marked independent');
select is((select count(*)::int from public.water_sources), 0, 'seed: no wells invented');
select is((select count(*)::int from public.workers) + (select count(*)::int from public.species)
        + (select count(*)::int from public.assets), 0, 'seed: no workers, crops or fleet invented');
select is((select count(*)::int from public.departments where verification_status = 'verified'), 0,
  'seed: Arabic department labels remain to be confirmed on site');

select * from finish();
rollback;
