-- Packing-house read models (views named ph_*) are read-only for API users too. Writes through them already failed
-- (joined views are not updatable and the base tables refuse API writes), but the blanket grant still listed
-- insert/update on them; revoke it so the privilege catalogue matches the rule: all packing-house writes go through RPCs.

create or replace function app.apply_api_grants() returns void
language plpgsql
as $$
declare t text;
begin
  revoke all on all tables in schema public from anon;
  revoke all on all functions in schema public from anon;
  grant select, insert, update on all tables in schema public to authenticated;
  revoke delete, truncate on all tables in schema public from authenticated;
  revoke insert, update on public.audit_events, public.record_transitions, public.processed_mutations,
    public.sync_conflicts, public.notifications, public.escalations, public.stock_movements,
    public.stock_balances from authenticated;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'v') and c.relname like 'ph\_%' loop
    execute format('revoke insert, update on public.%I from authenticated', t);
  end loop;
  revoke select on public.ph_attachment_blobs from authenticated;
  revoke execute on function public.bootstrap_first_admin(uuid, uuid, text) from authenticated;
  perform app.refresh_tenant_refs();
end;
$$;

select app.apply_api_grants();
