-- Packing house milestone M2, increment 2: waste (ST-11, SM-WR, G7) and Job Card reconciliation (MB-01), plus protection
-- against duplicate submissions and the lot / arrival quantity balances (MB-02, MB-03 as far as recorded data reaches).
-- Rules applied only where a source documents them: QC label before weighing (V-16, SOP-WS), the 1 t sign-off threshold and
-- its signatories (V-17, SOP-WS), top-management approval for long-storage waste above 1 t (SOP-WS). What a source leaves open
-- stays blocked on a real farm: the basis of the 1 t threshold and the QA/QC signing level (OD-11), the mass-balance tolerance
-- (OD-28), weight-loss adjustments (OD-28), reopening a closed Job Card (OD-15).

set check_function_bodies = off;

-- ---------------------------------------------------------------------------------------------
-- Duplicate submissions: a client sends one request id per form; a repeat (double tap, retry after a lost answer) gets the
-- first answer back instead of a second record. Kept outside the API schema.
-- ---------------------------------------------------------------------------------------------
create table app.ph_request_log (
  id          uuid primary key,
  farm_id     uuid not null,
  user_id     uuid not null,
  fn          text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now()
);
comment on table app.ph_request_log is
  'One row per packing-house create request that carried a request id (NFR offline / retry safety): the answer is returned '
  'again for a repeat of the same request, so a double submission never creates a second arrival, pallet, Job Card, '
  'finished pallet, packaging issue, waste record or order line.';
alter table app.ph_request_log enable row level security;
revoke all on app.ph_request_log from public, anon, authenticated;

create function app.ph_request_seen(p_id uuid, p_fn text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r app.ph_request_log;
begin
  if p_id is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into r from app.ph_request_log where id = p_id;
  if not found then return null; end if;
  if r.user_id <> app.current_user_id() or r.fn <> p_fn then
    raise exception 'This request id was already used for another request' using errcode = 'P0409',
      detail = jsonb_build_object('key', 'ph.requestReused')::text;
  end if;
  return r.result || jsonb_build_object('repeated', true);
end;
$$;

create function app.ph_request_done(p_id uuid, p_fn text, p_farm uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
begin
  if p_id is not null then
    insert into app.ph_request_log (id, farm_id, user_id, fn, result) values (p_id, p_farm, app.current_user_id(), p_fn, p_result);
  end if;
  return p_result;
end;
$$;

-- Same functions, with a request id (no default, so a call without one still reaches the original function unchanged).
create function public.ph_create_arrival(p jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v jsonb := app.ph_request_seen(p_request_id, 'ph_create_arrival');
begin
  if v is not null then return v; end if;
  return app.ph_request_done(p_request_id, 'ph_create_arrival', app.ph_farm_of_user(), public.ph_create_arrival(p));
end;
$$;

create function public.ph_register_pallet(p_arrival uuid, p jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v jsonb := app.ph_request_seen(p_request_id, 'ph_register_pallet');
begin
  if v is not null then return v; end if;
  return app.ph_request_done(p_request_id, 'ph_register_pallet', app.ph_farm_of_user(), public.ph_register_pallet(p_arrival, p));
end;
$$;

create function public.ph_create_job_card(p jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v jsonb := app.ph_request_seen(p_request_id, 'ph_create_job_card');
begin
  if v is not null then return v; end if;
  return app.ph_request_done(p_request_id, 'ph_create_job_card', app.ph_farm_of_user(), public.ph_create_job_card(p));
end;
$$;

create function public.ph_issue_packaging(p_jc uuid, p_description text, p_quantity numeric, p_unit text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v jsonb := app.ph_request_seen(p_request_id, 'ph_issue_packaging');
begin
  if v is not null then return v; end if;
  return app.ph_request_done(p_request_id, 'ph_issue_packaging', app.ph_farm_of_user(),
                             public.ph_issue_packaging(p_jc, p_description, p_quantity, p_unit));
end;
$$;

create function public.ph_create_fg_pallet(p_jc uuid, p jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v jsonb := app.ph_request_seen(p_request_id, 'ph_create_fg_pallet');
begin
  if v is not null then return v; end if;
  return app.ph_request_done(p_request_id, 'ph_create_fg_pallet', app.ph_farm_of_user(), public.ph_create_fg_pallet(p_jc, p));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Waste record (SM-WR): what M1 created as drafts now runs through QC label, weighing, routing, sign-off, ERP and removal.
-- ---------------------------------------------------------------------------------------------
alter table public.ph_waste_records
  add column notes            text,
  add column qc_by            uuid references auth.users(id),
  add column qc_at            timestamptz,
  add column qc_reason        text,
  add column weighed_by       uuid references auth.users(id),
  add column weighed_at       timestamptz,
  add column scale_id         uuid references public.ph_equipment(id),
  add column weight_unit_id   uuid references public.units(id),
  add column calibration_flag boolean not null default false,
  add column route            text check (route in ('small', 'large', 'top_mgmt')),
  add column route_basis      text,
  add column top_mgmt_by      uuid references auth.users(id),
  add column top_mgmt_at      timestamptz,
  add column erp_by           uuid references auth.users(id),
  add column erp_at           timestamptz,
  add column disposed_by      uuid references auth.users(id),
  add column disposed_at      timestamptz,
  add constraint ph_waste_records_net_kg_check check (net_kg is null or net_kg > 0),
  add constraint ph_waste_records_unit_check check ((net_kg is null) = (weight_unit_id is null));
comment on column public.ph_waste_records.route is
  'Sign-off route from V-17 (SOP-WS): small = processed waste up to the threshold (PHM); large = above it, or any long-storage '
  'waste (PHM + Warehouse + Finance + QC + QA); top_mgmt = long-storage above it (top management first). Set by the system '
  'after weighing, once OD-11 fixes the basis of the threshold.';

create table public.ph_waste_signoffs (
  id          uuid primary key default gen_random_uuid(),
  waste_id    uuid not null references public.ph_waste_records(id),
  spec_code   text not null,
  comment     text,
  basis       text not null
);
comment on table public.ph_waste_signoffs is
  'Sign-offs of a waste record (V-17): one per signing role, never edited. One person signs once, whatever roles they hold.';
select app.register_table('public.ph_waste_signoffs', 'ph_waste', false, p_default_policies => false);
create unique index ph_waste_signoffs_role_uq on public.ph_waste_signoffs (waste_id, spec_code) where voided_at is null;
create unique index ph_waste_signoffs_person_uq on public.ph_waste_signoffs (waste_id, created_by) where voided_at is null;
create trigger ph_waste_signoffs_append_only before update on public.ph_waste_signoffs for each row execute function app.ph_append_only();
create index ph_waste_records_source_idx on public.ph_waste_records (source_type, source_id);

alter table public.ph_attachments drop constraint ph_attachments_entity_type_check;
alter table public.ph_attachments add constraint ph_attachments_entity_type_check
  check (entity_type in ('ph_arrivals', 'ph_incoming_pallets', 'ph_inspections', 'ph_holds', 'ph_waste_records'));

-- ---------------------------------------------------------------------------------------------
-- Job Card reconciliation (MB-01): one row per reconciliation, never edited.
-- ---------------------------------------------------------------------------------------------
create table public.ph_jc_reconciliations (
  id              uuid primary key default gen_random_uuid(),
  job_card_id     uuid not null references public.ph_job_cards(id),
  issued_kg       numeric(12,2) not null,
  returned_kg     numeric(12,2) not null,
  consumed_kg     numeric(12,2) not null,
  fg_kg           numeric(12,2) not null,
  waste_kg        numeric(12,2) not null,
  variance_kg     numeric(12,2) not null,
  variance_pct    numeric(7,2),
  tolerance_pct   numeric(7,2),
  tolerance_basis text not null check (tolerance_basis in ('balanced', 'within_tolerance', 'outside_tolerance', 'no_tolerance_set')),
  explanation     text,
  weight_unit_id  uuid not null references public.units(id),
  check (tolerance_basis in ('balanced', 'within_tolerance') or length(trim(coalesce(explanation, ''))) > 0)
);
comment on table public.ph_jc_reconciliations is
  'MB-01 per Job Card: consumed kg (issued − returned) against finished pallets and weighed waste; the unexplained variance is '
  'shown, never forced to zero. Without a tolerance (OD-28) any variance needs a written explanation and is listed for review.';
select app.register_table('public.ph_jc_reconciliations', 'ph_job_card', false, p_default_policies => false);
create index ph_jc_reconciliations_jc_idx on public.ph_jc_reconciliations (job_card_id);
create trigger ph_jc_reconciliations_append_only before update on public.ph_jc_reconciliations for each row execute function app.ph_append_only();

do $$
declare t text;
begin
  foreach t in array array['ph_waste_signoffs', 'ph_jc_reconciliations'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.ph_is_member(farm_id))', t || '_select', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Guards: the waste workflow and Job Card reconciliation are built; reopening a closed Job Card waits on OD-15.
-- ---------------------------------------------------------------------------------------------
create or replace function app.guard_ph_waste_m2(r jsonb) returns boolean language sql stable as $$ select app.ph_in_rpc() $$;
create or replace function app.guard_ph_jc_reconcile_later(r jsonb) returns boolean language sql stable as $$
  select app.ph_in_rpc() and case r ->> 'status'
    when 'completed' then exists (select 1 from public.ph_jc_reconciliations x where x.job_card_id = (r ->> 'id')::uuid and x.voided_at is null)
    when 'reconciled' then true
    else false end $$;

-- Copy a packing-house workflow's active version (all rule columns, including the matrix action and decision gate) into a new,
-- unpublished version. Records keep the version they started on (history is never rewritten).
create function app.ph_clone_workflow_version(p_farm uuid, p_code text, p_note text) returns uuid
language plpgsql
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  select id into v_old from public.workflow_versions where farm_id = p_farm and workflow_code = p_code and is_active and voided_at is null;
  if v_old is null then raise exception 'No active % workflow for farm %', p_code, p_farm; end if;
  insert into public.workflow_versions (farm_id, workflow_code, version_no, is_active, note)
  select p_farm, p_code, max(version_no) + 1, false, p_note from public.workflow_versions where farm_id = p_farm and workflow_code = p_code
  returning id into v_new;
  insert into public.workflow_statuses (farm_id, workflow_version_id, code, name_ar, name_en, is_initial, is_terminal, sort_order)
  select farm_id, v_new, code, name_ar, name_en, is_initial, is_terminal, sort_order
    from public.workflow_statuses where workflow_version_id = v_old and voided_at is null;
  insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action, required_fields,
    must_differ_from, set_actor_column, payload_columns, clear_columns, counter_column, guard, scope_column, ph_action, decision_gate)
  select farm_id, v_new, from_status, to_status, required_action, required_fields, must_differ_from, set_actor_column, payload_columns,
         clear_columns, counter_column, guard, scope_column, ph_action, decision_gate
    from public.allowed_transitions where workflow_version_id = v_old and voided_at is null;
  return v_new;
end;
$$;

create function app.seed_ph_waste_reconciliation(p_farm uuid) returns void
language plpgsql
as $$
declare v uuid;
begin
  -- Waste workflow v2: on the large route the record is Signed off by whichever required signer signs last (V-17), so the
  -- transition carries the large sign-off action too. Version 1 records keep version 1 (the PHM then signs last).
  if exists (select 1 from public.workflow_versions where farm_id = p_farm and workflow_code = 'ph_waste' and voided_at is null)
     and not exists (select 1 from public.allowed_transitions t join public.workflow_versions wv on wv.id = t.workflow_version_id
                      where wv.farm_id = p_farm and wv.workflow_code = 'ph_waste' and wv.is_active and t.ph_action = 'waste.signoff_large') then
    v := app.ph_clone_workflow_version(p_farm, 'ph_waste', 'M2.2: large-route sign-off completes with the last required signer (V-17)');
    insert into public.allowed_transitions (farm_id, workflow_version_id, from_status, to_status, required_action, guard, ph_action)
    values (p_farm, v, 'awaiting_sign_off', 'signed_off', 'approve', 'ph_waste_m2', 'waste.signoff_large');
    perform app.activate_workflow_version(v);
  end if;
  -- OD-28 has no value: the mass-balance tolerance stays pending (MB-01 then asks for an explanation of any variance).
  insert into public.ph_rule_parameters (farm_id, code, area, value_numeric, value_text, unit_code, evidence, basis_label, source, decision_code,
                                         label_en, label_ar, state)
  select p_farm, 'mass_balance_tolerance_pct', 'operational', null, null, '%', 'NYV', 'Pending decision', 'MB-01; SOP-WS', 'OD-28',
         'Job Card mass-balance tolerance (V-20, MB-01)', 'تحمّل موازنة الكتلة لبطاقة العمل (V-20، MB-01)', 'pending_decision'
   where not exists (select 1 from public.ph_rule_parameters where farm_id = p_farm and code = 'mass_balance_tolerance_pct');
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
end $$;

-- ---------------------------------------------------------------------------------------------
-- Waste helpers
-- ---------------------------------------------------------------------------------------------
create function app.ph_waste(p_ref text) returns public.ph_waste_records
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_waste_records;
begin
  select * into r from public.ph_waste_records w
   where (w.id::text = p_ref or upper(w.code) = upper(trim(p_ref))) and w.voided_at is null and app.ph_is_member(w.farm_id);
  if not found then
    raise exception 'Waste record % not found', p_ref using errcode = 'P0404', detail = jsonb_build_object('key', 'ph.waste.notFound', 'ref', p_ref)::text;
  end if;
  return r;
end;
$$;

-- Roles whose signature the large route needs (V-17): every role with a waste.signoff_large cell that is not disabled. A role
-- whose cell still waits on OD-11 cannot sign, so the record waits too.
create function app.ph_waste_large_signers(p_farm uuid) returns text[]
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce(array_agg(distinct spec_code order by spec_code), '{}') from public.ph_permission_cells
   where farm_id = p_farm and action_key = 'waste.signoff_large' and voided_at is null and state <> 'disabled'
$$;

-- V-17 routing after weighing. Returns null when routed, or the reason it cannot be routed yet.
create function app.ph_waste_route(p_waste uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  w       public.ph_waste_records;
  v_gate  text;
  v_limit numeric;
  v_route text;
begin
  select * into w from public.ph_waste_records where id = p_waste for update;
  if w.status <> 'weighed' then return jsonb_build_object('key', 'ph.waste.state', 'status', w.status); end if;
  if app.ph_decision_open(w.farm_id, 'OD-11') is not null then
    return jsonb_build_object('key', 'ph.blocked.open', 'decision', 'OD-11');
  end if;
  v_gate := app.ph_decision_gate(w.farm_id, 'OD-11');
  v_limit := app.ph_param(w.farm_id, 'waste_signoff_threshold_kg');
  if v_limit is null then
    return jsonb_build_object('key', 'ph.blocked.open', 'decision', 'OD-11');
  end if;
  v_route := case when w.category = 'long_storage' and w.net_kg > v_limit then 'top_mgmt'
                  when w.category = 'long_storage' or w.net_kg > v_limit then 'large'
                  else 'small' end;
  update public.ph_waste_records set route = v_route, route_basis = v_gate || '; threshold ' || v_limit || ' kg' where id = w.id;
  perform app.ph_transition('ph_waste_records', w.id, case when v_route = 'top_mgmt' then 'awaiting_top_mgmt' else 'awaiting_sign_off' end,
                            'Routed: ' || v_route || ' (' || w.net_kg || ' kg)');
  if v_route = 'top_mgmt' then
    perform app.ph_notify_role(w.farm_id, 'TOP', 'ph_waste_topmgmt_due', 'ph_waste_records', w.id, jsonb_build_object('code', w.code));
  elsif v_route = 'small' then
    perform app.ph_notify_role(w.farm_id, 'PHM', 'ph_waste_signoff_due', 'ph_waste_records', w.id, jsonb_build_object('code', w.code));
  else
    perform app.ph_notify_role(w.farm_id, s, 'ph_waste_signoff_due', 'ph_waste_records', w.id, jsonb_build_object('code', w.code))
       from unnest(app.ph_waste_large_signers(w.farm_id)) s;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- ST-11 Waste: create (and submit), QC label (G7), weigh (V-16), route (V-17), sign off, top management, ERP, removal
-- ---------------------------------------------------------------------------------------------
create function public.ph_create_waste_record(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm   uuid := app.ph_farm_of_user();
  v_seen   jsonb := app.ph_request_seen(p_request_id, 'ph_create_waste_record');
  v_basis  text;
  v_cat    text := coalesce(nullif(p ->> 'category', ''), 'processed');
  v_type   text := p ->> 'source_type';
  v_ref    text := nullif(trim(p ->> 'source'), '');
  v_src    uuid;
  v_crop   uuid;
  v_label  text;
  v_id     uuid := gen_random_uuid();
  v_code   text;
  v_photos integer;
begin
  if v_seen is not null then return v_seen; end if;
  if v_farm is null then raise exception 'Not a packing-house user' using errcode = 'P0403'; end if;
  v_basis := app.ph_authorize(v_farm, 'waste.create');
  if v_cat = 'weight_loss' then
    raise exception 'Weight-loss adjustments need the agreed weight-loss %% and its approver (OD-28)' using errcode = 'P0428',
      detail = jsonb_build_object('key', 'ph.blocked.open', 'decision', 'OD-28')::text;
  end if;
  if v_cat = 'packaging' then
    raise exception 'Packaging waste is counted by the warehouse (FR-WS-06), not built yet' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.waste.packagingLater')::text;
  end if;
  if v_cat not in ('processed', 'long_storage') then raise exception 'Unknown waste category' using errcode = 'P0422'; end if;
  if v_type is null or v_ref is null then
    raise exception 'Waste needs its source' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['source'])::text;
  end if;
  -- The source record the waste came from (ST-11): a Job Card on the line, a finished pallet, an incoming pallet, a store.
  if v_type = 'job_card' then
    select id, crop_id, code into v_src, v_crop, v_label from public.ph_job_cards
     where farm_id = v_farm and voided_at is null and (id::text = v_ref or upper(code) = upper(v_ref))
       and status in ('in_progress', 'paused', 'completed');
  elsif v_type = 'fg_pallet' then
    select id, crop_id, code into v_src, v_crop, v_label from public.ph_fg_pallets
     where farm_id = v_farm and voided_at is null and (id::text = v_ref or upper(code) = upper(v_ref));
  elsif v_type = 'incoming_pallet' then
    select id, crop_id, code into v_src, v_crop, v_label from public.ph_incoming_pallets
     where farm_id = v_farm and voided_at is null and (id::text = v_ref or upper(code) = upper(v_ref));
  elsif v_type = 'location' then
    select id, code into v_src, v_label from public.ph_locations
     where farm_id = v_farm and voided_at is null and (id::text = v_ref or upper(code) = upper(v_ref));
    v_crop := (select id from public.ph_crops where id = (p ->> 'crop_id')::uuid and farm_id = v_farm and voided_at is null);
    if v_crop is null then
      raise exception 'Waste from a store needs its crop' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['crop_id'])::text;
    end if;
  else
    raise exception 'Unknown waste source' using errcode = 'P0422';
  end if;
  if v_src is null then
    raise exception 'Source % not found (a Job Card must be running or completed)', v_ref using errcode = 'P0404',
      detail = jsonb_build_object('key', 'ph.waste.source', 'ref', v_ref)::text;
  end if;
  v_code := app.ph_code(v_farm, 'WR', 4);
  insert into public.ph_waste_records (id, farm_id, code, category, source_type, source_id, crop_id, reference_kg, bags, origin, notes)
  values (v_id, v_farm, v_code, v_cat, v_type, v_src, v_crop, nullif(p ->> 'reference_kg', '')::numeric, nullif(p ->> 'bags', '')::integer,
          'Recorded from ' || v_type || ' ' || v_label, nullif(trim(p ->> 'notes'), ''));
  v_photos := app.ph_link_attachments(array(select jsonb_array_elements_text(coalesce(p -> 'attachment_ids', '[]'))::uuid), 'ph_waste_records', v_id, v_farm);
  if v_cat = 'long_storage' and v_photos = 0 then
    raise exception 'Long-storage waste needs photos (SOP-WS)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.waste.photos')::text;
  end if;
  perform app.ph_transition('ph_waste_records', v_id, 'awaiting_qc', 'Submitted for the QC waste label');
  perform app.ph_notify_role(v_farm, 'QCI', 'ph_waste_qc_due', 'ph_waste_records', v_id, jsonb_build_object('code', v_code));
  return app.ph_request_done(p_request_id, 'ph_create_waste_record', v_farm,
                             jsonb_build_object('id', v_id, 'code', v_code, 'status', 'awaiting_qc', 'basis', v_basis));
end;
$$;

-- Drafts created by the system in M1 (rejected incoming product, hold dispositions) are submitted here.
create function public.ph_waste_submit(p_waste uuid, p_attachment_ids uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  w        public.ph_waste_records;
  v_photos integer;
begin
  w := app.ph_waste(p_waste::text);
  perform app.ph_authorize(w.farm_id, 'waste.create');
  if w.status <> 'draft' then
    raise exception 'Only a draft is submitted' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.waste.state', 'status', w.status)::text;
  end if;
  v_photos := app.ph_link_attachments(p_attachment_ids, 'ph_waste_records', w.id, w.farm_id);
  if w.category = 'long_storage' and v_photos = 0 then
    raise exception 'Long-storage waste needs photos (SOP-WS)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.waste.photos')::text;
  end if;
  perform app.ph_transition('ph_waste_records', w.id, 'awaiting_qc', 'Submitted for the QC waste label');
  perform app.ph_notify_role(w.farm_id, 'QCI', 'ph_waste_qc_due', 'ph_waste_records', w.id, jsonb_build_object('code', w.code));
  return jsonb_build_object('id', w.id, 'status', 'awaiting_qc');
end;
$$;

-- G7: QC approves the waste label before it is weighed, or refuses it (saleable product goes back to the line).
create function public.ph_waste_qc(p_waste uuid, p_decision text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  w     public.ph_waste_records;
  v_uid uuid := app.current_user_id();
begin
  w := app.ph_waste(p_waste::text);
  perform app.ph_authorize(w.farm_id, 'waste.qc_label');
  if w.status <> 'awaiting_qc' then
    raise exception 'The QC label is given to waste awaiting QC' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.waste.state', 'status', w.status)::text;
  end if;
  -- SoD-03: whoever records the waste does not label it.
  if w.created_by = v_uid then
    raise exception 'The person who recorded the waste cannot give its QC label (SoD-03)' using errcode = 'P0423',
      detail = jsonb_build_object('key', 'ph.sod', 'column', 'created_by')::text;
  end if;
  if p_decision not in ('approve', 'refuse') then raise exception 'Decision must be approve or refuse' using errcode = 'P0422'; end if;
  if p_decision = 'refuse' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A refusal needs a reason' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['reason'])::text;
  end if;
  update public.ph_waste_records set qc_by = v_uid, qc_at = now(), qc_reason = nullif(trim(p_reason), '') where id = w.id;
  if p_decision = 'refuse' then
    perform app.ph_transition('ph_waste_records', w.id, 'returned_to_line', p_reason);
    perform app.ph_notify_role(w.farm_id, 'DEC', 'ph_waste_returned', 'ph_waste_records', w.id, jsonb_build_object('code', w.code));
    return jsonb_build_object('id', w.id, 'status', 'returned_to_line');
  end if;
  perform app.ph_transition('ph_waste_records', w.id, 'qc_approved', nullif(trim(p_reason), ''));
  perform app.ph_notify_role(w.farm_id, 'DEC', 'ph_waste_weigh_due', 'ph_waste_records', w.id, jsonb_build_object('code', w.code));
  return jsonb_build_object('id', w.id, 'status', 'qc_approved');
end;
$$;

-- V-16: weight only after the QC label; then the system routes for sign-off (V-17) when OD-11 allows it.
create function public.ph_waste_weigh(p_waste uuid, p_net_kg numeric, p_scale uuid, p_bags integer default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  w      public.ph_waste_records;
  sc     public.ph_equipment;
  v_uid  uuid := app.current_user_id();
  v_why  jsonb;
  v_warn jsonb := '[]';
begin
  w := app.ph_waste(p_waste::text);
  perform app.ph_authorize(w.farm_id, 'waste.create');
  if w.status in ('draft', 'awaiting_qc') then
    raise exception 'Waste is weighed only after the QC label (V-16)' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v16')::text;
  end if;
  if w.status <> 'qc_approved' then
    raise exception 'Not possible in status %', w.status using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.waste.state', 'status', w.status)::text;
  end if;
  if coalesce(p_net_kg, 0) <= 0 then
    raise exception 'Net weight must be above zero' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v02')::text;
  end if;
  if p_bags is not null and p_bags <= 0 then
    raise exception 'Bags must be a whole number above zero' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.boxes')::text;
  end if;
  select * into sc from public.ph_equipment where id = p_scale and farm_id = w.farm_id and kind = 'scale' and voided_at is null;
  if not found then
    raise exception 'Scale required' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['scale_id'])::text;
  end if;
  if sc.verification_status <> 'verified' then
    raise exception 'Scale not approved' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.notApproved', 'record', sc.code)::text;
  end if;
  if sc.calibration_due_on is null or sc.calibration_due_on < app.ph_local_date() then
    v_warn := v_warn || jsonb_build_object('key', 'ph.calibration', 'scale', sc.code);
  end if;
  update public.ph_waste_records
     set net_kg = p_net_kg, bags = coalesce(p_bags, bags), scale_id = sc.id, weighed_by = v_uid, weighed_at = now(),
         weight_unit_id = (select id from public.units where farm_id = w.farm_id and code = 'kg' and voided_at is null),
         calibration_flag = sc.calibration_due_on is null or sc.calibration_due_on < app.ph_local_date()
   where id = w.id;
  perform app.ph_transition('ph_waste_records', w.id, 'weighed', p_net_kg || ' kg on ' || sc.code);
  v_why := app.ph_waste_route(w.id);
  if v_why is not null then v_warn := v_warn || v_why; end if;
  return jsonb_build_object('id', w.id, 'status', (select status from public.ph_waste_records where id = w.id), 'warnings', v_warn);
end;
$$;

-- A weighed record waiting on OD-11 is routed here once the decision is recorded.
create function public.ph_waste_route_now(p_waste uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  w     public.ph_waste_records;
  v_why jsonb;
begin
  w := app.ph_waste(p_waste::text);
  perform app.ph_authorize(w.farm_id, 'waste.create');
  v_why := app.ph_waste_route(w.id);
  if v_why is not null then
    raise exception 'Waste cannot be routed yet' using errcode = case when v_why ->> 'key' = 'ph.blocked.open' then 'P0428' else 'P0422' end,
      detail = v_why::text;
  end if;
  return jsonb_build_object('id', w.id, 'status', (select status from public.ph_waste_records where id = w.id));
end;
$$;

create function public.ph_waste_topmgmt(p_waste uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  w     public.ph_waste_records;
  v_uid uuid := app.current_user_id();
begin
  w := app.ph_waste(p_waste::text);
  perform app.ph_authorize(w.farm_id, 'waste.topmgmt');
  if w.status <> 'awaiting_top_mgmt' then
    raise exception 'Not awaiting top management' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.waste.state', 'status', w.status)::text;
  end if;
  update public.ph_waste_records set top_mgmt_by = v_uid, top_mgmt_at = now() where id = w.id;
  perform app.ph_transition('ph_waste_records', w.id, 'awaiting_sign_off', p_comment);
  perform app.ph_notify_role(w.farm_id, s, 'ph_waste_signoff_due', 'ph_waste_records', w.id, jsonb_build_object('code', w.code))
     from unnest(app.ph_waste_large_signers(w.farm_id)) s;
  return jsonb_build_object('id', w.id, 'status', 'awaiting_sign_off');
end;
$$;

-- V-17 sign-off. Small route: the PHM. Large route: every required role, one person per role, then Signed off.
create function public.ph_waste_signoff(p_waste uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  w       public.ph_waste_records;
  v_uid   uuid := app.current_user_id();
  v_act   text;
  v_basis text;
  v_role  text;
  v_need  text[];
  v_have  text[];
begin
  w := app.ph_waste(p_waste::text);
  if w.status <> 'awaiting_sign_off' then
    raise exception 'Not awaiting sign-off' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.waste.state', 'status', w.status)::text;
  end if;
  v_act := case when w.route = 'small' then 'waste.signoff_small' else 'waste.signoff_large' end;
  v_basis := app.ph_authorize(w.farm_id, v_act);
  -- SoD-03: whoever recorded, labelled or weighed the waste does not sign it off.
  if v_uid in (w.created_by, w.qc_by, w.weighed_by) then
    raise exception 'The person who recorded, labelled or weighed the waste cannot sign it off (SoD-03)' using errcode = 'P0423',
      detail = jsonb_build_object('key', 'ph.sod', 'column', case when v_uid = w.created_by then 'created_by' when v_uid = w.qc_by then 'qc_by' else 'weighed_by' end)::text;
  end if;
  if exists (select 1 from public.ph_waste_signoffs where waste_id = w.id and created_by = v_uid and voided_at is null) then
    raise exception 'You already signed this waste record' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.decision.alreadySigned')::text;
  end if;
  v_role := split_part(v_basis, ':', 2);
  if exists (select 1 from public.ph_waste_signoffs where waste_id = w.id and spec_code = v_role and voided_at is null) then
    raise exception 'Role % has already signed', v_role using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.waste.roleSigned', 'role', v_role)::text;
  end if;
  insert into public.ph_waste_signoffs (farm_id, waste_id, spec_code, comment, basis) values (w.farm_id, w.id, v_role, nullif(trim(p_comment), ''), v_basis);
  v_need := case when w.route = 'small' then array['PHM'] else app.ph_waste_large_signers(w.farm_id) end;
  select coalesce(array_agg(spec_code), '{}') into v_have from public.ph_waste_signoffs where waste_id = w.id and voided_at is null;
  -- A record started on waste workflow version 1 can only be signed off by the PHM's action: the PHM then signs last.
  if w.route <> 'small' and v_role = 'PHM' and not (v_need <@ v_have)
     and not exists (select 1 from public.allowed_transitions t where t.workflow_version_id = w.workflow_version_id
                       and t.to_status = 'signed_off' and t.ph_action = 'waste.signoff_large' and t.voided_at is null) then
    raise exception 'On this record the PHM signs after the other required roles' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.waste.phmLast')::text;
  end if;
  if v_need <@ v_have then
    perform app.ph_transition('ph_waste_records', w.id, 'signed_off', p_comment);
    perform app.ph_notify_role(w.farm_id, 'DEC', 'ph_waste_erp_due', 'ph_waste_records', w.id, jsonb_build_object('code', w.code));
  end if;
  return jsonb_build_object('id', w.id, 'role', v_role, 'status', (select status from public.ph_waste_records where id = w.id),
                            'missing', (select coalesce(jsonb_agg(x), '[]') from unnest(v_need) x where not x = any (v_have)));
end;
$$;

create function public.ph_waste_erp_ref(p_waste uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  w      public.ph_waste_records;
  v_warn jsonb := '[]';
begin
  w := app.ph_waste(p_waste::text);
  perform app.ph_authorize(w.farm_id, 'waste.erp_ref');
  if w.status <> 'signed_off' then
    raise exception 'The ERP reference is entered after sign-off' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.waste.state', 'status', w.status)::text;
  end if;
  if coalesce(trim(p_ref), '') = '' then
    raise exception 'ERP reference required' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.v01', 'missing', array['erp_ref'])::text;
  end if;
  -- FR-WS-04: a reference already used on another waste record is a warning, not a block (the ERP format is not known, OD-04).
  if exists (select 1 from public.ph_waste_records where farm_id = w.farm_id and id <> w.id and voided_at is null and upper(erp_ref) = upper(trim(p_ref))) then
    v_warn := v_warn || jsonb_build_object('key', 'ph.waste.erpDuplicate', 'ref', trim(p_ref));
  end if;
  update public.ph_waste_records set erp_ref = trim(p_ref), erp_by = app.current_user_id(), erp_at = now() where id = w.id;
  perform app.ph_transition('ph_waste_records', w.id, 'erp_posted', 'ERP ' || trim(p_ref));
  return jsonb_build_object('id', w.id, 'status', 'erp_posted', 'warnings', v_warn);
end;
$$;

create function public.ph_waste_dispose(p_waste uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare w public.ph_waste_records;
begin
  w := app.ph_waste(p_waste::text);
  perform app.ph_authorize(w.farm_id, 'waste.create');
  if w.status <> 'erp_posted' then
    raise exception 'Removal is recorded after the ERP posting' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.waste.state', 'status', w.status)::text;
  end if;
  update public.ph_waste_records set disposed_by = app.current_user_id(), disposed_at = now() where id = w.id;
  perform app.ph_transition('ph_waste_records', w.id, 'disposed', coalesce(nullif(trim(p_comment), ''), 'Removed to the farm waste area'));
  return jsonb_build_object('id', w.id, 'status', 'disposed');
end;
$$;

create function public.ph_waste_actions(p_waste uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  w      public.ph_waste_records;
  v_uid  uuid := app.current_user_id();
  v_out  jsonb := '[]';
  c      record;
  v_why  jsonb;
  v_need text[];
begin
  w := app.ph_waste(p_waste::text);
  v_need := case when w.route = 'small' then array['PHM'] else app.ph_waste_large_signers(w.farm_id) end;
  for c in
    select * from (values
      ('submit', 'waste.create', w.status = 'draft'),
      ('qc_label', 'waste.qc_label', w.status = 'awaiting_qc'),
      ('weigh', 'waste.create', w.status in ('awaiting_qc', 'qc_approved')),
      ('route', 'waste.create', w.status = 'weighed'),
      ('top_mgmt', 'waste.topmgmt', w.status = 'awaiting_top_mgmt'),
      ('sign_off', case when w.route = 'small' then 'waste.signoff_small' else 'waste.signoff_large' end, w.status = 'awaiting_sign_off'),
      ('erp_ref', 'waste.erp_ref', w.status = 'signed_off'),
      ('dispose', 'waste.create', w.status = 'erp_posted')
    ) as x(action, ph_action, applicable)
  loop
    continue when not c.applicable;
    v_why := app.ph_denial(v_uid, w.farm_id, c.ph_action);
    if v_why is null and c.action = 'weigh' and w.status = 'awaiting_qc' then
      v_why := jsonb_build_object('key', 'ph.v16');
    end if;
    if v_why is null and c.action = 'qc_label' and w.created_by = v_uid then
      v_why := jsonb_build_object('key', 'ph.sod', 'column', 'created_by');
    end if;
    if v_why is null and c.action = 'route' and app.ph_decision_open(w.farm_id, 'OD-11') is not null then
      v_why := jsonb_build_object('key', 'ph.blocked.open', 'decision', 'OD-11');
    end if;
    if v_why is null and c.action = 'sign_off' then
      if v_uid in (w.created_by, w.qc_by, w.weighed_by) then
        v_why := jsonb_build_object('key', 'ph.sod', 'column', case when v_uid = w.created_by then 'created_by' when v_uid = w.qc_by then 'qc_by' else 'weighed_by' end);
      elsif exists (select 1 from public.ph_waste_signoffs where waste_id = w.id and created_by = v_uid and voided_at is null) then
        v_why := jsonb_build_object('key', 'ph.decision.alreadySigned');
      elsif exists (select 1 from public.ph_waste_signoffs where waste_id = w.id and voided_at is null
                     and spec_code = split_part(app.ph_permission_basis(v_uid, w.farm_id, c.ph_action), ':', 2)) then
        v_why := jsonb_build_object('key', 'ph.waste.roleSigned', 'role', split_part(app.ph_permission_basis(v_uid, w.farm_id, c.ph_action), ':', 2));
      end if;
    end if;
    v_out := v_out || jsonb_build_object('action', c.action, 'ph_action', c.ph_action, 'allowed', v_why is null, 'reason', v_why,
                                         'basis', app.ph_permission_basis(v_uid, w.farm_id, c.ph_action));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- MB-01 Job Card reconciliation and close
-- ---------------------------------------------------------------------------------------------
-- Waste weighed against a Job Card counts; waste not yet weighed (draft, awaiting QC, QC-approved) keeps the balance open.
create function app.ph_jc_balance(p_jc uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with i as (
    select coalesce(sum(issued_kg), 0) as issued, coalesce(sum(returned_kg), 0) as returned, coalesce(sum(consumed_kg), 0) as consumed,
           count(*) filter (where closed_at is null) as open_inputs
      from public.ph_jc_inputs where job_card_id = p_jc and voided_at is null),
  f as (select coalesce(sum(net_kg), 0) as fg from public.ph_fg_pallets where job_card_id = p_jc and voided_at is null),
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

create function public.ph_reconcile_job_card(p_jc uuid, p_explanation text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  r      public.ph_job_cards;
  b      jsonb;
  v_var  numeric;
  v_pct  numeric;
  v_tol  numeric;
  v_kind text;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'job_card.close');
  if r.status <> 'completed' then
    raise exception 'Only a completed Job Card is reconciled' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  b := app.ph_jc_balance(r.id);
  if (b ->> 'waste_pending')::int > 0 then
    raise exception 'Waste of this Job Card is not weighed yet' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.mb.wastePending', 'count', b ->> 'waste_pending')::text;
  end if;
  v_var := (b ->> 'variance_kg')::numeric;
  v_pct := (b ->> 'variance_pct')::numeric;
  v_tol := (b ->> 'tolerance_pct')::numeric;
  v_kind := case when v_var = 0 then 'balanced' when v_tol is null then 'no_tolerance_set'
                 when abs(coalesce(v_pct, 0)) <= v_tol then 'within_tolerance' else 'outside_tolerance' end;
  if v_kind in ('no_tolerance_set', 'outside_tolerance') and coalesce(trim(p_explanation), '') = '' then
    raise exception 'Explain the unexplained variance of % kg', v_var using errcode = 'P0422',
      detail = jsonb_build_object('key', 'ph.mb.explain', 'variance', v_var, 'pct', v_pct, 'tolerance', v_tol)::text;
  end if;
  insert into public.ph_jc_reconciliations (farm_id, job_card_id, issued_kg, returned_kg, consumed_kg, fg_kg, waste_kg, variance_kg,
                                            variance_pct, tolerance_pct, tolerance_basis, explanation, weight_unit_id)
  values (r.farm_id, r.id, (b ->> 'issued_kg')::numeric, (b ->> 'returned_kg')::numeric, (b ->> 'consumed_kg')::numeric,
          (b ->> 'fg_kg')::numeric, (b ->> 'waste_kg')::numeric, v_var, v_pct, v_tol, v_kind, nullif(trim(p_explanation), ''),
          (select id from public.units where farm_id = r.farm_id and code = 'kg' and voided_at is null));
  perform app.ph_transition('ph_job_cards', r.id, 'reconciled', coalesce(nullif(trim(p_explanation), ''), 'MB-01: ' || v_kind));
  return b || jsonb_build_object('id', r.id, 'status', 'reconciled', 'tolerance_basis', v_kind);
end;
$$;

create function public.ph_close_job_card(p_jc uuid, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r public.ph_job_cards;
begin
  r := app.ph_job_card(p_jc::text);
  perform app.ph_authorize(r.farm_id, 'job_card.close');
  if r.status <> 'reconciled' then
    raise exception 'Only a reconciled Job Card is closed' using errcode = 'P0422', detail = jsonb_build_object('key', 'ph.jc.state', 'status', r.status)::text;
  end if;
  perform app.ph_transition('ph_job_cards', r.id, 'closed', p_comment);
  return jsonb_build_object('id', r.id, 'status', 'closed');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------------------------
create view public.ph_waste_board with (security_invoker = true) as
select w.id, w.farm_id, w.code, w.status, w.version, w.category, w.source_type, w.source_id, w.origin, w.notes, w.reference_kg,
       w.bags, w.net_kg, w.calibration_flag, w.route, w.route_basis, w.erp_ref, w.qc_reason, w.created_at, w.qc_at, w.weighed_at,
       w.top_mgmt_at, w.erp_at, w.disposed_at,
       greatest(w.created_at, (select max(t.server_received_at) from public.record_transitions t
                                where t.entity_type = 'ph_waste_records' and t.entity_id = w.id)) as stage_since,
       coalesce(j.code, f.code, p.code, l.code) as source_code, j.id as job_card_id,
       w.crop_id, c.code as crop_code, c.name_ar as crop_name_ar, c.name_en as crop_name_en, eq.code as scale_code,
       cb.full_name as created_by_name, qb.full_name as qc_by_name, wb.full_name as weighed_by_name, tb.full_name as top_mgmt_by_name,
       eb.full_name as erp_by_name, db.full_name as disposed_by_name,
       (select coalesce(jsonb_agg(jsonb_build_object('role', s.spec_code, 'by', u.full_name, 'at', s.created_at, 'comment', s.comment) order by s.created_at), '[]')
          from public.ph_waste_signoffs s left join public.user_profiles u on u.id = s.created_by
         where s.waste_id = w.id and s.voided_at is null) as signoffs,
       case when w.route = 'small' then array['PHM'] when w.route in ('large', 'top_mgmt') then app.ph_waste_large_signers(w.farm_id) end as required_signers,
       (select count(*) from public.ph_attachments x where x.entity_type = 'ph_waste_records' and x.entity_id = w.id and x.voided_at is null) as attachment_count,
       w.status = 'awaiting_top_mgmt' and now() - (select max(t.server_received_at) from public.record_transitions t
                                                    where t.entity_type = 'ph_waste_records' and t.entity_id = w.id)
         > make_interval(hours => coalesce(app.ph_param(w.farm_id, 'topmgmt_waste_timeout_hours'), 24)::int) as top_mgmt_overdue
  from public.ph_waste_records w
  left join public.ph_job_cards j on w.source_type = 'job_card' and j.id = w.source_id
  left join public.ph_fg_pallets f on w.source_type = 'fg_pallet' and f.id = w.source_id
  left join public.ph_incoming_pallets p on w.source_type = 'incoming_pallet' and p.id = w.source_id
  left join public.ph_locations l on w.source_type = 'location' and l.id = w.source_id
  left join public.ph_crops c on c.id = w.crop_id
  left join public.ph_equipment eq on eq.id = w.scale_id
  left join public.user_profiles cb on cb.id = w.created_by
  left join public.user_profiles qb on qb.id = w.qc_by
  left join public.user_profiles wb on wb.id = w.weighed_by
  left join public.user_profiles tb on tb.id = w.top_mgmt_by
  left join public.user_profiles eb on eb.id = w.erp_by
  left join public.user_profiles db on db.id = w.disposed_by
 where w.voided_at is null;
comment on view public.ph_waste_board is 'One row per waste record: source, people at each step, weight, sign-off route and signatures.';

-- MB-01 per Job Card, live, with the latest reconciliation (if any).
create view public.ph_jc_balance with (security_invoker = true) as
select j.id, j.farm_id, j.code, j.status,
       (b.v ->> 'issued_kg')::numeric as issued_kg,
       (b.v ->> 'returned_kg')::numeric as returned_kg,
       (b.v ->> 'consumed_kg')::numeric as consumed_kg,
       (b.v ->> 'fg_kg')::numeric as fg_kg,
       (b.v ->> 'waste_kg')::numeric as waste_kg,
       (b.v ->> 'waste_pending')::int as waste_pending,
       (b.v ->> 'variance_kg')::numeric as variance_kg,
       (b.v ->> 'variance_pct')::numeric as variance_pct,
       (b.v ->> 'tolerance_pct')::numeric as tolerance_pct,
       x.tolerance_basis as reconciled_basis, x.explanation as reconciled_explanation, x.created_at as reconciled_at,
       u.full_name as reconciled_by_name, x.variance_kg as reconciled_variance_kg
  from public.ph_job_cards j
  cross join lateral (select app.ph_jc_balance(j.id) as v) b
  left join lateral (select * from public.ph_jc_reconciliations r where r.job_card_id = j.id and r.voided_at is null
                      order by r.created_at desc limit 1) x on true
  left join public.user_profiles u on u.id = x.created_by
 where j.voided_at is null and app.ph_is_member(j.farm_id);
comment on view public.ph_jc_balance is 'MB-01 live per Job Card (kg): issued, returned, consumed, finished, weighed waste, unexplained variance.';

-- MB-02 per raw lot: accepted kg against what the records show happened to it. Nothing is forced to balance.
create view public.ph_lot_balance with (security_invoker = true) as
select l.id, l.farm_id, l.code, c.code as crop_code, c.name_ar as crop_name_ar, c.name_en as crop_name_en, s.code as source_code,
       count(p.id) as pallets,
       coalesce(sum(p.net_kg), 0) as accepted_kg,
       coalesce(sum((select coalesce(sum(i.consumed_kg), 0) from public.ph_jc_inputs i where i.pallet_id = p.id and i.closed_at is not null and i.voided_at is null)), 0) as consumed_kg,
       coalesce(sum((select coalesce(sum(i.issued_kg), 0) from public.ph_jc_inputs i where i.pallet_id = p.id and i.closed_at is null and i.voided_at is null)), 0) as in_production_kg,
       coalesce(sum(case when p.status in ('accepted', 'stored', 'released', 'issued', 'on_hold') then app.ph_ip_available_kg(p.id) else 0 end), 0) as in_stock_kg,
       coalesce(sum((select coalesce(sum(w.net_kg), 0) from public.ph_waste_records w where w.source_type = 'incoming_pallet' and w.source_id = p.id
                      and w.voided_at is null and w.net_kg is not null)), 0) as raw_waste_kg,
       coalesce(sum((select coalesce(sum(w.reference_kg), 0) from public.ph_waste_records w where w.source_type = 'incoming_pallet' and w.source_id = p.id
                      and w.voided_at is null and w.net_kg is null)), 0) as raw_waste_unweighed_kg,
       (select coalesce(sum(x.kg), 0) from public.ph_fg_pallet_lots x join public.ph_fg_pallets f on f.id = x.fg_pallet_id
         where x.lot_id = l.id and f.voided_at is null and f.status <> 'split_merged') as fg_attributed_kg,
       coalesce(sum(p.net_kg), 0)
         - coalesce(sum((select coalesce(sum(i.consumed_kg), 0) from public.ph_jc_inputs i where i.pallet_id = p.id and i.closed_at is not null and i.voided_at is null)), 0)
         - coalesce(sum((select coalesce(sum(i.issued_kg), 0) from public.ph_jc_inputs i where i.pallet_id = p.id and i.closed_at is null and i.voided_at is null)), 0)
         - coalesce(sum(case when p.status in ('accepted', 'stored', 'released', 'issued', 'on_hold') then app.ph_ip_available_kg(p.id) else 0 end), 0)
         - coalesce(sum((select coalesce(sum(w.net_kg), 0) from public.ph_waste_records w where w.source_type = 'incoming_pallet' and w.source_id = p.id
                          and w.voided_at is null and w.net_kg is not null)), 0) as unexplained_kg
  from public.ph_lots l
  join public.ph_crops c on c.id = l.crop_id
  left join public.ph_sources s on s.id = l.source_id
  left join public.ph_incoming_pallets p on p.lot_id = l.id and p.voided_at is null
 where l.voided_at is null and app.ph_is_member(l.farm_id)
 group by l.id, l.farm_id, l.code, c.code, c.name_ar, c.name_en, s.code;
comment on view public.ph_lot_balance is
  'MB-02 per lot (kg). Unexplained = accepted − consumed − in production − in stock − weighed raw waste; weight-loss '
  'adjustments wait on OD-28 and are not deducted.';

-- MB-03 per arrival as far as recorded: farm dispatch weight is not captured (OD-01 / CP-02), so the balance starts at the scale.
create view public.ph_arrival_balance with (security_invoker = true) as
select a.id, a.farm_id, a.code, a.arrived_at, a.dispatched_pallets, a.dispatched_boxes,
       count(p.id) as pallets,
       coalesce(sum(coalesce(p.pre_regrade_net_kg, p.net_kg)), 0) as registered_kg,
       coalesce(sum(p.net_kg) filter (where p.status in ('returned_to_source')), 0) as returned_to_source_kg,
       coalesce(sum(coalesce(p.pre_regrade_net_kg, p.net_kg)) filter (where p.status = 'waste'), 0) as rejected_to_waste_kg,
       coalesce(sum(p.pre_regrade_net_kg - p.net_kg) filter (where p.pre_regrade_net_kg is not null and p.status <> 'waste'), 0) as regrade_removed_kg,
       coalesce(sum(p.net_kg) filter (where p.lot_id is not null and p.status not in ('waste', 'returned_to_source', 'void')), 0) as accepted_kg,
       coalesce(sum(coalesce(p.pre_regrade_net_kg, p.net_kg)) filter (where p.status in ('registered', 'pre_cooling', 'awaiting_qa', 'qa_rejected',
                    'in_regrade', 'awaiting_recheck', 'arrival_rejected', 'on_hold') and p.lot_id is null), 0) as undecided_kg,
       coalesce(sum(p.net_kg) filter (where p.status = 'void'), 0) as void_kg
  from public.ph_arrivals a
  left join public.ph_incoming_pallets p on p.arrival_id = a.id and p.voided_at is null
 where a.voided_at is null and app.ph_is_member(a.farm_id)
 group by a.id;
comment on view public.ph_arrival_balance is
  'Receiving balance per arrival (kg) from the scale on: registered = accepted + rejected to waste + returned to source + '
  'removed in regrade + undecided. The farm dispatch weight (MB-03) needs CP-02 / OD-01 and is not recorded.';

-- Stage counts: waste now has its own queue.
create or replace function public.ph_stage_counts() returns table (stage text, total bigint, attention bigint)
language sql stable security invoker set search_path = public, app, pg_temp
as $$
  select 'arrivals', count(*), count(*) filter (where status = 'vehicle_hold' or late_flag)
    from public.ph_arrival_board where status in ('draft', 'vehicle_hold', 'submitted')
  union all
  select b.stage, count(*), count(*) filter (where b.dwell_exceeded or b.grading_overdue or b.calibration_flag
                                                    or b.status in ('qa_rejected', 'on_hold', 'arrival_rejected'))
    from public.ph_ip_board b where b.stage <> 'production' group by b.stage
  union all
  select 'production', count(*), count(*) filter (where status in ('line_check_failed', 'paused') or (status = 'in_progress' and qc2_result = 'fail'))
    from public.ph_jc_board where status in ('draft', 'planned', 'ready', 'line_check_failed', 'in_progress', 'paused', 'completed', 'reconciled')
  union all
  select 'qc2', count(*), count(*) filter (where qc2_result = 'fail')
    from public.ph_jc_board where status = 'in_progress'
  union all
  select 'fg_pallets', count(*), count(*) filter (where label_print_count = 0)
    from public.ph_fg_board where status in ('created', 'qc_approved')
  union all
  select 'fg_storage', count(*), count(*) filter (where qc_valid_until < now())
    from public.ph_fg_board where status = 'in_storage'
  union all
  select 'waste', count(*), count(*) filter (where top_mgmt_overdue or (status = 'weighed'))
    from public.ph_waste_board where status not in ('disposed', 'returned_to_line')
$$;

create or replace view public.ph_exception_items with (security_invoker = true) as
select 'E-05'::text as rule, 'ph_incoming_pallets'::text as entity_type, id as entity_id, code, farm_id, precool_in_at as since, 'high'::text as severity,
       jsonb_build_object('minutes', dwell_minutes) as params
  from public.ph_ip_board where status = 'pre_cooling' and dwell_exceeded
union all
select 'E-06', 'ph_incoming_pallets', id, code, farm_id, received_at, 'high', jsonb_build_object('hours', age_hours)
  from public.ph_ip_board where grading_overdue
union all
select 'E-02', 'ph_arrivals', id, code, farm_id, arrived_at, 'high', jsonb_build_object('signatures', exception_signatures)
  from public.ph_arrival_board where status = 'vehicle_hold'
union all
select 'E-03', 'ph_incoming_pallets', id, code, farm_id, arrival_check_at, 'medium', jsonb_build_object('destination', reject_destination)
  from public.ph_ip_board where status = 'arrival_rejected'
union all
select 'E-04', 'ph_incoming_pallets', id, code, farm_id, stage_since, 'medium', jsonb_build_object('status', status)
  from public.ph_ip_board where status in ('qa_rejected', 'in_regrade', 'awaiting_recheck')
union all
select 'X-01', 'ph_holds', h.id, h.code, h.farm_id, h.created_at, case when h.hold_type = 'food_safety' then 'high' else 'medium' end,
       jsonb_build_object('type', h.hold_type, 'status', h.status)
  from public.ph_holds h where h.voided_at is null and h.status not in ('closed', 'cancelled')
union all
select 'OD-05', 'ph_inspections', i.id, i.code, i.farm_id, i.event_at, 'low', jsonb_build_object('type', i.inspection_type)
  from public.ph_inspections i where i.voided_at is null and i.qam_review_flag and i.inspection_type in ('rma', 'recheck')
union all
select 'FR-MD-06', 'ph_incoming_pallets', id, code, farm_id, received_at, 'low', jsonb_build_object('scale', scale_code)
  from public.ph_ip_board where calibration_flag and status not in ('returned_to_source', 'waste', 'void', 'consumed')
union all
select 'V-03', 'ph_arrivals', id, code, farm_id, arrived_at, 'low', jsonb_build_object('reason', late_reason)
  from public.ph_arrival_board where late_flag and app.ph_local_date(arrived_at) = app.ph_local_date()
union all
select 'E-09', 'ph_job_cards', id, code, farm_id, stage_since, 'high', jsonb_build_object('line', line_code)
  from public.ph_jc_board where status = 'line_check_failed'
union all
select 'E-10', 'ph_job_cards', id, code, farm_id, qc2_at, 'high', jsonb_build_object('stage', qc2_stage)
  from public.ph_jc_board where status in ('in_progress', 'paused') and qc2_result = 'fail'
union all
select 'OD-06', 'ph_inspections', i.id, i.code, i.farm_id, i.event_at, 'low', jsonb_build_object('type', i.inspection_type)
  from public.ph_inspections i where i.voided_at is null and i.inspection_type = 'qc2' and i.result = 'pass' and i.tolerance_basis = 'no_tolerance_set'
    and i.event_at > now() - interval '7 days'
union all
select 'E-20', 'ph_waste_records', id, code, farm_id, stage_since, 'high', jsonb_build_object('kg', net_kg)
  from public.ph_waste_board where top_mgmt_overdue
union all
select 'OD-11', 'ph_waste_records', id, code, farm_id, weighed_at, 'medium', jsonb_build_object('kg', net_kg)
  from public.ph_waste_board where status = 'weighed'
union all
select 'MB-01', 'ph_job_cards', r.job_card_id, j.code, r.farm_id, r.created_at, 'low',
       jsonb_build_object('kg', r.variance_kg, 'pct', r.variance_pct, 'basis', r.tolerance_basis)
  from public.ph_jc_reconciliations r join public.ph_job_cards j on j.id = r.job_card_id
 where r.voided_at is null and r.tolerance_basis in ('no_tolerance_set', 'outside_tolerance') and r.created_at > now() - interval '7 days';

-- Job Card actions: waste, reconciliation and close are built; reopening waits on OD-15.
create or replace function public.ph_job_card_actions(p_jc uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  r       public.ph_job_cards;
  li      public.ph_inspections;
  q       public.ph_inspections;
  v_uid   uuid := app.current_user_id();
  v_out   jsonb := '[]';
  c       record;
  v_why   jsonb;
  v_mine  text[];
  v_their text[];
  v_has_inputs boolean;
  v_bal   jsonb;
begin
  r := app.ph_job_card(p_jc::text);
  select * into li from public.ph_inspections where id = r.line_start_inspection_id;
  q := app.ph_jc_qc2_latest(r.id);
  v_has_inputs := exists (select 1 from public.ph_jc_inputs where job_card_id = r.id and voided_at is null);
  for c in
    select * from (values
      ('approve', 'job_card.approve', r.status = 'draft'),
      ('cancel', 'job_card.approve', r.status in ('draft', 'planned')),
      ('issue_input', 'job_card.record_inputs', r.status in ('planned', 'ready', 'in_progress')),
      ('issue_packaging', 'packaging.issue', r.status in ('planned', 'ready', 'in_progress', 'paused')),
      ('mark_ready', 'job_card.execute', r.status = 'planned'),
      ('line_start_check', 'line_start.submit', r.status = 'ready' and r.line_start_inspection_id is null),
      ('confirm_start', 'line_start.submit', r.status = 'ready' and r.line_start_inspection_id is not null),
      ('line_corrected', 'job_card.execute', r.status = 'line_check_failed'),
      ('pause', 'job_card.execute', r.status = 'in_progress'),
      ('resume', 'job_card.execute', r.status = 'paused'),
      ('qc2', 'qc2.submit', r.status = 'in_progress'),
      ('create_fg', 'fg_pallet.create', r.status = 'in_progress'),
      ('record_waste', 'waste.create', r.status in ('in_progress', 'paused', 'completed')),
      ('complete', 'job_card.execute', r.status = 'in_progress'),
      ('reconcile', 'job_card.close', r.status = 'completed'),
      ('close', 'job_card.close', r.status = 'reconciled'),
      ('reopen', 'job_card.close', r.status = 'closed')
    ) as x(action, ph_action, applicable)
  loop
    continue when not c.applicable;
    v_why := app.ph_denial(v_uid, r.farm_id, c.ph_action);
    if c.action = 'reopen' then
      v_why := jsonb_build_object('key', 'ph.blocked.open', 'decision', 'OD-15');
    end if;
    if v_why is null and c.action = 'reconcile' then
      v_bal := app.ph_jc_balance(r.id);
      if (v_bal ->> 'waste_pending')::int > 0 then
        v_why := jsonb_build_object('key', 'ph.mb.wastePending', 'count', v_bal ->> 'waste_pending');
      end if;
    end if;
    if v_why is null and c.action = 'cancel' and v_has_inputs then
      v_why := jsonb_build_object('key', 'ph.jc.cancelInputs');
    end if;
    if v_why is null and c.action = 'mark_ready' then
      if not exists (select 1 from public.ph_jc_inputs where job_card_id = r.id and closed_at is null and voided_at is null) then
        v_why := jsonb_build_object('key', 'ph.jc.needInputs');
      elsif not exists (select 1 from public.ph_jc_packaging where job_card_id = r.id and voided_at is null) then
        v_why := jsonb_build_object('key', 'ph.jc.needPackaging');
      end if;
    end if;
    if v_why is null and c.action = 'confirm_start' then
      if li.created_by = v_uid then
        v_why := jsonb_build_object('key', 'ph.sod', 'column', 'line_start_recorder');
      else
        v_mine := app.ph_user_spec_roles(v_uid, r.farm_id);
        v_their := app.ph_user_spec_roles(li.created_by, r.farm_id);
        if not (('QCI' = any (v_their) and 'LL' = any (v_mine)) or ('LL' = any (v_their) and 'QCI' = any (v_mine))) then
          v_why := jsonb_build_object('key', 'ph.g5.pair');
        end if;
      end if;
    end if;
    if v_why is null and c.action = 'create_fg' and (q.id is null or q.result <> 'pass' or q.qc2_stage <> 'final') then
      v_why := jsonb_build_object('key', 'ph.g6.notPassed', 'job_card', r.code);
    end if;
    v_out := v_out || jsonb_build_object('action', c.action, 'ph_action', c.ph_action, 'allowed', v_why is null, 'reason', v_why,
                                         'basis', app.ph_permission_basis(v_uid, r.farm_id, c.ph_action));
  end loop;
  return v_out;
end;
$$;

select app.seed_ph_waste_reconciliation(id) from public.farms;
select app.apply_api_grants();
