-- Packhouse operations, increment 1: line-scoped authority and the shift core.
-- Owner instruction 2026-11-21 (docs/packhouse-ops/PLAN.md). Sources: S-04/S-05/S-06 roles and daily KPIs (draft for review),
-- S-08/S-09 AWETA posters (draft site plan). Every new permission cell is a proposal (P) with its source; nothing here gives
-- a role new authority on a real farm until the record-type owner approves the cell (or proposals are put in effect).
--
-- What this adds
--   * Line scope: a role assignment can be limited to one line (user_roles.ph_line_id); actions marked scope_kind = 'line'
--     are checked against the line of the record. Individual overrides (grant / deny, optionally per line) per user.
--   * Master tables maintained in the browser (maker ≠ checker): customers, pack formats, shift templates, task kinds,
--     downtime causes, packaging items. One registry drives ph_save_master for old and new tables.
--   * Shift core: shifts, line shifts (readiness, submission), labour intervals (no overlapping worker time), shared-team
--     sessions, output by worker or team period, first-pack weight checks, issue reports and QC routing through the engineer,
--     downtime with several affected lines, order plan baseline and revisions, order start / completion, packaging readiness.
--   * The three KPIs of S-04 p.3, computed only from recorded data. Unknown stays unknown.

set check_function_bodies = off;

-- =============================================================================================
-- 1. Line scope and individual overrides
-- =============================================================================================
alter table public.ph_actions
  add column scope_kind text not null default 'farm' check (scope_kind in ('farm', 'line')),
  add column category   text check (category in ('view', 'create', 'edit', 'assign', 'approve', 'quality', 'publish', 'export', 'administer'));
comment on column public.ph_actions.scope_kind is
  'farm: any assignment of a role that holds the cell authorises it. line: the record''s line must match the assignment''s line '
  '(an assignment without a line covers every line).';

alter table public.user_roles add column ph_line_id uuid references public.ph_lines(id);
comment on column public.user_roles.ph_line_id is
  'Packing-house line scope of this assignment. Null = every line. Applies to actions whose scope_kind is line.';

create table public.ph_user_overrides (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.user_profiles(id),
  action_key  text not null,
  effect      text not null check (effect in ('grant', 'deny')),
  line_id     uuid references public.ph_lines(id),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  reason      text not null check (length(trim(reason)) > 0),
  check (valid_to is null or valid_to > valid_from)
);
comment on table public.ph_user_overrides is
  'Account-specific permission overrides: grant or deny one action to one person, optionally on one line, for a period. A deny '
  'wins over every role cell. Written only through the access functions; every change is audited with before / after.';
select app.register_table('public.ph_user_overrides', 'ph_access', false, p_default_policies => false);
create index ph_user_overrides_user_idx on public.ph_user_overrides (user_id);

-- Spec roles a user holds for a line (assignments without a line count everywhere).
create function app.ph_user_spec_roles_at(p_user uuid, p_farm uuid, p_line uuid) returns text[]
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct pr.spec_code), '{}')
    from public.user_roles ur
    join public.ph_roles pr on pr.role_id = ur.role_id and pr.voided_at is null
   where ur.user_id = p_user and ur.farm_id = p_farm and ur.voided_at is null
     and ur.valid_from <= now() and (ur.valid_to is null or ur.valid_to > now())
     and (ur.ph_line_id is null or ur.ph_line_id = p_line)
$$;

create function app.ph_override(p_user uuid, p_farm uuid, p_action text, p_line uuid, p_effect text) returns uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select o.id from public.ph_user_overrides o
   where o.user_id = p_user and o.farm_id = p_farm and o.action_key = p_action and o.effect = p_effect and o.voided_at is null
     and o.valid_from <= now() and (o.valid_to is null or o.valid_to > now())
     and (o.line_id is null or o.line_id = p_line)
   order by o.line_id nulls last limit 1
$$;

-- Basis for p_user performing p_action on a record of line p_line (null = no line context).
create function app.ph_permission_basis_at(p_user uuid, p_farm uuid, p_action text, p_line uuid) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_kind  text := coalesce((select scope_kind from public.ph_actions where farm_id = p_farm and action_key = p_action and voided_at is null), 'farm');
  v_roles text[];
  v_basis text;
begin
  if p_user is null then return null; end if;
  if app.ph_override(p_user, p_farm, p_action, p_line, 'deny') is not null then return null; end if;
  v_roles := case when v_kind = 'line' then app.ph_user_spec_roles_at(p_user, p_farm, p_line)
                  else app.ph_user_spec_roles(p_user, p_farm) end;
  select c.basis || ':' || c.spec_code into v_basis
    from public.ph_permission_cells c
   where c.farm_id = p_farm and c.action_key = p_action and c.voided_at is null and c.spec_code = any (v_roles)
     and (c.state = 'active' or (c.state = 'proposed' and app.ph_proposals_in_effect(p_farm)))
   order by (c.state = 'active') desc, (c.evidence = 'C') desc, c.spec_code
   limit 1;
  if v_basis is not null then return v_basis; end if;
  if app.ph_override(p_user, p_farm, p_action, p_line, 'grant') is not null then return 'override:user'; end if;
  return null;
end;
$$;

-- Existing callers (no line context) keep their behaviour; overrides now apply to them too.
create or replace function app.ph_permission_basis(p_user uuid, p_farm uuid, p_action text) returns text
language sql stable security definer set search_path = public, app, pg_temp
as $$ select app.ph_permission_basis_at(p_user, p_farm, p_action, null) $$;

create function app.ph_authorize_line(p_farm uuid, p_action text, p_line uuid) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_basis text := app.ph_permission_basis_at(app.current_user_id(), p_farm, p_action, p_line);
begin
  if app.current_user_id() is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;
  if v_basis is null then
    raise exception 'Not permitted for your role on this line: %', p_action using errcode = 'P0403',
      detail = jsonb_build_object('key', 'ph.denied.line', 'action', p_action, 'line', p_line)::text;
  end if;
  return v_basis;
end;
$$;

-- Non-raising check for row security and read models.
create function app.ph_can(p_farm uuid, p_action text, p_line uuid default null) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$ select app.ph_permission_basis_at(app.current_user_id(), p_farm, p_action, p_line) is not null $$;

-- Lines on which the signed-in user may perform an action (for the phone form's line picker and filters).
create function public.ph_my_lines(p_action text) returns table (line_id uuid, code text, name_ar text, name_en text, basis text)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select l.id, l.code, l.name_ar, l.name_en, app.ph_permission_basis_at(app.current_user_id(), l.farm_id, p_action, l.id)
    from public.ph_lines l
   where l.voided_at is null and app.ph_is_member(l.farm_id)
     and app.ph_permission_basis_at(app.current_user_id(), l.farm_id, p_action, l.id) is not null
   order by l.sort_order, l.code
$$;

create policy ph_user_overrides_select on public.ph_user_overrides for select to authenticated
  using (user_id = app.current_user_id() or app.ph_can(farm_id, 'users.administer'));

-- =============================================================================================
-- 2. Master tables maintained in the browser (registry replaces the hard-coded lists)
-- =============================================================================================
create table app.ph_master_tables (
  table_name text primary key,
  area       text not null,
  columns    text[] not null,
  versioned  boolean not null default false
);
comment on table app.ph_master_tables is
  'Which packing-house master tables ph_save_master may write, which matrix area governs maker and checker, and the writable '
  'columns. Adding a row here is how a new master table becomes editable in Operations Settings.';
insert into app.ph_master_tables (table_name, area, columns, versioned) values
  ('ph_storage_groups', 'md_quality', array['code', 'name_ar', 'name_en'], false),
  ('ph_crops', 'md_operational', array['code', 'name_ar', 'name_en', 'storage_group_id', 'doc_temp_min_c', 'doc_temp_max_c', 'doc_temp_note',
                                       'boxes_per_pallet', 'nominal_kg_per_pallet', 'washer_route', 'allowed_lines'], true),
  ('ph_varieties', 'md_operational', array['crop_code', 'code', 'name_ar', 'name_en'], false),
  ('ph_sources', 'md_operational', array['kind', 'code', 'name_ar', 'name_en', 'block_code', 'section_code', 'supplier_name'], false),
  ('ph_locations', 'md_operational', array['code', 'name_ar', 'name_en', 'purpose', 'capacity_pallets', 'sort_order'], false),
  ('ph_lines', 'md_operational', array['code', 'name_ar', 'name_en', 'kind', 'nominal_rate', 'crop_codes'], false),
  ('ph_equipment', 'md_operational', array['code', 'name_ar', 'name_en', 'kind', 'location_id', 'calibration_due_on'], false);

create or replace function app.ph_master_area(p_table text) returns text
language sql stable security definer set search_path = public, app, pg_temp
as $$ select area from app.ph_master_tables where table_name = p_table $$;

-- Same maker rules as M1, columns from the registry.
create or replace function public.ph_save_master(p_table text, p_id uuid, p_values jsonb, p_farm uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  m       app.ph_master_tables;
  v_cols  text[];
  rec     jsonb;
  v_farm  uuid;
  v_new   uuid;
  v_key   text;
  v_sets  text := '';
  v_occ   integer;
  v_ins   text[];
begin
  select * into m from app.ph_master_tables where table_name = p_table;
  if not found then
    raise exception 'Unknown packing-house master table %', p_table using errcode = 'P0422';
  end if;
  v_cols := m.columns;
  if exists (select 1 from jsonb_object_keys(p_values) k where k <> all (v_cols)) then
    raise exception 'Only these fields can be set: %', array_to_string(v_cols, ', ') using errcode = 'P0422';
  end if;

  if p_id is null then
    v_farm := coalesce(p_farm, (select farm_id from public.user_roles where user_id = app.current_user_id() and voided_at is null limit 1));
    perform app.ph_authorize(v_farm, m.area || '.edit');
    v_ins := array(select jsonb_object_keys(p_values)) || array['id', 'farm_id', 'verification_status'];
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
                   p_table, (select string_agg(quote_ident(c), ', ') from unnest(v_ins) c),
                   (select string_agg(quote_ident(c), ', ') from unnest(v_ins) c), p_table)
      into v_new using p_values || jsonb_build_object('id', gen_random_uuid(), 'farm_id', v_farm, 'verification_status', 'not_yet_verified');
    return jsonb_build_object('id', v_new, 'created', true);
  end if;

  execute format('select to_jsonb(t) from public.%I t where id = $1 and voided_at is null for update', p_table) into rec using p_id;
  if rec is null or not app.is_farm_member((rec ->> 'farm_id')::uuid) then
    raise exception 'Record not found' using errcode = 'P0404';
  end if;
  v_farm := (rec ->> 'farm_id')::uuid;
  perform app.ph_authorize(v_farm, m.area || '.edit');

  if p_table = 'ph_crops' and rec ->> 'verification_status' = 'verified' then
    if (rec ->> 'superseded_at') is not null then
      raise exception 'This crop version is superseded; change the current version' using errcode = 'P0422';
    end if;
    v_ins := v_cols || array['id', 'farm_id', 'version_no', 'verification_status', 'decision_code'];
    execute format('insert into public.ph_crops (%s) select %s from jsonb_populate_record(null::public.ph_crops, $1) returning id',
                   (select string_agg(quote_ident(c), ', ') from unnest(v_ins) c), (select string_agg(quote_ident(c), ', ') from unnest(v_ins) c))
      into v_new using rec || p_values || jsonb_build_object('id', gen_random_uuid(),
           'version_no', (select max(version_no) + 1 from public.ph_crops where farm_id = v_farm and code = rec ->> 'code'),
           'verification_status', 'not_yet_verified');
    return jsonb_build_object('id', v_new, 'new_version', true);
  end if;

  if p_table = 'ph_locations' and p_values ? 'capacity_pallets' and (p_values ->> 'capacity_pallets') is not null then
    select count(*) into v_occ from public.ph_incoming_pallets where location_id = p_id and status in ('pre_cooling', 'accepted', 'stored', 'on_hold', 'released');
    if v_occ > (p_values ->> 'capacity_pallets')::int then
      raise exception 'Capacity % is below the current occupancy (% pallets)', p_values ->> 'capacity_pallets', v_occ using errcode = 'P0422';
    end if;
  end if;

  foreach v_key in array array(select jsonb_object_keys(p_values)) loop
    v_sets := v_sets || format('%1$I = (jsonb_populate_record(null::public.%2$I, $1)).%1$I, ', v_key, p_table);
  end loop;
  perform set_config('app.in_verify', 'on', true);
  execute format('update public.%I set %s verification_status = ''not_yet_verified'', verified_by = null, verified_at = null '
                 'where id = $2', p_table, v_sets) using p_values, p_id;
  perform set_config('app.in_verify', 'off', true);
  return jsonb_build_object('id', p_id, 'updated', true);
end;
$$;

create table public.ph_customers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9 _.&-]{0,39}$'),
  name_en          text not null,
  name_ar          text,
  market_type      text check (market_type in ('export', 'local', 'retail', 'lss')),
  long_distance    boolean,
  is_active        boolean not null default true,
  notes            text
);
comment on table public.ph_customers is
  'Customers and customer codes as the company writes them (English codes kept as given, e.g. Tesco, Thanet Earth, LSS, Abay, '
  'DBS, Export, DC from S-07). long_distance null = not stated (OD-48). Maintained by Sales, approved by QCM (OD-06 cells).';
select app.register_table('public.ph_customers', 'ph_master', true, p_default_policies => false);
create unique index ph_customers_uq on public.ph_customers (farm_id, lower(code)) where voided_at is null;

create table public.ph_pack_formats (
  id              uuid primary key default gen_random_uuid(),
  code            text not null check (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,29}$'),
  name_ar         text not null,
  name_en         text,
  kind            text not null check (kind in ('carton', 'punnet_carton', 'black_box', 'loose', 'bag', 'other')),
  nominal_net_kg  numeric(8,3) not null check (nominal_net_kg > 0),
  units_per_pack  integer check (units_per_pack > 0),
  crop_code       text,
  customer_id     uuid references public.ph_customers(id),
  is_active       boolean not null default true
);
comment on table public.ph_pack_formats is
  'Pack formats (box / carton / punnet carton / black box …) with the nominal net kg per box. Output records the actual net kg '
  'per box next to it (S-04 p.3: conforming kg = boxes × net kg per box).';
select app.register_table('public.ph_pack_formats', 'ph_master', true, p_default_policies => false);
create unique index ph_pack_formats_uq on public.ph_pack_formats (farm_id, code) where voided_at is null;

create table public.ph_shift_templates (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^[A-Z0-9_-]{1,12}$'),
  name_ar     text not null,
  name_en     text,
  starts_at   time not null,
  ends_at     time not null,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  check (starts_at <> ends_at)
);
comment on table public.ph_shift_templates is
  'Named shifts with their clock times (a shift whose end is earlier than its start ends the next day). No shift times are '
  'given in the sources; the owner enters them.';
select app.register_table('public.ph_shift_templates', 'ph_master', true, p_default_policies => false);
create unique index ph_shift_templates_uq on public.ph_shift_templates (farm_id, code) where voided_at is null;

create table public.ph_task_kinds (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null check (code ~ '^[a-z0-9_]{2,30}$'),
  name_ar            text not null,
  name_en            text,
  counts_as_packing  boolean not null,
  is_shared          boolean not null default false,
  is_active          boolean not null default true,
  sort_order         integer not null default 0
);
comment on table public.ph_task_kinds is
  'Labour-sheet tasks. counts_as_packing decides what enters "actual packing hours" (S-04 p.3: exclude time spent on other '
  'duties). is_shared marks team work whose output is recorded once per period (S-04 p.3 shared production).';
select app.register_table('public.ph_task_kinds', 'ph_master', true, p_default_policies => false);
create unique index ph_task_kinds_uq on public.ph_task_kinds (farm_id, code) where voided_at is null;

create table public.ph_downtime_causes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar    text not null,
  name_en    text,
  category   text,
  is_active  boolean not null default true
);
comment on table public.ph_downtime_causes is 'Confirmed causes of line stops. None are invented; the company enters its list.';
select app.register_table('public.ph_downtime_causes', 'ph_master', true, p_default_policies => false);
create unique index ph_downtime_causes_uq on public.ph_downtime_causes (farm_id, code) where voided_at is null;

create table public.ph_packaging_items (
  id         uuid primary key default gen_random_uuid(),
  code       text not null check (code ~ '^[A-Z0-9_.-]{1,30}$'),
  name_ar    text not null,
  name_en    text,
  kind       text not null check (kind in ('carton', 'punnet', 'field_crate', 'black_box', 'pallet', 'label', 'lid', 'other')),
  unit_code  text not null default 'pc',
  is_active  boolean not null default true
);
comment on table public.ph_packaging_items is
  'Packaging the line needs (cartons, punnets, field crates, black boxes, pallets, labels). Readiness compares requested with '
  'received inside the packhouse.';
select app.register_table('public.ph_packaging_items', 'ph_master', true, p_default_policies => false);
create unique index ph_packaging_items_uq on public.ph_packaging_items (farm_id, code) where voided_at is null;

insert into app.ph_master_tables (table_name, area, columns) values
  ('ph_customers', 'md_customer', array['code', 'name_en', 'name_ar', 'market_type', 'long_distance', 'is_active', 'notes']),
  ('ph_pack_formats', 'md_operational', array['code', 'name_ar', 'name_en', 'kind', 'nominal_net_kg', 'units_per_pack', 'crop_code', 'customer_id', 'is_active']),
  ('ph_shift_templates', 'md_operational', array['code', 'name_ar', 'name_en', 'starts_at', 'ends_at', 'is_active', 'sort_order']),
  ('ph_task_kinds', 'md_operational', array['code', 'name_ar', 'name_en', 'counts_as_packing', 'is_shared', 'is_active', 'sort_order']),
  ('ph_downtime_causes', 'md_operational', array['code', 'name_ar', 'name_en', 'category', 'is_active']),
  ('ph_packaging_items', 'md_operational', array['code', 'name_ar', 'name_en', 'kind', 'unit_code', 'is_active']);

alter table public.ph_order_lines
  add column customer_id     uuid references public.ph_customers(id),
  add column pack_format_id  uuid references public.ph_pack_formats(id);

-- An approved, active master row (records only use approved master data).
create function app.ph_approved(p_table text, p_id uuid, p_farm uuid) returns boolean
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare v boolean;
begin
  if p_id is null then return false; end if;
  execute format('select verification_status = ''verified'' and voided_at is null and coalesce((to_jsonb(t) ->> ''is_active'')::boolean, true) '
                 'from public.%I t where id = $1 and farm_id = $2', p_table) into v using p_id, p_farm;
  return coalesce(v, false);
end;
$$;

-- =============================================================================================
-- 3. Shift core tables
-- =============================================================================================
create table public.ph_shifts (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  shift_date        date not null,
  template_id       uuid references public.ph_shift_templates(id),
  planned_start     timestamptz not null,
  planned_end       timestamptz not null,
  engineer_user_id  uuid references public.user_profiles(id),
  opened_at         timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by         uuid references auth.users(id),
  handover_note     text,
  check (planned_end > planned_start)
);
comment on table public.ph_shifts is
  'A worked shift (SH-YYMMDD-NN): date, planned start and end, and the production engineer on duty (S-04 p.2). Closing it '
  'records the handover (active orders, holds, stoppages) to the Packhouse Managers.';
select app.register_table('public.ph_shifts', 'ph_shift', false, p_default_policies => false);
create unique index ph_shifts_code_uq on public.ph_shifts (farm_id, code) where voided_at is null;
create unique index ph_shifts_template_uq on public.ph_shifts (farm_id, shift_date, template_id) where voided_at is null and template_id is not null;

create table public.ph_line_shifts (
  id                  uuid primary key default gen_random_uuid(),
  shift_id            uuid not null references public.ph_shifts(id),
  line_id             uuid not null references public.ph_lines(id),
  supervisor_user_id  uuid references public.user_profiles(id),
  readiness           jsonb,
  readiness_by        uuid references auth.users(id),
  readiness_at        timestamptz,
  submitted_at        timestamptz,
  submitted_by        uuid references auth.users(id),
  submission_note     text,
  box_reconciliation  jsonb,
  reopened_reason     text
);
comment on table public.ph_line_shifts is
  'One line in one shift: the supervisor, the line-readiness check (S-04 LS §4), and the labour-sheet submission (LS §10). '
  'submitted_at null = no submission yet; a submission with no output is a submitted zero, shown differently.';
select app.register_table('public.ph_line_shifts', 'ph_shift', false, p_default_policies => false);
create unique index ph_line_shifts_uq on public.ph_line_shifts (shift_id, line_id) where voided_at is null;

create table public.ph_team_sessions (
  id             uuid primary key default gen_random_uuid(),
  line_shift_id  uuid not null references public.ph_line_shifts(id),
  task_kind_id   uuid not null references public.ph_task_kinds(id),
  label          text,
  job_card_id    uuid references public.ph_job_cards(id),
  order_line_id  uuid references public.ph_order_lines(id),
  started_at     timestamptz not null,
  ended_at       timestamptz,
  check (ended_at is null or ended_at > started_at)
);
comment on table public.ph_team_sessions is
  'Shared work recorded once for the group (S-04 LS §5, p.3 shared production, e.g. Sweet Bite sorting after washing). Members '
  'are labour intervals pointing here; output is recorded per period between membership changes.';
select app.register_table('public.ph_team_sessions', 'ph_labour', false, p_default_policies => false);
create index ph_team_sessions_ls_idx on public.ph_team_sessions (line_shift_id);

create table public.ph_labour_intervals (
  id               uuid primary key default gen_random_uuid(),
  line_shift_id    uuid not null references public.ph_line_shifts(id),
  worker_id        uuid not null references public.workers(id),
  task_kind_id     uuid not null references public.ph_task_kinds(id),
  team_session_id  uuid references public.ph_team_sessions(id),
  job_card_id      uuid references public.ph_job_cards(id),
  order_line_id    uuid references public.ph_order_lines(id),
  started_at       timestamptz not null,
  ended_at         timestamptz,
  end_reason       text,
  check (ended_at is null or ended_at > started_at)
);
comment on table public.ph_labour_intervals is
  'Who did which task, on which line, from when to when (S-04 LS §5). A worker is never in two intervals at once, on any line, '
  'so worker-hours are never counted twice; moving a worker ends one interval and starts another.';
select app.register_table('public.ph_labour_intervals', 'ph_labour', false, p_default_policies => false);
alter table public.ph_labour_intervals add constraint ph_labour_no_overlap exclude using gist (
  worker_id with =, tstzrange(started_at, coalesce(ended_at, 'infinity')) with &&
) where (voided_at is null);
create index ph_labour_intervals_ls_idx on public.ph_labour_intervals (line_shift_id);
create index ph_labour_intervals_team_idx on public.ph_labour_intervals (team_session_id);

create table public.ph_output_entries (
  id               uuid primary key default gen_random_uuid(),
  line_shift_id    uuid not null references public.ph_line_shifts(id),
  worker_id        uuid references public.workers(id),
  team_session_id  uuid references public.ph_team_sessions(id),
  job_card_id      uuid references public.ph_job_cards(id),
  order_line_id    uuid references public.ph_order_lines(id),
  grade            text not null check (grade in ('premium', 'gr1', 'gr2')),
  pack_format_id   uuid not null references public.ph_pack_formats(id),
  net_kg_per_box   numeric(8,3) not null check (net_kg_per_box > 0),
  boxes            integer not null check (boxes > 0),
  conforming       boolean not null default true,
  period_start     timestamptz,
  period_end       timestamptz not null,
  kg               numeric(12,3) generated always as (boxes * net_kg_per_box) stored,
  note             text,
  correction_reason text,
  check ((worker_id is null) <> (team_session_id is null)),
  check (team_session_id is null or period_start is not null),
  check (period_start is null or period_end > period_start)
);
comment on table public.ph_output_entries is
  'Boxes packed by one worker or by a team in one period, by grade and pack (S-04 LS §5). kg = boxes × actual net kg per box. '
  'Team entries cover a period in which membership did not change, so the allocation per member is exact (allocated average).';
select app.register_table('public.ph_output_entries', 'ph_labour', false, p_default_policies => false);
create index ph_output_entries_ls_idx on public.ph_output_entries (line_shift_id);
create index ph_output_entries_order_idx on public.ph_output_entries (order_line_id);

create table public.ph_first_pack_checks (
  id               uuid primary key default gen_random_uuid(),
  line_shift_id    uuid not null references public.ph_line_shifts(id),
  pack_format_id   uuid not null references public.ph_pack_formats(id),
  order_line_id    uuid references public.ph_order_lines(id),
  job_card_id      uuid references public.ph_job_cards(id),
  target_net_kg    numeric(8,3) not null check (target_net_kg > 0),
  measured_kg      numeric(8,3) not null check (measured_kg > 0),
  scale_id         uuid references public.ph_equipment(id),
  machine_setting_ok boolean,
  note             text
);
comment on table public.ph_first_pack_checks is
  'First finished pack weighed at each order or pack-weight change, with the machine weight setting checked against the order '
  '(S-04 LS §6). Output for a pack without a check on that line shift is listed as an exception, not blocked (draft rule).';
select app.register_table('public.ph_first_pack_checks', 'ph_labour', false, p_default_policies => false);
create index ph_first_pack_checks_ls_idx on public.ph_first_pack_checks (line_shift_id);

create table public.ph_shift_issues (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  line_shift_id     uuid references public.ph_line_shifts(id),
  line_id           uuid references public.ph_lines(id),
  kind              text not null check (kind in ('fault', 'weight_discrepancy', 'packing_error', 'worker_issue', 'shortage',
                                                  'readiness', 'qc_observation', 'instruction', 'waste_collection', 'other')),
  description       text not null check (length(trim(description)) > 0),
  parent_id         uuid references public.ph_shift_issues(id),
  routed_to         uuid references public.user_profiles(id),
  routed_role       text,
  acknowledged_by   uuid references auth.users(id),
  acknowledged_at   timestamptz,
  resolved_by       uuid references auth.users(id),
  resolved_at       timestamptz,
  resolution        text
);
comment on table public.ph_shift_issues is
  'Issues raised on the floor and how they travel (S-04 LS §1, §9, §10; PE §4, §9): a supervisor reports to the engineer on duty '
  '(Packhouse Managers when none); a QC observation goes to the engineer, never straight to the supervisor; the engineer relays '
  'an instruction to the supervisor (kind instruction, parent = the observation).';
select app.register_table('public.ph_shift_issues', 'ph_shift', false, p_default_policies => false);
create unique index ph_shift_issues_code_uq on public.ph_shift_issues (farm_id, code) where voided_at is null;

create table public.ph_downtime_events (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null,
  shift_id               uuid references public.ph_shifts(id),
  equipment_id           uuid references public.ph_equipment(id),
  equipment_text         text,
  job_card_id            uuid references public.ph_job_cards(id),
  order_line_id          uuid references public.ph_order_lines(id),
  stopped_at             timestamptz not null,
  observed_fault         text not null check (length(trim(observed_fault)) > 0),
  restarted_at           timestamptz,
  restarted_by           uuid references auth.users(id),
  cause_id               uuid references public.ph_downtime_causes(id),
  cause_note             text,
  cause_confirmed_by     uuid references auth.users(id),
  cause_confirmed_at     timestamptz,
  responsible_text       text,
  work_order_ref         text,
  response_at            timestamptz,
  technical_release_by   uuid references auth.users(id),
  technical_release_at   timestamptz,
  check (restarted_at is null or restarted_at > stopped_at)
);
comment on table public.ph_downtime_events is
  'A stop (S-04 PE §8, p.3 KPI 2): stop time, observed fault, restart, confirmed cause when known. A stop of shared equipment '
  'lists every affected line once (ph_downtime_lines); site-wide elapsed minutes are the union of stops, never their sum.';
select app.register_table('public.ph_downtime_events', 'ph_downtime', false, p_default_policies => false);
create unique index ph_downtime_events_code_uq on public.ph_downtime_events (farm_id, code) where voided_at is null;

create table public.ph_downtime_lines (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references public.ph_downtime_events(id),
  line_id   uuid not null references public.ph_lines(id)
);
comment on table public.ph_downtime_lines is 'Lines affected by one stop (a shared-equipment stop lists several lines once each).';
select app.register_table('public.ph_downtime_lines', 'ph_downtime', false, p_default_policies => false);
create unique index ph_downtime_lines_uq on public.ph_downtime_lines (event_id, line_id) where voided_at is null;
create index ph_downtime_lines_line_idx on public.ph_downtime_lines (line_id);

create table public.ph_order_plans (
  id                   uuid primary key default gen_random_uuid(),
  order_line_id        uuid not null references public.ph_order_lines(id),
  version_no           integer not null check (version_no > 0),
  planned_duration_min integer not null check (planned_duration_min > 0),
  planned_start_at     timestamptz,
  promised_loading_at  timestamptz,
  line_id              uuid references public.ph_lines(id),
  reason               text,
  recorded_after_start boolean not null default false,
  check (version_no = 1 or length(trim(coalesce(reason, ''))) > 0)
);
comment on table public.ph_order_plans is
  'Order time plan (S-04 p.3 KPI 3): version 1 is the baseline recorded before start; every revision is a new version with a '
  'reason. The variance always uses the baseline; lateness uses the latest promised loading time.';
select app.register_table('public.ph_order_plans', 'ph_order_timing', false, p_default_policies => false);
create unique index ph_order_plans_uq on public.ph_order_plans (order_line_id, version_no) where voided_at is null;
create trigger ph_order_plans_append_only before update on public.ph_order_plans for each row execute function app.ph_append_only();

create table public.ph_order_execution (
  id              uuid primary key default gen_random_uuid(),
  order_line_id   uuid not null references public.ph_order_lines(id),
  started_at      timestamptz not null,
  started_by      uuid references auth.users(id),
  completed_at    timestamptz,
  completed_by    uuid references auth.users(id),
  overrun_reason  text,
  check (completed_at is null or completed_at > started_at)
);
comment on table public.ph_order_execution is 'Actual start and completion of an order (S-04 p.3 KPI 3).';
select app.register_table('public.ph_order_execution', 'ph_order_timing', false, p_default_policies => false);
create unique index ph_order_execution_uq on public.ph_order_execution (order_line_id) where voided_at is null;

create table public.ph_packaging_moves (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.ph_packaging_items(id),
  kind           text not null check (kind in ('requested', 'received', 'issued', 'returned')),
  quantity       numeric(12,2) not null check (quantity > 0),
  order_line_id  uuid references public.ph_order_lines(id),
  line_id        uuid references public.ph_lines(id),
  needed_by      timestamptz,
  note           text
);
comment on table public.ph_packaging_moves is
  'Packaging readiness (S-04 PE §3, LS §4): requested from the warehouse, received inside the packhouse, issued to the line, '
  'returned. Short = requested − received. Not a warehouse stock ledger (the ERP boundary is OD-04).';
select app.register_table('public.ph_packaging_moves', 'ph_packaging', false, p_default_policies => false);
create index ph_packaging_moves_order_idx on public.ph_packaging_moves (order_line_id);
create trigger ph_packaging_moves_append_only before update on public.ph_packaging_moves for each row execute function app.ph_append_only();

-- =============================================================================================
-- 4. Row security
-- =============================================================================================
do $$
declare t text;
begin
  foreach t in array array['ph_customers', 'ph_pack_formats', 'ph_shift_templates', 'ph_task_kinds', 'ph_downtime_causes',
                           'ph_packaging_items', 'ph_shifts', 'ph_line_shifts', 'ph_shift_issues', 'ph_downtime_events',
                           'ph_downtime_lines', 'ph_order_plans', 'ph_order_execution', 'ph_packaging_moves'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.ph_is_member(farm_id))', t || '_select', t);
  end loop;
end $$;

-- Worker-level labour records: only people who may see them on that line (employee details are permissioned).
create function app.ph_line_of_line_shift(p_ls uuid) returns uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$ select line_id from public.ph_line_shifts where id = p_ls $$;

do $$
declare t text;
begin
  foreach t in array array['ph_team_sessions', 'ph_labour_intervals', 'ph_output_entries', 'ph_first_pack_checks'] loop
    execute format('create policy %I on public.%I for select to authenticated using '
                   '(app.ph_can(farm_id, ''labour.view_people'', app.ph_line_of_line_shift(line_shift_id)))', t || '_select', t);
  end loop;
end $$;

-- =============================================================================================
-- 5. Roles, actions and proposed cells (S-04 / S-08 / S-09), task kinds named by S-04
-- =============================================================================================
create function app.seed_po_shift_core(p_farm uuid) returns void
language plpgsql
as $$
begin
  perform app.po_categorize_actions(p_farm);
  if exists (select 1 from public.ph_actions where farm_id = p_farm and action_key = 'labour.record') then
    return;
  end if;

  insert into public.roles (farm_id, code, name_ar, name_en)
  select p_farm, 'ph_' || lower(r.c), r.ar, r.en
    from (values ('MNT', 'فريق الصيانة / فنّي', 'Maintenance team / technician'),
                 ('CLN', 'فريق التنظيف', 'Cleaning team')) as r(c, ar, en)
   where not exists (select 1 from public.roles where farm_id = p_farm and code = 'ph_' || lower(r.c));
  insert into public.ph_roles (farm_id, role_id, spec_code, department_text, reporting_line, evidence, source, system_use, sort_order)
  select p_farm, (select id from public.roles where farm_id = p_farm and code = 'ph_' || lower(r.c)), r.c, r.dept, 'Not stated', 'P', r.src, r.use, r.ord
    from (values ('MNT', 'Maintenance', 'S-08 "Maintenance team only"; S-09 "Technician"', 'Preventive maintenance, repairs, technical release before restart', 21),
                 ('CLN', 'Cleaning', 'S-09 "Cleaning team"', 'Machine cleaning tasks; no technical work (S-09 prohibitions)', 22)) as r(c, dept, src, use, ord)
   where not exists (select 1 from public.ph_roles where farm_id = p_farm and spec_code = r.c);

  insert into public.ph_actions (farm_id, action_key, object_code, label_en, label_ar, owner_roles, milestone, source, sort_order, scope_kind, category)
  select p_farm, a.k, split_part(a.k, '.', 1), a.en, a.ar, a.own, 'PO-1', a.src, 900 + row_number() over (), a.scope, a.cat
    from (values
      ('shift.view', 'View shifts, line status and the shift summary', 'عرض الورديات وحالة الخطوط وملخص الوردية', '{PHM}'::text[], 'S-04 p.2–3', 'farm', 'view'),
      ('shift.manage', 'Open / close a shift, assign the engineer and supervisors', 'فتح / إغلاق وردية وتعيين المهندس والمشرفين', '{PHM}', 'S-04 PE §1, §11', 'farm', 'assign'),
      ('labour.record', 'Labour sheet: workers, tasks, times, output, readiness, first-pack check', 'كشف العمالة: العمال والمهام والأوقات والإنتاج والجاهزية وفحص أول عبوة', '{PHM}', 'S-04 LS §2, §4–6', 'line', 'create'),
      ('labour.submit', 'Submit the line''s labour sheet at shift end', 'تسليم كشف عمالة الخط في نهاية الوردية', '{PHM}', 'S-04 LS §10', 'line', 'create'),
      ('labour.correct', 'Correct or void a labour or output record (with reason)', 'تصحيح أو إلغاء سجل عمالة أو إنتاج (مع السبب)', '{PHM}', 'S-04 PE §11 (reconcile)', 'line', 'edit'),
      ('labour.view_people', 'See worker-level labour and productivity', 'عرض العمالة والإنتاجية على مستوى العامل', '{PHM}', 'Instruction §4 (permissioned employee details)', 'line', 'view'),
      ('downtime.report', 'Report a line stop (line, time, observed fault)', 'الإبلاغ عن توقف خط (الخط، الوقت، العطل الملاحظ)', '{PHM}', 'S-04 LS §10, PE §8', 'line', 'create'),
      ('downtime.manage', 'Record restart and confirmed cause of a stop', 'تسجيل إعادة التشغيل والسبب المؤكد للتوقف', '{PHM}', 'S-04 PE §8', 'line', 'edit'),
      ('downtime.technical_release', 'Technical release after repair (guards refitted, tested)', 'الإفراج الفني بعد الإصلاح (إعادة الحواجز والاختبار)', '{PHM}', 'S-08 "Maintenance team only"', 'line', 'approve'),
      ('order_timing.plan', 'Record the order time plan (baseline, revisions with reason)', 'تسجيل خطة زمن الطلبية (الأساس والتعديلات مع السبب)', '{PHM}', 'S-04 p.3 KPI 3; PE §10', 'farm', 'create'),
      ('order_timing.record', 'Record order start and completion', 'تسجيل بدء الطلبية وإنجازها', '{PHM}', 'S-04 p.3 KPI 3', 'line', 'create'),
      ('issue.report', 'Report a floor issue to the engineer on duty', 'الإبلاغ عن مشكلة على الخط لمهندس الوردية', '{PHM}', 'S-04 LS §10', 'farm', 'create'),
      ('issue.qc_observation', 'Raise a QC observation on a line (goes to the engineer)', 'تسجيل ملاحظة مراقبة جودة على خط (تذهب للمهندس)', '{QCM}', 'S-04 LS §1, PE §4', 'farm', 'quality'),
      ('issue.instruct', 'Relay an instruction to a line supervisor; resolve issues', 'إيصال تعليمات لمشرف الخط؛ حل المشاكل', '{PHM}', 'S-04 LS §1, PE §1', 'farm', 'assign'),
      ('packaging.readiness', 'Record packaging requested / received inside / issued / returned', 'تسجيل مواد التعبئة المطلوبة / المستلمة داخل البيت / المصروفة / المرتجعة', '{PHM}', 'S-04 PE §3, LS §4', 'farm', 'create'),
      ('report.kpi_view', 'View KPI reports and the management overview', 'عرض تقارير مؤشرات الأداء ونظرة الإدارة العامة', '{PHM}', 'S-04 p.3; instruction §4', 'farm', 'view'),
      ('report.export', 'Export reports (CSV / print)', 'تصدير التقارير (CSV / طباعة)', '{PHM}', 'Instruction §4', 'farm', 'export')
    ) as a(k, en, ar, own, src, scope, cat);

  insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
  select p_farm, m.k, m.r, 'P', 'proposed', 'P', m.note
    from (values
      ('shift.view','PHM',null::text),('shift.view','PE',null),('shift.view','LL',null),('shift.view','QCI',null),('shift.view','QCM',null),
      ('shift.view','QAO',null),('shift.view','QAM',null),('shift.view','WHM',null),('shift.view','MNT',null),('shift.view','TOP',null),('shift.view','AUD',null),
      ('shift.manage','PHM','S-04 PE §11: hand-over to the Packhouse Managers.'),('shift.manage','PE','S-04 PE §1: takes over the shift, briefs supervisors.'),
      ('labour.record','LL','S-04 LS §5: the supervisor maintains the daily labour sheet.'),('labour.record','PE','S-04 PE §6: verifies supervisors update labour sheets.'),
      ('labour.submit','LL','S-04 LS §10.'),('labour.submit','PE','S-04 PE §11: collects every shift sheet.'),
      ('labour.correct','PE','S-04 PE §11: reconcile output and hours.'),('labour.correct','PHM',null),
      ('labour.view_people','LL','Own line when the assignment is line-scoped.'),('labour.view_people','PE',null),('labour.view_people','PHM',null),
      ('downtime.report','LL','S-04 LS §10: report faults immediately.'),('downtime.report','PE','S-04 PE §8.'),('downtime.report','PHM',null),
      ('downtime.manage','PE','S-04 PE §8: restart time, total, confirmed cause.'),('downtime.manage','PHM',null),
      ('downtime.technical_release','MNT','S-08: maintenance refits guards and tests readiness before restart.'),
      ('order_timing.plan','PE','S-04 p.3: record the plan before starting.'),('order_timing.plan','PHM','S-04 PE §10: approves plan changes.'),
      ('order_timing.record','LL',null),('order_timing.record','PE',null),
      ('issue.report','LL','S-04 LS §10.'),('issue.report','PE',null),('issue.report','PHM',null),
      ('issue.qc_observation','QCI','S-04 LS §1: QC contact goes to the engineer.'),('issue.qc_observation','QCM',null),
      ('issue.qc_observation','QAO','S-04 PE §5: QA observations and holds.'),('issue.qc_observation','QAM',null),
      ('issue.instruct','PE','S-04 LS §1: instructions only from the engineer.'),('issue.instruct','PHM','S-04 LS §1: Packhouse Managers when the engineer is absent.'),
      ('packaging.readiness','PE','S-04 PE §3.'),('packaging.readiness','LL','S-04 LS §4: packaging inside the packhouse before the shift.'),
      ('packaging.readiness','STK',null),('packaging.readiness','WHM',null),
      ('report.kpi_view','PHM','S-04 p.3: daily report to the Packhouse Managers.'),('report.kpi_view','PE','S-04 p.3: prepared by the Production Engineers.'),
      ('report.kpi_view','TOP',null),('report.kpi_view','AUD',null),
      ('report.export','PHM',null),('report.export','PE',null)
    ) as m(k, r, note);

  -- Task kinds named by S-04: packing (KPI 1), other duties (excluded from packing hours), shared sorting after washing.
  perform set_config('app.in_verify', 'on', true);
  insert into public.ph_task_kinds (farm_id, code, name_ar, name_en, counts_as_packing, is_shared, sort_order, verification_status, verified_at, source_note)
  values (p_farm, 'packing', 'تعبئة', 'Packing', true, false, 1, 'verified', now(), 'S-04 p.3 KPI 1: actual packing hours'),
         (p_farm, 'other_duty', 'مهام أخرى (ليست تعبئة)', 'Other duty (not packing)', false, false, 9, 'verified', now(),
          'S-04 p.3 KPI 1: exclude time spent on other duties'),
         (p_farm, 'shared_sorting', 'فرز مشترك بعد الغسيل', 'Shared sorting after washing', true, true, 2, 'verified', now(),
          'S-04 p.3: shared Sweet Bite sorting after washing');
  perform set_config('app.in_verify', 'off', true);
end;
$$;

create or replace function app.seed_phase_structure(p_farm uuid) returns void
language plpgsql as $$
begin
  perform app.seed_phase2_structure(p_farm);
  perform app.seed_task_workflow_v2(p_farm);
  perform app.seed_well_placeholders(p_farm);
  perform app.seed_hardening(p_farm);
  perform app.seed_ph_config(p_farm);
  perform app.seed_ph_receiving(p_farm);
  perform app.seed_ph_production(p_farm);
  perform app.seed_ph_waste_reconciliation(p_farm);
  perform app.seed_ph_orders_plan(p_farm);
  perform app.seed_po_shift_core(p_farm);
end $$;

-- Existing actions get a category so the access screens can group them (also run for farms created later, from the seed).
create function app.po_categorize_actions(p_farm uuid) returns void
language sql as $$
  update public.ph_actions set category = case
      when action_key like '%.view' or action_key like '%view%' then 'view'
      when action_key like 'hold.%' or action_key like 'rma.%' or action_key like 'complaint.%' or action_key like 'capa.%'
        or action_key in ('load.release_pallet', 'load.qa_findings', 'waste.qc_label', 'qc2.submit') then 'quality'
      when action_key like '%.approve%' or action_key like '%approve' or action_key like '%.signoff%' or action_key like '%.decide%'
        or action_key in ('job_card.close', 'arrival.vehicle_exception') then 'approve'
      when action_key like 'users.%' then 'administer'
      when action_key like 'md_%.edit' then 'edit'
      when action_key like '%.assign%' then 'assign'
      else 'create' end
   where farm_id = p_farm and category is null
$$;
select app.po_categorize_actions(id) from public.farms;

-- =============================================================================================
-- 6. Helpers
-- =============================================================================================
create function app.ph_line_shift(p_id uuid) returns public.ph_line_shifts
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_line_shifts;
begin
  select * into r from public.ph_line_shifts where id = p_id and voided_at is null and app.ph_is_member(farm_id);
  if not found then
    raise exception 'Line shift not found' using errcode = 'P0404', detail = jsonb_build_object('key', 'po.lineShift.notFound')::text;
  end if;
  return r;
end;
$$;

-- The engineer on duty for a line shift, or null (then the Packhouse Managers are notified, OD-51).
create function app.ph_shift_engineer(p_line_shift uuid) returns uuid
language sql stable security definer set search_path = public, app, pg_temp
as $$ select s.engineer_user_id from public.ph_line_shifts ls join public.ph_shifts s on s.id = ls.shift_id where ls.id = p_line_shift $$;

create function app.ph_notify_user(p_farm uuid, p_user uuid, p_kind text, p_entity_type text, p_entity uuid, p_params jsonb) returns void
language sql security definer set search_path = public, app, pg_temp
as $$
  insert into public.notifications (farm_id, user_id, kind, entity_type, entity_id, params)
  select p_farm, p_user, p_kind, p_entity_type, p_entity, p_params where p_user is not null
$$;

-- Notify the engineer on duty, else every PHM.
create function app.ph_notify_engineer_or_phm(p_farm uuid, p_line_shift uuid, p_kind text, p_entity_type text, p_entity uuid, p_params jsonb)
returns text
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_eng uuid := case when p_line_shift is not null then app.ph_shift_engineer(p_line_shift) end;
begin
  if v_eng is not null then
    perform app.ph_notify_user(p_farm, v_eng, p_kind, p_entity_type, p_entity, p_params);
    return 'PE';
  end if;
  perform app.ph_notify_role(p_farm, 'PHM', p_kind, p_entity_type, p_entity, p_params);
  return 'PHM';
end;
$$;

create function app.ph_open_line_shift_guard(ls public.ph_line_shifts) returns void
language plpgsql stable as $$
begin
  if ls.submitted_at is not null then
    raise exception 'This line''s labour sheet was submitted; corrections go through the engineer (labour.correct)'
      using errcode = 'P0422', detail = jsonb_build_object('key', 'po.lineShift.submitted')::text;
  end if;
  if (select closed_at from public.ph_shifts where id = ls.shift_id) is not null then
    raise exception 'The shift is closed' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.shift.closed')::text;
  end if;
end;
$$;

-- Event times from the floor: server time unless the client gives an earlier time (late entry), never in the future.
create function app.ph_event_time(p_at text) returns timestamptz
language plpgsql stable as $$
declare v timestamptz := coalesce(nullif(trim(p_at), '')::timestamptz, now());
begin
  if v > now() + interval '2 minutes' then
    raise exception 'A time in the future cannot be recorded' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.futureTime')::text;
  end if;
  return v;
end;
$$;

-- =============================================================================================
-- 7. Shifts and line shifts
-- =============================================================================================
create function public.ph_open_shift(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen  jsonb := app.ph_request_seen(p_request_id, 'ph_open_shift');
  v_farm  uuid := app.ph_farm_of_user();
  v_date  date := coalesce((p ->> 'shift_date')::date, app.ph_local_date());
  t       public.ph_shift_templates;
  v_start timestamptz;
  v_end   timestamptz;
  v_id    uuid := gen_random_uuid();
  v_code  text;
  v_basis text;
begin
  if v_seen is not null then return v_seen; end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  v_basis := app.ph_authorize(v_farm, 'shift.manage');
  if p ? 'template_id' and (p ->> 'template_id') is not null then
    if not app.ph_approved('ph_shift_templates', (p ->> 'template_id')::uuid, v_farm) then
      raise exception 'Shift template not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'shift template')::text;
    end if;
    select * into t from public.ph_shift_templates where id = (p ->> 'template_id')::uuid;
    v_start := (v_date + t.starts_at) at time zone 'Asia/Amman';
    v_end := (v_date + t.ends_at + case when t.ends_at <= t.starts_at then interval '1 day' else interval '0' end) at time zone 'Asia/Amman';
  else
    v_start := (p ->> 'planned_start')::timestamptz;
    v_end := (p ->> 'planned_end')::timestamptz;
    if v_start is null or v_end is null or v_end <= v_start then
      raise exception 'Give a shift template, or a planned start and a later planned end' using errcode = 'P0422',
        detail = jsonb_build_object('key', 'po.shift.times')::text;
    end if;
  end if;
  if (p ->> 'engineer_user_id') is not null
     and 'PE' <> all (app.ph_user_spec_roles((p ->> 'engineer_user_id')::uuid, v_farm)) then
    raise exception 'The engineer on duty must hold the Production Engineer role' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.shift.engineerRole')::text;
  end if;
  v_code := 'SH-' || to_char(v_date, 'YYMMDD') || '-' || lpad(app.ph_next(v_farm, 'SH:' || to_char(v_date, 'YYMMDD'))::text, 2, '0');
  insert into public.ph_shifts (id, farm_id, code, shift_date, template_id, planned_start, planned_end, engineer_user_id)
  values (v_id, v_farm, v_code, v_date, t.id, v_start, v_end, (p ->> 'engineer_user_id')::uuid);
  return app.ph_request_done(p_request_id, 'ph_open_shift', v_farm,
    jsonb_build_object('id', v_id, 'code', v_code, 'planned_start', v_start, 'planned_end', v_end, 'basis', v_basis));
exception when unique_violation then
  raise exception 'This shift is already open for that date' using errcode = 'P0409', detail = jsonb_build_object('key', 'po.shift.duplicate')::text;
end;
$$;

create function public.ph_set_shift_engineer(p_shift uuid, p_engineer uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare s public.ph_shifts;
begin
  select * into s from public.ph_shifts where id = p_shift and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Shift not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(s.farm_id, 'shift.manage');
  if p_engineer is not null and 'PE' <> all (app.ph_user_spec_roles(p_engineer, s.farm_id)) then
    raise exception 'The engineer on duty must hold the Production Engineer role' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.shift.engineerRole')::text;
  end if;
  update public.ph_shifts set engineer_user_id = p_engineer where id = p_shift;
  return jsonb_build_object('id', p_shift, 'engineer_user_id', p_engineer);
end;
$$;

create function public.ph_open_line_shift(p_shift uuid, p_line uuid, p_supervisor uuid default null, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_open_line_shift');
  s      public.ph_shifts;
  v_id   uuid := gen_random_uuid();
  v_sup  uuid;
  v_basis text;
begin
  if v_seen is not null then return v_seen; end if;
  select * into s from public.ph_shifts where id = p_shift and voided_at is null and app.ph_is_member(farm_id);
  if not found then raise exception 'Shift not found' using errcode = 'P0404'; end if;
  if s.closed_at is not null then raise exception 'The shift is closed' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.shift.closed')::text; end if;
  if not exists (select 1 from public.ph_lines where id = p_line and farm_id = s.farm_id and voided_at is null) then
    raise exception 'Line not found' using errcode = 'P0404';
  end if;
  -- The engineer / manager opens any line; a supervisor opens their own line for themself.
  if app.ph_can(s.farm_id, 'shift.manage') then
    v_basis := app.ph_authorize(s.farm_id, 'shift.manage');
    v_sup := p_supervisor;
  else
    v_basis := app.ph_authorize_line(s.farm_id, 'labour.record', p_line);
    v_sup := app.current_user_id();
  end if;
  insert into public.ph_line_shifts (id, farm_id, shift_id, line_id, supervisor_user_id) values (v_id, s.farm_id, s.id, p_line, v_sup);
  return app.ph_request_done(p_request_id, 'ph_open_line_shift', s.farm_id, jsonb_build_object('id', v_id, 'basis', v_basis));
exception when unique_violation then
  raise exception 'This line is already open in this shift' using errcode = 'P0409', detail = jsonb_build_object('key', 'po.lineShift.duplicate')::text;
end;
$$;

-- Line readiness before production (S-04 LS §2 hygiene and workwear, §4 line and packaging ready). Items are the S-04 wording.
create function public.ph_record_readiness(p_line_shift uuid, p_items jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  ls   public.ph_line_shifts := app.ph_line_shift(p_line_shift);
  v_ko integer;
begin
  perform app.ph_authorize_line(ls.farm_id, 'labour.record', ls.line_id);
  perform app.ph_open_line_shift_guard(ls);
  if jsonb_typeof(p_items) <> 'object' or (select count(*) from jsonb_each(p_items)) = 0 then
    raise exception 'Answer the readiness items' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.readiness.empty')::text;
  end if;
  select count(*) into v_ko from jsonb_each_text(p_items) e where e.value not in ('ok', 'yes', 'true');
  update public.ph_line_shifts set readiness = p_items || jsonb_build_object('_note', p_note), readiness_by = app.current_user_id(), readiness_at = now()
   where id = ls.id;
  if v_ko > 0 then
    perform public.ph_report_issue(jsonb_build_object('line_shift_id', ls.id, 'kind', 'readiness',
      'description', coalesce(nullif(trim(p_note), ''), v_ko || ' readiness item(s) not ready')));
  end if;
  return jsonb_build_object('id', ls.id, 'not_ready', v_ko);
end;
$$;

-- =============================================================================================
-- 8. Labour intervals and teams
-- =============================================================================================
create function app.ph_check_task_kind(p_farm uuid, p_kind uuid) returns public.ph_task_kinds
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare k public.ph_task_kinds;
begin
  if not app.ph_approved('ph_task_kinds', p_kind, p_farm) then
    raise exception 'Task not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'task')::text;
  end if;
  select * into k from public.ph_task_kinds where id = p_kind;
  return k;
end;
$$;

create function app.ph_check_worker(p_farm uuid, p_worker uuid) returns void
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
begin
  if not exists (select 1 from public.workers where id = p_worker and farm_id = p_farm and voided_at is null and is_active) then
    raise exception 'Worker not found or not active' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.worker.notFound')::text;
  end if;
end;
$$;

-- Start one or several workers on a task (bulk roster entry). Overlap with another interval of the same worker is refused.
create function public.ph_labour_start(p_line_shift uuid, p_workers uuid[], p_task_kind uuid, p_started_at text default null,
                                       p_job_card uuid default null, p_order_line uuid default null, p_team_session uuid default null,
                                       p_request_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_labour_start');
  ls     public.ph_line_shifts := app.ph_line_shift(p_line_shift);
  k      public.ph_task_kinds;
  tm     public.ph_team_sessions;
  v_at   timestamptz := app.ph_event_time(p_started_at);
  w      uuid;
  v_ids  uuid[] := '{}';
  v_id   uuid;
begin
  if v_seen is not null then return v_seen; end if;
  perform app.ph_authorize_line(ls.farm_id, 'labour.record', ls.line_id);
  perform app.ph_open_line_shift_guard(ls);
  if p_team_session is null then
    k := app.ph_check_task_kind(ls.farm_id, p_task_kind);
  end if;
  if coalesce(cardinality(p_workers), 0) = 0 then
    raise exception 'Choose at least one worker' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.labour.noWorker')::text;
  end if;
  if p_team_session is not null then
    select * into tm from public.ph_team_sessions where id = p_team_session and line_shift_id = ls.id and voided_at is null;
    if not found or tm.ended_at is not null then
      raise exception 'Team session not open on this line' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.team.notOpen')::text;
    end if;
    if v_at < tm.started_at then
      raise exception 'A member cannot join before the team started' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.team.beforeStart')::text;
    end if;
    k := app.ph_check_task_kind(ls.farm_id, tm.task_kind_id);
  elsif k.is_shared then
    raise exception 'Shared work is recorded as a team (start a team session)' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.labour.sharedNeedsTeam')::text;
  end if;
  foreach w in array p_workers loop
    perform app.ph_check_worker(ls.farm_id, w);
    v_id := gen_random_uuid();
    begin
      insert into public.ph_labour_intervals (id, farm_id, line_shift_id, worker_id, task_kind_id, team_session_id, job_card_id, order_line_id, started_at)
      values (v_id, ls.farm_id, ls.id, w, k.id, p_team_session, coalesce(p_job_card, tm.job_card_id), coalesce(p_order_line, tm.order_line_id), v_at);
    exception when exclusion_violation then
      raise exception 'Worker % is already working at that time (end the other task first)',
        (select code from public.workers where id = w) using errcode = 'P0409',
        detail = jsonb_build_object('key', 'po.labour.overlap', 'worker', (select code from public.workers where id = w))::text;
    end;
    v_ids := v_ids || v_id;
  end loop;
  return app.ph_request_done(p_request_id, 'ph_labour_start', ls.farm_id, jsonb_build_object('ids', to_jsonb(v_ids), 'started_at', v_at));
end;
$$;

create function public.ph_labour_end(p_interval uuid, p_ended_at text default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  li   public.ph_labour_intervals;
  ls   public.ph_line_shifts;
  v_at timestamptz := app.ph_event_time(p_ended_at);
begin
  select * into li from public.ph_labour_intervals where id = p_interval and voided_at is null for update;
  if not found then raise exception 'Labour record not found' using errcode = 'P0404'; end if;
  ls := app.ph_line_shift(li.line_shift_id);
  perform app.ph_authorize_line(ls.farm_id, 'labour.record', ls.line_id);
  perform app.ph_open_line_shift_guard(ls);
  if li.ended_at is not null then
    return jsonb_build_object('id', li.id, 'ended_at', li.ended_at, 'repeated', true);
  end if;
  if v_at <= li.started_at then
    raise exception 'The end must be after the start' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.labour.endBeforeStart')::text;
  end if;
  update public.ph_labour_intervals set ended_at = v_at, end_reason = nullif(trim(p_reason), '') where id = li.id;
  return jsonb_build_object('id', li.id, 'ended_at', v_at);
end;
$$;

-- Move a worker to another task or line in one step (ends the open interval, starts the new one at the same instant).
create function public.ph_labour_move(p_interval uuid, p_to_line_shift uuid, p_task_kind uuid, p_at text default null,
                                      p_order_line uuid default null, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_labour_move');
  li     public.ph_labour_intervals;
  v_at   timestamptz := app.ph_event_time(p_at);
  v_new  jsonb;
begin
  if v_seen is not null then return v_seen; end if;
  select * into li from public.ph_labour_intervals where id = p_interval and voided_at is null;
  if not found then raise exception 'Labour record not found' using errcode = 'P0404'; end if;
  perform public.ph_labour_end(p_interval, v_at::text, 'moved');
  v_new := public.ph_labour_start(p_to_line_shift, array[li.worker_id], p_task_kind, v_at::text, null, p_order_line, null, null);
  return app.ph_request_done(p_request_id, 'ph_labour_move', li.farm_id, jsonb_build_object('ended', li.id, 'started', v_new -> 'ids' -> 0));
end;
$$;

create function public.ph_team_start(p_line_shift uuid, p_task_kind uuid, p_workers uuid[], p_started_at text default null,
                                     p_label text default null, p_order_line uuid default null, p_job_card uuid default null,
                                     p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_team_start');
  ls     public.ph_line_shifts := app.ph_line_shift(p_line_shift);
  k      public.ph_task_kinds;
  v_at   timestamptz := app.ph_event_time(p_started_at);
  v_id   uuid := gen_random_uuid();
begin
  if v_seen is not null then return v_seen; end if;
  perform app.ph_authorize_line(ls.farm_id, 'labour.record', ls.line_id);
  perform app.ph_open_line_shift_guard(ls);
  k := app.ph_check_task_kind(ls.farm_id, p_task_kind);
  if not k.is_shared then
    raise exception 'This task is not shared work' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.team.notShared')::text;
  end if;
  if coalesce(cardinality(p_workers), 0) < 2 then
    raise exception 'A team has at least two workers' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.team.tooSmall')::text;
  end if;
  insert into public.ph_team_sessions (id, farm_id, line_shift_id, task_kind_id, label, job_card_id, order_line_id, started_at)
  values (v_id, ls.farm_id, ls.id, k.id, nullif(trim(p_label), ''), p_job_card, p_order_line, v_at);
  perform public.ph_labour_start(ls.id, p_workers, k.id, v_at::text, p_job_card, p_order_line, v_id, null);
  return app.ph_request_done(p_request_id, 'ph_team_start', ls.farm_id, jsonb_build_object('id', v_id, 'started_at', v_at));
end;
$$;

-- A member leaves (ph_labour_end) or joins (ph_labour_start with the team). Before a membership change the supervisor records
-- the team output for the period that ends (S-04 LS §5); ph_record_output refuses a period across a change.
create function public.ph_team_end(p_team uuid, p_ended_at text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  tm   public.ph_team_sessions;
  ls   public.ph_line_shifts;
  v_at timestamptz := app.ph_event_time(p_ended_at);
begin
  select * into tm from public.ph_team_sessions where id = p_team and voided_at is null for update;
  if not found then raise exception 'Team session not found' using errcode = 'P0404'; end if;
  ls := app.ph_line_shift(tm.line_shift_id);
  perform app.ph_authorize_line(ls.farm_id, 'labour.record', ls.line_id);
  if tm.ended_at is not null then return jsonb_build_object('id', tm.id, 'repeated', true); end if;
  update public.ph_labour_intervals set ended_at = v_at, end_reason = 'team ended'
   where team_session_id = tm.id and ended_at is null and voided_at is null and started_at < v_at;
  update public.ph_team_sessions set ended_at = v_at where id = tm.id;
  return jsonb_build_object('id', tm.id, 'ended_at', v_at);
end;
$$;

-- =============================================================================================
-- 9. Output, first-pack check, corrections
-- =============================================================================================
create function public.ph_record_output(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen    jsonb := app.ph_request_seen(p_request_id, 'ph_record_output');
  ls        public.ph_line_shifts := app.ph_line_shift((p ->> 'line_shift_id')::uuid);
  pf        public.ph_pack_formats;
  tm        public.ph_team_sessions;
  v_end     timestamptz := app.ph_event_time(p ->> 'period_end');
  v_start   timestamptz := nullif(p ->> 'period_start', '')::timestamptz;
  v_id      uuid := gen_random_uuid();
  v_members integer;
  v_changes integer;
  v_net     numeric;
  v_check   boolean;
  v_basis   text;
begin
  if v_seen is not null then return v_seen; end if;
  v_basis := app.ph_authorize_line(ls.farm_id, 'labour.record', ls.line_id);
  perform app.ph_open_line_shift_guard(ls);
  if (p ->> 'grade') is null or (p ->> 'grade') not in ('premium', 'gr1', 'gr2') then
    raise exception 'Choose the grade' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.output.grade')::text;
  end if;
  if coalesce((p ->> 'boxes')::int, 0) <= 0 then
    raise exception 'Box count must be above zero' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.output.boxes')::text;
  end if;
  if not app.ph_approved('ph_pack_formats', (p ->> 'pack_format_id')::uuid, ls.farm_id) then
    raise exception 'Pack format not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'pack format')::text;
  end if;
  select * into pf from public.ph_pack_formats where id = (p ->> 'pack_format_id')::uuid;
  v_net := coalesce(nullif(p ->> 'net_kg_per_box', '')::numeric, pf.nominal_net_kg);
  if v_net <= 0 then
    raise exception 'Net kg per box must be above zero' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.output.net')::text;
  end if;

  if (p ->> 'team_session_id') is not null then
    select * into tm from public.ph_team_sessions where id = (p ->> 'team_session_id')::uuid and line_shift_id = ls.id and voided_at is null;
    if not found then raise exception 'Team session not found on this line' using errcode = 'P0404'; end if;
    -- Each grade and pack is counted separately for the same period (S-04 p.3: Grade 1 and Grade 2 boxes separately).
    v_start := coalesce(v_start, (select max(period_end) from public.ph_output_entries
                                   where team_session_id = tm.id and voided_at is null and grade = p ->> 'grade' and pack_format_id = pf.id),
                        tm.started_at);
    if v_end <= v_start then
      raise exception 'The period end must be after its start' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.output.period')::text;
    end if;
    if exists (select 1 from public.ph_output_entries where team_session_id = tm.id and voided_at is null
                and grade = p ->> 'grade' and pack_format_id = pf.id
                and tstzrange(period_start, period_end) && tstzrange(v_start, v_end)) then
      raise exception 'Team output already recorded for part of this period' using errcode = 'P0409',
        detail = jsonb_build_object('key', 'po.output.periodOverlap')::text;
    end if;
    -- Members who cover the whole period, and any change of membership inside it.
    select count(*) filter (where started_at <= v_start and coalesce(ended_at, 'infinity') >= v_end),
           count(*) filter (where (started_at > v_start and started_at < v_end) or (ended_at > v_start and ended_at < v_end))
      into v_members, v_changes
      from public.ph_labour_intervals where team_session_id = tm.id and voided_at is null;
    if v_changes > 0 then
      raise exception 'Team membership changed inside this period: record the count up to the change first'
        using errcode = 'P0422', detail = jsonb_build_object('key', 'po.output.membershipChanged')::text;
    end if;
    if v_members = 0 then
      raise exception 'No team member covers this period' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.output.noMembers')::text;
    end if;
  else
    perform app.ph_check_worker(ls.farm_id, (p ->> 'worker_id')::uuid);
  end if;

  insert into public.ph_output_entries (id, farm_id, line_shift_id, worker_id, team_session_id, job_card_id, order_line_id, grade,
                                        pack_format_id, net_kg_per_box, boxes, conforming, period_start, period_end, note)
  values (v_id, ls.farm_id, ls.id, case when tm.id is null then (p ->> 'worker_id')::uuid end, tm.id,
          coalesce((p ->> 'job_card_id')::uuid, tm.job_card_id), coalesce((p ->> 'order_line_id')::uuid, tm.order_line_id),
          p ->> 'grade', pf.id, v_net, (p ->> 'boxes')::int, coalesce((p ->> 'conforming')::boolean, true),
          case when tm.id is not null then v_start else v_start end, v_end, nullif(trim(p ->> 'note'), ''));

  v_check := exists (select 1 from public.ph_first_pack_checks c where c.line_shift_id = ls.id and c.pack_format_id = pf.id
                       and c.voided_at is null and c.order_line_id is not distinct from coalesce((p ->> 'order_line_id')::uuid, tm.order_line_id));
  return app.ph_request_done(p_request_id, 'ph_record_output', ls.farm_id,
    jsonb_build_object('id', v_id, 'kg', (p ->> 'boxes')::int * v_net, 'first_pack_checked', v_check, 'members', v_members,
                       'recorded_at', now(), 'basis', v_basis));
end;
$$;

create function public.ph_first_pack_check(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_first_pack_check');
  ls     public.ph_line_shifts := app.ph_line_shift((p ->> 'line_shift_id')::uuid);
  pf     public.ph_pack_formats;
  v_id   uuid := gen_random_uuid();
  v_tgt  numeric;
begin
  if v_seen is not null then return v_seen; end if;
  perform app.ph_authorize_line(ls.farm_id, 'labour.record', ls.line_id);
  perform app.ph_open_line_shift_guard(ls);
  if not app.ph_approved('ph_pack_formats', (p ->> 'pack_format_id')::uuid, ls.farm_id) then
    raise exception 'Pack format not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'pack format')::text;
  end if;
  select * into pf from public.ph_pack_formats where id = (p ->> 'pack_format_id')::uuid;
  v_tgt := coalesce(nullif(p ->> 'target_net_kg', '')::numeric, pf.nominal_net_kg);
  if coalesce(nullif(p ->> 'measured_kg', '')::numeric, 0) <= 0 then
    raise exception 'Enter the measured weight' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.firstPack.weight')::text;
  end if;
  insert into public.ph_first_pack_checks (id, farm_id, line_shift_id, pack_format_id, order_line_id, job_card_id, target_net_kg, measured_kg,
                                           scale_id, machine_setting_ok, note)
  values (v_id, ls.farm_id, ls.id, pf.id, (p ->> 'order_line_id')::uuid, (p ->> 'job_card_id')::uuid, v_tgt, (p ->> 'measured_kg')::numeric,
          (p ->> 'scale_id')::uuid, (p ->> 'machine_setting_ok')::boolean, nullif(trim(p ->> 'note'), ''));
  if (p ->> 'measured_kg')::numeric < v_tgt then
    perform public.ph_report_issue(jsonb_build_object('line_shift_id', ls.id, 'kind', 'weight_discrepancy',
      'description', format('First pack %s: %s kg measured, %s kg target', pf.code, p ->> 'measured_kg', v_tgt)));
  end if;
  return app.ph_request_done(p_request_id, 'ph_first_pack_check', ls.farm_id,
    jsonb_build_object('id', v_id, 'under_target', (p ->> 'measured_kg')::numeric < v_tgt));
end;
$$;

-- Correct an output record: boxes, net kg per box, grade, conforming. Version checked (conflicting edits), reason required,
-- before / after kept by the audit trigger. After submission only labour.correct may change it.
create function public.ph_correct_output(p_id uuid, p_version integer, p jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  o   public.ph_output_entries;
  ls  public.ph_line_shifts;
begin
  select * into o from public.ph_output_entries where id = p_id and voided_at is null for update;
  if not found then raise exception 'Output record not found' using errcode = 'P0404'; end if;
  ls := app.ph_line_shift(o.line_shift_id);
  if ls.submitted_at is null and app.ph_can(ls.farm_id, 'labour.record', ls.line_id) then
    perform app.ph_authorize_line(ls.farm_id, 'labour.record', ls.line_id);
  else
    perform app.ph_authorize_line(ls.farm_id, 'labour.correct', ls.line_id);
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A correction needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text;
  end if;
  if o.version <> p_version then
    raise exception 'Record was changed by someone else (expected version %, current %)', p_version, o.version
      using errcode = 'P0409', detail = jsonb_build_object('key', 'po.conflict', 'current', o.version)::text;
  end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('boxes', 'net_kg_per_box', 'grade', 'conforming', 'note')) then
    raise exception 'Only boxes, net kg per box, grade, conforming and note can be corrected' using errcode = 'P0422';
  end if;
  perform set_config('app.audit_comment', p_reason, true);
  update public.ph_output_entries
     set boxes = coalesce((p ->> 'boxes')::int, boxes), net_kg_per_box = coalesce((p ->> 'net_kg_per_box')::numeric, net_kg_per_box),
         grade = coalesce(p ->> 'grade', grade), conforming = coalesce((p ->> 'conforming')::boolean, conforming),
         note = coalesce(p ->> 'note', note), correction_reason = p_reason, version = p_version
   where id = p_id;
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('id', p_id, 'version', p_version + 1);
end;
$$;

create function public.ph_void_labour_record(p_table text, p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_ls uuid;
  ls   public.ph_line_shifts;
begin
  if p_table not in ('ph_output_entries', 'ph_labour_intervals', 'ph_first_pack_checks') then
    raise exception 'Not a labour record' using errcode = 'P0422';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Voiding needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text;
  end if;
  execute format('select line_shift_id from public.%I where id = $1 and voided_at is null', p_table) into v_ls using p_id;
  if v_ls is null then raise exception 'Record not found' using errcode = 'P0404'; end if;
  ls := app.ph_line_shift(v_ls);
  if ls.submitted_at is null and app.ph_can(ls.farm_id, 'labour.record', ls.line_id) then
    perform app.ph_authorize_line(ls.farm_id, 'labour.record', ls.line_id);
  else
    perform app.ph_authorize_line(ls.farm_id, 'labour.correct', ls.line_id);
  end if;
  perform set_config('app.in_void', 'on', true);
  execute format('update public.%I set voided_at = now(), voided_by = $2, void_reason = $3 where id = $1', p_table)
    using p_id, app.current_user_id(), p_reason;
  perform set_config('app.in_void', 'off', true);
  return jsonb_build_object('id', p_id, 'voided', true);
end;
$$;

-- Labour sheet submission (S-04 LS §10): no open interval, box totals reconciled with full and partial pallets as counted.
create function public.ph_submit_line_shift(p_line_shift uuid, p_reconciliation jsonb default '{}', p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  ls      public.ph_line_shifts := app.ph_line_shift(p_line_shift);
  v_open  text[];
  v_boxes integer;
  v_kg    numeric;
begin
  perform app.ph_authorize_line(ls.farm_id, 'labour.submit', ls.line_id);
  if ls.submitted_at is not null then
    return jsonb_build_object('id', ls.id, 'submitted_at', ls.submitted_at, 'repeated', true);
  end if;
  select array_agg(w.code order by w.code) into v_open
    from public.ph_labour_intervals li join public.workers w on w.id = li.worker_id
   where li.line_shift_id = ls.id and li.voided_at is null and li.ended_at is null;
  if v_open is not null then
    raise exception 'End the open tasks first: %', array_to_string(v_open, ', ') using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.submit.open', 'workers', v_open)::text;
  end if;
  select coalesce(sum(boxes), 0), coalesce(sum(kg) filter (where conforming), 0) into v_boxes, v_kg
    from public.ph_output_entries where line_shift_id = ls.id and voided_at is null;
  update public.ph_line_shifts
     set submitted_at = now(), submitted_by = app.current_user_id(), submission_note = nullif(trim(p_note), ''),
         box_reconciliation = coalesce(p_reconciliation, '{}') || jsonb_build_object('recorded_boxes', v_boxes)
   where id = ls.id;
  perform app.ph_notify_engineer_or_phm(ls.farm_id, ls.id, 'po_sheet_submitted', 'ph_line_shifts', ls.id,
    jsonb_build_object('line', (select code from public.ph_lines where id = ls.line_id), 'boxes', v_boxes));
  return jsonb_build_object('id', ls.id, 'boxes', v_boxes, 'conforming_kg', v_kg, 'zero', v_boxes = 0);
end;
$$;

create function public.ph_reopen_line_shift(p_line_shift uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare ls public.ph_line_shifts := app.ph_line_shift(p_line_shift);
begin
  perform app.ph_authorize_line(ls.farm_id, 'labour.correct', ls.line_id);
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Reopening needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text;
  end if;
  if ls.submitted_at is null then return jsonb_build_object('id', ls.id, 'open', true); end if;
  perform set_config('app.audit_comment', p_reason, true);
  update public.ph_line_shifts set submitted_at = null, submitted_by = null, reopened_reason = p_reason where id = ls.id;
  perform set_config('app.audit_comment', '', true);
  return jsonb_build_object('id', ls.id, 'reopened', true);
end;
$$;

create function public.ph_close_shift(p_shift uuid, p_handover text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  s        public.ph_shifts;
  v_open   text[];
begin
  select * into s from public.ph_shifts where id = p_shift and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Shift not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(s.farm_id, 'shift.manage');
  if s.closed_at is not null then return jsonb_build_object('id', s.id, 'repeated', true); end if;
  if coalesce(trim(p_handover), '') = '' then
    raise exception 'Write the handover (active orders, outstanding quantities, holds, stoppages)' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.shift.handover')::text;
  end if;
  select array_agg(l.code order by l.code) into v_open
    from public.ph_line_shifts ls join public.ph_lines l on l.id = ls.line_id
   where ls.shift_id = s.id and ls.voided_at is null and ls.submitted_at is null;
  update public.ph_shifts set closed_at = now(), closed_by = app.current_user_id(), handover_note = p_handover where id = s.id;
  perform app.ph_notify_role(s.farm_id, 'PHM', 'po_shift_closed', 'ph_shifts', s.id,
    jsonb_build_object('code', s.code, 'unsubmitted', coalesce(v_open, '{}')));
  return jsonb_build_object('id', s.id, 'closed', true, 'lines_without_submission', coalesce(v_open, '{}'));
end;
$$;

-- =============================================================================================
-- 10. Issues and the instruction chain (S-04 LS §1)
-- =============================================================================================
create function public.ph_report_issue(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen  jsonb := app.ph_request_seen(p_request_id, 'ph_report_issue');
  v_kind  text := p ->> 'kind';
  ls      public.ph_line_shifts;
  v_farm  uuid;
  v_line  uuid := (p ->> 'line_id')::uuid;
  v_id    uuid := gen_random_uuid();
  v_code  text;
  v_to    text;
  parent  public.ph_shift_issues;
  v_sup   uuid;
begin
  if v_seen is not null then return v_seen; end if;
  if (p ->> 'line_shift_id') is not null then
    ls := app.ph_line_shift((p ->> 'line_shift_id')::uuid);
    v_farm := ls.farm_id; v_line := ls.line_id;
  else
    v_farm := app.ph_farm_of_user();
  end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  if coalesce(trim(p ->> 'description'), '') = '' then
    raise exception 'Describe the issue' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.issue.description')::text;
  end if;
  if v_kind = 'qc_observation' then
    perform app.ph_authorize(v_farm, 'issue.qc_observation');
  elsif v_kind = 'instruction' then
    perform app.ph_authorize(v_farm, 'issue.instruct');
    if ls.id is null then
      raise exception 'An instruction goes to a line in a shift' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.issue.needsLine')::text;
    end if;
  elsif v_kind in ('fault', 'weight_discrepancy', 'packing_error', 'worker_issue', 'shortage', 'readiness', 'waste_collection', 'other') then
    perform app.ph_authorize(v_farm, 'issue.report');
  else
    raise exception 'Unknown issue kind' using errcode = 'P0422';
  end if;
  if (p ->> 'parent_id') is not null then
    select * into parent from public.ph_shift_issues where id = (p ->> 'parent_id')::uuid and farm_id = v_farm and voided_at is null;
    if not found then raise exception 'Issue not found' using errcode = 'P0404'; end if;
  end if;
  v_code := app.ph_code(v_farm, 'ISS', 4);
  if v_kind = 'instruction' then
    v_sup := ls.supervisor_user_id;
    insert into public.ph_shift_issues (id, farm_id, code, line_shift_id, line_id, kind, description, parent_id, routed_to, routed_role)
    values (v_id, v_farm, v_code, ls.id, v_line, v_kind, trim(p ->> 'description'), parent.id, v_sup, 'LL');
    if v_sup is not null then
      perform app.ph_notify_user(v_farm, v_sup, 'po_instruction', 'ph_shift_issues', v_id, jsonb_build_object('code', v_code));
    else
      perform app.ph_notify_role(v_farm, 'LL', 'po_instruction', 'ph_shift_issues', v_id, jsonb_build_object('code', v_code));
    end if;
    v_to := 'LL';
  else
    insert into public.ph_shift_issues (id, farm_id, code, line_shift_id, line_id, kind, description, parent_id, routed_to)
    values (v_id, v_farm, v_code, ls.id, v_line, v_kind, trim(p ->> 'description'), parent.id,
            case when ls.id is not null then app.ph_shift_engineer(ls.id) end);
    v_to := app.ph_notify_engineer_or_phm(v_farm, ls.id, 'po_issue', 'ph_shift_issues', v_id, jsonb_build_object('code', v_code, 'kind', v_kind));
    update public.ph_shift_issues set routed_role = v_to where id = v_id;
  end if;
  return app.ph_request_done(p_request_id, 'ph_report_issue', v_farm, jsonb_build_object('id', v_id, 'code', v_code, 'routed_to', v_to));
end;
$$;

create function public.ph_issue_step(p_issue uuid, p_step text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare i public.ph_shift_issues;
begin
  select * into i from public.ph_shift_issues where id = p_issue and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Issue not found' using errcode = 'P0404'; end if;
  if p_step = 'acknowledge' then
    if i.kind = 'instruction' then
      perform app.ph_authorize_line(i.farm_id, 'labour.record', i.line_id);
    else
      perform app.ph_authorize(i.farm_id, 'issue.instruct');
    end if;
    if i.acknowledged_at is null then
      update public.ph_shift_issues set acknowledged_by = app.current_user_id(), acknowledged_at = now() where id = i.id;
    end if;
  elsif p_step = 'resolve' then
    perform app.ph_authorize(i.farm_id, 'issue.instruct');
    if coalesce(trim(p_note), '') = '' then
      raise exception 'Write how it was resolved' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text;
    end if;
    update public.ph_shift_issues set resolved_by = app.current_user_id(), resolved_at = now(), resolution = p_note,
           acknowledged_by = coalesce(acknowledged_by, app.current_user_id()), acknowledged_at = coalesce(acknowledged_at, now())
     where id = i.id and resolved_at is null;
  else
    raise exception 'Unknown step' using errcode = 'P0422';
  end if;
  return jsonb_build_object('id', i.id, 'step', p_step);
end;
$$;

-- =============================================================================================
-- 11. Downtime
-- =============================================================================================
create function public.ph_report_stop(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen   jsonb := app.ph_request_seen(p_request_id, 'ph_report_stop');
  v_farm   uuid := app.ph_farm_of_user();
  v_lines  uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'line_ids', '[]'))::uuid);
  v_at     timestamptz := app.ph_event_time(p ->> 'stopped_at');
  v_id     uuid := gen_random_uuid();
  v_code   text;
  l        uuid;
  v_shift  uuid;
begin
  if v_seen is not null then return v_seen; end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  if cardinality(v_lines) = 0 then
    raise exception 'Choose the stopped line(s)' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.stop.lines')::text;
  end if;
  foreach l in array v_lines loop
    if not exists (select 1 from public.ph_lines where id = l and farm_id = v_farm and voided_at is null) then
      raise exception 'Line not found' using errcode = 'P0404';
    end if;
    perform app.ph_authorize_line(v_farm, 'downtime.report', l);
  end loop;
  if coalesce(trim(p ->> 'observed_fault'), '') = '' then
    raise exception 'Describe the observed fault' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.stop.fault')::text;
  end if;
  select ls.shift_id into v_shift from public.ph_line_shifts ls join public.ph_shifts s on s.id = ls.shift_id
   where ls.line_id = v_lines[1] and ls.voided_at is null and s.planned_start <= v_at and s.planned_end > v_at limit 1;
  v_code := app.ph_code(v_farm, 'DT', 3, v_at);
  insert into public.ph_downtime_events (id, farm_id, code, shift_id, equipment_id, equipment_text, job_card_id, order_line_id, stopped_at, observed_fault)
  values (v_id, v_farm, v_code, coalesce((p ->> 'shift_id')::uuid, v_shift), (p ->> 'equipment_id')::uuid, nullif(trim(p ->> 'equipment_text'), ''),
          (p ->> 'job_card_id')::uuid, (p ->> 'order_line_id')::uuid, v_at, trim(p ->> 'observed_fault'));
  insert into public.ph_downtime_lines (farm_id, event_id, line_id) select v_farm, v_id, x from unnest(v_lines) x;
  -- S-04 PE §8: notify the Packhouse Managers at once so they can call Maintenance.
  perform app.ph_notify_role(v_farm, 'PHM', 'po_stop', 'ph_downtime_events', v_id, jsonb_build_object('code', v_code));
  perform app.ph_notify_role(v_farm, 'MNT', 'po_stop', 'ph_downtime_events', v_id, jsonb_build_object('code', v_code));
  return app.ph_request_done(p_request_id, 'ph_report_stop', v_farm, jsonb_build_object('id', v_id, 'code', v_code, 'stopped_at', v_at));
end;
$$;

create function public.ph_stop_step(p_event uuid, p_step text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  e      public.ph_downtime_events;
  l      uuid;
  v_at   timestamptz;
begin
  select * into e from public.ph_downtime_events where id = p_event and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Stop not found' using errcode = 'P0404'; end if;
  for l in select line_id from public.ph_downtime_lines where event_id = e.id and voided_at is null loop
    perform app.ph_authorize_line(e.farm_id, case p_step when 'release' then 'downtime.technical_release' else 'downtime.manage' end, l);
  end loop;
  if p_step = 'restart' then
    v_at := app.ph_event_time(p ->> 'restarted_at');
    if e.restarted_at is not null then return jsonb_build_object('id', e.id, 'restarted_at', e.restarted_at, 'repeated', true); end if;
    if v_at <= e.stopped_at then
      raise exception 'Restart must be after the stop' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.stop.restartBeforeStop')::text;
    end if;
    update public.ph_downtime_events set restarted_at = v_at, restarted_by = app.current_user_id() where id = e.id;
    return jsonb_build_object('id', e.id, 'restarted_at', v_at, 'minutes', round(extract(epoch from v_at - e.stopped_at) / 60.0, 1));
  elsif p_step = 'cause' then
    if not app.ph_approved('ph_downtime_causes', (p ->> 'cause_id')::uuid, e.farm_id) then
      raise exception 'Cause not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'cause')::text;
    end if;
    update public.ph_downtime_events set cause_id = (p ->> 'cause_id')::uuid, cause_note = nullif(trim(p ->> 'note'), ''),
           cause_confirmed_by = app.current_user_id(), cause_confirmed_at = now(),
           responsible_text = coalesce(nullif(trim(p ->> 'responsible'), ''), responsible_text),
           work_order_ref = coalesce(nullif(trim(p ->> 'work_order_ref'), ''), work_order_ref)
     where id = e.id;
    return jsonb_build_object('id', e.id, 'cause_id', p ->> 'cause_id');
  elsif p_step = 'response' then
    update public.ph_downtime_events set response_at = coalesce(response_at, app.ph_event_time(p ->> 'at')),
           work_order_ref = coalesce(nullif(trim(p ->> 'work_order_ref'), ''), work_order_ref) where id = e.id;
    return jsonb_build_object('id', e.id, 'response', true);
  elsif p_step = 'release' then
    if e.technical_release_at is null then
      update public.ph_downtime_events set technical_release_by = app.current_user_id(), technical_release_at = now() where id = e.id;
    end if;
    return jsonb_build_object('id', e.id, 'released', true);
  end if;
  raise exception 'Unknown step' using errcode = 'P0422';
end;
$$;

-- =============================================================================================
-- 12. Order time plan and execution (KPI 3)
-- =============================================================================================
create function public.ph_record_order_plan(p_order_line uuid, p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen  jsonb := app.ph_request_seen(p_request_id, 'ph_record_order_plan');
  o       public.ph_order_lines := app.ph_order_line(p_order_line::text);
  v_ver   integer;
  v_id    uuid := gen_random_uuid();
  v_after boolean;
  prev    public.ph_order_plans;
begin
  if v_seen is not null then return v_seen; end if;
  perform app.ph_authorize(o.farm_id, 'order_timing.plan');
  if o.status not in ('accepted', 'pending_acceptance') then
    raise exception 'Only an open order line can be planned' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.plan.closed')::text;
  end if;
  if coalesce((p ->> 'planned_duration_min')::int, 0) <= 0 then
    raise exception 'Planned duration (minutes) must be above zero' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.plan.duration')::text;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('order_plan:' || o.id::text, 0));
  select coalesce(max(version_no), 0) + 1 into v_ver from public.ph_order_plans where order_line_id = o.id and voided_at is null;
  if v_ver > 1 and coalesce(trim(p ->> 'reason'), '') = '' then
    raise exception 'A plan revision needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.plan.reason')::text;
  end if;
  v_after := exists (select 1 from public.ph_order_execution where order_line_id = o.id and voided_at is null);
  -- A revision keeps what it does not change (start, promised loading, line) from the previous version.
  select * into prev from public.ph_order_plans where order_line_id = o.id and version_no = v_ver - 1 and voided_at is null;
  insert into public.ph_order_plans (id, farm_id, order_line_id, version_no, planned_duration_min, planned_start_at, promised_loading_at,
                                     line_id, reason, recorded_after_start)
  values (v_id, o.farm_id, o.id, v_ver, (p ->> 'planned_duration_min')::int,
          case when p ? 'planned_start_at' then nullif(p ->> 'planned_start_at', '')::timestamptz else prev.planned_start_at end,
          case when p ? 'promised_loading_at' then nullif(p ->> 'promised_loading_at', '')::timestamptz else prev.promised_loading_at end,
          case when p ? 'line_id' then nullif(p ->> 'line_id', '')::uuid else prev.line_id end, nullif(trim(p ->> 'reason'), ''),
          v_ver = 1 and v_after);
  return app.ph_request_done(p_request_id, 'ph_record_order_plan', o.farm_id,
    jsonb_build_object('id', v_id, 'version_no', v_ver, 'recorded_after_start', v_ver = 1 and v_after));
end;
$$;

create function public.ph_order_step(p_order_line uuid, p_step text, p_at text default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  o     public.ph_order_lines := app.ph_order_line(p_order_line::text);
  x     public.ph_order_execution;
  v_at  timestamptz := app.ph_event_time(p_at);
  v_line uuid := (select line_id from public.ph_order_plans where order_line_id = o.id and voided_at is null order by version_no desc limit 1);
  v_base integer;
begin
  perform app.ph_authorize_line(o.farm_id, 'order_timing.record', v_line);
  select * into x from public.ph_order_execution where order_line_id = o.id and voided_at is null for update;
  if p_step = 'start' then
    if found then return jsonb_build_object('id', x.id, 'started_at', x.started_at, 'repeated', true); end if;
    if o.status <> 'accepted' then
      raise exception 'Only an accepted order line can start' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.order.notAccepted')::text;
    end if;
    insert into public.ph_order_execution (farm_id, order_line_id, started_at, started_by) values (o.farm_id, o.id, v_at, app.current_user_id())
    returning * into x;
    return jsonb_build_object('id', x.id, 'started_at', v_at,
      'baseline_missing', not exists (select 1 from public.ph_order_plans where order_line_id = o.id and voided_at is null));
  elsif p_step = 'complete' then
    if not found then
      raise exception 'The order has not started' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.order.notStarted')::text;
    end if;
    if x.completed_at is not null then return jsonb_build_object('id', x.id, 'completed_at', x.completed_at, 'repeated', true); end if;
    if v_at <= x.started_at then
      raise exception 'Completion must be after the start' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.order.completeBeforeStart')::text;
    end if;
    select planned_duration_min into v_base from public.ph_order_plans where order_line_id = o.id and version_no = 1 and voided_at is null;
    if v_base is not null and extract(epoch from v_at - x.started_at) / 60.0 > v_base and coalesce(trim(p_reason), '') = '' then
      raise exception 'The order ran over its planned time: record the reason (S-04 p.3)' using errcode = 'P0422',
        detail = jsonb_build_object('key', 'po.order.overrunReason',
                                    'variance', round(extract(epoch from v_at - x.started_at) / 60.0 - v_base, 1))::text;
    end if;
    update public.ph_order_execution set completed_at = v_at, completed_by = app.current_user_id(), overrun_reason = nullif(trim(p_reason), '')
     where id = x.id;
    return jsonb_build_object('id', x.id, 'completed_at', v_at,
      'actual_min', round(extract(epoch from v_at - x.started_at) / 60.0, 1),
      'variance_min', case when v_base is not null then round(extract(epoch from v_at - x.started_at) / 60.0 - v_base, 1) end);
  end if;
  raise exception 'Unknown step' using errcode = 'P0422';
end;
$$;

-- =============================================================================================
-- 13. Packaging readiness
-- =============================================================================================
create function public.ph_packaging_move(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_packaging_move');
  v_farm uuid := app.ph_farm_of_user();
  v_id   uuid := gen_random_uuid();
begin
  if v_seen is not null then return v_seen; end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  perform app.ph_authorize(v_farm, 'packaging.readiness');
  if (p ->> 'kind') not in ('requested', 'received', 'issued', 'returned') then
    raise exception 'Unknown packaging movement' using errcode = 'P0422';
  end if;
  if not app.ph_approved('ph_packaging_items', (p ->> 'item_id')::uuid, v_farm) then
    raise exception 'Packaging item not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'packaging')::text;
  end if;
  if coalesce((p ->> 'quantity')::numeric, 0) <= 0 then
    raise exception 'Quantity must be above zero' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v02')::text;
  end if;
  insert into public.ph_packaging_moves (id, farm_id, item_id, kind, quantity, order_line_id, line_id, needed_by, note)
  values (v_id, v_farm, (p ->> 'item_id')::uuid, p ->> 'kind', (p ->> 'quantity')::numeric, nullif(p ->> 'order_line_id', '')::uuid,
          nullif(p ->> 'line_id', '')::uuid, nullif(p ->> 'needed_by', '')::timestamptz, nullif(trim(p ->> 'note'), ''));
  return app.ph_request_done(p_request_id, 'ph_packaging_move', v_farm, jsonb_build_object('id', v_id));
end;
$$;

create view public.ph_packaging_readiness with (security_invoker = true) as
  select m.farm_id, m.order_line_id, m.item_id, i.code as item_code, i.name_ar, i.name_en, i.unit_code,
         sum(m.quantity) filter (where m.kind = 'requested') as requested,
         sum(m.quantity) filter (where m.kind = 'received') as received,
         sum(m.quantity) filter (where m.kind = 'issued') as issued,
         sum(m.quantity) filter (where m.kind = 'returned') as returned,
         greatest(coalesce(sum(m.quantity) filter (where m.kind = 'requested'), 0)
                  - coalesce(sum(m.quantity) filter (where m.kind = 'received'), 0), 0) as short,
         min(m.needed_by) as needed_by
    from public.ph_packaging_moves m join public.ph_packaging_items i on i.id = m.item_id
   where m.voided_at is null
   group by m.farm_id, m.order_line_id, m.item_id, i.code, i.name_ar, i.name_en, i.unit_code;

-- =============================================================================================
-- 14. KPIs (S-04 p.3). Windows are [from, to); open items count to the cutoff = min(to, now()).
-- =============================================================================================
create function app.po_minutes(p_start timestamptz, p_end timestamptz, p_from timestamptz, p_to timestamptz) returns numeric
language sql immutable as $$
  select greatest(0, extract(epoch from (least(coalesce(p_end, p_to), p_to) - greatest(p_start, p_from))) / 60.0)
$$;

-- Packing time and kg per worker (individual output + allocated team share). Only rows on lines where the caller may see
-- people (labour.view_people) are returned; line-level totals without names come from ph_kpi_line_productivity.
create function public.ph_kpi_productivity(p_from timestamptz, p_to timestamptz, p_line uuid default null)
returns table (worker_id uuid, worker_code text, worker_name text, kg_individual numeric, kg_team_allocated numeric, kg_total numeric,
               packing_hours numeric, kg_per_hour numeric, includes_allocation boolean)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with farm as (select app.ph_farm_of_user() as id),
  cut as (select least(p_to, now()) as t),
  visible_ls as (
    select ls.id, ls.line_id from public.ph_line_shifts ls, farm
     where ls.farm_id = farm.id and ls.voided_at is null and (p_line is null or ls.line_id = p_line)
       and app.ph_can(ls.farm_id, 'labour.view_people', ls.line_id)
  ),
  hours as (
    select li.worker_id, sum(app.po_minutes(li.started_at, li.ended_at, p_from, (select t from cut))) / 60.0 as h
      from public.ph_labour_intervals li
      join visible_ls v on v.id = li.line_shift_id
      join public.ph_task_kinds k on k.id = li.task_kind_id and k.counts_as_packing
     where li.voided_at is null and li.started_at < (select t from cut) and coalesce(li.ended_at, 'infinity') > p_from
     group by li.worker_id
  ),
  ind as (
    select o.worker_id, sum(o.kg) as kg from public.ph_output_entries o join visible_ls v on v.id = o.line_shift_id
     where o.voided_at is null and o.conforming and o.worker_id is not null and o.period_end >= p_from and o.period_end < p_to
     group by o.worker_id
  ),
  team_entries as (
    select o.id, o.team_session_id, o.kg, o.period_start, o.period_end from public.ph_output_entries o join visible_ls v on v.id = o.line_shift_id
     where o.voided_at is null and o.conforming and o.team_session_id is not null and o.period_end >= p_from and o.period_end < p_to
  ),
  members as (
    select te.id as entry_id, li.worker_id, te.kg,
           count(*) over (partition by te.id) as n
      from team_entries te join public.ph_labour_intervals li on li.team_session_id = te.team_session_id and li.voided_at is null
     where li.started_at <= te.period_start and coalesce(li.ended_at, 'infinity') >= te.period_end
  ),
  alloc as (select worker_id, sum(kg / n) as kg from members group by worker_id),
  ids as (select worker_id from hours union select worker_id from ind union select worker_id from alloc)
  select w.id, w.code, w.full_name,
         round(coalesce(ind.kg, 0), 3), round(coalesce(alloc.kg, 0), 3), round(coalesce(ind.kg, 0) + coalesce(alloc.kg, 0), 3),
         round(coalesce(hours.h, 0), 3),
         case when coalesce(hours.h, 0) > 0 then round((coalesce(ind.kg, 0) + coalesce(alloc.kg, 0)) / hours.h, 2) end,
         alloc.kg is not null
    from ids join public.workers w on w.id = ids.worker_id
    left join hours on hours.worker_id = ids.worker_id
    left join ind on ind.worker_id = ids.worker_id
    left join alloc on alloc.worker_id = ids.worker_id
   order by w.code
$$;

-- Team productivity (S-04 p.3 shared production): team kg ÷ total worker-hours on the team task.
create function public.ph_kpi_team(p_from timestamptz, p_to timestamptz, p_line uuid default null)
returns table (team_session_id uuid, line_id uuid, label text, task_code text, kg numeric, worker_hours numeric, kg_per_worker_hour numeric,
               periods integer)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with cut as (select least(p_to, now()) as t)
  select tm.id, ls.line_id, tm.label, k.code,
         round(coalesce((select sum(o.kg) from public.ph_output_entries o where o.team_session_id = tm.id and o.voided_at is null and o.conforming
                           and o.period_end >= p_from and o.period_end < p_to), 0), 3),
         round(coalesce((select sum(app.po_minutes(li.started_at, li.ended_at, p_from, (select t from cut))) / 60.0
                           from public.ph_labour_intervals li where li.team_session_id = tm.id and li.voided_at is null), 0), 3),
         case when coalesce((select sum(app.po_minutes(li.started_at, li.ended_at, p_from, (select t from cut)))
                               from public.ph_labour_intervals li where li.team_session_id = tm.id and li.voided_at is null), 0) > 0
              then round((select coalesce(sum(o.kg), 0) from public.ph_output_entries o where o.team_session_id = tm.id and o.voided_at is null
                            and o.conforming and o.period_end >= p_from and o.period_end < p_to)
                         / ((select sum(app.po_minutes(li.started_at, li.ended_at, p_from, (select t from cut))) / 60.0
                               from public.ph_labour_intervals li where li.team_session_id = tm.id and li.voided_at is null)), 2) end,
         (select count(*)::int from public.ph_output_entries o where o.team_session_id = tm.id and o.voided_at is null)
    from public.ph_team_sessions tm
    join public.ph_line_shifts ls on ls.id = tm.line_shift_id
    join public.ph_task_kinds k on k.id = tm.task_kind_id
   where tm.voided_at is null and tm.farm_id = app.ph_farm_of_user() and (p_line is null or ls.line_id = p_line)
     and app.ph_can(tm.farm_id, 'report.kpi_view')
     and tm.started_at < p_to and coalesce(tm.ended_at, 'infinity') > p_from
$$;

-- Line-level productivity without names (management overview).
create function public.ph_kpi_line_productivity(p_from timestamptz, p_to timestamptz)
returns table (line_id uuid, line_code text, conforming_kg numeric, packing_hours numeric, kg_per_worker_hour numeric, boxes integer)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with cut as (select least(p_to, now()) as t),
  f as (select app.ph_farm_of_user() as id)
  select l.id, l.code,
         round(coalesce(o.kg, 0), 3), round(coalesce(h.h, 0), 3),
         case when coalesce(h.h, 0) > 0 then round(coalesce(o.kg, 0) / h.h, 2) end,
         coalesce(o.boxes, 0)::int
    from public.ph_lines l cross join f
    left join lateral (
      select sum(e.kg) filter (where e.conforming) as kg, sum(e.boxes) as boxes
        from public.ph_output_entries e join public.ph_line_shifts ls on ls.id = e.line_shift_id
       where ls.line_id = l.id and e.voided_at is null and e.period_end >= p_from and e.period_end < p_to) o on true
    left join lateral (
      select sum(app.po_minutes(li.started_at, li.ended_at, p_from, (select t from cut))) / 60.0 as h
        from public.ph_labour_intervals li join public.ph_line_shifts ls on ls.id = li.line_shift_id
        join public.ph_task_kinds k on k.id = li.task_kind_id and k.counts_as_packing
       where ls.line_id = l.id and li.voided_at is null and li.started_at < (select t from cut) and coalesce(li.ended_at, 'infinity') > p_from) h on true
   where l.farm_id = f.id and l.voided_at is null and app.ph_can(l.farm_id, 'report.kpi_view')
   order by l.sort_order, l.code
$$;

-- KPI 2: stops and minutes per line. Overlapping stops on one line are merged (union), so no minute counts twice on a line;
-- a stop crossing the window edge (e.g. midnight) is clipped to the window; an open stop counts to the cutoff.
create function public.ph_kpi_downtime(p_from timestamptz, p_to timestamptz)
returns table (line_id uuid, line_code text, stops integer, open_stops integer, minutes numeric)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with cut as (select least(p_to, now()) as t),
  ev as (
    select dl.line_id, e.id, e.restarted_at is null as is_open,
           tstzrange(greatest(e.stopped_at, p_from), least(coalesce(e.restarted_at, (select t from cut)), (select t from cut))) as r
      from public.ph_downtime_events e join public.ph_downtime_lines dl on dl.event_id = e.id and dl.voided_at is null
     where e.voided_at is null and e.farm_id = app.ph_farm_of_user() and p_from < (select t from cut)
       and e.stopped_at < (select t from cut) and coalesce(e.restarted_at, 'infinity') > p_from
  ),
  agg as (
    select line_id, count(distinct id)::int as stops, count(distinct id) filter (where is_open)::int as open_stops,
           range_agg(r) filter (where not isempty(r)) as mr
      from ev group by line_id
  )
  select l.id, l.code, coalesce(a.stops, 0), coalesce(a.open_stops, 0),
         round(coalesce((select sum(extract(epoch from upper(x) - lower(x))) from unnest(a.mr) x), 0) / 60.0, 1)
    from public.ph_lines l left join agg a on a.line_id = l.id
   where l.farm_id = app.ph_farm_of_user() and l.voided_at is null and app.ph_can(l.farm_id, 'report.kpi_view')
   order by l.sort_order, l.code
$$;

-- Site-wide elapsed stop time: union of every stop (shared equipment counts once, not once per line).
create function public.ph_kpi_downtime_site(p_from timestamptz, p_to timestamptz) returns numeric
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with cut as (select least(p_to, now()) as t),
  r as (
    select range_agg(tstzrange(greatest(e.stopped_at, p_from), least(coalesce(e.restarted_at, (select t from cut)), (select t from cut)))) as mr
      from public.ph_downtime_events e
     where e.voided_at is null and e.farm_id = app.ph_farm_of_user() and app.ph_can(e.farm_id, 'report.kpi_view')
       and p_from < (select t from cut) and e.stopped_at < (select t from cut) and coalesce(e.restarted_at, 'infinity') > p_from
  )
  select round(coalesce((select sum(extract(epoch from upper(x) - lower(x))) from r, unnest(r.mr) x where not isempty(x)), 0) / 60.0, 1)
$$;

create view public.ph_downtime_log with (security_invoker = true) as
  select e.id, e.farm_id, e.code, e.stopped_at, e.restarted_at, e.restarted_at is null as is_open, e.observed_fault,
         e.cause_id, c.code as cause_code, c.name_ar as cause_name_ar, c.name_en as cause_name_en, e.cause_note,
         e.cause_confirmed_at, e.equipment_id, coalesce(eq.code, e.equipment_text) as equipment, e.job_card_id, e.order_line_id,
         e.shift_id, e.work_order_ref, e.response_at, e.technical_release_at,
         array(select l.code from public.ph_downtime_lines dl join public.ph_lines l on l.id = dl.line_id
                where dl.event_id = e.id and dl.voided_at is null order by l.code) as line_codes,
         array(select dl.line_id from public.ph_downtime_lines dl where dl.event_id = e.id and dl.voided_at is null) as line_ids,
         round(extract(epoch from coalesce(e.restarted_at, now()) - e.stopped_at) / 60.0, 1) as minutes_to_now
    from public.ph_downtime_events e
    left join public.ph_downtime_causes c on c.id = e.cause_id
    left join public.ph_equipment eq on eq.id = e.equipment_id
   where e.voided_at is null;

-- KPI 3: order duration variance = (completion − start) − baseline planned duration; lateness against the latest promised
-- loading time is separate. Running orders show elapsed to the cutoff.
create function public.ph_kpi_order_variance(p_from timestamptz, p_to timestamptz)
returns table (order_line_id uuid, code text, customer text, started_at timestamptz, completed_at timestamptz, state text,
               actual_min numeric, baseline_min integer, latest_min integer, revisions integer, variance_min numeric,
               promised_loading_at timestamptz, lateness_min numeric, overrun_reason text, baseline_after_start boolean)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select o.id, o.code, coalesce(c.code, o.customer_name), x.started_at, x.completed_at,
         case when x.completed_at is null then 'running' else 'completed' end,
         round(extract(epoch from coalesce(x.completed_at, least(p_to, now())) - x.started_at) / 60.0, 1),
         b.planned_duration_min, lp.planned_duration_min, (select greatest(count(*)::int - 1, 0) from public.ph_order_plans pp
                                                            where pp.order_line_id = o.id and pp.voided_at is null),
         case when b.planned_duration_min is not null
              then round(extract(epoch from coalesce(x.completed_at, least(p_to, now())) - x.started_at) / 60.0 - b.planned_duration_min, 1) end,
         lp.promised_loading_at,
         case when lp.promised_loading_at is not null and x.completed_at is not null
              then round(extract(epoch from x.completed_at - lp.promised_loading_at) / 60.0, 1) end,
         x.overrun_reason, b.recorded_after_start
    from public.ph_order_execution x
    join public.ph_order_lines o on o.id = x.order_line_id
    left join public.ph_customers c on c.id = o.customer_id
    left join public.ph_order_plans b on b.order_line_id = o.id and b.version_no = 1 and b.voided_at is null
    left join lateral (select * from public.ph_order_plans pp where pp.order_line_id = o.id and pp.voided_at is null
                        order by pp.version_no desc limit 1) lp on true
   where x.voided_at is null and x.farm_id = app.ph_farm_of_user() and app.ph_can(x.farm_id, 'report.kpi_view')
     and x.started_at < p_to and coalesce(x.completed_at, 'infinity') >= p_from
   order by x.started_at
$$;

select app.seed_po_shift_core(id) from public.farms;
select app.apply_api_grants();
