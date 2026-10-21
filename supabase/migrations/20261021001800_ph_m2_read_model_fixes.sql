-- Packing house M2: read-model fixes after split / merge, and the Job Card board columns the UI needs.
-- A split or merge closes its parent pallets (status split_merged) and creates new pallets on the same Job Card, so a sum
-- over every finished pallet of a Job Card counted the same kilograms twice. MB-01 and the Job Card board now count only
-- pallets that still exist as such (not split_merged); the trace keeps showing the closed parents.

set check_function_bodies = off;

create or replace function app.ph_jc_balance(p_jc uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with i as (
    select coalesce(sum(issued_kg), 0) as issued, coalesce(sum(returned_kg), 0) as returned, coalesce(sum(consumed_kg), 0) as consumed,
           count(*) filter (where closed_at is null) as open_inputs
      from public.ph_jc_inputs where job_card_id = p_jc and voided_at is null),
  f as (select coalesce(sum(net_kg), 0) as fg from public.ph_fg_pallets
         where job_card_id = p_jc and voided_at is null and status <> 'split_merged'),
  w as (select coalesce(sum(net_kg) filter (where status not in ('draft', 'awaiting_qc', 'qc_approved', 'returned_to_line')), 0) as waste,
               count(*) filter (where status in ('draft', 'awaiting_qc', 'qc_approved')) as pending
          from public.ph_waste_records where source_type = 'job_card' and source_id = p_jc and voided_at is null)
  select jsonb_build_object(
    'issued_kg', i.issued, 'returned_kg', i.returned, 'consumed_kg', i.consumed, 'fg_kg', f.fg, 'waste_kg', w.waste,
    'waste_pending', w.pending, 'open_inputs', i.open_inputs,
    'variance_kg', i.consumed - f.fg - w.waste,
    'variance_pct', case when i.consumed > 0 then round((i.consumed - f.fg - w.waste) / i.consumed * 100, 2) end,
    'tolerance_pct', app.ph_param((select farm_id from public.ph_job_cards where id = p_jc), 'mass_balance_tolerance_pct'))
    from i, f, w
$$;

create or replace view public.ph_jc_board with (security_invoker = true) as
select j.id, j.farm_id, j.code, j.status, j.workflow_version_id, j.version, j.planned_date, j.grade_target, j.customer_spec_ref,
       j.attribution_method, j.notes, j.line_start_inspection_id, j.completed_at, j.created_at,
       greatest(j.created_at, (select max(t.server_received_at) from public.record_transitions t
                                where t.entity_type = 'ph_job_cards' and t.entity_id = j.id)) as stage_since,
       j.line_id, ln.code as line_code, ln.name_ar as line_name_ar, ln.name_en as line_name_en, ln.kind as line_kind,
       j.crop_id, c.code as crop_code, c.name_ar as crop_name_ar, c.name_en as crop_name_en, c.washer_route,
       cb.full_name as created_by_name, ab.full_name as approved_by_name, rb.full_name as ready_by_name,
       sb.full_name as started_by_name, kb.full_name as completed_by_name,
       (select count(*) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null) as inputs_count,
       (select count(*) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null and i.closed_at is null) as open_inputs,
       (select coalesce(sum(i.issued_kg), 0) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null) as issued_kg,
       (select coalesce(sum(i.consumed_kg), 0) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null) as consumed_kg,
       (select coalesce(sum(i.returned_kg), 0) from public.ph_jc_inputs i where i.job_card_id = j.id and i.voided_at is null) as returned_kg,
       (select count(*) from public.ph_jc_packaging k where k.job_card_id = j.id and k.voided_at is null) as packaging_count,
       ls.code as line_start_code, ls.result as line_start_result, lsb.full_name as line_start_by_name, ls.event_at as line_start_at,
       (select i.result from public.ph_inspections i where i.job_card_id = j.id and i.inspection_type = 'line_start' and i.voided_at is null
         order by i.event_at desc, i.code desc limit 1) as last_line_start_result,
       q.code as qc2_code, q.qc2_stage, q.result as qc2_result, q.event_at as qc2_at, qb.full_name as qc2_by_name, q.tolerance_basis as qc2_tolerance_basis,
       (select count(*) from public.ph_fg_pallets f where f.job_card_id = j.id and f.voided_at is null and f.status <> 'split_merged') as fg_count,
       (select coalesce(sum(f.net_kg), 0) from public.ph_fg_pallets f where f.job_card_id = j.id and f.voided_at is null and f.status <> 'split_merged') as fg_kg,
       j.decision_basis,
       j.order_line_id, ol.code as order_line_code, ol.customer_name, ol.market_type, ol.required_date,
       rc.tolerance_basis as reconciled_basis, rc.created_at as reconciled_at, rcb.full_name as reconciled_by_name
  from public.ph_job_cards j
  join public.ph_lines ln on ln.id = j.line_id
  join public.ph_crops c on c.id = j.crop_id
  left join public.user_profiles cb on cb.id = j.created_by
  left join public.user_profiles ab on ab.id = j.approved_by
  left join public.user_profiles rb on rb.id = j.ready_by
  left join public.user_profiles sb on sb.id = j.started_by
  left join public.user_profiles kb on kb.id = j.completed_by
  left join public.ph_inspections ls on ls.id = j.line_start_inspection_id
  left join public.user_profiles lsb on lsb.id = ls.created_by
  left join lateral (select * from public.ph_inspections i where i.job_card_id = j.id and i.inspection_type = 'qc2' and i.voided_at is null
                      order by i.event_at desc, i.code desc limit 1) q on true
  left join public.user_profiles qb on qb.id = q.created_by
  left join public.ph_order_lines ol on ol.id = j.order_line_id
  left join lateral (select * from public.ph_jc_reconciliations r where r.job_card_id = j.id and r.voided_at is null
                      order by r.created_at desc limit 1) rc on true
  left join public.user_profiles rcb on rcb.id = rc.created_by
 where j.voided_at is null;
comment on view public.ph_jc_board is
  'One row per Job Card: line, crop, order line, people at each step, inputs (kg), packaging, G5 and latest QC-2, finished output '
  '(pallets that still exist: a split or merge parent is not counted again), latest reconciliation.';

select app.apply_api_grants();
