-- Test-only helpers (loaded after migrations + seed by scripts/db-test.sh). Never applied to Supabase.
-- pgTAP lives outside public so its views never count as API tables.
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated, service_role;
grant execute on all functions in schema extensions to authenticated, service_role;
alter database agri_test set search_path = "$user", public, extensions;

create schema tests;
grant usage on schema tests to authenticated, service_role;

create function tests.farm() returns uuid language sql stable as $$ select id from public.farms where code = 'FARM' $$;
create function tests.dept(p_code text) returns uuid language sql stable as $$
  select id from public.departments where farm_id = tests.farm() and code = p_code $$;
create function tests.role(p_code text) returns uuid language sql stable as $$
  select id from public.roles where farm_id = tests.farm() and code = p_code $$;
create function tests.unit(p_code text) returns uuid language sql stable as $$
  select id from public.units where farm_id = tests.farm() and code = p_code $$;
create function tests.asset_class(p_code text) returns uuid language sql stable as $$
  select id from public.asset_classes where farm_id = tests.farm() and code = p_code $$;

-- Creates an auth user + profile (as the database owner, actor "system").
create function tests.create_user(p_name text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into auth.users (email) values (p_name || '@test.local') returning id into v;
  insert into public.user_profiles (id, farm_id, full_name) values (v, tests.farm(), p_name);
  return v;
end $$;

create function tests.grant_role(p_user uuid, p_role text, p_dept text default null, p_location uuid default null,
                                 p_from timestamptz default now() - interval '1 day', p_to timestamptz default null)
returns uuid language sql as $$
  insert into public.user_roles (farm_id, user_id, role_id, department_id, location_id, valid_from, valid_to)
  values (tests.farm(), p_user, tests.role(p_role), tests.dept(p_dept), p_location, p_from, p_to)
  returning id
$$;

-- Act as a signed-in API user (same mechanism PostgREST uses).
create function tests.login(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function tests.logout() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

grant execute on all functions in schema tests to authenticated, service_role;
