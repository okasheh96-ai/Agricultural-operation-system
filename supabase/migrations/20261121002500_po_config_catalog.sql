-- Packhouse operations, increment 5 (screens): what the Settings editors may offer, read from the server so the screens never
-- offer a hook, condition field, dataset or column the engine would refuse. Read-only.

set check_function_bodies = off;

create function public.ph_config_catalog() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare v_farm uuid := app.ph_farm_of_user();
begin
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  return jsonb_build_object(
    'hooks', (select jsonb_agg(jsonb_build_object('hook', h.hook, 'subject_kind', h.subject_kind, 'label_en', h.label_en, 'label_ar', h.label_ar)) from app.po_hooks() h),
    'subject_fields', jsonb_build_object('load', to_jsonb(app.po_subject_fields('load')), 'fg_pallet', to_jsonb(app.po_subject_fields('fg_pallet')),
                                         'line_shift', to_jsonb(app.po_subject_fields('line_shift')), 'standalone', '[]'::jsonb),
    'field_types', '["text", "number", "select", "date", "datetime", "check", "photo", "rows"]'::jsonb,
    'condition_ops', '["eq", "neq", "in", "contains", "empty", "gt", "gte", "lt", "lte"]'::jsonb,
    'approver_roles', coalesce((select jsonb_agg(spec_code order by spec_code) from public.ph_roles
                                 where farm_id = v_farm and voided_at is null and (spec_code in ('QCI', 'QCM', 'QAO', 'QAM', 'PHM', 'OWN') or is_custom)), '[]'),
    'datasets', (select jsonb_agg(jsonb_build_object('dataset', d.dataset, 'time_column', d.time_column, 'columns', d.columns, 'numeric_columns', d.numeric_columns,
                                                     'label_en', d.label_en, 'label_ar', d.label_ar)) from app.po_kpi_datasets() d),
    'measures', '["count", "sum", "avg", "ratio", "rate_per_hour"]'::jsonb,
    'windows', '["today", "7d", "30d", "open_now"]'::jsonb,
    'units', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name_ar', name_ar, 'name_en', name_en) order by code)
                         from public.units where farm_id = v_farm and voided_at is null and verification_status = 'verified'), '[]'));
end;
$$;
comment on function public.ph_config_catalog() is
  'Hooks, condition fields per subject, field types, KPI datasets and columns, and verified units that Operations Settings may offer.';

-- Every recorded attempt of a step is kept (a failed reinspection that is later passed stays visible on the run), and a
-- required repeatable-rows field needs at least one row.
alter table public.ph_op_instances add column step_history jsonb not null default '[]';
comment on column public.ph_op_instances.step_history is 'Append-only list of every step record (step, values, by, at, passed, decision, note).';
create function app.po_keep_step_history() returns trigger
language plpgsql as $$
begin
  if new.step_values is distinct from old.step_values then
    new.step_history := old.step_history || coalesce((select jsonb_agg(jsonb_build_object('step', x.k) || x.v)
                                                         from jsonb_each(new.step_values) x(k, v) where old.step_values -> x.k is distinct from x.v), '[]');
  end if;
  if new.step_history is distinct from old.step_history and jsonb_array_length(new.step_history) < jsonb_array_length(old.step_history) then
    raise exception 'Step history is append-only' using errcode = 'P0422';
  end if;
  return new;
end $$;
create trigger ph_op_instances_step_history before update on public.ph_op_instances for each row execute function app.po_keep_step_history();

create or replace function public.ph_op_record_step(p_run uuid, p_step text, p_values jsonb, p_decision text default null, p_note text default null) returns jsonb
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
    if coalesce((f ->> 'required')::boolean, false)
       and (case when jsonb_typeof(vals -> (f ->> 'key')) = 'array' then jsonb_array_length(vals -> (f ->> 'key')) = 0
                 else coalesce(trim(vals ->> (f ->> 'key')), '') = '' end) then
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

create or replace view public.ph_op_runs with (security_invoker = true) as
  select i.id, i.farm_id, i.code, t.code as op_code, t.name_ar as op_name_ar, t.name_en as op_name_en, v.version_no, v.definition,
         i.subject_kind, i.subject_id, i.subject_code, i.current_step, i.step_values, i.created_at, i.completed_at, i.failed_at, i.cancelled_at, i.cancel_reason,
         case when i.cancelled_at is not null then 'cancelled' when i.completed_at is not null then 'completed'
              when i.failed_at is not null then 'failed' else 'open' end as run_state,
         t.retired_at is not null as op_retired,
         i.step_history
    from public.ph_op_instances i join public.ph_op_versions v on v.id = i.op_version_id join public.ph_op_types t on t.id = v.op_type_id
   where i.voided_at is null;

select app.apply_api_grants();
