-- Super Admin (Owner) setup and recovery, owner instruction 2026-11-22.
--   * One-time setup: while the bootstrap Owner account is still pending, the holder of the setup code (shown only in the
--     hosting dashboard) chooses their own username, name and password at /setup. Single use, expiring; afterwards no
--     pending Owner exists and the bootstrap never runs again (deploy/migrate.mjs creates an Owner only when none exists).
--   * Recovery of a sole Owner: the hosting dashboard holder sets a recovery code; the next start turns it into a one-time,
--     24-hour activation code on the Owner account (password not shown, not overwritten until the Owner chooses a new one;
--     sessions revoked). Each recovery code works once.
--   * The Owner also holds the farm's System Administrator role, so departments, locations, master data, audit and every
--     other office administration screen are theirs too. Quality decisions stay with the quality roles (rule 4); the Owner
--     assigns people to those roles.

-- Codes are compared upper-cased everywhere (po_activate does); store and check them the same way.
create function app.po_code_hash(p_code text) returns text
language sql volatile security definer set search_path = app, extensions, pg_temp
as $$ select app.po_hash(upper(trim(p_code))) $$;

-- Owner ⇒ also the farm's System Administrator (office administration).
create function app.po_owner_also_admin(p_farm uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_role uuid := (select id from public.roles where farm_id = p_farm and code = 'system_admin');
begin
  if v_role is null or exists (select 1 from public.user_roles where farm_id = p_farm and user_id = p_user and role_id = v_role and voided_at is null
                                   and (valid_to is null or valid_to > now())) then
    return;
  end if;
  perform set_config('app.acting_user_id', p_user::text, true);
  insert into public.user_roles (farm_id, user_id, role_id, valid_from) values (p_farm, p_user, v_role, now());
end;
$$;

-- Setup state for the /setup page (no secrets): whether a pending Owner can still be set up.
create function public.po_setup_status() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select jsonb_build_object('pending', exists (
    select 1 from app.po_accounts a join public.user_roles ur on ur.user_id = a.user_id and ur.voided_at is null
      join public.ph_roles pr on pr.role_id = ur.role_id and pr.spec_code = 'OWN'
     where a.status = 'active' and a.activation_code_hash is not null and a.password_hash is null and a.activation_expires_at > now()))
$$;

create function public.po_owner_setup(p_code text, p_username text, p_full_name text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  a      app.po_accounts;
  v_user text := lower(trim(p_username));
begin
  -- The one pending bootstrap Owner (never set a password) whose code matches.
  select acc.* into a from app.po_accounts acc join public.user_roles ur on ur.user_id = acc.user_id and ur.voided_at is null
    join public.ph_roles pr on pr.role_id = ur.role_id and pr.spec_code = 'OWN'
   where acc.status = 'active' and acc.activation_code_hash is not null and acc.password_hash is null and acc.activation_expires_at > now()
     and (acc.locked_until is null or acc.locked_until <= now())
   order by acc.created_at limit 1 for update of acc;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_pending_setup'); end if;
  if not app.po_check(upper(trim(p_code)), a.activation_code_hash) then
    update app.po_accounts set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= app.po_setting(farm_id, 'po_lockout_attempts', 5)
                               then now() + make_interval(mins => app.po_setting(farm_id, 'po_lockout_minutes', 15)::int) end
     where user_id = a.user_id;
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if v_user !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then return jsonb_build_object('ok', false, 'error', 'username'); end if;
  if exists (select 1 from app.po_accounts where lower(username) = v_user and user_id <> a.user_id) then
    return jsonb_build_object('ok', false, 'error', 'username_taken');
  end if;
  if coalesce(trim(p_full_name), '') = '' then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  perform app.po_password_ok(v_user, p_password);
  perform set_config('app.acting_user_id', a.user_id::text, true);
  update app.po_accounts set username = v_user, password_hash = app.po_hash(p_password), activation_code_hash = null, activation_expires_at = null,
         must_change_password = false, failed_attempts = 0, locked_until = null where user_id = a.user_id;
  update public.user_profiles set full_name = trim(p_full_name) where id = a.user_id;
  perform app.po_owner_also_admin(a.farm_id, a.user_id);
  insert into public.ph_access_events (farm_id, target_user_id, event, after, reason)
  values (a.farm_id, a.user_id, 'owner_setup_completed', jsonb_build_object('username', v_user), 'Super Admin set up with the one-time setup code');
  return jsonb_build_object('ok', true, 'username', v_user);
end;
$$;

-- Sole-Owner recovery, applied by the start script from the dashboard recovery code (each code once).
create table app.po_recovery_used (
  code_sha   text primary key,
  used_at    timestamptz not null default now()
);
alter table app.po_recovery_used enable row level security;
revoke all on app.po_recovery_used from public, anon, authenticated;

create function app.po_owner_recovery(p_code text) returns text
language plpgsql security definer set search_path = public, app, extensions, pg_temp
as $$
declare
  v_sha  text := encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex');
  a      app.po_accounts;
  n      integer;
begin
  if coalesce(trim(p_code), '') = '' then return 'none'; end if;
  if exists (select 1 from app.po_recovery_used where code_sha = v_sha) then return 'already_used'; end if;
  select count(*) into n from app.po_accounts acc join public.user_roles ur on ur.user_id = acc.user_id and ur.voided_at is null
    join public.ph_roles pr on pr.role_id = ur.role_id and pr.spec_code = 'OWN' where acc.status = 'active';
  if n <> 1 then
    insert into app.po_recovery_used (code_sha) values (v_sha);
    return case when n = 0 then 'no_owner' else 'several_owners_reset_each_other' end;
  end if;
  select acc.* into a from app.po_accounts acc join public.user_roles ur on ur.user_id = acc.user_id and ur.voided_at is null
    join public.ph_roles pr on pr.role_id = ur.role_id and pr.spec_code = 'OWN' where acc.status = 'active' for update of acc;
  perform set_config('app.acting_user_id', a.user_id::text, true);
  update app.po_accounts set activation_code_hash = app.po_code_hash(p_code), activation_expires_at = now() + interval '24 hours',
         failed_attempts = 0, locked_until = null where user_id = a.user_id;
  update app.po_sessions set revoked_at = now(), revoked_reason = 'Owner recovery' where user_id = a.user_id and revoked_at is null;
  insert into app.po_recovery_used (code_sha) values (v_sha);
  insert into public.ph_access_events (farm_id, target_user_id, event, reason)
  values (a.farm_id, a.user_id, 'owner_recovery_issued', 'Recovery code set in the hosting dashboard; valid 24 hours, once');
  return 'issued:' || a.username;
end;
$$;

revoke all on function public.po_owner_setup(text, text, text, text), public.po_setup_status() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'po_auth') then
    grant execute on function public.po_owner_setup(text, text, text, text), public.po_setup_status() to po_auth;
  end if;
end $$;

-- Existing Owners become System Administrators too.
select app.po_owner_also_admin(ur.farm_id, ur.user_id)
  from public.user_roles ur join public.ph_roles pr on pr.role_id = ur.role_id and pr.spec_code = 'OWN' where ur.voided_at is null;

select app.apply_api_grants();
revoke all on function public.po_owner_setup(text, text, text, text), public.po_setup_status() from anon, authenticated;
