-- Hosted instance: the Owner downloads a full backup from Settings. The packhouse server asks this function whether the
-- session may download (active session, active account, action backup.download), and the download is recorded.

create function app.seed_po_backup(p_farm uuid) returns void
language plpgsql as $$
begin
  insert into public.ph_actions (farm_id, action_key, object_code, label_en, label_ar, owner_roles, milestone, source, sort_order, scope_kind, category)
  select p_farm, 'backup.download', 'backup', 'Download a full backup of the database', 'تنزيل نسخة احتياطية كاملة من قاعدة البيانات', '{OWN}', 'PO-7',
         'Owner instruction 2026-11-22 (backup and recovery)', 1100, 'farm', 'administer'
   where not exists (select 1 from public.ph_actions where farm_id = p_farm and action_key = 'backup.download');
  insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
  select p_farm, 'backup.download', 'OWN', 'O', 'active', 'O', 'Owner role'
   where exists (select 1 from public.ph_roles where farm_id = p_farm and spec_code = 'OWN')
     and not exists (select 1 from public.ph_permission_cells where farm_id = p_farm and action_key = 'backup.download' and spec_code = 'OWN');
end $$;

create function public.po_backup_allowed(p_session uuid) returns boolean
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_user uuid;
  v_farm uuid;
begin
  select a.user_id, a.farm_id into v_user, v_farm
    from app.po_sessions s join app.po_accounts a on a.user_id = s.user_id
   where s.id = p_session and s.revoked_at is null and s.expires_at > now() and a.status = 'active' and not a.must_change_password;
  if v_user is null then return false; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  if not app.ph_can(v_farm, 'backup.download') then return false; end if;
  insert into public.ph_access_events (farm_id, target_user_id, event, after, reason)
  values (v_farm, v_user, 'backup_downloaded', jsonb_build_object('at', now()), 'Full backup downloaded from Settings');
  return true;
end;
$$;
revoke all on function public.po_backup_allowed(uuid) from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'po_auth') then grant execute on function public.po_backup_allowed(uuid) to po_auth; end if; end $$;

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
  perform app.seed_ph_orders_plan(p_farm);
  perform app.seed_po_shift_core(p_farm);
  perform app.seed_po_dispatch(p_farm);
  perform app.seed_po_identity(p_farm);
  perform app.seed_po_config_engine(p_farm);
  perform app.seed_po_backup(p_farm);
end $$;

select app.seed_po_backup(id) from public.farms;
select app.apply_api_grants();
revoke all on function public.po_backup_allowed(uuid) from anon, authenticated;
