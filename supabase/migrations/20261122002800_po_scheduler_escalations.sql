-- Hosted databases without pg_cron in the app database (Neon): the packhouse server's scheduler tick also runs the
-- (idempotent) escalation engine that pg_cron runs every five minutes where it is available.
create function public.po_run_escalations() returns integer
language sql security definer set search_path = public, app, pg_temp
as $$ select app.run_escalations() $$;
comment on function public.po_run_escalations() is 'Scheduler entry point for app.run_escalations (server tick, po_auth only).';
revoke all on function public.po_run_escalations() from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'po_auth') then grant execute on function public.po_run_escalations() to po_auth; end if; end $$;
select app.apply_api_grants();
revoke all on function public.po_run_escalations() from anon, authenticated;
