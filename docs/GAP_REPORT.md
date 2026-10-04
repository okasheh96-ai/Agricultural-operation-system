# Implementation gap report

2026-10-05, updated at the end of the round. Measured against the code and tests in this repo, not against the docs.
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
| Packing house, lots, QC, QA | — | — | — | — | — | — | — | Phases 8–9; QA is flagged independent |
| Cost records | — | ◐ | — | — | — | — | — | Quantities are stored; rates table not built (Phase 10) |
| Attachments / photos / documents | — | ◐ | — | ✅ | ✅ | — | — | Table only; no Storage in the local stack |

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

## Next (by operational dependency)

1. **Photo evidence:** needs Storage (staging project, VR-S01). Biggest remaining 6:00 AM gap.
2. **Shared-device PIN switch + device revoke/wipe** (§3.6a).
3. **Agriculture (Phase 3):** growing cycles on blocks, activity types per crop stage, plant-protection records with REI/PHI windows, harvest lots with PHI gating.
4. Warehouse screens (ledger and issue requests already in the DB), escalation-rule and problem-category screens, user/role administration (needs an Edge Function to invite users).
