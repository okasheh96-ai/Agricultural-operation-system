# Verification Register

Everything the system must not invent. Tiers: **C** working assumption (built configurable) · **D** known to exist, details unknown · **E** requires on-site discovery.
Status: `open` until the owner or the site answers. When an item is answered, fill **Answer / Date / Source** and change the code or config in the same commit.

Owner to ask is "Not Yet Verified" unless the owner names a person.

## S — System / environment questions (owner)

| id | Question | Tier | Affects | Status | Answer / Date / Source |
|---|---|---|---|---|---|
| VR-S01 | Provide a **staging** Supabase project (URL + anon key in env, service key never in the repo), or enable Docker so the Supabase CLI can run locally. Without one, the UI cannot be tested end to end. | E | Phase 1b UI, e2e tests | open | |
| VR-S02 | Does a Lovable prototype / Supabase project with real data exist? It is not in this repo or the owner's other repos. If yes: which project is production? (= E48) | E | Migration plan | open | |
| VR-S03 | Master Plan §13 says Phase 0 is "2–4 weeks, people not code"; the coding prompt says "proceed directly to Phase 1". Building proceeded per the later coding prompt (§0.6 rule 1). Confirm. | E | Phase order | open | |

## C — Working assumptions made in code (each configurable)

| id | Assumption | Where | Status |
|---|---|---|---|
| VR-C01 | Phase 1 permission matrix (who may create/configure/verify/void master data) is `docs/PERMISSIONS.md`. Admin farm-wide; Department Manager within own department; Maintenance Manager may create/configure assets in their department. | `seed.sql`, `role_permissions` | open |
| VR-C02 | Every farm member may **read** master data (departments, locations, assets, water sources, crop master, units, crews, workers' names). Worker ID numbers/phones are restricted. | default RLS select policies | open |
| VR-C03 | Audit log readable by System Admin and QA User. | `role_permissions` | open |
| VR-C04 | A department-scoped role does not cover records with no owning department (e.g. crop master): those need a farm-wide grant. | `app.has_permission` | open |
| VR-C05 | Wells: **no** well rows are seeded. `supabase/seed/optional_well_placeholders.sql` creates 14 temporary codes W-01…W-14 (unnamed, status Not Yet Verified) only if the owner chooses that option over admin import. | seed policy §5.3 | open |
| VR-C06 | A worker belongs to at most one crew at a time; cross-department work is recorded on the task. | `crew_members_no_overlap` | open |
| VR-C07 | Device/server clock difference > 300 s is flagged. | `settings.clock_skew_flag_seconds` | open |
| VR-C08 | Currency JOD by default; Western Arabic numerals; Gregorian calendar display. | `settings` | open |
| VR-C09 | Sign-in method: email + password first; phone OTP configurable later (SMS cost, E41). | `settings.sign_in_method` | open |
| VR-C10 | Asset / water-source status changes (any → any) require the `configure` action and a reason; Active is never set by a seed. | workflow `asset_status` v1 | open |
| VR-C11 | "Support" production system exists for workshops/offices/stores. | `production_systems` seed | open |
| VR-C12 | Delegation: a person may delegate their own scope without an admin; SoD blocks the delegate from acting on any record where the delegator holds a restricted role. | RLS, `transition_record` | open |
| VR-C13 | Main Warehouse core moves into Phase 2 (material consumption needs a real ledger). | ARCHITECTURE_PLAN §5 | open |
| VR-C14 | Arabic department, role and status labels in the seed are a starting glossary until site wording is confirmed (E46). Departments are marked `to_be_confirmed_on_site`. | `seed.sql`, `GLOSSARY.md` | open |

## D/E — Discovery backlog (Master Prompt Part E)

| id | Area | Item to confirm | Tier | Affects | Status |
|---|---|---|---|---|---|
| E1 | Organisation | Responsibilities not yet documented for each of the 13 departments | D | Permissions, task types | open |
| E2 | Organisation | Reporting lines (none may be invented) | E | Approvals, dashboards | open |
| E3 | Organisation | QA authority matrix: who places/releases holds, signs off, closes findings | E | QC/QA phase, holds | open |
| E4 | Organisation | Who verifies each task type; where a single person may self-verify | E | SoD config | open |
| E5 | Organisation | Approval points and thresholds (spray, PHI release, purchase, emergency spend, overtime) | E | Workflow config | open |
| E6 | Organisation | Exact authority of Operations beyond coordination | E | Permission matrix | open |
| E7 | Labour | Headcount; contractor share; daily / seasonal / piece-rate pay basis; attendance method | E | Labour entries, costing | open |
| E8 | Land | Total area 3,628 vs 3,483 D; what makes up the 145 D gap (D1) | D | Area master, cost per dunum | open — flagged by `location_area_reconciliation` |
| E9 | Crops | Contents of "Citrus" vs Mandarin/Orange (D2) | D | Crop master | open |
| E10 | Crops | "Red blocky" vs "Redblocky": one item or two (D3) | D | Crop master | open — both kept as `crop_aliases` |
| E11 | Crops | Species behind "Sweet beet" (red, red large, yellow) and "Orange sweet bite" (D4) | D | Crop master | open |
| E12 | Crops | "Cherry tomato chocolate": variety or market grade (D5) | D | Crop master, packing | open |
| E13 | Crops | Separate records for greenhouse and open-field tomato (D6) | D | Production systems, costing | open |
| E14 | Land | Greenhouse 916.3 D: gross or net (D7) | D | Yield KPIs | open — `area_basis` defaults to `unknown` |
| E15 | Land | Block / house / field structure and naming; sub-units used (rows, bays, beds, trees) | E | Location tree | open |
| E16 | Crops | Full verified crop and variety list; seasons and growing cycles | E | Agriculture phase | open |
| E17 | Wells | Name/code of each of the 14 wells | D | Wells records | open |
| E18 | Wells | Actual status of each well | D | Irrigation planning | open |
| E19 | Wells | Meters and reading types per well; units; frequency | E | Readings | open |
| E20 | Water | Water licences/quotas; salinity monitoring; energy source per pump | E | Water accounting | open |
| E21 | Irrigation | Network structure: zones, valves, pumps, reservoirs; zone ↔ block mapping | E | Irrigation phase | open |
| E22 | Irrigation | Fertigation equipment and controllers (brand, data export); units | E | Fertilizer distribution | open |
| E23 | Fleet | Fleet inventory by class; models | D | Fleet phase | open |
| E24 | Maintenance | Generators, electrical systems, critical asset list (top 20) | E | Asset register, PM | open |
| E25 | Maintenance | How maintenance requests are raised and routed today; existing asset register; PM practices | E | Maintenance workflow | open |
| E26 | Packing House Maint. | Packing-house asset hierarchy; split of responsibility with general Maintenance | D | PH maintenance scope | open |
| E27 | Main Warehouse | Item categories, units and pack sizes, storage locations, min/max, issue/return practice | D | Inventory | open |
| E28 | Maint. Warehouse | Spare-part catalogue structure, part-to-asset links, reorder practice | D | Inventory | open |
| E29 | Plant Protection | Product list, who prescribes and approves, how REI/PHI are tracked, applicator qualifications | E | PPP records, harvest gating | open |
| E30 | Harvest | How harvest is recorded today (and in FarmERP); bins/containers; lot numbering | E | Harvest lots, traceability | open |
| E31 | Packing House | Exact spelling, manufacturer and function of "Ingro machine", MAT EXAKTA, ELIFAB (Tomato), Aweta | D | Equipment register | open |
| E32 | Packing House | Process sequence; number of lines; which equipment belongs to which line | E | Lines/stages config | open |
| E33 | Packing House | Grader/labelling software; cold-store and pre-cooling monitoring; dispatch documents | E | Integration, storage logs | open |
| E34 | QC | Quality parameters, sampling plans, acceptance criteria per product | E | Inspection templates | open |
| E35 | QA | Standards in force; certifications held (GLOBALG.A.P. IFA, GRASP, BRCGS/IFS, SMETA, if any); target markets | E | QA module, retention policy | open |
| E36 | Cattle | All cattle operation processes | E | Cattle module | open |
| E37 | FarmERP | Which modules are live; who enters data; delay after the event; device used | E | Integration boundary | open |
| E38 | FarmERP | System of record per data type (materials, distribution, harvest, cost) | E | Duplicate-entry prevention | open — `settings.record_of_truth` |
| E39 | Infrastructure | 4G/Wi-Fi coverage map (fields, wells, packing house, warehouses) | E | Offline cache policy | open |
| E40 | Infrastructure | Devices available to supervisors and technicians (Android/iOS, shared or personal) | E | PWA targets, auth | open |
| E41 | Infrastructure | Preferred sign-in method (email, phone OTP); acceptable SMS cost | E | Auth | open |
| E42 | Communication | Whether WhatsApp/SMS notifications are permitted or wanted | E | Notifications | open |
| E43 | Measurement | KPIs management wants; owners; targets | E | Dashboards | open |
| E44 | Costing | Rates for labour, machine hours, water, energy; sources; currencies beyond JOD | E | Costing views | open |
| E45 | Regulation | National pesticide registry, labour rules, water licensing | E | Compliance fields | open |
| E46 | Terminology | Arabic terms actually used on site for departments, tasks, statuses, locations | E | Glossary, UI labels | open |
| E47 | Pain points | Top 10 problems ranked separately by managers, supervisors and workers | E | Phase priorities | open |
| E48 | Data | Any real data already entered in an existing prototype that must be preserved | E | Migration plan | open — see VR-S02 |
