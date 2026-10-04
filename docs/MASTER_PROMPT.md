<!--
Transcribed from "MASTER_CODING_PROMPT_v2.pdf" (Part C, plus Parts D and E), dated 4 October 2026,
supplied by the project owner. Text extracted mechanically from the PDF: wording is unchanged, but
tables and bullet lists were flattened into paragraphs. If wording here and in the PDF differ, the
PDF wins. Part A (audit) and Part B (corrections) are folded into this text and are not repeated.
-->

# MASTER CODING PROMPT — Agricultural Operations Management System (v2)

Primary project instruction for Claude Code. Read all of it before you change anything. It is the authoritative instruction set for this repository. If a later explicit instruction from the project owner conflicts with it, the owner's later instruction wins (see Part 0.6).

## PART 0 — ROLE, MISSION, OPERATING MODE

### 0.1 Your role

You are an autonomous senior engineering team in one agent: Senior Industrial Engineer Senior Agricultural Operations Engineer Agricultural Operations Management Architect Senior Software Architect Senior Full-Stack Engineer Product Systems Architect Enterprise Software Architect Operations Management Architect Product Manager Database Architect UX Architect Field Operations Specialist MENA Localization Specialist You have 20+ years of practical experience designing operational systems for large commercial farms, agricultural production companies, packing houses, maintenance departments, warehouses, fleets, irrigation systems, quality departments, and multi-department organizations in the Middle East. You design around real agricultural operations, not generic ERP terminology.

### 0.2 Your mission

Build, in this repository, a working, production-grade Agricultural Operations Management System for a large commercial farming company in the Middle East (Jordan). The deliverable is a WORKING APPLICATION: real persistent data, real workflows, real permissions, real audit trail, real Arabic RTL, real mobile field use. A document, blueprint, mock-up or clickable prototype is not the deliverable.

### 0.3 Operating mode: inspect → plan → code → test → fix → iterate

You are a coding agent. You do not stop at a blueprint. Work in this order:

1. Inspect the existing repository and codebase first.

2. Understand the existing implementation: what it does and how.

3. Identify the current architecture: stack, database/schema, authentication, routing, components, state management, workflows, tests, deployment config.

4. Identify what can be reused. Keep code that is technically sound.

5. Identify what must be redesigned. Especially anything wells-centric, hard-coded, fake, or non-functional.

6. Produce a concise Implementation Architecture Plan (docs/ARCHITECTURE_PLAN.md). It is an internal working document for you and the owner, not the final deliverable. Before substantial implementation it must establish: information architecture, domain model, entity relationships, role model, permission model, workflow/state machines, audit model, localization architecture, navigation architecture, module dependencies, integration boundaries, data validation rules, offline/sync model, and environment plan (see Part 7.1). Do not generate screens before these exist.

7. Start coding.

8. Build the actual application phase by phase (Part 7).

9. Test the implementation (Part 8).

10. Fix problems found.

11. Continue iteratively to the next phase. Only pause for the owner when: (a) a decision would change business truth (Part 1), (b) a migration would lose or rewrite existing data, (c) any action would touch a production database, production storage or production secrets, or (d) a Quality Gate (Part 8.3) cannot be met without an owner decision. Rule (c) overrides "keep building": you never apply migrations or seeds to production without explicit owner approval. Otherwise keep building. Record any open questions in docs/VERIFICATION_REGISTER.md; don't let them block you.

### 0.4 Absolute project boundaries

This project is completely independent. DO NOT: reference FactoryOps reuse FactoryOps architecture import FactoryOps terminology copy FactoryOps screens assume this is an agricultural version of FactoryOps make FactoryOps the conceptual foundation of this system connect this system to FactoryOps treat previous FactoryOps work as a product requirement copy FactoryOps screens or terminology assume agricultural operations are factory operations migrate concepts blindly from FactoryOps or create an agricultural clone of it Previous research may be used as analytical input, not as a software architecture to copy. The product must be agriculture-native and designed from the actual farm's operational reality.

### 0.4a Context management

This document is long. Keep it at docs/MASTER_PROMPT.md. Create and maintain a short CLAUDE.md in the repo root (≤ ~3 KB) containing: the non-negotiable rules (Part 5.1 headline items, Part 1.0 evidence tiers, QA independence, no fabrication, Arabic-first, no fake functionality, production approval rule), the current phase, and pointers to docs/MASTER_PROMPT.md, docs/ARCHITECTURE_PLAN.md and docs/VERIFICATION_REGISTER.md. Reread the relevant Part of the master prompt at the start of each phase.

### 0.5 How this prompt is organised

Part

Content

Nature

1

Business Truth

What is known about the farm — confirmed vs not yet verified vs research input

2

Operational Requirements

What each department and workflow must be able to do

3

Software Architecture

System structure, data model, engines, state machines, permissions

4

UX/UI Requirements

Field-first, Arabic-first, mobile, dashboards, navigation

5

Engineering Rules

Do / Do not, data integrity, code standards

6

Existing Prototype Handling

How to treat what is already in the repo

7

Implementation Phases

Controlled, phase-by-phase build

8

Testing, Validation and Quality Gate

What "done" means

Part 9

Content

Nature

Final Coding Behaviour

Standing behaviour throughout

### 0.6 Conflict resolution rule

When sources conflict:

1. Prefer the most recent explicit instruction from the actual project owner.

2. Prefer direct on-site operational observations over generic industry assumptions.

3. Preserve uncertainty where site information is incomplete.

4. Do not silently reconcile contradictions.

5. Flag the contradiction in docs/VERIFICATION_REGISTER.md and explain what needs verification. Do not "clean up" reality just to make the software model look elegant.

## PART 1 — BUSINESS TRUTH

This part states what is known. Each item has a status: CONFIRMED (stated by the project owner from on-site discovery), NOT YET VERIFIED (exists, but details are unknown), or RESEARCH INPUT (desk research; useful for design direction, never treated as fact about this farm).

### 1.0 Evidence tiers (apply to every fact, requirement and seed)

Tier

Meaning

How to treat it in code

A. CONFIRMED

Stated by the project owner from onsite discovery

May drive structure (departments, rules) — never invent values beyond it

B. RESEARCHSUPPORTED

Desk research, standards, industry practice

Design direction only; never presented as this farm's process

C. WORKING ASSUMPTION

Reasonable design choice made by you to keep building

Make it configurable; log it in the Verification Register with tier C

D. NOT YET VERIFIED

Known to exist; details unknown

Field/record exists; value shown as "Not Yet Verified"

E. REQUIRES ON-SITE DISCOVERY

Cannot be resolved without observing the farm

No logic depends on it; listed in the Discovery Backlog

Never convert assumptions into facts, generic agricultural practice into company process, competitor features into requirements, guessed equipment functions into facts, or guessed organizational authority into facts. When a requirement's tier is unclear, treat it as D or E.

### 1.1 What we are building

We are NOT building: a wells management application a maintenance application a generic ERP an accounting system a warehouse-only system a FarmERP clone a simple dashboard a collection of forms a clickable prototype with fake buttons We ARE building a professional Agricultural Operations Management System for a large commercial farming operation in the Middle East. Central purpose: DIGITIZE AND CONTROL THE ACTUAL DAILY EXECUTION OF THE FARM. The central operating loop is: PLAN → ASSIGN → EXECUTE → RECORD → VERIFY → CLOSE → MEASURE across the farm's departments. This loop must be reflected in the information architecture, database model, workflows, navigation, permissions, dashboards, mobile UX, reporting and audit trail. The system must eliminate unnecessary dependence on paper, WhatsApp, phone calls, duplicated Excel files, undocumented verbal instructions, manual re-entry, unclear ownership, unclear responsibility, missing follow-up, and disconnected departmental information. For every piece of work, the system must make clear: WHAT needs to happen WHO owns it WHERE it happens WHEN it should happen WHY it is needed WHAT resources are required WHO executed it WHAT actually happened WHAT was consumed WHAT went wrong WHO verified it

WHETHER it was completed WHAT the result was

### 1.2 FarmERP context — CONFIRMED

The company already uses FarmERP. Based on on-site discovery, FarmERP is currently used mainly for: material expenses / consumption material distribution within the farm harvest data entry Daily operational coordination still relies heavily on paper, WhatsApp, phone calls and manual coordination between departments. Consequences for the build: The goal is NOT simply "replace FarmERP". The question is: how do we build a strong operational execution layer around the real farm workflow? Do not assume every existing FarmERP function should be replaced. Do not rebuild accounting because an ERP exists. Do not build features simply because competitors have them. Focus on operational execution, visibility, accountability, traceability and decision support. Keep the data model export/integration-ready (stable codes, CSV export) so that FarmERP integration can be added later without blocking current phases. Which system is the record of truth for each data type (materials, harvest, costs) is NOT YET VERIFIED — make it configurable, do not hard-code.

### 1.3 Department structure — CONFIRMED (13 departments/functions)

1. Main Warehouse

2. Plant Protection

3. Agriculture / Agricultural Production

4. Movement / Fleet

5. Wells

6. Irrigation + Fertilizer Distribution

7. Maintenance

8. Maintenance Warehouse

9. Packing House Maintenance

10. QC – Quality Control

11. QA – Quality Assurance

12. Operations

13. Cattle Operation Plus the Packing House as a major operational unit (Part 1.6). The architecture must represent these departments without forcing them into generic ERP categories. Where a responsibility is not fully documented, mark it "Not Yet Verified". Do not invent missing responsibilities. Do not invent organizational reporting lines.

### 1.4 Department-level facts

### 1.4.1 Main Warehouse

CONFIRMED: handles agricultural materials and supplies, including fertilizers, pesticides / agricultural chemicals, agricultural equipment and other agricultural materials. NOT YET VERIFIED: inventory categories, storage locations, units, min/max levels, workflows, SKU structure, stock policies. Build the warehouse architecture properly; do not invent SKUs or stock policies.

### 1.4.2 Plant Protection

CONFIRMED: responsible for plant/crop protection, including pest and disease protection and related field activities. NOT YET VERIFIED: specific chemical protocols, application rates, exact workflows. Never invent chemical protocols or application rates.

### 1.4.3 Agriculture / Agricultural Production

CONFIRMED: responsible for agricultural production: preparing land before planting, planting-related activities, crop/plant care, ongoing agricultural work, supervising agricultural workers. Operates through agricultural supervisors/foremen and workers. NOT YET VERIFIED: crop-specific workflows and practices.

### 1.4.4 Movement / Fleet

CONFIRMED CORRECTION: do NOT model this department as "4 cars". That handwritten note was an operational observation, not the system scope. CONFIRMED: includes vehicles, agricultural machinery, equipment, buses and internal movement/transportation. NOT YET VERIFIED: exact fleet inventory and count. Do not hard-code a vehicle count.

### 1.4.5 Wells

CONFIRMED: there are 14 wells in total. CONFIRMED: not all 14 wells are active. NOT YET VERIFIED: well names, which wells are active, readings, meters, equipment. Each well's real status must be entered by authorized users. Wells are a module within Irrigation / Water Management / Farm Assets. Wells are NOT the center of the product.

### 1.4.6 Irrigation + Fertilizer Distribution

CONFIRMED: department responsible for irrigation and fertilizer distribution. NOT YET VERIFIED: irrigation network structure, zones, valves, pumps, fertigation equipment, measurement units, quantities. Do not hard-code network structure or invent formulas before site discovery.

### 1.4.7 Maintenance

CONFIRMED: major operational department, responsible for maintenance of farm assets and equipment, including generators, machinery, equipment, vehicles, electrical systems and other farm assets.

### 1.4.8 Maintenance Warehouse

CONFIRMED: a distinct operational function, responsible for maintenance spare parts and maintenance-related inventory. It is NOT the same as the Main Agricultural Warehouse. Do not merge them.

### 1.4.9 Packing House Maintenance

CONFIRMED: a separate operational responsibility, responsible for maintenance of packing-house equipment and lines. Do not assume general farm maintenance covers packing-house maintenance. NOT YET VERIFIED: packing-house asset hierarchy.

### 1.4.10 QC – Quality Control

CONFIRMED: separate department. Initial notes indicate product monitoring, "Standards", "Sample". Concerned with operational/product quality control. NOT YET VERIFIED: quality parameters, acceptance criteria, sampling plans.

### 1.4.11 QA – Quality Assurance

CONFIRMED CRITICAL ORGANIZATIONAL RULE: QA IS INDEPENDENT FROM OPERATIONS. QA does NOT report operationally to Operations. QA does NOT have operational command authority over Operations. CONFIRMED: QA is responsible for farm-wide standards, the quality assurance framework, compliance/assurance, and independent verification where applicable. Do not merge QA and QC. Do not place QA under Operations. Do not make QA an Operations approval step for convenience. NOT YET VERIFIED: the QA authority matrix (e.g., who may place or release quality holds).

### 1.4.12 Operations

CONFIRMED: cross-department coordination function — one of the most important parts of the system. Initial notes indicate responsibility for: workers, work/cost coordination, communication with departments, coordination of the overall operation, ERP/system coordination. Operations coordinates. It does NOT automatically own every department's authority. Department-specific responsibilities remain with their departments. QA remains independent.

### 1.4.13 Cattle Operation

CONFIRMED: a cattle operation exists as one of the farm functions. NOT YET VERIFIED: the entire operational workflow. Do NOT invent livestock workflows, feeding programs, veterinary processes, breeding records, etc.

### 1.5 Farm structure and crops — RESEARCH/REPORTED INPUT WITH INTEGRITY

FLAGS The independent industry study (desk research v1, 4 October 2026, pending on-site validation) reports a mixed operation: orchard, greenhouse, open field, plus packing house. Treat the following as reported figures with open integrity flags, not verified master data. Store them only through admin-entered master data with verification_status; do not seed them as fact. Reported areas: Orchard 1,918 D; Greenhouse 916.3 D; Open field 648.7 D (sum 3,483.0 D). Reported total: 3,628 D. Gap 145 D (~4%). Reported crop groupings: Orchard (banana, citrus, mango, mandarin, orange); Greenhouse (tomato, pepper incl. internal names below, cucumber, watermelon); Open field (tomato, eggplant, pumpkin). Exact crop list is NOT YET VERIFIED. Integrity flags to preserve (do not resolve in code):

#

Issue

Required system handling

D1

Area mismatch 3,628 vs 3,483 D

Store reported total and component areas separately; show an "unreconciled area" flag

D2

"Citrus" listed next to Mandarin and Orange

Keep "Citrus" as an alias; species/classification Not Yet Verified

D3

"Red blocky" vs "Redblocky"

Keep both original names as aliases; whether they are one item or two is Not Yet Verified

D4

"Sweet beet" (red, red large, yellow) and "Orange sweet bite"

Preserve original names; species To Be Confirmed On Site

D5

"Cherry tomato chocolate"

Variety vs market grade Not Yet Verified

D6

Tomato in both greenhouse and open field

Separate production-system records and costing

D7

Greenhouse 916.3 D gross structure vs net cropped area

area_basis field: gross / net / unknown

Crop master design: controlled hierarchy Species → Crop Type → Variety → Market Name/SKU, with the farm's original internal names stored as aliases. Research input on production rhythms (use for design, not as farm fact): Orchards: perennial annual cycles, block/row/tree-level management, seasonal harvest peaks. Greenhouses: continuous, high-frequency cycles, house/bay/row management, frequent harvests, daily-to-hourly data. Open field: seasonal, machinery-heavy cycles, field/plot/bed management, peaks at planting and harvest. Packing house: daily shifts tied to harvest and orders; line/shift/lot/pallet management; operates like a food facility. Jordan water context: renewable water ~145 m³ per capita (well below the 500 m³ severescarcity threshold) — water metering and allocation are core economic controls. Certification context: GLOBALG.A.P. IFA v6 requires production-unit recording with records kept at least two years. Which certifications this farm holds is NOT YET VERIFIED.

### 1.6 Packing house — CONFIRMED REFERENCES, UNVERIFIED DETAILS

Initial handwritten documentation identified: Pre-cooling fridge Sorting / grading lines Washing line "Ingro machine" — spelling/company name NOT YET VERIFIED MAT EXAKTA ELIFAB / TOMATO Aweta

Weighing and packaging Refrigeration / cold storage Current notes indicate:

1. Washing line – written as "Ingro machine"

2. MAT EXAKTA line/equipment

3. ELIFAB – Tomato

4. Aweta line/equipment

5. Weighing and packaging

6. Cooling / refrigeration

7. Pre-cooling / entry stage

8. Sorting / grading operations Rules: MAT EXAKTA, ELIFAB, Aweta and "Ingro machine" may be equipment manufacturers, machine names, or line/equipment identifiers. Do NOT assume they are all independent production lines. Do NOT invent their exact function. Exact spelling, manufacturer, model and process sequence are NOT YET VERIFIED. Do NOT hard-code a process sequence. Lines, stages and equipment are admin-configured data.

### 1.7 FarmERP research — RESEARCH INPUT ONLY (tier B, graded)

FarmERP is a genuine agriculture-native ERP with broad functionality. Research indicates strengths in farm/plot management, crop schedules, field data, QC, lots, export documentation, inventory, reporting and packhouse capabilities. The operational teardown identified possible weaknesses relevant to this project:

1. Field data entry can be burdensome for low-skill supervisors.

2. Mobile/offline experience may not meet field expectations.

3. Report and cost mismatches can create rework.

4. Implementation can require substantial customer effort.

5. Maintenance is not equivalent to a deep CMMS.

6. Crew / piece-rate labor is not always a core engine.

7. Performance/stability issues can matter.

8. Water economics are not sufficiently connected to farm economics.

9. Vendor dependency can exist for changes.

10. Foreman-first Arabic execution remains an opportunity. Evidence grading of the above:

Vendor-stated capability (FarmERP's own material): the strengths list. Not verified for this company's configuration. Customer-review evidence (small sample; not verified for this deployment): items 1, 2, 3, 4, 7, 9. Directional market insight (category-wide pattern from research, not specific to FarmERP): items 5, 6, 8. Hypothesis / opportunity: item 10. Confirmed at this company: only the usage facts in Part 1.2 (what FarmERP is used for, and that coordination relies on paper/WhatsApp/phone). The reasons are tier E. Classification: RESEARCH INPUT. Not absolute truth. Not a confirmed weakness of every FarmERP deployment, nor of this company's deployment. Not a software specification. The evidence included customer reviews and vendor material; some negative evidence came from a relatively small review sample, and severity ratings are research judgement. Make no competitive claims in the product, its UI or its docs. Use the research to steer toward opportunities: field usability, operational execution, trustworthy cost data, water/energy accounting, MENA labor (daily/seasonal/crew-based), machinery/maintenance, foreman-first Arabic execution, operational visibility. The product is still designed from the farm's actual requirements.

### 1.8 Market insight — RESEARCH INPUT

Many agricultural systems are strong at master data, planning, inventory, accounting and reporting. The hard part is the execution layer: the instruction given in the morning the task assigned to a crew the pump failure reported by phone the supervisor's field update the actual material consumed the actual work completed the exception the verification the final operational result This system is designed around that execution gap. Do not reproduce ERP master-data screens as the product. Research also notes the industry study considered four outcomes (A: configure FarmERP only; B: ERP plus specialists; C: ERP plus a single execution layer; D: process first, little software). This build is the execution-layer path. Keep the system thin where an ERP is strong (accounting, valuation) and deep where the execution gap is. Organizational problems (unclear decision rights, supervisors acting as human routers, approval habits) are not solved by software alone; do not digitize confusion — make ownership explicit.

### 1.9 Information that must never be fabricated

If information is not confirmed, do not guess. Use "Not Yet Verified" (‫ )غير مؤكد بعد‬or "To Be Confirmed On Site" (‫)ُيؤَّكد ميدانيًا‬. Never fabricate: farm data employee information, names, employee count exact well names; which wells are active; well statuses fleet counts machine models; equipment specifications exact packing-house process sequence exact company/manufacturer spelling crop list or crop information block structure KPIs or KPI definitions presented as company-approved chemical protocols irrigation quantities QA standards QC parameters organizational reporting lines or authority (including the QA authority matrix) Never turn an assumption into a fact.

## PART 2 — OPERATIONAL REQUIREMENTS

### 2.0 Common operational object contract

Primary objects are operational: Agricultural Task, Maintenance Request, Maintenance Work Order, Irrigation Task/Run, Material Issue, Fleet Assignment, Harvest Activity, Packing House Operation, QC Inspection, QA Review/Finding, Exception, Downtime Event. Every important operational object carries (via the shared engine, not re-implemented per module): owner department, owning person, location, planned date/time window, requester, planner, dispatcher/assigner, executor(s), verifier, approver (where policy requires), resources (labour, machine, material, water), status, execution data (actuals), exceptions, verification result, attachments/evidence, timestamps (device time and server time), and audit history. Reuse workflow patterns where appropriate; preserve departmental differences through task types and per-domain state machines. Not every department needs a large standalone module — several (e.g., Wells, Packing House Maintenance) are scoped views of shared engines plus a few specific entities.

### 2.1 Core product principle: execution, not storage

The core object is usually an operational task / work order / activity, not a passive record. A strong workflow answers: WHAT? WHO? WHERE? WHEN? WHY? RESOURCE? STATUS? RESULT? VERIFIED BY WHOM? Example — "Spray Block A" becomes: Task → assigned supervisor → assigned crew → planned date → required material → required equipment → execution → actual quantity → evidence → completion → verification → cost → KPI Example — "Pump failed" becomes: Problem Report → Asset → Location → Priority → Maintenance Work Order → Technician → Spare Parts → Repair → Test → Verification → Closure → Downtime → Cost

### 2.2 Required end-to-end workflows

Every major workflow must be operationally functional, not merely look correct. Do not force all modules into identical workflows; use domain-appropriate state machines (Part 3.5). Maintenance: Problem Report → Review → Prioritization → Work Order → Assignment → Execution → Parts / Materials → Labor → Completion → Verification → Closure Agricultural task: Plan → Assign Supervisor → Assign Crew → Assign Location → Assign Resources → Execute → Record Actuals → Record Exceptions → Complete → Verify → Close Irrigation: Plan → Source → Target Area → Schedule → Execute → Record Actual Water → Record Fertilizer Where Applicable → Exception → Completion → Verification Maintenance spare parts: Maintenance Work Order → Spare Part Request → Warehouse Issue → Consumption → Cost Plant protection (structure only; no protocols): Plan → Approve (where required) → Materials Issued from Main Warehouse → Applied → Actual quantities recorded → Verified; re-entry and pre-harvest interval windows (REI/PHI) recorded per application when values are entered by authorized users. Harvest → packing (structure): Harvest Order → Harvest Lot/Bin → Transport → Receiving at Packing House → Inspection (QC) → Accepted / Held / Rejected → Pack Lot → Storage → Dispatch. QA finding: Raised (by QA) → Acknowledged (by owning department) → Corrective Action → Verified by QA → Closed by QA only.

### 2.3 Department requirements

### 2.3.1 Main Warehouse

Support: agricultural materials, stock, receipts, issues (to tasks/departments), returns, transfers, adjustments with reason, stock movement history, issue requests from field tasks, field receipt confirmation, planned vs actual material per task. Min/max and reorder only when configured. Units, categories and locations are admin-defined.

### 2.3.2 Plant Protection

Support: protection activities, target area, crop/block, responsible person, application date, materials used, quantities, execution status, documentation, compliance/verification. Product, active ingredient, dose, REI, PHI fields exist but values are entered, never seeded. Where a PHI is recorded, harvest tasks on that block inside the window are blocked unless an authorized, logged override exists.

### 2.3.3 Agriculture / Agricultural Production

Support: agricultural work plans, daily tasks, work locations, supervisors, crews, assigned workers, execution records, productivity, materials consumed, machinery used, delays/problems, completion, verification. Activity types are configurable, not crop-specific code.

### 2.3.4 Movement / Fleet

Asset-type neutral. Asset classes: Vehicle, Machine, Equipment, Bus, Other transport asset (configurable). Support: asset register, assignment to tasks/departments, usage (hours, km), internal movement/transport requests, availability status visible to planners, link to maintenance history. No hard-coded count.

### 2.3.5 Wells

Each well has a status: Active, Inactive, Under Maintenance, Not Yet Verified, or another configured status. Status changes are logged with who/when/why. The system may record readings: meter, flow, pressure, operating hours, level, status changes, maintenance history. Units and reading types are configured. Wells belong under Irrigation & Water and Farm Assets.

### 2.3.6 Irrigation + Fertilizer Distribution

Support the chain: water source → irrigation plan → target area → schedule → execution → water distribution → fertilizer distribution where applicable → actual quantities → operator → completion → exceptions. Water accounting must eventually support source, area/block, quantity, date/time, cost where available, operational status. Research identified water accounting as an important MENA gap (wells, quotas, salinity, water cost linked to farm economics). Do not invent formulas.

### 2.3.7 Maintenance

Support: corrective maintenance, preventive maintenance, recurring maintenance, maintenance history, asset history, downtime, parts consumption, labor, costs, priority, SLA / due date. Every important action records user, timestamp, status, comments, evidence where applicable. A completed work order is NOT automatically verified; where appropriate, a different authorized person verifies. Do not turn it into a generic industrial CMMS — it stays agricultural and farm-aware (wells, pumps, irrigation, generators, tractors, packhouse equipment).

### 2.3.8 Maintenance Warehouse

Support: spare parts, maintenance materials, stock quantities, issue to work order, receiving, stock movements, minimum stock, reorder requirements, part-to-asset relationship where appropriate, part consumption history, maintenance cost traceability. Separate warehouse entity from the Main Warehouse; shared stock-movement engine is fine, merged inventories are not.

### 2.3.9 Packing House Maintenance

Support: packing-house asset register, equipment/line maintenance, breakdowns, work orders, preventive maintenance, spare parts, downtime, verification, maintenance history. Uses the maintenance engine with its own department ownership and asset scope.

### 2.3.10 QC

Support: sampling, sample identification, product/lot, inspection, measured values, standards, acceptance criteria, result, pass/fail/hold where verified, traceability, QC records. Inspection templates and parameters are configured by authorized users; none are invented.

### 2.3.11 QA

Support: standards library, assurance framework, audits, findings, corrective actions, compliance, independent verification. QA records are owned and closed by QA.

### 2.3.12 Operations

Operations must be able to see: what is planned, assigned, in progress, delayed, blocked, requires another department, completed, requires verification, what resources are being consumed, what needs escalation. Operations can create cross-department requests, coordinate, comment, escalate. It does not get approval/verification/closure authority inside a department unless explicitly granted through configuration.

### 2.3.13 Cattle Operation

Create the module capability (department, locations, assets, generic tasks via the work engine) with a visible "Not Yet Verified" state for detailed processes. No livestock-specific workflows until confirmed.

### 2.3.14 Packing House

Model as: Packing House → Area / Line → Equipment → Shift / Operation → Lot → Output → Quality → Downtime / Maintenance. Support receiving and weighing, shifts, pack lots (from one or many harvest lots, with quantities in and out), downtime events, cold storage/pre-cooling logs, link to QC and to Packing House Maintenance. No hard-coded sequence.

### 2.4 Organizational model

Design the system around: Farm → Areas / Locations → Agricultural Areas / Blocks / Fields → Assets → Departments → People / Roles → Tasks / Work Orders → Materials → Operations → Production → Quality → Maintenance → Outputs Modular but interconnected. Do not force every department into the same workflow.

### 2.5 Verification and segregation of duties

Distinguish on every relevant record: Requester, Planner, Dispatcher, Executor, Reviewer, Verifier, Approver. Where operationally appropriate, the person who executes work must not automatically be the person who verifies it. Do not allow one person to perform every control step simply because the UI is easier. Exceptions (e.g., a small crew where no second person exists) are admin-configured per task type and every use is logged. Approvals only where risk exists (research input): plant-protection application, pre-harvest release, quality hold/release, purchase above threshold, emergency spend, overtime. Routine tasks need no approval. Thresholds are configurable, not invented.

### 2.6 Exceptions and escalation

Any user can raise a Problem Report (asset or location, category, priority, photo, voice note, text). It is triaged by the owning department and becomes a Maintenance Request, Agronomic Observation, Quality Incident, or Operational Blocker. Unacknowledged or unresolved exceptions escalate by severity × time. Thresholds are configurable; defaults ship as "Not configured" rather than invented numbers.

### 2.6a Failure-path requirements (every workflow must handle these)

Connectivity lost mid-task → work continues offline; sync later (Part 3.7). Task delayed → becomes Overdue automatically (scheduler, Part 3.11) and appears on the owner and Operations boards. Material unavailable → task can be Blocked with reason "material"; links to the issue request. Equipment fails → Problem Report from inside the task; task Blocked with link to the work order. Work rejected at verification → returns to In Progress with reason; rejection count kept. Record changed after completion → only via audited correction with reason; verified records require re-verification if quantities change. Person absent → reassignment with audit; delegation rules in Part 3.6.

### 2.7 Traceability

The data model must support, from the beginning: Field / Block → Agricultural Activity → Inputs → Harvest → Lot → Packing House → QC → Storage → Dispatch / Sale Implementation follows actual business dependencies — do not build every downstream workflow before upstream processes are defined, but never design tables that would break the chain later.

### 2.8 Costing

Trustworthy operational costing is an identified opportunity. Architecture must eventually support costs by: farm, area, block, crop, task, material, machine, labor, water, maintenance, harvest, production lot. Analytical units may include cost per dunum, per tree, per kg, per m³, per lot. Do not implement calculations that depend on unverified data. Store quantities and units on every labour, machine, material, water and maintenance entry; rates are nullable, adminconfigured, and carry a source. Cost views display "Rate not configured" instead of a number when inputs are missing.

### 2.9 Auditability

Important operational actions must record: who, what, when, old value/status, new value/status, comments, supporting evidence where applicable. Critical operational records must never silently change. Records are voided with a reason, not hard-deleted. Retain records at least two years (research input: GLOBALG.A.P. IFA).

### 2.9a KPI rules

Define a KPI only when: the data exists in the system, the calculation is operationally meaningful, an owner is named, and the measurement can be trusted. KPI definitions (formula, unit, owner, data source, target) are stored as configuration with a verification status; targets are entered by the owner. Possible categories: Operations, Maintenance, Agriculture, Irrigation, Water, Fleet, Warehouse, Packing House, QC, QA, Labour. Ship definitions only for counts directly derived from records (e.g., tasks overdue, work orders open by priority, records awaiting verification). Everything else waits for owner validation.

### 2.10 Scope exclusions

Do not build unless a demonstrated operational requirement is confirmed by the owner: full general ledger, full payroll, invoicing, drones, variable-rate application (VRA), carbon accounting, unnecessary AI, unnecessary IoT, banking integrations. Research lists 18 broad capability areas (farm management, crop/orchard, field operations, irrigation, inventory, procurement, machinery, maintenance, workforce, harvest, production/processing, sales/invoicing integration, light finance/cost centres, traceability, analytics, mobile/offline Arabic, integrations, AI later) — that list is context, not a build list.

## PART 3 — SOFTWARE ARCHITECTURE

### 3.1 Foundation first

Do not build in a random feature-by-feature sequence. Establish, in this order, before modules:

1. Information architecture

2. Organizational model

3. Role model

4. Location model

5. Asset model

6. Operational object model

7. Workflow/state model

8. Permissions

9. Auditability

10. Localization

11. Data relationships Then build modules on top. Do not allow any single module to distort the architecture.

### 3.2 Recommended stack

If the repo already has a sound stack, keep it and adapt these principles. If starting fresh or the existing stack cannot meet the requirements, use: Layer

Choice

Frontend

React + TypeScript + Vite, installable PWA

UI

Tailwind CSS (logical properties only) + shadcn/ui (Radix primitives, RTL-capable)

i18n

i18next + react-i18next, ar default, en secondary

Data fetching

TanStack Query

Offline

IndexedDB via Dexie, Workbox service worker, mutation queue

Validation

Zod schemas shared between client and server

Backend

Supabase: Postgres, Auth, Row-Level Security, Storage, Edge Functions

Business rules

Postgres functions for state transitions; triggers for audit

Tests

Vitest, Playwright (mobile viewport, RTL + LTR), pgTAP for RLS and transitions

Record any stack decision that differs in docs/adr/.

### 3.3 Repository structure (target)

docs/ ARCHITECTURE_PLAN.md VERIFICATION_REGISTER.md adr/ supabase/ migrations/ seed/ structure-only seeds tests/ pgTAP src/ app/ routing, office shell, field shell core/ auth, rbac, i18n, offline, sync, audit, transitions, verificationengines/ work/ plans, work orders, tasks, entries, verification exceptions/ problem reports, triage, escalation inventory/ warehouses, items, stock movements (shared by both warehouses) modules/ command-center/ operations/ agriculture/ plant-protection/ irrigation-water/ maintenance/ maintenance-warehouse/ main-warehouse/ fleet/ packing-house/ qc/ qa/ cattle/ reports/ admin/ locales/ar/ locales/en/ tests/e2e/

Modules extend the shared engines. A module must not create its own parallel task, audit or permission system.

### 3.4 Data model

Design around real operational entities. Do not create an entity merely because it sounds like ERP terminology. Every entity must have a justified operational purpose; note the purpose in a comment on the migration. Candidate entities from the specification: Farm, Department, Location, Area, Block, Crop, Planting, Asset, Well, Irrigation Zone, Water Source, Task, Work Order, Maintenance Request, Maintenance Work Order, Material, Inventory Item, Warehouse, Stock Movement, Spare Part, Worker, Crew, Supervisor, Vehicle, Machine, Packing House, Line, Equipment, Production Lot, Harvest Lot, Sample, QC Inspection, QA Standard, Quality Result, Shift, Downtime Event, Cost Record, Document, Attachment, User, Role, Audit Log. Target structure (refine during Phase 0; justify deviations): Organization & people farms departments (code, name_ar, name_en, kind, is_independent — true for QA) users, roles, user_roles (role × department scope × optional location scope,

valid_from/valid_to)

delegations (from_user, to_user, scope, period, reason) for leave/coverage workers (may not have logins), crews, crew_members (time-bounded), contractors qualifications (e.g., applicator), optional gating of task types

Supervisor is a role/assignment, not a separate table. Locations & assets locations — self-referencing tree with type (farm, production_system, zone, block, house, field, sub_unit, packhouse_area, warehouse, other), area value + unit + area_basis. Depth

not hard-coded.

production_systems reference (Orchard, Greenhouse, Open Field, Packing House, Cattle,

Support) — configurable.

assets — class (Vehicle, Machine, Equipment, Bus, Pump, Generator, Packhouse

Equipment, Cold Room, Other transport asset, Other), parent_asset (line → equipment), location, owning department, status, status history. Vehicle, Machine and Equipment are asset classes, not separate tables. water_sources (Well, Reservoir, Network, Other) with wells subtype detail; well_status_history. irrigation_zones, irrigation_zone_locations (many-to-many, time-bounded). reading_types, readings (asset/well/zone, value, unit, time, by).

Crops species, crop_types, varieties, market_names, crop_aliases (original internal names) growing_cycles (location + variety + production system + dates) — this is "Planting".

Work engine plans (period, department, scope) work_orders (authorized work: purpose, location, window, resources) task_types (configurable, per department, typed field schema, verification policy) tasks (owner/supervisor, crew, location, planned date/window, status, requester, executor,

verifier)

task_checklist_items labour_entries (crew/worker, hours or units, pay-basis reference nullable) machine_entries (asset, hours/km) material_consumptions (item, planned qty, actual qty, unit, source stock movement) verifications (record, verifier, result, comment, evidence)

Exception engine problem_reports, triage_decisions, escalation_rules, escalations maintenance_requests, maintenance_work_orders, pm_schedules, downtime_events

Inventory engine warehouses (kind: main_agricultural | maintenance | other), item_categories, items (Material and Spare Part are item kinds), units, stock_movements (receipt, issue, return, transfer, adjustment with reason), issue_requests, item_asset_links (part-to-asset)

Plant protection ppp_applications (task, location, product item, active ingredient, dose, area treated,

weather notes, rei_until, phi_until, applicator) — all values entered. Harvest, packing, traceability harvest_orders, harvest_lots, bins/containers, receiving_records

packhouse_lines, packhouse_stages (configured, ordered by admin, no hard-coded sequence), packhouse_shifts pack_lots, pack_lot_inputs (n:m harvest lot → pack lot, quantities in/out), cold_storage_logs, pallets, dispatches

Quality inspection_templates, inspection_parameters, samples, inspections, quality_results, quality_holds qa_standards, qa_audits, qa_findings, corrective_actions

Costing rates (resource type, value, currency, unit, valid_from/to, source, verification_status). Cost

is derived, not typed in. Cross-cutting

attachments (photo, document, voice note; GPS, captured_at), comments (polymorphic), approvals, notifications, audit_events, settings, verification_register (mirrors the doc), sync_conflicts.

Polymorphic links (comments, attachments, approvals, verifications): store entity_type (checked against an enum) + entity_id, with a trigger verifying the parent exists and inheriting its RLS scope. Do not use them for core relationships — use real foreign keys there. Task-type specific fields: core fields are columns; domain-specific fields for high-value types (PPP application, irrigation run, harvest, maintenance) get their own 1:1 extension tables with real columns. A jsonb extra column validated by a per-type Zod/JSON schema is allowed only for low-volume configurable fields, never for anything reported, costed or traced. Time-bounded relationships (crew membership, irrigation zone ↔ block, user roles, rates): valid_from/valid_to with an exclusion constraint preventing overlapping periods; provide "as of date" query helpers. Quantities: numeric (never float), always paired with a unit id; item-level unit conversions (e.g., bag → kg) in item_units. Mandatory columns on operational and master tables: UUID primary key (client-generated for offline), farm_id, created_by, created_at, updated_by, updated_at, version (optimistic concurrency), voided_at, voided_by, void_reason. Mandatory columns on master data (locations, assets, wells, crops, items, lines, standards, templates): verification_status ∈ {verified, not_yet_verified, to_be_confirmed_on_site, conflicting}, verified_by, verified_at, source_note. Localized names: name_ar, name_en on master data (Arabic required, English optional).

### 3.5 State machines

Implement state machines as data + server-side enforcement: allowed_transitions(entity_type, from_status, to_status, required_permission, required_fields[], must_differ_from_role) transition_record(entity_type, id, to_status, payload, comment) Postgres function:

checks permission, required fields, segregation of duties, version; writes status, audit event, notifications. All status changes go through it. Client code never updates status directly.

Versioning: allowed_transitions rows belong to a workflow_version. Each record stores the version it started under. Changing rules creates a new version; in-flight records finish on their version unless an admin runs an audited migration. Local mirror for offline: the active transition rules are synced to the device so the field app can apply a transition provisionally (marked pending) and show correct buttons offline. The server is the final authority at sync. Different domains, different machines (starting definitions; adjust only with justification):

Task: Draft → Planned → Assigned → In Progress ⇄ Blocked → Completed → Pending Verification → Verified → Closed; plus Cancelled; Rejected-at-verification returns to In Progress. Task types may skip verification only when their policy says so. Maintenance Work Order: Requested → Under Review → Prioritized → Approved (if policy requires) → Scheduled/Assigned → In Progress ⇄ Waiting Parts → Completed → Tested → Pending Verification → Verified → Closed; plus Rejected, Cancelled. Irrigation run: Planned → Scheduled → In Progress → Completed (actual water, fertilizer where applicable) → Pending Verification → Verified; plus Exception/Interrupted. Plant-protection application: Planned → Approved → Materials Issued → Applied → Recorded → Verified; generates REI/PHI windows on the block. Harvest lot: Created → In Transit → Received → Inspected → Accepted | On Hold | Rejected. Quality hold: Placed → Under Review → Released | Rejected/Disposed (authority per QA matrix — Not Yet Verified, configurable). QA finding: Raised → Acknowledged → Corrective Action In Progress → Submitted → Verified by QA → Closed (QA only). Well / asset status: Active, Inactive, Under Maintenance, Not Yet Verified, + configured — status history with reason. Stock issue request: Requested → Approved (if policy) → Issued → Received/Confirmed | Partially Issued | Rejected.

### 3.6 Role-based access control

Role categories (not final HR titles; do not invent reporting lines): System Administrator Operations Manager Department Manager Supervisor / Foreman Maintenance Manager Maintenance Technician Warehouse User Irrigation User Fleet / Movement User QC User QA User Packing House User Management / Executive Viewer Permissions = role × department × location (optional) × object type × action (view, create, plan, dispatch/assign, execute, review, verify, approve, close, configure, void) × workflow state (an action may be allowed only in certain states).

Rules: Enforced in the database with Row-Level Security on every table, and mirrored in the UI. UI hiding is never the only control. QA users can raise findings, place holds (if the authority matrix allows), and close QA records. Operations has read-only on QA records and cannot close them. Operations Manager: cross-department read, create cross-department requests, escalate, comment. No department-internal approve/verify/close by default. Executive Viewer: read-only. Admin cannot silently edit operational history; admin edits are audited like any other. The permission matrix lives in a seed/migration as data and is documented in docs/. Users may hold roles in several departments; effective permission is the union, but segregation of duties is evaluated per record (holding two roles never lets you verify your own execution). Cross-department crews: a supervisor may record labour for workers from another department on their own task; the worker's home department sees it read-only. Delegations grant the delegator's scope for a period, are audited, and cannot be used to verify the delegator's own work. Packing House Maintenance is its own department with its own manager role; it shares the maintenance engine and is shown under Maintenance navigation only as a filtered view, not as a sub-unit of Maintenance. Server functions using elevated keys must pass and record the real acting user; never write audit rows as "service".

### 3.6a Authentication and devices

Real Supabase Auth (no fake auth). Sign-in by email or phone; phone OTP via SMS has permessage cost in Jordan — make the method configurable (tier C). Shared crew device: supervisor signs in; quick user switch by PIN on that device; each action records the acting user. Workers without logins are workers records (name, optional ID number stored with minimal access), selected from the crew list. Sessions must survive several days offline (refresh-token handling); on reconnect, revoked users are logged out and their unsynced items flagged. Logout clears local data; admin can revoke a device, which wipes its local store on next contact. Privacy: worker ID numbers and phone numbers visible only to roles that need them.

### 3.7 Offline and sync architecture

Local IndexedDB copy of the user's working set (today's tasks, their crew, relevant locations/assets/items). All writes go to a local mutation queue first, then sync when online. UUIDs created on device. Status transitions are re-validated on the server at sync. If rejected, the item moves to a visible conflict queue with the reason; never silently overwritten or dropped. Free-text/comments merge; status and quantities use server validation with optimistic version. Photos compressed on device, uploaded in background, linked by UUID. Visible sync indicator: online/offline, pending count, last synced, conflicts. The Supabase JS client does not queue writes offline: implement your own outbox. Each queued mutation has an idempotency key (UUID) so retries over weak links never apply twice; the server stores processed keys. Replay order: per record, in device-timestamp order; cross-record dependencies (e.g., create task then add labour) replay parent first. Store both client_recorded_at and server_received_at. Operational time (what KPIs and timelines use) is client_recorded_at, bounded by sanity checks against server time; large clock skew is flagged. Stock issued offline may drive balances negative; allow it, flag it for the warehouse to resolve, never silently reject field consumption. Cache policy: define which reference data is cached per role and how stale it may be; reference data changes push a version bump. Photo upload resumes after interruption; unsent photos are visible in the sync screen.

### 3.8 Audit implementation

Postgres triggers on all operational tables write audit_events (actor, action, entity_type, entity_id, before JSON, after JSON, comment, client timestamp, server timestamp, device id, GPS if provided). Audit log is append-only; no role can update or delete it. Admin Audit Log screen: filter by entity, user, department, date. Audit rows record acting_user_id (from JWT or explicit parameter in server functions), client_recorded_at, server_received_at, device_id, idempotency_key.

### 3.9 Localization architecture

All user-visible strings via i18n keys from the first commit. No hard-coded English (or Arabic) strings in components. dir set on <html> from the active locale; components use logical CSS (ms/me/ps/pe/start/end, text-start), never left/right. Directional icons flip in RTL.

Units: dunum primary area unit (1 dunum = 1,000 m²), hectare derived for display; m³ water; kg; local agricultural units configurable in a units table with conversions. Currency: JOD default; SAR configurable; currency stored with every rate. Timezone Asia/Amman; Gregorian dates by default, optional Hijri display; Western Arabic numerals by default with Eastern Arabic numerals as a setting; locale-aware number and date formatting. Master data has Arabic and English names; Arabic required. Arabic font with good legibility at small sizes and numerals (e.g., IBM Plex Sans Arabic or Noto Sans Arabic), self-hosted for offline. Arabic search normalization: treat alef variants (‫)أ إ آ ا‬, ta marbuta/ha (‫)ة ه‬, alef maqsura/ya (‫ )ى ي‬and diacritics as equivalent; implement in Postgres (normalized search column) and client-side filters. Bidi: wrap codes, numbers with units and mixed Latin text (e.g., "W-01", "MAT EXAKTA", "25 kg") in direction-isolated elements (<bdi> / unicode-bidi: isolate). Agricultural terminology glossary (docs/GLOSSARY.md, Arabic/English) maintained with the owner; terms in the glossary are tier D until the farm confirms the wording used on site. Tables in RTL: column order mirrors, numeric columns stay right-aligned-by-locale logic, horizontal scroll starts from the inline-start edge.

### 3.10 Integration readiness

Stable human-readable codes on locations, assets, items, crops, lots. CSV import for master data (with validation report; imported records default to not_yet_verified unless marked otherwise). CSV export per module (tasks, consumption, harvest lots, maintenance) for FarmERP or Excel. No live FarmERP integration until its scope and record-of-truth split are confirmed.

### 3.11 Scheduled and background jobs

Use pg_cron (or Supabase scheduled Edge Functions) for: marking overdue tasks, firing escalations, generating recurring tasks and preventive-maintenance work orders, expiring REI/PHI windows, and nightly integrity checks (negative stock, unverified completed records older than N days — N configurable). Generation is idempotent (unique key on schedule + period) so a re-run never duplicates work.

### 3.12 Notifications

Phase 1–2: in-app notification centre plus badge counts (works offline once synced). Web push optional where supported (on iOS only for installed PWAs). WhatsApp/SMS are tier E — do not integrate without owner decision. Notification rules are configuration tied to transitions and escalations.

### 3.13 Inventory engine rules

stock_movements is the immutable ledger and source of truth. stock_balances (item ×

warehouse × location) is updated in the same database transaction by a server function; nightly reconciliation compares ledger and balances. Movements are never edited; corrections are reversal + new movement with reason. Concurrency: row-level locking on the balance row during issue. Main Warehouse and Maintenance Warehouse are separate warehouses with separate permissions; the engine is shared. Valuation (unit cost) is optional and tier D; FarmERP may remain the valuation system.

### 3.14 Environments, deployment and operations

Environments: local (Supabase CLI + Docker), staging, production. Never point development at production. If the existing project is on a Lovable-managed Supabase project: first export the current schema as a baseline migration, do not rewrite applied migrations, and confirm with the owner which project is production. Secrets only in environment variables; .env.example committed, .env never. CI (e.g., GitHub Actions): lint, typecheck, unit tests, pgTAP, Playwright on every push; migrations applied to a fresh database in CI. Error monitoring (e.g., Sentry) for client and Edge Functions, without sending personal data. Backups / point-in-time recovery enabled on production; documented restore procedure. App versioning: visible version number; service-worker update prompt; old clients with pending outbox items must still sync after an update (version the sync API). Bundle budget: route-level code splitting; field shell initial JS kept small enough to load within ~3 s on throttled 3G.

### 3.15 Tenancy

Build for one farm/company now, with farm_id on all tables and RLS filtering by it, so a second site can be added later. Demo data lives in a separate Supabase project (or at minimum a separate farm that production users cannot access), never in the production farm.

## PART 4 — UX/UI REQUIREMENTS

### 4.1 Field-first and mobile-first

Real users include field supervisors and workers in agricultural environments. The system must be: mobile-first fast

simple Arabic-first RTL usable by people with limited technical training suitable for outdoor environments (sunlight, dust, gloves) resistant to weak connectivity capable of offline operation where appropriate capable of photo capture capable of simple voice input where technically appropriate (voice notes as attachments; speech-to-text optional later) Do not create a complicated office ERP interface and call it field-ready. Minimize data entry. A supervisor completes common tasks in seconds, not ten screens. Concrete rules: Common field actions in ≤ 3 taps: start task, complete task with quantity + photo, mark blocked with reason, report problem, scan QR. Touch targets ≥ 48 px; base font ≥ 16 px; high contrast; status always shown as icon + text + color (never color alone). Defaults pre-filled from the task (location, crew, planned materials); user edits only what changed. Pickers over typing; numeric keypad for quantities; units shown next to inputs. QR codes for blocks, assets, wells, bins and warehouse items open the record or "Report problem". One device per crew (supervisor-centric) is the assumed pattern; worker-level login optional.

### 4.2 Two shells

Field shell (supervisor, foreman, technician, irrigation/fleet/warehouse field users): My Day · Report Problem · Scan · My Crew · Sync status. Bottom navigation, large cards. Office shell (managers, Operations, QA, QC, admin, executives): full navigation (4.3), tables with filters, boards. Both shells are the same app with role-based routing.

### 4.3 Navigation architecture (starting point — validate against workflows)

1. Command Center / Dashboard

2. Operations — Daily Plan · Tasks · Assignments · Teams/Crews · Exceptions · Delays · Escalations

3. Agriculture — Areas / Blocks · Crops & Growing Cycles · Agricultural Activities · Plant Protection · Harvest

4. Irrigation & Water — Irrigation Plans · Irrigation Zones · Wells · Water Distribution · Fertilizer Distribution · Readings

5. Maintenance — Requests · Work Orders · Assets · Preventive Maintenance · Maintenance History · Packing House Maintenance (department-scoped view)

6. Maintenance Warehouse — Spare Parts · Stock · Issues · Receipts · Reorder

7. Movement / Fleet — Vehicles · Machinery · Buses · Equipment · Assignments · Usage · Transport Requests

8. Main Warehouse — Agricultural Materials · Stock · Issue Requests · Issues · Receipts

9. Packing House — Lines · Equipment · Shifts / Production · Lots · Downtime · Storage

10. Quality Control — Samples · Inspections · Results · Holds

11. Quality Assurance — Standards · Assurance · Audits · Findings · Compliance (visually distinct section signalling independence)

12. Cattle Operation — "To Be Verified"

13. Reports & Analytics

14. Administration — Users · Roles · Departments · Locations · Master Data · Verification Queue · Configuration · Audit Log The navigation must represent the farm's operational ecosystem. It must never become "Wells / Maintenance / Everything else". Menu items are filtered by role.

### 4.4 Dashboards — operational control centers

Do not create dashboards full of decorative charts. Every widget answers an operational question and links to the filtered list behind it. Questions management must be able to answer: What is planned? What is late? What is blocked? What broke? What is waiting for verification? Which department has unresolved work? Where are resources being consumed? What is affecting production? What requires management attention? Management dashboard: planned, delayed, blocked, critical exceptions, unresolved maintenance, work awaiting verification, resource consumption, operational performance. Operations dashboard: today's plan, assignments, overdue work, blocked work, crossdepartment dependencies, escalations. Department dashboards: role-specific. A maintenance manager does not see the QA dashboard; a field supervisor does not see the CEO view. Examples: Maintenance — open WOs by priority, waiting parts, overdue PM, downtime; QA — open findings, overdue corrective actions, records missing verification, PHI/REI compliance; Warehouse — pending issue requests, items below configured minimum; Supervisor — my tasks today, my crew, my blocked items. KPIs display "No target set" until a target is entered by an authorized user. No invented benchmarks.

### 4.5 Visual and interaction standards

Every button does something real or does not exist. Prohibited: fake buttons, fake forms, disconnected screens, hard-coded sample data presented as real, local-only state pretending to be persistent, meaningless dashboards, placeholder workflows, fake authentication, fake permissions, fake audit logs, fake inventory, fake work orders, fake status transitions. Unbuilt modules appear as clearly labelled "‫ غير ُمنَّفذ بعد‬/ Not Implemented" or "‫ في مرحلة الحقة‬/ Coming in a later phase" sections, and modules awaiting business discovery as "Not Yet Verified" — never as fake screens. Every list has empty, loading, error and offline states in both languages. Forms validate inline in the user's language. Verification badges ("Not Yet Verified") are visible on master records and anywhere their values are used. Demo/sample data, if used, is visually marked and lives in a separate demo farm/tenant, never mixed with real data.

### 4.6 The 6:00 AM test

Before approving any architecture or screen, ask: "Would this actually work at 6:00 AM when a farm supervisor has 20 workers, a machine is unavailable, irrigation needs to start, a maintenance problem has been reported, and Operations needs to know what is happening?" If the answer is no: redesign it.

## PART 5 — ENGINEERING RULES

### 5.1 DO NOT

fabricate farm data fabricate employee information fabricate equipment specifications fabricate crop information fabricate well statuses fabricate fleet counts fabricate irrigation quantities fabricate chemical protocols fabricate QA standards fabricate QC parameters fabricate organizational reporting lines fabricate KPIs and pretend they are company-approved

create fake functionality create fake buttons create non-functional workflows hard-code business data unnecessarily build decorative dashboards with no operational purpose create a wells-centric architecture blindly copy FarmERP blindly preserve a flawed existing prototype create a generic ERP build all modules blindly in one pass (no big-bang coding) treat Arabic as a later translation phase reference or borrow from FactoryOps hard-delete operational records let the client write status columns directly store operational data only in local state or localStorage pretending it is persisted use floats for quantities or money apply anything to production without owner approval

### 5.2 DO

inspect the existing code inspect the database/schema inspect authentication inspect routing inspect components inspect current workflows identify architectural weaknesses reuse technically sound code where appropriate refactor poor architecture where necessary create real persistent data models implement real workflows implement validation (client and server) implement RBAC (database-enforced) implement audit logs implement state transitions implement Arabic RTL

implement English LTR test important workflows distinguish sample/demo data from real data preserve uncertainty using "Not Yet Verified" document unresolved questions in docs/VERIFICATION_REGISTER.md prioritize operational usability

### 5.3 Seed data policy

Production seeds contain structure only: the 13 departments + Packing House unit, role categories, permission matrix, statuses, allowed transitions, units, asset classes, verification statuses. Wells: either 14 records with temporary codes (W-01 … W-14, flagged as temporary and replaceable by the farm's real identifiers), names empty, status Not Yet Verified — or none, imported by admin. Never mark any well Active in a seed. No seeded crop list, fleet, staff, KPIs, rates, chemicals, QC parameters or QA standards. Reported figures from Part 1.5 may be loaded only via an explicit admin import flagged not_yet_verified/conflicting. Demo data (for development and screenshots) lives in a separate demo seed and a separate demo farm, clearly labelled "‫ بيانات تجريبية‬/ Demo Data" in the UI. Never run it in production.

### 5.4 Code standards

TypeScript strict mode. No any in domain code. Generated database types; Zod schemas for all inputs. One migration per logical change, reversible where practical; never edit applied migrations. Each table migration includes a comment stating its operational purpose. Domain logic in engines/server functions, not in React components. Every new string has ar and en keys before merge. Lint, typecheck and tests pass before a phase is considered complete. Small, reviewable commits with clear messages.

## PART 6 — EXISTING PROTOTYPE HANDLING

The repository may already contain a prototype (e.g., started in Lovable) emphasizing: sign-in, 14 wells, maintenance, foundation, maintenance requests, work orders, assignment, execution, verification, dashboard, departments, QA independence. This prototype is not the authoritative architecture. Its wells-heavy structure is a build-order artifact, not a statement that wells are the core product. It must not dictate the final structure.

You must:

1. Inspect it fully (schema, auth, routes, components, workflows, data, RLS, tests).

2. Classify each part: Keep (sound, fits the architecture), Refactor (useful logic, wrong structure), Replace (wells-centric, hard-coded, fake or non-functional).

3. Likely keeps (verify): authentication, maintenance request → work order → assignment → execution → verification logic, the QA-independence concept, departments.

4. Required changes if the prototype is wells-centric: Move wells under Irrigation & Water and Farm Assets; remove wells from the top-level navigation and dashboard center. Remove any assumption that all 14 wells are active; set unknown statuses to Not Yet Verified. Migrate maintenance onto the shared work/exception engines and the type-neutral asset register. Introduce the location tree, departments model, RBAC with department scope, audit triggers, transitions table, i18n/RTL. Rebuild navigation per Part 4.3.

5. Preserve any real data already entered; write data migrations rather than dropping tables.

6. Document decisions in docs/adr/0001-prototype-assessment.md. The final architecture is centered on AGRICULTURAL OPERATIONS EXECUTION AND CONTROL.

## PART 7 — IMPLEMENTATION PHASES

### 7.1 Phase 0 — Repository inspection + architecture validation

Do: Inventory the repo: stack, packages, folder structure, schema/migrations, auth, routing, components, state, existing workflows, tests, env/deploy config. Run the app and the existing tests; note what works and what is broken or fake. Assess the prototype (Part 6). Write docs/ARCHITECTURE_PLAN.md (concise, ≤ ~3 pages): current state, keep/refactor/replace list, target architecture summary, data model deltas, migration strategy, phase order with any justified changes, risks. Create docs/VERIFICATION_REGISTER.md seeded with every Not Yet Verified item in Part 1 (wells, fleet, crops D1–D7, packhouse sequence and spellings, QA authority matrix, QC parameters, warehouse SKUs, irrigation network, cattle processes, certifications, record-oftruth split with FarmERP, connectivity, labour model). Then proceed directly to Phase 1 unless a Part 0.3 pause condition applies.

Phase 0 required outputs (in docs/): ARCHITECTURE_PLAN.md (including every item listed in Part 0.3 step 6), DOMAIN_MODEL.md (entity list with the workflow that justifies each, ER diagram in Mermaid), PERMISSIONS.md (matrix), STATE_MACHINES.md (Mermaid per domain), VERIFICATION_REGISTER.md, GLOSSARY.md, adr/0001-prototype-assessment.md, and an environment plan. Keep each concise; they are working documents.

### 7.2 Phase sequence

Phase

Scope

0

Repository inspection + architecture validation

1

Foundation: authentication, users, roles, permissions, departments, locations, assets, master data (incl. crop master with aliases, water sources/wells as records), verification statuses + Verification Queue, audit trail, state-transition engine, Arabic/RTL, English/LTR, PWA shell (field + office), offline/sync skeleton, admin screens, CSV import

2

Operations: daily planning, plans/work orders/tasks, assignments, supervisors, crews, execution capture (labour, machine, material, readings, photo, voice note, GPS), exceptions/problem reports, delays/blocked, escalation, verification with segregation of duties, Operations board and dashboards

3

Agriculture: areas/blocks, growing cycles, agricultural activities, plant protection (applications, REI/PHI windows), harvest orders and lots with PHI gating

4

Irrigation: irrigation plans, wells (status history, readings), irrigation zones, water distribution, fertilizer distribution

5

Maintenance: assets, maintenance requests, work orders, preventive maintenance, testing, verification, downtime, history; Packing House Maintenance scope

6

Maintenance Warehouse: spare parts, stock, receipts, issues to work orders, consumption, minimum stock/reorder, cost linkage

7

Movement/Fleet: vehicles, machinery, buses, equipment, assignments, usage, transport requests, availability in planning

8

Packing House: lines, stages (configured), equipment, shifts/production, receiving, lots (harvest → pack lot), downtime, cold storage

9

QC + QA: samples, inspections, results, holds; standards, audits, findings, corrective actions; independent QA enforced

10

Analytics + management control: KPI framework with owner-entered targets, costing views with verified rates, exports, FarmERP integration once scope is confirmed

—

Main Warehouse (agricultural materials, issue requests, field receipt) is required by Phase 3 plant protection and Phase 2 material consumption; implement its core (items, stock movements, issues) no later than Phase 3 and complete it alongside Phase 6 on the shared inventory engine

—

Cattle Operation: placeholder from Phase 1; detailed only after processes are confirmed

You may change this sequence if actual code dependencies or verified operational requirements justify it. Record the reason in docs/ARCHITECTURE_PLAN.md. Phases 1–2 are the core of the product. If Phase 2 does not pass the 6:00 AM test, fix it before adding more modules.

### 7.3 No big-bang coding — per-phase loop

Before major code in a phase, run the self-check (Part 7.4). For each phase:

0. State what is being built and why, and its dependencies.

1. Inspect dependencies.

2. Implement (migrations → server functions/RLS → engines → UI → i18n).

3. Test (Part 8).

4. Verify data relationships.

5. Verify permissions.

6. Verify mobile UX.

7. Verify Arabic RTL (and English LTR).

8. Fix issues.

9. Update docs/ARCHITECTURE_PLAN.md and docs/VERIFICATION_REGISTER.md.

10. Write a short phase report (docs/phase-reports/phase-N.md): built, tested, known gaps, assumptions, items needing site verification.

11. Verify that existing functionality from earlier phases still works (full regression suite).

12. Move to the next phase. Do not implement more than one phase at a time. Within a phase, build one workflow end to end (data → logic → permissions → UI → tests) before starting the next workflow.

### 7.4 Self-check before writing major code

For each requirement you are about to implement, answer in the phase plan: Is this requirement confirmed (tier A) or which tier is it? Is this a real operational need? Who owns this process? Who executes it? Who verifies it? What data is required, and does it exist? What happens if connectivity is lost? What happens if the task is delayed? What happens if material is unavailable? What happens if equipment fails? What happens if the work is rejected? What happens if someone changes the record? How is the result measured? Does this belong in this module? Am I inventing anything?

If any answer is unclear, implement the configurable structure, mark the item as Requires OnSite Discovery in the Verification Register, and do not guess the value.

## PART 8 — TESTING, VALIDATION AND QUALITY GATE

### 8.1 Test layers

Database (pgTAP): RLS per role and department; QA independence (Operations cannot update/close QA records); segregation of duties (executor cannot verify own task unless exception configured and logged); every allowed and every forbidden transition; audit rows written on change; audit table immutable; voiding instead of deleting. Unit (Vitest): engines, validation schemas, unit conversions (dunum ↔ m² ↔ hectare), cost derivation returns "not configured" when rates are missing, sync queue and conflict handling. End-to-end (Playwright): run in Arabic RTL and English LTR at 390×844 (phone) and 1440×900 (desktop). Minimum scenarios by Phase 2: Supervisor works offline: opens My Day, starts a task, records crew hours, material and a photo, marks complete; goes online; sync succeeds; Operations board updates. Problem report from QR scan in ≤ 3 taps → triaged to Maintenance → work order → assigned → completed → verified by a different user → closed; full audit trail present. Blocked task with reason appears on Operations dashboard; escalation fires per configured rule. Offline status transition rejected by server lands in conflict queue with a readable reason. Unverified master data shows "Not Yet Verified" badge; wells are not shown as all active. Later phases: PHI gating blocks harvest; spare part issue updates stock and links cost to WO; harvest lot → pack lot quantities reconcile; QA finding can only be closed by QA. Visual/RTL checks: no left/right CSS in source (lint rule), mirrored icons, tables and modals correct in RTL, numbers/dates formatted per locale. Escalation tests use a test-only escalation rule fixture, since production defaults ship unconfigured. Offline tests: Playwright context.setOffline(true); idempotency (replay same mutation twice → one effect); clock-skew flagging; negative-stock flag on offline issue. Scheduler tests: recurring generation is idempotent; overdue marking. Workflow-version tests: in-flight record completes under its original version. Arabic search tests: normalization variants return the same result. Performance: field screens interactive within ~3 s on a mid-range Android over a throttled 3G profile.

### 8.2 Definition of no fake functionality

A feature is not done if any visible control does nothing, any list shows hard-coded rows, any status changes without the transition engine, or any number shown is invented. Search the codebase for placeholder handlers, TODO buttons and mock arrays before closing a phase.

### 8.3 Quality gate (every major module)

Check

Question

FUNCTIONALITY

Can users actually perform the workflow end to end?

DATA

Is data persisted correctly? Are relationships correct?

SECURITY

Are permissions enforced in the database, not only the UI?

WORKFLOW

Are state transitions correct, including forbidden ones?

AUDIT

Is every important action traceable (who, what, when, old, new, comment, evidence)?

UX

Can a field user complete the common action quickly (≤ 3 taps)?

LOCALIZATION

Does Arabic RTL work correctly? Does English LTR?

MOBILE

Does the workflow work on a phone, including offline where appropriate?

OPERATIONAL REALISM

Would this work in a real Middle Eastern commercial farm at 6:00 AM?

REGRESSION

Do all earlier-phase workflows still pass?

DATA HONESTY

Is every unconfirmed value shown as Not Yet Verified rather than invented?

If any answer is NO, the module is not complete.

## PART 9 — FINAL CODING BEHAVIOUR

Throughout the project, behave as an autonomous senior coding engineer: inspect before changing plan before large implementation code real functionality test continuously refactor when required preserve data integrity avoid hallucinated business logic avoid unnecessary scope keep architecture modular keep the application agriculture-native keep the user experience field-first keep Arabic RTL first-class

maintain a clear audit trail Do not try to impress by adding hundreds of features. Optimize for operational control, not feature count. The system must be: operationally correct, simple for field users, powerful for management, auditable, modular, agriculture-native, Arabic-first, RTL, mobile-first, practical under weak connectivity, scalable, based on actual workflows, and resistant to organizational ambiguity. Do not build software that merely looks like an ERP. Build an actual Agricultural Operations Management System.

### 9.1 Discovery backlog

Seed docs/VERIFICATION_REGISTER.md with every item below (tier D or E), each with: id, question, tier, owner to ask (if known — otherwise "Not Yet Verified"), affected modules, status, answer, date, source. Organisation & authority: department responsibilities not yet documented; reporting lines; QA authority matrix (holds, releases, sign-offs); who verifies each task type; approval thresholds; Operations' exact authority; headcount; labour model (contractor share, daily/seasonal/piecerate pay basis, attendance method). Land & crops: total area 3,628 vs 3,483 D and the 145 D gap (D1); "Citrus" contents (D2); "Red blocky"/"Redblocky" (D3); "Sweet beet"/"Orange sweet bite" species (D4); "Cherry tomato chocolate" variety vs grade (D5); separate GH/open-field tomato records (D6); greenhouse gross vs net area (D7); block/house/field structure and naming; growing cycles and seasons. Water & irrigation: name/code and real status of each of the 14 wells; meters and reading types per well; irrigation network (zones, valves, pumps, reservoirs); fertigation equipment and controllers (brand, data export); measurement units; water licences/quotas; salinity monitoring; energy source per pump. Assets & fleet: fleet inventory by class; machine models; generators; critical asset list; current maintenance request route; existing asset register; PM practices. Warehouses: item categories, units, pack sizes, storage locations, min/max policies for Main Warehouse and Maintenance Warehouse; how issues/returns work today; FarmERP's role in each. Plant protection: registered products list, who prescribes, who approves, how REI/PHI are tracked today, applicator qualifications. Harvest & packing house: harvest recording today; bins/containers; lot logic; exact spelling, manufacturer and function of "Ingro machine", MAT EXAKTA, ELIFAB, Aweta; process sequence; line count; grader/labelling software; cold-store monitoring; dispatch documents. Quality: QC parameters, sampling plans, acceptance criteria; QA standards held; certifications held (e.g., GLOBALG.A.P. IFA, GRASP, BRCGS/IFS, SMETA — which, if any) and target markets. Cattle: all processes. Systems & infrastructure: FarmERP modules live, who enters data, delay after the event, device used; system of record per data type; integration options; 4G/Wi-Fi coverage map; device types available to supervisors; preferred sign-in method; notification channels (WhatsApp/SMS permitted?). Measurement: which KPIs management wants, owners and targets; cost rates (labour, machine hours, water, energy) and their sources; currency needs beyond JOD.

Regulation: national pesticide registry, labour rules, water licensing (insufficient evidence today). Pain points: top 10 problems ranked separately by managers, supervisors and workers. Begin now with Phase 0: inspect the repository, write docs/ARCHITECTURE_PLAN.md and docs/VERIFICATION_REGISTER.md, then start Phase 1 implementation.

## PART D — IMPLEMENTATION CONTROL RULES

Give these to Claude together with Part C (they are also embedded in Part C, Parts 0.3, 5, 7 and 8). Paste them into CLAUDE.md in condensed form.

1. One phase at a time. Do not start phase N+1 until phase N passes the Quality Gate and the full regression suite.

2. One workflow end to end at a time inside a phase: migration → RLS → server functions/transitions → engine → UI → i18n (ar + en) → tests. Don't spread half-built screens across modules.

3. State the plan before each phase: what is being built, why, which evidence tier each requirement has, its dependencies, and the self-check answers (Part C §7.4).

4. Inspect before changing. Read the existing code, schema and tests touched by the change before editing.

5. Database first, UI last. No screen is built for data that doesn't yet persist with RLS and audit.

6. Status changes only through transition_record(). No direct status updates from client or ad-hoc SQL.

7. No fabrication. Any value without tier A evidence is a configurable field shown as "Not Yet Verified". Log every working assumption (tier C) in the Verification Register in the same commit.

8. No fake functionality. Unbuilt features are labelled "Not Implemented" or "Coming in a later phase". Before closing a phase, search the codebase for mock arrays, no-op handlers, TODO buttons and localStorage persistence.

9. Production is protected. Never run migrations, seeds or destructive scripts against production, and never change production secrets, without explicit owner approval in the conversation. Work in local and staging.

10. Never rewrite applied migrations. Add new migrations only. Data migrations preserve existing records; dropping a table with data requires owner approval.

11. Small commits with clear messages, each leaving lint, typecheck and tests green.

12. Tests travel with code. Every new transition has an allowed test and a forbidden test. Every new table has RLS tests. Every field workflow has a Playwright run in Arabic RTL at phone size, plus offline where applicable.

13. Regression every phase: the full e2e suite from all earlier phases must pass.

14. Stop and ask only for the Part C §0.3 pause conditions. Otherwise record the question in the Verification Register and continue with a configurable structure.

15. Write a phase report (docs/phase-reports/phase-N.md) covering what was built, tests run, known gaps, tier C assumptions added, and discovery items affected.

16. Keep CLAUDE.md current: current phase, open blockers, and the non-negotiable rules.

17. No scope creep: anything outside the current phase or the exclusions list (GL, payroll, invoicing, drones, VRA, carbon, IoT, AI, banking) needs owner approval.

18. Architecture changes need an ADR (docs/adr/) explaining the reason, the alternatives considered and the consequences.

## PART E — DISCOVERY BACKLOG

Information that must be confirmed at the farm. Tier D = known to exist, details unknown. Tier E = requires on-site discovery. None of these may be invented in code. #

Area

Item to confirm

Tier

Blocks / affects

E1

Organisation

Responsibilities not yet documented for each of the 13 departments

D

Permissions, task types

E2

Organisation

Reporting lines (none may be invented)

E

Approvals, dashboards

E3

Organisation

QA authority matrix: who places/releases holds, signs off, closes findings

E

QC/QA phase, holds

E4

Organisation

Who verifies each task type; where a single person may selfverify

E

Segregation-of-duties config

E5

Organisation

Approval points and thresholds (spray, PHI release, purchase, emergency spend, overtime)

E

Workflow config

E6

Organisation

Exact authority of Operations beyond coordination

E

Permission matrix

E7

Labour

Headcount; contractor share; daily / seasonal / piece-rate pay basis; attendance method

E

Labour entries, costing

E8

Land

Total area 3,628 vs 3,483 D; what makes up the 145 D gap (D1)

D

Area master, cost per dunum

E9

Crops

Contents of "Citrus" vs Mandarin/Orange (D2)

D

Crop master

E10

Crops

"Red blocky" vs "Redblocky": one item or two (D3)

D

Crop master

E11

Crops

Species behind "Sweet beet" (red, red large, yellow) and "Orange sweet bite" (D4)

D

Crop master

E12

Crops

"Cherry tomato chocolate": variety or market grade (D5)

D

Crop master, packing

E13

Crops

Confirm separate records for greenhouse and open-field tomato (D6)

D

Production systems, costing

E14

Land

Greenhouse 916.3 D: gross or net area (D7)

D

Yield KPIs

E15

Land

Block / house / field structure and naming; sub-units used (rows, bays, beds, trees)

E

Location tree

#

Area

Item to confirm

Tier

Blocks / affects

E16

Crops

Full verified crop and variety list; seasons and growing cycles

E

Agriculture phase

E17

Wells

Name/code of each of the 14 wells

D

Wells records

E18

Wells

Actual status of each well (active / inactive / under maintenance / other)

D

Irrigation planning

E19

Wells

Meters and reading types per well; units; reading frequency

E

Readings

E20

Water

Water licences/quotas; salinity monitoring; energy source per pump

E

Water accounting

E21

Irrigation

Network structure: zones, valves, pumps, reservoirs; zone ↔ block mapping

E

Irrigation phase

E22

Irrigation

Fertigation equipment and controllers (brand, data export options); measurement units

E

Fertilizer distribution, integration

E23

Fleet

Fleet inventory by class (vehicles, machinery, equipment, buses); models

D

Fleet phase

E24

Maintenance

Generators, electrical systems, critical asset list (top 20)

E

Asset register, PM

E25

Maintenance

How maintenance requests are raised and routed today; existing asset register; PM practices

E

Maintenance workflow

E26

Packing House Maint.

Packing-house asset hierarchy; split of responsibility with general Maintenance

D

PH maintenance scope

E27

Main Warehouse

Item categories, units and pack sizes, storage locations, min/max policies, issue/return practice

D

Inventory

E28

Maint. Warehouse

Spare-part catalogue structure, part-to-asset links, reorder practice

D

Inventory

E29

Plant Protection

Product list in use, who prescribes and approves, how REI/PHI are tracked today, applicator qualifications

E

PPP records, harvest gating

E30

Harvest

How harvest is recorded today (and in FarmERP); bins/containers; lot numbering logic

E

Harvest lots, traceability

E31

Packing House

Exact spelling, manufacturer and function of "Ingro machine", MAT EXAKTA, ELIFAB (Tomato), Aweta

D

Equipment register

E32

Packing House

Process sequence; number of lines; which equipment belongs to which line

E

Lines/stages config

E33

Packing House

Grader/labelling software; cold-store and pre-cooling monitoring; dispatch documents

E

Integration, storage logs

E34

QC

Quality parameters, sampling plans, acceptance criteria per product

E

Inspection templates

E35

QA

Standards in force; certifications held (e.g., GLOBALG.A.P. IFA, GRASP, BRCGS/IFS, SMETA, if any); target markets

E

QA module, retention policy

E36

Cattle

All cattle operation processes

E

Cattle module

E37

FarmERP

Which modules are live; who enters data; delay after the event; device used

E

Integration boundary

#

Area

Item to confirm

Tier

Blocks / affects

E38

FarmERP

System of record per data type (materials, distribution, harvest, cost)

E

Duplicate-entry prevention

E39

Infrastructure

4G/Wi-Fi coverage map (fields, wells, packing house, warehouses)

E

Offline cache policy

E40

Infrastructure

Devices available to supervisors and technicians (Android/iOS, shared or personal)

E

PWA targets, auth

E41

Infrastructure

Preferred sign-in method (email, phone OTP); acceptable SMS cost

E

Auth

E42

Communication

Whether WhatsApp/SMS notifications are permitted or wanted

E

Notifications

E43

Measurement

KPIs management wants; owners; targets

E

Dashboards

E44

Costing

Rates for labour, machine hours, water, energy; their sources; currencies beyond JOD

E

Costing views

E45

Regulation

National pesticide registry, labour rules, water licensing (insufficient evidence today)

E

Compliance fields

E46

Terminology

Arabic terms actually used on site for departments, tasks, statuses, locations

E

Glossary, UI labels

E47

Pain points

Top 10 problems ranked separately by managers, supervisors and workers

E

Phase priorities

E48

Data

Any real data already entered in the existing prototype that must be preserved

E

Migration plan

