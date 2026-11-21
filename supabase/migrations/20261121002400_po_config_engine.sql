-- Packhouse operations, increment 5: the configuration engine (owner instruction 2026-11-21 §3.2–3.5).
--
-- One engine for owner-created operations, tasks and KPI cards. A definition is data (jsonb) checked by a validator, never SQL.
--   * Operation types: steps (form or approval), fields (text, number + unit, select, date, check, photo, repeatable rows),
--     conditions (dropdown-built), roles per step, pass rules, what a failure does (block, hold, go back to a step), the hook
--     point it attaches to (e.g. before dispatch, only for one customer), and whether it creates a task. Draft → validate →
--     publish effective-dated → retire / roll back. Every record pins the version it started on.
--   * Each published step becomes an action in the same authority matrix (op_<code>.<step>) with Owner-decided cells.
--   * Tasks: one-off or recurring, assigned to a role or a person, deadline, escalation, comments, history.
--   * KPI cards: a measure over a whitelisted dataset with filters, grouping, target, unit and role visibility; evaluated by
--     the server from the definition (identifiers are whitelisted, values are parameters).
-- What still needs engineering is said so in docs/packhouse-ops/NO_CODE_BOUNDARIES.md.

set check_function_bodies = off;

-- =============================================================================================
-- 1. Operation types and versions
-- =============================================================================================
create table public.ph_op_types (
  id            uuid primary key default gen_random_uuid(),
  code          text not null check (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
  name_ar       text not null,
  name_en       text,
  subject_kind  text not null check (subject_kind in ('load', 'fg_pallet', 'line_shift', 'standalone')),
  nav_visible   boolean not null default true,
  retired_at    timestamptz,
  retired_reason text
);
comment on table public.ph_op_types is
  'Owner-defined operation types (Operations Settings). The definition lives in versions; records pin the version they started on.';
select app.register_table('public.ph_op_types', 'ph_config', false, p_default_policies => false);
create unique index ph_op_types_uq on public.ph_op_types (farm_id, code) where voided_at is null;

create table public.ph_op_versions (
  id              uuid primary key default gen_random_uuid(),
  op_type_id      uuid not null references public.ph_op_types(id),
  version_no      integer not null check (version_no > 0),
  state           text not null check (state in ('draft', 'published', 'superseded', 'discarded')),
  definition      jsonb not null,
  effective_from  timestamptz,
  published_by    uuid references auth.users(id),
  published_at    timestamptz,
  change_note     text
);
comment on table public.ph_op_versions is
  'Versions of an operation type: one draft at a time; publishing makes it the version in effect from a date and supersedes the '
  'previous one; a published definition is never edited (a rollback publishes an older definition as a new version).';
select app.register_table('public.ph_op_versions', 'ph_config', false, p_default_policies => false);
create unique index ph_op_versions_uq on public.ph_op_versions (op_type_id, version_no) where voided_at is null;
create unique index ph_op_versions_one_draft on public.ph_op_versions (op_type_id) where state = 'draft' and voided_at is null;

create table public.ph_op_instances (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  op_version_id   uuid not null references public.ph_op_versions(id),
  subject_kind    text not null,
  subject_id      uuid,
  subject_code    text,
  line_id         uuid references public.ph_lines(id),
  current_step    text,
  step_values     jsonb not null default '{}',
  completed_at    timestamptz,
  failed_at       timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  trigger_note    text
);
comment on table public.ph_op_instances is
  'One run of an operation for a subject (a load, a finished pallet, a line shift, or nothing). Pinned to its version; each step '
  'stores its values, who and when. Open = not completed, failed or cancelled.';
select app.register_table('public.ph_op_instances', 'ph_op', false, p_default_policies => false);
create unique index ph_op_instances_code_uq on public.ph_op_instances (farm_id, code) where voided_at is null;
create index ph_op_instances_subject_idx on public.ph_op_instances (subject_id);

-- =============================================================================================
-- 2. Tasks (task board) and KPI cards
-- =============================================================================================
create table public.ph_tasks (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  title              text not null check (length(trim(title)) > 0),
  details            text,
  assignee_role      text,
  assignee_user_id   uuid references public.user_profiles(id),
  line_id            uuid references public.ph_lines(id),
  due_at             timestamptz,
  priority           text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  source             text not null check (source in ('manual', 'operation', 'schedule', 'rule')),
  op_instance_id     uuid references public.ph_op_instances(id),
  template_id        uuid,
  escalate_after_min integer check (escalate_after_min > 0),
  escalate_to_role   text,
  escalated_at       timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  completed_by       uuid references auth.users(id),
  completion_note    text,
  evidence_ids       uuid[] not null default '{}',
  cancelled_at       timestamptz,
  cancel_reason      text,
  check (assignee_role is not null or assignee_user_id is not null)
);
comment on table public.ph_tasks is
  'Task board: one-off or generated work with a deadline, assignee (role or person), escalation, evidence, comments and '
  'history. Lifecycle by timestamps written only by the task functions.';
select app.register_table('public.ph_tasks', 'ph_task', false, p_default_policies => false);
create unique index ph_tasks_code_uq on public.ph_tasks (farm_id, code) where voided_at is null;

create table public.ph_task_comments (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references public.ph_tasks(id),
  body     text not null check (length(trim(body)) > 0)
);
comment on table public.ph_task_comments is 'Comments on a task (append-only).';
select app.register_table('public.ph_task_comments', 'ph_task', false, p_default_policies => false);
create trigger ph_task_comments_append_only before update on public.ph_task_comments for each row execute function app.ph_append_only();

create table public.ph_task_templates (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  details            text,
  assignee_role      text not null,
  line_id            uuid references public.ph_lines(id),
  every_days         integer check (every_days between 1 and 366),
  at_time            time,
  weekdays           integer[],
  due_minutes        integer not null default 120 check (due_minutes > 0),
  escalate_after_min integer,
  escalate_to_role   text,
  next_run_at        timestamptz,
  active             boolean not null default true,
  check (every_days is not null or weekdays is not null)
);
comment on table public.ph_task_templates is 'Recurring work: generated by the scheduler (server tick) at the given time on the given days.';
select app.register_table('public.ph_task_templates', 'ph_task', false, p_default_policies => false);

create table public.ph_kpi_defs (
  id             uuid primary key default gen_random_uuid(),
  code           text not null check (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  version_no     integer not null default 1,
  state          text not null check (state in ('draft', 'published', 'superseded', 'retired')),
  definition     jsonb not null,
  effective_from timestamptz,
  published_by   uuid references auth.users(id),
  published_at   timestamptz,
  sort_order     integer not null default 100
);
comment on table public.ph_kpi_defs is
  'KPI cards built in Settings: dataset, measure, filters, grouping, window, target, unit, chart and visible roles. Versioned; a '
  'report for a past day uses the version in effect then.';
select app.register_table('public.ph_kpi_defs', 'ph_config', false, p_default_policies => false);
create unique index ph_kpi_defs_uq on public.ph_kpi_defs (farm_id, code, version_no) where voided_at is null;

do $$
declare t text;
begin
  foreach t in array array['ph_op_types', 'ph_op_versions', 'ph_op_instances', 'ph_tasks', 'ph_task_comments', 'ph_task_templates', 'ph_kpi_defs'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.ph_is_member(farm_id))', t || '_select', t);
  end loop;
end $$;

-- =============================================================================================
-- 3. Actions and cells
-- =============================================================================================
create function app.seed_po_config_engine(p_farm uuid) returns void
language plpgsql
as $$
begin
  -- Degree Celsius for temperature fields (SI unit; no conversion factor because the base dimension is "other").
  if not exists (select 1 from public.units where farm_id = p_farm and code = 'degC') then
    perform set_config('app.in_verify', 'on', true);
    insert into public.units (farm_id, code, name_ar, name_en, dimension, to_base_factor, verification_status, verified_at, source_note)
    values (p_farm, 'degC', 'درجة مئوية', 'Degree Celsius', 'other', null, 'verified', now(), 'SI unit');
    perform set_config('app.in_verify', 'off', true);
  end if;
  insert into public.ph_actions (farm_id, action_key, object_code, label_en, label_ar, owner_roles, milestone, source, sort_order, scope_kind, category)
  select p_farm, a.k, split_part(a.k, '.', 1), a.en, a.ar, '{OWN}', 'PO-5', 'Owner instruction 2026-11-21 §2, §3', 1000 + row_number() over (), a.scope, a.cat
    from (values
      ('task.create', 'Create, assign and reassign tasks', 'إنشاء المهام وتعيينها وإعادة تعيينها', 'farm', 'assign'),
      ('task.view_all', 'See every task on the board', 'عرض كل المهام في اللوحة', 'farm', 'view'),
      ('task.cancel', 'Cancel or reopen a task', 'إلغاء مهمة أو إعادة فتحها', 'farm', 'approve')
    ) as a(k, en, ar, scope, cat)
   where not exists (select 1 from public.ph_actions where farm_id = p_farm and action_key = a.k);
  insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
  select p_farm, m.k, m.r, 'P', 'proposed', 'P', m.note
    from (values ('task.create', 'PHM', 'S-04 PE §7, §10'), ('task.create', 'PE', 'S-04 PE §7'), ('task.create', 'QCM', null), ('task.create', 'QAM', null),
                 ('task.view_all', 'PHM', null), ('task.view_all', 'PE', null), ('task.cancel', 'PHM', null)) as m(k, r, note)
   where not exists (select 1 from public.ph_permission_cells c where c.farm_id = p_farm and c.action_key = m.k and c.spec_code = m.r);
  insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
  select p_farm, k, 'OWN', 'O', 'active', 'O', 'Owner role'
    from unnest(array['task.create', 'task.view_all', 'task.cancel']) k
   where not exists (select 1 from public.ph_permission_cells c where c.farm_id = p_farm and c.action_key = k and c.spec_code = 'OWN');
end;
$$;

-- =============================================================================================
-- 4. Conditions, subjects and validation
-- =============================================================================================
-- What a condition may look at, per subject kind (whitelist).
create function app.po_subject_facts(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare v jsonb := '{}';
begin
  if p_kind = 'load' then
    select jsonb_build_object('customer_code', coalesce(c.code, l.customer_text), 'destination', l.destination, 'vehicle_plate', l.vehicle_plate,
             'market_type', (select string_agg(distinct o.market_type, ',') from public.ph_load_lines ll join public.ph_order_lines o on o.id = ll.order_line_id where ll.load_id = l.id),
             'grade', (select string_agg(distinct o.grade, ',') from public.ph_load_lines ll join public.ph_order_lines o on o.id = ll.order_line_id where ll.load_id = l.id),
             'crop_code', (select string_agg(distinct cr.code, ',') from public.ph_load_lines ll join public.ph_order_lines o on o.id = ll.order_line_id
                            join public.ph_crops cr on cr.id = o.crop_id where ll.load_id = l.id),
             'pack_code', (select string_agg(distinct pf.code, ',') from public.ph_load_lines ll join public.ph_order_lines o on o.id = ll.order_line_id
                            join public.ph_pack_formats pf on pf.id = o.pack_format_id where ll.load_id = l.id))
      into v from public.ph_loads l left join public.ph_customers c on c.id = l.customer_id where l.id = p_id;
  elsif p_kind = 'fg_pallet' then
    select jsonb_build_object('grade', f.grade, 'crop_code', cr.code, 'location', lo.code) into v
      from public.ph_fg_pallets f join public.ph_crops cr on cr.id = f.crop_id left join public.ph_locations lo on lo.id = f.location_id where f.id = p_id;
  elsif p_kind = 'line_shift' then
    select jsonb_build_object('line_code', l.code) into v from public.ph_line_shifts ls join public.ph_lines l on l.id = ls.line_id where ls.id = p_id;
  end if;
  return coalesce(v, '{}');
end;
$$;

create function app.po_subject_fields(p_kind text) returns text[]
language sql immutable as $$
  select case p_kind
    when 'load' then array['customer_code', 'destination', 'vehicle_plate', 'market_type', 'grade', 'crop_code', 'pack_code']
    when 'fg_pallet' then array['grade', 'crop_code', 'location']
    when 'line_shift' then array['line_code']
    else array[]::text[] end
$$;

-- One condition {field, op, value} against a fact map. Multi-valued facts (comma lists) match if any value matches.
create function app.po_cond(p_facts jsonb, c jsonb) returns boolean
language plpgsql immutable as $$
declare
  v_fact text := p_facts ->> (c ->> 'field');
  v_val  text := c ->> 'value';
  vals   text[] := string_to_array(coalesce(v_fact, ''), ',');
begin
  case c ->> 'op'
    when 'eq' then return lower(v_val) = any (array(select lower(trim(x)) from unnest(vals) x));
    when 'neq' then return not (lower(v_val) = any (array(select lower(trim(x)) from unnest(vals) x)));
    when 'in' then return exists (select 1 from unnest(vals) x, jsonb_array_elements_text(c -> 'value') y where lower(trim(x)) = lower(y));
    when 'contains' then return position(lower(v_val) in lower(coalesce(v_fact, ''))) > 0;
    when 'empty' then return coalesce(trim(v_fact), '') = '';
    when 'gt' then return v_fact ~ '^-?[0-9.]+$' and v_fact::numeric > v_val::numeric;
    when 'gte' then return v_fact ~ '^-?[0-9.]+$' and v_fact::numeric >= v_val::numeric;
    when 'lt' then return v_fact ~ '^-?[0-9.]+$' and v_fact::numeric < v_val::numeric;
    when 'lte' then return v_fact ~ '^-?[0-9.]+$' and v_fact::numeric <= v_val::numeric;
    else return false;
  end case;
end;
$$;

create function app.po_conds(p_facts jsonb, p_conds jsonb) returns boolean
language sql immutable as $$
  select coalesce(bool_and(app.po_cond(p_facts, c)), true) from jsonb_array_elements(coalesce(p_conds, '[]')) c
$$;

-- Hook points the built-in workflows expose, and the subject kind each hands over.
create function app.po_hooks() returns table (hook text, subject_kind text, label_en text, label_ar text)
language sql immutable as $$
  values ('dispatch.before_depart', 'load', 'Before a load departs (blocks departure until done)', 'قبل مغادرة الحمولة (تمنع المغادرة حتى تُنجز)'),
         ('dispatch.load_created', 'load', 'When a load is created (does not block)', 'عند إنشاء حمولة (لا تمنع)'),
         ('manual', 'standalone', 'Started by a person from the menu', 'يبدؤها شخص من القائمة')
$$;

-- Validator: every problem with a draft, so the screen can list them before publishing.
create function public.ph_op_validate(p_def jsonb, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm   uuid := app.ph_farm_of_user();
  errs     jsonb := '[]';
  s        jsonb;
  f        jsonb;
  c        jsonb;
  keys     text[] := '{}';
  fkeys    text[];
  allf     text[] := '{}';
  v_hook   text := p_def -> 'trigger' ->> 'hook';
  v_types  text[] := array['text', 'number', 'select', 'date', 'datetime', 'check', 'photo', 'rows'];
begin
  if jsonb_array_length(coalesce(p_def -> 'steps', '[]')) = 0 then errs := errs || '[{"key":"noSteps"}]'; end if;
  if v_hook is null or not exists (select 1 from app.po_hooks() h where h.hook = v_hook) then
    errs := errs || jsonb_build_array(jsonb_build_object('key', 'unknownHook', 'hook', v_hook));
  elsif (select subject_kind from app.po_hooks() h where h.hook = v_hook) <> p_kind then
    errs := errs || jsonb_build_array(jsonb_build_object('key', 'hookSubject', 'hook', v_hook, 'subject', p_kind));
  end if;
  for c in select * from jsonb_array_elements(coalesce(p_def -> 'trigger' -> 'conditions', '[]')) loop
    if not (c ->> 'field') = any (app.po_subject_fields(p_kind)) then
      errs := errs || jsonb_build_array(jsonb_build_object('key', 'unknownConditionField', 'field', c ->> 'field'));
    end if;
  end loop;
  for s in select * from jsonb_array_elements(coalesce(p_def -> 'steps', '[]')) loop
    if coalesce(s ->> 'key', '') !~ '^[a-z][a-z0-9_]{1,23}$' then errs := errs || jsonb_build_array(jsonb_build_object('key', 'stepKey', 'step', s ->> 'key')); end if;
    if (s ->> 'key') = any (keys) then errs := errs || jsonb_build_array(jsonb_build_object('key', 'duplicateStep', 'step', s ->> 'key')); end if;
    keys := keys || (s ->> 'key');
    if coalesce(trim(s ->> 'name_ar'), '') = '' then errs := errs || jsonb_build_array(jsonb_build_object('key', 'stepName', 'step', s ->> 'key')); end if;
    if (s ->> 'kind') not in ('form', 'approval') then errs := errs || jsonb_build_array(jsonb_build_object('key', 'stepKind', 'step', s ->> 'key')); end if;
    if not exists (select 1 from public.ph_roles where farm_id = v_farm and spec_code = s ->> 'role' and voided_at is null) then
      errs := errs || jsonb_build_array(jsonb_build_object('key', 'unknownRole', 'step', s ->> 'key', 'role', s ->> 'role'));
    end if;
    if (s ->> 'kind') = 'approval' and (s ->> 'role') not in ('QCI', 'QCM', 'QAO', 'QAM', 'PHM', 'OWN')
       and not exists (select 1 from public.ph_roles where farm_id = v_farm and spec_code = s ->> 'role' and is_custom) then
      errs := errs || jsonb_build_array(jsonb_build_object('key', 'approverRole', 'step', s ->> 'key'));
    end if;
    fkeys := '{}';
    for f in select * from jsonb_array_elements(coalesce(s -> 'fields', '[]')) loop
      if coalesce(f ->> 'key', '') !~ '^[a-z][a-z0-9_]{1,31}$' then errs := errs || jsonb_build_array(jsonb_build_object('key', 'fieldKey', 'step', s ->> 'key', 'field', f ->> 'key')); end if;
      if (f ->> 'key') = any (fkeys) then errs := errs || jsonb_build_array(jsonb_build_object('key', 'duplicateField', 'step', s ->> 'key', 'field', f ->> 'key')); end if;
      fkeys := fkeys || (f ->> 'key'); allf := allf || ((s ->> 'key') || '.' || (f ->> 'key'));
      if not (f ->> 'type') = any (v_types) then errs := errs || jsonb_build_array(jsonb_build_object('key', 'fieldType', 'step', s ->> 'key', 'field', f ->> 'key')); end if;
      if coalesce(trim(f ->> 'label_ar'), '') = '' then errs := errs || jsonb_build_array(jsonb_build_object('key', 'fieldLabel', 'step', s ->> 'key', 'field', f ->> 'key')); end if;
      if (f ->> 'type') = 'select' and jsonb_array_length(coalesce(f -> 'options', '[]')) = 0 then
        errs := errs || jsonb_build_array(jsonb_build_object('key', 'selectOptions', 'step', s ->> 'key', 'field', f ->> 'key'));
      end if;
      if (f ->> 'type') = 'number' and (f ->> 'unit') is not null
         and not exists (select 1 from public.units where farm_id = v_farm and code = f ->> 'unit' and voided_at is null) then
        errs := errs || jsonb_build_array(jsonb_build_object('key', 'unknownUnit', 'step', s ->> 'key', 'field', f ->> 'key', 'unit', f ->> 'unit'));
      end if;
    end loop;
    for c in select * from jsonb_array_elements(coalesce(s -> 'pass_if', '[]')) loop
      if not (c ->> 'field') = any (fkeys) then
        errs := errs || jsonb_build_array(jsonb_build_object('key', 'passFieldUnknown', 'step', s ->> 'key', 'field', c ->> 'field'));
      end if;
    end loop;
  end loop;
  -- Branches and "go back to" targets must name existing steps; a step's show-if may only look at earlier steps' fields.
  for s in select * from jsonb_array_elements(coalesce(p_def -> 'steps', '[]')) loop
    if (s -> 'on_fail' ->> 'goto') is not null and not (s -> 'on_fail' ->> 'goto') = any (keys) then
      errs := errs || jsonb_build_array(jsonb_build_object('key', 'brokenRoute', 'step', s ->> 'key', 'target', s -> 'on_fail' ->> 'goto'));
    end if;
    for c in select * from jsonb_array_elements(coalesce(s -> 'show_if', '[]')) loop
      if not (c ->> 'field') = any (allf) and not (c ->> 'field') = any (app.po_subject_fields(p_kind)) then
        errs := errs || jsonb_build_array(jsonb_build_object('key', 'showIfUnknown', 'step', s ->> 'key', 'field', c ->> 'field'));
      end if;
    end loop;
  end loop;
  if (p_def -> 'task' ->> 'role') is not null
     and not exists (select 1 from public.ph_roles where farm_id = v_farm and spec_code = p_def -> 'task' ->> 'role' and voided_at is null) then
    errs := errs || jsonb_build_array(jsonb_build_object('key', 'unknownRole', 'role', p_def -> 'task' ->> 'role'));
  end if;
  return errs;
end;
$$;

-- =============================================================================================
-- 5. Settings functions: create type, save draft, publish, retire, roll back
-- =============================================================================================
create function public.ph_op_save_draft(p_code text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  t      public.ph_op_types;
  v_ver  integer;
  d      public.ph_op_versions;
begin
  perform app.ph_authorize(v_farm, 'settings.edit');
  select * into t from public.ph_op_types where farm_id = v_farm and code = upper(trim(p_code)) and voided_at is null;
  if not found then
    if coalesce(trim(p ->> 'name_ar'), '') = '' then
      raise exception 'Give the operation an Arabic name' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.name')::text;
    end if;
    if upper(trim(p_code)) !~ '^[A-Z][A-Z0-9_]{1,23}$' then
      raise exception 'Operation codes are 2–24 capital letters, digits or underscore' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.code')::text;
    end if;
    insert into public.ph_op_types (farm_id, code, name_ar, name_en, subject_kind)
    values (v_farm, upper(trim(p_code)), trim(p ->> 'name_ar'), nullif(trim(p ->> 'name_en'), ''), coalesce(p ->> 'subject_kind', 'standalone'))
    returning * into t;
  elsif p ? 'name_ar' or p ? 'nav_visible' then
    update public.ph_op_types set name_ar = coalesce(nullif(trim(p ->> 'name_ar'), ''), name_ar), name_en = coalesce(nullif(trim(p ->> 'name_en'), ''), name_en),
           nav_visible = coalesce((p ->> 'nav_visible')::boolean, nav_visible)
     where id = t.id;
  end if;
  if t.retired_at is not null then
    raise exception 'This operation is retired' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.retired')::text;
  end if;
  select * into d from public.ph_op_versions where op_type_id = t.id and state = 'draft' and voided_at is null for update;
  if found then
    update public.ph_op_versions set definition = coalesce(p -> 'definition', definition), change_note = coalesce(p ->> 'change_note', change_note)
     where id = d.id returning * into d;
  else
    select coalesce(max(version_no), 0) + 1 into v_ver from public.ph_op_versions where op_type_id = t.id and voided_at is null;
    insert into public.ph_op_versions (farm_id, op_type_id, version_no, state, definition, change_note)
    values (v_farm, t.id, v_ver, 'draft',
            coalesce(p -> 'definition', (select definition from public.ph_op_versions where op_type_id = t.id and state = 'published' and voided_at is null),
                     jsonb_build_object('trigger', jsonb_build_object('hook', 'manual'), 'steps', '[]'::jsonb)),
            p ->> 'change_note')
    returning * into d;
  end if;
  return jsonb_build_object('op_type_id', t.id, 'code', t.code, 'draft_version', d.version_no,
                            'errors', public.ph_op_validate(d.definition, t.subject_kind));
end;
$$;

-- Register the published steps in the authority matrix: op_<code>.<step> with the step's role (Owner decision, labelled O).
create function app.po_register_op_actions(p_farm uuid, t public.ph_op_types, p_def jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  s     jsonb;
  k     text;
  roles text[];
begin
  for s in select * from jsonb_array_elements(p_def -> 'steps') loop
    k := 'op_' || lower(t.code) || '.' || (s ->> 'key');
    insert into public.ph_actions (farm_id, action_key, object_code, label_en, label_ar, owner_roles, milestone, source, sort_order, scope_kind, category)
    select p_farm, k, 'op_' || lower(t.code), coalesce(t.name_en, t.name_ar) || ' — ' || coalesce(s ->> 'name_en', s ->> 'name_ar'), t.name_ar || ' — ' || (s ->> 'name_ar'),
           '{OWN}', 'Owner-defined', 'Operations Settings: ' || t.code, 2000, 'farm', case when s ->> 'kind' = 'approval' then 'approve' else 'create' end
     where not exists (select 1 from public.ph_actions where farm_id = p_farm and action_key = k and voided_at is null);
    roles := array[s ->> 'role'];
    perform set_config('app.in_void', 'on', true);
    update public.ph_permission_cells set voided_at = now(), voided_by = app.current_user_id(), void_reason = 'Republished: ' || p_reason
     where farm_id = p_farm and action_key = k and voided_at is null and not spec_code = any (roles);
    perform set_config('app.in_void', 'off', true);
    insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
    select p_farm, k, r, 'O', 'active', 'O', 'Owner-published operation ' || t.code
      from unnest(roles) r
     where not exists (select 1 from public.ph_permission_cells c where c.farm_id = p_farm and c.action_key = k and c.spec_code = r and c.voided_at is null);
  end loop;
end;
$$;

create function public.ph_op_publish(p_code text, p_effective_from timestamptz default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  t      public.ph_op_types;
  d      public.ph_op_versions;
  errs   jsonb;
  v_from timestamptz := coalesce(p_effective_from, now());
begin
  perform app.ph_authorize(v_farm, 'settings.publish');
  select * into t from public.ph_op_types where farm_id = v_farm and code = upper(trim(p_code)) and voided_at is null;
  if not found then raise exception 'Operation not found' using errcode = 'P0404'; end if;
  select * into d from public.ph_op_versions where op_type_id = t.id and state = 'draft' and voided_at is null for update;
  if not found then raise exception 'No draft to publish' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.noDraft')::text; end if;
  errs := public.ph_op_validate(d.definition, t.subject_kind);
  if jsonb_array_length(errs) > 0 then
    raise exception 'The draft has % problem(s); fix them before publishing', jsonb_array_length(errs) using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.op.invalid', 'errors', errs)::text;
  end if;
  if v_from < now() - interval '1 minute' then
    raise exception 'A version takes effect now or later, never in the past' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.pastEffective')::text;
  end if;
  update public.ph_op_versions set state = 'superseded' where op_type_id = t.id and state = 'published' and voided_at is null;
  update public.ph_op_versions set state = 'published', effective_from = v_from, published_by = app.current_user_id(), published_at = now(),
         change_note = coalesce(nullif(trim(p_note), ''), change_note) where id = d.id;
  update public.ph_op_types set retired_at = null, retired_reason = null where id = t.id;
  perform app.po_register_op_actions(v_farm, t, d.definition, coalesce(p_note, 'published'));
  -- Hook checks are registered once per farm and hook; the check reads every published operation for that hook.
  if (d.definition -> 'trigger' ->> 'hook') <> 'manual' and not exists (select 1 from app.po_hook_checks where farm_id = v_farm and hook = d.definition -> 'trigger' ->> 'hook') then
    insert into app.po_hook_checks (farm_id, hook, check_fn) values (v_farm, d.definition -> 'trigger' ->> 'hook', 'app.po_op_hook_check');
  end if;
  insert into public.ph_access_events (farm_id, event, after, reason)
  values (v_farm, 'operation_published', jsonb_build_object('code', t.code, 'version', d.version_no, 'effective_from', v_from), p_note);
  return jsonb_build_object('code', t.code, 'version', d.version_no, 'effective_from', v_from);
end;
$$;

create function public.ph_op_retire(p_code text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  t      public.ph_op_types;
  v_n    integer;
begin
  perform app.ph_authorize(v_farm, 'settings.publish');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  select * into t from public.ph_op_types where farm_id = v_farm and code = upper(trim(p_code)) and voided_at is null for update;
  if not found then raise exception 'Operation not found' using errcode = 'P0404'; end if;
  update public.ph_op_types set retired_at = now(), retired_reason = p_reason where id = t.id;
  -- Open runs stop blocking; finished runs stay readable with their pinned version.
  update public.ph_op_instances set cancelled_at = now(), cancel_reason = 'Operation retired: ' || p_reason
   where op_version_id in (select id from public.ph_op_versions where op_type_id = t.id) and completed_at is null and failed_at is null and cancelled_at is null;
  get diagnostics v_n = row_count;
  update public.ph_tasks set cancelled_at = now(), cancel_reason = 'Operation retired' where op_instance_id in
    (select i.id from public.ph_op_instances i join public.ph_op_versions v on v.id = i.op_version_id where v.op_type_id = t.id) and completed_at is null and cancelled_at is null;
  insert into public.ph_access_events (farm_id, event, after, reason) values (v_farm, 'operation_retired', jsonb_build_object('code', t.code, 'open_runs_cancelled', v_n), p_reason);
  return jsonb_build_object('code', t.code, 'retired', true, 'open_runs_cancelled', v_n);
end;
$$;

-- Roll back future use: the definition of an earlier version becomes the draft (then published as a new version).
create function public.ph_op_rollback(p_code text, p_version integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  t      public.ph_op_types;
  v_def  jsonb;
begin
  perform app.ph_authorize(v_farm, 'settings.publish');
  select * into t from public.ph_op_types where farm_id = v_farm and code = upper(trim(p_code)) and voided_at is null;
  select definition into v_def from public.ph_op_versions where op_type_id = t.id and version_no = p_version and state in ('published', 'superseded') and voided_at is null;
  if v_def is null then raise exception 'Version not found' using errcode = 'P0404'; end if;
  perform public.ph_op_save_draft(t.code, jsonb_build_object('definition', v_def, 'change_note', 'Rollback to v' || p_version || ': ' || coalesce(p_reason, '')));
  return public.ph_op_publish(t.code, now(), 'Rollback to v' || p_version || ': ' || coalesce(p_reason, ''));
end;
$$;

-- =============================================================================================
-- 6. Runtime: start a run (on a hook or by hand), record a step, the hook check
-- =============================================================================================
create function app.po_version_in_effect(p_type uuid) returns public.ph_op_versions
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select * from public.ph_op_versions where op_type_id = p_type and state in ('published', 'superseded') and effective_from <= now() and voided_at is null
   order by effective_from desc, version_no desc limit 1
$$;

create function app.po_step_def(p_def jsonb, p_key text) returns jsonb
language sql immutable as $$ select s from jsonb_array_elements(p_def -> 'steps') s where s ->> 'key' = p_key $$;

-- The first step at or after position p_from whose show-if holds (conditional branch); null when none is left.
create function app.po_next_step(p_def jsonb, p_from integer, p_facts jsonb) returns text
language sql immutable as $$
  select s ->> 'key' from jsonb_array_elements(p_def -> 'steps') with ordinality as x(s, i)
   where x.i > p_from and coalesce((s ->> 'disabled')::boolean, false) = false and app.po_conds(p_facts, s -> 'show_if')
   order by x.i limit 1
$$;

create function app.po_step_index(p_def jsonb, p_key text) returns integer
language sql immutable as $$ select (x.i)::int from jsonb_array_elements(p_def -> 'steps') with ordinality as x(s, i) where s ->> 'key' = p_key $$;

-- Facts for show-if: the subject's facts plus every recorded field as "<step>.<field>".
create function app.po_run_facts(r public.ph_op_instances) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select app.po_subject_facts(r.subject_kind, r.subject_id)
         || coalesce((select jsonb_object_agg(s.key || '.' || f.key, f.value #>> '{}')
                        from jsonb_each(r.step_values) s, jsonb_each(s.value -> 'values') f), '{}')
$$;

create function app.po_start_run(p_farm uuid, t public.ph_op_types, v public.ph_op_versions, p_kind text, p_subject uuid, p_code text, p_note text) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_code  text := app.ph_code(p_farm, 'OP', 4);
  v_first text;
  r       public.ph_op_instances;
  v_task  jsonb := v.definition -> 'task';
begin
  insert into public.ph_op_instances (id, farm_id, code, op_version_id, subject_kind, subject_id, subject_code, trigger_note)
  values (v_id, p_farm, v_code, v.id, p_kind, p_subject, p_code, p_note) returning * into r;
  v_first := app.po_next_step(v.definition, 0, app.po_run_facts(r));
  update public.ph_op_instances set current_step = v_first where id = v_id;
  -- The task that brings the run to the person (assigned to the first step's role unless the definition names another).
  insert into public.ph_tasks (farm_id, code, title, details, assignee_role, due_at, priority, source, op_instance_id, escalate_after_min, escalate_to_role)
  values (p_farm, app.ph_code(p_farm, 'TSK', 4), t.name_ar || coalesce(' — ' || p_code, ''), coalesce(v_task ->> 'details', t.name_en),
          coalesce(v_task ->> 'role', (app.po_step_def(v.definition, v_first)) ->> 'role'),
          case when (v_task ->> 'due_minutes') is not null then now() + make_interval(mins => (v_task ->> 'due_minutes')::int) end,
          coalesce(v_task ->> 'priority', 'normal'), 'operation', v_id,
          nullif(v_task ->> 'escalate_after_min', '')::int, nullif(v_task ->> 'escalate_to_role', ''));
  perform app.ph_notify_role(p_farm, coalesce(v_task ->> 'role', (app.po_step_def(v.definition, v_first)) ->> 'role'), 'po_task', 'ph_op_instances', v_id,
                             jsonb_build_object('code', v_code, 'operation', t.code));
  return v_id;
end;
$$;

-- Hook check used by built-in workflows (registered in app.po_hook_checks): returns a blocker for each operation the subject
-- needs that is not completed. It writes nothing: a blocked step is rolled back, so runs are started by app.po_emit (load created,
-- dispatch screen opened, scheduler tick).
create function app.po_op_hook_check(p_farm uuid, p_record jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  t      public.ph_op_types;
  v      public.ph_op_versions;
  v_id   uuid := (p_record ->> 'id')::uuid;
  v_hook text := coalesce(p_record ->> '_hook', 'dispatch.before_depart');
  v_kind text := (select subject_kind from app.po_hooks() h where h.hook = v_hook);
  r      public.ph_op_instances;
  out    jsonb := '[]';
begin
  for t in select * from public.ph_op_types where farm_id = p_farm and retired_at is null and voided_at is null and subject_kind = v_kind loop
    v := app.po_version_in_effect(t.id);
    continue when v.id is null or (v.definition -> 'trigger' ->> 'hook') <> v_hook;
    continue when not app.po_conds(app.po_subject_facts(v_kind, v_id), v.definition -> 'trigger' -> 'conditions');
    select i.* into r from public.ph_op_instances i join public.ph_op_versions vv on vv.id = i.op_version_id
     where vv.op_type_id = t.id and i.subject_id = v_id and i.cancelled_at is null and i.voided_at is null order by i.created_at desc limit 1;
    if r.id is null then
      out := out || jsonb_build_array(jsonb_build_object('operation', t.code, 'label', t.name_ar, 'state', 'not_started'));
    elsif r.completed_at is null then
      out := out || jsonb_build_array(jsonb_build_object('operation', t.code, 'label', t.name_ar, 'run', r.code,
                                                         'state', case when r.failed_at is not null then 'failed' else 'open' end));
    end if;
  end loop;
  return out;
end;
$$;

-- Non-blocking hooks (e.g. a load was created): start the runs early so the task reaches people before departure.
create function app.po_emit(p_farm uuid, p_hook text, p_record jsonb) returns void
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  t public.ph_op_types;
  v public.ph_op_versions;
  v_kind text := (select subject_kind from app.po_hooks() h where h.hook = p_hook);
begin
  -- A blocking operation's run is started as soon as its subject exists, so the work is done before the protected step.
  for t in select * from public.ph_op_types where farm_id = p_farm and retired_at is null and voided_at is null and subject_kind = v_kind loop
    v := app.po_version_in_effect(t.id);
    continue when v.id is null;
    continue when (v.definition -> 'trigger' ->> 'hook') not in (p_hook, 'dispatch.before_depart');
    continue when not app.po_conds(app.po_subject_facts(v_kind, (p_record ->> 'id')::uuid), v.definition -> 'trigger' -> 'conditions');
    continue when exists (select 1 from public.ph_op_instances i join public.ph_op_versions vv on vv.id = i.op_version_id
                           where vv.op_type_id = t.id and i.subject_id = (p_record ->> 'id')::uuid and i.cancelled_at is null and i.voided_at is null);
    perform app.po_start_run(p_farm, t, v, v_kind, (p_record ->> 'id')::uuid, p_record ->> 'code', 'Started by ' || p_hook);
  end loop;
end;
$$;

-- The operations a subject has (starting any that apply but have not started, e.g. a load created before the operation was
-- published). Called by the dispatch screen; the scheduler tick does the same for every open load.
create function public.ph_subject_ops(p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_farm uuid;
begin
  if p_kind = 'load' then
    select farm_id into v_farm from public.ph_loads where id = p_id and voided_at is null and app.ph_is_member(farm_id) and status not in ('departed', 'cancelled');
    if v_farm is not null then
      perform app.po_emit(v_farm, 'dispatch.load_created', jsonb_build_object('id', p_id, 'code', (select code from public.ph_loads where id = p_id)));
    end if;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'op_code', r.op_code, 'name_ar', r.op_name_ar, 'name_en', r.op_name_en,
                                                       'run_state', r.run_state, 'current_step', r.current_step, 'version', r.version_no) order by r.created_at)
                     from public.ph_op_runs r where r.subject_id = p_id and app.ph_is_member(r.farm_id)), '[]');
end;
$$;

-- Start a manual run (operations whose trigger is "manual"), from the menu.
create function public.ph_op_start(p_code text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  t      public.ph_op_types;
  v      public.ph_op_versions;
  v_id   uuid;
  v_first text;
begin
  select * into t from public.ph_op_types where farm_id = v_farm and code = upper(trim(p_code)) and retired_at is null and voided_at is null;
  if not found then raise exception 'Operation not found or retired' using errcode = 'P0404', detail = jsonb_build_object('key', 'po.op.notFound')::text; end if;
  v := app.po_version_in_effect(t.id);
  if v.id is null or (v.definition -> 'trigger' ->> 'hook') <> 'manual' then
    raise exception 'This operation starts from its hook, not by hand' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.notManual')::text;
  end if;
  v_first := app.po_next_step(v.definition, 0, '{}');
  perform app.ph_authorize(v_farm, 'op_' || lower(t.code) || '.' || v_first);
  v_id := app.po_start_run(v_farm, t, v, 'standalone', null, null, p_note);
  return jsonb_build_object('id', v_id, 'code', (select code from public.ph_op_instances where id = v_id));
end;
$$;

-- Record the current step of a run: values checked against the field definitions; pass rules decide pass / fail; an approval step
-- must be done by a different person than the step before (segregation of duties).
create function public.ph_op_record_step(p_run uuid, p_step text, p_values jsonb, p_decision text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_op_instances;
  v       public.ph_op_versions;
  t       public.ph_op_types;
  s       jsonb;
  f       jsonb;
  vals    jsonb := coalesce(p_values, '{}');
  v_pass  boolean := true;
  v_next  text;
  v_prev_by uuid;
  v_goto  text;
  v_fail_action text;
  v_hold  jsonb;
begin
  select * into r from public.ph_op_instances where id = p_run and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Run not found' using errcode = 'P0404'; end if;
  select * into v from public.ph_op_versions where id = r.op_version_id;
  select * into t from public.ph_op_types where id = v.op_type_id;
  if r.completed_at is not null or r.cancelled_at is not null then
    raise exception 'This run is closed' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.closed')::text;
  end if;
  if r.current_step is distinct from p_step then
    raise exception 'Step % is not the current step (%)', p_step, r.current_step using errcode = 'P0409', detail = jsonb_build_object('key', 'po.op.notCurrent', 'current', r.current_step)::text;
  end if;
  s := app.po_step_def(v.definition, p_step);
  perform app.ph_authorize(r.farm_id, 'op_' || lower(t.code) || '.' || p_step);
  -- Fields: required, type and range.
  for f in select * from jsonb_array_elements(coalesce(s -> 'fields', '[]')) loop
    if coalesce((f ->> 'required')::boolean, false) and coalesce(trim(vals ->> (f ->> 'key')), '') = '' and jsonb_typeof(vals -> (f ->> 'key')) is distinct from 'array' then
      raise exception 'Field % is required', f ->> 'label_ar' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.required', 'field', f ->> 'key')::text;
    end if;
    if (f ->> 'type') = 'number' and coalesce(vals ->> (f ->> 'key'), '') <> '' then
      if (vals ->> (f ->> 'key')) !~ '^-?[0-9]+(\.[0-9]+)?$' then
        raise exception 'Field % must be a number', f ->> 'label_ar' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.number', 'field', f ->> 'key')::text;
      end if;
      if (f ->> 'min') is not null and (vals ->> (f ->> 'key'))::numeric < (f ->> 'min')::numeric
         or (f ->> 'max') is not null and (vals ->> (f ->> 'key'))::numeric > (f ->> 'max')::numeric then
        raise exception 'Field % is outside its allowed range', f ->> 'label_ar' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.range', 'field', f ->> 'key')::text;
      end if;
    end if;
    if (f ->> 'type') = 'select' and coalesce(vals ->> (f ->> 'key'), '') <> ''
       and not exists (select 1 from jsonb_array_elements(f -> 'options') o where o ->> 'value' = vals ->> (f ->> 'key')) then
      raise exception 'Field % has an unknown choice', f ->> 'label_ar' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.option', 'field', f ->> 'key')::text;
    end if;
  end loop;
  if (s ->> 'kind') = 'approval' then
    -- Authorised release: a decision, by someone other than whoever recorded the previous step.
    if p_decision not in ('approve', 'reject') then
      raise exception 'Approve or reject' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.op.decision')::text;
    end if;
    select (x.value ->> 'by')::uuid into v_prev_by from jsonb_each(r.step_values) x order by x.value ->> 'at' desc limit 1;
    if v_prev_by = app.current_user_id() then
      raise exception 'The person who recorded the step does not release it' using errcode = 'P0423', detail = jsonb_build_object('key', 'ph.sod', 'column', 'maker')::text;
    end if;
    v_pass := p_decision = 'approve';
    if not v_pass and coalesce(trim(p_note), '') = '' then
      raise exception 'A rejection needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text;
    end if;
  else
    v_pass := app.po_conds(vals, s -> 'pass_if');
  end if;
  update public.ph_op_instances set step_values = step_values || jsonb_build_object(p_step, jsonb_build_object('values', vals, 'by', app.current_user_id(),
           'by_name', (select full_name from public.user_profiles where id = app.current_user_id()), 'at', now(), 'passed', v_pass, 'decision', p_decision, 'note', p_note))
   where id = r.id returning * into r;
  if v_pass then
    v_next := app.po_next_step(v.definition, app.po_step_index(v.definition, p_step), app.po_run_facts(r));
    if v_next is null then
      update public.ph_op_instances set completed_at = now(), current_step = null, failed_at = null where id = r.id;
      update public.ph_tasks set completed_at = now(), completed_by = app.current_user_id(), completion_note = 'Operation completed'
       where op_instance_id = r.id and completed_at is null and cancelled_at is null;
    else
      update public.ph_op_instances set current_step = v_next, failed_at = null where id = r.id;
      -- The next step's role gets the task.
      update public.ph_tasks set assignee_role = (app.po_step_def(v.definition, v_next)) ->> 'role', assignee_user_id = null
       where op_instance_id = r.id and completed_at is null and cancelled_at is null;
      perform app.ph_notify_role(r.farm_id, (app.po_step_def(v.definition, v_next)) ->> 'role', 'po_task', 'ph_op_instances', r.id, jsonb_build_object('code', r.code));
    end if;
  else
    v_fail_action := coalesce(s -> 'on_fail' ->> 'action', 'block');
    v_goto := s -> 'on_fail' ->> 'goto';
    if v_fail_action = 'hold' and r.subject_kind = 'load' then
      -- Reusable action: place the load's allocated pallets on a quality hold (QC / QA raise it; release by the quality team).
      if exists (select 1 from public.ph_load_pallets lp join public.ph_fg_pallets f on f.id = lp.fg_pallet_id
                  where lp.load_id = r.subject_id and lp.removed_at is null and lp.voided_at is null and f.status in ('in_storage', 'allocated')) then
        v_hold := public.ph_raise_fg_hold('quality', t.name_ar || ': ' || coalesce(nullif(trim(p_note), ''), 'failed'),
          array(select lp.fg_pallet_id from public.ph_load_pallets lp join public.ph_fg_pallets f on f.id = lp.fg_pallet_id
                 where lp.load_id = r.subject_id and lp.removed_at is null and lp.voided_at is null and f.status in ('in_storage', 'allocated')));
      end if;
    end if;
    if v_goto is not null then
      update public.ph_op_instances set current_step = v_goto, failed_at = null where id = r.id;
    else
      update public.ph_op_instances set failed_at = now() where id = r.id;
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'passed', v_pass, 'next_step', (select current_step from public.ph_op_instances where id = r.id),
                            'completed', (select completed_at is not null from public.ph_op_instances where id = r.id), 'hold', v_hold);
end;
$$;

-- Loads hand their new record to the engine (non-blocking) so runs and tasks start early.
create or replace function public.ph_create_load(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_create_load');
  v_farm uuid := app.ph_farm_of_user();
  v_id   uuid := gen_random_uuid();
  v_code text;
  v_basis text;
  ol     uuid;
  v_cust uuid := nullif(p ->> 'customer_id', '')::uuid;
begin
  if v_seen is not null then return v_seen; end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  v_basis := app.ph_authorize(v_farm, 'load.create');
  if jsonb_array_length(coalesce(p -> 'order_line_ids', '[]')) = 0 then
    raise exception 'A load serves at least one accepted order line' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.noLines')::text;
  end if;
  if v_cust is not null and not app.ph_approved('ph_customers', v_cust, v_farm) then
    raise exception 'Customer not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', 'customer')::text;
  end if;
  v_code := app.ph_code(v_farm, 'LD', 3);
  insert into public.ph_loads (id, farm_id, code, customer_id, customer_text, destination, planned_loading_at, vehicle_plate, driver_name, notes)
  values (v_id, v_farm, v_code, v_cust, nullif(trim(p ->> 'customer_text'), ''), nullif(trim(p ->> 'destination'), ''),
          nullif(p ->> 'planned_loading_at', '')::timestamptz, nullif(trim(p ->> 'vehicle_plate'), ''), nullif(trim(p ->> 'driver_name'), ''),
          nullif(trim(p ->> 'notes'), ''));
  for ol in select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'order_line_ids') x loop
    if not exists (select 1 from public.ph_order_lines where id = ol and farm_id = v_farm and status = 'accepted' and voided_at is null) then
      raise exception 'Only accepted order lines can be loaded' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.load.lineNotAccepted')::text;
    end if;
    insert into public.ph_load_lines (farm_id, load_id, order_line_id) values (v_farm, v_id, ol);
  end loop;
  perform app.po_emit(v_farm, 'dispatch.load_created', jsonb_build_object('id', v_id, 'code', v_code));
  return app.ph_request_done(p_request_id, 'ph_create_load', v_farm, jsonb_build_object('id', v_id, 'code', v_code, 'basis', v_basis));
end;
$$;

create view public.ph_op_runs with (security_invoker = true) as
  select i.id, i.farm_id, i.code, t.code as op_code, t.name_ar as op_name_ar, t.name_en as op_name_en, v.version_no, v.definition,
         i.subject_kind, i.subject_id, i.subject_code, i.current_step, i.step_values, i.created_at, i.completed_at, i.failed_at, i.cancelled_at, i.cancel_reason,
         case when i.cancelled_at is not null then 'cancelled' when i.completed_at is not null then 'completed'
              when i.failed_at is not null then 'failed' else 'open' end as run_state,
         t.retired_at is not null as op_retired
    from public.ph_op_instances i join public.ph_op_versions v on v.id = i.op_version_id join public.ph_op_types t on t.id = v.op_type_id
   where i.voided_at is null;

-- =============================================================================================
-- 7. Tasks: create, assign, start, complete, cancel, reopen, comment; scheduler tick (recurring work, escalation)
-- =============================================================================================
create function public.ph_task_create(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen jsonb := app.ph_request_seen(p_request_id, 'ph_task_create');
  v_farm uuid := app.ph_farm_of_user();
  v_id   uuid := gen_random_uuid();
  v_code text;
begin
  if v_seen is not null then return v_seen; end if;
  perform app.ph_authorize(v_farm, 'task.create');
  if coalesce(trim(p ->> 'title'), '') = '' then raise exception 'Give the task a title' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.task.title')::text; end if;
  if (p ->> 'assignee_role') is null and (p ->> 'assignee_user_id') is null then
    raise exception 'Assign the task to a role or a person' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.task.assignee')::text;
  end if;
  v_code := app.ph_code(v_farm, 'TSK', 4);
  insert into public.ph_tasks (id, farm_id, code, title, details, assignee_role, assignee_user_id, line_id, due_at, priority, source, escalate_after_min, escalate_to_role)
  values (v_id, v_farm, v_code, trim(p ->> 'title'), nullif(trim(p ->> 'details'), ''), nullif(p ->> 'assignee_role', ''), nullif(p ->> 'assignee_user_id', '')::uuid,
          nullif(p ->> 'line_id', '')::uuid, nullif(p ->> 'due_at', '')::timestamptz, coalesce(nullif(p ->> 'priority', ''), 'normal'), 'manual',
          nullif(p ->> 'escalate_after_min', '')::int, nullif(p ->> 'escalate_to_role', ''));
  if (p ->> 'assignee_user_id') is not null then
    perform app.ph_notify_user(v_farm, (p ->> 'assignee_user_id')::uuid, 'po_task', 'ph_tasks', v_id, jsonb_build_object('code', v_code));
  else
    perform app.ph_notify_role(v_farm, p ->> 'assignee_role', 'po_task', 'ph_tasks', v_id, jsonb_build_object('code', v_code));
  end if;
  return app.ph_request_done(p_request_id, 'ph_task_create', v_farm, jsonb_build_object('id', v_id, 'code', v_code));
end;
$$;

-- Mine: assigned to me, or to a role I hold (on my line when the task names a line).
create function app.po_task_mine(t public.ph_tasks) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce(t.assignee_user_id = app.current_user_id(), false)
      or (t.assignee_user_id is null and coalesce(t.assignee_role = any (app.ph_user_spec_roles_at(app.current_user_id(), t.farm_id, t.line_id)), false))
$$;

create function public.ph_task_step(p_task uuid, p_step text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare t public.ph_tasks;
begin
  select * into t from public.ph_tasks where id = p_task and voided_at is null and app.ph_is_member(farm_id) for update;
  if not found then raise exception 'Task not found' using errcode = 'P0404'; end if;
  case p_step
  when 'start' then
    if not app.po_task_mine(t) then raise exception 'Not your task' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.task.notMine')::text; end if;
    update public.ph_tasks set started_at = coalesce(started_at, now()) where id = t.id;
  when 'complete' then
    if not app.po_task_mine(t) then raise exception 'Not your task' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.task.notMine')::text; end if;
    if t.op_instance_id is not null then
      raise exception 'This task completes when its operation is recorded' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.task.byOperation')::text;
    end if;
    if t.completed_at is not null then return jsonb_build_object('id', t.id, 'repeated', true); end if;
    update public.ph_tasks set completed_at = now(), completed_by = app.current_user_id(), completion_note = nullif(trim(p ->> 'note'), ''),
           evidence_ids = coalesce(array(select (jsonb_array_elements_text(coalesce(p -> 'evidence_ids', '[]')))::uuid), '{}') where id = t.id;
  when 'reassign' then
    perform app.ph_authorize(t.farm_id, 'task.create');
    if coalesce(trim(p ->> 'reason'), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
    perform set_config('app.audit_comment', p ->> 'reason', true);
    update public.ph_tasks set assignee_role = nullif(p ->> 'assignee_role', ''), assignee_user_id = nullif(p ->> 'assignee_user_id', '')::uuid,
           due_at = coalesce(nullif(p ->> 'due_at', '')::timestamptz, due_at) where id = t.id;
  when 'cancel' then
    perform app.ph_authorize(t.farm_id, 'task.cancel');
    if coalesce(trim(p ->> 'reason'), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
    update public.ph_tasks set cancelled_at = now(), cancel_reason = p ->> 'reason' where id = t.id and completed_at is null;
  when 'reopen' then
    perform app.ph_authorize(t.farm_id, 'task.cancel');
    if coalesce(trim(p ->> 'reason'), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
    perform set_config('app.audit_comment', p ->> 'reason', true);
    update public.ph_tasks set completed_at = null, completed_by = null, cancelled_at = null, cancel_reason = null where id = t.id and op_instance_id is null;
  when 'comment' then
    if coalesce(trim(p ->> 'body'), '') = '' then raise exception 'Write the comment' using errcode = 'P0422'; end if;
    insert into public.ph_task_comments (farm_id, task_id, body) values (t.farm_id, t.id, trim(p ->> 'body'));
  else
    raise exception 'Unknown step' using errcode = 'P0422';
  end case;
  return jsonb_build_object('id', t.id, 'step', p_step);
end;
$$;

create view public.ph_task_board with (security_invoker = true) as
  select t.id, t.farm_id, t.code, t.title, t.details, t.assignee_role, t.assignee_user_id, up.full_name as assignee_name, t.line_id, l.code as line_code,
         t.due_at, t.priority, t.source, t.op_instance_id, i.code as op_run_code, t.escalated_at, t.escalate_to_role, t.started_at, t.completed_at,
         t.completion_note, t.cancelled_at, t.cancel_reason, t.created_at, t.version,
         case when t.cancelled_at is not null then 'cancelled' when t.completed_at is not null then 'done'
              when t.due_at is not null and t.due_at < now() then 'overdue' when t.started_at is not null then 'in_progress' else 'open' end as task_state,
         app.po_task_mine(t) as is_mine,
         (select coalesce(jsonb_agg(jsonb_build_object('body', c.body, 'at', c.created_at, 'by', cp.full_name) order by c.created_at), '[]')
            from public.ph_task_comments c left join public.user_profiles cp on cp.id = c.created_by where c.task_id = t.id) as comments
    from public.ph_tasks t
    left join public.user_profiles up on up.id = t.assignee_user_id
    left join public.ph_lines l on l.id = t.line_id
    left join public.ph_op_instances i on i.id = t.op_instance_id
   where t.voided_at is null and (app.po_task_mine(t) or app.ph_can(t.farm_id, 'task.view_all') or t.created_by = app.current_user_id());

create function public.ph_task_template_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_farm uuid := app.ph_farm_of_user(); v_id uuid := gen_random_uuid();
begin
  perform app.ph_authorize(v_farm, 'task.create');
  if coalesce(trim(p ->> 'title'), '') = '' or coalesce(p ->> 'assignee_role', '') = '' then
    raise exception 'Title and role are required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.task.title')::text;
  end if;
  insert into public.ph_task_templates (id, farm_id, title, details, assignee_role, line_id, every_days, at_time, weekdays, due_minutes, escalate_after_min, escalate_to_role, next_run_at)
  values (v_id, v_farm, trim(p ->> 'title'), nullif(trim(p ->> 'details'), ''), p ->> 'assignee_role', nullif(p ->> 'line_id', '')::uuid,
          nullif(p ->> 'every_days', '')::int, coalesce(nullif(p ->> 'at_time', '')::time, '06:00'),
          case when jsonb_typeof(p -> 'weekdays') = 'array' then array(select (jsonb_array_elements_text(p -> 'weekdays'))::int) end,
          coalesce(nullif(p ->> 'due_minutes', '')::int, 120), nullif(p ->> 'escalate_after_min', '')::int, nullif(p ->> 'escalate_to_role', ''),
          ((app.ph_local_date() + 1) + coalesce(nullif(p ->> 'at_time', '')::time, '06:00')) at time zone 'Asia/Amman');
  return jsonb_build_object('id', v_id);
end;
$$;

-- Scheduler tick (the packhouse server calls it every few minutes): recurring tasks that are due, escalation of overdue tasks.
create function public.po_scheduler_tick() returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  tp  public.ph_task_templates;
  t   public.ph_tasks;
  n_new integer := 0;
  n_esc integer := 0;
  v_next timestamptz;
begin
  for tp in select * from public.ph_task_templates where active and voided_at is null and next_run_at <= now() for update skip locked loop
    if tp.weekdays is null or extract(isodow from (tp.next_run_at at time zone 'Asia/Amman'))::int = any (tp.weekdays) then
      perform set_config('app.acting_user_id', tp.created_by::text, true);
      insert into public.ph_tasks (farm_id, code, title, details, assignee_role, line_id, due_at, source, template_id, escalate_after_min, escalate_to_role)
      values (tp.farm_id, app.ph_code(tp.farm_id, 'TSK', 4), tp.title, tp.details, tp.assignee_role, tp.line_id,
              tp.next_run_at + make_interval(mins => tp.due_minutes), 'schedule', tp.id, tp.escalate_after_min, tp.escalate_to_role);
      perform app.ph_notify_role(tp.farm_id, tp.assignee_role, 'po_task', 'ph_task_templates', tp.id, jsonb_build_object('title', tp.title));
      n_new := n_new + 1;
    end if;
    v_next := tp.next_run_at + make_interval(days => coalesce(tp.every_days, 1));
    update public.ph_task_templates set next_run_at = v_next where id = tp.id;
  end loop;
  for t in select * from public.ph_tasks where voided_at is null and completed_at is null and cancelled_at is null and escalated_at is null
              and escalate_after_min is not null and escalate_to_role is not null and due_at is not null
              and due_at + make_interval(mins => escalate_after_min) < now() for update skip locked loop
    perform set_config('app.acting_user_id', coalesce(t.created_by, t.updated_by)::text, true);
    update public.ph_tasks set escalated_at = now() where id = t.id;
    perform app.ph_notify_role(t.farm_id, t.escalate_to_role, 'po_task_escalated', 'ph_tasks', t.id, jsonb_build_object('code', t.code));
    n_esc := n_esc + 1;
  end loop;
  perform app.po_emit(l.farm_id, 'dispatch.load_created', jsonb_build_object('id', l.id, 'code', l.code))
     from public.ph_loads l
    where l.voided_at is null and l.status not in ('departed', 'cancelled')
      and exists (select 1 from public.ph_op_types ot where ot.farm_id = l.farm_id and ot.subject_kind = 'load' and ot.retired_at is null and ot.voided_at is null);
  return jsonb_build_object('created', n_new, 'escalated', n_esc);
end;
$$;
revoke all on function public.po_scheduler_tick() from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'po_auth') then grant execute on function public.po_scheduler_tick() to po_auth; end if; end $$;

-- =============================================================================================
-- 8. KPI cards: datasets (whitelist), definition validation, evaluation
-- =============================================================================================
create function app.po_kpi_datasets() returns table (dataset text, time_column text, columns text[], numeric_columns text[], label_en text, label_ar text)
language sql immutable as $$
  values
   ('output', 'period_end', array['line_code', 'grade', 'pack_code', 'crop_code', 'customer', 'conforming', 'worker_or_team'], array['kg', 'boxes'],
    'Packed output (labour sheet)', 'الإنتاج المعبّأ (كشف العمالة)'),
   ('downtime', 'stopped_at', array['line_codes', 'cause_code', 'is_open'], array['minutes'], 'Line stops', 'توقفات الخطوط'),
   ('op_runs', 'created_at', array['op_code', 'run_state', 'subject_code', 'current_step'], array['age_minutes'], 'Operation runs (Settings)', 'تشغيلات العمليات (الإعدادات)'),
   ('tasks', 'created_at', array['task_state', 'assignee_role', 'source', 'priority', 'line_code'], array['age_minutes'], 'Tasks', 'المهام'),
   ('loads', 'created_at', array['status', 'customer'], array['allocated_kg'], 'Loads', 'الحمولات'),
   ('fg_stock', 'created_at', array['status', 'grade', 'crop_code', 'location'], array['net_kg', 'boxes'], 'Finished stock', 'المخزون النهائي')
$$;

create function app.po_kpi_source(p_dataset text) returns text
language sql immutable as $$
  select case p_dataset
    when 'output' then $q$(select o.farm_id, o.period_end, l.code as line_code, o.grade, pf.code as pack_code,
                                 coalesce(cj.code, co.code, pf.crop_code) as crop_code, coalesce(cu.code, ol.customer_name) as customer,
                                 o.conforming::text as conforming, case when o.team_session_id is null then 'worker' else 'team' end as worker_or_team,
                                 o.kg, o.boxes::numeric as boxes
                            from public.ph_output_entries o join public.ph_line_shifts ls on ls.id = o.line_shift_id join public.ph_lines l on l.id = ls.line_id
                            join public.ph_pack_formats pf on pf.id = o.pack_format_id left join public.ph_job_cards jc on jc.id = o.job_card_id
                            left join public.ph_crops cj on cj.id = jc.crop_id left join public.ph_order_lines ol on ol.id = o.order_line_id
                            left join public.ph_crops co on co.id = ol.crop_id left join public.ph_customers cu on cu.id = ol.customer_id
                           where o.voided_at is null)$q$
    when 'downtime' then $q$(select farm_id, stopped_at, array_to_string(line_codes, ',') as line_codes, cause_code, is_open::text as is_open,
                                   minutes_to_now as minutes from public.ph_downtime_log)$q$
    when 'op_runs' then $q$(select farm_id, created_at, op_code, run_state, subject_code, current_step,
                                  round(extract(epoch from now() - created_at) / 60.0, 1) as age_minutes from public.ph_op_runs)$q$
    when 'tasks' then $q$(select farm_id, created_at, task_state, assignee_role, source, priority, line_code,
                                round(extract(epoch from now() - created_at) / 60.0, 1) as age_minutes from public.ph_task_board)$q$
    when 'loads' then $q$(select farm_id, created_at, status, customer, allocated_kg from public.ph_load_board)$q$
    when 'fg_stock' then $q$(select f.farm_id, f.created_at, f.status, f.grade, c.code as crop_code, lo.code as location, f.net_kg, f.box_count::numeric as boxes
                                from public.ph_fg_pallets f join public.ph_crops c on c.id = f.crop_id left join public.ph_locations lo on lo.id = f.location_id
                               where f.voided_at is null)$q$
  end
$$;

create function public.ph_kpi_validate(p_def jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  ds   record;
  errs jsonb := '[]';
  f    jsonb;
  m    text := p_def ->> 'measure';
begin
  select * into ds from app.po_kpi_datasets() d where d.dataset = p_def ->> 'dataset';
  if not found then return jsonb_build_array(jsonb_build_object('key', 'kpiDataset')); end if;
  if m not in ('count', 'sum', 'avg', 'ratio', 'rate_per_hour') then errs := errs || '[{"key":"kpiMeasure"}]'; end if;
  if m in ('sum', 'avg', 'rate_per_hour') and not (p_def ->> 'field') = any (ds.numeric_columns) then errs := errs || '[{"key":"kpiField"}]'; end if;
  if m = 'ratio' and (p_def -> 'numerator_filters') is null then errs := errs || '[{"key":"kpiRatio"}]'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_def -> 'filters', '[]') || coalesce(p_def -> 'numerator_filters', '[]')) loop
    if (f ->> 'field') = any (ds.columns) then
      if (f ->> 'op') not in ('eq', 'neq') then errs := errs || jsonb_build_array(jsonb_build_object('key', 'kpiFilterOp', 'field', f ->> 'field')); end if;
    elsif (f ->> 'field') = any (ds.numeric_columns) then
      if (f ->> 'op') not in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte') or (f ->> 'value') !~ '^-?[0-9]+(\.[0-9]+)?$' then
        errs := errs || jsonb_build_array(jsonb_build_object('key', 'kpiFilterOp', 'field', f ->> 'field'));
      end if;
    else
      errs := errs || jsonb_build_array(jsonb_build_object('key', 'kpiFilterField', 'field', f ->> 'field'));
    end if;
  end loop;
  if jsonb_array_length(coalesce(p_def -> 'filters', '[]')) + jsonb_array_length(coalesce(p_def -> 'numerator_filters', '[]')) > 5 then
    errs := errs || '[{"key":"kpiTooManyFilters"}]';
  end if;
  if (p_def ->> 'group_by') is not null and not (p_def ->> 'group_by') = any (ds.columns || array['day']) then errs := errs || '[{"key":"kpiGroup"}]'; end if;
  if coalesce(trim(p_def ->> 'title_ar'), '') = '' then errs := errs || '[{"key":"kpiTitle"}]'; end if;
  if (p_def ->> 'window') not in ('today', 'shift_day', '7d', '30d', 'open_now') then errs := errs || '[{"key":"kpiWindow"}]'; end if;
  if m = 'rate_per_hour' and (p_def ->> 'window') = 'open_now' then errs := errs || '[{"key":"kpiRateWindow"}]'; end if;
  if (p_def ->> 'target') is not null and (p_def ->> 'target') !~ '^-?[0-9]+(\.[0-9]+)?$' then errs := errs || '[{"key":"kpiTarget"}]'; end if;
  return errs;
end;
$$;

-- Evaluate a KPI definition for a window. Identifiers come only from the whitelist; filter values are bound parameters.
create function public.ph_kpi_eval(p_def jsonb, p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  ds     record;
  errs   jsonb := public.ph_kpi_validate(p_def);
  v_from timestamptz;
  v_to   timestamptz;
  w      text := p_def ->> 'window';
  v_where text := 'farm_id = $1';
  v_numw  text := 'true';
  f       jsonb;
  vals    text[] := '{}';
  i       integer := 4;
  v_meas  text;
  v_group text := p_def ->> 'group_by';
  v_sql   text;
  res     jsonb;
  op      text;
begin
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  perform app.ph_authorize(v_farm, 'report.kpi_view');
  if jsonb_array_length(errs) > 0 then
    raise exception 'KPI definition has problems' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.kpi.invalid', 'errors', errs)::text;
  end if;
  select * into ds from app.po_kpi_datasets() d where d.dataset = p_def ->> 'dataset';
  v_to := coalesce(p_to, now());
  v_from := coalesce(p_from, case w when 'today' then lower(app.po_day_window(app.ph_local_date())) when '7d' then now() - interval '7 days'
                                    when '30d' then now() - interval '30 days' when 'shift_day' then lower(app.po_day_window(app.ph_local_date())) end);
  if w = 'open_now' then v_from := null; end if;
  if w <> 'open_now' then v_where := v_where || format(' and %I >= $2::timestamptz and %I <= $3::timestamptz', ds.time_column, ds.time_column); end if;
  for f in select * from jsonb_array_elements(coalesce(p_def -> 'filters', '[]')) loop
    op := case f ->> 'op' when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'lt' then '<' when 'gte' then '>=' when 'lte' then '<=' end;
    if (f ->> 'field') = any (ds.numeric_columns) then
      v_where := v_where || format(' and %I %s $%s::numeric', f ->> 'field', op, i);
    else
      v_where := v_where || format(' and %I::text %s $%s', f ->> 'field', op, i);
    end if;
    vals := vals || (f ->> 'value'); i := i + 1;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(p_def -> 'numerator_filters', '[]')) loop
    op := case f ->> 'op' when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'lt' then '<' when 'gte' then '>=' when 'lte' then '<=' end;
    if (f ->> 'field') = any (ds.numeric_columns) then
      v_numw := v_numw || format(' and %I %s $%s::numeric', f ->> 'field', op, i);
    else
      v_numw := v_numw || format(' and %I::text %s $%s', f ->> 'field', op, i);
    end if;
    vals := vals || (f ->> 'value'); i := i + 1;
  end loop;
  v_meas := case p_def ->> 'measure'
    when 'count' then 'count(*)::numeric'
    when 'sum' then format('sum(%I)', p_def ->> 'field')
    when 'avg' then format('avg(%I)', p_def ->> 'field')
    when 'ratio' then format('case when count(*) > 0 then round(100.0 * count(*) filter (where %s) / count(*), 1) end', v_numw)
    when 'rate_per_hour' then format('case when extract(epoch from ($3::timestamptz - $2::timestamptz)) > 0 then round(coalesce(sum(%I), 0) / (extract(epoch from ($3::timestamptz - $2::timestamptz)) / 3600.0), 2) end', p_def ->> 'field')
  end;
  v_sql := format('select coalesce(jsonb_agg(jsonb_build_object(''group'', g, ''value'', v, ''n'', n) order by g nulls first), ''[]'') from (select %s as g, %s as v, count(*) as n from %s src where %s %s) q',
                  case when v_group is null then 'null::text' when v_group = 'day' then format('to_char(%I at time zone ''Asia/Amman'', ''YYYY-MM-DD'')', ds.time_column)
                       else format('%I::text', v_group) end,
                  v_meas, app.po_kpi_source(ds.dataset), v_where, case when v_group is null then '' else 'group by 1' end);
  execute v_sql into res using v_farm, v_from, v_to, vals[1], vals[2], vals[3], vals[4], vals[5];
  return jsonb_build_object('rows', res, 'from', v_from, 'to', v_to, 'unit', p_def ->> 'unit', 'target', p_def -> 'target');
exception when undefined_parameter or syntax_error then
  raise exception 'KPI could not be evaluated' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.kpi.eval')::text;
end;
$$;

create function public.ph_kpi_save(p_code text, p_def jsonb, p_publish boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  v_code text := upper(trim(p_code));
  d      public.ph_kpi_defs;
  errs   jsonb := public.ph_kpi_validate(p_def);
  v_ver  integer;
begin
  perform app.ph_authorize(v_farm, case when p_publish then 'settings.publish' else 'settings.edit' end);
  if v_code !~ '^[A-Z][A-Z0-9_]{1,31}$' then raise exception 'KPI codes are capital letters, digits or underscore' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.kpi.code')::text; end if;
  if p_publish and jsonb_array_length(errs) > 0 then
    raise exception 'KPI definition has problems' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.kpi.invalid', 'errors', errs)::text;
  end if;
  select * into d from public.ph_kpi_defs where farm_id = v_farm and code = v_code and state = 'draft' and voided_at is null for update;
  if found then
    update public.ph_kpi_defs set definition = p_def where id = d.id returning * into d;
  else
    select coalesce(max(version_no), 0) + 1 into v_ver from public.ph_kpi_defs where farm_id = v_farm and code = v_code and voided_at is null;
    insert into public.ph_kpi_defs (farm_id, code, version_no, state, definition, sort_order)
    values (v_farm, v_code, v_ver, 'draft', p_def, coalesce((p_def ->> 'sort_order')::int, 100)) returning * into d;
  end if;
  if p_publish then
    update public.ph_kpi_defs set state = 'superseded' where farm_id = v_farm and code = v_code and state = 'published' and voided_at is null;
    update public.ph_kpi_defs set state = 'published', effective_from = now(), published_by = app.current_user_id(), published_at = now(),
           sort_order = coalesce((p_def ->> 'sort_order')::int, sort_order) where id = d.id;
    insert into public.ph_access_events (farm_id, event, after, reason) values (v_farm, 'kpi_published', jsonb_build_object('code', v_code, 'version', d.version_no), p_note);
  end if;
  return jsonb_build_object('code', v_code, 'version', d.version_no, 'published', p_publish, 'errors', errs);
end;
$$;

create function public.ph_kpi_retire(p_code text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_farm uuid := app.ph_farm_of_user();
begin
  perform app.ph_authorize(v_farm, 'settings.publish');
  update public.ph_kpi_defs set state = 'retired' where farm_id = v_farm and code = upper(trim(p_code)) and state = 'published' and voided_at is null;
  insert into public.ph_access_events (farm_id, event, after, reason) values (v_farm, 'kpi_retired', jsonb_build_object('code', upper(trim(p_code))), p_reason);
  return jsonb_build_object('code', upper(trim(p_code)), 'retired', true);
end;
$$;

-- The cards a person sees on the management overview: published, visible to one of their roles, in order, with values.
create function public.ph_my_kpi_cards() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm  uuid := app.ph_farm_of_user();
  v_roles text[] := app.ph_user_spec_roles(app.current_user_id(), v_farm);
  d       public.ph_kpi_defs;
  out     jsonb := '[]';
  v       jsonb;
begin
  if not app.ph_can(v_farm, 'report.kpi_view') then return '[]'; end if;
  for d in select * from public.ph_kpi_defs where farm_id = v_farm and state = 'published' and voided_at is null order by sort_order, code loop
    continue when jsonb_array_length(coalesce(d.definition -> 'roles', '[]')) > 0
                  and not exists (select 1 from jsonb_array_elements_text(d.definition -> 'roles') r where r = any (v_roles));
    begin
      v := public.ph_kpi_eval(d.definition);
    exception when others then
      v := jsonb_build_object('error', sqlerrm);
    end;
    out := out || jsonb_build_array(jsonb_build_object('code', d.code, 'version', d.version_no, 'definition', d.definition, 'result', v));
  end loop;
  return out;
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
  perform app.seed_po_dispatch(p_farm);
  perform app.seed_po_identity(p_farm);
  perform app.seed_po_config_engine(p_farm);
end $$;

select app.seed_po_config_engine(id) from public.farms;
select app.apply_api_grants();
revoke all on function public.po_scheduler_tick() from anon, authenticated;
