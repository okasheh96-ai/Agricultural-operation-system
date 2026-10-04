-- Phase 2: inventory engine core, shared by the Main Warehouse and the Maintenance Warehouse (separate
-- warehouses, separate permissions, one engine — Master Prompt §3.13), plus planned vs actual material on tasks.
--
-- stock_movements is the immutable ledger and source of truth. stock_balances is maintained in the same
-- transaction by post_stock_movement() with a row lock, and can be reconciled against the ledger.
-- Corrections are reversals. Field consumption is recorded on the task; stock moves only when the
-- warehouse posts a movement (receipt, issue, return, adjustment). Negative balances (e.g. offline issues)
-- are allowed and flagged for the warehouse, never silently rejected.
-- Valuation is out of scope (FarmERP may remain the valuation system — tier D).

set check_function_bodies = off;

create table public.warehouses (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  name_ar       text not null,
  name_en       text,
  kind          text not null check (kind in ('main_agricultural', 'maintenance', 'other')),
  department_id uuid not null references public.departments(id),
  location_id   uuid references public.locations(id)
);
comment on table public.warehouses is 'Stores holding stock. Main (agricultural) and Maintenance warehouses are separate records owned by separate departments.';
select app.register_table('public.warehouses', 'warehouse', true, p_department_column => 'department_id');
alter table public.warehouses add constraint warehouses_code_uq unique (farm_id, code);

create table public.item_categories (
  id      uuid primary key default gen_random_uuid(),
  code    text not null,
  name_ar text not null,
  name_en text
);
comment on table public.item_categories is 'Admin-defined item categories (none seeded; E27/E28).';
select app.register_table('public.item_categories', 'item', true);
alter table public.item_categories add constraint item_categories_code_uq unique (farm_id, code);

create table public.items (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  name_ar      text not null,
  name_en      text,
  kind         text not null check (kind in ('material', 'spare_part', 'other')),
  category_id  uuid references public.item_categories(id),
  base_unit_id uuid not null references public.units(id),
  min_qty      numeric check (min_qty is null or min_qty >= 0),
  reorder_qty  numeric check (reorder_qty is null or reorder_qty >= 0),
  search_text  text generated always as (app.normalize_ar(code || ' ' || name_ar || ' ' || coalesce(name_en, ''))) stored
);
comment on table public.items is
  'Materials (fertilizers, agrochemicals, supplies) and spare parts. Quantities are held in the base unit; '
  'min/reorder only when configured. No SKUs or stock policies are seeded.';
select app.register_table('public.items', 'item', true);
alter table public.items add constraint items_code_uq unique (farm_id, code);

create table public.item_units (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.items(id),
  unit_id         uuid not null references public.units(id),
  factor_to_base  numeric not null check (factor_to_base > 0)
);
comment on table public.item_units is 'Item-level conversions (e.g. 1 bag of this fertilizer = 25 kg). Entered per item, never assumed.';
select app.register_table('public.item_units', 'item', false);
create unique index item_units_uq on public.item_units (item_id, unit_id) where voided_at is null;

create table public.stock_movements (
  id                    uuid primary key default gen_random_uuid(),
  farm_id               uuid not null references public.farms(id),
  warehouse_id          uuid not null references public.warehouses(id),
  item_id               uuid not null references public.items(id),
  movement_type         text not null check (movement_type in ('receipt', 'issue', 'return', 'adjustment', 'reversal')),
  quantity              numeric not null check (quantity > 0),
  unit_id               uuid not null references public.units(id),
  base_delta            numeric not null check (base_delta <> 0),
  reason                text,
  task_id               uuid references public.tasks(id),
  issue_request_id      uuid,
  reverses_movement_id  uuid unique references public.stock_movements(id),
  negative_balance_flag boolean not null default false,
  balance_after         numeric not null,
  created_by            uuid not null references auth.users(id),
  client_recorded_at    timestamptz,
  server_received_at    timestamptz not null default now(),
  idempotency_key       uuid unique
);
comment on table public.stock_movements is
  'Immutable stock ledger: every receipt, issue, return, adjustment and reversal with signed base-unit delta. '
  'Never edited; corrections are reversals.';
create index stock_movements_item_idx on public.stock_movements (warehouse_id, item_id, server_received_at);
alter table public.stock_movements enable row level security;
create policy stock_movements_select on public.stock_movements for select to authenticated using (app.is_farm_member(farm_id));
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function app.forbid_audit_change();
create trigger stock_movements_audit after insert on public.stock_movements
  for each row execute function app.audit_row();

create table public.stock_balances (
  farm_id       uuid not null references public.farms(id),
  warehouse_id  uuid not null references public.warehouses(id),
  item_id       uuid not null references public.items(id),
  quantity_base numeric not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (warehouse_id, item_id)
);
comment on table public.stock_balances is 'Current quantity per warehouse and item, maintained with the ledger in one transaction; reconciled by app.reconcile_stock().';
alter table public.stock_balances enable row level security;
create policy stock_balances_select on public.stock_balances for select to authenticated using (app.is_farm_member(farm_id));

create function app.to_base_quantity(p_item uuid, p_qty numeric, p_unit uuid) returns numeric
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  i public.items;
  f numeric;
begin
  select * into i from public.items where id = p_item;
  if p_unit = i.base_unit_id then
    return p_qty;
  end if;
  select factor_to_base into f from public.item_units where item_id = p_item and unit_id = p_unit and voided_at is null;
  if f is null then
    raise exception 'No conversion from this unit to the item''s base unit is configured' using errcode = 'P0422';
  end if;
  return p_qty * f;
end;
$$;

create function public.post_stock_movement(
  p_warehouse          uuid,
  p_item               uuid,
  p_type               text,
  p_quantity           numeric,
  p_unit               uuid,
  p_reason             text default null,
  p_task               uuid default null,
  p_issue_request      uuid default null,
  p_direction          smallint default null,
  p_client_recorded_at timestamptz default null,
  p_idempotency_key    uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid   uuid := app.current_user_id();
  w       public.warehouses;
  v_prev  public.stock_movements;
  v_delta numeric;
  v_bal   numeric;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'P0403';
  end if;
  if p_idempotency_key is not null then
    select * into v_prev from public.stock_movements where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('id', v_prev.id, 'balance_after', v_prev.balance_after, 'replayed', true);
    end if;
  end if;
  select * into w from public.warehouses where id = p_warehouse and voided_at is null;
  if not found or not app.is_farm_member(w.farm_id) then
    raise exception 'Warehouse not found' using errcode = 'P0404';
  end if;
  if not exists (select 1 from public.items where id = p_item and farm_id = w.farm_id and voided_at is null) then
    raise exception 'Item not found' using errcode = 'P0404';
  end if;
  if p_type not in ('receipt', 'issue', 'return', 'adjustment') then
    raise exception 'Unknown movement type' using errcode = 'P0422';
  end if;
  if not app.has_permission(w.farm_id, 'stock', case when p_type = 'adjustment' then 'approve' else 'execute' end, w.department_id) then
    raise exception 'You do not have permission to move stock in this warehouse' using errcode = 'P0403';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = 'P0422';
  end if;
  if p_type = 'adjustment' and (coalesce(trim(p_reason), '') = '' or p_direction not in (-1, 1)) then
    raise exception 'Adjustments need a reason and a direction' using errcode = 'P0422';
  end if;

  v_delta := app.to_base_quantity(p_item, p_quantity, p_unit)
             * case p_type when 'issue' then -1 when 'adjustment' then p_direction else 1 end;

  insert into public.stock_balances (farm_id, warehouse_id, item_id) values (w.farm_id, p_warehouse, p_item)
  on conflict do nothing;
  select quantity_base into v_bal from public.stock_balances where warehouse_id = p_warehouse and item_id = p_item for update;
  v_bal := v_bal + v_delta;

  insert into public.stock_movements (farm_id, warehouse_id, item_id, movement_type, quantity, unit_id, base_delta, reason,
                                      task_id, issue_request_id, negative_balance_flag, balance_after, created_by,
                                      client_recorded_at, idempotency_key)
  values (w.farm_id, p_warehouse, p_item, p_type, p_quantity, p_unit, v_delta, p_reason, p_task, p_issue_request,
          v_bal < 0, v_bal, v_uid, p_client_recorded_at, p_idempotency_key)
  returning id into v_id;

  update public.stock_balances set quantity_base = v_bal, updated_at = now() where warehouse_id = p_warehouse and item_id = p_item;
  return jsonb_build_object('id', v_id, 'balance_after', v_bal, 'negative_balance_flag', v_bal < 0);
end;
$$;

create function public.reverse_stock_movement(p_movement uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  m     public.stock_movements;
  w     public.warehouses;
  v_bal numeric;
  v_id  uuid;
begin
  select * into m from public.stock_movements where id = p_movement;
  if not found or not app.is_farm_member(m.farm_id) then
    raise exception 'Movement not found' using errcode = 'P0404';
  end if;
  select * into w from public.warehouses where id = m.warehouse_id;
  if not app.has_permission(m.farm_id, 'stock', 'approve', w.department_id) then
    raise exception 'You do not have permission to reverse stock movements here' using errcode = 'P0403';
  end if;
  if m.movement_type = 'reversal' then
    raise exception 'A reversal cannot be reversed; post a new movement' using errcode = 'P0422';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0422';
  end if;
  select quantity_base into v_bal from public.stock_balances where warehouse_id = m.warehouse_id and item_id = m.item_id for update;
  v_bal := v_bal - m.base_delta;
  insert into public.stock_movements (farm_id, warehouse_id, item_id, movement_type, quantity, unit_id, base_delta, reason,
                                      task_id, issue_request_id, reverses_movement_id, negative_balance_flag, balance_after, created_by)
  values (m.farm_id, m.warehouse_id, m.item_id, 'reversal', m.quantity, m.unit_id, -m.base_delta, p_reason,
          m.task_id, m.issue_request_id, m.id, v_bal < 0, v_bal, app.current_user_id())
  returning id into v_id;
  update public.stock_balances set quantity_base = v_bal, updated_at = now() where warehouse_id = m.warehouse_id and item_id = m.item_id;
  return jsonb_build_object('id', v_id, 'balance_after', v_bal);
end;
$$;

-- Nightly integrity check: rows where the balance differs from the ledger sum (should be none).
create function app.reconcile_stock() returns table (warehouse_id uuid, item_id uuid, balance numeric, ledger numeric)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select b.warehouse_id, b.item_id, b.quantity_base, coalesce(sum(m.base_delta), 0)
    from public.stock_balances b
    left join public.stock_movements m on m.warehouse_id = b.warehouse_id and m.item_id = b.item_id
   group by b.warehouse_id, b.item_id, b.quantity_base
  having b.quantity_base <> coalesce(sum(m.base_delta), 0)
$$;
revoke all on function app.reconcile_stock() from public;

-- ---------------------------------------------------------------------------------------------
-- Issue requests: field/department asks a warehouse for material; the warehouse issues; the field confirms.
-- ---------------------------------------------------------------------------------------------
create table public.issue_requests (
  id                      uuid primary key default gen_random_uuid(),
  request_no              bigint generated always as identity,
  code                    text generated always as ('IR-' || lpad(request_no::text, 6, '0')) stored,
  warehouse_id            uuid not null references public.warehouses(id),
  warehouse_department_id uuid not null references public.departments(id),
  department_id           uuid not null references public.departments(id),
  task_id                 uuid references public.tasks(id),
  needed_by               date,
  note                    text
);
comment on table public.issue_requests is
  'A request for material from a warehouse, optionally for a task. Requester-side steps are checked against the '
  'requesting department, issuing steps against the warehouse''s department (workflow "issue_request").';
select app.register_table('public.issue_requests', 'issue_request', false, 'issue_request',
  p_department_column => 'department_id', p_default_policies => false);
create policy issue_requests_select on public.issue_requests for select to authenticated using (app.is_farm_member(farm_id));
create policy issue_requests_insert on public.issue_requests for insert to authenticated
  with check (app.has_permission(farm_id, 'issue_request', 'create', department_id));
alter table public.stock_movements add constraint stock_movements_issue_request_fk foreign key (issue_request_id) references public.issue_requests(id);
alter table public.tasks add constraint tasks_blocked_issue_fk foreign key (blocked_issue_request_id) references public.issue_requests(id);

create function app.issue_requests_set_warehouse_department() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp
as $$
begin
  select department_id into new.warehouse_department_id from public.warehouses where id = new.warehouse_id and farm_id = new.farm_id;
  if new.warehouse_department_id is null then
    raise exception 'Warehouse not found' using errcode = 'P0422';
  end if;
  return new;
end;
$$;
create trigger issue_requests_wh_dept before insert or update of warehouse_id on public.issue_requests
  for each row execute function app.issue_requests_set_warehouse_department();

create table public.issue_request_lines (
  id               uuid primary key default gen_random_uuid(),
  issue_request_id uuid not null references public.issue_requests(id),
  item_id          uuid not null references public.items(id),
  requested_qty    numeric not null check (requested_qty > 0),
  unit_id          uuid not null references public.units(id),
  issued_qty       numeric not null default 0 check (issued_qty >= 0)
);
comment on table public.issue_request_lines is 'Items and quantities requested; issued_qty is updated by issue_stock().';
select app.register_table('public.issue_request_lines', 'issue_request', false, p_default_policies => false);
create policy issue_request_lines_select on public.issue_request_lines for select to authenticated using (app.is_farm_member(farm_id));
create policy issue_request_lines_insert on public.issue_request_lines for insert to authenticated
  with check (exists (select 1 from public.issue_requests r where r.id = issue_request_id and r.status = 'requested'
                      and app.has_permission(r.farm_id, 'issue_request', 'create', r.department_id)));

create function app.guard_issue_approval_not_required(p_rec jsonb) returns boolean
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings
                    where farm_id = (p_rec ->> 'farm_id')::uuid and key = 'issue_request_requires_approval' and voided_at is null), false) = false
$$;

-- Warehouse issues against a request: posts the movements, updates lines, moves the request on.
create function public.issue_stock(p_request uuid, p_lines jsonb, p_client_recorded_at timestamptz default null) returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  r       public.issue_requests;
  l       record;
  ln      public.issue_request_lines;
  v_full  boolean;
begin
  select * into r from public.issue_requests where id = p_request for update;
  if not found or not app.is_farm_member(r.farm_id) then
    raise exception 'Issue request not found' using errcode = 'P0404';
  end if;
  if r.status not in ('requested', 'approved', 'partially_issued') then
    raise exception 'This request is %', r.status using errcode = 'P0422';
  end if;
  for l in select (x ->> 'line_id')::uuid as line_id, (x ->> 'qty')::numeric as qty from jsonb_array_elements(p_lines) x loop
    select * into ln from public.issue_request_lines where id = l.line_id and issue_request_id = r.id and voided_at is null for update;
    if not found then
      raise exception 'Line not found' using errcode = 'P0422';
    end if;
    perform public.post_stock_movement(r.warehouse_id, ln.item_id, 'issue', l.qty, ln.unit_id, null, r.task_id, r.id,
                                       null, p_client_recorded_at);
    update public.issue_request_lines set issued_qty = issued_qty + l.qty, version = version where id = ln.id;
  end loop;
  select bool_and(issued_qty >= requested_qty) into v_full from public.issue_request_lines where issue_request_id = r.id and voided_at is null;
  if not (r.status = 'partially_issued' and not v_full) then
    perform public.transition_record('issue_requests', r.id, case when v_full then 'issued' else 'partially_issued' end);
  end if;
  return jsonb_build_object('id', r.id, 'fully_issued', v_full);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Planned vs actual material per task
-- ---------------------------------------------------------------------------------------------
create table public.material_consumptions (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.tasks(id),
  item_id          uuid not null references public.items(id),
  unit_id          uuid not null references public.units(id),
  planned_qty      numeric check (planned_qty is null or planned_qty >= 0),
  actual_qty       numeric check (actual_qty is null or actual_qty >= 0),
  issue_request_id uuid references public.issue_requests(id),
  note             text,
  check (planned_qty is not null or actual_qty is not null)
);
comment on table public.material_consumptions is
  'Material planned for and actually used on a task, linked to the issue request it came from. Planned lines are '
  'set before work starts; actuals while the task is active; locked after completion.';
select app.register_table('public.material_consumptions', 'task', false, p_default_policies => false);
create index material_consumptions_task_idx on public.material_consumptions (task_id) where voided_at is null;
create trigger material_consumptions_task_guard before insert or update on public.material_consumptions
  for each row execute function app.task_entry_guard();
create policy material_consumptions_select on public.material_consumptions for select to authenticated using (app.is_farm_member(farm_id));
create policy material_consumptions_insert on public.material_consumptions for insert to authenticated with check (app.is_farm_member(farm_id));
create policy material_consumptions_update on public.material_consumptions for update to authenticated
  using (app.is_farm_member(farm_id)) with check (app.is_farm_member(farm_id));

-- Items at or below their configured minimum (only items with a minimum configured appear).
create view public.stock_below_minimum with (security_invoker = true) as
select b.farm_id, b.warehouse_id, w.code as warehouse_code, b.item_id, i.code as item_code, i.name_ar, i.name_en,
       b.quantity_base, i.min_qty, i.base_unit_id
  from public.stock_balances b
  join public.items i on i.id = b.item_id
  join public.warehouses w on w.id = b.warehouse_id
 where i.min_qty is not null and b.quantity_base <= i.min_qty;
