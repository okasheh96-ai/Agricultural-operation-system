-- Packhouse operations, increment 2: read models for the management overview, the supervisor's phone form and order risk.
-- Read-only; every function checks the caller's permission and returns only recorded data. Unknown is returned as null,
-- never as zero (a line with no submission differs from a submitted zero).

set check_function_bodies = off;

-- Day window in the farm's time zone.
create function app.po_day_window(p_date date) returns tstzrange
language sql stable as $$
  select tstzrange((p_date::timestamp) at time zone 'Asia/Amman', ((p_date + 1)::timestamp) at time zone 'Asia/Amman')
$$;

-- Ordered quantity of an order line in kg, or null when it cannot be known (boxes without a pack weight).
create function app.po_order_kg(o public.ph_order_lines) returns numeric
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select case (select code from public.units where id = o.quantity_unit_id)
           when 'kg' then o.quantity
           when 'pc' then o.quantity * (select nominal_net_kg from public.ph_pack_formats where id = o.pack_format_id)
         end
$$;

-- Conforming kg packed for an order line (all time).
create function app.po_order_packed_kg(p_order uuid) returns numeric
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce(sum(kg), 0) from public.ph_output_entries where order_line_id = p_order and voided_at is null and conforming
$$;

-- Orders at risk on a day, with the reasons found in the records (no capacity or rate is assumed: OD-50).
create function public.ph_orders_at_risk(p_date date default null)
returns table (order_line_id uuid, code text, customer text, crop_code text, grade text, required_date date,
               ordered_kg numeric, packed_kg numeric, remaining_kg numeric, promised_loading_at timestamptz,
               started_at timestamptz, projected_end timestamptz, reasons text[])
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  v_date date := coalesce(p_date, app.ph_local_date());
begin
  if v_farm is null or not (app.ph_can(v_farm, 'report.kpi_view') or app.ph_can(v_farm, 'shift.view')) then
    raise exception 'Not permitted' using errcode = 'P0403';
  end if;
  return query
  with ol as (
    select o.*, p1.planned_duration_min as base_min, lp.planned_duration_min as latest_min, lp.planned_start_at, lp.promised_loading_at as promised,
           lp.line_id as plan_line, x.started_at as x_start, x.completed_at as x_done, app.po_order_kg(o) as okg
      from public.ph_order_lines o
      left join public.ph_order_plans p1 on p1.order_line_id = o.id and p1.version_no = 1 and p1.voided_at is null
      left join lateral (select * from public.ph_order_plans pp where pp.order_line_id = o.id and pp.voided_at is null order by version_no desc limit 1) lp on true
      left join public.ph_order_execution x on x.order_line_id = o.id and x.voided_at is null
     where o.farm_id = v_farm and o.voided_at is null and o.status = 'accepted'
       and (x.completed_at is null)
       and (o.required_date <= v_date + 1 or (lp.promised_loading_at is not null and lp.promised_loading_at < (app.po_day_window(v_date + 1)).upper))
  ),
  calc as (
    select ol.*, app.po_order_packed_kg(ol.id) as pkg,
           case when ol.x_start is not null and ol.latest_min is not null then
             ol.x_start + make_interval(mins => ol.latest_min)
             + coalesce((select make_interval(secs => sum(extract(epoch from (coalesce(e.restarted_at, now()) - greatest(e.stopped_at, ol.x_start)))))
                           from public.ph_downtime_events e join public.ph_downtime_lines dl on dl.event_id = e.id and dl.voided_at is null
                          where e.voided_at is null and dl.line_id = ol.plan_line and coalesce(e.restarted_at, now()) > ol.x_start), interval '0')
           end as proj
      from ol
  )
  select c.id, c.code, coalesce(cu.code, c.customer_name), cr.code, c.grade, c.required_date,
         c.okg, c.pkg, case when c.okg is not null then greatest(c.okg - c.pkg, 0) end, c.promised, c.x_start, c.proj,
         array_remove(array[
           case when c.base_min is null then 'no_plan' end,
           case when c.x_start is null and c.planned_start_at is not null and c.planned_start_at < now() then 'not_started_late' end,
           case when c.promised is not null and c.promised < now() then 'overdue' end,
           case when c.proj is not null and c.promised is not null and c.proj > c.promised then 'projected_late' end,
           case when c.okg is null then 'quantity_unknown' end,
           case when exists (select 1 from public.ph_packaging_readiness r where r.order_line_id = c.id and r.short > 0) then 'packaging_short' end,
           case when c.plan_line is not null and exists (select 1 from public.ph_downtime_events e join public.ph_downtime_lines dl on dl.event_id = e.id
                     where dl.line_id = c.plan_line and e.restarted_at is null and e.voided_at is null and dl.voided_at is null) then 'line_stopped' end,
           case when c.shortage_at is not null then 'shortage_flagged' end
         ], null)
    from calc c
    left join public.ph_customers cu on cu.id = c.customer_id
    join public.ph_crops cr on cr.id = c.crop_id
   order by coalesce(c.promised, c.required_date::timestamptz), c.code;
end;
$$;

-- Production trend: conforming kg per hour of the window, by line.
create function public.ph_production_trend(p_from timestamptz, p_to timestamptz)
returns table (bucket timestamptz, line_code text, kg numeric, boxes integer)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select date_trunc('hour', o.period_end), l.code, round(sum(o.kg) filter (where o.conforming), 3), sum(o.boxes)::int
    from public.ph_output_entries o join public.ph_line_shifts ls on ls.id = o.line_shift_id join public.ph_lines l on l.id = ls.line_id
   where o.voided_at is null and o.farm_id = app.ph_farm_of_user() and app.ph_can(o.farm_id, 'report.kpi_view')
     and o.period_end >= p_from and o.period_end < p_to
   group by 1, 2 order by 1, 2
$$;

-- The management overview for a day or one shift. Filters: line, crop, grade, customer (null = all).
create function public.ph_ops_overview(p_date date default null, p_shift uuid default null, p_filters jsonb default '{}')
returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm   uuid := app.ph_farm_of_user();
  v_date   date := coalesce(p_date, app.ph_local_date());
  s        public.ph_shifts;
  v_from   timestamptz;
  v_to     timestamptz;
  v_cut    timestamptz;
  v_line   uuid := nullif(p_filters ->> 'line_id', '')::uuid;
  v_crop   text := nullif(p_filters ->> 'crop_code', '');
  v_grade  text := nullif(p_filters ->> 'grade', '');
  v_cust   uuid := nullif(p_filters ->> 'customer_id', '')::uuid;
  v_out    jsonb;
begin
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  perform app.ph_authorize(v_farm, 'report.kpi_view');
  if p_shift is not null then
    select * into s from public.ph_shifts where id = p_shift and farm_id = v_farm and voided_at is null;
    if not found then raise exception 'Shift not found' using errcode = 'P0404'; end if;
    v_from := s.planned_start; v_to := s.planned_end; v_date := s.shift_date;
  else
    v_from := lower(app.po_day_window(v_date)); v_to := upper(app.po_day_window(v_date));
  end if;
  v_cut := least(v_to, now());

  with outp as (
    select o.*, ls.line_id, coalesce(cj.code, co.code, o_pf.crop_code) as crop_code, ol.customer_id
      from public.ph_output_entries o
      join public.ph_line_shifts ls on ls.id = o.line_shift_id
      join public.ph_pack_formats o_pf on o_pf.id = o.pack_format_id
      left join public.ph_job_cards jc on jc.id = o.job_card_id
      left join public.ph_crops cj on cj.id = jc.crop_id
      left join public.ph_order_lines ol on ol.id = o.order_line_id
      left join public.ph_crops co on co.id = ol.crop_id
     where o.farm_id = v_farm and o.voided_at is null and o.period_end >= v_from and o.period_end < v_to
       and (v_line is null or ls.line_id = v_line) and (v_grade is null or o.grade = v_grade)
       and (v_cust is null or ol.customer_id = v_cust)
  ),
  outf as (select * from outp where v_crop is null or crop_code = v_crop),
  planned as (
    select o.id, app.po_order_kg(o) as okg
      from public.ph_order_lines o
      left join lateral (select * from public.ph_order_plans pp where pp.order_line_id = o.id and pp.voided_at is null order by version_no desc limit 1) lp on true
      left join public.ph_crops c on c.id = o.crop_id
     where o.farm_id = v_farm and o.voided_at is null and o.status = 'accepted'
       and ((lp.planned_start_at is not null and lp.planned_start_at >= v_from and lp.planned_start_at < v_to)
            or (lp.planned_start_at is null and o.required_date = v_date))
       and (v_line is null or lp.line_id = v_line) and (v_grade is null or o.grade = v_grade)
       and (v_cust is null or o.customer_id = v_cust) and (v_crop is null or c.code = v_crop)
  ),
  lines as (
    select l.id, l.code, l.name_ar, l.name_en, l.sort_order,
           ls.id as ls_id, ls.submitted_at, up.full_name as supervisor_name, ls.readiness_at,
           (select max(x.created_at) from (select created_at from public.ph_output_entries where line_shift_id = ls.id and voided_at is null
                                           union all select created_at from public.ph_labour_intervals where line_shift_id = ls.id and voided_at is null) x) as last_activity,
           (select round(sum(kg) filter (where conforming), 3) from outf where outf.line_id = l.id) as kg,
           (select sum(boxes)::int from outf where outf.line_id = l.id) as boxes,
           (select count(*)::int from public.ph_output_entries where line_shift_id = ls.id and voided_at is null) as entries
      from public.ph_lines l
      left join lateral (select * from public.ph_line_shifts x
                          where x.line_id = l.id and x.voided_at is null
                            and x.shift_id in (select id from public.ph_shifts sh where sh.farm_id = v_farm and sh.voided_at is null
                                                and sh.planned_start < v_to and sh.planned_end > v_from
                                                and (p_shift is null or sh.id = p_shift))
                          order by x.created_at desc limit 1) ls on true
      left join public.user_profiles up on up.id = ls.supervisor_user_id
     where l.farm_id = v_farm and l.voided_at is null and (v_line is null or l.id = v_line)
  ),
  dt as (select * from public.ph_kpi_downtime(v_from, v_to))
  select jsonb_build_object(
    'date', v_date, 'from', v_from, 'to', v_to, 'cutoff', v_cut, 'generated_at', now(),
    'shift', case when s.id is not null then jsonb_build_object('id', s.id, 'code', s.code, 'planned_start', s.planned_start,
             'planned_end', s.planned_end, 'closed_at', s.closed_at,
             'engineer_name', (select full_name from public.user_profiles where id = s.engineer_user_id)) end,
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('id', sh.id, 'code', sh.code, 'planned_start', sh.planned_start,
                         'planned_end', sh.planned_end, 'closed_at', sh.closed_at) order by sh.planned_start)
                          from public.ph_shifts sh where sh.farm_id = v_farm and sh.voided_at is null and sh.shift_date = v_date), '[]'),
    'totals', jsonb_build_object(
       'packed_kg', (select round(coalesce(sum(kg) filter (where conforming), 0), 3) from outf),
       'boxes', (select coalesce(sum(boxes), 0)::int from outf),
       'nonconforming_boxes', (select coalesce(sum(boxes) filter (where not conforming), 0)::int from outf),
       'planned_kg', (select case when count(*) = 0 then null else round(sum(okg), 3) end from planned),
       'planned_orders', (select count(*)::int from planned),
       'planned_unknown', (select count(*)::int from planned where okg is null),
       'remaining_kg', (select case when count(*) = 0 then null
                                    else round(sum(greatest(okg - app.po_order_packed_kg(id), 0)), 3) end from planned where okg is not null)),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'line_id', id, 'code', code, 'name_ar', name_ar, 'name_en', name_en, 'line_shift_id', ls_id,
        'supervisor_name', supervisor_name, 'submitted_at', submitted_at, 'last_activity_at', last_activity,
        'readiness_at', readiness_at,
        'status', case when ls_id is null then 'not_open'
                       when submitted_at is not null and entries = 0 then 'submitted_zero'
                       when submitted_at is not null then 'submitted'
                       when v_to < now() then 'overdue'
                       else 'open' end,
        'packed_kg', kg, 'boxes', boxes,
        'stops', (select stops from dt where dt.line_id = lines.id),
        'downtime_min', (select minutes from dt where dt.line_id = lines.id),
        'open_stops', (select open_stops from dt where dt.line_id = lines.id)) order by sort_order, code) from lines), '[]'),
    'by_crop_grade', coalesce((select jsonb_agg(x order by x ->> 'crop_code', x ->> 'grade') from (
        select jsonb_build_object('crop_code', coalesce(o.crop_code, '?'), 'grade', o.grade,
               'crop_name_ar', (select name_ar from public.ph_crops c where c.farm_id = v_farm and c.code = o.crop_code and c.superseded_at is null limit 1),
               'crop_name_en', (select name_en from public.ph_crops c where c.farm_id = v_farm and c.code = o.crop_code and c.superseded_at is null limit 1),
               'kg', round(sum(o.kg) filter (where o.conforming), 3), 'boxes', sum(o.boxes)::int) as x
          from outf o group by o.crop_code, o.grade) q), '[]'),
    'stock', jsonb_build_object(
       'fg_available_kg', (select round(coalesce(sum(net_kg), 0), 2) from public.ph_fg_pallets where farm_id = v_farm and voided_at is null and status = 'in_storage'),
       'fg_held_kg', (select round(coalesce(sum(net_kg), 0), 2) from public.ph_fg_pallets where farm_id = v_farm and voided_at is null and status in ('on_hold', 'reinspection_required', 'age_blocked')),
       'fg_allocated_kg', (select round(coalesce(sum(net_kg), 0), 2) from public.ph_fg_pallets where farm_id = v_farm and voided_at is null and status in ('allocated', 'picked', 'loaded')),
       'raw_available_kg', (select round(coalesce(sum(net_kg), 0), 2) from public.ph_incoming_pallets where farm_id = v_farm and voided_at is null and status in ('stored', 'released', 'accepted')),
       'raw_held_kg', (select round(coalesce(sum(net_kg), 0), 2) from public.ph_incoming_pallets where farm_id = v_farm and voided_at is null and status = 'on_hold')),
    'kpi', jsonb_build_object(
       'productivity', (select jsonb_build_object('kg', round(sum(conforming_kg), 3), 'hours', round(sum(packing_hours), 3),
                                'rate', case when sum(packing_hours) > 0 then round(sum(conforming_kg) / sum(packing_hours), 2) end)
                          from public.ph_kpi_line_productivity(v_from, v_to) where v_line is null or line_id = v_line),
       'downtime', jsonb_build_object('stops', (select coalesce(sum(stops), 0) from dt where v_line is null or line_id = v_line),
                                      'minutes', (select coalesce(sum(minutes), 0) from dt where v_line is null or line_id = v_line),
                                      'open', (select coalesce(sum(open_stops), 0) from dt where v_line is null or line_id = v_line),
                                      'site_minutes', public.ph_kpi_downtime_site(v_from, v_to)),
       'orders', (select jsonb_build_object('count', count(*), 'completed', count(*) filter (where state = 'completed'),
                          'running', count(*) filter (where state = 'running'),
                          'variance_min', round(sum(variance_min) filter (where state = 'completed'), 1),
                          'over_plan', count(*) filter (where state = 'completed' and variance_min > 0),
                          'no_baseline', count(*) filter (where baseline_min is null))
                    from public.ph_kpi_order_variance(v_from, v_to))),
    'queue', jsonb_build_object(
       'open_stops', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'stopped_at', d.stopped_at, 'fault', d.observed_fault,
                                 'lines', d.line_codes, 'minutes', d.minutes_to_now) order by d.stopped_at)
                                 from public.ph_downtime_log d where d.farm_id = v_farm and d.is_open
                                  and (v_line is null or v_line = any (d.line_ids))), '[]'),
       'holds', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'code', h.code, 'type', h.hold_type, 'status', h.status,
                                 'reason', h.reason, 'since', h.created_at) order by h.created_at)
                            from public.ph_holds h where h.farm_id = v_farm and h.voided_at is null and h.status not in ('closed', 'cancelled')), '[]'),
       'at_risk', coalesce((select jsonb_agg(to_jsonb(r)) from public.ph_orders_at_risk(v_date) r where cardinality(r.reasons) > 0), '[]'),
       'issues_open', (select count(*)::int from public.ph_shift_issues i where i.farm_id = v_farm and i.voided_at is null and i.resolved_at is null
                         and i.kind <> 'instruction'))
  ) into v_out;
  return v_out;
end;
$$;

-- The supervisor's line shifts: open shifts, lines the caller supervises or may record on, newest first.
create function public.ph_my_line_shifts()
returns table (line_shift_id uuid, shift_id uuid, shift_code text, planned_start timestamptz, planned_end timestamptz,
               line_id uuid, line_code text, line_name_ar text, line_name_en text, supervisor_name text, submitted_at timestamptz,
               is_mine boolean, current_order_id uuid, current_order_code text)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select ls.id, s.id, s.code, s.planned_start, s.planned_end, l.id, l.code, l.name_ar, l.name_en, up.full_name, ls.submitted_at,
         ls.supervisor_user_id = app.current_user_id(),
         cur.id, cur.code
    from public.ph_line_shifts ls
    join public.ph_shifts s on s.id = ls.shift_id and s.closed_at is null and s.voided_at is null
    join public.ph_lines l on l.id = ls.line_id
    left join public.user_profiles up on up.id = ls.supervisor_user_id
    left join lateral (
      select o.id, o.code from public.ph_order_lines o
        join public.ph_order_execution x on x.order_line_id = o.id and x.voided_at is null and x.completed_at is null
        left join lateral (select line_id from public.ph_order_plans pp where pp.order_line_id = o.id and pp.voided_at is null order by version_no desc limit 1) lp on true
       where o.farm_id = ls.farm_id and (lp.line_id = l.id or lp.line_id is null)
       order by (lp.line_id = l.id) desc nulls last, x.started_at desc limit 1) cur on true
   where ls.voided_at is null and app.ph_is_member(ls.farm_id)
     and (ls.supervisor_user_id = app.current_user_id() or app.ph_can(ls.farm_id, 'labour.record', l.id))
   order by (ls.supervisor_user_id = app.current_user_id()) desc, s.planned_start desc, l.sort_order
$$;

-- Everything the phone form shows for one line shift (roster, teams, recent output, totals, issues).
create function public.ph_line_shift_sheet(p_line_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  ls public.ph_line_shifts := app.ph_line_shift(p_line_shift);
  s  public.ph_shifts;
begin
  if not app.ph_can(ls.farm_id, 'labour.view_people', ls.line_id) then
    raise exception 'Not permitted on this line' using errcode = 'P0403', detail = jsonb_build_object('key', 'ph.denied.line')::text;
  end if;
  select * into s from public.ph_shifts where id = ls.shift_id;
  return jsonb_build_object(
    'line_shift', jsonb_build_object('id', ls.id, 'version', ls.version, 'submitted_at', ls.submitted_at, 'readiness_at', ls.readiness_at,
                                     'readiness', ls.readiness, 'line_id', ls.line_id,
                                     'line_code', (select code from public.ph_lines where id = ls.line_id),
                                     'can_record', app.ph_can(ls.farm_id, 'labour.record', ls.line_id),
                                     'can_submit', app.ph_can(ls.farm_id, 'labour.submit', ls.line_id),
                                     'can_correct', app.ph_can(ls.farm_id, 'labour.correct', ls.line_id)),
    'shift', jsonb_build_object('id', s.id, 'code', s.code, 'planned_start', s.planned_start, 'planned_end', s.planned_end, 'closed_at', s.closed_at,
                                'engineer_name', (select full_name from public.user_profiles where id = s.engineer_user_id)),
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', li.id, 'worker_id', w.id, 'worker_code', w.code, 'worker_name', w.full_name,
                         'task_code', k.code, 'task_ar', k.name_ar, 'task_en', k.name_en, 'started_at', li.started_at, 'team_session_id', li.team_session_id)
                         order by w.code)
                        from public.ph_labour_intervals li join public.workers w on w.id = li.worker_id join public.ph_task_kinds k on k.id = li.task_kind_id
                       where li.line_shift_id = ls.id and li.voided_at is null and li.ended_at is null), '[]'),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', tm.id, 'label', tm.label, 'task_code', k.code, 'started_at', tm.started_at,
                         'ended_at', tm.ended_at, 'order_line_id', tm.order_line_id,
                         'last_period_end', (select max(period_end) from public.ph_output_entries o where o.team_session_id = tm.id and o.voided_at is null),
                         'members', (select count(*) from public.ph_labour_intervals li where li.team_session_id = tm.id and li.voided_at is null and li.ended_at is null))
                         order by tm.started_at)
                        from public.ph_team_sessions tm join public.ph_task_kinds k on k.id = tm.task_kind_id
                       where tm.line_shift_id = ls.id and tm.voided_at is null), '[]'),
    'output', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
                        select jsonb_build_object('id', o.id, 'version', o.version, 'worker_code', w.code, 'worker_name', w.full_name,
                          'team_label', tm.label, 'team_session_id', o.team_session_id, 'grade', o.grade, 'pack_code', pf.code,
                          'net_kg_per_box', o.net_kg_per_box, 'boxes', o.boxes, 'kg', o.kg, 'conforming', o.conforming,
                          'period_start', o.period_start, 'period_end', o.period_end, 'created_at', o.created_at,
                          'order_code', ol.code, 'correction_reason', o.correction_reason) as x
                          from public.ph_output_entries o
                          left join public.workers w on w.id = o.worker_id
                          left join public.ph_team_sessions tm on tm.id = o.team_session_id
                          join public.ph_pack_formats pf on pf.id = o.pack_format_id
                          left join public.ph_order_lines ol on ol.id = o.order_line_id
                         where o.line_shift_id = ls.id and o.voided_at is null
                         order by o.created_at desc limit 40) q), '[]'),
    'totals', (select jsonb_build_object('boxes', coalesce(sum(boxes), 0), 'kg', round(coalesce(sum(kg) filter (where conforming), 0), 3),
                                         'entries', count(*))
                 from public.ph_output_entries where line_shift_id = ls.id and voided_at is null),
    'first_pack_checks', coalesce((select jsonb_agg(jsonb_build_object('pack_format_id', c.pack_format_id, 'order_line_id', c.order_line_id,
                                     'measured_kg', c.measured_kg, 'target_net_kg', c.target_net_kg, 'at', c.created_at))
                                    from public.ph_first_pack_checks c where c.line_shift_id = ls.id and c.voided_at is null), '[]'),
    'instructions', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'description', i.description, 'at', i.created_at,
                                'acknowledged_at', i.acknowledged_at) order by i.created_at desc)
                               from public.ph_shift_issues i where i.line_shift_id = ls.id and i.kind = 'instruction' and i.voided_at is null), '[]')
  );
end;
$$;

-- Worker-level labour rows for drill-down (permissioned per line).
create view public.ph_labour_log with (security_invoker = true) as
  select li.id, li.farm_id, li.line_shift_id, ls.line_id, l.code as line_code, s.code as shift_code, li.worker_id, w.code as worker_code,
         w.full_name as worker_name, k.code as task_code, k.name_ar as task_ar, k.name_en as task_en, k.counts_as_packing,
         li.team_session_id, li.started_at, li.ended_at, li.end_reason,
         round(extract(epoch from coalesce(li.ended_at, now()) - li.started_at) / 3600.0, 3) as hours_to_now
    from public.ph_labour_intervals li
    join public.ph_line_shifts ls on ls.id = li.line_shift_id
    join public.ph_shifts s on s.id = ls.shift_id
    join public.ph_lines l on l.id = ls.line_id
    join public.workers w on w.id = li.worker_id
    join public.ph_task_kinds k on k.id = li.task_kind_id
   where li.voided_at is null;

-- Exports: permission-checked and logged (who exported which report with which filters, when). The browser builds the file
-- from rows the server already returned to this user under the same row security.
create table public.ph_export_log (
  id         uuid primary key default gen_random_uuid(),
  report     text not null check (report ~ '^[a-z0-9_]{2,40}$'),
  filters    jsonb not null default '{}'
);
comment on table public.ph_export_log is 'One row per report export (CSV / print), for the export permission and its audit.';
select app.register_table('public.ph_export_log', 'ph_report', false, p_default_policies => false);
create policy ph_export_log_select on public.ph_export_log for select to authenticated using (app.ph_can(farm_id, 'audit.view'));

create function public.ph_log_export(p_report text, p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_farm uuid := app.ph_farm_of_user(); v_id uuid := gen_random_uuid();
begin
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  perform app.ph_authorize(v_farm, 'report.export');
  insert into public.ph_export_log (id, farm_id, report, filters) values (v_id, v_farm, p_report, coalesce(p_filters, '{}'));
  return jsonb_build_object('id', v_id);
end;
$$;

select app.apply_api_grants();
