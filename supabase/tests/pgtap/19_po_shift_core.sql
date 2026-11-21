-- Packhouse operations increment 1: line scope, labour sheet, team output, downtime, order timing and the three KPIs of
-- S-04 p.3, with the owner's acceptance numbers (40 × 7 kg / 4 h = 70 kg/h; 180 − 150 = +30 min). Every write has an allowed
-- and a forbidden case.
begin;
select no_plan();

create function tests.ph_user(p_name text, p_codes text[], p_line uuid default null) returns uuid
language plpgsql as $$
declare v uuid; c text;
begin
  v := tests.create_user(p_name);
  foreach c in array p_codes loop
    insert into public.user_roles (farm_id, user_id, role_id, ph_line_id, valid_from)
    values (tests.farm(), v, tests.role('ph_' || lower(c)), p_line, now() - interval '1 day');
  end loop;
  return v;
end $$;
create function tests.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true) $$;
create function tests.ph_crop(p_code text) returns uuid language sql as $$
  select id from public.ph_crops where farm_id = tests.farm() and code = p_code and superseded_at is null and voided_at is null $$;
create function tests.ph_line(p_code text) returns uuid language sql as $$
  select id from public.ph_lines where farm_id = tests.farm() and code = p_code and voided_at is null $$;
-- Local time on a day relative to three days ago (all test events are in the past).
create function tests.at(p_day integer, p_time text) returns timestamptz language sql stable as $$
  select ((app.ph_local_date() - 3 + p_day) + p_time::time) at time zone 'Asia/Amman' $$;
create function tests.worker(p_code text) returns uuid language sql as $$
  insert into public.workers (farm_id, code, full_name) values (tests.farm(), p_code, 'Test worker ' || p_code) returning id $$;
create function tests.task(p_code text) returns uuid language sql as $$
  select id from public.ph_task_kinds where farm_id = tests.farm() and code = p_code and voided_at is null $$;
create function tests.kpi(p_worker uuid, p_from timestamptz, p_to timestamptz) returns numeric language sql as $$
  select kg_per_hour from public.ph_kpi_productivity(p_from, p_to) where worker_id = p_worker $$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- People, master data
select app.ph_load_sop_reference(tests.farm());
select tests.ph_user('s_phm', array['PHM']) as phm \gset
select tests.ph_user('s_pe', array['PE']) as pe \gset
select tests.ph_user('s_ll_a', array['LL'], tests.ph_line('A')) as ll_a \gset
select tests.ph_user('s_ll_b', array['LL'], tests.ph_line('B')) as ll_b \gset
select tests.ph_user('s_qci', array['QCI']) as qci \gset
select tests.ph_user('s_mnt', array['MNT']) as mnt \gset
select tests.ph_user('s_adm', array['ADM']) as adm \gset
select tests.ph_user('s_sal', array['SAL']) as sal \gset
select tests.ph_user('s_qcm', array['QCM']) as qcm \gset
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

select tests.worker('W1') as w1 \gset
select tests.worker('W2') as w2 \gset
select tests.worker('W3') as w3 \gset
select tests.worker('W4') as w4 \gset
select tests.worker('W5') as w5 \gset
select tests.worker('W6') as w6 \gset

select tests.as_user(:'adm');
select (public.ph_save_master('ph_pack_formats', null, '{"code":"CTN-7KG","name_ar":"كرتونة 7 كغم (اختبار)","kind":"carton","nominal_net_kg":7}') ->> 'id') as pf7 \gset
select (public.ph_save_master('ph_pack_formats', null, '{"code":"CTN-5KG","name_ar":"كرتونة 5 كغم (اختبار)","kind":"carton","nominal_net_kg":5}') ->> 'id') as pf5 \gset
select (public.ph_save_master('ph_downtime_causes', null, '{"code":"BELT","name_ar":"سير (اختبار)"}') ->> 'id') as cause \gset
select tests.as_user(:'phm');
select is(public.ph_approve_master('ph_pack_formats', :'pf7', 'Checked') ->> 'approved', 'true', 'master: PHM approves the 7 kg pack (maker ≠ checker)');
select public.ph_approve_master('ph_pack_formats', :'pf5', 'Checked');
select public.ph_approve_master('ph_downtime_causes', :'cause', 'Checked');
select tests.as_user(:'adm');
select throws_ok($$ select public.ph_approve_master('ph_pack_formats', id, 'self') from public.ph_pack_formats where code = 'CTN-7KG' $$,
  'P0403', null, 'master: the maker cannot approve (and ADM holds no approve cell)');

-- ---------------------------------------------------------------------------------------------
-- Shift and line shifts; line scope
select tests.as_user(:'ll_a');
select throws_ok($$ select public.ph_open_shift('{"planned_start":"2026-01-01T06:00:00Z","planned_end":"2026-01-01T14:00:00Z"}') $$,
  'P0403', null, 'shift: a supervisor cannot open a shift');
select tests.as_user(:'pe');
select (public.ph_open_shift(jsonb_build_object('shift_date', app.ph_local_date() - 3, 'planned_start', tests.at(0, '06:00'),
          'planned_end', tests.at(0, '18:00'), 'engineer_user_id', :'pe')) ->> 'id') as shift \gset
select throws_ok(format($$ select public.ph_open_shift(jsonb_build_object('planned_start', now(), 'planned_end', now() + interval '1 hour',
                   'engineer_user_id', %L)) $$, :'ll_a'), 'P0422', null, 'shift: the engineer on duty must hold the PE role');
select (public.ph_open_line_shift(:'shift', tests.ph_line('A'), :'ll_a') ->> 'id') as ls_a \gset
select tests.as_user(:'ll_b');
select throws_ok(format($$ select public.ph_open_line_shift(%L, %L) $$, :'shift', tests.ph_line('C')),
  'P0403', null, 'line scope: a line-B supervisor cannot open line C');
select (public.ph_open_line_shift(:'shift', tests.ph_line('B')) ->> 'id') as ls_b \gset
select is((select supervisor_user_id from public.ph_line_shifts where id = :'ls_b'), :'ll_b'::uuid, 'line scope: a supervisor opens their own line for themself');

-- Readiness: a "not ready" item raises an issue to the engineer on duty.
select tests.as_user(:'ll_a');
select is((public.ph_record_readiness(:'ls_a', '{"line_ready":"ok","packaging_inside":"no","hygiene_workwear":"ok"}', 'Cartons short') ->> 'not_ready')::int, 1,
  'readiness: one item not ready');
select is((select count(*)::int from public.ph_shift_issues where line_shift_id = :'ls_a' and kind = 'readiness' and routed_role = 'PE'), 1,
  'readiness: the shortage goes to the engineer on duty (S-04 LS §4)');

-- ---------------------------------------------------------------------------------------------
-- KPI 1: 40 conforming boxes × 7 kg in 4 actual packing hours = 70 kg per worker-hour
select tests.as_user(:'ll_a');
select (public.ph_labour_start(:'ls_a', array[:'w1'::uuid], tests.task('packing'), tests.at(0, '08:00')::text) -> 'ids' ->> 0) as i_w1 \gset
select public.ph_labour_end(:'i_w1', tests.at(0, '12:00')::text);
select public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a', 'worker_id', :'w1', 'grade', 'gr1', 'pack_format_id', :'pf7',
                                                  'boxes', 40, 'period_end', tests.at(0, '12:00')));
select is(tests.kpi(:'w1', tests.at(0, '06:00'), tests.at(0, '18:00')), 70.00::numeric, 'KPI 1: 40 × 7 kg / 4 h = 70 kg per worker-hour');
-- Non-conforming boxes are recorded but not counted.
select public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a', 'worker_id', :'w1', 'grade', 'gr1', 'pack_format_id', :'pf7',
                                                  'boxes', 5, 'conforming', false, 'period_end', tests.at(0, '12:00')));
select is(tests.kpi(:'w1', tests.at(0, '06:00'), tests.at(0, '18:00')), 70.00::numeric, 'KPI 1: non-conforming boxes are excluded');

-- Mixed 5 / 7 kg in one shift: (20 × 5 + 20 × 7) / 4 h = 60
select (public.ph_labour_start(:'ls_a', array[:'w2'::uuid], tests.task('packing'), tests.at(0, '08:00')::text) -> 'ids' ->> 0) as i_w2 \gset
select public.ph_labour_end(:'i_w2', tests.at(0, '12:00')::text);
select public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a', 'worker_id', :'w2', 'grade', 'gr1', 'pack_format_id', :'pf5',
                                                  'boxes', 20, 'period_end', tests.at(0, '10:00')));
select public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a', 'worker_id', :'w2', 'grade', 'gr2', 'pack_format_id', :'pf7',
                                                  'boxes', 20, 'period_end', tests.at(0, '12:00')));
select is(tests.kpi(:'w2', tests.at(0, '06:00'), tests.at(0, '18:00')), 60.00::numeric, 'KPI 1: mixed 5 / 7 kg packs sum boxes × net kg per box');

-- A worker moving mid-shift: line A packing 08–10 (20 × 7), other duty 10–11, line B packing 11–13 (10 × 5) → 190 kg / 4 h
select (public.ph_labour_start(:'ls_a', array[:'w3'::uuid], tests.task('packing'), tests.at(0, '08:00')::text) -> 'ids' ->> 0) as i_w3 \gset
select public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a', 'worker_id', :'w3', 'grade', 'gr1', 'pack_format_id', :'pf7',
                                                  'boxes', 20, 'period_end', tests.at(0, '10:00')));
select (public.ph_labour_move(:'i_w3', :'ls_a', tests.task('other_duty'), tests.at(0, '10:00')::text) ->> 'started') as i_w3b \gset
select public.ph_labour_end(:'i_w3b', tests.at(0, '11:00')::text);
select tests.as_user(:'ll_b');
select throws_ok(format($$ select public.ph_labour_start(%L, array[%L::uuid], tests.task('packing'), %L) $$,
                        :'ls_b', :'w3', tests.at(0, '10:30')::text),
  'P0409', null, 'labour: the same worker cannot be on two tasks at once (no overlapping worker-hours)');
select (public.ph_labour_start(:'ls_b', array[:'w3'::uuid], tests.task('packing'), tests.at(0, '11:00')::text) -> 'ids' ->> 0) as i_w3c \gset
select public.ph_labour_end(:'i_w3c', tests.at(0, '13:00')::text);
select public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_b', 'worker_id', :'w3', 'grade', 'gr1', 'pack_format_id', :'pf5',
                                                  'boxes', 10, 'period_end', tests.at(0, '13:00')));
select tests.as_user(:'pe');
select is(tests.kpi(:'w3', tests.at(0, '06:00'), tests.at(0, '18:00')), 47.50::numeric,
  'KPI 1: a worker moved mid-shift — 190 kg over 4 packing hours (other duty excluded)');
select is((select packing_hours from public.ph_kpi_productivity(tests.at(0, '06:00'), tests.at(0, '18:00')) where worker_id = :'w3'), 4.000::numeric,
  'KPI 1: the hour on another duty is not packing time');

-- ---------------------------------------------------------------------------------------------
-- Shared work: a team of two, a third joins at 10:00
select tests.as_user(:'ll_a');
select throws_ok(format($$ select public.ph_labour_start(%L, array[%L::uuid], tests.task('shared_sorting'), %L) $$, :'ls_a', :'w4', tests.at(0, '08:00')::text),
  'P0422', null, 'team: shared work is recorded as a team, not per person');
select (public.ph_team_start(:'ls_a', tests.task('shared_sorting'), array[:'w4'::uuid, :'w5'::uuid], tests.at(0, '08:00')::text, 'Sweet Bite sorting') ->> 'id') as team \gset
select public.ph_labour_start(:'ls_a', array[:'w6'::uuid], tests.task('shared_sorting'), tests.at(0, '10:00')::text, null, null, :'team');
select throws_ok(format($$ select public.ph_record_output(jsonb_build_object('line_shift_id', %L, 'team_session_id', %L, 'grade', 'gr1',
                   'pack_format_id', %L, 'boxes', 105, 'period_start', %L, 'period_end', %L)) $$, :'ls_a', :'team', :'pf5', tests.at(0, '08:00'), tests.at(0, '11:00')),
  'P0422', null, 'team: a period across a membership change is refused (record the count at the change)');
select is((public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a', 'team_session_id', :'team', 'grade', 'gr1', 'pack_format_id', :'pf5',
           'boxes', 60, 'period_start', tests.at(0, '08:00'), 'period_end', tests.at(0, '10:00'))) ->> 'members')::int, 2,
  'team: the first period has two members');
select is((public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a', 'team_session_id', :'team', 'grade', 'gr1', 'pack_format_id', :'pf5',
           'boxes', 45, 'period_end', tests.at(0, '11:00'))) ->> 'members')::int, 3,
  'team: the next period starts where the last ended and has three members');
select public.ph_team_end(:'team', tests.at(0, '11:00')::text);
select tests.as_user(:'pe');
select is((select kg_per_worker_hour from public.ph_kpi_team(tests.at(0, '06:00'), tests.at(0, '18:00')) where team_session_id = :'team'),
  75.00::numeric, 'KPI 1 shared: 525 team kg / 7 worker-hours = 75');
select is((select kg_team_allocated from public.ph_kpi_productivity(tests.at(0, '06:00'), tests.at(0, '18:00')) where worker_id = :'w4'),
  225.000::numeric, 'KPI 1 shared: allocated average 150 + 75 kg for a member present all morning');
select is((select kg_per_hour from public.ph_kpi_productivity(tests.at(0, '06:00'), tests.at(0, '18:00')) where worker_id = :'w6'),
  75.00::numeric, 'KPI 1 shared: the member who joined late gets only the later period');
select ok((select includes_allocation from public.ph_kpi_productivity(tests.at(0, '06:00'), tests.at(0, '18:00')) where worker_id = :'w6'),
  'KPI 1 shared: allocated values are labelled as allocated averages');
select is((select sum(kg_total) from public.ph_kpi_productivity(tests.at(0, '06:00'), tests.at(0, '18:00'))),
  (select sum(kg) from public.ph_output_entries where line_shift_id in (:'ls_a', :'ls_b') and conforming and voided_at is null),
  'KPI 1: the sum over workers equals the recorded conforming kg — no kg counted twice');

-- Daily rate across shifts: kg and hours summed before dividing.
select tests.as_user(:'pe');
select (public.ph_open_shift(jsonb_build_object('shift_date', app.ph_local_date() - 3, 'planned_start', tests.at(0, '18:00'),
          'planned_end', tests.at(1, '02:00'), 'engineer_user_id', :'pe')) ->> 'id') as shift2 \gset
select (public.ph_open_line_shift(:'shift2', tests.ph_line('A'), :'ll_a') ->> 'id') as ls_a2 \gset
select tests.as_user(:'ll_a');
select (public.ph_labour_start(:'ls_a2', array[:'w1'::uuid], tests.task('packing'), tests.at(0, '19:00')::text) -> 'ids' ->> 0) as i_w1b \gset
select public.ph_labour_end(:'i_w1b', tests.at(0, '21:00')::text);
select public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a2', 'worker_id', :'w1', 'grade', 'gr1', 'pack_format_id', :'pf7',
                                                  'boxes', 10, 'period_end', tests.at(0, '21:00')));
select tests.as_user(:'pe');
select is(tests.kpi(:'w1', tests.at(0, '00:00'), tests.at(1, '00:00')), 58.33::numeric,
  'KPI 1 daily: (280 + 70) kg / (4 + 2) h = 58.33, not the average of the two shift rates');

-- ---------------------------------------------------------------------------------------------
-- Duplicate submission, conflicting edits, restricted records
select tests.as_user(:'ll_a');
select gen_random_uuid() as req \gset
select public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a', 'worker_id', :'w2', 'grade', 'gr1', 'pack_format_id', :'pf7',
                                                  'boxes', 3, 'period_end', tests.at(0, '12:00')), :'req');
select is((public.ph_record_output(jsonb_build_object('line_shift_id', :'ls_a', 'worker_id', :'w2', 'grade', 'gr1', 'pack_format_id', :'pf7',
           'boxes', 3, 'period_end', tests.at(0, '12:00')), :'req') ->> 'repeated'), 'true', 'duplicate: a repeated submission returns the first answer');
select is((select count(*)::int from public.ph_output_entries where worker_id = :'w2' and boxes = 3), 1, 'duplicate: only one record exists');
select id as dup_id, version as dup_v from public.ph_output_entries where worker_id = :'w2' and boxes = 3 \gset
select is((public.ph_correct_output(:'dup_id', :'dup_v', '{"boxes":4}', 'Miscounted') ->> 'version')::int, :'dup_v'::int + 1, 'correction: with the current version and a reason');
select throws_ok(format($$ select public.ph_correct_output(%L, %s, '{"boxes":5}', 'Other device') $$, :'dup_id', :'dup_v'),
  'P0409', null, 'conflict: an edit based on an older version is refused');
select throws_ok(format($$ select public.ph_correct_output(%L, %s, '{"boxes":5}', '') $$, :'dup_id', :'dup_v'::int + 1),
  'P0422', null, 'correction: a reason is required');
select public.ph_void_labour_record('ph_output_entries', :'dup_id', 'Entered on the wrong worker');
select ok((select voided_at is not null from public.ph_output_entries where id = :'dup_id'), 'void: with a reason, never deleted');

select tests.as_user(:'ll_b');
select throws_ok(format($$ select public.ph_record_output(jsonb_build_object('line_shift_id', %L, 'worker_id', %L, 'grade', 'gr1',
                   'pack_format_id', %L, 'boxes', 1)) $$, :'ls_a', :'w1', :'pf7'),
  'P0403', null, 'line scope: a line-B supervisor cannot record on line A');
select tests.login(:'ll_b');
select is((select count(*)::int from public.ph_output_entries where line_shift_id = :'ls_a'), 0, 'line scope: line A output rows are invisible to a line-B supervisor');
select ok((select count(*)::int from public.ph_output_entries where line_shift_id = :'ls_b') > 0, 'line scope: own line rows are visible');
select is((select count(*)::int from public.ph_kpi_productivity(tests.at(0, '06:00'), tests.at(0, '18:00')) where worker_id = :'w1'), 0,
  'line scope: worker productivity on another line is not returned');
select throws_ok($$ insert into public.ph_output_entries (farm_id, line_shift_id, worker_id, grade, pack_format_id, net_kg_per_box, boxes, period_end)
                   select tests.farm(), id, null, 'gr1', null, 1, 1, now() from public.ph_line_shifts limit 1 $$,
  '42501', null, 'API: direct writes to labour tables are refused');
select tests.logout();
select tests.login(:'phm');
select ok((select count(*)::int from public.ph_output_entries) >= 8, 'PHM sees every line');
select tests.logout();

-- Proposals not in effect (real farm): the proposed labour cell does not authorise.
update public.settings set value = 'false' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';
select tests.as_user(:'ll_a');
select throws_ok(format($$ select public.ph_labour_start(%L, array[%L::uuid], tests.task('packing'), %L) $$, :'ls_a', :'w5', tests.at(0, '13:00')::text),
  'P0403', null, 'real farm: a proposed (P) cell is refused until approved');
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

-- Individual overrides: a deny wins over the role cell; a grant authorises without a role cell.
insert into public.ph_user_overrides (farm_id, user_id, action_key, effect, line_id, reason)
values (tests.farm(), :'ll_a', 'labour.record', 'deny', tests.ph_line('A'), 'Test deny');
select tests.as_user(:'ll_a');
select throws_ok(format($$ select public.ph_labour_start(%L, array[%L::uuid], tests.task('packing'), %L) $$, :'ls_a', :'w5', tests.at(0, '13:00')::text),
  'P0403', null, 'override: an individual deny wins over the role');
update public.ph_user_overrides set valid_from = now() - interval '1 hour', valid_to = now() where user_id = :'ll_a';
insert into public.ph_user_overrides (farm_id, user_id, action_key, effect, reason)
values (tests.farm(), :'qci', 'report.kpi_view', 'grant', 'Test grant');
select tests.as_user(:'qci');
select ok(app.ph_can(tests.farm(), 'report.kpi_view'), 'override: an individual grant authorises without a role cell');

-- ---------------------------------------------------------------------------------------------
-- Submission: open tasks block it; a submitted sheet is closed to the supervisor; a submitted zero differs from no submission
select tests.as_user(:'ll_a');
select public.ph_labour_start(:'ls_a', array[:'w5'::uuid], tests.task('packing'), tests.at(0, '13:00')::text);
select throws_ok(format($$ select public.ph_submit_line_shift(%L) $$, :'ls_a'), 'P0422', null, 'submit: refused while a task is open');
update public.ph_labour_intervals set ended_at = tests.at(0, '14:00') where line_shift_id = :'ls_a' and ended_at is null;
select is((public.ph_submit_line_shift(:'ls_a', '{"full_pallets":2,"partial_pallets":1}') ->> 'zero')::boolean, false, 'submit: line A submitted with output');
select throws_ok(format($$ select public.ph_record_output(jsonb_build_object('line_shift_id', %L, 'worker_id', %L, 'grade', 'gr1',
                   'pack_format_id', %L, 'boxes', 1)) $$, :'ls_a', :'w1', :'pf7'),
  'P0422', null, 'submit: the supervisor cannot add to a submitted sheet');
select tests.as_user(:'pe');
select is((public.ph_reopen_line_shift(:'ls_a', 'Late box count') ->> 'reopened')::boolean, true, 'submit: the engineer can reopen with a reason');
select tests.as_user(:'ll_a');
select public.ph_submit_line_shift(:'ls_a');
select tests.as_user(:'pe');
select (public.ph_open_line_shift(:'shift', tests.ph_line('C'), :'ll_a') ->> 'id') as ls_c \gset
select tests.as_user(:'pe');
select is((public.ph_submit_line_shift(:'ls_c') ->> 'zero')::boolean, true, 'submit: a submitted zero is recorded as such');

-- ---------------------------------------------------------------------------------------------
-- QC routing through the engineer (S-04 LS §1)
select tests.as_user(:'qci');
select (public.ph_report_issue(jsonb_build_object('line_shift_id', :'ls_b', 'kind', 'qc_observation', 'description', 'Label weight wrong')) ->> 'id') as obs \gset
select is((select routed_role from public.ph_shift_issues where id = :'obs'), 'PE', 'QC: an observation goes to the engineer on duty, not the supervisor');
select is(tests.notifications(:'ll_b', 'po_issue'), 0, 'QC: the supervisor is not notified directly');
select ok(tests.notifications(:'pe', 'po_issue') > 0, 'QC: the engineer is notified');
select throws_ok(format($$ select public.ph_report_issue(jsonb_build_object('line_shift_id', %L, 'kind', 'instruction', 'description', 'x')) $$, :'ls_b'),
  'P0403', null, 'QC: QC cannot instruct the supervisor');
select tests.as_user(:'pe');
select public.ph_report_issue(jsonb_build_object('line_shift_id', :'ls_b', 'kind', 'instruction', 'parent_id', :'obs', 'description', 'Re-label the last pallet'));
select is(tests.notifications(:'ll_b', 'po_instruction'), 1, 'QC: the engineer relays the instruction to the supervisor');

-- ---------------------------------------------------------------------------------------------
-- KPI 2: downtime — midnight, overlap on one line, shared equipment, open stop at the cutoff
select tests.as_user(:'pe');
select (public.ph_report_stop(jsonb_build_object('line_ids', jsonb_build_array(tests.ph_line('A')), 'observed_fault', 'Belt slipping',
          'stopped_at', tests.at(0, '23:30'))) ->> 'id') as st_mid \gset
select is((public.ph_stop_step(:'st_mid', 'restart', jsonb_build_object('restarted_at', tests.at(1, '00:45'))) ->> 'minutes')::numeric, 75.0,
  'downtime: stop to restart = 75 minutes across midnight');
select is((select minutes from public.ph_kpi_downtime(tests.at(0, '00:00'), tests.at(1, '00:00')) where line_code = 'A'), 30.0,
  'downtime: the first day gets the 30 minutes before midnight');
select is((select minutes from public.ph_kpi_downtime(tests.at(1, '00:00'), tests.at(2, '00:00')) where line_code = 'A'), 45.0,
  'downtime: the next day gets the 45 minutes after midnight');
select is((public.ph_stop_step(:'st_mid', 'restart', jsonb_build_object('restarted_at', tests.at(1, '01:00'))) ->> 'repeated')::boolean, true,
  'downtime: a repeated restart returns the first one');
select (public.ph_report_stop(jsonb_build_object('line_ids', jsonb_build_array(tests.ph_line('A'), tests.ph_line('B')),
          'observed_fault', 'Washer feed stopped (shared)', 'stopped_at', tests.at(0, '10:00'))) ->> 'id') as st_sh \gset
select public.ph_stop_step(:'st_sh', 'restart', jsonb_build_object('restarted_at', tests.at(0, '10:20')));
select (public.ph_report_stop(jsonb_build_object('line_ids', jsonb_build_array(tests.ph_line('A')), 'observed_fault', 'Labeller jam',
          'stopped_at', tests.at(0, '10:10'))) ->> 'id') as st_ov \gset
select public.ph_stop_step(:'st_ov', 'restart', jsonb_build_object('restarted_at', tests.at(0, '10:30')));
select is((select minutes from public.ph_kpi_downtime(tests.at(0, '10:00'), tests.at(0, '11:00')) where line_code = 'A'), 30.0,
  'downtime: overlapping stops on one line count once (10:00–10:30 = 30, not 40)');
select is((select stops from public.ph_kpi_downtime(tests.at(0, '10:00'), tests.at(0, '11:00')) where line_code = 'A'), 2,
  'downtime: both stops are counted as stops');
select is((select minutes from public.ph_kpi_downtime(tests.at(0, '10:00'), tests.at(0, '11:00')) where line_code = 'B'), 20.0,
  'downtime: the shared stop also counts on line B');
select is(public.ph_kpi_downtime_site(tests.at(0, '10:00'), tests.at(0, '11:00')), 30.0,
  'downtime: site-wide elapsed is the union (30), not the sum over lines (50)');
select (public.ph_report_stop(jsonb_build_object('line_ids', jsonb_build_array(tests.ph_line('C')), 'observed_fault', 'Restart test',
          'stopped_at', tests.at(0, '15:00'))) ->> 'id') as st_rb \gset
select throws_ok(format($$ select public.ph_stop_step(%L, 'restart', jsonb_build_object('restarted_at', %L)) $$, :'st_rb', tests.at(0, '14:00')),
  'P0422', null, 'downtime: a restart before the stop is refused');
select public.ph_stop_step(:'st_rb', 'restart', jsonb_build_object('restarted_at', tests.at(0, '15:05')));
select (public.ph_report_stop(jsonb_build_object('line_ids', jsonb_build_array(tests.ph_line('C')), 'observed_fault', 'No power',
          'stopped_at', now() - interval '20 minutes')) ->> 'id') as st_open \gset
select is((select open_stops from public.ph_kpi_downtime(now() - interval '1 hour', now() + interval '1 hour') where line_code = 'C'), 1,
  'downtime: an open stop is marked open');
select ok((select minutes from public.ph_kpi_downtime(now() - interval '1 hour', now() + interval '1 hour') where line_code = 'C') between 19.9 and 20.5,
  'downtime: an open stop counts minutes to the cutoff');
select public.ph_stop_step(:'st_mid', 'cause', jsonb_build_object('cause_id', :'cause'));
select is((select cause_code from public.ph_downtime_log where id = :'st_mid'), 'BELT', 'downtime: confirmed cause recorded when known');
select throws_ok(format($$ select public.ph_stop_step(%L, 'release') $$, :'st_mid'), 'P0403', null, 'downtime: technical release is for maintenance only');
select tests.as_user(:'mnt');
select is((public.ph_stop_step(:'st_mid', 'release') ->> 'released')::boolean, true, 'downtime: maintenance gives the technical release');
select tests.as_user(:'ll_b');
select throws_ok(format($$ select public.ph_report_stop(jsonb_build_object('line_ids', jsonb_build_array(%L), 'observed_fault', 'x')) $$, tests.ph_line('A')),
  'P0403', null, 'downtime: a line-B supervisor cannot report a stop on line A');

-- ---------------------------------------------------------------------------------------------
-- KPI 3: order duration variance (180 − 150 = +30), plan revisions keep the baseline, lateness separate
select tests.as_user(:'phm');
select public.ph_approve_master('ph_crops', tests.ph_crop('cherry_tomato'), 'Checked');
select tests.as_user(:'sal');
select (public.ph_create_order_line(jsonb_build_object('customer_name', 'Customer T (test)', 'crop_id', tests.ph_crop('cherry_tomato'),
          'pack_spec', '7 kg carton', 'grade', 'gr1', 'quantity', 700, 'quantity_unit', 'kg', 'required_date', app.ph_local_date() + 2,
          'market_type', 'local')) ->> 'id') as ol \gset
select tests.as_user(:'phm');
select public.ph_decide_order_line(:'ol', 'accept');
select tests.as_user(:'ll_a');
select throws_ok(format($$ select public.ph_record_order_plan(%L, '{"planned_duration_min":150}') $$, :'ol'), 'P0403', null,
  'order plan: the supervisor does not set the plan');
select tests.as_user(:'pe');
select is((public.ph_record_order_plan(:'ol', jsonb_build_object('planned_duration_min', 150, 'promised_loading_at', tests.at(0, '10:50'),
          'line_id', tests.ph_line('A'))) ->> 'version_no')::int, 1, 'order plan: baseline recorded before start');
select public.ph_order_step(:'ol', 'start', tests.at(0, '08:00')::text);
select throws_ok(format($$ select public.ph_record_order_plan(%L, '{"planned_duration_min":160}') $$, :'ol'), 'P0422', null,
  'order plan: a revision without a reason is refused');
select is((public.ph_record_order_plan(:'ol', '{"planned_duration_min":160,"reason":"Customer added 50 kg"}') ->> 'version_no')::int, 2,
  'order plan: a revision with a reason is version 2');
select throws_ok(format($$ select public.ph_order_step(%L, 'complete', %L) $$, :'ol', tests.at(0, '11:00')), 'P0422', null,
  'order: an overrun needs a reason');
select is((public.ph_order_step(:'ol', 'complete', tests.at(0, '11:00')::text, 'Belt stop 10:00–10:30') ->> 'variance_min')::numeric, 30.0,
  'KPI 3: 180 min actual − 150 min planned = +30 min');
select is((select variance_min from public.ph_kpi_order_variance(tests.at(0, '00:00'), tests.at(1, '00:00')) where order_line_id = :'ol'), 30.0,
  'KPI 3: the variance uses the original plan, not the revision');
select is((select revisions from public.ph_kpi_order_variance(tests.at(0, '00:00'), tests.at(1, '00:00')) where order_line_id = :'ol'), 1,
  'KPI 3: the revision is counted and kept');
select is((select lateness_min from public.ph_kpi_order_variance(tests.at(0, '00:00'), tests.at(1, '00:00')) where order_line_id = :'ol'), 10.0,
  'KPI 3: lateness against the promised loading time is shown separately');
select is((select overrun_reason from public.ph_kpi_order_variance(tests.at(0, '00:00'), tests.at(1, '00:00')) where order_line_id = :'ol'),
  'Belt stop 10:00–10:30', 'KPI 3: the reason for the overrun is kept');

-- ---------------------------------------------------------------------------------------------
-- First-pack check and shift close
select tests.as_user(:'ll_b');
select is((public.ph_first_pack_check(jsonb_build_object('line_shift_id', :'ls_b', 'pack_format_id', :'pf5', 'measured_kg', 4.9)) ->> 'under_target')::boolean,
  true, 'first pack: an under-weight first pack is flagged');
select ok(exists (select 1 from public.ph_shift_issues where line_shift_id = :'ls_b' and kind = 'weight_discrepancy'),
  'first pack: the weight discrepancy is reported to the engineer');
select tests.as_user(:'pe');
select throws_ok(format($$ select public.ph_close_shift(%L, '') $$, :'shift'), 'P0422', null, 'shift: closing needs a handover note');
select is((public.ph_close_shift(:'shift', 'Order done; line B sheet pending') -> 'lines_without_submission'), '["B"]'::jsonb,
  'shift: closing lists the lines whose sheet is not submitted');
select ok((select closed_at is not null from public.ph_shifts where id = :'shift'), 'shift: closed with the handover');
select tests.as_user(:'ll_b');
select throws_ok(format($$ select public.ph_labour_start(%L, array[%L::uuid], tests.task('packing')) $$, :'ls_b', :'w5'),
  'P0422', null, 'shift: no labour entry on a closed shift');

select * from finish();
rollback;
