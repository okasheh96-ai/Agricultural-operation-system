-- Packing house: read models for the record view (who moved a pallet, who uploaded a file). created_by references
-- auth.users, so names are joined here rather than through the API. Row access follows the underlying tables (RLS).

create view public.ph_stock_move_log with (security_invoker = true) as
select m.id, m.farm_id, m.pallet_id, m.moved_at, lf.code as from_code, lt.code as to_code, u.full_name as by_name,
       m.reason, m.group_override_reason, m.over_capacity, m.permission_basis
  from public.ph_stock_moves m
  left join public.ph_locations lf on lf.id = m.from_location_id
  left join public.ph_locations lt on lt.id = m.to_location_id
  left join public.user_profiles u on u.id = m.created_by
 where m.voided_at is null;
comment on view public.ph_stock_move_log is 'Location history of a pallet with location codes and the person who moved it (FR-ST-01).';

create view public.ph_attachment_list with (security_invoker = true) as
select a.id, a.farm_id, a.entity_type, a.entity_id, a.kind, a.mime_type, a.size_bytes, a.sha256, a.caption, a.created_at,
       a.created_by, u.full_name as by_name, a.supersedes_id
  from public.ph_attachments a
  left join public.user_profiles u on u.id = a.created_by
 where a.voided_at is null;
comment on view public.ph_attachment_list is 'Evidence files with uploader name, size and SHA-256 (AT-05); content through ph_attachment_content().';

select app.apply_api_grants();
