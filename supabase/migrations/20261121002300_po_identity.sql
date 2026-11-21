-- Packhouse operations, increment 4: accounts without e-mail, sessions that can be revoked, the Owner, custom roles, delegated
-- account management, effective access with its source, and an audit of every access change.
--
-- How sign-in works on the packhouse server (server/packhouse-server.mjs, engineering decision E-02): the server calls
-- po_sign_in() as the dedicated database role po_auth; the password is checked here with bcrypt (pgcrypto); the server signs a
-- short-lived token carrying the session id; PostgREST runs app.po_pre_request() before every API call, which refuses a
-- revoked or expired session, a suspended or archived account, and everything but the password change while a change is due.
-- Role, scope and override changes are read from the tables on every call, so they apply to the next request of an open session.

set check_function_bodies = off;

create schema if not exists extensions;
do $$
begin
  create extension if not exists pgcrypto with schema extensions;
exception when others then
  raise notice 'pgcrypto is not available here: packhouse accounts cannot be used in this environment (%).', sqlerrm;
end $$;

-- =============================================================================================
-- 1. Accounts and sessions (not exposed through the API)
-- =============================================================================================
create table app.po_accounts (
  user_id               uuid primary key references auth.users(id),
  farm_id               uuid not null references public.farms(id),
  username              text not null check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  password_hash         text,
  status                text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  must_change_password  boolean not null default true,
  activation_code_hash  text,
  activation_expires_at timestamptz,
  failed_attempts       integer not null default 0,
  locked_until          timestamptz,
  last_sign_in_at       timestamptz,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  status_reason         text
);
create unique index po_accounts_username_uq on app.po_accounts (lower(username));
comment on table app.po_accounts is
  'Sign-in credentials of packhouse-server accounts: username (company e-mail optional, kept on auth.users), bcrypt hash, '
  'one-time activation code hash, first-use password change, lockout, status. Never exposed through the API.';

create table app.po_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references app.po_accounts(user_id),
  refresh_hash   text not null,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  revoked_reason text,
  user_agent     text,
  ip             text
);
create index po_sessions_user_idx on app.po_sessions (user_id) where revoked_at is null;
comment on table app.po_sessions is 'Signed-in sessions. A revoked session is refused on its next request (app.po_pre_request).';

alter table app.po_accounts enable row level security;
alter table app.po_sessions enable row level security;
revoke all on app.po_accounts, app.po_sessions from public, anon, authenticated;

-- Server-side login role (password set by the launcher, never in the repository).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'po_auth') then
    create role po_auth nologin;
  end if;
end $$;
grant usage on schema app, public to po_auth;

-- Technical defaults (tier C, VR-PO-C01): 5 failed attempts lock an account for 15 minutes; a session lasts 12 hours of
-- inactivity at most; an activation code is valid 72 hours. Configurable in public.settings.
create function app.po_setting(p_farm uuid, p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public, app, pg_temp
as $$ select coalesce((select (value #>> '{}')::numeric from public.settings where farm_id = p_farm and key = p_key and voided_at is null), p_default) $$;

-- =============================================================================================
-- 2. Access audit, delegations, Owner role and authority actions
-- =============================================================================================
create table public.ph_access_events (
  id              uuid primary key default gen_random_uuid(),
  target_user_id  uuid references auth.users(id),
  event           text not null,
  before          jsonb,
  after           jsonb,
  reason          text
);
comment on table public.ph_access_events is
  'Every change to accounts, roles, scopes, overrides, delegations, custom roles and permission cells: who (created_by), '
  'when, for whom, before and after, and the reason. Append-only; readable by account administrators and auditors.';
select app.register_table('public.ph_access_events', 'ph_access', false, p_default_policies => false);
create trigger ph_access_events_append_only before update on public.ph_access_events for each row execute function app.ph_append_only();
create index ph_access_events_target_idx on public.ph_access_events (target_user_id);

create table public.ph_admin_delegations (
  id               uuid primary key default gen_random_uuid(),
  manager_user_id  uuid not null references public.user_profiles(id),
  grantable_roles  text[] not null default '{}',
  line_ids         uuid[],
  can_create       boolean not null default false,
  can_reset        boolean not null default false,
  can_suspend      boolean not null default false,
  valid_to         timestamptz,
  reason           text not null check (length(trim(reason)) > 0)
);
comment on table public.ph_admin_delegations is
  'Limited account management delegated by the Owner to a manager: which roles they may grant (spec codes), on which lines '
  '(null = every line), and whether they may create, reset and suspend accounts. Anything outside it is refused by the server.';
select app.register_table('public.ph_admin_delegations', 'ph_access', false, p_default_policies => false);
create index ph_admin_delegations_mgr_idx on public.ph_admin_delegations (manager_user_id);

alter table public.ph_roles drop constraint ph_roles_spec_code_check;
alter table public.ph_roles add constraint ph_roles_spec_code_check check (spec_code ~ '^[A-Z][A-Z0-9_]{1,15}$');
alter table public.ph_roles add column is_custom boolean not null default false, add column cloned_from text;
alter table public.ph_roles drop constraint ph_roles_evidence_check;
alter table public.ph_roles add constraint ph_roles_evidence_check check (evidence in ('C', 'P', 'NYV', 'O'));
alter table public.ph_permission_cells drop constraint ph_permission_cells_evidence_check;
alter table public.ph_permission_cells add constraint ph_permission_cells_evidence_check check (evidence in ('C', 'P', 'NYV', 'O'));
comment on column public.ph_permission_cells.evidence is
  'Spec label C / P / NYV, or O = granted by a recorded Owner decision (custom roles, owner-activated cells), with actor and reason in ph_access_events.';

create function app.seed_po_identity(p_farm uuid) returns void
language plpgsql
as $$
begin
  perform app.po_categorize_actions(p_farm);
  if exists (select 1 from public.ph_roles where farm_id = p_farm and spec_code = 'OWN') then return; end if;
  insert into public.roles (farm_id, code, name_ar, name_en) values (p_farm, 'ph_own', 'المالك', 'Owner')
  on conflict do nothing;
  insert into public.ph_roles (farm_id, role_id, spec_code, department_text, reporting_line, evidence, source, system_use, sort_order)
  values (p_farm, (select id from public.roles where farm_id = p_farm and code = 'ph_own'), 'OWN', 'Company', 'Top of the organisation', 'C',
          'Owner instruction 2026-11-21 ("Give me an Owner account")',
          'Users, roles, authority, settings, publishing, reports and exports; no quality release (QA independence)', 0);

  insert into public.ph_actions (farm_id, action_key, object_code, label_en, label_ar, owner_roles, milestone, source, sort_order, scope_kind, category)
  select p_farm, a.k, split_part(a.k, '.', 1), a.en, a.ar, '{OWN}', 'PO-4', 'Owner instruction 2026-11-21 §3.1', 980 + row_number() over (), 'farm', a.cat
    from (values
      ('users.manage_roles', 'Create, clone and edit custom roles and their permissions', 'إنشاء الأدوار المخصصة ونسخها وتعديل صلاحياتها', 'administer'),
      ('users.delegate', 'Delegate limited account management to a manager', 'تفويض إدارة حسابات محدودة لمدير', 'administer'),
      ('settings.authority', 'Decide on permission cells and open items (Owner decision)', 'البت في خلايا الصلاحيات والبنود المفتوحة (قرار المالك)', 'administer'),
      ('settings.edit', 'Edit operations settings drafts', 'تعديل مسودات إعدادات العمليات', 'edit'),
      ('settings.publish', 'Publish or roll back settings versions', 'نشر إصدارات الإعدادات أو التراجع عنها', 'publish')
    ) as a(k, en, ar, cat)
   where not exists (select 1 from public.ph_actions where farm_id = p_farm and action_key = a.k);

  -- The Owner: everything that views, administers, publishes or exports, and the settings and master-data maker / checker
  -- actions; never a quality decision or release (QA independent of Operations, rule 4; SoD-05).
  insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
  select p_farm, a.action_key, 'OWN', 'O', 'active', 'O', 'Owner role (owner instruction 2026-11-21)'
    from public.ph_actions a
   where a.farm_id = p_farm and a.voided_at is null
     and (a.category in ('view', 'administer', 'publish', 'export')
          or a.action_key in ('settings.edit', 'md_operational.edit', 'md_operational.approve', 'md_customer.edit',
                              'shift.manage', 'order_timing.plan', 'issue.instruct', 'report.kpi_view', 'audit.view'))
     and a.action_key not like 'hold.%' and a.category is distinct from 'quality'
     and not exists (select 1 from public.ph_permission_cells c where c.farm_id = p_farm and c.action_key = a.action_key and c.spec_code = 'OWN');

  -- Technical defaults, labelled (VR-PO-C01).
  insert into public.settings (farm_id, key, value, evidence_tier, note)
  select p_farm, s.k, to_jsonb(s.v), 'C', s.note
    from (values ('po_lockout_attempts', 5, 'Failed sign-ins before a 15-minute lock (technical default, VR-PO-C01)'),
                 ('po_lockout_minutes', 15, 'Lock length after repeated failures (technical default, VR-PO-C01)'),
                 ('po_session_hours', 12, 'Session expiry without use (technical default, VR-PO-C01)'),
                 ('po_activation_hours', 72, 'Validity of a one-time activation code (technical default, VR-PO-C01)')) as s(k, v, note)
   where not exists (select 1 from public.settings where farm_id = p_farm and key = s.k);
end;
$$;

-- =============================================================================================
-- 3. Credentials (bcrypt in the database) and the server-side sign-in calls (po_auth only)
-- =============================================================================================
create function app.po_hash(p_secret text) returns text
language sql volatile security definer set search_path = app, extensions, pg_temp
as $$ select extensions.crypt(p_secret, extensions.gen_salt('bf', 10)) $$;

create function app.po_check(p_secret text, p_hash text) returns boolean
language sql stable security definer set search_path = app, extensions, pg_temp
as $$ select p_hash is not null and extensions.crypt(p_secret, p_hash) = p_hash $$;

-- Password rule (technical default VR-PO-C01): at least 8 characters with a letter and a digit, not the username.
create function app.po_password_ok(p_username text, p_password text) returns void
language plpgsql immutable as $$
begin
  if length(coalesce(p_password, '')) < 8 or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' or lower(p_password) like '%' || lower(p_username) || '%' then
    raise exception 'The password needs at least 8 characters with letters and digits, and must not contain the username'
      using errcode = 'P0422', detail = jsonb_build_object('key', 'po.password.weak')::text;
  end if;
end;
$$;

-- A random one-time secret from an unambiguous alphabet (no 0/O, 1/l/I), shown once.
create function app.po_secret(p_len integer) returns text
language sql volatile security definer set search_path = app, extensions, pg_temp
as $$
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 54), 1), '')
    from generate_series(1, p_len)
$$;

-- Server sign-in. Answers the same for an unknown username and a wrong password.
create function public.po_sign_in(p_login text, p_password text, p_user_agent text default null, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  a      app.po_accounts;
  v_sid  uuid := gen_random_uuid();
  v_ref  text;
  v_hours numeric;
begin
  select * into a from app.po_accounts where lower(username) = lower(trim(p_login))
     or user_id = (select id from auth.users where lower(email) = lower(trim(p_login)) limit 1)
   for update;
  if not found then
    perform app.po_hash('timing-equaliser');
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'until', a.locked_until);
  end if;
  if a.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;
  if not app.po_check(p_password, a.password_hash) then
    update app.po_accounts set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= app.po_setting(farm_id, 'po_lockout_attempts', 5)
                               then now() + make_interval(mins => app.po_setting(farm_id, 'po_lockout_minutes', 15)::int) end
     where user_id = a.user_id;
    return jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  end if;
  v_ref := encode(extensions.gen_random_bytes(32), 'hex');
  v_hours := app.po_setting(a.farm_id, 'po_session_hours', 12);
  insert into app.po_sessions (id, user_id, refresh_hash, expires_at, user_agent, ip)
  values (v_sid, a.user_id, encode(extensions.digest(v_ref, 'sha256'), 'hex'), now() + make_interval(hours => v_hours::int), left(p_user_agent, 300), left(p_ip, 64));
  update app.po_accounts set failed_attempts = 0, locked_until = null, last_sign_in_at = now() where user_id = a.user_id;
  return jsonb_build_object('ok', true, 'user_id', a.user_id, 'session_id', v_sid, 'refresh_token', v_sid || '.' || v_ref,
                            'must_change_password', a.must_change_password, 'username', a.username,
                            'email', (select email from auth.users where id = a.user_id), 'expires_hours', v_hours);
end;
$$;

-- Refresh-token rotation: the presented token must be the session's current one.
create function public.po_refresh(p_refresh_token text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  s     app.po_sessions;
  a     app.po_accounts;
  v_ref text;
begin
  select * into s from app.po_sessions where id = nullif(split_part(p_refresh_token, '.', 1), '')::uuid for update;
  if not found or s.revoked_at is not null or s.expires_at <= now()
     or s.refresh_hash <> encode(extensions.digest(split_part(p_refresh_token, '.', 2), 'sha256'), 'hex') then
    return jsonb_build_object('ok', false, 'error', 'refresh_token_not_found');
  end if;
  select * into a from app.po_accounts where user_id = s.user_id;
  if a.status <> 'active' then
    update app.po_sessions set revoked_at = now(), revoked_reason = 'account ' || a.status where id = s.id;
    return jsonb_build_object('ok', false, 'error', 'refresh_token_not_found');
  end if;
  v_ref := encode(extensions.gen_random_bytes(32), 'hex');
  update app.po_sessions set refresh_hash = encode(extensions.digest(v_ref, 'sha256'), 'hex'), last_seen_at = now(),
         expires_at = now() + make_interval(hours => app.po_setting(a.farm_id, 'po_session_hours', 12)::int) where id = s.id;
  return jsonb_build_object('ok', true, 'user_id', a.user_id, 'session_id', s.id, 'refresh_token', s.id || '.' || v_ref,
                            'must_change_password', a.must_change_password, 'username', a.username,
                            'email', (select email from auth.users where id = a.user_id));
end;
$$;

create function public.po_sign_out(p_session uuid) returns void
language sql security definer set search_path = public, app, pg_temp
as $$ update app.po_sessions set revoked_at = now(), revoked_reason = 'signed out' where id = p_session and revoked_at is null $$;

-- Session check for the server's /user endpoint.
create function public.po_session_user(p_session uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select jsonb_build_object('user_id', a.user_id, 'username', a.username, 'email', u.email, 'must_change_password', a.must_change_password)
    from app.po_sessions s join app.po_accounts a on a.user_id = s.user_id join auth.users u on u.id = a.user_id
   where s.id = p_session and s.revoked_at is null and s.expires_at > now() and a.status = 'active'
$$;

-- First sign-in with a one-time activation code: the person chooses their own password.
create function public.po_activate(p_login text, p_code text, p_new_password text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare a app.po_accounts;
begin
  select * into a from app.po_accounts where lower(username) = lower(trim(p_login)) for update;
  if not found or a.status <> 'active' or a.activation_code_hash is null or a.activation_expires_at < now()
     or (a.locked_until is not null and a.locked_until > now()) or not app.po_check(upper(trim(p_code)), a.activation_code_hash) then
    if found then
      update app.po_accounts set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= app.po_setting(farm_id, 'po_lockout_attempts', 5)
                                 then now() + make_interval(mins => app.po_setting(farm_id, 'po_lockout_minutes', 15)::int) end
       where user_id = a.user_id;
    end if;
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  perform app.po_password_ok(a.username, p_new_password);
  update app.po_accounts set password_hash = app.po_hash(p_new_password), activation_code_hash = null, activation_expires_at = null,
         must_change_password = false, failed_attempts = 0, locked_until = null where user_id = a.user_id;
  insert into public.ph_access_events (farm_id, target_user_id, event, reason) values (a.farm_id, a.user_id, 'activated', 'One-time code used');
  return jsonb_build_object('ok', true, 'username', a.username);
end;
$$;

revoke all on function public.po_sign_in(text, text, text, text), public.po_refresh(text), public.po_sign_out(uuid),
  public.po_session_user(uuid), public.po_activate(text, text, text) from public, anon, authenticated;
grant execute on function public.po_sign_in(text, text, text, text), public.po_refresh(text), public.po_sign_out(uuid),
  public.po_session_user(uuid), public.po_activate(text, text, text) to po_auth;

-- Signed-in user changes their own password (through the API; required on first use).
create function public.po_change_password(p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare a app.po_accounts;
begin
  select * into a from app.po_accounts where user_id = app.current_user_id() for update;
  if not found then raise exception 'No packhouse account for this sign-in' using errcode = 'P0404'; end if;
  if not app.po_check(p_old, a.password_hash) then
    raise exception 'The current password is not correct' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.password.wrong')::text;
  end if;
  if p_old = p_new then
    raise exception 'Choose a new password' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.password.same')::text;
  end if;
  perform app.po_password_ok(a.username, p_new);
  update app.po_accounts set password_hash = app.po_hash(p_new), must_change_password = false where user_id = a.user_id;
  insert into public.ph_access_events (farm_id, target_user_id, event, reason) values (a.farm_id, a.user_id, 'password_changed', 'By the account holder');
  return jsonb_build_object('ok', true);
end;
$$;

create function public.po_my_account() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select jsonb_build_object('username', a.username, 'must_change_password', a.must_change_password, 'status', a.status)
    from app.po_accounts a where a.user_id = app.current_user_id()
$$;

-- =============================================================================================
-- 4. Pre-request check (PostgREST db-pre-request on the packhouse server)
-- =============================================================================================
create function app.po_pre_request() returns void
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  c     jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_uid uuid := nullif(c ->> 'sub', '')::uuid;
  v_sid uuid := nullif(c ->> 'session_id', '')::uuid;
  a     app.po_accounts;
  v_path text := coalesce(current_setting('request.path', true), '');
begin
  if v_uid is null then return; end if;
  select * into a from app.po_accounts where user_id = v_uid;
  if not found then return; end if;   -- not a packhouse-server account (e.g. hosted Supabase Auth users): their own checks apply
  if a.status <> 'active' then
    raise sqlstate 'PGRST' using message = '{"code":"PO401","message":"Account not active","details":"{\"key\":\"po.session.inactive\"}","hint":null}',
      detail = '{"status":401,"headers":{}}';
  end if;
  if v_sid is null or not exists (select 1 from app.po_sessions s where s.id = v_sid and s.user_id = v_uid and s.revoked_at is null and s.expires_at > now()) then
    raise sqlstate 'PGRST' using message = '{"code":"PO401","message":"Session ended","details":"{\"key\":\"po.session.ended\"}","hint":null}',
      detail = '{"status":401,"headers":{}}';
  end if;
  if a.must_change_password and v_path not in ('/rpc/po_change_password', '/rpc/po_my_account') then
    raise sqlstate 'PGRST' using message = '{"code":"PO403","message":"Change your password first","details":"{\"key\":\"po.password.mustChange\"}","hint":null}',
      detail = '{"status":403,"headers":{}}';
  end if;
end;
$$;
grant execute on function app.po_pre_request() to anon, authenticated;

-- =============================================================================================
-- 5. Account administration (Owner / full administrators, or a manager within a delegation)
-- =============================================================================================
create function app.po_admin_scope(p_farm uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare d public.ph_admin_delegations;
begin
  if app.ph_can(p_farm, 'users.administer') then
    return jsonb_build_object('full', true);
  end if;
  select * into d from public.ph_admin_delegations
   where farm_id = p_farm and manager_user_id = app.current_user_id() and voided_at is null and (valid_to is null or valid_to > now())
   order by created_at desc limit 1;
  if not found then
    raise exception 'Not permitted to manage accounts' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.denied')::text;
  end if;
  return jsonb_build_object('full', false, 'roles', to_jsonb(d.grantable_roles), 'lines', to_jsonb(d.line_ids),
                            'can_create', d.can_create, 'can_reset', d.can_reset, 'can_suspend', d.can_suspend);
end;
$$;

-- A requested role set ([{code, line_id}]) must fit the caller's delegation: only delegated roles, only delegated lines.
create function app.po_check_grant(p_scope jsonb, p_roles jsonb) returns void
language plpgsql stable as $$
declare r jsonb;
begin
  if (p_scope ->> 'full')::boolean then return; end if;
  for r in select * from jsonb_array_elements(coalesce(p_roles, '[]')) loop
    if not (p_scope -> 'roles') ? (r ->> 'code') then
      raise exception 'Role % is outside what was delegated to you', r ->> 'code' using errcode = 'P0403',
        detail = jsonb_build_object('key', 'po.admin.roleNotDelegated', 'role', r ->> 'code')::text;
    end if;
    if jsonb_typeof(p_scope -> 'lines') = 'array' and (nullif(r ->> 'line_id', '') is null or not (p_scope -> 'lines') ? (r ->> 'line_id')) then
      raise exception 'That line scope is outside what was delegated to you' using errcode = 'P0403',
        detail = jsonb_build_object('key', 'po.admin.lineNotDelegated')::text;
    end if;
  end loop;
end;
$$;

create function app.po_user_roles_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', pr.spec_code, 'line_id', ur.ph_line_id) order by pr.spec_code), '[]')
    from public.user_roles ur join public.ph_roles pr on pr.role_id = ur.role_id and pr.voided_at is null
   where ur.user_id = p_user and ur.voided_at is null and (ur.valid_to is null or ur.valid_to > now())
$$;

create function app.po_active_owners(p_farm uuid) returns integer
language sql stable security definer set search_path = public, app, pg_temp
as $$
  select count(distinct ur.user_id)::int from public.user_roles ur join public.ph_roles pr on pr.role_id = ur.role_id and pr.spec_code = 'OWN'
    left join app.po_accounts a on a.user_id = ur.user_id
   where ur.farm_id = p_farm and ur.voided_at is null and (ur.valid_to is null or ur.valid_to > now()) and coalesce(a.status, 'active') = 'active'
$$;

-- The target must be within the caller's reach: never the caller themself; a delegated manager reaches only accounts whose
-- current roles all lie inside the delegation.
create function app.po_check_target(p_scope jsonb, p_user uuid) returns void
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
begin
  if p_user = app.current_user_id() then
    raise exception 'You cannot change your own access' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.self')::text;
  end if;
  if not (p_scope ->> 'full')::boolean then
    perform app.po_check_grant(p_scope, app.po_user_roles_json(p_user));
  end if;
end;
$$;

create function app.po_set_roles(p_farm uuid, p_user uuid, p_roles jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare r jsonb;
begin
  perform set_config('app.in_void', 'on', true);
  update public.user_roles ur set voided_at = now(), voided_by = app.current_user_id(), void_reason = p_reason
   where ur.user_id = p_user and ur.farm_id = p_farm and ur.voided_at is null
     and ur.role_id in (select role_id from public.ph_roles where farm_id = p_farm);
  perform set_config('app.in_void', 'off', true);
  for r in select * from jsonb_array_elements(coalesce(p_roles, '[]')) loop
    if not exists (select 1 from public.ph_roles where farm_id = p_farm and spec_code = r ->> 'code' and voided_at is null) then
      raise exception 'Unknown role %', r ->> 'code' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.admin.unknownRole', 'role', r ->> 'code')::text;
    end if;
    insert into public.user_roles (farm_id, user_id, role_id, ph_line_id, valid_from)
    values (p_farm, p_user, (select role_id from public.ph_roles where farm_id = p_farm and spec_code = r ->> 'code' and voided_at is null),
            nullif(r ->> 'line_id', '')::uuid, now());
  end loop;
end;
$$;

create function app.po_insert_auth_user(p_id uuid, p_email text) returns void
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare v_cols text[] := array(select column_name::text from information_schema.columns where table_schema = 'auth' and table_name = 'users');
begin
  -- Hosted / GoTrue auth.users has token columns that must not be null; the packhouse server's own auth.users does not.
  if 'confirmation_token' = any (v_cols) then
    execute 'insert into auth.users (id, email, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
             values ($1, $2, ''authenticated'', ''authenticated'', '''', '''', '''', '''', now(), now())' using p_id, p_email;
  else
    insert into auth.users (id, email) values (p_id, p_email);
  end if;
end;
$$;

-- Create an account: username, name, optional company e-mail, roles with line scope, and how the person gets in: a temporary
-- password (changed on first use) or a one-time activation code. The secret is returned once and never stored in clear.
create function public.ph_admin_create_account(p jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_seen   jsonb := app.ph_request_seen(p_request_id, 'ph_admin_create_account');
  v_farm   uuid := app.ph_farm_of_user();
  v_scope  jsonb;
  v_id     uuid := gen_random_uuid();
  v_user   text := lower(trim(p ->> 'username'));
  v_secret text;
  v_method text := coalesce(p ->> 'method', 'activation_code');
begin
  if v_seen is not null then return v_seen - 'secret' || jsonb_build_object('secret_already_shown', true); end if;
  if v_farm is null then raise exception 'Not a packhouse user' using errcode = 'P0403'; end if;
  v_scope := app.po_admin_scope(v_farm);
  if not (v_scope ->> 'full')::boolean and not (v_scope ->> 'can_create')::boolean then
    raise exception 'Account creation was not delegated to you' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.createNotDelegated')::text;
  end if;
  perform app.po_check_grant(v_scope, p -> 'roles');
  if v_user !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    raise exception 'Usernames are 3–32 lowercase letters, digits, dot, dash or underscore' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.admin.username')::text;
  end if;
  if exists (select 1 from app.po_accounts where lower(username) = v_user) then
    raise exception 'That username is taken' using errcode = 'P0409', detail = jsonb_build_object('key', 'po.admin.usernameTaken')::text;
  end if;
  if coalesce(trim(p ->> 'full_name'), '') = '' then
    raise exception 'Enter the person''s name' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.admin.name')::text;
  end if;
  if (p -> 'roles') @> '[{"code":"OWN"}]' and not app.ph_can(v_farm, 'users.manage_roles') then
    raise exception 'Only an Owner makes another Owner' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.ownerOnly')::text;
  end if;
  perform app.po_insert_auth_user(v_id, nullif(lower(trim(p ->> 'email')), ''));
  insert into public.user_profiles (id, farm_id, full_name, full_name_en) values (v_id, v_farm, trim(p ->> 'full_name'), nullif(trim(p ->> 'full_name_en'), ''));
  if v_method = 'temp_password' then
    v_secret := app.po_secret(10);
    insert into app.po_accounts (user_id, farm_id, username, password_hash, must_change_password, created_by)
    values (v_id, v_farm, v_user, app.po_hash(v_secret), true, app.current_user_id());
  else
    v_secret := app.po_secret(8);
    insert into app.po_accounts (user_id, farm_id, username, activation_code_hash, activation_expires_at, must_change_password, created_by)
    values (v_id, v_farm, v_user, app.po_hash(upper(v_secret)), now() + make_interval(hours => app.po_setting(v_farm, 'po_activation_hours', 72)::int), true,
            app.current_user_id());
    v_secret := upper(v_secret);
  end if;
  perform app.po_set_roles(v_farm, v_id, p -> 'roles', 'Account created');
  insert into public.ph_access_events (farm_id, target_user_id, event, after, reason)
  values (v_farm, v_id, 'account_created', jsonb_build_object('username', v_user, 'roles', p -> 'roles', 'method', v_method), nullif(trim(p ->> 'reason'), ''));
  return app.ph_request_done(p_request_id, 'ph_admin_create_account', v_farm, jsonb_build_object('user_id', v_id, 'username', v_user, 'method', v_method))
         || jsonb_build_object('secret', v_secret);
end;
$$;

create function public.ph_admin_set_roles(p_user uuid, p_roles jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm   uuid := app.ph_farm_of_user();
  v_scope  jsonb := app.po_admin_scope(v_farm);
  v_before jsonb := app.po_user_roles_json(p_user);
begin
  perform app.po_check_target(v_scope, p_user);
  perform app.po_check_grant(v_scope, p_roles);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if (p_roles @> '[{"code":"OWN"}]') <> (v_before @> '[{"code":"OWN"}]') and not app.ph_can(v_farm, 'users.manage_roles') then
    raise exception 'Only an Owner grants or removes the Owner role' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.ownerOnly')::text;
  end if;
  if v_before @> '[{"code":"OWN"}]' and not p_roles @> '[{"code":"OWN"}]' and app.po_active_owners(v_farm) <= 1 then
    raise exception 'The last Owner cannot be removed' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.admin.lastOwner')::text;
  end if;
  perform app.po_set_roles(v_farm, p_user, p_roles, p_reason);
  insert into public.ph_access_events (farm_id, target_user_id, event, before, after, reason)
  values (v_farm, p_user, 'roles_changed', v_before, app.po_user_roles_json(p_user), p_reason);
  return jsonb_build_object('user_id', p_user, 'roles', app.po_user_roles_json(p_user));
end;
$$;

create function public.ph_admin_account_step(p_user uuid, p_step text, p_reason text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm   uuid := app.ph_farm_of_user();
  v_scope  jsonb := app.po_admin_scope(v_farm);
  a        app.po_accounts;
  v_secret text;
  v_n      integer;
begin
  perform app.po_check_target(v_scope, p_user);
  select * into a from app.po_accounts where user_id = p_user and farm_id = v_farm for update;
  if not found then raise exception 'Account not found' using errcode = 'P0404'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if p_step in ('suspend', 'archive') then
    if not (v_scope ->> 'full')::boolean and not (v_scope ->> 'can_suspend')::boolean then
      raise exception 'Not delegated to you' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.notDelegated')::text;
    end if;
    if app.po_user_roles_json(p_user) @> '[{"code":"OWN"}]' and app.po_active_owners(v_farm) <= 1 then
      raise exception 'The last Owner cannot be suspended or archived' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.admin.lastOwner')::text;
    end if;
    update app.po_accounts set status = case p_step when 'suspend' then 'suspended' else 'archived' end, status_reason = p_reason where user_id = p_user;
    update app.po_sessions set revoked_at = now(), revoked_reason = p_step where user_id = p_user and revoked_at is null;
    if p_step = 'archive' then
      -- History stays attributable: the profile, roles and every record keep the person; roles end now.
      update public.user_roles set valid_to = now()
       where user_id = p_user and voided_at is null and valid_from < now() and (valid_to is null or valid_to > now());
      perform set_config('app.in_void', 'on', true);
      update public.user_roles set voided_at = now(), voided_by = app.current_user_id(), void_reason = 'Account archived: ' || p_reason
       where user_id = p_user and voided_at is null and valid_from >= now();
      perform set_config('app.in_void', 'off', true);
    end if;
  elsif p_step = 'reactivate' then
    if not (v_scope ->> 'full')::boolean and not (v_scope ->> 'can_suspend')::boolean then
      raise exception 'Not delegated to you' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.notDelegated')::text;
    end if;
    if a.status = 'archived' then
      raise exception 'An archived account stays archived; create a new account' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.admin.archived')::text;
    end if;
    update app.po_accounts set status = 'active', status_reason = p_reason, failed_attempts = 0, locked_until = null where user_id = p_user;
  elsif p_step = 'reset' then
    if not (v_scope ->> 'full')::boolean and not (v_scope ->> 'can_reset')::boolean then
      raise exception 'Not delegated to you' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.notDelegated')::text;
    end if;
    if a.status = 'archived' then
      raise exception 'An archived account cannot be reset' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.admin.archived')::text;
    end if;
    v_secret := upper(app.po_secret(8));
    update app.po_accounts set password_hash = null, activation_code_hash = app.po_hash(v_secret),
           activation_expires_at = now() + make_interval(hours => app.po_setting(v_farm, 'po_activation_hours', 72)::int),
           must_change_password = true, failed_attempts = 0, locked_until = null where user_id = p_user;
    update app.po_sessions set revoked_at = now(), revoked_reason = 'access reset' where user_id = p_user and revoked_at is null;
  elsif p_step = 'revoke_sessions' then
    update app.po_sessions set revoked_at = now(), revoked_reason = p_reason where user_id = p_user and revoked_at is null;
    get diagnostics v_n = row_count;
  else
    raise exception 'Unknown step' using errcode = 'P0422';
  end if;
  insert into public.ph_access_events (farm_id, target_user_id, event, before, after, reason)
  values (v_farm, p_user, 'account_' || p_step, jsonb_build_object('status', a.status), jsonb_build_object('status', (select status from app.po_accounts where user_id = p_user)), p_reason);
  return jsonb_build_object('user_id', p_user, 'step', p_step, 'sessions_revoked', v_n) || case when v_secret is not null then jsonb_build_object('secret', v_secret) else '{}' end;
end;
$$;

create function public.ph_admin_set_override(p_user uuid, p_action text, p_effect text, p_line uuid, p_reason text, p_valid_to timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm  uuid := app.ph_farm_of_user();
  v_scope jsonb := app.po_admin_scope(v_farm);
  v_id    uuid := gen_random_uuid();
begin
  -- Individual overrides are for full account administrators (the Owner); a delegation covers roles only.
  if not (v_scope ->> 'full')::boolean then
    raise exception 'Individual permission overrides are not delegated' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.notDelegated')::text;
  end if;
  perform app.po_check_target(v_scope, p_user);
  if p_effect not in ('grant', 'deny') then raise exception 'grant or deny' using errcode = 'P0422'; end if;
  if not exists (select 1 from public.ph_actions where farm_id = v_farm and action_key = p_action and voided_at is null) then
    raise exception 'Unknown action' using errcode = 'P0422';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  insert into public.ph_user_overrides (id, farm_id, user_id, action_key, effect, line_id, valid_to, reason)
  values (v_id, v_farm, p_user, p_action, p_effect, p_line, p_valid_to, p_reason);
  insert into public.ph_access_events (farm_id, target_user_id, event, after, reason)
  values (v_farm, p_user, 'override_set', jsonb_build_object('action', p_action, 'effect', p_effect, 'line_id', p_line, 'valid_to', p_valid_to), p_reason);
  return jsonb_build_object('id', v_id);
end;
$$;

create function public.ph_admin_remove_override(p_override uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  o       public.ph_user_overrides;
  v_scope jsonb;
begin
  select * into o from public.ph_user_overrides where id = p_override and voided_at is null for update;
  if not found then raise exception 'Override not found' using errcode = 'P0404'; end if;
  v_scope := app.po_admin_scope(o.farm_id);
  if not (v_scope ->> 'full')::boolean then raise exception 'Not delegated' using errcode = 'P0403'; end if;
  perform app.po_check_target(v_scope, o.user_id);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  perform set_config('app.in_void', 'on', true);
  update public.ph_user_overrides set voided_at = now(), voided_by = app.current_user_id(), void_reason = p_reason where id = o.id;
  perform set_config('app.in_void', 'off', true);
  insert into public.ph_access_events (farm_id, target_user_id, event, before, reason)
  values (o.farm_id, o.user_id, 'override_removed', to_jsonb(o) - 'farm_id', p_reason);
  return jsonb_build_object('id', o.id, 'removed', true);
end;
$$;

-- Owner: delegate limited account management to a manager.
create function public.ph_admin_set_delegation(p_manager uuid, p jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  v_id   uuid := gen_random_uuid();
  v_before jsonb;
begin
  perform app.ph_authorize(v_farm, 'users.delegate');
  if p_manager = app.current_user_id() then
    raise exception 'You cannot delegate to yourself' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.self')::text;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if (p -> 'roles') ? 'OWN' then
    raise exception 'The Owner role is never delegated' using errcode = 'P0403', detail = jsonb_build_object('key', 'po.admin.ownerOnly')::text;
  end if;
  select to_jsonb(d) - 'farm_id' into v_before from public.ph_admin_delegations d where manager_user_id = p_manager and voided_at is null limit 1;
  perform set_config('app.in_void', 'on', true);
  update public.ph_admin_delegations set voided_at = now(), voided_by = app.current_user_id(), void_reason = 'Replaced: ' || p_reason
   where manager_user_id = p_manager and voided_at is null;
  perform set_config('app.in_void', 'off', true);
  if coalesce((p ->> 'revoke')::boolean, false) is false then
    insert into public.ph_admin_delegations (id, farm_id, manager_user_id, grantable_roles, line_ids, can_create, can_reset, can_suspend, valid_to, reason)
    values (v_id, v_farm, p_manager, coalesce(array(select jsonb_array_elements_text(p -> 'roles')), '{}'),
            case when jsonb_typeof(p -> 'line_ids') = 'array' then array(select (jsonb_array_elements_text(p -> 'line_ids'))::uuid) end,
            coalesce((p ->> 'can_create')::boolean, false), coalesce((p ->> 'can_reset')::boolean, false), coalesce((p ->> 'can_suspend')::boolean, false),
            nullif(p ->> 'valid_to', '')::timestamptz, p_reason);
  end if;
  insert into public.ph_access_events (farm_id, target_user_id, event, before, after, reason)
  values (v_farm, p_manager, 'delegation_set', v_before, p, p_reason);
  return jsonb_build_object('id', v_id);
end;
$$;

-- Owner: create a custom role (empty, or cloned from another role) and set its permissions.
create function public.ph_admin_save_role(p jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm  uuid := app.ph_farm_of_user();
  v_code  text := upper(trim(p ->> 'code'));
  v_role  uuid;
  v_from  text := nullif(upper(trim(p ->> 'clone_from')), '');
  v_new   boolean := false;
  v_before jsonb;
  k       text;
begin
  perform app.ph_authorize(v_farm, 'users.manage_roles');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if v_code !~ '^[A-Z][A-Z0-9_]{1,15}$' then
    raise exception 'Role codes are 2–16 capital letters, digits or underscore' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.role.code')::text;
  end if;
  if v_code = 'OWN' then raise exception 'The Owner role is fixed' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.role.fixed')::text; end if;
  if not exists (select 1 from public.ph_roles where farm_id = v_farm and spec_code = v_code and voided_at is null) then
    if coalesce(trim(p ->> 'name_ar'), '') = '' then raise exception 'Enter the Arabic name' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.role.name')::text; end if;
    insert into public.roles (farm_id, code, name_ar, name_en) values (v_farm, 'ph_' || lower(v_code), trim(p ->> 'name_ar'), nullif(trim(p ->> 'name_en'), ''))
    returning id into v_role;
    insert into public.ph_roles (farm_id, role_id, spec_code, department_text, reporting_line, evidence, source, system_use, sort_order, is_custom, cloned_from)
    values (v_farm, v_role, v_code, coalesce(nullif(trim(p ->> 'department'), ''), 'Not stated'), 'Not stated', 'O', 'Owner-created role', coalesce(p ->> 'purpose', ''), 100, true, v_from);
    v_new := true;
  elsif not (select is_custom from public.ph_roles where farm_id = v_farm and spec_code = v_code and voided_at is null) then
    raise exception 'Specification roles keep their cells; clone them into a custom role to change them' using errcode = 'P0422',
      detail = jsonb_build_object('key', 'po.role.specRole')::text;
  end if;
  select coalesce(jsonb_agg(action_key order by action_key), '[]') into v_before from public.ph_permission_cells
   where farm_id = v_farm and spec_code = v_code and voided_at is null and state = 'active';
  perform set_config('app.in_void', 'on', true);
  update public.ph_permission_cells set voided_at = now(), voided_by = app.current_user_id(), void_reason = 'Role edited: ' || p_reason
   where farm_id = v_farm and spec_code = v_code and voided_at is null;
  perform set_config('app.in_void', 'off', true);
  for k in select distinct x from (
             select jsonb_array_elements_text(coalesce(p -> 'actions', '[]')) x
             union all
             -- Cloning copies the source role's usable cells (active or, where proposals are in effect, proposed).
             select c.action_key from public.ph_permission_cells c
              where v_new and v_from is not null and c.farm_id = v_farm and c.spec_code = v_from and c.voided_at is null
                and (c.state = 'active' or (c.state = 'proposed' and app.ph_proposals_in_effect(v_farm)))) q loop
    if not exists (select 1 from public.ph_actions where farm_id = v_farm and action_key = k and voided_at is null) then
      raise exception 'Unknown action %', k using errcode = 'P0422';
    end if;
    -- Quality decisions and releases stay with QC / QA roles (rule 4): a custom role may hold them only when cloned from QC/QA.
    if (select category from public.ph_actions where farm_id = v_farm and action_key = k) = 'quality'
       and coalesce(v_from, '') not in ('QCI', 'QCM', 'QAO', 'QAM') and k not like '%.view'
       and not exists (select 1 from public.ph_permission_cells c where c.farm_id = v_farm and c.spec_code = v_from and c.action_key = k
                        and c.voided_at is null and c.state <> 'disabled') then
      raise exception 'Quality decisions stay with the quality team; clone a QC / QA role to give them' using errcode = 'P0422',
        detail = jsonb_build_object('key', 'po.role.quality', 'action', k)::text;
    end if;
    insert into public.ph_permission_cells (farm_id, action_key, spec_code, evidence, state, basis, note)
    values (v_farm, k, v_code, 'O', 'active', 'O', 'Owner decision: ' || p_reason);
  end loop;
  insert into public.ph_access_events (farm_id, event, before, after, reason)
  values (v_farm, case when v_new then 'role_created' else 'role_cells_changed' end, jsonb_build_object('role', v_code, 'actions', v_before),
          jsonb_build_object('role', v_code, 'actions', (select coalesce(jsonb_agg(action_key order by action_key), '[]') from public.ph_permission_cells
                                                         where farm_id = v_farm and spec_code = v_code and voided_at is null)), p_reason);
  return jsonb_build_object('code', v_code, 'created', v_new);
end;
$$;

-- Owner decision on a permission cell (activate an NYV / proposed cell, or disable one), recorded with a reason (CLAUDE.md:
-- P and NYV become rules only through an approval or a recorded decision).
create function public.ph_owner_cell_decision(p_cell uuid, p_state text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare c public.ph_permission_cells;
begin
  select * into c from public.ph_permission_cells where id = p_cell and voided_at is null for update;
  if not found then raise exception 'Cell not found' using errcode = 'P0404'; end if;
  perform app.ph_authorize(c.farm_id, 'settings.authority');
  if p_state not in ('active', 'disabled') then raise exception 'active or disabled' using errcode = 'P0422'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.reasonRequired')::text; end if;
  if p_state = 'active' and (select category from public.ph_actions where farm_id = c.farm_id and action_key = c.action_key) = 'quality'
     and c.spec_code not in ('QCI', 'QCM', 'QAO', 'QAM') then
    raise exception 'Quality decisions stay with the quality team' using errcode = 'P0422', detail = jsonb_build_object('key', 'po.role.quality', 'action', c.action_key)::text;
  end if;
  perform set_config('app.audit_comment', p_reason, true);
  update public.ph_permission_cells set state = p_state, basis = 'O-' || c.evidence, resolved_by = app.current_user_id(), resolved_at = now() where id = c.id;
  perform set_config('app.audit_comment', '', true);
  insert into public.ph_access_events (farm_id, event, before, after, reason)
  values (c.farm_id, 'cell_decision', jsonb_build_object('action', c.action_key, 'role', c.spec_code, 'state', c.state, 'evidence', c.evidence),
          jsonb_build_object('action', c.action_key, 'role', c.spec_code, 'state', p_state), p_reason);
  return jsonb_build_object('id', c.id, 'state', p_state);
end;
$$;

-- =============================================================================================
-- 6. Read models: accounts, effective access (actual or preview), access audit
-- =============================================================================================
create function public.ph_admin_accounts() returns table (user_id uuid, username text, full_name text, email text, status text,
  must_change_password boolean, last_sign_in_at timestamptz, roles jsonb, active_sessions integer, locked boolean, created_at timestamptz,
  manageable boolean)
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm  uuid := app.ph_farm_of_user();
  v_scope jsonb := app.po_admin_scope(v_farm);
begin
  return query
  select a.user_id, a.username, p.full_name, u.email, a.status, a.must_change_password, a.last_sign_in_at,
         (select coalesce(jsonb_agg(jsonb_build_object('code', pr.spec_code, 'line_id', ur.ph_line_id, 'line_code', l.code) order by pr.spec_code), '[]')
            from public.user_roles ur join public.ph_roles pr on pr.role_id = ur.role_id left join public.ph_lines l on l.id = ur.ph_line_id
           where ur.user_id = a.user_id and ur.voided_at is null and (ur.valid_to is null or ur.valid_to > now())),
         (select count(*)::int from app.po_sessions s where s.user_id = a.user_id and s.revoked_at is null and s.expires_at > now()),
         coalesce(a.locked_until > now(), false), a.created_at,
         a.user_id <> app.current_user_id() and ((v_scope ->> 'full')::boolean
           or not exists (select 1 from jsonb_array_elements(app.po_user_roles_json(a.user_id)) r
                           where not (v_scope -> 'roles') ? (r ->> 'code')
                              or (jsonb_typeof(v_scope -> 'lines') = 'array' and not (v_scope -> 'lines') ? coalesce(r ->> 'line_id', ''))))
    from app.po_accounts a join public.user_profiles p on p.id = a.user_id join auth.users u on u.id = a.user_id
   where a.farm_id = v_farm
   order by a.status, a.username;
end;
$$;

-- What a set of roles (with line scope) and overrides allows, action by action, with the source of each permission.
create function app.po_access_from(p_farm uuid, p_roles jsonb, p_overrides jsonb) returns table (action_key text, label_en text, label_ar text,
  category text, scope_kind text, allowed boolean, all_lines boolean, line_ids uuid[], sources jsonb)
language sql stable security definer set search_path = public, app, pg_temp
as $$
  with r as (select x ->> 'code' as code, nullif(x ->> 'line_id', '')::uuid as line_id from jsonb_array_elements(coalesce(p_roles, '[]')) x),
  o as (select x ->> 'action_key' as action_key, x ->> 'effect' as effect, nullif(x ->> 'line_id', '')::uuid as line_id
          from jsonb_array_elements(coalesce(p_overrides, '[]')) x),
  grants as (
    select c.action_key, r.line_id, jsonb_build_object('source', 'role', 'role', r.code, 'line_id', r.line_id, 'cell', c.state, 'evidence', c.evidence) as src
      from r join public.ph_permission_cells c on c.farm_id = p_farm and c.spec_code = r.code and c.voided_at is null
     where c.state = 'active' or (c.state = 'proposed' and app.ph_proposals_in_effect(p_farm))
    union all
    select o.action_key, o.line_id, jsonb_build_object('source', 'override', 'effect', 'grant', 'line_id', o.line_id) from o where o.effect = 'grant'
  ),
  denies as (select action_key, line_id from o where effect = 'deny')
  select a.action_key, a.label_en, a.label_ar, a.category, a.scope_kind,
         exists (select 1 from grants g where g.action_key = a.action_key)
           and not exists (select 1 from denies d where d.action_key = a.action_key and d.line_id is null),
         exists (select 1 from grants g where g.action_key = a.action_key and (g.line_id is null or a.scope_kind = 'farm'))
           and not exists (select 1 from denies d where d.action_key = a.action_key),
         array(select distinct g.line_id from grants g where g.action_key = a.action_key and g.line_id is not null
                 and not exists (select 1 from denies d where d.action_key = a.action_key and (d.line_id is null or d.line_id = g.line_id))),
         coalesce((select jsonb_agg(g.src) from grants g where g.action_key = a.action_key), '[]')
           || coalesce((select jsonb_agg(jsonb_build_object('source', 'override', 'effect', 'deny', 'line_id', d.line_id)) from denies d where d.action_key = a.action_key), '[]')
    from public.ph_actions a
   where a.farm_id = p_farm and a.voided_at is null
   order by a.sort_order, a.action_key
$$;

create function public.ph_effective_access(p_user uuid, p_preview jsonb default null) returns table (action_key text, label_en text, label_ar text,
  category text, scope_kind text, allowed boolean, all_lines boolean, line_ids uuid[], sources jsonb)
language plpgsql stable security definer set search_path = public, app, pg_temp
as $$
declare
  v_farm uuid := app.ph_farm_of_user();
  v_roles jsonb;
  v_over  jsonb;
begin
  if p_user <> app.current_user_id() then
    perform app.po_admin_scope(v_farm);
  end if;
  v_roles := coalesce(p_preview -> 'roles', app.po_user_roles_json(p_user));
  v_over := coalesce(p_preview -> 'overrides', (select coalesce(jsonb_agg(jsonb_build_object('action_key', o.action_key, 'effect', o.effect, 'line_id', o.line_id)), '[]')
                                                  from public.ph_user_overrides o where o.user_id = p_user and o.voided_at is null
                                                   and o.valid_from <= now() and (o.valid_to is null or o.valid_to > now())));
  return query select * from app.po_access_from(v_farm, v_roles, v_over);
end;
$$;

create function app.po_username(p_user uuid) returns text
language sql stable security definer set search_path = public, app, pg_temp
as $$ select username from app.po_accounts where user_id = p_user $$;

create view public.ph_access_log with (security_invoker = true) as
  select e.id, e.farm_id, e.created_at, e.event, e.target_user_id, tp.full_name as target_name,
         app.po_username(e.target_user_id) as target_username,
         e.created_by as actor_user_id, ap.full_name as actor_name, e.before, e.after, e.reason
    from public.ph_access_events e
    left join public.user_profiles tp on tp.id = e.target_user_id
    left join public.user_profiles ap on ap.id = e.created_by
   where e.voided_at is null;

create policy ph_access_events_select on public.ph_access_events for select to authenticated
  using (app.ph_can(farm_id, 'users.administer') or app.ph_can(farm_id, 'audit.view') or target_user_id = app.current_user_id());
create policy ph_admin_delegations_select on public.ph_admin_delegations for select to authenticated
  using (app.ph_can(farm_id, 'users.administer') or manager_user_id = app.current_user_id());

-- =============================================================================================
-- 7. First Owner on a new instance (launcher only): one-time activation code, delivered on the host
-- =============================================================================================
create function public.po_bootstrap_owner(p_farm uuid, p_username text, p_full_name text) returns text
language plpgsql security definer set search_path = public, app, pg_temp
as $$
declare
  v_id     uuid := gen_random_uuid();
  v_secret text := upper(app.po_secret(10));
begin
  if app.po_active_owners(p_farm) > 0 then
    raise exception 'This instance already has an Owner' using errcode = 'P0422';
  end if;
  perform app.seed_po_identity(p_farm);
  perform app.po_insert_auth_user(v_id, null);
  perform set_config('app.acting_user_id', v_id::text, true);
  insert into public.user_profiles (id, farm_id, full_name) values (v_id, p_farm, p_full_name);
  insert into app.po_accounts (user_id, farm_id, username, activation_code_hash, activation_expires_at, must_change_password)
  values (v_id, p_farm, lower(p_username), app.po_hash(v_secret), now() + interval '30 days', true);
  insert into public.user_roles (farm_id, user_id, role_id, valid_from)
  values (p_farm, v_id, (select role_id from public.ph_roles where farm_id = p_farm and spec_code = 'OWN'), now());
  insert into public.ph_access_events (farm_id, target_user_id, event, after, reason)
  values (p_farm, v_id, 'owner_bootstrapped', jsonb_build_object('username', lower(p_username)), 'Instance initialised by the launcher');
  return v_secret;
end;
$$;
revoke all on function public.po_bootstrap_owner(uuid, text, text) from public, anon, authenticated;

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
end $$;

select app.seed_po_identity(id) from public.farms;
select app.apply_api_grants();
-- Credentials functions run as their owner; the API roles never call them directly.
revoke all on function public.po_sign_in(text, text, text, text), public.po_refresh(text), public.po_sign_out(uuid),
  public.po_session_user(uuid), public.po_activate(text, text, text), public.po_bootstrap_owner(uuid, text, text) from anon, authenticated;
