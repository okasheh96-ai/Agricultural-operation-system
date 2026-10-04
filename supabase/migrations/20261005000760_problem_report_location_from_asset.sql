-- A breakdown report names the equipment; the equipment's location becomes the report's (and so the
-- repair task's) location when the reporter did not choose one. Found by the end-to-end breakdown test:
-- without a location the repair task could not be planned or assigned.
create or replace function app.problem_reports_default_department() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp
as $$
begin
  if new.location_id is null and new.asset_id is not null then
    select location_id into new.location_id from public.assets where id = new.asset_id and farm_id = new.farm_id;
  end if;
  if new.owning_department_id is null then
    select default_department_id into new.owning_department_id from public.problem_categories where id = new.category_id;
  end if;
  if new.owning_department_id is null then
    select id into new.owning_department_id from public.departments where farm_id = new.farm_id and code = 'operations';
  end if;
  return new;
end;
$$;
