# Implementation gap report

2026-10-05, updated at the end of the round; packing-house rows 2026-10-21. Measured against the code and tests in this repo, not against the docs.
Legend: **A** UI · **B** Database · **C** Business logic · **D** Permissions (RLS) · **E** Audit · **F** Tested · **G** Production-ready.
✅ done · ◐ partial · — not started. No row is **G** yet: nothing has run on a staging Supabase project (VR-S01).

## Status by area

| Area | A | B | C | D | E | F | G | Notes |
|---|---|---|---|---|---|---|---|---|
| Org, roles, six-dimension permissions, delegation | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | — | No user/role admin screen; inviting users needs an Edge Function |
| Locations / blocks (tree, area basis) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | |
| Assets (type-neutral, status workflow) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | Admin screen: create/edit/status with reason/verify/void |
| Workers, crews (time-bounded) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | Admin screens + crew membership (overlap refused) |
| Task types / activity types | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | Admin screen; department managers create within their own department |
| Tasks: plan → assign → execute → verify → close | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | |
| Problem reports → triage → work order | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | |
| Escalation + notifications | ◐ | ✅ | ✅ | ✅ | ◐ | ✅ | — | No rule-editing screen |
| Offline outbox and sync | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | — | Service worker: app starts with no signal; reads come from the device at once when offline |
| Inventory ledger, issue requests | — | ✅ | ✅ | ✅ | ✅ | ✅ | — | No warehouse screens |
| Material on tasks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | Planned lines plus unplanned material from the field; locked after completion |
| Wells (Irrigation & Water) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | 14 unverified placeholders; status change with reason; verification only with a real identity |
| Irrigation runs, zones, readings | — | — | — | — | — | — | — | Phase 4 |
| Agriculture: growing cycles, plant protection (REI/PHI), harvest lots | — | — | — | — | — | — | — | Phase 3; crop master exists |
| Maintenance specifics (downtime, PM schedules) | — | — | — | — | — | — | — | Phase 5; breakdowns run on the generic work engine |
| Fleet usage | — | ◐ | — | — | — | — | — | Machine hours are recorded on tasks only |
| Packing house M1: master data, open decisions, permission matrix, rule parameters | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | PH-OAS-SPEC-001; real farm blocked on critical ODs (01, 02, 03, 05, 24, 25); demo uses labelled assumptions |
| Packing house M1: receiving → pre-cooling → QA acceptance → storage → QC-1, holds | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | Registration gated by OD-01/03, lots by OD-02, QC-1 by OD-17; see `docs/packing-house/TRACEABILITY.md` |
| Packing house M2.1: Job Cards, inputs (partial issue), packaging, line start (G5), QC-2 (G6), FG pallets → FG storage, trace | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | Job Card cells are proposals (OD-15): refused on a real farm until approved; checklists from draft SOPs (VR-PH-E08); no grading standard (OD-05/06) |
| Packing house M2.2–M4: waste workflow and reconciliation (MB-01), orders/daily plan, split/merge, dispatch, complaints, recall, KPIs | — | ◐ | — | ◐ | — | ◐ | — | Waste records exist (created at receiving); Job Card reconcile/close and later FG states are declared and refused; permission cells loaded and tested |
| QC / QA modules outside the packing house | — | — | — | — | — | — | — | Phase 9; QA is flagged independent |
| Cost records | — | ◐ | — | — | — | — | — | Quantities are stored; rates table not built (Phase 10) |
| Attachments / photos / documents | ◐ | ◐ | ◐ | ✅ | ✅ | ◐ | — | Packing house: photos in the database (≤ 5 MB, SHA-256) until Storage; elsewhere table only |

## 6:00 AM test (supervisor)

| Question | Today |
|---|---|
| See today's work / who is assigned | ✅ My Day, board |
| Report a problem, request maintenance | ✅ ≤ 3 taps, offline |
| Record execution, report a delay | ✅ start / stop with reason / done, crew and machine hours |
| Record material consumption | ✅ planned and unplanned, offline |
| **Create** a common task quickly | ✅ what → where → start; self-assigned only; offline |
| Weak connectivity | ✅ app starts offline; writes queue and sync; conflicts visible |
| Arabic UI | ✅ RTL by default; e2e runs in Arabic |
| Photo evidence | ✗ blocked on Storage (VR-S01) |

## What to keep, refactor, remove

- **Keep:** everything. It is tested, and nothing is wells- or maintenance-centric. Wells are a `water_sources` subtype, and maintenance runs on the generic work engine.
- **Refactor:** the task workflow needs a self-assign path for unplanned field work. This becomes workflow **v2**; in-flight tasks finish on v1.
- **Remove:** nothing.

## Done this round (all tested; see commit history)

1. Supervisor quick-create (self-assigned) task + unplanned material from the field. Engine change: several rules per status change; task workflow v2.
2. 14 wells as unverified placeholders (owner instruction 2026-10-05) + the Irrigation & Water → Wells screen.
3. Service worker; the field app starts with no signal. Found and fixed: roles and reads waited on the network offline.
4. Admin screens for assets, workers, crews (membership) and task types. Found and fixed: forms overflowed the phone screen; a test now checks every key screen.

## Foundation hardening (audit C1–C3, B3–B5; all tested in `13_foundation_hardening.sql` and `hardening.spec.ts`)

- C1: workflow-owned columns change only through `transition_record()`.
- C2: Operations routes problem reports but cannot triage, resolve or reject; farm-wide grants stop at QA (admin excepted).
- C3: a shared phone sends only the signed-in user's queued changes; sign-out warns about unsent work and clears device caches.
- B3: execution only by the assignee, a delegate or a planner; reassignment via `reassign_task` with a reason.
- B4: cross-farm references are refused.
- B5: sync conflicts are shown in the user's language, with the raw reason under "details".

## Office layout (owner request, 2026-10-06)

- The office uses a top bar instead of a side menu: departments and sections in one horizontal row (sideways scroll on a
  phone), the open section's pages as a second row of tabs. The Command Center shows departments as side-by-side cards.
- Sign-in errors now say whether the server was unreachable or refused the password. Demo builds (`npm run codespaces`)
  add one-tap sign-in for the demo farm's users; other builds do not contain it.

## Packing house M1 (2026-10-19, PH-OAS-SPEC-001)

- Built on the existing engine: every packing-house write is a SECURITY DEFINER function that checks the role × action cell and
  the open decision behind it; API users cannot insert or update any `ph_*` table or view (tested). Statuses change only through
  `transition_record()`.
- AutoScore-style board: stage tabs with live counts and attention counts, wide record panels with dark responsibility strips,
  record view with stepper, sections, photos, history, and every unavailable action with its reason.
- Open decisions, permission matrix (with owner approval of proposed cells), rule parameters and master data (maker ≠ checker)
  are screens over the same data the server enforces.
- Still open for M1: PIN switch on shared devices; Storage for photos; a packing-house audit search screen. Next milestone: M2.
- **M2.1 (2026-10-21):** Job Cards (plan → approve → inputs and packaging → ready → two-person line start → run → complete),
  QC-2 online / final with the product SOPs' checklists, finished pallets (composition by lot, FG label with V-09, QC stamp
  with 24 h validity, FG fridges), trace from a finished pallet back to its incoming pallets. Waste reconciliation (MB-01,
  OD-28), orders (ST-00) and split/merge are the next increments. See `docs/phase-reports/packing-house-m2-1.md`.
- **Open from a link (2026-10-19):** an in-browser demo runs the same app and the same SQL in the viewer's browser (PGlite),
  published as a claude.ai artifact plus a single-file `index.html`; see `docs/BROWSER_DEMO.md`. It is per-device demo data with
  a demo sign-in, not a deployment. A shared, hosted deployment still needs a Supabase project and a static host (VR-S01).

## Next (by operational dependency)

1. **Photo evidence:** needs Storage (staging project, VR-S01). Biggest remaining 6:00 AM gap (packing-house photos use the database meanwhile).
1. **Packing house M2.2–M2.3** (owner priority): waste workflow and sign-off routing (V-16/V-17), Job Card reconciliation (MB-01, OD-28), orders and daily plan (ST-00, OD-37), split/merge (V-22). Needs OD-11, OD-15, OD-21, OD-28.
2. **Shared-device PIN switch + device revoke/wipe** (§3.6a).
3. **Agriculture (Phase 3):** growing cycles on blocks, activity types per crop stage, plant-protection records with REI/PHI windows, harvest lots with PHI gating.
4. Warehouse screens (ledger and issue requests already in the DB), escalation-rule and problem-category screens, user/role administration (needs an Edge Function to invite users).
