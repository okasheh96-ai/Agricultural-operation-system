# Phase 0 + Phase 1 report (1a done; 1b open)

Date: 2026-10-04

## Built
**Phase 0:** inspection (the repo was empty and no prototype exists, see ADR 0001), plus `ARCHITECTURE_PLAN.md`, `DOMAIN_MODEL.md`, `PERMISSIONS.md`, `STATE_MACHINES.md`,
`VERIFICATION_REGISTER.md` (S, C and the full E1–E48 backlog), `GLOSSARY.md`, `MASTER_PROMPT.md` and `CLAUDE.md`.

**Phase 1a: database foundation (complete, tested)**
- Standard row contract via `app.register_table()`: UUID ids, `farm_id`, stamps, optimistic `version`, soft void with reason, no hard delete, verification status, workflow status, audit trigger, RLS and default policies.
- Append-only `audit_events` with the real actor. Elevated writes without an acting user are refused.
- Six-dimension permissions (`role_permissions`, `user_roles` with department/location/time scope, `delegations`).
- Versioned workflow engine. `transition_record()` checks rules, permission, required fields and segregation of duties (including through delegations), then writes history and audit. It is idempotent, has optimistic concurrency and flags clock skew.
  `sync_transition()` stores rejected offline replays in `sync_conflicts`.
- Master data: location tree (path, cycle-safe re-parenting, area basis, D1 reconciliation view), type-neutral assets with status workflow, water sources/wells (no wells seeded, temporary codes can't be verified), crop master with aliases, units, workers (+ private ID numbers), crews (time-bounded membership), settings with evidence tier.
- Verification queue view, plus `set_verification_status()` (source note required) and `void_record()` (reason required).
- Structure-only seed. Optional temporary well codes script (owner's choice).

**Phase 1b: application shell (started)**
- Vite + React + TS, Tailwind with logical properties only (lint-enforced), i18next with Arabic default/RTL and English/LTR, TanStack Query, Zod.
- Real Supabase Auth sign-in. Access is loaded from `user_roles`/`role_permissions`, with a UI permission mirror.
- Office shell (navigation per §4.3, role-filtered, QA visually distinct, unbuilt sections labelled "Coming in a later phase", Cattle "Not Yet Verified"). Field shell (bottom nav, connectivity indicator).
- Admin: Departments, Locations (list, tree order, normalized Arabic search, create form), Verification Queue (verify with source note), Audit Log. Every list has loading/error/empty/offline states.
- Offline outbox (Dexie): idempotency keys, device time, replay order with parents first, network-failure retry with the same key, visible conflicts that hold back later changes to that record. Sync status page.

## Tests
| Layer | Count | Result |
|---|---|---|
| pgTAP (`npm run db:test`) | 87 | pass |
| Vitest (`npm test`) | 27 | pass |
| Playwright (`npm run test:e2e`, phone + desktop) | 4 | pass |
| ESLint + logical-CSS check + `tsc` strict + build | — | pass |

Mutation check: disabling the segregation-of-duties loop makes 2 pgTAP tests fail, as it should.

## Known gaps (honest)
1. **The UI has not run against a live Supabase backend.** No staging project or Docker is available (VR-S01). The admin screens are wired to real tables and RPCs, but are unverified end to end. The e2e tests cover only the shell, sign-in and RTL/LTR.
2. **The shim is not Supabase.** The local test DB uses a minimal `auth` shim. The first run on a real Supabase project may surface grant differences (e.g. Supabase's default privileges on new tables). The schema invariant test (no DELETE for `authenticated`) catches the most dangerous one.
3. Not yet built in 1b: user/role administration (needs an Edge Function to invite users with the service key), asset/water-source/crop/worker/crew screens, CSV import with validation report, PIN user switch on shared devices, device revoke + local wipe, PWA service worker and self-hosted Arabic font, Sentry, generated DB types (needs the Supabase CLI).
4. `pg_cron` jobs start in Phase 2 (overdue, escalations), when there is something to schedule.

## Tier C assumptions added
VR-C01 to VR-C14 (see the register).

## Discovery items affected
E8/D1 (reconciliation view), E10 (aliases), E14 (`area_basis`), E17/E18 (no wells seeded), E38 (record-of-truth setting), E46 (glossary), E48 (VR-S02).

## Quality gate (Phase 1a database scope)
Functionality ✅ (DB) / ⚠ UI unverified live · Data ✅ · Security ✅ (RLS tested) · Workflow ✅ · Audit ✅ · UX ⚠ (shell only) · Localization ✅ · Mobile ⚠ (shell only) · Regression ✅ · Data honesty ✅.
**Phase 1 is not complete** until the ⚠ items pass against staging.
