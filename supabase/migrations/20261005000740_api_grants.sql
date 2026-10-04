-- Re-applies the narrow API grants to every public table and view. Supabase grants broad default
-- privileges on new objects, so EVERY migration that creates tables or views must end with
--   select app.apply_api_grants();
-- (enforced by supabase/tests/pgtap/01_schema_invariants.sql).

create function app.apply_api_grants() returns void
language plpgsql
as $$
begin
  revoke all on all tables in schema public from anon;
  revoke all on all functions in schema public from anon;
  grant select, insert, update on all tables in schema public to authenticated;
  revoke delete, truncate on all tables in schema public from authenticated;
  -- Written only by SECURITY DEFINER functions / triggers.
  revoke insert, update on public.audit_events, public.record_transitions, public.processed_mutations,
    public.sync_conflicts, public.notifications, public.escalations, public.stock_movements,
    public.stock_balances from authenticated;
  revoke execute on function public.bootstrap_first_admin(uuid, uuid, text) from authenticated;
end;
$$;

select app.apply_api_grants();
