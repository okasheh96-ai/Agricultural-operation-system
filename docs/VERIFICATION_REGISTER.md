# Verification Register

Everything the system must not invent. Tiers: **C** working assumption (built configurable) · **D** known to exist, details unknown · **E** requires on-site discovery.
Status: `open` until the owner or the site answers. When an item is answered, fill **Answer / Date / Source** and change the code or config in the same commit.

Owner to ask is "Not Yet Verified" unless the owner names a person.

## S — System / environment questions (owner)

| id | Question | Tier | Affects | Status | Answer / Date / Source |
|---|---|---|---|---|---|
| VR-S01 | Provide a **staging** Supabase project (project URL + anon key only — never the service-role key) for deployment rehearsal. | E | Deployment, hosted-only behaviour (Storage, pg_cron, email) | open — *no longer blocks testing*: `scripts/dev-stack.sh` runs real Supabase Auth + PostgREST + Postgres locally and the e2e suite runs against it | 2026-10-05 |
| VR-S02 | Does a Lovable prototype / Supabase project with real data exist? It is not in this repo or the owner's other repos. If yes: which project is production? (= E48) | E | Migration plan | open | |
| VR-S03 | Master Plan §13 says Phase 0 is "2–4 weeks, people not code"; the coding prompt says "proceed directly to Phase 1". Building proceeded per the later coding prompt (§0.6 rule 1). Confirm. | E | Phase order | open | |

## C — Working assumptions made in code (each configurable)

| id | Assumption | Where | Status |
|---|---|---|---|
| VR-C01 | Phase 1 permission matrix (who may create/configure/verify/void master data) is `docs/PERMISSIONS.md`. Admin farm-wide; Department Manager within own department; Maintenance Manager may create/configure assets in their department. | `seed.sql`, `role_permissions` | open |
| VR-C02 | Every farm member may **read** master data (departments, locations, assets, water sources, crop master, units, crews, workers' names). Worker ID numbers/phones are restricted. | default RLS select policies | open |
| VR-C03 | Audit log readable by System Admin and QA User. | `role_permissions` | open |
| VR-C04 | A department-scoped role does not cover records with no owning department (e.g. crop master): those need a farm-wide grant. | `app.has_permission` | open |
| VR-C05 | ~~Wells seeded only by owner choice~~ → **Answered by owner 2026-10-05**: create the 14 wells as configurable placeholders, none Active unless confirmed. Implemented as W-01…W-14, unnamed, temporary codes, Not Yet Verified (migration 0810). | `app.seed_well_placeholders` | answered |
| VR-C06 | A worker belongs to at most one crew at a time; cross-department work is recorded on the task. | `crew_members_no_overlap` | open |
| VR-C07 | Device/server clock difference > 300 s is flagged. | `settings.clock_skew_flag_seconds` | open |
| VR-C08 | Currency JOD by default; Western Arabic numerals; Gregorian calendar display. | `settings` | open |
| VR-C09 | Sign-in method: email + password first; phone OTP configurable later (SMS cost, E41). | `settings.sign_in_method` | open |
| VR-C10 | Asset / water-source status changes (any → any) require the `configure` action and a reason; Active is never set by a seed. | workflow `asset_status` v1 | open |
| VR-C11 | "Support" production system exists for workshops/offices/stores. | `production_systems` seed | open |
| VR-C12 | Delegation: a person may delegate their own scope without an admin; SoD blocks the delegate from acting on any record where the delegator holds a restricted role. | RLS, `transition_record` | open |
| VR-C13 | Main Warehouse core moves into Phase 2 (material consumption needs a real ledger). | ARCHITECTURE_PLAN §5 | open |
| VR-C14 | Arabic department, role and status labels in the seed are a starting glossary until site wording is confirmed (E46). Departments are marked `to_be_confirmed_on_site`. | `seed.sql`, `GLOSSARY.md` | open |
| VR-C15 | Two generic task types seeded: "General task" (any department) and "Breakdown repair" (Maintenance); both require verification. Real activity types are configured by the farm. | `seed_phase2_structure` | open |
| VR-C16 | Problem categories and their default owning departments (breakdown→Maintenance, irrigation/water→Irrigation, pest/disease→Plant Protection, quality→QC, material shortage→Main Warehouse, safety/other→Operations). | `problem_categories` | open |
| VR-C17 | Phase 2 permission matrix: supervisors/technicians/field users create + execute tasks in their department; department & maintenance managers plan, dispatch, verify, close, triage; Operations creates cross-department draft requests and routes reports but does not plan/verify/close inside departments; admin configures types/categories/rules/warehouses/items but does not execute or verify. | `seed_phase2_structure`, docs/PERMISSIONS.md | open |
| VR-C18 | Task workflow: a task type either requires verification (in progress → pending verification → verified → closed) or not (in progress → completed → closed); self-verification only where the type allows it, always logged. Reopening verified/completed work needs a reason and forces re-verification. | workflow `task` v1 | open |
| VR-C19 | Stock issue requests need no approval step unless `settings.issue_request_requires_approval` is set (E5). Field consumption is recorded on the task; stock moves only when the warehouse posts a movement. Negative balances are allowed and flagged. | inventory core | open |
| VR-C20 | Overdue = still open after the end of the task window, else after the end of its planned day in Asia/Amman. | `app.task_due_at` | open |
| VR-C21 | A problem report without a chosen location takes the location of the equipment it names. | `problem_reports_default_department` | open |
| VR-C22 | Escalation rules ship **unconfigured**; thresholds and who is notified are entered by the farm. | `escalation_rules` | open |
| VR-C23 | A supervisor (or other field executor) may create unplanned work in their own department and assign it **only to themselves**. Assigning to anyone else stays a planner's dispatch right. | task workflow v2, `guard_task_assignee_is_actor` | open |
| VR-C24 | The 14 wells are owned by the Wells department, so its manager (and the admin) may change status and verify. Irrigation users get no well-status authority until E1 is answered. | `seed_well_placeholders` | open |
| VR-C25 | Only the System Administrator role spans independent departments (QA), for configuration; every other farm-wide grant stops at QA. | `roles.spans_independent_departments`, `app.seed_hardening` | open |
| VR-C26 | Only the assigned supervisor, their active delegate, or a planner with dispatch right may execute a task; other supervisors in the same department may not. | `app.may_execute_assigned` | open |

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

## PH — Packing house (PH-OAS-SPEC-001 v0.1)

Source labels from the spec are kept per record: **C** documented (≈ tier A once walked through), **P** proposed (≈ tier C), **NYV** not yet verified (≈ tier D/E).
Open decisions OD-01…OD-41 are stored as data and decided in the app (Packing House → Open decisions), not here.

### System / scope questions (owner)

| id | Question | Tier | Affects | Status | Answer / Date / Source |
|---|---|---|---|---|---|
| VR-PH-S01 | The spec is marked "Draft 0.1 — Not for build"; the owner's build instruction (2026-10-19) was followed (§0.6). The real farm stays blocked wherever a critical OD is open; the demo farm uses **labelled demo assumptions** (OD-01 B, OD-02 C, OD-03 A, OD-17 A, OD-38 DEC), refused on any non-demo farm by a trigger. Confirm. | E | Whole module | open | |
| VR-PH-S02 | The companion workbook (permission matrix, data dictionary) is not in the repo; §6.3 was transcribed from the PDF tables. Check `ph_permission_cells` against the workbook when provided. | E | Permissions | open | |
| VR-PH-S03 | Packing house was planned as Phase 8; the owner instruction puts it before Agriculture (Phase 3). Confirm the order. | E | Phase plan | open | |

### Working assumptions made in code (each configurable)

| id | Assumption | Where | Status |
|---|---|---|---|
| VR-PH-C01 | Proposed (P) permission cells work on a real farm only after the record-type owner approves them (`ph_proposals_in_effect` = false); the demo farm has proposals in effect. | `ph_permission_cells`, `app.ph_permission_basis` | open |
| VR-PH-C02 | Any packing-house role may **read** packing-house records of its farm; actions are limited by the matrix. | `app.ph_is_member` select policies | open |
| VR-PH-C03 | G9 releases a held pallet back to the status it had before the hold; the SM-IP diagram shows OnHold → Stored only. | `ph_hold_step`, `held_from_status` | open |
| VR-PH-C04 | G1 before registration: pallets of an arrival held for its vehicle cannot be registered (ST-02 text says "passed or held"). | guard on `ph_register_pallet` | open |
| VR-PH-C05 | Vehicle exception needs PHM, QAM and TOP (SOP-TR: "PHM, QA team and top management"); exact QA and top-management signers are OD-38. One refusal ends the arrival. | `ph_vehicle_exception_decide` | open |
| VR-PH-C06 | Food-safety holds are decided and closed by QAM only; quality holds by QCM or QAM (SoD-05). | `ph_hold_step` | open |
| VR-PH-C07 | M1 hold dispositions are release and waste only; regrade, rework, return (M2) and concession (M4) are refused with a "later milestone" reason. | `ph_hold_step` | open |
| VR-PH-C08 | Without a product tolerance (OD-05/OD-15), a QA acceptance is recorded as a judgement, flagged `no_tolerance_set` and listed for QAM review. | `ph_submit_rma`, exception rule OD-05 | open |
| VR-PH-C09 | Record numbering: `ARR/VIN/ARC/RMA/RCK/QC1-YYMMDD-NNNN`, `NC-YYMMDD-NNN`, `WR-YYMMDD-NNNN`; pallet print number `<crop label code>-YYMMDD-<source>-NNN` (§7.1 example); lot `L-<crop>-<YYMMDD>-<source>` only under OD-02 option C. Crop label codes are not documented for real crops. | `app.ph_code`, `ph_crops.label_code` | open |
| VR-PH-C10 | Photos (≤ 5 MB, JPEG/PNG/WebP, compressed on the device) are stored in the database with SHA-256 until Storage exists (VR-S01). | `ph_attachment_blobs` | open |
| VR-PH-C11 | Local rules (17:00 cut-off, 24 h grading, dates) use Asia/Amman. | `app.ph_local_date` | open |
| VR-PH-C12 | A person signs a vehicle exception once, even when holding two of the signing roles. | `ph_vehicle_exception_decide` | open |
| VR-PH-C13 | Inputs may be issued to a **Planned** Job Card (not only Ready / In progress): SM-JC needs ≥ 1 released input to reach Ready, while V-05 / the SM-IP table say "JC is Ready or InProgress". Issue is refused on draft, completed or cancelled Job Cards. | `ph_issue_to_job_card` | open |
| VR-PH-C14 | Line-start check (G5, SOP-PL "Quality controller and line leader"): one of QCI / LL records the checklist, a **different person holding the other role** confirms; one person holding both roles cannot sign twice. A fail blocks the Job Card until the Line Leader records the correction. | `ph_line_start_check`, `ph_confirm_line_start` | open |
| VR-PH-C15 | QC-2: the **latest** QC-2 record governs. A finished pallet needs it to be a *final* Pass (G6); a later online Fail stops new finished pallets until another final Pass. QC-2 failures notify PHM and PE, not operators (T-10). | `ph_create_fg_pallet`, `ph_qc2_record` | open |
| VR-PH-C16 | Lot attribution of a finished pallet is **proportional to the kg issued** to its Job Card (GEN-05/06) and the method is stored; exact / time-window attribution need line segregation data that does not exist yet. | `ph_fg_pallet_lots` | open |
| VR-PH-C17 | Completing a Job Card closes every input (consumed + returned = issued). A pallet with kg left returns to **Stored** and needs QC-1 release again before it is issued (SM-IP Issued → Stored → Released). Its location is unchanged. | `ph_complete_job_card` | open |
| VR-PH-C18 | Packaging issue is recorded as a described item and a quantity in pieces; there is no packaging master, stock or ERP removal yet (no packaging list was supplied). | `ph_jc_packaging` | open |
| VR-PH-C19 | The SM-IP table names LL/PHO for issue and return; the §6.3 matrix gives `job_card.record_inputs` to LL (P) and TRC/DEC (NYV, OD-13) only. The matrix is applied; PHO cannot issue. | `ph_permission_cells` | open |
| VR-PH-C20 | Finished pallets go only into finished-goods fridges (purpose `fg_storage`, F1–F4) with the V-07 storage-group check and V-08 capacity warning. The 24 h QC validity (CP-06) is computed from the QC stamp and shown; it is enforced at load (V-11) in M3. | `ph_move_fg_pallet`, `ph_fg_board` | open |

### Known gaps in the source (cannot be invented)

| id | Item | Tier | Affects | Status |
|---|---|---|---|---|
| VR-PH-E01 | SOP-TR incoming-vehicle checklist items are not in the spec; the template has one placeholder item marked NYV. | E | FR-RC-02 | open |
| VR-PH-E02 | Storage temperatures for Sweetbite pepper and watermelon are missing from SOP-PC. The product SOPs supplied 2026-10-21 (draft 001, effective date blank) state Sweet Bite Pepper 7–10 °C, Watermelon 10–15 °C, Melon 2–5 °C and Blocky Capsicum Color 7–10 °C. Not applied to the crop master: draft documents, and crop changes go through maker-checker (ADM enters, PHM/QAM approve). | D | Crop master, storage groups | open |
| VR-PH-E03 | OD-03, OD-17 and OD-38 carry no recommendation in the spec. | E | Registration, QC-1, vehicle inspection | open |
| VR-PH-E04 | Calibration due dates for SCALE-R1, SCALE-R2, SCALE-R3 are unknown, so every receiving weight is flagged (FR-MD-06) and counts as "needs attention" on the board. | E | Weights, board attention counts | open |
| VR-PH-E05 | NYV permission cells with no named decision (packaging.request PE/LL, waste.create PHO, load.finalise DEC, deviation.create SAL) cannot be activated until an owner names the decision. | E | M2–M4 permissions | open |
| VR-PH-E06 | Barcode / label format (OD-20) and label printer model (OD-24): labels print the code as text only. | E | Labels | open |
| VR-PH-E07 | Location capacities, fridge-to-storage-group mapping and line rates beyond the SOP list. | E | Location board, placement | open |
| VR-PH-E08 | Product SOPs (Cherry Tomato, Tomato, Blocky Capsicum Color, Sweet Bite Pepper, Melon, Watermelon) and the QC Function charter are **draft version 001 with no effective date**. Their line-start and QC-2 items are loaded word for word as checklists (evidence C, source cited per template); approval of the documents is needed before they are relied on. | E | G5, G6 checklists | open |
| VR-PH-E09 | Grade criteria (Premium / GR1 / GR2), size and weight ranges and defect tolerances are in "company-approved grading standards" that were not supplied (OD-05, OD-06). QC-2 records a judgement flagged "no tolerance set". The SOPs' sampling figure (2.5 %) is a "working example" and is shown as a hint only. | E | QC-2, grading | open |
| VR-PH-E10 | The Blocky Capsicum Color SOP describes Blocky as a capsicum (pepper) at 7–10 °C. This is evidence for OD-30 (crop identity), not a decision: the Blocky crop stays blocked until OD-30 is recorded. | E | OD-30, Blocky crop | open |
| VR-PH-E11 | Melon has an SOP but is not in the crop master or Figure 4.2 routes; its checklists are loaded and unused until the crop is added and approved. Eggplant and mini cucumber have no SOP: their line-start checklist is a single NYV item and QC-2 uses the QC Function items. | E | Crop master, checklists | open |
| VR-PH-E12 | Demo finished-pallet weights, box counts and packaging items are invented for the demo farm and labelled. Real values per crop and pack (FCT, OD-29) are not documented. | E | Demo only | open |
