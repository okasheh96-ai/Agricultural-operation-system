-- Inventory ledger, balances, negative-stock flag, reversals, issue requests, planned vs actual material.
begin;
select plan(21);

select tests.create_user('admin') as admin \gset
select tests.create_user('wh')    as wh \gset
select tests.create_user('sup')   as sup \gset
select tests.create_user('mgr')   as mgr \gset
select tests.grant_role(:'admin', 'system_admin');
select tests.grant_role(:'wh', 'warehouse_user', 'main_warehouse');
select tests.grant_role(:'sup', 'supervisor', 'agriculture');
select tests.grant_role(:'mgr', 'department_manager', 'agriculture');
select tests.location('BLK-INV') as loc \gset

select tests.login(:'admin');
insert into public.warehouses (farm_id, code, name_ar, kind, department_id) values (tests.farm(), 'WH-MAIN', 'المستودع', 'main_agricultural', tests.dept('main_warehouse')) returning id as w \gset
insert into public.items (farm_id, code, name_ar, kind, base_unit_id) values (tests.farm(), 'FERT-X', 'سماد س', 'material', tests.unit('kg')) returning id as item \gset
insert into public.units (farm_id, code, name_ar, dimension) values (tests.farm(), 'bag', 'كيس', 'count') returning id as bag \gset
insert into public.item_units (farm_id, item_id, unit_id, factor_to_base) values (tests.farm(), :'item', :'bag', 25);
select tests.logout();

select tests.login(:'wh');
select is((public.post_stock_movement(:'w', :'item', 'receipt', 4, :'bag') ->> 'balance_after')::numeric, 100::numeric,
  '4 bags received = 100 kg through the item conversion');
select throws_ok(format($$ select public.post_stock_movement(%L, %L, 'receipt', 1, %L) $$, :'w', :'item', tests.unit('l')),
  'P0422', null, 'no silent conversion for an unconfigured unit');
select is((public.post_stock_movement(:'w', :'item', 'issue', 120, tests.unit('kg')) ->> 'negative_balance_flag')::boolean, true,
  'an issue beyond stock is allowed but flagged (offline reality)');
select throws_ok(format($$ select public.post_stock_movement(%L, %L, 'adjustment', 5, %L) $$, :'w', :'item', tests.unit('kg')),
  'P0403', null, 'adjustments need approval authority');
select (select id from public.stock_movements where movement_type = 'issue' and item_id = :'item') as iss \gset
select is((public.post_stock_movement(:'w', :'item', 'receipt', 1, :'bag', null, null, null, null, null, 'aaaaaaaa-0000-0000-0000-000000000001') ->> 'balance_after')::numeric,
  5::numeric, 'receipt with an idempotency key');
select is((public.post_stock_movement(:'w', :'item', 'receipt', 1, :'bag', null, null, null, null, null, 'aaaaaaaa-0000-0000-0000-000000000001') ->> 'replayed')::boolean,
  true, 'replaying the same key does not post twice');
select tests.logout();

select tests.login(:'sup');
select throws_ok(format($$ select public.post_stock_movement(%L, %L, 'issue', 1, %L) $$, :'w', :'item', tests.unit('kg')),
  'P0403', null, 'field users cannot move warehouse stock');
select tests.logout();

select throws_ok(format($$ update public.stock_movements set quantity = 1 where id = %L $$, :'iss'), 'P0403', null, 'the ledger is immutable');

select tests.login(:'mgr');
select throws_ok(format($$ select public.reverse_stock_movement(%L, 'wrong') $$, :'iss'), 'P0403', null,
  'only the warehouse department may reverse its movements');
select tests.logout();
select tests.grant_role(:'mgr', 'department_manager', 'main_warehouse');
select tests.login(:'mgr');
select is((public.reverse_stock_movement(:'iss', 'Issued to the wrong store') ->> 'balance_after')::numeric, 125::numeric,
  'a correction is a reversal with a reason');
select throws_ok(format($$ select public.reverse_stock_movement(%L, 'x') $$, :'iss'), '23505', null, 'a movement can be reversed only once');
select tests.logout();
select is((select count(*)::int from app.reconcile_stock()), 0, 'balances reconcile with the ledger');

-- Issue request for a task: requested → partially issued → issued → received in the field
select tests.login(:'mgr');
insert into public.tasks (farm_id, task_type_id, department_id, location_id, title, planned_date)
values (tests.farm(), tests.task_type('general'), tests.dept('agriculture'), :'loc', 'تسميد', current_date) returning id as t \gset
insert into public.material_consumptions (farm_id, task_id, item_id, unit_id, planned_qty) values (tests.farm(), :'t', :'item', :'bag', 2) returning id as mc \gset
select public.transition_record('tasks', :'t', 'assigned', jsonb_build_object('supervisor_id', :'sup'));
select tests.logout();

select tests.login(:'sup');
insert into public.issue_requests (farm_id, warehouse_id, department_id, task_id) values (tests.farm(), :'w', tests.dept('agriculture'), :'t') returning id as ir \gset
insert into public.issue_request_lines (farm_id, issue_request_id, item_id, requested_qty, unit_id) values (tests.farm(), :'ir', :'item', 2, :'bag') returning id as line \gset
select throws_ok(format($$ select public.issue_stock(%L, '[{"line_id":"%s","qty":1}]') $$, :'ir', :'line'), 'P0403', null,
  'the requester cannot issue to themselves');
select tests.logout();

select tests.login(:'wh');
select is((public.issue_stock(:'ir', format('[{"line_id":"%s","qty":1}]', :'line')::jsonb) ->> 'fully_issued')::boolean, false, 'partial issue');
select is((select status from public.issue_requests where id = :'ir'), 'partially_issued', 'request partially issued');
select public.issue_stock(:'ir', format('[{"line_id":"%s","qty":1}]', :'line')::jsonb);
select is((select status from public.issue_requests where id = :'ir'), 'issued', 'rest issued');
select throws_ok(format($$ select public.transition_record('issue_requests', %L, 'received') $$, :'ir'), 'P0403', null,
  'the warehouse cannot confirm receipt on the field''s behalf');
select tests.logout();

select tests.login(:'sup');
select is(public.transition_record('issue_requests', :'ir', 'received') ->> 'to_status', 'received', 'field confirms receipt');
select public.transition_record('tasks', :'t', 'in_progress');
select lives_ok(format($$ update public.material_consumptions set actual_qty = 2, issue_request_id = %L, version = 1 where id = %L $$, :'ir', :'mc'),
  'actual material recorded against the issue while working');
select throws_ok(format($$ update public.material_consumptions set planned_qty = 5, version = 2 where id = %L $$, :'mc'), 'P0422', null,
  'planned quantities cannot change once work has started');
select tests.logout();

-- When the farm requires approval (E5, configurable), the warehouse cannot issue an unapproved request.
update public.settings set value = 'true', version = version where farm_id = tests.farm() and key = 'issue_request_requires_approval';
select tests.login(:'sup');
insert into public.issue_requests (farm_id, warehouse_id, department_id) values (tests.farm(), :'w', tests.dept('agriculture')) returning id as ir2 \gset
insert into public.issue_request_lines (farm_id, issue_request_id, item_id, requested_qty, unit_id) values (tests.farm(), :'ir2', :'item', 1, :'bag') returning id as line2 \gset
select tests.logout();
select tests.login(:'wh');
select throws_ok(format($$ select public.issue_stock(%L, '[{"line_id":"%s","qty":1}]') $$, :'ir2', :'line2'), 'P0422', null,
  'with approval required, an unapproved request cannot be issued');
select tests.logout();

select * from finish();
rollback;
