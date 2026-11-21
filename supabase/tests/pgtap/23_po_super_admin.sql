-- Super Admin (Owner) one-time setup and recovery. Codes and passwords below are test values.
begin;
select no_plan();

select public.po_bootstrap_owner(tests.farm(), 'owner', 'Owner') is not null as boot;
update app.po_accounts set activation_code_hash = app.po_code_hash('Ab+c/DashboardGeneratedCode=='), activation_expires_at = now() + interval '30 days' where username = 'owner';

select is((public.po_setup_status() ->> 'pending')::boolean, true, 'setup is open while the Owner is pending');
select is(public.po_owner_setup('wrong-code', 'myboss', 'Me', 'Strong-pass-1') ->> 'error', 'invalid_code', 'a wrong code is refused');
select is(public.po_owner_setup('Ab+c/DashboardGeneratedCode==', 'X', 'Me', 'Strong-pass-1') ->> 'error', 'username', 'username rule enforced');
select throws_ok($$ select public.po_owner_setup('Ab+c/DashboardGeneratedCode==', 'myboss', 'Me', 'short') $$, 'P0422', null, 'weak password refused');
select is(public.po_owner_setup('ab+c/dashboardgeneratedcode==', 'myboss', 'Owner Person', 'Strong-pass-1') ->> 'username', 'myboss',
  'the code from the dashboard works (case-insensitive) and the Owner chooses the username');
select is((select password_hash is not null and activation_code_hash is null and not must_change_password from app.po_accounts where username = 'myboss'), true,
  'own password set, code consumed');
select is((public.po_sign_in('myboss', 'Strong-pass-1', 'test', '127.0.0.1') ->> 'ok')::boolean, true, 'the Owner signs in with the chosen username and password');
select is((public.po_setup_status() ->> 'pending')::boolean, false, 'setup closes after use');
select is(public.po_owner_setup('Ab+c/DashboardGeneratedCode==', 'attacker', 'X', 'Strong-pass-1') ->> 'error', 'no_pending_setup', 'the code cannot be used again');
select ok(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id join app.po_accounts a on a.user_id = ur.user_id
                   where a.username = 'myboss' and r.code = 'system_admin' and ur.voided_at is null), 'the Owner is also System Administrator (office administration)');
select ok(exists (select 1 from public.user_roles ur join public.ph_roles pr on pr.role_id = ur.role_id join app.po_accounts a on a.user_id = ur.user_id
                   where a.username = 'myboss' and pr.spec_code = 'OWN' and ur.voided_at is null), 'and holds the Owner role (all packhouse administration)');
select ok(exists (select 1 from public.ph_access_events where event = 'owner_setup_completed'), 'setup recorded in the access log');

-- Recovery for a sole Owner: once per code, 24 hours, sessions revoked, password unchanged until the Owner sets a new one.
select (public.po_sign_in('myboss', 'Strong-pass-1', 'test', '127.0.0.1') ->> 'session_id') as sess \gset
select is(app.po_owner_recovery('Recover-Code-1'), 'issued:myboss', 'recovery code issued for the sole Owner');
select is((select count(*)::int from app.po_sessions s join app.po_accounts a on a.user_id = s.user_id where a.username = 'myboss' and s.revoked_at is null), 0,
  'open sessions are revoked');
select is((public.po_sign_in('myboss', 'Strong-pass-1', 'test', '127.0.0.1') ->> 'ok')::boolean, true, 'the existing password is not overwritten by recovery');
select is(app.po_owner_recovery('Recover-Code-1'), 'already_used', 'the same recovery code works only once');
select is(public.po_activate('myboss', 'recover-code-1', 'Newer-pass-22') ->> 'ok', 'true', 'the Owner chooses a new password with the recovery code');
select is((public.po_sign_in('myboss', 'Newer-pass-22', 'test', '127.0.0.1') ->> 'ok')::boolean, true, 'and signs in with it');
select is(public.po_activate('myboss', 'recover-code-1', 'Another-pass-33') ->> 'ok', 'false', 'the recovery code is consumed');
select is((select count(*)::int from app.po_accounts a join public.user_roles ur on ur.user_id = a.user_id join public.ph_roles pr on pr.role_id = ur.role_id
            where pr.spec_code = 'OWN' and ur.voided_at is null and a.farm_id = tests.farm()), 1, 'still exactly one Super Admin; nothing was duplicated');

select * from finish();
rollback;
