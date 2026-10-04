-- Foundation 4/5: master data — settings, units, locations, assets, water sources/wells, crop master,
-- workers and crews. Structure only: no farm values are seeded (Master Prompt §5.3).

set check_function_bodies = off;

-- ---------------------------------------------------------------------------------------------
create table public.settings (
  id            uuid primary key default gen_random_uuid(),
  key           text not null,
  value         jsonb not null,
  evidence_tier text not null check (evidence_tier in ('A', 'B', 'C', 'D', 'E')),
  note          text
);
comment on table public.settings is
  'Farm-level configuration (locale, currency, clock-skew threshold, record-of-truth split, ...). Each value '
  'carries its evidence tier so working assumptions are never mistaken for confirmed facts.';
select app.register_table('public.settings', 'setting', false);
create unique index settings_key_uq on public.settings (farm_id, key) where voided_at is null;

-- ---------------------------------------------------------------------------------------------
create table public.units (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  name_ar        text not null,
  name_en        text,
  dimension      text not null check (dimension in ('area', 'volume', 'mass', 'count', 'length', 'time', 'other')),
  to_base_factor numeric check (to_base_factor is null or to_base_factor > 0),
  search_text    text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.units is
  'Units of measure. to_base_factor converts to the dimension''s base unit (m², m³, kg, piece, m, hour); null '
  'when a local unit''s conversion is not yet verified. Item-level conversions (bag → kg) come with inventory.';
select app.register_table('public.units', 'unit', true);
alter table public.units add constraint units_code_uq unique (farm_id, code);

-- ---------------------------------------------------------------------------------------------
create table public.production_systems (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name_ar     text not null,
  name_en     text,
  sort_order  integer not null default 0
);
comment on table public.production_systems is
  'Configurable production systems (Orchard, Greenhouse, Open Field, Packing House, Cattle, Support). '
  'Costing and records stay separate per system (e.g. greenhouse vs open-field tomato, D6).';
select app.register_table('public.production_systems', 'production_system', true);
alter table public.production_systems add constraint production_systems_code_uq unique (farm_id, code);

-- ---------------------------------------------------------------------------------------------
create table public.locations (
  id                   uuid primary key default gen_random_uuid(),
  parent_id            uuid references public.locations(id),
  type                 text not null check (type in
                         ('farm', 'production_system', 'zone', 'block', 'house', 'field', 'sub_unit', 'packhouse_area', 'warehouse', 'other')),
  code                 text not null,
  name_ar              text not null,
  name_en              text,
  production_system_id uuid references public.production_systems(id),
  owning_department_id uuid references public.departments(id),
  area_value           numeric check (area_value is null or area_value >= 0),
  area_unit_id         uuid references public.units(id),
  area_basis           text not null default 'unknown' check (area_basis in ('gross', 'net', 'unknown')),
  path                 uuid[] not null default '{}',
  search_text          text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored,
  check ((area_value is null) = (area_unit_id is null))
);
comment on table public.locations is
  'Single self-referencing location tree (farm → production system → zone → block/house/field → sub-unit, '
  'plus packhouse areas and warehouses). Depth is not hard-coded. path holds ancestor ids including self, '
  'for location-scoped permissions. area_basis records gross vs net (D7).';
select app.register_table('public.locations', 'location', true,
  p_department_column => 'owning_department_id', p_location_column => 'parent_id');
alter table public.locations add constraint locations_code_uq unique (farm_id, code);
create index locations_parent_idx on public.locations (parent_id);
create index locations_path_idx on public.locations using gin (path);

alter table public.user_roles add constraint user_roles_location_fk foreign key (location_id) references public.locations(id);

create function app.locations_set_path() returns trigger
language plpgsql
as $$
declare
  v_parent public.locations;
begin
  if new.parent_id is null then
    new.path := array[new.id];
  else
    select * into v_parent from public.locations where id = new.parent_id;
    if not found then
      raise exception 'Parent location not found' using errcode = 'P0422';
    end if;
    if v_parent.farm_id <> new.farm_id then
      raise exception 'Parent location belongs to another farm' using errcode = 'P0422';
    end if;
    if new.id = any (v_parent.path) then
      raise exception 'A location cannot be moved under itself' using errcode = 'P0422';
    end if;
    new.path := v_parent.path || new.id;
  end if;
  return new;
end;
$$;
create trigger locations_path before insert or update of parent_id on public.locations
  for each row execute function app.locations_set_path();

-- Re-parenting refreshes descendants. SECURITY DEFINER so a scoped user's move is not left half-applied by RLS.
create function app.locations_refresh_descendants() returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.path is distinct from old.path then
    update public.locations l
       set path = new.path || l.path[array_position(l.path, new.id) + 1 :]
     where new.id = any (l.path) and l.id <> new.id;
  end if;
  return null;
end;
$$;
create trigger locations_refresh_descendants after update of parent_id on public.locations
  for each row execute function app.locations_refresh_descendants();

-- D1: reported total vs sum of components, never silently reconciled.
create view public.location_area_reconciliation with (security_invoker = true) as
select p.id, p.farm_id, p.code, p.name_ar, p.name_en,
       p.area_value  as reported_area,
       p.area_unit_id,
       sum(c.area_value * cu.to_base_factor) / nullif(pu.to_base_factor, 0) as components_area,
       count(c.id) filter (where c.area_value is null) as components_without_area,
       (p.area_value is not null and count(c.id) > 0
        and sum(c.area_value * cu.to_base_factor) / nullif(pu.to_base_factor, 0) is distinct from p.area_value) as unreconciled
  from public.locations p
  join public.locations c on c.parent_id = p.id and c.voided_at is null
  left join public.units pu on pu.id = p.area_unit_id
  left join public.units cu on cu.id = c.area_unit_id
 where p.voided_at is null
 group by p.id, pu.to_base_factor;
comment on view public.location_area_reconciliation is
  'Compares each location''s reported area with the sum of its children (converted through units). Flags mismatches such as D1.';

-- ---------------------------------------------------------------------------------------------
create table public.asset_classes (
  id      uuid primary key default gen_random_uuid(),
  code    text not null,
  name_ar text not null,
  name_en text
);
comment on table public.asset_classes is
  'Configurable asset classes (Vehicle, Machine, Equipment, Bus, Pump, Generator, Packhouse Equipment, Cold Room, ...). '
  'Vehicles, machines and equipment are classes in one type-neutral register, not separate tables.';
select app.register_table('public.asset_classes', 'asset_class', true);
alter table public.asset_classes add constraint asset_classes_code_uq unique (farm_id, code);

create table public.assets (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null,
  name_ar              text not null,
  name_en              text,
  asset_class_id       uuid not null references public.asset_classes(id),
  parent_asset_id      uuid references public.assets(id),
  location_id          uuid references public.locations(id),
  owning_department_id uuid references public.departments(id),
  manufacturer         text,
  model                text,
  serial_no            text,
  search_text          text generated always as (app.normalize_ar(
                         code || ' ' || name_ar || ' ' || coalesce(name_en, '') || ' ' || coalesce(manufacturer, '') || ' ' || coalesce(model, ''))) stored,
  check (parent_asset_id is null or parent_asset_id <> id)
);
comment on table public.assets is
  'Type-neutral register of farm assets (vehicles, machinery, pumps, generators, packhouse lines and equipment). '
  'parent_asset_id models line → equipment. Manufacturer/model are entered, never seeded (e.g. "Ingro machine" spelling is unverified).';
select app.register_table('public.assets', 'asset', true, 'asset_status',
  p_department_column => 'owning_department_id', p_location_column => 'location_id');
alter table public.assets add constraint assets_code_uq unique (farm_id, code);
create index assets_location_idx on public.assets (location_id);

-- ---------------------------------------------------------------------------------------------
create table public.water_sources (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null,
  kind                 text not null check (kind in ('well', 'reservoir', 'network', 'other')),
  name_ar              text,
  name_en              text,
  location_id          uuid references public.locations(id),
  owning_department_id uuid references public.departments(id),
  is_temporary_code    boolean not null default false,
  search_text          text generated always as (app.normalize_ar(code || ' ' || coalesce(name_ar, '') || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.water_sources is
  'Water sources (wells, reservoirs, network, other) under Irrigation & Water / Farm Assets. Status is a '
  'workflow with history; nothing is assumed active. Temporary codes are flagged until the farm''s real identifiers are entered.';
select app.register_table('public.water_sources', 'water_source', true, 'asset_status',
  p_department_column => 'owning_department_id', p_location_column => 'location_id');
-- Well names are not yet known (E17): a source may only be verified once it has a real name and code.
alter table public.water_sources add constraint water_sources_verified_needs_identity
  check (verification_status <> 'verified' or (name_ar is not null and not is_temporary_code));
alter table public.water_sources add constraint water_sources_code_uq unique (farm_id, code);

create table public.wells (
  water_source_id uuid primary key references public.water_sources(id),
  pump_asset_id   uuid references public.assets(id),
  meter_asset_id  uuid references public.assets(id),
  notes           text
);
comment on table public.wells is
  'Well-specific detail for water sources of kind "well": links to its pump and meter assets. Readings and '
  'licence/quota fields come with the Irrigation phase once E19/E20 are answered.';

create function app.wells_kind_check() returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.water_sources where id = new.water_source_id and kind = 'well') then
    raise exception 'wells rows must belong to a water source of kind "well"' using errcode = 'P0422';
  end if;
  return new;
end;
$$;
create trigger wells_kind before insert or update on public.wells
  for each row execute function app.wells_kind_check();
-- wells has no own id column: give it the standard contract through its own key.
alter table public.wells add column id uuid generated always as (water_source_id) stored;
select app.register_table('public.wells', 'water_source', false);

-- ---------------------------------------------------------------------------------------------
-- Crop master: Species → Crop Type → Variety → Market Name, with the farm's internal names as aliases.
create table public.species (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  name_ar         text not null,
  name_en         text,
  scientific_name text,
  search_text     text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.species is 'Crop species (top of the crop master hierarchy). Nothing seeded: the crop list is E16.';
select app.register_table('public.species', 'crop_master', true);
alter table public.species add constraint species_code_uq unique (farm_id, code);

create table public.crop_types (
  id          uuid primary key default gen_random_uuid(),
  species_id  uuid not null references public.species(id),
  code        text not null,
  name_ar     text not null,
  name_en     text,
  search_text text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.crop_types is 'Crop types within a species (e.g. a tomato type).';
select app.register_table('public.crop_types', 'crop_master', true);
alter table public.crop_types add constraint crop_types_code_uq unique (farm_id, code);

create table public.varieties (
  id           uuid primary key default gen_random_uuid(),
  crop_type_id uuid not null references public.crop_types(id),
  code         text not null,
  name_ar      text not null,
  name_en      text,
  search_text  text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.varieties is 'Varieties within a crop type. Variety vs market grade questions (D5) stay open until verified.';
select app.register_table('public.varieties', 'crop_master', true);
alter table public.varieties add constraint varieties_code_uq unique (farm_id, code);

create table public.market_names (
  id          uuid primary key default gen_random_uuid(),
  variety_id  uuid not null references public.varieties(id),
  code        text not null,
  name_ar     text not null,
  name_en     text,
  search_text text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.market_names is 'Market names / SKUs for a variety, used later by harvest, packing and dispatch.';
select app.register_table('public.market_names', 'crop_master', true);
alter table public.market_names add constraint market_names_code_uq unique (farm_id, code);

create table public.crop_aliases (
  id             uuid primary key default gen_random_uuid(),
  original_name  text not null,
  species_id     uuid references public.species(id),
  crop_type_id   uuid references public.crop_types(id),
  variety_id     uuid references public.varieties(id),
  market_name_id uuid references public.market_names(id),
  note           text,
  search_text    text generated always as (app.normalize_ar(original_name)) stored,
  check (num_nonnulls(species_id, crop_type_id, variety_id, market_name_id) <= 1)
);
comment on table public.crop_aliases is
  'The farm''s original internal crop names ("Red blocky", "Redblocky", "Sweet beet", "Citrus", ...) preserved '
  'exactly, optionally pointing at one crop-master node. Unresolved aliases point at nothing (D2–D5).';
select app.register_table('public.crop_aliases', 'crop_master', true);

-- ---------------------------------------------------------------------------------------------
create table public.workers (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  full_name          text not null,
  full_name_en       text,
  home_department_id uuid references public.departments(id),
  is_active          boolean not null default true,
  search_text        text generated always as (app.normalize_ar(code || ' ' || full_name || ' ' || coalesce(full_name_en, ''))) stored
);
comment on table public.workers is
  'Field workers as records (they may not have logins); selected from the crew list by the supervisor. '
  'Headcount and labour model are not assumed (E7). Identity numbers live in worker_private.';
select app.register_table('public.workers', 'worker', true, p_department_column => 'home_department_id');
alter table public.workers add constraint workers_code_uq unique (farm_id, code);

create table public.worker_private (
  worker_id uuid primary key references public.workers(id),
  id_number text,
  phone     text
);
comment on table public.worker_private is
  'Worker ID numbers and phone numbers, readable only by roles holding worker_private:view (§3.6a privacy).';
alter table public.worker_private add column id uuid generated always as (worker_id) stored;
select app.register_table('public.worker_private', 'worker_private', false, p_default_policies => false);
create policy worker_private_select on public.worker_private for select to authenticated
  using (app.has_permission(farm_id, 'worker_private', 'view',
         (select w.home_department_id from public.workers w where w.id = worker_id)));
create policy worker_private_insert on public.worker_private for insert to authenticated
  with check (app.has_permission(farm_id, 'worker_private', 'create',
              (select w.home_department_id from public.workers w where w.id = worker_id)));
create policy worker_private_update on public.worker_private for update to authenticated
  using (app.has_permission(farm_id, 'worker_private', 'configure',
         (select w.home_department_id from public.workers w where w.id = worker_id)));

create table public.crews (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  name_ar            text not null,
  name_en            text,
  department_id      uuid not null references public.departments(id),
  supervisor_user_id uuid references public.user_profiles(id)
);
comment on table public.crews is 'Work crews of a department, led by a supervisor (supervisor is a role/assignment, not a table).';
select app.register_table('public.crews', 'crew', true, p_department_column => 'department_id');
alter table public.crews add constraint crews_code_uq unique (farm_id, code);

create table public.crew_members (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid not null references public.crews(id),
  worker_id  uuid not null references public.workers(id),
  valid_from timestamptz not null default now(),
  valid_to   timestamptz,
  check (valid_to is null or valid_to > valid_from)
);
comment on table public.crew_members is
  'Time-bounded crew membership. A worker belongs to at most one crew at a time (tier C, VR-C06); '
  'cross-department work is recorded on the task, not by double membership.';
select app.register_table('public.crew_members', 'crew', false, p_default_policies => false);
alter table public.crew_members add constraint crew_members_no_overlap exclude using gist (
  worker_id with =, tstzrange(valid_from, valid_to) with &&
) where (voided_at is null);
create policy crew_members_select on public.crew_members for select to authenticated using (app.is_farm_member(farm_id));
create policy crew_members_insert on public.crew_members for insert to authenticated
  with check (app.has_permission(farm_id, 'crew', 'configure', (select c.department_id from public.crews c where c.id = crew_id)));
create policy crew_members_update on public.crew_members for update to authenticated
  using (app.has_permission(farm_id, 'crew', 'configure', (select c.department_id from public.crews c where c.id = crew_id)));

-- "As of date" helper for time-bounded membership.
create function public.crew_members_as_of(p_crew uuid, p_at timestamptz default now())
returns setof public.crew_members
language sql stable
as $$
  select * from public.crew_members
   where crew_id = p_crew and voided_at is null
     and valid_from <= p_at and (valid_to is null or valid_to > p_at)
$$;
