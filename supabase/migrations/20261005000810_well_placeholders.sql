-- Owner instruction (2026-10-05): "There are 14 wells. Create them as configurable records/placeholders only.
-- Do NOT mark them Active unless explicitly confirmed." Confirmed facts (tier A): 14 wells exist; not all are active.
-- Each farm gets W-01..W-14: no name, status Not Yet Verified, temporary codes, owned by the Wells department
-- (tier C, VR-C24). Real codes, names and statuses are entered by authorised users; a well can be marked
-- verified only once it has a real name and code (constraint water_sources_verified_needs_identity).

create function app.seed_well_placeholders(p_farm uuid) returns void
language plpgsql
as $$
declare
  i    int;
  v_id uuid;
  v_dept uuid := (select id from public.departments where farm_id = p_farm and code = 'wells');
begin
  if exists (select 1 from public.water_sources where farm_id = p_farm and kind = 'well') then
    return;
  end if;
  for i in 1..14 loop
    insert into public.water_sources (farm_id, code, kind, owning_department_id, is_temporary_code, source_note)
    values (p_farm, 'W-' || lpad(i::text, 2, '0'), 'well', v_dept, true,
            'Placeholder: 14 wells confirmed by owner; identifier, name and status not yet verified (E17, E18)')
    returning id into v_id;
    insert into public.wells (farm_id, water_source_id) values (p_farm, v_id);
  end loop;
end;
$$;

create or replace function app.seed_phase_structure(p_farm uuid) returns void
language plpgsql as $$
begin
  perform app.seed_phase2_structure(p_farm);
  perform app.seed_task_workflow_v2(p_farm);
  perform app.seed_well_placeholders(p_farm);
end $$;

select app.seed_well_placeholders(id) from public.farms;
