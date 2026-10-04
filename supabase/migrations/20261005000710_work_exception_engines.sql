-- Phase 2: work engine (plans → work orders → tasks → execution entries → verification) and
-- exception engine (problem reports → triage → work, escalation, notifications), plus comments,
-- attachments and the Operations board view.
--
-- 6:00 AM design target (Master Prompt §4.6): a supervisor sees today's assigned tasks, starts one,
-- records crew hours and machine use, blocks a task with a reason when a machine is unavailable,
-- reports a breakdown from inside the task, and Operations sees planned / late / blocked / waiting
-- verification across departments — all enforced in the database.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------------------------
create table public.task_types (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null,
  name_ar                 text not null,
  name_en                 text,
  department_id           uuid references public.departments(id),
  requires_verification   boolean not null default true,
  allow_self_verification boolean not null default false,
  search_text             text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.task_types is
  'Configurable activity types per department (not crop-specific code). Verification policy per type: whether '
  'completion needs verification, and whether a single person may self-verify (a logged SoD exception for small crews, §2.5).';
select app.register_table('public.task_types', 'task_type', true, p_department_column => 'department_id');
alter table public.task_types add constraint task_types_code_uq unique (farm_id, code);

create table public.plans (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  period_start  date not null,
  period_end    date not null,
  title         text not null,
  notes         text,
  check (period_end >= period_start)
);
comment on table public.plans is 'A department''s plan for a period (day, week, season); groups the tasks planned for it.';
select app.register_table('public.plans', 'plan', false, p_department_column => 'department_id');

create table public.work_orders (
  id                       uuid primary key default gen_random_uuid(),
  wo_no                    bigint generated always as identity,
  code                     text generated always as ('WO-' || lpad(wo_no::text, 6, '0')) stored,
  department_id            uuid not null references public.departments(id),
  location_id              uuid references public.locations(id),
  asset_id                 uuid references public.assets(id),
  purpose                  text not null,
  window_start             timestamptz,
  window_end               timestamptz,
  source_problem_report_id uuid,
  check (window_end is null or window_start is null or window_end > window_start)
);
comment on table public.work_orders is
  'Authorised work (purpose, place, window, resources) that groups one or more tasks — e.g. the repair created '
  'from a breakdown report. Maintenance-specific work-order states extend this in Phase 5.';
select app.register_table('public.work_orders', 'work_order', false,
  p_department_column => 'department_id', p_location_column => 'location_id');

-- ---------------------------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------------------------
create table public.tasks (
  id                       uuid primary key default gen_random_uuid(),
  task_no                  bigint generated always as identity,
  code                     text generated always as ('T-' || lpad(task_no::text, 6, '0')) stored,
  task_type_id             uuid not null references public.task_types(id),
  department_id            uuid not null references public.departments(id),
  location_id              uuid references public.locations(id),
  asset_id                 uuid references public.assets(id),
  work_order_id            uuid references public.work_orders(id),
  plan_id                  uuid references public.plans(id),
  source_problem_report_id uuid,
  title                    text not null check (length(trim(title)) > 0),
  instructions             text,
  priority                 smallint not null default 3 check (priority between 1 and 4),
  planned_date             date,
  window_start             timestamptz,
  window_end               timestamptz,
  planned_quantity         numeric check (planned_quantity is null or planned_quantity >= 0),
  quantity_unit_id         uuid references public.units(id),
  actual_quantity          numeric check (actual_quantity is null or actual_quantity >= 0),
  completion_note          text,
  requested_by             uuid references auth.users(id),
  supervisor_id            uuid references public.user_profiles(id),
  crew_id                  uuid references public.crews(id),
  assigned_by              uuid references auth.users(id),
  started_by               uuid references auth.users(id),
  completed_by             uuid references auth.users(id),
  verified_by              uuid references auth.users(id),
  closed_by                uuid references auth.users(id),
  blocked_reason           text check (blocked_reason in ('material', 'equipment', 'water', 'labour', 'weather', 'access', 'other')),
  blocked_note             text,
  blocked_problem_report_id uuid,
  blocked_issue_request_id  uuid,
  rejection_count          integer not null default 0,
  search_text              text generated always as (app.normalize_ar(title || ' ' || coalesce(instructions, ''))) stored,
  check (window_end is null or window_start is null or window_end > window_start),
  check ((planned_quantity is null and actual_quantity is null) or quantity_unit_id is not null)
);
comment on table public.tasks is
  'The assignable unit of field work: what, where, when, who supervises, which crew, resources, execution and '
  'verification. Every status change goes through transition_record() (workflow "task"). Domain-specific fields '
  'for high-value types live in 1:1 extension tables in later phases.';
select app.register_table('public.tasks', 'task', false, 'task',
  p_department_column => 'department_id', p_location_column => 'location_id', p_default_policies => false);
create index tasks_board_idx on public.tasks (farm_id, planned_date, status) where voided_at is null;
create index tasks_supervisor_idx on public.tasks (supervisor_id, planned_date) where voided_at is null;
create policy tasks_select on public.tasks for select to authenticated using (app.is_farm_member(farm_id));
-- Creating work: department planners, supervisors (unplanned field work) and Operations (cross-department requests).
create policy tasks_insert on public.tasks for insert to authenticated
  with check (app.has_permission(farm_id, 'task', 'create', department_id, location_id));
-- Editing plan details (title, date, supervisor/crew reassignment) is a planning act; status is guarded separately.
create policy tasks_update on public.tasks for update to authenticated
  using (app.has_permission(farm_id, 'task', 'plan', department_id, location_id))
  with check (app.has_permission(farm_id, 'task', 'plan', department_id, location_id));

-- The time after which an open task counts as late: end of window, else end of the planned day (farm time zone).
create function app.task_due_at(p_planned_date date, p_window_end timestamptz) returns timestamptz
language sql stable
as $$ select coalesce(p_window_end, ((p_planned_date + 1)::timestamp at time zone 'Asia/Amman')) $$;

create function app.guard_task_requires_verification(p_rec jsonb) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$ select requires_verification from public.task_types where id = (p_rec ->> 'task_type_id')::uuid $$;

create function app.guard_task_no_verification(p_rec jsonb) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$ select not requires_verification from public.task_types where id = (p_rec ->> 'task_type_id')::uuid $$;

create function app.sod_exception_tasks(p_rec jsonb, p_column text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$ select allow_self_verification from public.task_types where id = (p_rec ->> 'task_type_id')::uuid $$;

create table public.task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id),
  label      text not null,
  sort_order integer not null default 0,
  is_done    boolean not null default false,
  done_by    uuid references auth.users(id),
  done_at    timestamptz
);
comment on table public.task_checklist_items is 'Steps to tick off while executing a task (set by the planner, ticked by the executor).';
select app.register_table('public.task_checklist_items', 'task', false, p_default_policies => false);

create table public.labour_entries (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id),
  worker_id  uuid references public.workers(id),
  crew_id    uuid references public.crews(id),
  headcount  integer check (headcount is null or headcount > 0),
  hours      numeric not null check (hours > 0 and hours <= 24),
  work_date  date not null default current_date,
  pay_basis_ref text,
  note       text,
  check (worker_id is not null or (crew_id is not null and headcount is not null))
);
comment on table public.labour_entries is
  'Labour actually spent on a task: per worker, or per crew with a headcount. Workers from another department '
  'may be recorded on this task (cross-department crews). Pay basis is a nullable reference until the labour model is known (E7).';
select app.register_table('public.labour_entries', 'task', false, p_default_policies => false);
create index labour_entries_task_idx on public.labour_entries (task_id) where voided_at is null;

create table public.machine_entries (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references public.tasks(id),
  asset_id uuid not null references public.assets(id),
  hours    numeric check (hours is null or (hours > 0 and hours <= 24)),
  km       numeric check (km is null or km > 0),
  note     text,
  check (hours is not null or km is not null)
);
comment on table public.machine_entries is 'Machine/vehicle use on a task (hours or km) — feeds fleet usage and costing later.';
select app.register_table('public.machine_entries', 'task', false, p_default_policies => false);
create index machine_entries_task_idx on public.machine_entries (task_id) where voided_at is null;

-- Entries follow their task: planners set planned items before work starts; executors record actuals
-- while work is active; after completion entries are locked (changes need the task reopened, which is
-- audited and forces re-verification) — Master Prompt §2.6a.
create function app.task_entry_guard() returns trigger
language plpgsql
as $$
declare
  t        public.tasks;
  n        jsonb := to_jsonb(new);
  o        jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  planning boolean;
begin
  select * into t from public.tasks where id = new.task_id;
  if not found or t.farm_id <> new.farm_id then
    raise exception 'Task not found' using errcode = 'P0404';
  end if;

  planning := case tg_table_name
    when 'task_checklist_items' then tg_op = 'INSERT' or (n ->> 'label') is distinct from (o ->> 'label')
    -- compare as text: a JSON null and a missing key must both read as SQL NULL
    when 'material_consumptions' then (n ->> 'planned_qty') is distinct from (o ->> 'planned_qty')
                                      and (n ->> 'actual_qty') is not distinct from (o ->> 'actual_qty')
    else false
  end;

  if planning then
    if t.status not in ('draft', 'planned', 'assigned') then
      raise exception 'Planned items can only change before work starts' using errcode = 'P0422';
    end if;
    if not app.has_permission(t.farm_id, 'task', 'plan', t.department_id, t.location_id) then
      raise exception 'You do not have permission to plan this task' using errcode = 'P0403';
    end if;
  else
    if t.status not in ('assigned', 'in_progress', 'blocked') then
      raise exception 'Execution records can only change while the task is active (status %)', t.status using errcode = 'P0422';
    end if;
    if not app.has_permission(t.farm_id, 'task', 'execute', t.department_id, t.location_id) then
      raise exception 'You do not have permission to record work on this task' using errcode = 'P0403';
    end if;
  end if;

  if tg_table_name = 'task_checklist_items' and (n ->> 'is_done') is distinct from (o ->> 'is_done') then
    new := jsonb_populate_record(new, jsonb_build_object(
      'done_by', case when (n ->> 'is_done')::boolean then app.current_user_id() end,
      'done_at', case when (n ->> 'is_done')::boolean then now() end));
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['task_checklist_items', 'labour_entries', 'machine_entries'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.task_entry_guard()', t || '_task_guard', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.is_farm_member(farm_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.is_farm_member(farm_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.is_farm_member(farm_id)) with check (app.is_farm_member(farm_id))', t || '_update', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Exceptions: problem reports and triage
-- ---------------------------------------------------------------------------------------------
create table public.problem_categories (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,
  name_ar               text not null,
  name_en               text,
  default_department_id uuid references public.departments(id),
  sort_order            integer not null default 0
);
comment on table public.problem_categories is
  'Configurable problem categories, each routed by default to an owning department for triage (tier C defaults, VR-C16).';
select app.register_table('public.problem_categories', 'problem_category', true);
alter table public.problem_categories add constraint problem_categories_code_uq unique (farm_id, code);

create table public.problem_reports (
  id                   uuid primary key default gen_random_uuid(),
  report_no            bigint generated always as identity,
  code                 text generated always as ('PR-' || lpad(report_no::text, 6, '0')) stored,
  category_id          uuid not null references public.problem_categories(id),
  priority             smallint not null default 3 check (priority between 1 and 4),
  description          text not null check (length(trim(description)) > 0),
  location_id          uuid references public.locations(id),
  asset_id             uuid references public.assets(id),
  task_id              uuid references public.tasks(id),
  owning_department_id uuid references public.departments(id),
  acknowledged_by      uuid references auth.users(id),
  resolved_by          uuid references auth.users(id)
);
comment on table public.problem_reports is
  'Anyone can raise a problem (asset or place, category, priority, text, photo/voice). The owning department '
  'triages it into work, an observation, a quality incident or an operational blocker. Unacknowledged reports escalate.';
select app.register_table('public.problem_reports', 'problem_report', false, 'problem_report',
  p_department_column => 'owning_department_id', p_location_column => 'location_id', p_default_policies => false);
create index problem_reports_open_idx on public.problem_reports (farm_id, status) where voided_at is null;
create policy problem_reports_select on public.problem_reports for select to authenticated using (app.is_farm_member(farm_id));
create policy problem_reports_insert on public.problem_reports for insert to authenticated with check (app.is_farm_member(farm_id));
create policy problem_reports_update on public.problem_reports for update to authenticated
  using (app.has_permission(farm_id, 'problem_report', 'review', owning_department_id, location_id))
  with check (app.has_permission(farm_id, 'problem_report', 'review', owning_department_id, location_id));

alter table public.tasks add constraint tasks_source_report_fk foreign key (source_problem_report_id) references public.problem_reports(id);
alter table public.tasks add constraint tasks_blocked_report_fk foreign key (blocked_problem_report_id) references public.problem_reports(id);
alter table public.work_orders add constraint work_orders_source_report_fk foreign key (source_problem_report_id) references public.problem_reports(id);

create function app.problem_reports_default_department() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp
as $$
begin
  if new.owning_department_id is null then
    select default_department_id into new.owning_department_id from public.problem_categories where id = new.category_id;
  end if;
  if new.owning_department_id is null then
    select id into new.owning_department_id from public.departments where farm_id = new.farm_id and code = 'operations';
  end if;
  return new;
end;
$$;
create trigger problem_reports_default_department before insert on public.problem_reports
  for each row execute function app.problem_reports_default_department();

create table public.triage_decisions (
  id                uuid primary key default gen_random_uuid(),
  problem_report_id uuid not null references public.problem_reports(id),
  decision          text not null check (decision in ('work', 'agronomic_observation', 'quality_incident', 'operational_blocker')),
  department_id     uuid not null references public.departments(id),
  work_order_id     uuid references public.work_orders(id),
  task_id           uuid references public.tasks(id),
  note              text
);
comment on table public.triage_decisions is 'How a problem report was routed: decision, owning department and the work created from it.';
select app.register_table('public.triage_decisions', 'problem_report', false, p_default_policies => false);
create policy triage_decisions_select on public.triage_decisions for select to authenticated using (app.is_farm_member(farm_id));

create function app.guard_problem_report_triaged(p_rec jsonb) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$ select exists (select 1 from public.triage_decisions where problem_report_id = (p_rec ->> 'id')::uuid and voided_at is null) $$;

-- Triage: route a report to a department and turn it into work in one step (≤ 3 taps for the triager).
create function public.triage_problem_report(
  p_report            uuid,
  p_department        uuid,
  p_task_type         uuid,
  p_title             text,
  p_priority          smallint default null,
  p_planned_date      date default null,
  p_note              text default null,
  p_create_work_order boolean default false,
  p_decision          text default 'work'
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid  uuid := app.current_user_id();
  r      public.problem_reports;
  tt     public.task_types;
  v_wo   uuid;
  v_task uuid;
begin
  select * into r from public.problem_reports where id = p_report for update;
  if not found or not app.is_farm_member(r.farm_id) then
    raise exception 'Problem report not found' using errcode = 'P0404';
  end if;
  if r.status not in ('open', 'acknowledged') then
    raise exception 'This report is already %', r.status using errcode = 'P0422';
  end if;
  if not app.has_permission(r.farm_id, 'problem_report', 'review', r.owning_department_id, r.location_id) then
    raise exception 'You do not have permission to triage this report' using errcode = 'P0403';
  end if;
  if not exists (select 1 from public.departments where id = p_department and farm_id = r.farm_id) then
    raise exception 'Unknown department' using errcode = 'P0422';
  end if;
  select * into tt from public.task_types where id = p_task_type and farm_id = r.farm_id and voided_at is null;
  if not found or (tt.department_id is not null and tt.department_id <> p_department) then
    raise exception 'Task type does not belong to that department' using errcode = 'P0422';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'A title is required' using errcode = 'P0422';
  end if;

  if p_create_work_order then
    insert into public.work_orders (farm_id, department_id, location_id, asset_id, purpose, source_problem_report_id)
    values (r.farm_id, p_department, r.location_id, r.asset_id, p_title, r.id) returning id into v_wo;
  end if;

  -- A draft task in the target department (a cross-department request when the triager is not its planner).
  insert into public.tasks (farm_id, task_type_id, department_id, location_id, asset_id, work_order_id, title, instructions,
                            priority, planned_date, requested_by, source_problem_report_id)
  values (r.farm_id, p_task_type, p_department, r.location_id, r.asset_id, v_wo, p_title, r.description,
          coalesce(p_priority, r.priority), p_planned_date, r.created_by, r.id)
  returning id into v_task;

  insert into public.triage_decisions (farm_id, problem_report_id, decision, department_id, work_order_id, task_id, note)
  values (r.farm_id, r.id, p_decision, p_department, v_wo, v_task, p_note);

  -- Transition while the triager's authority over the current owning department still applies, then re-route.
  perform public.transition_record('problem_reports', r.id, 'converted', '{}', p_note);
  update public.problem_reports set owning_department_id = p_department, version = version where id = r.id;

  if p_planned_date is not null and r.location_id is not null
     and app.has_permission(r.farm_id, 'task', 'plan', p_department, r.location_id) then
    perform public.transition_record('tasks', v_task, 'planned', '{}', null);
  end if;

  return jsonb_build_object('task_id', v_task, 'work_order_id', v_wo);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Comments and attachments (polymorphic, parent checked by trigger; never used for core relationships)
-- ---------------------------------------------------------------------------------------------
create function app.check_parent() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_farm uuid;
begin
  execute format('select farm_id from public.%I where id = $1', new.entity_type) into v_farm using new.entity_id;
  if v_farm is null or v_farm <> new.farm_id then
    raise exception 'The record this refers to does not exist' using errcode = 'P0422';
  end if;
  return new;
end;
$$;

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('tasks', 'problem_reports', 'work_orders', 'issue_requests')),
  entity_id   uuid not null,
  body        text not null check (length(trim(body)) > 0)
);
comment on table public.comments is 'Discussion on a task, problem, work order or issue request; Operations coordinates here without owning the record.';
select app.register_table('public.comments', 'comment', false, p_default_policies => false);
create index comments_entity_idx on public.comments (entity_type, entity_id);
create trigger comments_parent before insert on public.comments for each row execute function app.check_parent();
create policy comments_select on public.comments for select to authenticated using (app.is_farm_member(farm_id));
create policy comments_insert on public.comments for insert to authenticated with check (app.is_farm_member(farm_id));

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('tasks', 'problem_reports', 'work_orders', 'issue_requests')),
  entity_id    uuid not null,
  kind         text not null check (kind in ('photo', 'document', 'voice')),
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  gps          jsonb,
  captured_at  timestamptz
);
comment on table public.attachments is 'Evidence (photo, document, voice note) with GPS and capture time; the file lives in Storage under storage_path.';
select app.register_table('public.attachments', 'attachment', false, p_default_policies => false);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);
create trigger attachments_parent before insert on public.attachments for each row execute function app.check_parent();
create policy attachments_select on public.attachments for select to authenticated using (app.is_farm_member(farm_id));
create policy attachments_insert on public.attachments for insert to authenticated with check (app.is_farm_member(farm_id));

-- ---------------------------------------------------------------------------------------------
-- Notifications and escalation
-- ---------------------------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references public.farms(id),
  user_id     uuid not null references public.user_profiles(id),
  kind        text not null,
  entity_type text not null,
  entity_id   uuid not null,
  params      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
comment on table public.notifications is 'In-app notification centre (assignments, rejections, escalations). WhatsApp/SMS wait for owner decision (E42).';
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated using (user_id = auth.uid());

create function public.mark_notifications_read(p_ids uuid[]) returns integer
language sql security definer set search_path = public, app, pg_temp
as $$
  with u as (update public.notifications set read_at = now()
              where id = any (p_ids) and user_id = app.current_user_id() and read_at is null returning 1)
  select count(*)::int from u
$$;

create function app.notify(p_farm uuid, p_user uuid, p_kind text, p_entity_type text, p_entity uuid, p_params jsonb default '{}')
returns void
language sql security definer set search_path = public, app, pg_temp
as $$
  insert into public.notifications (farm_id, user_id, kind, entity_type, entity_id, params)
  select p_farm, p_user, p_kind, p_entity_type, p_entity, p_params where p_user is not null
$$;

create function app.on_transition_tasks(p_rec jsonb, p_from text, p_to text) returns void
language plpgsql security definer set search_path = public, app, pg_temp
as $$
begin
  if p_to = 'assigned' then
    perform app.notify((p_rec ->> 'farm_id')::uuid, (p_rec ->> 'supervisor_id')::uuid, 'task_assigned', 'tasks',
                       (p_rec ->> 'id')::uuid, jsonb_build_object('code', p_rec ->> 'code', 'title', p_rec ->> 'title'));
  elsif p_from = 'pending_verification' and p_to = 'in_progress' then
    perform app.notify((p_rec ->> 'farm_id')::uuid, (p_rec ->> 'completed_by')::uuid, 'task_rejected', 'tasks',
                       (p_rec ->> 'id')::uuid, jsonb_build_object('code', p_rec ->> 'code', 'title', p_rec ->> 'title'));
  end if;
end;
$$;

create table public.escalation_rules (
  id                   uuid primary key default gen_random_uuid(),
  entity_type          text not null check (entity_type in ('problem_reports', 'tasks')),
  condition            text not null check (condition in ('unacknowledged', 'overdue', 'blocked')),
  max_priority         smallint not null default 4 check (max_priority between 1 and 4),
  after_minutes        integer not null check (after_minutes > 0),
  notify_role_id       uuid not null references public.roles(id),
  notify_department_id uuid references public.departments(id),
  is_active            boolean not null default true,
  check ((entity_type = 'problem_reports') = (condition = 'unacknowledged'))
);
comment on table public.escalation_rules is
  'Severity × time escalation rules (e.g. P1 report unacknowledged after N minutes → notify Operations Manager). '
  'None ship configured: thresholds are entered by the farm, never invented (§2.6).';
select app.register_table('public.escalation_rules', 'escalation_rule', false);

create table public.escalations (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null references public.farms(id),
  rule_id      uuid not null references public.escalation_rules(id),
  entity_type  text not null,
  entity_id    uuid not null,
  escalated_at timestamptz not null default now(),
  unique (rule_id, entity_id)
);
comment on table public.escalations is 'Escalations fired by the scheduler; one per rule and record, so re-runs never duplicate.';
alter table public.escalations enable row level security;
create policy escalations_select on public.escalations for select to authenticated using (app.is_farm_member(farm_id));

-- Idempotent escalation run (scheduled every few minutes by pg_cron where available).
create function app.run_escalations() returns integer
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r     public.escalation_rules;
  e     record;
  n     integer := 0;
begin
  perform set_config('app.actor_kind', 'scheduler', true);
  for r in select * from public.escalation_rules where is_active and voided_at is null loop
    for e in
      with candidates as (
        select p.id, p.farm_id, p.owning_department_id as dept, p.code
          from public.problem_reports p
         where r.condition = 'unacknowledged' and p.farm_id = r.farm_id and p.voided_at is null
           and p.status = 'open' and p.priority <= r.max_priority
           and p.created_at <= now() - make_interval(mins => r.after_minutes)
        union all
        select t.id, t.farm_id, t.department_id, t.code
          from public.tasks t
         where r.condition = 'overdue' and t.farm_id = r.farm_id and t.voided_at is null
           and t.status in ('planned', 'assigned', 'in_progress', 'blocked') and t.priority <= r.max_priority
           and app.task_due_at(t.planned_date, t.window_end) <= now() - make_interval(mins => r.after_minutes)
        union all
        select t.id, t.farm_id, t.department_id, t.code
          from public.tasks t
         where r.condition = 'blocked' and t.farm_id = r.farm_id and t.voided_at is null
           and t.status = 'blocked' and t.priority <= r.max_priority
           and (select max(server_received_at) from public.record_transitions rt
                 where rt.entity_id = t.id and rt.to_status = 'blocked') <= now() - make_interval(mins => r.after_minutes)
      )
      insert into public.escalations (farm_id, rule_id, entity_type, entity_id)
      select c.farm_id, r.id, r.entity_type, c.id from candidates c
      on conflict (rule_id, entity_id) do nothing
      returning entity_id
    loop
      n := n + 1;
      insert into public.notifications (farm_id, user_id, kind, entity_type, entity_id, params)
      select distinct r.farm_id, ur.user_id, 'escalation_' || r.condition, r.entity_type, e.entity_id,
             jsonb_build_object('rule_id', r.id)
        from public.user_roles ur
       where ur.farm_id = r.farm_id and ur.role_id = r.notify_role_id and ur.voided_at is null
         and ur.valid_from <= now() and (ur.valid_to is null or ur.valid_to > now())
         and (r.notify_department_id is null or ur.department_id is null or ur.department_id = r.notify_department_id);
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function app.run_escalations() from public;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('agri-run-escalations', '*/5 * * * *', 'select app.run_escalations()');
  else
    raise notice 'pg_cron not available here; schedule app.run_escalations() externally (local/test environments).';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Operations board: what is planned, late, blocked, waiting verification — per department, today.
-- ---------------------------------------------------------------------------------------------
create view public.task_board with (security_invoker = true) as
select t.id, t.farm_id, t.code, t.title, t.status, t.priority, t.version,
       t.department_id, d.code as department_code, d.name_ar as department_name_ar, d.name_en as department_name_en,
       t.task_type_id, tt.name_ar as task_type_name_ar, tt.name_en as task_type_name_en, tt.requires_verification,
       t.location_id, l.code as location_code, l.name_ar as location_name_ar, l.name_en as location_name_en,
       t.asset_id, a.code as asset_code,
       t.planned_date, t.window_start, t.window_end,
       t.supervisor_id, sp.full_name as supervisor_name, t.crew_id, c.code as crew_code, c.name_ar as crew_name_ar, c.name_en as crew_name_en,
       t.blocked_reason, t.blocked_note, t.blocked_problem_report_id, t.rejection_count,
       t.completed_by, t.actual_quantity, t.planned_quantity, t.quantity_unit_id,
       t.work_order_id, t.source_problem_report_id,
       (t.status in ('planned', 'assigned', 'in_progress', 'blocked')
        and t.planned_date is not null and app.task_due_at(t.planned_date, t.window_end) < now()) as is_overdue,
       t.updated_at
  from public.tasks t
  join public.departments d on d.id = t.department_id
  join public.task_types tt on tt.id = t.task_type_id
  left join public.locations l on l.id = t.location_id
  left join public.assets a on a.id = t.asset_id
  left join public.user_profiles sp on sp.id = t.supervisor_id
  left join public.crews c on c.id = t.crew_id
 where t.voided_at is null;
comment on view public.task_board is 'One row per live task with names resolved and is_overdue derived, for My Day and the Operations board.';
