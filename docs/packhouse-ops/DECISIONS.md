# Conflicts, authority gaps and decisions — packhouse operations build

Rule applied throughout (owner instruction 2026-11-21 + CLAUDE.md): verified rules are implemented; ordinary technical
gaps get labelled, reversible defaults; disputed business rules are editable drafts; unverified release authorities,
limits and disciplinary policies stay **inactive**; where acting without a verified rule would bypass a control, the
affected step is held and every other workflow keeps running. Each open item appears in **Operations Settings → Open
items** where the owner (or the named authority) can resolve it in the browser.

## Conflicts between sources

| ID | Where | Conflict | Affected action | Handling | Authority |
|---|---|---|---|---|---|
| C-01 | S-04 vs S-05 (Production Engineer) | The English version has four sentences the Arabic one lacks: PE-2 "spot-check corrected labels on incoming pallets against the receiving records"; PE-5 "discuss any proposed re-sorting with the Packhouse Managers"; PE-6 "know and apply the SOPs; check that all follow basic rules"; PE-7 "inform the Packhouse Managers of delays and of cleaning or maintenance work completed". | PE shift checklist | The English (fuller) wording is used for checklist items; the four items are marked "EN only — confirm Arabic text". | Packhouse Managers |
| C-02 | S-04/S-05 vs S-06 (Accountability) | S-04/S-05: applies to Line Supervisors **and Production Engineers**. S-06: applies to **line supervisors** only. | Accountability policy scope | Policy is stored as a draft with both scopes listed; **inactive** until the owner chooses (OD-42). | Owner + HR |
| C-03 | S-07 p.18 vs pp.8,10,12,14,16 | Eggplant lists "non-organic foreign bodies" as a **Minor** defect; every other product lists it as **Unacceptable**. | QC grading of eggplant | Imported as written with a conflict flag on that row. | QA Manager |
| C-04 | S-07 pp.6–19 | Grade bands touch at their limits (e.g. pepper colour G1 70–100 % vs G2 50–70 %; tomato G1 6–10 cm vs G2 3–6 / 10–15 cm; cucumber colour 100 % vs 90–100 %). Which grade a value exactly on the limit belongs to is not stated. | Suggested grade | A value exactly on a shared limit is shown as "on the limit — inspector decides" (OD-45). | QA Manager |
| C-05 | S-07 p.3/p.8/p.10 | Live insects are listed under Unacceptable (0 % / 2 %) but for Tomato and Cherry Tomato "evaluated internally; not an automatic rejection". | QC result | For those two products the result becomes "QA evaluation required", never an automatic reject. | QA Manager |
| C-06 | Instruction vs `CLAUDE.md` | CLAUDE.md: "Do not start M3 until the owner says so". The 2026-11-21 instruction asks for dispatch, complaints and recall. | M3/M4 build | The owner's latest instruction is the owner saying so; M3/M4 built, still gated by their open decisions on a real farm. | Owner (given) |
| C-07 | Instruction vs office layout (owner request 2026-10-06) | The earlier request put the office on a horizontal top bar; this instruction asks for a collapsible navigation rail. | Packhouse screens | The packhouse operations area uses the new rail and theme; other departments keep the October layout. | Owner (latest instruction) |
| C-09 | PH-OAS-SPEC-001 FR-DS-08 vs its parameters | FR-DS-08 says loading starts "between 01:00 and 09:00"; the SOP-documented parameters are start 09:00, end 01:00 (the opposite window). | Loading-window block (V-15) | The time is recorded and flagged "outside window (interpretation pending OD-39)"; nothing is blocked. | PHM (OD-39) |
| C-10 | Spec NYV cells for dispatch | Logger / seal (OD-18) and packing list / departure (no recording role named) are NYV, so a real farm cannot complete a dispatch. | Departure | Held on a real farm until the owner records a decision (Settings → Authority, increment 4); demo farm uses a labelled demo assumption for DEC. | Owner / PHM + WHM |
| C-08 | Instruction ("Codex", "Owner account") vs repo roles | The repo has System Admin and a packing-house ADM role with no operational cells (SoD-06). | Owner authority | New **Owner** role: all administration, settings, publishing, export and view; **no quality hold release** (QA independence, rule 4). The owner can grant QC/QA roles to others. | Owner |

## Authority gaps and missing values (no value is invented)

| ID | Gap | What the system does meanwhile |
|---|---|---|
| OD-42 | Accountability policy scope and activation (C-02); who records a violation; how a warning is acknowledged. | Violation log exists (restricted to managers + HR); the "3 verbal warnings then HR" counter is a **draft policy, inactive**. Every warning is a human decision with history. |
| OD-43 | Approval of the grading specification S-07 (no approver or revision). | Imported as v1 "awaiting approval"; suggestions labelled; QC releases are human decisions. QA Manager approves in Settings → Specifications. |
| OD-44 | Approval of AWETA maintenance (30/100/120/500 h) and cleaning (30/120 h) intervals; CUP match to serial 60484 (drawing 60483); timing-unit lubrication awaits AWETA. | Schedules loaded **pending**; no due work is generated until a maintenance owner approves; meter readings are recorded anyway. |
| OD-45 | Grade band boundary rule (C-04). | Boundary values flagged for inspector judgement. |
| OD-46 | Training period for new staff (named in the instruction; **no source gives a length or content**). | Field exists with value "Not Yet Verified"; nothing is enforced. |
| OD-47 | Customer deviation authority: S-07 says overrides are "communicated between Commercial and Packing House management" — no named role or sign-off. | Deviation request needs two approvals (Commercial + PHM) as a **proposed** cell; usable on the demo farm only. |
| OD-48 | "Long-distance shipping" (cherry tomato stage 6 not allowed) is not defined. | Destination flag "long distance" is set by the order taker; the warning shows; not a block. |
| OD-49 | Dispatch quality check criteria and who releases a load (spec OD-08/09/10/18/20/39 also open). | Dispatch check form records results; on a real farm departure is held while the decisions are open; demo farm uses labelled assumptions. |
| OD-50 | Line capacity, labour targets and planned durations per product (none supplied). | Planned duration is entered per order by the planner; capacity shows "Not Yet Verified"; progress % only where a target exists. |
| OD-51 | Which "Packhouse Manager" covers an absent engineer (roles draft says "the Packhouse Managers"). | Routing goes to the on-shift engineer; if none is assigned to the shift, to every user holding PHM. |

The 41 decisions of PH-OAS-SPEC-001 (OD-01…OD-41) stay as they were (`docs/packing-house/OD_REVIEW_M2.md`).

## Engineering decisions (reversible, recorded)

| ID | Decision | Why | Reversal |
|---|---|---|---|
| E-01 | Extend the existing repository and stack (React + PostgreSQL rules + PostgREST) instead of a new project. | 817 database tests and the packing-house M1/M2 rules already exist; a rewrite would discard verified controls. | n/a |
| E-02 | **Packhouse server** (`server/`): Node serves the app, issues sign-in tokens and proxies the API to PostgREST. Passwords are bcrypt hashes checked inside PostgreSQL (pgcrypto); tokens are HS256 JWTs PostgREST verifies; every request passes a database pre-request check (session revoked, account suspended, password change pending). | Supabase Auth has no macOS build and is email-centric; staff need username-only accounts, activation codes, first-use change and immediate revocation. Keeps all decisions in SQL (tested by pgTAP). | The hosted-Supabase path (VR-S01) still works for the existing app; user admin there would need an Edge Function. |
| E-03 | Core traceability workflows (receiving, Job Cards, finished pallets, dispatch, waste) stay engineered SQL functions; owner-defined operations attach at declared **hook points** (e.g. "before dispatch", "after QC-2", "at shift start") and can block them. | Mass balance and trace links must not be breakable from a form builder. | Hook points are data; more can be added. |
| E-04 | Owner-created operations, forms, tasks, rules, KPI cards and dashboards use one configuration engine with versioned, effective-dated definitions; records pin their version. | Instruction §3.2–3.5. | Unpublish / roll back future use. |
| E-05 | KPI evaluation runs in SQL over a whitelist of datasets; the measure builder writes a definition, never SQL text. | No injection; reports respect row security. | n/a |
