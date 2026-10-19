-- Packing house configuration: matrix as data (spec §6.3), open decisions (§13) and their gates, rule parameters
-- (FR-MD-07), templates (FR-QG-07), and T-20: every role × every non-granted implemented action is refused — generated
-- from the same matrix rows the application uses.
begin;
select no_plan();

create function tests.ph_user(p_name text, p_codes text[]) returns uuid
language plpgsql as $$
declare v uuid; c text;
begin
  v := tests.create_user(p_name);
  foreach c in array p_codes loop perform tests.grant_role(v, 'ph_' || lower(c)); end loop;
  return v;
end $$;
-- Calls SECURITY DEFINER functions as a given user (auth.uid() from the JWT claims), staying the test owner otherwise.
create function tests.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;
create function tests.ph_decide(p_code text, p_option text, p_activate text[], p_users uuid[]) returns text
language plpgsql as $$
declare u uuid; v jsonb;
begin
  foreach u in array p_users loop
    perform tests.as_user(u);
    v := public.ph_record_decision(p_code, p_option, 'Test decision', p_activate);
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return v ->> 'status';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Structure (spec counts)
select is((select count(*)::int from public.ph_open_decisions where farm_id = tests.farm()), 41, 'all 41 open decisions are registered');
select is((select count(*)::int from public.ph_open_decisions where farm_id = tests.farm() and priority = 'critical'), 6, 'six critical decisions');
select set_eq($$ select code from public.ph_open_decisions where farm_id = tests.farm() and priority = 'critical' $$,
  array['OD-01', 'OD-02', 'OD-03', 'OD-05', 'OD-24', 'OD-25'], 'the critical ones are OD-01, 02, 03, 05, 24, 25');
select is((select count(*)::int from public.ph_open_decisions where farm_id = tests.farm() and decision_state <> 'open'), 0, 'every decision starts open');
select is((select count(*)::int from public.ph_roles where farm_id = tests.farm()), 20, 'role catalogue: 20 spec roles (§6.1)');
select is((select count(*)::int from public.ph_permission_cells where farm_id = tests.farm() and evidence = 'C' and state <> 'active'), 0,
  'confirmed (●) cells are active');
select is((select count(*)::int from public.ph_permission_cells where farm_id = tests.farm() and evidence = 'P' and state <> 'proposed'), 0,
  'proposed (○) cells start as proposals');
select is((select count(*)::int from public.ph_permission_cells where farm_id = tests.farm() and evidence = 'NYV' and state <> 'pending_decision'), 0,
  'not-yet-verified (?) cells start pending a decision');
select is((select count(*)::int from public.ph_permission_cells c where c.farm_id = tests.farm()
            and not exists (select 1 from public.ph_actions a where a.farm_id = c.farm_id and a.action_key = c.action_key)), 0,
  'every cell names a catalogued action');
select is((select count(*)::int from public.ph_permission_cells c where c.farm_id = tests.farm()
            and not exists (select 1 from public.ph_roles r where r.farm_id = c.farm_id and r.spec_code = c.spec_code)), 0,
  'every cell names a catalogued role');
-- Spot checks of the transcription (PDF pages 45–48).
select set_eq($$ select spec_code || ':' || evidence from public.ph_permission_cells where farm_id = tests.farm() and action_key = 'incoming_pallet.register' $$,
  array['DEC:C'], 'register incoming pallet: DEC ●');
select set_eq($$ select spec_code || ':' || evidence from public.ph_permission_cells where farm_id = tests.farm() and action_key = 'arrival.vehicle_exception' $$,
  array['PHM:C', 'QAM:C', 'TOP:C'], 'vehicle exception: PHM ● QAM ● TOP ●');
select set_eq($$ select spec_code || ':' || evidence from public.ph_permission_cells where farm_id = tests.farm() and action_key = 'arrival.vehicle_inspection' $$,
  array['DEC:NYV', 'QAO:NYV'], 'incoming vehicle inspection: DEC ? QAO ? (OD-38)');
select set_eq($$ select spec_code || ':' || evidence from public.ph_permission_cells where farm_id = tests.farm() and action_key = 'rma.cosign' $$,
  array['QCI:C', 'QAM:P'], 'RMA co-sign: QCI ● QAM ○');
select set_eq($$ select spec_code || ':' || evidence from public.ph_permission_cells where farm_id = tests.farm() and action_key = 'waste.signoff_large' $$,
  array['PHM:C', 'WHM:C', 'FIN:C', 'QCM:NYV', 'QAM:NYV'], 'waste > 1 t sign-off: PHM ● WHM ● FIN ● QCM ? QAM ?');
select is((select count(*)::int from public.ph_permission_cells where farm_id = tests.farm() and spec_code = 'ADM'
            and action_key not in ('md_operational.edit', 'users.administer', 'audit.view')), 0,
  'SoD-06: the administrator holds no operational cell');
select is((select count(*)::int from public.ph_permission_cells where farm_id = tests.farm() and spec_code = 'PHM'
            and action_key in ('hold.release', 'hold.decide_quality', 'hold.decide_food_safety')), 0,
  'SoD-05: the PHM cannot decide or release quality holds');

select is(app.ph_proposals_in_effect(tests.farm()), false, 'real farm: proposed permissions are not in effect until approved');
select is(app.ph_param(tests.farm(), 'precool_max_dwell_minutes'), 30::numeric, 'SOP-documented pre-cooling maximum 30 min');
select is(app.ph_param(tests.farm(), 'grading_limit_hours'), 24::numeric, 'SOP-documented grading limit 24 h');
select is(app.ph_param(tests.farm(), 'weight_plausibility_tolerance_pct'), null, 'no invented plausibility tolerance (OD-29)');
select is((select state from public.ph_rule_parameters where farm_id = tests.farm() and code = 'grading_alert_lead_hours'), 'pending_decision',
  'alert lead time pending OD-09, without a number');
select is((select jsonb_array_length(items) from public.ph_inspection_templates where farm_id = tests.farm() and inspection_type = 'arrival'), 10,
  'arrival checklist carries all 10 SOP-RC items (FR-QG-07)');
select is((select count(*)::int from public.ph_crops where farm_id = tests.farm()), 0, 'no crop is seeded on the real farm (owner import only)');

-- ---------------------------------------------------------------------------------------------
-- Users
select tests.ph_user('c_phm', array['PHM']) as phm \gset
select tests.ph_user('c_whm', array['WHM']) as whm \gset
select tests.ph_user('c_qam', array['QAM']) as qam \gset
select tests.ph_user('c_dec', array['DEC']) as dec \gset
select tests.ph_user('c_top', array['TOP']) as top \gset
select tests.ph_user('c_pho', array['PHO']) as pho \gset
select tests.ph_user('c_adm', array['ADM']) as adm \gset
select tests.ph_user('c_phm_qam', array['PHM', 'QAM']) as phmqam \gset

-- ---------------------------------------------------------------------------------------------
-- Decision gates
select throws_ok($$ select app.ph_decision_gate(tests.farm(), 'OD-01:B') $$, 'P0428', null, 'an open decision blocks its gate');
select throws_ok($$ update public.ph_open_decisions set decision_state = 'demo_assumption', selected_option = 'B', decided_at = now(), effective_from = now()
                    where farm_id = tests.farm() and code = 'OD-01' $$, 'P0403', null, 'demo assumptions are refused on a real farm');

select tests.as_user(:'dec');
select throws_ok($$ select public.ph_record_decision('OD-01', 'B', 'x') $$, 'P0403', null, 'a non-owner cannot record a decision');
select tests.as_user(:'phm');
select throws_ok($$ select public.ph_record_decision('OD-01', 'Z', 'x') $$, 'P0422', null, 'only listed options can be chosen');
select throws_ok($$ select public.ph_record_decision('OD-01', 'B', '') $$, 'P0422', null, 'a rationale is required');
select is(public.ph_record_decision('OD-01', 'B', 'AS-IS walk-through done') ->> 'status', 'proposed', 'first owner signs: proposed');
select throws_ok($$ select public.ph_record_decision('OD-01', 'B', 'again') $$, 'P0403', null, 'one person cannot sign twice');
select throws_ok($$ select app.ph_decision_gate(tests.farm(), 'OD-01:B') $$, 'P0428', null, 'still blocked until every owner has approved');
select tests.as_user(:'whm');
select throws_ok($$ select public.ph_record_decision('OD-01', 'A', 'other') $$, 'P0422', null, 'approvers approve the proposed option');
select is(public.ph_record_decision('OD-01', 'B', 'agree') ->> 'status', 'proposed', 'second owner signs');
select tests.as_user(:'qam');
select is(public.ph_record_decision('OD-01', 'B', 'agree') ->> 'status', 'decided', 'last owner signs: decided');
select is(app.ph_decision_gate(tests.farm(), 'OD-01:B'), 'OD-01=B', 'gate passes for the decided option');
select throws_ok($$ select app.ph_decision_gate(tests.farm(), 'OD-01:A') $$, 'P0428', null, 'a flow for another option stays blocked');
select throws_ok($$ select public.ph_record_decision('OD-01', 'B', 'again') $$, 'P0422', null, 'a closed decision cannot be re-recorded');
select is((select count(*)::int from public.ph_decision_approvals a join public.ph_open_decisions d on d.id = a.decision_id
            where d.farm_id = tests.farm() and d.code = 'OD-01'), 3, 'approval record holds one row per owner role');
select is((select config_version from public.ph_open_decisions where farm_id = tests.farm() and code = 'OD-01') is not null, true,
  'the decision carries a configuration version');
select throws_ok($$ update public.ph_decision_approvals set comment = 'changed' $$, 'P0403', null, 'approvals are append-only');
select throws_ok($$ select public.ph_record_decision('OD-35', 'x', 'y') $$, 'P0403', null, 'a decision with no named owner cannot be recorded');
-- A person holding two owner roles still signs for one.
select tests.as_user(:'phmqam');
select is(public.ph_record_decision('OD-30', 'Blocky is a pepper type', 'Confirmed on the floor') ->> 'status', 'proposed',
  'one signature per person even with two owner roles');
select throws_ok($$ select public.ph_record_decision('OD-30', 'Blocky is a pepper type', 'second role') $$, 'P0423', null,
  'the same person cannot sign the second owner role');

-- NYV cells become usable only through their decision, and only for the roles it names (OD-38).
select is(app.ph_permission_basis(:'dec', tests.farm(), 'arrival.vehicle_inspection'), null, 'vehicle inspection pending OD-38');
select is(app.ph_denial(:'dec', tests.farm(), 'arrival.vehicle_inspection') ->> 'key', 'ph.denied.pendingDecision', 'reason names the pending decision');
select is(app.ph_denial(:'dec', tests.farm(), 'arrival.vehicle_inspection') ->> 'decision', 'OD-38', '… OD-38');
select tests.as_user(:'top');
select throws_ok($$ select public.ph_record_decision('OD-38', 'Data entry inspects', 'x', array['PHM']) $$, 'P0422', null,
  'a decision activates only cells the matrix leaves pending on it');
reset role;
select is(tests.ph_decide('OD-38', 'Data Entry Clerk inspects incoming vehicles', array['DEC'], array[:'top', :'phm', :'qam']::uuid[]), 'decided', 'OD-38 decided');
select is(app.ph_permission_basis(:'dec', tests.farm(), 'arrival.vehicle_inspection'), 'OD-38:DEC', 'DEC cell activated by OD-38');
select tests.ph_user('c_qao', array['QAO']) as qao \gset
select is(app.ph_permission_basis(:'qao', tests.farm(), 'arrival.vehicle_inspection'), null, 'QAO cell stays pending (not named)');

-- Proposed (P) cells: unusable on the real farm until the record-type owner approves them.
select is(app.ph_permission_basis(:'dec', tests.farm(), 'arrival.create'), null, 'create arrival (DEC ○) not usable yet');
select is(app.ph_denial(:'dec', tests.farm(), 'arrival.create') ->> 'key', 'ph.denied.proposed', 'reason: proposal awaiting approval');
select tests.as_user(:'dec');
select throws_ok(format($$ select public.ph_approve_permission_cell(%L, 'mine') $$,
  (select id from public.ph_permission_cells where farm_id = tests.farm() and action_key = 'arrival.create' and spec_code = 'DEC')),
  'P0403', null, 'a role cannot approve its own proposed permission');
select tests.as_user(:'whm');
select lives_ok(format($$ select public.ph_approve_permission_cell(%L, 'Warehouse Management approves data entry recording arrivals') $$,
  (select id from public.ph_permission_cells where farm_id = tests.farm() and action_key = 'arrival.create' and spec_code = 'DEC')),
  'the record-type owner (WHM for arrivals) approves the proposal');
select is(app.ph_permission_basis(:'dec', tests.farm(), 'arrival.create'), 'P-approved:DEC', 'approved proposal is usable and labelled');
select is(app.ph_permission_basis(:'pho', tests.farm(), 'precool.record'), null, 'other proposals stay unusable');
reset role;
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';
select is(app.ph_permission_basis(:'pho', tests.farm(), 'precool.record'), 'P:PHO', 'owner puts proposals in effect: usable, labelled P');
update public.settings set value = 'false' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

-- Authorisation errors carry a machine-readable reason.
select tests.as_user(:'pho');
select throws_ok($$ select app.ph_authorize(tests.farm(), 'rma.decide') $$, 'P0403', null, 'no cell: refused');

-- ---------------------------------------------------------------------------------------------
-- T-20, generated from the matrix: one user per role; for every implemented (M1) action each role without a usable cell is
-- refused by the same check every server function and transition uses, and each role with one is allowed. Run twice:
-- with proposals not in effect (real-farm default) and in effect (demo setting).
reset role;
create temp table t20 (mode text, role text, action text, expected boolean, actual boolean, refused boolean);
do $$
declare
  r record; a record; u uuid; v_basis text; v_ref boolean; v_mode boolean;
begin
  for r in select spec_code from public.ph_roles where farm_id = tests.farm() loop
    perform tests.ph_user('t20_' || lower(r.spec_code), array[r.spec_code]);
  end loop;
  foreach v_mode in array array[false, true] loop
    update public.settings set value = to_jsonb(v_mode) where farm_id = tests.farm() and key = 'ph_proposals_in_effect';
    for r in select pr.spec_code, p.id as uid from public.ph_roles pr
               join public.user_profiles p on p.full_name = 't20_' || lower(pr.spec_code) where pr.farm_id = tests.farm() loop
      for a in select action_key from public.ph_actions where farm_id = tests.farm() and milestone = 'M1' loop
        v_basis := app.ph_permission_basis(r.uid, tests.farm(), a.action_key);
        perform tests.as_user(r.uid);
        begin
          perform app.ph_authorize(tests.farm(), a.action_key);
          v_ref := false;
        exception when sqlstate 'P0403' then
          v_ref := true;
        end;
        insert into t20 values (case when v_mode then 'proposals' else 'real' end, r.spec_code, a.action_key,
          exists (select 1 from public.ph_permission_cells c where c.farm_id = tests.farm() and c.action_key = a.action_key
                    and c.spec_code = r.spec_code and (c.state = 'active' or (c.state = 'proposed' and v_mode))),
          v_basis is not null, v_ref);
      end loop;
    end loop;
  end loop;
  update public.settings set value = 'false' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';
  perform set_config('request.jwt.claims', '', true);
end $$;
select ok((select count(*) from t20 where not expected) > 500, 'T-20 covers every role × non-granted implemented action (' ||
  (select count(*) from t20 where not expected) || ' refusals checked)');
select is((select count(*)::int from t20 where expected <> actual), 0, 'T-20: effective permission equals the matrix for every role × action');
select is((select count(*)::int from t20 where not expected and not refused), 0, 'T-20: every non-granted action is refused');
select is((select count(*)::int from t20 where expected and refused), 0, 'T-20: every granted action is allowed');

select * from finish();
rollback;
