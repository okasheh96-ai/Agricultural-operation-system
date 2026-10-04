-- STRUCTURE-ONLY SEED (Master Prompt §5.3). Safe for production *only with owner approval*.
-- Contains: the farm shell, 13 departments + Packing House unit, role categories, the Phase 1
-- permission matrix, settings with evidence tiers, units, production systems, asset classes and
-- the asset/water-source status workflow.
-- Contains NO wells, crops, fleet, staff, KPIs, rates, chemicals, QC parameters or QA standards.
-- Arabic labels are a starting glossary (tier D until confirmed on site, E46 / docs/GLOSSARY.md).

select app.create_farm_structure('FARM', 'المزرعة (الاسم غير مؤكد بعد)', 'Farm (name not yet verified)', false,
                                 'Company/farm name not provided yet')
 where not exists (select 1 from public.farms where code = 'FARM');
