# Implementation gap report

2026-10-05. Measured against the code and tests in this repo, not against the docs.
Legend: **A** UI · **B** Database · **C** Business logic · **D** Permissions (RLS) · **E** Audit · **F** Tested · **G** Production-ready.
✅ done · ◐ partial · — not started. No row is **G** yet: nothing has run on a staging Supabase project (VR-S01).

## Status by area

| Area | A | B | C | D | E | F | G | Notes |
|---|---|---|---|---|---|---|---|---|
| Org, roles, six-dimension permissions, delegation | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | — | No user/role admin screen; inviting users needs an Edge Function |
| Locations / blocks (tree, area basis) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | |
| Assets (type-neutral, status workflow) | — | ✅ | ✅ | ✅ | ✅ | ✅ | — | No screen |
| Workers, crews (time-bounded) | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | — | My Crew only; no admin screen |
| Task types / activity types | — | ✅ | ✅ | ✅ | ✅ | ✅ | — | No admin screen |
| Tasks: plan → assign → execute → verify → close | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | |
| Problem reports → triage → work order | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | |
| Escalation + notifications | ◐ | ✅ | ✅ | ✅ | ◐ | ✅ | — | No rule-editing screen |
| Offline outbox and sync | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | — | **No service worker**: a reload without signal does not start the app |
| Inventory ledger, issue requests | — | ✅ | ✅ | ✅ | ✅ | ✅ | — | No warehouse screens |
| Material on tasks | ◐ | ✅ | ✅ | ✅ | ✅ | ✅ | — | **Field can record only pre-planned lines**, not unplanned material |
| Wells (Irrigation & Water) | — | ✅ | ✅ | ✅ | ✅ | ✅ | — | **14 wells not created by default; no screen** |
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
| Record material consumption | ◐ only planned lines → **fix now** |
| **Create** a common task quickly | ✗ a supervisor can't create work from the phone → **fix now** |
| Weak connectivity | ◐ writes queue offline, but the app won't start offline → **fix now** |
| Arabic UI | ✅ RTL by default; e2e runs in Arabic |
| Photo evidence | ✗ blocked on Storage (VR-S01) |

## What to keep, refactor, remove

- **Keep:** everything. It is tested, and nothing is wells- or maintenance-centric. Wells are a `water_sources` subtype, and maintenance runs on the generic work engine.
- **Refactor:** the task workflow needs a self-assign path for unplanned field work. This becomes workflow **v2**; in-flight tasks finish on v1.
- **Remove:** nothing.

## Order of work (this round)

1. Supervisor quick-create (self-assigned) task + unplanned material from the field.
2. 14 wells as unverified placeholders (owner instruction 2026-10-05), plus an Irrigation & Water → Wells screen with reasoned status changes and verification.
3. Service worker, so the field app starts with no signal.
4. Admin screens for assets, workers/crews and task types, so the farm can configure without SQL.
