-- Extend administration through the existing permissions, standard audit triggers and master-data approval flow.
create function public.ph_save_department(p_farm uuid, p_id uuid, p_version integer, p_code text,
  p_name_ar text, p_name_en text, p_kind text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, app, pg_temp
as $$
declare
  current_row public.departments;
  result_id uuid;
begin
  if not app.is_farm_member(p_farm) then raise exception 'Access denied' using errcode = 'P0403'; end if;
  if not app.has_permission(p_farm, 'department', case when p_id is null then 'create' else 'configure' end, p_id) then
    perform app.ph_authorize(p_farm, 'settings.authority');
  end if;
  if nullif(trim(p_name_ar), '') is null or length(trim(p_name_ar)) > 200 or length(trim(p_name_en)) > 200
     or p_kind is null or p_kind not in ('production', 'production_support', 'service', 'quality', 'coordination') then
    raise exception 'Invalid department details' using errcode = 'P0422';
  end if;
  if p_id is null then
    if p_code is null or trim(p_code) !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' then
      raise exception 'Invalid department code' using errcode = 'P0422';
    end if;
    insert into public.departments(farm_id, code, name_ar, name_en, kind)
      values(p_farm, trim(p_code), trim(p_name_ar), nullif(trim(p_name_en), ''), p_kind) returning id into result_id;
    return result_id;
  end if;
  select * into current_row from public.departments where id = p_id and farm_id = p_farm and voided_at is null for update;
  if not found then raise exception 'Department not found' using errcode = 'P0404'; end if;
  if p_version is distinct from current_row.version then raise exception 'Department changed' using errcode = 'P0409'; end if;
  if p_code is distinct from current_row.code or (current_row.is_independent and p_kind <> current_row.kind) then
    raise exception 'Protected department structure' using errcode = 'P0422';
  end if;
  perform set_config('app.in_verify', 'on', true);
  update public.departments set name_ar = trim(p_name_ar), name_en = nullif(trim(p_name_en), ''), kind = p_kind,
    verification_status = 'not_yet_verified', verified_by = null, verified_at = null where id = p_id;
  perform set_config('app.in_verify', 'off', true);
  return p_id;
end $$;
revoke all on function public.ph_save_department(uuid,uuid,integer,text,text,text,text) from public, anon;
grant execute on function public.ph_save_department(uuid,uuid,integer,text,text,text,text) to authenticated;

-- A preview runs the identical inserts in a subtransaction, then rolls them back, including their audit entries.
-- A changed catalog or concurrent import is rechecked on commit. One rejected row rolls back the whole file.
create function public.ph_import_master(p_farm uuid, p_table text, p_rows jsonb, p_apply boolean default false)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public, app, pg_temp
as $$
declare
  entry record;
  issues jsonb := '[]';
  total integer;
  area text;
begin
  if p_table not in ('ph_customers','ph_lines','ph_pack_formats','ph_shift_templates','ph_task_kinds',
                     'ph_downtime_causes','ph_packaging_items') or p_table is null then
    raise exception 'Unsupported import' using errcode = 'P0422';
  end if;
  area := case when p_table = 'ph_customers' then 'md_customer' else 'md_operational' end;
  if not app.ph_can(p_farm, area || '.edit') then raise exception 'Access denied' using errcode = 'P0403'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Expected rows' using errcode = 'P0422'; end if;
  total := jsonb_array_length(p_rows);
  if total not between 1 and 200 or octet_length(p_rows::text) > 524288 then
    raise exception 'Import size out of range' using errcode = 'P0422';
  end if;
  begin
    for entry in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
      begin
        if jsonb_typeof(entry.value) <> 'object' or nullif(trim(entry.value ->> 'code'), '') is null then
          raise exception 'Missing code' using errcode = 'P0422';
        end if;
        if entry.value ? 'customer_id' and not exists (
          select 1 from public.ph_customers where id = (entry.value ->> 'customer_id')::uuid
            and farm_id = p_farm and voided_at is null
        ) then raise exception 'Unknown customer' using errcode = 'P0422'; end if;
        perform public.ph_save_master(p_table, null, entry.value, p_farm);
      exception when unique_violation then
        issues := issues || jsonb_build_array(jsonb_build_object('row',entry.ordinality,'reason','duplicate'));
      when integrity_constraint_violation or data_exception or sqlstate 'P0422' then
        issues := issues || jsonb_build_array(jsonb_build_object('row',entry.ordinality,'reason','invalid'));
      end;
    end loop;
    if not coalesce(p_apply,false) or issues <> '[]'::jsonb then raise sqlstate 'P9998'; end if;
  exception when sqlstate 'P9998' then null;
  end;
  return jsonb_build_object('total',total,'issues',issues,'saved',case when p_apply and issues = '[]'::jsonb then total else 0 end);
end $$;
revoke all on function public.ph_import_master(uuid,text,jsonb,boolean) from public, anon;
grant execute on function public.ph_import_master(uuid,text,jsonb,boolean) to authenticated;

create function public.ph_set_account_policy(p_farm uuid, p_key text, p_value integer, p_version integer)
returns void language plpgsql security definer set search_path = pg_catalog, public, app, pg_temp
as $$
declare maximum integer;
begin
  perform app.ph_authorize(p_farm, 'settings.authority');
  maximum := case p_key when 'po_lockout_attempts' then 20 when 'po_lockout_minutes' then 1440
    when 'po_session_hours' then 168 when 'po_activation_hours' then 720 end;
  if maximum is null or p_value is null or p_value not between 1 and maximum then
    raise exception 'Invalid policy value' using errcode = 'P0422';
  end if;
  update public.settings set value = to_jsonb(p_value), evidence_tier = 'A', note = 'Configured in account policy settings'
    where farm_id = p_farm and key = p_key and version = p_version and voided_at is null;
  if not found then raise exception 'Policy changed. Reload before saving' using errcode = 'P0409'; end if;
end $$;
revoke all on function public.ph_set_account_policy(uuid,text,integer,integer) from public, anon;
grant execute on function public.ph_set_account_policy(uuid,text,integer,integer) to authenticated;
