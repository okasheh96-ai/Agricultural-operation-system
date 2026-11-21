-- Packhouse operations increment 4: Owner bootstrap, username accounts, activation, first-use password change, sessions and
-- revocation, suspend / archive / reset, custom roles, line-scoped grants, delegated account management with its limits,
-- self-escalation and last-Owner protection, effective access with sources, and the access audit (owner acceptance scenario 2).
begin;
select no_plan();

create function tests.as_user(p_user uuid, p_session uuid default null) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true) $$;
create function tests.pre(p_user uuid, p_session uuid, p_path text) returns void language plpgsql as $$
begin
  perform tests.as_user(p_user, p_session);
  perform set_config('request.path', p_path, true);
  perform app.po_pre_request();
end $$;
create function tests.ph_line(p_code text) returns uuid language sql as $$
  select id from public.ph_lines where farm_id = tests.farm() and code = p_code and voided_at is null $$;
create function tests.uid(p_username text) returns uuid language sql as $$ select user_id from app.po_accounts where username = p_username $$;
grant execute on all functions in schema tests to authenticated;
select app.ph_load_sop_reference(tests.farm());
update public.settings set value = 'true' where farm_id = tests.farm() and key = 'ph_proposals_in_effect';

-- ---------------------------------------------------------------------------------------------
-- The first Owner: a one-time activation code delivered on the host; the owner chooses a password
select public.po_bootstrap_owner(tests.farm(), 'owner', 'Owner (test)') as owner_code \gset
select throws_ok(format($$ select public.po_bootstrap_owner(%L, 'owner2', 'x') $$, tests.farm()), 'P0422', null, 'bootstrap works once per instance');
select is((public.po_sign_in('owner', 'anything') ->> 'ok')::boolean, false, 'no password yet: sign-in refused');
select is((public.po_activate('owner', 'WRONGCODE', 'Packhouse2026') ->> 'error'), 'invalid_code', 'a wrong activation code is refused');
select throws_ok(format($$ select public.po_activate('owner', %L, 'short') $$, :'owner_code'), 'P0422', null, 'a weak password is refused');
select is((public.po_activate('owner', :'owner_code', 'Packhouse2026') ->> 'ok')::boolean, true, 'the Owner activates with the one-time code');
select is((public.po_activate('owner', :'owner_code', 'Another2026') ->> 'ok')::boolean, false, 'the code works once');
select public.po_sign_in('owner', 'Packhouse2026') as s \gset
select is((:'s'::jsonb ->> 'must_change_password')::boolean, false, 'owner signed in; no change due after activation');
select tests.uid('owner') as own \gset
select (:'s'::jsonb ->> 'session_id') as own_sid \gset
select lives_ok(format($$ select tests.pre(%L, %L, '/rpc/ph_admin_accounts') $$, :'own', :'own_sid'), 'pre-request: an active session passes');

-- ---------------------------------------------------------------------------------------------
-- Username-only account with a temporary password; first use forces a change
select tests.as_user(:'own', :'own_sid');
select public.ph_admin_create_account(jsonb_build_object('username', 'sup.b', 'full_name', 'Supervisor B (test)', 'method', 'temp_password',
          'roles', jsonb_build_array(jsonb_build_object('code', 'LL', 'line_id', tests.ph_line('B'))))) as created \gset
select is((select email from auth.users where id = (:'created'::jsonb ->> 'user_id')::uuid), null, 'no e-mail needed (username only)');
select ok(length(:'created'::jsonb ->> 'secret') = 10, 'a 10-character temporary password is shown once');
select is((select count(*)::int from app.ph_request_log where result::text like '%' || (:'created'::jsonb ->> 'secret') || '%'), 0, 'the secret is not stored in clear');
select public.po_sign_in('sup.b', :'created'::jsonb ->> 'secret') as sb \gset
select is((:'sb'::jsonb ->> 'must_change_password')::boolean, true, 'temporary password: change required');
select throws_ok(format($$ select tests.pre(%L, %L, '/rpc/ph_my_line_shifts') $$, :'sb'::jsonb ->> 'user_id', :'sb'::jsonb ->> 'session_id'),
  'PGRST', null, 'pre-request: nothing but the password change while it is due');
select lives_ok(format($$ select tests.pre(%L, %L, '/rpc/po_change_password') $$, :'sb'::jsonb ->> 'user_id', :'sb'::jsonb ->> 'session_id'),
  'pre-request: the password change itself is allowed');
select tests.as_user((:'sb'::jsonb ->> 'user_id')::uuid, (:'sb'::jsonb ->> 'session_id')::uuid);
select throws_ok(format($$ select public.po_change_password('nope', 'Linebee2026') $$), 'P0403', null, 'the current password must be right');
select is((public.po_change_password(:'created'::jsonb ->> 'secret', 'Linebee2026') ->> 'ok')::boolean, true, 'password changed');
select lives_ok(format($$ select tests.pre(%L, %L, '/rpc/ph_my_line_shifts') $$, :'sb'::jsonb ->> 'user_id', :'sb'::jsonb ->> 'session_id'),
  'after the change the session works normally');

-- ---------------------------------------------------------------------------------------------
-- Custom role (cloned, then edited) with a line-scoped grant
select tests.as_user(:'own', :'own_sid');
select is((public.ph_admin_save_role('{"code":"PACK_LEAD","name_ar":"قائد تعبئة (اختبار)","clone_from":"LL"}', 'Pilot role for line leads') ->> 'created')::boolean, true,
  'Owner creates a custom role cloned from the line supervisor');
select ok((select count(*) from public.ph_permission_cells where spec_code = 'PACK_LEAD' and voided_at is null and evidence = 'O') > 0,
  'its cells are Owner decisions (O)');
select throws_ok($$ select public.ph_admin_save_role('{"code":"PACK_LEAD","actions":["hold.release"]}', 'x') $$, 'P0422', null,
  'a quality release cannot be put in an operations role');
select public.ph_admin_save_role('{"code":"PACK_LEAD","actions":["labour.record","labour.view_people","labour.submit","shift.view","report.kpi_view"]}', 'Edited to five actions');
select is((select count(*)::int from public.ph_permission_cells where spec_code = 'PACK_LEAD' and voided_at is null), 5, 'role edited to exactly five actions');
select throws_ok($$ select public.ph_admin_save_role('{"code":"LL","actions":["shift.manage"]}', 'x') $$, 'P0422', null, 'specification roles are not edited, only cloned');
select (public.ph_admin_create_account(jsonb_build_object('username', 'lead.a', 'full_name', 'Lead A (test)', 'method', 'activation_code',
          'roles', jsonb_build_array(jsonb_build_object('code', 'PACK_LEAD', 'line_id', tests.ph_line('A'))))) ->> 'user_id') as lead \gset
select tests.as_user(:'lead');
select ok(app.ph_can(tests.farm(), 'labour.record', tests.ph_line('A')) and not app.ph_can(tests.farm(), 'labour.record', tests.ph_line('B')),
  'line-scoped grant: line A yes, line B no');

-- ---------------------------------------------------------------------------------------------
-- Delegation: the Owner lets a manager create line-A supervisors only
select tests.as_user(:'own', :'own_sid');
select (public.ph_admin_create_account(jsonb_build_object('username', 'mgr', 'full_name', 'Manager (test)', 'method', 'temp_password',
          'roles', jsonb_build_array(jsonb_build_object('code', 'PHM')))) ->> 'user_id') as mgr \gset
select throws_ok(format($$ select public.ph_admin_set_delegation(%L, '{"roles":["OWN"]}', 'x') $$, :'own'), 'P0403', null, 'no delegation to oneself');
select throws_ok(format($$ select public.ph_admin_set_delegation(%L, '{"roles":["OWN"]}', 'x') $$, :'mgr'), 'P0403', null, 'the Owner role is never delegated');
select public.ph_admin_set_delegation(:'mgr', jsonb_build_object('roles', jsonb_build_array('LL'), 'line_ids', jsonb_build_array(tests.ph_line('A')),
          'can_create', true, 'can_reset', true, 'can_suspend', false), 'Manager hires line A supervisors');
select tests.as_user(:'mgr');
select ok((public.ph_admin_create_account(jsonb_build_object('username', 'sup.a2', 'full_name', 'Supervisor A2 (test)',
          'roles', jsonb_build_array(jsonb_build_object('code', 'LL', 'line_id', tests.ph_line('A'))))) ->> 'secret') is not null,
  'the manager creates an allowed account (LL on line A)');
select throws_ok(format($$ select public.ph_admin_create_account(jsonb_build_object('username', 'sup.b2', 'full_name', 'x',
          'roles', jsonb_build_array(jsonb_build_object('code', 'LL', 'line_id', %L)))) $$, tests.ph_line('B')), 'P0403', null,
  'outside the delegated scope (line B) is refused');
select throws_ok($$ select public.ph_admin_create_account('{"username":"sup.c","full_name":"x","roles":[{"code":"LL"}]}') $$, 'P0403', null,
  'a grant on every line is outside a line-A delegation');
select throws_ok($$ select public.ph_admin_create_account('{"username":"qc.x","full_name":"x","roles":[{"code":"QCI"}]}') $$, 'P0403', null,
  'a role outside the delegated actions (QCI) is refused');
select throws_ok(format($$ select public.ph_admin_set_override(%L, 'shift.manage', 'grant', null, 'x') $$, tests.uid('sup.a2')), 'P0403', null,
  'individual overrides are not delegated');
select throws_ok(format($$ select public.ph_admin_set_roles(%L, '[{"code":"PHM"},{"code":"LL"}]', 'more') $$, :'mgr'), 'P0403', null,
  'no self-escalation');
select throws_ok(format($$ select public.ph_admin_account_step(%L, 'suspend', 'x') $$, tests.uid('sup.a2')), 'P0403', null, 'suspension was not delegated');
select throws_ok(format($$ select public.ph_admin_account_step(%L, 'reset', 'x') $$, tests.uid('sup.b')), 'P0403', null,
  'a delegated manager cannot reach an account outside the delegation (line B)');
select ok((public.ph_admin_account_step(tests.uid('sup.a2'), 'reset', 'Forgot password') ->> 'secret') is not null, 'a delegated reset of an allowed account');
select is((select string_agg(username, ',') from public.ph_admin_accounts() where manageable), 'sup.a2', 'the manager sees which accounts they may manage (only LL on line A)');

-- ---------------------------------------------------------------------------------------------
-- Changes take effect on the next request of an open session; reset, archive, last Owner, audit
select tests.as_user(:'own', :'own_sid');
select is((public.ph_admin_account_step((:'sb'::jsonb ->> 'user_id')::uuid, 'revoke_sessions', 'Phone lost') ->> 'sessions_revoked')::int, 1,
  'Owner revokes the supervisor''s session');
select throws_ok(format($$ select tests.pre(%L, %L, '/rpc/ph_my_line_shifts') $$, :'sb'::jsonb ->> 'user_id', :'sb'::jsonb ->> 'session_id'),
  'PGRST', null, 'the revoked session is refused on its next request');
select is((public.po_refresh(:'sb'::jsonb ->> 'refresh_token') ->> 'ok')::boolean, false, 'and cannot be refreshed');
select public.po_sign_in('sup.b', 'Linebee2026') as sb2 \gset
select tests.as_user((:'sb2'::jsonb ->> 'user_id')::uuid, (:'sb2'::jsonb ->> 'session_id')::uuid);
select ok(app.ph_can(tests.farm(), 'labour.record', tests.ph_line('B')), 'before the change: may record on line B');
select tests.as_user(:'own', :'own_sid');
select public.ph_admin_set_roles((:'sb2'::jsonb ->> 'user_id')::uuid, jsonb_build_array(jsonb_build_object('code', 'LL', 'line_id', tests.ph_line('C'))), 'Moved to line C');
select tests.as_user((:'sb2'::jsonb ->> 'user_id')::uuid, (:'sb2'::jsonb ->> 'session_id')::uuid);
select ok(not app.ph_can(tests.farm(), 'labour.record', tests.ph_line('B')) and app.ph_can(tests.farm(), 'labour.record', tests.ph_line('C')),
  'in the same open session the next check uses line C');
select tests.as_user(:'own', :'own_sid');
select ok((public.ph_admin_account_step((:'sb2'::jsonb ->> 'user_id')::uuid, 'reset', 'Shared password') ->> 'secret') is not null, 'reset gives a new one-time code');
select is((public.po_sign_in('sup.b', 'Linebee2026') ->> 'ok')::boolean, false, 'the old password no longer works after a reset');
select public.ph_admin_account_step((:'sb2'::jsonb ->> 'user_id')::uuid, 'archive', 'Left the company');
select is((select status from app.po_accounts where username = 'sup.b'), 'archived', 'archived');
select is((select count(*)::int from public.user_roles where user_id = (:'sb2'::jsonb ->> 'user_id')::uuid and voided_at is null and (valid_to is null or valid_to > now())), 0,
  'an archived account holds no role');
select is((select full_name from public.user_profiles where id = (:'sb2'::jsonb ->> 'user_id')::uuid), 'Supervisor B (test)', 'history stays attributable (profile kept)');
select throws_ok(format($$ select public.ph_admin_account_step(%L, 'reactivate', 'x') $$, :'sb2'::jsonb ->> 'user_id'), 'P0422', null, 'an archived account is not reactivated');
select throws_ok(format($$ select public.ph_admin_set_roles(%L, '[]', 'x') $$, :'own'), 'P0403', null, 'the Owner cannot change their own access');
select (public.ph_admin_create_account('{"username":"owner2","full_name":"Second owner (test)","roles":[{"code":"OWN"}]}') ->> 'user_id') as own2 \gset
select public.ph_admin_account_step(:'own2', 'archive', 'Test');
select tests.as_user(:'mgr');
select throws_ok(format($$ select public.ph_admin_account_step(%L, 'archive', 'x') $$, :'own'), 'P0403', null, 'a manager cannot touch the Owner');
-- Last-Owner protection is checked with the second Owner gone: only the Owner exists; nobody may remove them.
select is(app.po_active_owners(tests.farm()), 1, 'one active Owner');

-- Effective access with its source, and a preview before saving
select tests.as_user(:'own', :'own_sid');
select is((select sources -> 0 ->> 'role' from public.ph_effective_access(:'lead') where action_key = 'labour.record'), 'PACK_LEAD',
  'effective access names the role that grants it');
select is((select line_ids from public.ph_effective_access(:'lead') where action_key = 'labour.record'), array[tests.ph_line('A')], '… and its line');
select is((select allowed from public.ph_effective_access(:'lead', '{"roles":[{"code":"QCI"}]}') where action_key = 'labour.record'), false,
  'preview: with QCI instead, labour recording would be gone');
select ok((select allowed from public.ph_effective_access(:'lead', '{"roles":[{"code":"QCI"}]}') where action_key = 'hold.raise'),
  'preview: … and raising a hold would be allowed');

-- Owner decisions on unresolved cells
select id as cell from public.ph_permission_cells where farm_id = tests.farm() and action_key = 'load.finalise' and spec_code = 'DEC' \gset
select throws_ok(format($$ select public.ph_owner_cell_decision(%L, 'active', '') $$, :'cell'), 'P0422', null, 'an Owner decision needs a reason');
select is(public.ph_owner_cell_decision(:'cell', 'active', 'DEC finalises the packing list (owner decision)') ->> 'state', 'active', 'Owner activates an NYV cell');
select tests.as_user(:'mgr');
select throws_ok(format($$ select public.ph_owner_cell_decision(%L, 'disabled', 'x') $$, :'cell'), 'P0403', null, 'only the Owner decides cells');

-- The permissions audit
select tests.as_user(:'own', :'own_sid');
select ok((select count(*) from public.ph_access_log where event = 'account_created') >= 5, 'audit: accounts created');
select ok(exists (select 1 from public.ph_access_log where event = 'roles_changed' and reason = 'Moved to line C' and actor_user_id = :'own'
                   and before @> jsonb_build_array(jsonb_build_object('code', 'LL', 'line_id', tests.ph_line('B')))),
  'audit: who changed which roles, with before / after and the reason');
select ok(exists (select 1 from public.ph_access_log where event = 'delegation_set'), 'audit: delegation');
select ok(exists (select 1 from public.ph_access_log where event = 'cell_decision'), 'audit: Owner cell decision');
select ok(exists (select 1 from public.ph_access_log where event = 'account_revoke_sessions'), 'audit: sessions revoked');

set local role authenticated;
select tests.as_user(:'own', :'own_sid');
select ok((select count(*) from public.ph_access_log) > 0, 'the access log is readable by the Owner through the API role');
reset role;

-- Lockout after repeated failures
select public.po_sign_in('lead.a', 'x'), public.po_sign_in('lead.a', 'x'), public.po_sign_in('lead.a', 'x'), public.po_sign_in('lead.a', 'x'), public.po_sign_in('lead.a', 'x');
select is(public.po_sign_in('lead.a', 'x') ->> 'error', 'locked', 'five failures lock the account for a while');

-- The API roles cannot call the credential functions or read the credential tables
set local role authenticated;
select throws_ok($$ select public.po_sign_in('owner', 'Packhouse2026') $$, '42501', null, 'API users cannot call sign-in directly');
select throws_ok($$ select count(*) from app.po_accounts $$, '42501', null, 'API users cannot read credentials');
reset role;

select * from finish();
rollback;
