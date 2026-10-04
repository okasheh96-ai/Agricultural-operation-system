-- Foundation 2/5: farm, departments, people, roles, permissions, delegations, devices.
--
-- Permission model (Master Prompt §3.6): role × department × location × object type × action × workflow state.
--   role_permissions  = what a role may do (object type, action, optionally only in some workflow states)
--   user_roles        = who holds a role, in which department (null = farm-wide) and location subtree, for which period
--   delegations       = temporary hand-over of a person's scope to another person
-- Segregation of duties is evaluated per record in transition_record() (migration 3).

-- Helper bodies reference tables created in later foundation migrations (locations).
set check_function_bodies = off;

-- ---------------------------------------------------------------------------------------------
create table public.farms (
  id      uuid primary key default gen_random_uuid(),
  code    text not null unique,
  name_ar text not null,
  name_en text,
  is_demo boolean not null default false
);
comment on table public.farms is
  'Tenant boundary. One real farm/company now; a second site or a clearly separated demo farm can be added later (§3.15).';

-- ---------------------------------------------------------------------------------------------
create table public.departments (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  name_ar        text not null,
  name_en        text,
  kind           text not null check (kind in ('production', 'production_support', 'service', 'quality', 'coordination')),
  is_independent boolean not null default false,
  sort_order     integer not null default 0,
  search_text    text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.departments is
  'The 13 confirmed departments/functions plus the Packing House unit. Owners of work, assets and stock. '
  'is_independent marks QA, which sits outside the Operations reporting tree.';

create table public.roles (
  id      uuid primary key default gen_random_uuid(),
  code    text not null,
  name_ar text not null,
  name_en text
);
comment on table public.roles is 'Role categories (not HR titles). Reporting lines are not modelled because none are confirmed.';

create table public.role_permissions (
  id             uuid primary key default gen_random_uuid(),
  role_id        uuid not null references public.roles(id),
  object_type    text not null,
  action         text not null check (action in
                   ('view', 'create', 'plan', 'dispatch', 'execute', 'review', 'verify', 'approve', 'close', 'configure', 'void')),
  allowed_states text[],
  note           text
);
comment on table public.role_permissions is
  'Permission matrix as data: which role may perform which action on which object type, optionally only '
  'in listed workflow states. Department/location scope comes from user_roles. Documented in docs/PERMISSIONS.md.';

create table public.user_profiles (
  id               uuid primary key references auth.users(id),
  full_name        text not null,
  full_name_en     text,
  preferred_locale text not null default 'ar' check (preferred_locale in ('ar', 'en'))
);
comment on table public.user_profiles is
  'People who sign in. Keyed by the Supabase auth user id. Workers without logins live in workers.';

create table public.user_roles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.user_profiles(id),
  role_id       uuid not null references public.roles(id),
  department_id uuid references public.departments(id),
  location_id   uuid,  -- FK added with locations (migration 4)
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  check (valid_to is null or valid_to > valid_from)
);
comment on table public.user_roles is
  'Who holds which role, in which department (null = farm-wide) and location subtree, for which period. '
  'A person may hold roles in several departments; effective permission is the union.';

create table public.delegations (
  id            uuid primary key default gen_random_uuid(),
  from_user_id  uuid not null references public.user_profiles(id),
  to_user_id    uuid not null references public.user_profiles(id),
  department_id uuid references public.departments(id),
  valid_from    timestamptz not null,
  valid_to      timestamptz not null,
  reason        text not null check (length(trim(reason)) > 0),
  check (from_user_id <> to_user_id),
  check (valid_to > valid_from)
);
comment on table public.delegations is
  'Leave/coverage: grants the delegator''s scope to another person for a period. Audited, and never usable '
  'to verify the delegator''s own work.';

create table public.devices (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  registered_to  uuid references public.user_profiles(id),
  last_seen_at   timestamptz,
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users(id),
  revoke_reason  text,
  check ((revoked_at is null) = (revoke_reason is null))
);
comment on table public.devices is
  'Shared crew phones/tablets. An admin can revoke a lost device; it wipes its local store on next contact (§3.6a).';

-- ---------------------------------------------------------------------------------------------
-- Permission helpers. SECURITY DEFINER so they can read role tables regardless of the caller's RLS.
-- ---------------------------------------------------------------------------------------------
create function app.is_farm_member(p_farm uuid) returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur
     where ur.user_id = app.current_user_id() and ur.farm_id = p_farm and ur.voided_at is null
       and ur.valid_from <= now() and (ur.valid_to is null or ur.valid_to > now())
  ) or exists (
    select 1 from public.delegations d
     where d.to_user_id = app.current_user_id() and d.farm_id = p_farm and d.voided_at is null
       and d.valid_from <= now() and d.valid_to > now()
  )
$$;

-- People whose scope the current user holds right now through a delegation.
create function app.active_delegators(p_farm uuid) returns setof uuid
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  select d.from_user_id from public.delegations d
   where d.to_user_id = app.current_user_id() and d.farm_id = p_farm and d.voided_at is null
     and d.valid_from <= now() and d.valid_to > now()
$$;

-- Six-dimension check. A department-scoped role applies only to records of that department;
-- a farm-wide role (department_id null) applies everywhere. A location-scoped role applies to its
-- subtree. p_state limits actions that role_permissions allows only in certain workflow states.
create function app.has_permission(
  p_farm        uuid,
  p_object_type text,
  p_action      text,
  p_department  uuid default null,
  p_location    uuid default null,
  p_state       text default null
) returns boolean
language sql stable security definer
set search_path = public, app, pg_temp
as $$
  with holders as (
    select app.current_user_id() as user_id, null::uuid as only_department
    union all
    select d.from_user_id, d.department_id
      from public.delegations d
     where d.to_user_id = app.current_user_id() and d.farm_id = p_farm and d.voided_at is null
       and d.valid_from <= now() and d.valid_to > now()
  )
  select exists (
    select 1
      from holders h
      join public.user_roles ur on ur.user_id = h.user_id
      join public.role_permissions rp on rp.role_id = ur.role_id and rp.voided_at is null
     where app.current_user_id() is not null
       and ur.farm_id = p_farm and ur.voided_at is null
       and ur.valid_from <= now() and (ur.valid_to is null or ur.valid_to > now())
       and rp.object_type = p_object_type and rp.action = p_action
       and (rp.allowed_states is null or p_state = any (rp.allowed_states))
       and (ur.department_id is null or ur.department_id = p_department)
       and (h.only_department is null or h.only_department = p_department)
       and (ur.location_id is null
            or exists (select 1 from public.locations l
                        where l.id = p_location and ur.location_id = any (l.path)))
  )
$$;
comment on function app.has_permission is
  'Role × department × location × object type × action × workflow state, including active delegations.';

-- ---------------------------------------------------------------------------------------------
-- Standard contract + policies.
-- ---------------------------------------------------------------------------------------------
select app.register_table('public.farms', 'farm', true, p_has_farm => false, p_default_policies => false);
create policy farms_select on public.farms for select to authenticated using (app.is_farm_member(id));
create policy farms_update on public.farms for update to authenticated
  using (app.has_permission(id, 'farm', 'configure')) with check (app.has_permission(id, 'farm', 'configure'));

select app.register_table('public.departments', 'department', true, p_department_column => 'id');
alter table public.departments add constraint departments_code_uq unique (farm_id, code);

select app.register_table('public.roles', 'role', false);
alter table public.roles add constraint roles_code_uq unique (farm_id, code);

select app.register_table('public.role_permissions', 'role_permission', false);
create unique index role_permissions_uq on public.role_permissions (role_id, object_type, action) where voided_at is null;

select app.register_table('public.user_profiles', 'user', false);
create policy user_profiles_self_update on public.user_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

select app.register_table('public.user_roles', 'user_role', false, p_department_column => 'department_id', p_location_column => 'location_id');
alter table public.user_roles add constraint user_roles_no_overlap exclude using gist (
  user_id with =, role_id with =,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
  coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
  tstzrange(valid_from, valid_to) with &&
) where (voided_at is null);
create index user_roles_user_idx on public.user_roles (user_id) where voided_at is null;

select app.register_table('public.delegations', 'delegation', false, p_department_column => 'department_id');
-- A person may hand over their own scope (e.g. before leave) without an admin.
create policy delegations_insert_own on public.delegations for insert to authenticated
  with check (from_user_id = auth.uid() and app.is_farm_member(farm_id));
alter table public.delegations add constraint delegations_no_overlap exclude using gist (
  from_user_id with =, to_user_id with =,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
  tstzrange(valid_from, valid_to) with &&
) where (voided_at is null);

select app.register_table('public.devices', 'device', false);
