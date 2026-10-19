# Packing house M1 report: receiving → QC-1

Date: 2026-10-19 · Spec: PH-OAS-SPEC-001 v0.1 (Draft, "Not for build"; built on the owner's instruction, VR-PH-S01).
Status: **M1 works end to end on the demo farm against the real local stack.** On a real farm, registration, lots and QC-1 stay
blocked until management records OD-01, OD-02, OD-03 and OD-17. The module is **not production-ready**: the critical decisions
are open, nothing has run on a staging project (VR-S01), and no on-site walk-through has confirmed the SOP data.

## Built

**Database (migrations `001000`–`001400`)**
- Roles (20), actions (99), the §6.3 permission matrix as data with each cell's C/P/NYV label, the 41 open decisions with owners
  and blocking effects, rule parameters (versioned, with source), and inspection templates.
- Decision gates raise a reason naming the open decision. Demo assumptions are refused on any non-demo farm.
- Master data: crops (versioned), varieties, sources, storage groups, locations, lines and equipment. A different person must approve
  each record (SoD-07). The SOP reference list loads as Not Yet Verified.
- Receiving workflows:
  - arrival (draft → vehicle hold → passed G1 → closed / not accepted);
  - incoming pallet (16 statuses, SM-IP);
  - inspections with co-signature;
  - holds (SM-NC);
  - waste records.
- G1–G4 and G9; V-01…V-08, V-19, V-21, V-23, V-26 and V-28; SoD-01, 02, 05, 06, 07 and 09.
- Labels with reprint reason and logged content.
- Photos with SHA-256.
- Backward trace, exception queue, stage counts and location occupancy.
- Every write is a SECURITY DEFINER function. API users cannot insert into or update any `ph_*` table or view.

**Application (`src/modules/packing-house/`)**
- **Workflow board** (AutoScore-style):
  - stage tabs with live and attention counts, with unbuilt stages labelled by milestone;
  - search and filters;
  - wide record panels with dark responsibility strips (who did it, who it waits for);
  - next actions offered by role.
- **Record view**:
  - stage stepper, sections, quality table and storage moves;
  - photos, with upload and compression on the device;
  - full history;
  - the actions side panel lists every action with its permission basis, or why it is unavailable.
- **Forms**: arrival, vehicle inspection and exception signatures, registration, label print, arrival check (G2), pre-cooling
  scan, QA acceptance (RMA), regrade / re-weigh / recheck, move with override, QC-1, holds and void.
- **Other pages**: exception board, trace, open decisions (record, sign, activate roles), permission matrix (approve proposed
  cells), rules and templates, and master data with the location board and storage-group assignment.
- Arabic (RTL, default) and English; all strings are in both locales.
- One-tap demo sign-in for 10 packing-house roles; packing-house-only users start on the board.

**Demo farm** (`supabase/seed/demo_packing_house.sql`, run by `scripts/dev-stack.sh up`)
- 5 arrivals and 12 pallets across all M1 stages, including one vehicle exception awaiting signatures.
- Photos are labelled placeholders.
- Demo assumptions: OD-01 B, OD-02 C, OD-03 A, OD-17 A and OD-38 DEC, each with the rationale "DEMO ASSUMPTION — not a management
  decision".

**Fixed along the way**
- The dev gateway (`scripts/local-proxy.mjs`) reused idle upstream sockets and returned intermittent 502 "socket hang up". It
  now opens a new upstream connection per request.

## Tests

| Layer | Count | Result |
|---|---|---|
| pgTAP (`npm run db:test`), incl. `14_ph_config` (63) and `15_ph_receiving` (200) | 474 | pass |
| Vitest (`npm test`), incl. `packingHouse.test.ts` | 63 | pass |
| Playwright against the local stack (`npm run test:e2e:stack`, Arabic RTL, 390×844), incl. 3 packing-house scenarios | 18 | pass |
| ESLint + logical-CSS check + strict `tsc` + build | — | pass |

**Acceptance scenarios and the permission matrix**
- Acceptance scenarios T-02 to T-07 are in pgTAP.
- T-20 is generated from `ph_permission_cells`: every role × every M1 action, with proposals in and out of effect.
- Every transition has an allowed and a forbidden case.

**End-to-end scenarios** (through the UI)
- DEC creates an arrival, inspects the vehicle, passes G1 and registers a pallet. The record view then explains why G2 is not
  DEC's. The server refuses QA acceptance and direct table writes.
- Board counts match the database, in both languages.
- An auditor has read access only.
- A signer is not offered a second signature.
- The location board counts pallets.

## Blocked or gated (real farm)
- **Critical decisions**:
  - OD-01 (registration point): blocks registration;
  - OD-02 (lot): blocks lot assignment;
  - OD-03 (system of record): blocks registration and labels;
  - OD-05 (tolerances): QA acceptance is recorded as a judgement for QAM review;
  - OD-24 (devices): scan by typing or scanner only;
  - OD-25 (hosting): nothing deployed.
- **Other decisions**:
  - OD-17 blocks QC-1;
  - OD-29 means weights are not checked for plausibility;
  - OD-07 means pre-cooling dwell uses the single 30-minute SOP limit;
  - OD-16: late-entry flag;
  - OD-20: barcode format;
  - OD-38: who inspects vehicles.
- **Source gaps (VR-PH-E01…E07)**:
  - vehicle checklist content;
  - Sweetbite and watermelon temperatures;
  - scale calibration dates (every weight is flagged);
  - location capacities.

## Next: M2
Orders and production plan (OD-21), job cards and line-start checks, QC-2 release, FG pallets with split/merge, the waste workflow
(weighing, QC approval, sign-off over 1 t), and production traceability (OD-13). Then M3 (FG storage, loading, dispatch QC) and M4
(complaints, recall, KPIs, e-signature, overrides).
