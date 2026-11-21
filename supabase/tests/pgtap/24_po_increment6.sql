-- Increment 6: grading specification S-07, AWETA schedules S-08/S-09, accountability draft policy, spreadsheet import.
-- Expected values are the ones printed in the source documents (page numbers in the reference JSON).
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
create function tests.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;
create function tests.grade(p jsonb, g text) returns jsonb language sql as $$
  select x from jsonb_array_elements(p -> 'grades') x where x ->> 'grade' = g $$;
grant execute on all functions in schema tests to authenticated;

select tests.ph_user('i_own', array['OWN']) as own \gset
select tests.ph_user('i_qci', array['QCI']) as qci \gset
select tests.ph_user('i_qam', array['QAM']) as qam \gset
select tests.ph_user('i_phm', array['PHM']) as phm \gset
select tests.ph_user('i_mnt', array['MNT']) as mnt \gset
select tests.ph_user('i_cln', array['CLN']) as cln \gset
select tests.ph_user('i_ll', array['LL']) as ll \gset
select tests.ph_user('i_pe', array['PE']) as pe \gset
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

-- ---------------------------------------------------------------------------------------------
-- Specification as supplied
select is((select state from public.ph_specs where farm_id = tests.farm() and code = 'S-07'), 'awaiting_approval', 'S-07 imported awaiting QA approval (OD-43)');
select is((select count(distinct product_code)::int from public.ph_spec_rules r join public.ph_specs s on s.id = r.spec_id where s.farm_id = tests.farm()), 7, 'seven products');
select is((select max_pct from public.ph_spec_tolerances t join public.ph_specs s on s.id = t.spec_id where s.farm_id = tests.farm()
            and product_code = 'cherry_tomato' and grade = 'gr2' and category = 'unacceptable'), 1::numeric, 'cherry tomato G2 unacceptable tolerance 1 % (p.10)');
select is((select string_agg(grade || '=' || max_pct, ',' order by grade) from public.ph_spec_tolerances t join public.ph_specs s on s.id = t.spec_id where s.farm_id = tests.farm()
            and product_code = 'regular_tomato' and category = 'colour'), 'gr1=10,gr2=20,premium=3', 'tomato colour tolerance Premium 3 / G1 10 / G2 20 % (p.8)');

select tests.as_user(:'qci');
-- Tomato 8 cm, stage 4: Premium/G1 meets; G2 fails (G2 diameter is 3–6 or 10–15 cm).
select is(tests.grade(public.ph_spec_check('regular_tomato', null, '{"colour_stage":4,"diameter":8}'), 'gr1') ->> 'result', 'meets', 'tomato 8 cm stage 4 → G1');
select is(tests.grade(public.ph_spec_check('regular_tomato', null, '{"colour_stage":4,"diameter":8}'), 'gr2') ->> 'result', 'fails', 'and not G2 (3–6 / 10–15 cm)');
select is(tests.grade(public.ph_spec_check('regular_tomato', null, '{"colour_stage":4,"diameter":12}'), 'gr2') ->> 'result', 'meets', 'tomato 12 cm → G2 second band');
select is(tests.grade(public.ph_spec_check('regular_tomato', null, '{"colour_stage":4,"diameter":6}'), 'gr1') ->> 'result', 'boundary', 'exactly 6 cm: boundary flagged for the inspector (OD-45)');
-- Stage 6: G1 only for the DC with no softness.
select is(tests.grade(public.ph_spec_check('regular_tomato', null, '{"colour_stage":6,"diameter":8}'), 'gr1') ->> 'result', 'fails', 'stage 6 tomato is not G1 outside the DC');
select is(tests.grade(public.ph_spec_check('regular_tomato', 'DC', '{"colour_stage":6,"diameter":8}'), 'gr1') ->> 'result', 'meets', 'stage 6 tomato G1 for the DC, not soft');
select is(tests.grade(public.ph_spec_check('regular_tomato', 'DC', '{"colour_stage":6,"diameter":8,"soft":true}'), 'gr1') ->> 'result', 'fails', 'but not when soft');
-- Customer override replaces the standard size rule: Export tomato 100–250 g.
select is(tests.grade(public.ph_spec_check('regular_tomato', 'Export', '{"colour_stage":4,"weight":120}'), 'gr1') ->> 'result', 'meets', 'Export: 100–250 g');
select is(tests.grade(public.ph_spec_check('regular_tomato', 'Export', '{"colour_stage":4,"weight":300}'), 'gr1') ->> 'result', 'fails', 'Export: 300 g refused');
-- Mini cucumber G1 length by customer: Abay 7–10 cm, Thanet Earth 7–13 cm.
select is(tests.grade(public.ph_spec_check('mini_cucumber', 'Abay', '{"colour_coverage":100,"diameter":2,"length":12}'), 'gr1') ->> 'result', 'fails', 'Abay mini cucumber 12 cm: not G1');
select is(tests.grade(public.ph_spec_check('mini_cucumber', 'Thanet Earth', '{"colour_coverage":100,"diameter":2,"length":12}'), 'gr1') ->> 'result', 'meets', 'Thanet Earth 12 cm: G1');
-- Sweet Bite 19–45 g as G1 is inactive until customer approval (R-GR-05): a 20 g fruit for no customer is not checked on weight.
select is(jsonb_array_length(tests.grade(public.ph_spec_check('sweetbite', null, '{"weight":20}'), 'gr1') -> 'checks'), 0, 'Sweet Bite 19–45 g band inactive');
-- Defect tolerances: cherry tomato G2 unacceptable 1 % — 2 of 100 fails; live insects on tomato → QA review, not rejection (C-05).
select is(tests.grade(public.ph_spec_check('cherry_tomato', null, '{"colour_stage":4}', '{"sample":100,"unacceptable":2}'), 'gr2') ->> 'result', 'fails', 'cherry G2: 2 % unacceptable > 1 %');
select is(tests.grade(public.ph_spec_check('regular_tomato', null, '{"colour_stage":4,"diameter":8}', '{"sample":50,"live_insects":1}'), 'gr1') ->> 'result', 'qa_review',
  'live insects on tomato: evaluated internally (C-05)');
select ok(tests.grade(public.ph_spec_check('blocky', null, '{"colour_coverage":80}', '{"sample":50,"live_insects":1}'), 'gr1') -> 'fails' ? 'live_insects', 'live insects on pepper: unacceptable');

select throws_ok(format($$ select public.ph_spec_approve(%L, 'x') $$, (select id from public.ph_specs where farm_id = tests.farm() and code = 'S-07')), 'P0403', null,
  'an inspector does not approve the specification');
select tests.as_user(:'own');
select throws_ok(format($$ select public.ph_spec_approve(%L, 'x') $$, (select id from public.ph_specs where farm_id = tests.farm() and code = 'S-07')), 'P0403', null,
  'nor the Owner (QA independence)');
select tests.as_user(:'qam');
select is(public.ph_spec_approve((select id from public.ph_specs where farm_id = tests.farm() and code = 'S-07'), 'Reviewed against the PDF (test)') ->> 'state', 'approved', 'QA Manager approves');
select is(public.ph_spec_check('regular_tomato', null, '{"diameter":8}') ->> 'state', 'approved', 'checks now cite the approved version');

-- ---------------------------------------------------------------------------------------------
-- Maintenance and cleaning: nothing generated before approval
select is((select string_agg(code || ':' || state, ',' order by code) from public.ph_pm_plans where farm_id = tests.farm()), 'S-08:pending_approval,S-09:pending_approval', 'both schedules pending (OD-44)');
select is((select count(*)::int from public.ph_pm_items i join public.ph_pm_plans p on p.id = i.plan_id where p.farm_id = tests.farm()), 12, '8 maintenance + 4 cleaning items');
select is((select interval_hours || '/' || interval_months from public.ph_pm_items i join public.ph_pm_plans p on p.id = i.plan_id where p.farm_id = tests.farm() and p.code = 'S-08' and i.code = 'h500_m6'), '500/6', '500 h or 6 months');
select is((public.po_pm_tick() ->> 'created')::int, 0, 'no work before approval');
select tests.as_user(:'mnt');
select throws_ok($$ select public.ph_pm_approve((select id from public.ph_pm_plans where code = 'S-08' limit 1), 'x') $$, 'P0403', null, 'a technician does not approve the schedule');
select is(public.ph_pm_meter_record(1000, 'start reading (test)') ->> 'hours', '1000', 'running hours recorded');
update public.ph_pm_meter set read_at = now() - interval '2 hours' where hours = 1000;
select throws_ok($$ select public.ph_pm_meter_record(900) $$, 'P0422', null, 'hours cannot go down');
select tests.as_user(:'own');
select public.ph_pm_approve(id, 'Approved for the site (test)') from public.ph_pm_plans where farm_id = tests.farm();
select set_config('request.jwt.claims', '', true);
select is((public.po_pm_tick() ->> 'created')::int, 4, 'after approval: the four daily checks are created (2 maintenance, 2 cleaning)');
select is((public.po_pm_tick() ->> 'created')::int, 0, 'a second tick creates nothing (one open task per item)');
-- 30 hours later the 30 h items fall due (maintenance filters, cleaning deep clean).
select tests.as_user(:'mnt');
select public.ph_pm_meter_record(1030);
update public.ph_pm_meter set read_at = now() + interval '1 minute' where hours = 1030;
select set_config('request.jwt.claims', '', true);
select is((select string_agg(p.code || '/' || i.code, ',' order by p.code) from public.ph_tasks t join public.ph_pm_items i on i.id = t.pm_item_id join public.ph_pm_plans p on p.id = i.plan_id
            where t.farm_id = tests.farm() and i.code = 'h30_d7'), null, 'not yet due before the tick');
select is((public.po_pm_tick() ->> 'created')::int, 2, 'at +30 h: S-08 filters and S-09 deep clean are due');
-- Cleaning done → Maintenance gets the restart check; the cleaner cannot restart (no technical release action).
select tests.as_user(:'cln');
select public.ph_task_step(t.id, 'complete', '{"note":"done (test)"}') from public.ph_tasks t join public.ph_pm_items i on i.id = t.pm_item_id join public.ph_pm_plans p on p.id = i.plan_id
 where p.farm_id = tests.farm() and p.code = 'S-09' and i.code = 'h30_d7';
select is((select hours_at from public.ph_pm_done d join public.ph_pm_items i on i.id = d.item_id join public.ph_pm_plans p on p.id = i.plan_id where p.code = 'S-09' and i.code = 'h30_d7' and p.farm_id = tests.farm()),
  1030::numeric, 'completion recorded with the running hours');
select is((select count(*)::int from public.ph_tasks where farm_id = tests.farm() and assignee_role = 'MNT' and source = 'rule' and title like 'بعد التنظيف%'), 1,
  'after cleaning, Maintenance gets the guards / readiness check before restart (S-09 step 5)');
select throws_ok($$ select public.ph_pm_start_preseason() $$, 'P0403', null, 'the cleaning team does not start a pre-season check');

-- ---------------------------------------------------------------------------------------------
-- Accountability: a draft, not in force
select tests.as_user(:'phm');
select is((select state from public.ph_acc_policy where farm_id = tests.farm()), 'draft_inactive', 'policy is a draft, inactive (OD-42)');
select throws_ok(format($$ select public.ph_acc_record(%L, current_date, 'Late shift report (test)') $$, :'ll'), 'P0422', null, 'no violation can be recorded while it is not in force');
select throws_ok(format($$ select public.ph_acc_decide((select id from public.ph_acc_policy where farm_id = tests.farm()), '{LL}', 'x') $$), 'P0403', null, 'the PHM cannot put it in force');
select tests.as_user(:'own');
select is(public.ph_acc_decide((select id from public.ph_acc_policy where farm_id = tests.farm()), '{LL}', 'Scope decided: line supervisors (test)') ->> 'state', 'active', 'the Owner decides the scope (C-02)');
select tests.as_user(:'phm');
select is(public.ph_acc_record(:'ll', current_date, 'V1 (test)') ->> 'outcome', 'verbal_warning', '1st: verbal warning');
select public.ph_acc_record(:'ll', current_date, 'V2 (test)'), public.ph_acc_record(:'ll', current_date, 'V3 (test)');
select is(public.ph_acc_record(:'ll', current_date, 'V4 (test)') ->> 'outcome', 'hr_referred', '4th: referred to HR');
select throws_ok(format($$ select public.ph_acc_record(%L, current_date, 'x') $$, :'pe'), 'P0422', null, 'out of the decided scope (PE)');
select ok((select bool_and('LL' = any (roles)) from public.ph_acc_people()) and exists (select 1 from public.ph_acc_people() where id = :'ll'),
  'the record form lists only people in the decided scope');
select ok(not exists (select 1 from public.ph_acc_people() where id = :'pe'), 'people outside the scope are not listed');
select tests.as_user(:'qci');
select throws_ok($$ select * from public.ph_acc_people() $$, 'P0403', null, 'only those allowed to record see the list');
select tests.as_user(:'phm');
select throws_ok(format($$ select public.ph_acc_hr_decision(%L, 'x') $$, (select id from public.ph_acc_violations where sequence_no = 4 and farm_id = tests.farm())), 'P0403', null,
  'no one records HR decisions until the Owner assigns that authority');
select tests.as_user(:'qci');
set local role authenticated;
select is((select count(*)::int from public.ph_acc_register), 0, 'the register is restricted (row-level security)');
reset role;
select tests.as_user(:'phm');
set local role authenticated;
select is((select count(*)::int from public.ph_acc_register), 4, 'managers see it');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Spreadsheet import: rows go through the maker step, duplicates and errors to the exception queue
select tests.as_user(:'own');
select (public.ph_import_rows('ph_customers', '[{"code":"IMP1","name_en":"Import one"},{"code":"IMP1","name_en":"Duplicate"},{"code":"IMP2"},{"code":"IMP3","name_en":"Three","market_type":"export"}]', 'customers.csv')) as imp \gset
select is((:'imp'::jsonb ->> 'saved')::int, 2, 'two rows saved');
select is((:'imp'::jsonb ->> 'failed')::int, 2, 'a duplicate code and a row missing its name go to the exception queue');
select is((select verification_status::text from public.ph_customers where farm_id = tests.farm() and code = 'IMP1'), 'not_yet_verified', 'imported rows still need a second person''s approval');
select is((public.ph_import_rows('ph_customers', '[{"code":"IMP1","name_en":"Again"}]') ->> 'skipped')::int, 1, 'existing codes are skipped unless updating is chosen');
select is(public.ph_import_resolve((select e.id from public.ph_import_exceptions e where e.farm_id = tests.farm() and e.data ->> 'code' = 'IMP2'), 'retry', '{"code":"IMP2","name_en":"Fixed"}') ->> 'action',
  'retry', 'a corrected row is saved from the queue');
select throws_ok($$ select public.ph_import_rows('users', '[{"x":1}]') $$, 'P0422', null, 'only master tables can be imported');
select tests.as_user(:'qci');
select throws_ok($$ select public.ph_import_rows('ph_customers', '[{"code":"X","name_en":"x"}]') $$, 'P0403', null, 'an inspector cannot import');

select * from finish();
rollback;
