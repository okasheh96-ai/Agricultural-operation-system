# Requirement matrix — packhouse operations build

Label: **SOP** SOP baseline (as quoted in PH-OAS-SPEC-001) · **AMD** approved amendment · **DRF** draft proposal ·
**OWN** owner-requested feature (2026-11-21 instruction) · **EX** example (tests behaviour, not a rule) · **CON** unresolved conflict.
Status: planned → built → tested · blocked (reason) · pending (not reached this session).
Roles: PHM Packhouse Manager · PE Production Engineer · LL Line Supervisor · QCI/QCM QC · QAO/QAM QA · DEC receiving/data
entry · WHM/STK warehouse · MNT maintenance · CLN cleaning · SAL sales · OWN owner.

## Roles and KPIs (S-04 English p.1–4; S-05 Arabic; S-06 Arabic)

| ID | Requirement | Source | Label | Workflow | Role | Acceptance test | Status |
|---|---|---|---|---|---|---|---|
| R-LS-01 | Instructions only from PE (PHM if absent); QC contact is relayed to PE; QC correction only on PE/PHM instruction | S-04 p1 §1 | DRF | QC observation routing → PE/PHM → LL instruction | LL, PE, QCI | pgTAP 19 routing | planned |
| R-LS-02 | Hygiene/workwear check at shift start and whenever a worker joins | S-04 p1 §2 | DRF | Line-shift start checklist; join check per worker | LL | e2e supervisor | planned |
| R-LS-03 | Line discipline (no earbuds/phones); correct breaches | S-04 p1 §3 | DRF | Violation log (restricted) | LL, PHM | pgTAP accountability | planned |
| R-LS-04 | Line readiness and packaging inside packhouse before shift; report shortages | S-04 p1 §4 | DRF | Readiness checklist; packaging readiness per order | LL, PE | e2e readiness | planned |
| R-LS-05 | Daily labour sheet: worker ID, line, task, start/end, order, box count, pack weight; shared work once by grade and pack weight; record count and time at each membership change | S-04 p1 §5 | DRF | Labour intervals, output entries, team periods | LL | pgTAP 19 KPI cases | planned |
| R-LS-06 | Walk line; check machine weight setting; weigh first finished pack at each order or pack-weight change | S-04 p1 §6 | DRF | First-pack weight check required on change | LL | pgTAP 19 | planned |
| R-LS-07 | Export packing monitor understands order and does checks | S-04 p1 §7 | DRF | Export monitor assignment per order | LL | e2e | planned |
| R-LS-08 | Compare output with targets; remaining kg before loading; alert PE on likely delay | S-04 p1 §8 | DRF | Remaining-to-pack vs loading time; at-risk flag | LL, PE | e2e overview | planned |
| R-LS-09 | Clear waste/empty boxes to collection points; tell PE when collection needed; confirm clearance | S-04 p1 §9 | DRF | Waste collection request → pickup → clearance | LL, PE | e2e | planned |
| R-LS-10 | Report faults, weight discrepancies, packing errors, worker issues to PE; reconcile boxes with full/partial pallets; submit sheet | S-04 p1 §10 | DRF | Issue report; shift close with box reconciliation; submission | LL | pgTAP 19 | planned |
| R-PE-01 | Inspect cold rooms, confirm stock; brief supervisors (sequence, crop, customer, qty, packaging, staffing) | S-04 p2 §1 | DRF | Shift takeover: stock count, briefing per line | PE | e2e | planned |
| R-PE-02 | Follow up receiving and pre-cooling; spot-check corrected labels (EN only, C-01) | S-04 p2 §2 | DRF/CON | Readiness view from receiving records | PE | e2e | planned |
| R-PE-03 | Plan packaging, pallets and changeovers; warehouse delivery within 24 h and before next shift | S-04 p2 §3 | DRF | Packaging requests: requested / received / issued / returned / short | PE, WHM | pgTAP materials | planned |
| R-PE-04 | Coordinate QC per line: inspected against order, packaging, pack weight, label, QC label | S-04 p2 §4 | DRF | QC-2 (exists) + line QC follow-up | PE, QCI | existing pgTAP 16 | built (QC-2) |
| R-PE-05 | Follow up QA holds; confirm release by authorised quality team before resuming | S-04 p2 §5 | DRF | Holds block production/dispatch until QA release | PE, QAO | pgTAP 20 | planned |
| R-PE-06 | Inspect supervisors and workers (staffing, hygiene, workwear, phones) | S-04 p2 §6 | DRF | PE walk checklist | PE | e2e | planned |
| R-PE-07 | Daily cleaning checks; weekly review of cleaning and PM schedules | S-04 p2 §7 | DRF | Cleaning/maintenance board, weekly review task | PE, CLN, MNT | pgTAP 23 | planned |
| R-PE-08 | Log line downtime (line, stop, fault), notify PHM, record restart, total, confirmed cause | S-04 p2 §8 | DRF | Downtime event + notification | PE, PHM | pgTAP 19 | planned |
| R-PE-09 | Coordinate waste tractor pickups | S-04 p2 §9 | DRF | Waste collection scheduling | PE | e2e | planned |
| R-PE-10 | Track productivity, loading and orders at risk; propose plan changes; brief after approval | S-04 p2 §10 | DRF | At-risk orders; plan revision with reason and approval | PE, PHM | pgTAP 19 revisions | planned |
| R-PE-11 | Hand over active orders, quantities, holds, stoppages; collect all shift sheets; compute three KPIs; daily report | S-04 p2 §11 | DRF | Shift handover; daily KPI report | PE, PHM | e2e report | planned |
| R-KPI-1 | Individual productivity = conforming kg ÷ actual packing hours; conforming kg = Σ conforming boxes × net kg/box; exclude other duties | S-04 p3 §1 | DRF | KPI function | PE, PHM | pgTAP 19: 40 × 7 kg / 4 h = 70 kg/h; mixed 5/7 kg = 60; moved worker 47.5 | tested (DB) |
| R-KPI-1b | Shared production: team kg ÷ total worker-hours; Sweet Bite G1/G2 counted separately; split at join/leave; per-period boxes ÷ members = allocated average; daily = Σ kg ÷ Σ hours across shifts | S-04 p3 §1 | DRF | Team periods | PE | pgTAP 19: 525 kg / 7 h = 75; period across a change refused; daily 58.33 | tested (DB) |
| R-KPI-2 | Downtime per line: stop = restart − stop; daily = Σ minutes; count, times, fault, cause; open at cutoff = minutes to cutoff | S-04 p3 §2 | DRF | Downtime KPI | PE, PHM | pgTAP 19: midnight 30/45, overlap 30 not 40, shared union 30 not 50, open to cutoff | tested (DB) |
| R-KPI-3 | Order variance = (completion − start) − planned duration; plan recorded before start; stoppages included; reason for overrun | S-04 p3 §3 | DRF | Order timing | PE | pgTAP 19: 180 − 150 = +30; revision keeps baseline; lateness separate | tested (DB) |
| R-ACC-1 | Three internal verbal warnings, then HR referral for each further violation; HR decides | S-04 p4, S-06 p2 | DRF/CON | Accountability (draft, inactive; OD-42) | PHM, HR | pgTAP 23 | planned |

## Grading specification (S-07)

| ID | Requirement | Source | Label | Workflow | Role | Test | Status |
|---|---|---|---|---|---|---|---|
| R-GR-01 | 7 products × Premium/G1/G2 by colour/maturity and size or weight; quality description; max defect tolerance per consignment (minor/major/unacceptable) | S-07 pp.2–20 | DRF (approval not stated) | Versioned spec, awaiting approval (OD-43) | QAM, QCM | pgTAP 23 import counts | planned |
| R-GR-02 | Customer limits override standard grading when packing for that customer (Tesco, Thanet Earth, LSS, Abay, DBS, Export, DC) | S-07 pp.2,7,13,15,17,21 | DRF | Customer overrides per spec version | QCM, SAL | pgTAP 23 | planned |
| R-GR-03 | Inspection procedure: packaging → appearance → cut & taste → size → defects → grade or reject | S-07 p.4, p.21 | DRF | QC inspection form order | QCI | e2e | planned |
| R-GR-04 | Live insects (tomato, cherry tomato): QA evaluation, not automatic rejection | S-07 pp.3,4 | DRF/CON | C-05 | QAM | pgTAP 23 | planned |
| R-GR-05 | Sweet Bite 19–45 g as G1 only upon customer approval | S-07 p.13 | DRF | Inactive band | SAL, QCM | pgTAP 23 | planned |
| R-GR-06 | Tolerance overrides communicated between Commercial and PH management | S-07 p.3, pp.7–19 | DRF | Customer deviation (OD-47) | SAL, PHM | pgTAP 20 | planned |

## Equipment (S-08, S-09)

| ID | Requirement | Source | Label | Workflow | Role | Test | Status |
|---|---|---|---|---|---|---|---|
| R-MT-01 | AWETA G MV-D 4/20+1 (363428, serial 60484) PM: daily before start; before start + 8 h (16-h days); 30 h or 7 d; 100 h; 120 h or 1 month; 500 h or 6 months; pre-season; UPS ≤ 36 months; hours or calendar, whichever first | S-08 | DRF (not OEM-approved) | PM schedule pending (OD-44); meter readings → due | MNT | pgTAP 23 | planned |
| R-MT-02 | Maintenance team only; isolate energy; refit guards and test before restart | S-08 | DRF | Technical release required to close | MNT | pgTAP 23 | planned |
| R-CL-01 | Cleaning: end of day; camera daily; 30 h or 7 d deep clean; 120 h or 1 month brushes; after cleaning notify maintenance | S-09 | DRF | Cleaning tasks pending (OD-44) | CLN, MNT | pgTAP 23 | planned |
| R-CL-02 | Cleaning team may not use hoses/pressure/steam, open cabinets, lubricate, replace parts or restart | S-09 | DRF | Cleaning task cannot do technical release (permission) | CLN | pgTAP 23 | planned |

## Owner-requested features (instruction 2026-11-21)

| ID | Requirement | Section | Label | Status |
|---|---|---|---|---|
| R-OW-01 | Linked records with stable IDs; incoming pallets, runs and finished pallets distinct | §2 | OWN | built (M1/M2 codes ARR/IP/JC/FGP) |
| R-OW-02 | Planning and materials: forecast vs receipts, orders/revisions, packaging requested/received/issued/returned/short, readiness and order risk | §2 | OWN | planned (inc. 1–2) |
| R-OW-03 | Receiving and cold chain: tag, source, variety, gross/tare/net, pre-cooling, temperatures, FIFO, handover counts | §2 | OWN | built for M1 fields; handover counts planned |
| R-OW-04 | Production and grading: lines, routes, packs, customer grades, sample results, first-pack weight, holds, rework, downgrade, waste with distinct actors | §2 | OWN | partial (M2); rework/downgrade planned |
| R-OW-05 | Traceability and stock: input→run→output links with quantities, splits, merges, partial pallets, relabel, transfers, corrections, returns, reconciliation | §2 | OWN | partial (M2); dispatch, relabel, returns planned |
| R-OW-06 | Dispatch and complaints: allocation, dispatch QC, vehicle/seal/logger, rejection/replacement, complaints, CAPA, recall search both directions; team-level attribution stated | §2 | OWN | planned (inc. 3) |
| R-OW-07 | People and tasks: attendance, shifts, teams, intervals, transfers, phone form, task board (one-off/recurring, escalation, comments, history) | §2 | OWN | planned (inc. 1, 2, 5) |
| R-OW-08 | Downtime, cleaning, maintenance with calendar/shift/run-hour triggers and meter readings | §2 | OWN | planned (inc. 1, 6) |
| R-OW-09 | Users, roles, scoped permissions, delegated admin, effective access, immediate effect, audit | §3.1 | OWN | planned (inc. 4) |
| R-OW-10 | Operation types from scratch/template, steps, branches, approvals, navigation, line enablement | §3.2 | OWN | planned (inc. 5) |
| R-OW-11 | Form builder; task templates; triggers; reminders; escalation; reusable actions | §3.3 | OWN | planned (inc. 5) |
| R-OW-12 | KPI and dashboard builder with drill-down and role visibility | §3.4 | OWN | planned (inc. 5) |
| R-OW-13 | Draft, preview, validate, publish effective-dated, roll back; records pinned to version | §3.5 | OWN | planned (inc. 5) |
| R-OW-14 | Master data and translations; versioned specs; archive used values; import exception queue | §3.6 | OWN | planned (inc. 6) |
| R-OW-15 | Management landing page, filters, drill-down, daily/weekly, PDF/CSV, spreadsheet import with reconciliation | §4 | OWN | planned (inc. 2, 6) |
| R-OW-16 | Unknown ≠ zero: no-submission shift distinct from submitted zero; formulas visible with denominator | §4 | OWN | planned (inc. 1–2) |
| R-OW-17 | Design brief: tokens, rail, phone form, trace timeline, settings with live preview, accessibility | §Interface | OWN | planned (inc. 2–5) |
| R-OW-18 | Private run, HTTPS on LAN with localhost fallback, launcher, backups with proven restore, one-time owner credential | §5E | OWN | planned (inc. 4, 7) |
