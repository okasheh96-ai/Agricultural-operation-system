-- OPTIONAL — run only if the owner chooses temporary well codes over admin import (VR-C05).
-- Confirmed fact: there are 14 wells and not all are active (Master Prompt §1.4.5).
-- Creates 14 unnamed water sources W-01…W-14 flagged as temporary codes, status Not Yet Verified.
-- No well is marked Active. Names, real codes and statuses are entered later by authorised users.
do $$
declare
  v_farm uuid := (select id from public.farms where code = 'FARM');
  i int;
  v_id uuid;
begin
  if exists (select 1 from public.water_sources where farm_id = v_farm and kind = 'well') then
    raise notice 'Wells already exist; skipping.';
    return;
  end if;
  for i in 1..14 loop
    insert into public.water_sources (farm_id, code, kind, is_temporary_code, source_note)
    values (v_farm, 'W-' || lpad(i::text, 2, '0'), 'well', true,
            'Temporary code; real identifier and status not yet verified (E17, E18)')
    returning id into v_id;
    insert into public.wells (farm_id, water_source_id) values (v_farm, v_id);
  end loop;
end $$;
