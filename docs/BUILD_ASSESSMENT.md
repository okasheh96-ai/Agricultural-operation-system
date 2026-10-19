# Build assessment — Packing House Operations Automation System

2026-10-19 · Input: `docs/packing-house/PH-OAS-SPEC-001_v0.1.pdf` (Draft 0.1, 19 Oct 2026, 111 pages, read in full) and
the owner's build instruction of the same day. Traceability by spec ID: [`docs/packing-house/TRACEABILITY.md`](packing-house/TRACEABILITY.md).

## 0. The conflict to resolve first

The specification's cover says **"DRAFT — for management review. Not approved. Not for build."** Its Appendix B says
"Do not start Phase 1 build until the Phase 0 exit criteria are met". The owner's instruction of 19 Oct says to build now
and keep dependent behaviour gated. Under the repo's conflict rule (Master Prompt §0.6: the owner's most recent explicit
instruction wins; contradictions are flagged, not hidden), the build proceeds with these consequences:

- **Nothing in the spec is treated as approved.** Every rule, permission cell and parameter carries the spec's own label
  (C Confirmed · P Proposed · NYV Not Yet Verified) in the database, and the UI shows it.
- **Open decisions block on the real farm.** An action that depends on an open decision (OD-01, OD-02, OD-03, OD-05,
  OD-17, OD-38, …) is refused by the database with the decision's ID until its owner records a decision.
- **The demo farm may run on labelled demo assumptions.** To make the workflow testable, the demo seed records the spec's
  *recommendation* as a "demo assumption — not a management decision" for each open decision that would otherwise block
  receiving. The database refuses demo assumptions on any farm not flagged `is_demo`. Records created under one carry
  the assumption in their `decision_basis`.
- Logged as VR-PH-S01 (Verification Register).

## 1. Repository and technology

| Item | Finding |
|---|---|
| Product | Arabic-first Agricultural Operations Management System for the same company (13 departments **and the packing house**). Packing house was planned as its Phase 8, QC/QA as Phase 9. |
| Stack | React 18 + TypeScript (strict) + Vite PWA · Tailwind (logical CSS only, lint-enforced) · i18next (`ar` default, RTL) · TanStack Query · Dexie offline outbox · Supabase (Postgres 16, Auth, PostgREST, RLS) · Vitest · Playwright · pgTAP. |
| Business rules | In Postgres: `app.register_table()` row contract (stamps, optimistic version, soft void, verification status, no-delete, audit trigger, RLS); `transition_record()` versioned state-machine engine (permission, required fields, guards, payload columns, segregation of duties, idempotency, clock-skew flag, after-hooks); append-only `audit_events` and `record_transitions`. |
| Permissions | `role_permissions` as data (role × object × action × state) + `user_roles` scope (department, location, period) + delegations; independent-department rule (QA). |
| Environments | `npm run db:test` (throwaway Postgres + pgTAP), `scripts/dev-stack.sh` (Postgres + real Supabase Auth + PostgREST + gateway, demo farm), `npm run codespaces` (one-port build for GitHub Codespaces). No staging/production touched (VR-S01). |
| Baseline (run 2026-10-19, before any change) | lint ✅ · typecheck ✅ · Vitest 50/50 ✅ · pgTAP 211/211 ✅. |
| Companion files | `PH-OAS-SPEC-001_Registers.xlsx`, `.docx`, diagram sources: **not in the repository.** The permission matrix was transcribed from PDF pages 45–48 (page images) and is stored as data; it must be re-checked against the workbook's Permissions sheet when supplied (VR-PH-S02). |

## 2. What is reused

| Reused as is | Why |
|---|---|
| Row contract, audit trigger, no-delete, soft void with reason | AT-01/AT-02, V-28, GEN-12 are already enforced for every registered table. |
| `transition_record()` engine | Spec Appendix B: "explicit transition table with guards, enforced on the server; no status field may be written directly" is exactly this engine. Extended once (below), not copied. |
| Workflow versioning | Effective-dated rules (DP-06): a later decision publishes a new workflow version; records keep theirs. |
| `processed_mutations` idempotency | Basis for safe replay of floor actions (NFR-04). |
| Demo-farm separation, demo banner, real-auth demo users | Spec §21 of the instruction: demo data separate from production. |
| Office shell, i18n, `QueryState`, badges, tests harnesses | Same app; the packing house is a section of the office navigation. |

**Extended (new migration, no applied migration edited):** `allowed_transitions.ph_action` — when set, the engine checks
the packing-house permission matrix cell for that action instead of the generic `role_permissions`, refuses cells that are
NYV or unapproved proposals (per farm setting), and writes the basis used (C / P / decision) into the status history.

## 3. Specification → module plan

| Module (code) | Spec scope | Milestone | Depends on (open decisions) |
|---|---|---|---|
| PH-CFG Open decisions & configuration | §13 (41 ODs), FR-MD-07, DP-06 | **M1** | — |
| PH-ACL Roles, permission matrix, SoD | §6.1–6.4, FR-AC-02/03 | **M1** | OD-41 (SoD-10), OD-12/13/14/38 (NYV cells) |
| PH-MD Master data | FR-MD-01…06 (crops, storage groups, locations/capacity, lines, sources, equipment) | **M1** (reference import, maker-checker) | OD-29, OD-30, OD-31 |
| PH-RC Receiving | ST-01…ST-04, FR-RC-01…06, G1, G2, V-01…V-04, E-01…E-05 | **M1** | OD-01, OD-03, OD-38 |
| PH-QG Raw-material gates | ST-05, ST-07, FR-QG-01…03, G3, G4, V-23, V-26, SoD-01/02 | **M1** | OD-02, OD-05, OD-12, OD-17 |
| PH-ST Storage (raw) | ST-06, FR-ST-01, V-06…V-08, E-06/E-07 | **M1** | OD-14 |
| PH-NC Holds (raw pallets) | X-01, SM-NC (raise / decide / release for incoming pallets) | **M1** (basic) → M4 (full NC/CAPA) | OD-16, OD-23 |
| PH-ATT Attachments | AT-05, V-23 (photos on RMA) | **M1** | NFR-10 sizing |
| PH-UI Workflow dashboard | Instruction §5 (stage tabs, record panels, activity strips, detail view) | **M1** | — |
| PH-PL Orders & plan | ST-00, FR-PL-01…04 | M2 | OD-37 |
| PH-PR Job Cards & lines | ST-08, ST-15, FR-PR-01…08, G5, MB-01 | M2 | OD-13, OD-15, OD-28 |
| PH-FG FG pallets & labels | ST-09, ST-10, FR-QG-04…07, FR-FG-01…06, G6, GEN-05…08 | M2 | OD-02, OD-06, OD-19, OD-20 |
| PH-WS Waste | ST-11, FR-WS-01…06, G7, V-16/V-17, E-20 | M2 (M1 creates the waste record on a second QA rejection) | OD-11, OD-28 |
| PH-DS FG storage & dispatch | ST-12…ST-14, FR-ST-02/03, FR-DS-01…10, G8 | M3 | OD-08, OD-09, OD-10, OD-18, OD-20, OD-39 |
| PH-TR Complaints, trace, recall | ST-16, FR-TR-01…05, TQ-01…04 | M4 (basic backward trace to arrival in M1) | OD-19, OD-21, OD-22 |
| PH-RP Reporting & KPIs | ST-17, FR-RP-01…04, K1–K13 | M4 (stage counts and exception list in M1) | OD-28, OD-34 |
| PH-AU Audit, corrections, e-signature | FR-AU-01…04, AT-01…10, FR-AC-04 | M1 (audit capture/viewer reuse) → M4 (PIN e-signature, back-entry) | OD-16, OD-21, OD-41 |
| PH-NT Tasks & notifications | FR-NT-01…03, V-30 | M1 (role queues as stage tabs) → M4 (e-mail, escalation) | OD-16 |
| PH-IN External references | FR-IN-01…03, IB-01…09 | M2–M3 (references and CSV only; no integration code, Appendix B) | OD-04 |

## 4. Critical dependencies and unresolved decisions

The six Critical decisions and how the build treats them:

| OD | What the system does while it is open (real farm) | Demo farm |
|---|---|---|
| OD-01 entry point | Registering a pallet **before** QA acceptance (CP-01) is refused. Under the current SOP wording (option A) a pallet is only entered after acceptance, which skips the gates the TO-BE adds; the system does not guess which applies. | Demo assumption: option B (spec recommendation). |
| OD-02 lot definition | No lot is created; accepted pallets show "Lot: pending OD-02". | Demo assumption: option C. |
| OD-03 ID / label issuer | Registration and label printing refused (two systems must not issue IDs). | Demo assumption: option A (new system issues IDs for the packing house). |
| OD-05 tolerances | RMA can be submitted only as "Accepted — no tolerance set", flagged for QAM (FR-QG-01, the spec's own pending behaviour). No tolerance is invented. | Same — no tolerance set exists. |
| OD-24 hardware | Scanning = typing or a keyboard-wedge scanner into an ID field; labels print to the browser's printer. No device driver, scale or printer integration is claimed. | Same. |
| OD-25 build/hosting | This build uses the existing stack; hosting, backup and RPO/RTO are undecided. Not production-ready. | Same. |

All 41 decisions are stored with owner, priority, options, recommendation (kept as a proposal), dependent requirements and
the transitions/cells they block. High-priority decisions that gate M1 behaviour: OD-12 (engineer), OD-14 (fridge move
custody — store keeper cell NYV), OD-17 (QC-1 scope — G4 is NYV), OD-38 (vehicle inspector — cell NYV), OD-07 (dwell rule
table; the documented 30 min alert applies meanwhile).

## 5. Security and data-integrity risks

| Risk | Control in this build |
|---|---|
| UI-only enforcement | All packing-house writes go through SECURITY DEFINER functions or `transition_record()`; the tables have no insert/update policy for API users. Tests call the API directly. |
| Status forged by a client | Existing trigger: status and workflow columns change only inside a transition. |
| Proposed permissions used as if approved | Each cell carries C/P/NYV; NYV cells are unusable until a decision activates them; P cells are usable only where the farm setting allows proposals in effect (demo: yes; real farm: no) and every use is recorded with basis `P`. |
| Segregation of duties | SoD-01 (registrar ≠ QA decision) and SoD-02 (engineer ≠ recheck) are `must_differ_from` rules on the transitions; SoD-05/06 by the matrix (PH roles cannot release quality holds; ADM has no operational cells). |
| Demo assumptions leaking to production | Refused by a check on `farms.is_demo`; shown on every affected record. |
| Audit tampering | Append-only tables with UPDATE/DELETE/TRUNCATE blocked by triggers (existing, tested). |
| Photo evidence | Stored with SHA-256, uploader and time; never replaced, only superseded (AT-05). Kept in Postgres (bytea) because Storage is not available locally (VR-S01); size-capped. Production should move blobs to Storage. |
| Clock trust | Event time is server time; device time is stored and skew-flagged (V-27 basis). |
| Not production-ready | Critical ODs open, no staging, no e-signature PIN yet, no backup/restore objectives (OD-25, NFR-07). Stated in every report. |

## 6. Implementation sequence and test strategy

1. **M1 (this round):** configuration foundation → receiving workflow end to end (ST-01…ST-07) → dashboard → demo data →
   preview. One workflow end to end at a time (repo rule 11).
2. M2 production & quality gates · M3 FG storage & dispatch · M4 exceptions, complaints, trace & reporting.

Tests per layer:
- **pgTAP** (database): every transition has an allowed and a forbidden test; T-20 negative permission tests are
  **generated from the stored matrix** (every role × every non-granted implemented action is refused); decision gating
  (blocked while open, allowed after a recorded decision, demo assumptions refused on the real farm); SoD-01/02; T-02…T-07;
  audit immutability; RLS.
- **Vitest**: stage mapping, timers (dwell, grading overdue), formatting, locale parity.
- **Playwright** against the local stack: dashboard tabs/counts, record panel, detail view, one receiving flow, Arabic RTL
  and English, desktop and tablet widths.

Acceptance scenarios T-01…T-22 are the definition of done per phase; the status of each is in the traceability index.
