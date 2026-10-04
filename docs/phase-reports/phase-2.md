# Phase 2 report: Operations execution

Date: 2026-10-05 · Status: **core loop working end to end against a real local Supabase stack**. Gaps are listed below.

## Inspection at start
The repository held the Phase 0/1 work from 2026-10-04: docs, 6 migrations, the shell UI and 87 pgTAP tests. There was still no backend outside tests and no Lovable prototype. CI was green for app and database; the e2e job failed because `vite preview` bound to IPv6 `localhost` (fixed).

## Built
**Local Supabase-equivalent stack** (`scripts/dev-stack.sh up`)
- Postgres 16, **real Supabase Auth (GoTrue v2.178)** and PostgREST 12.2, behind one gateway URL like hosted Supabase.
- Binaries are pinned and SHA-256 verified. Dev-only secrets are generated per machine in `.local/` (gitignored). No service-role key is in the repo.
- A separate **demo farm** (`is_demo`, yellow "Demo Data" banner on every screen) with demo users created through the real Auth admin API. The real farm (`FARM`) gets structure only.

**Database (migrations 0600–0760)**
- Farm structure moved into `app.create_farm_structure()`, so the real and demo farms are identical in structure.
- Engine extensions: payload/clear/counter columns, guards, per-transition department scope, logged SoD exceptions and after-transition hooks.
- **Work engine:** task types (verification policy), plans, work orders and tasks (workflow v1). Also checklist items, labour entries (per worker or crew × headcount, cross-department workers allowed) and machine entries. Entries lock when work completes.
- **Exception engine:** problem reports (anyone may raise one; routed by category; take the equipment's location), triage into work order + task in one call, comments, attachments (metadata), notifications, escalation rules (shipped unconfigured) and an idempotent scheduler (`pg_cron` where available).
- **Inventory core** (shared by Main and Maintenance warehouses): items with per-item unit conversions, an immutable ledger, balances under row lock, negative-stock flag, reversals, reconciliation, issue requests (requester vs warehouse scope) and planned vs actual material on tasks.
- `task_board` view. `app.apply_api_grants()` is required at the end of every migration and enforced by a test.

**Application**
- **Field:** My Day (cached on the device; each task opens offline), task execution (start / stop with reason / resume / done with quantity, crew hours, machine hours, actual material, report a problem from inside the task), report problem (category → urgency → words → send, works offline, optionally blocks the task), My Crew, sync status and notifications.
- **Office:** Command Center (management questions with counts that link to the lists behind them), Operations board (filter by bucket and department), Daily planning (create + assign supervisor/crew), Task verification (send back with reason; the DB refuses self-verification), Problems (acknowledge / turn into work / resolve / reject) and Notifications.
- **Offline:** every field write goes to the outbox (transitions, inserts with client UUIDs, versioned updates). The UI shows a provisional "waiting to sync" status, replays in device-time order parents-first, keeps conflicts visible and retries with backoff after network failures.

## Tests
| Layer | Count | Result |
|---|---|---|
| pgTAP (`npm run db:test`) | 166 | pass |
| Vitest (`npm test`) | 34 | pass |
| Playwright smoke (`npm run test:e2e`, phone + desktop) | 4 | pass |
| **Playwright against the local stack** (`npm run test:e2e:stack`, Arabic RTL, 390×844) | 5 | pass, 3 consecutive runs |
| ESLint + logical-CSS check + strict `tsc` + build | — | pass |

The stack scenarios are the §8.1 Phase 2 minimum:
1. A supervisor works offline (start, crew hours, done), the work syncs, and the server shows it awaiting verification with device ids in the history.
2. A field breakdown report is triaged to Maintenance, becoming a work order and task. The task is assigned to a technician, completed, verified by a different user and closed, with full history.
3. A blocked task shows its reason on the Operations board, and the escalation fires for a configured (test-fixture) rule.
4. An offline change the server rejects lands in the conflict queue with a readable reason.
5. Unverified master data is labelled.

**Bugs the real-stack tests caught (all fixed, with regression tests):**
1. **The sync loop stalled forever after any offline attempt.** The async run finished synchronously and cleared its own guard before it was assigned. Regression test `sync.test.ts`, mutation-checked against the original code.
2. Awaiting query invalidation while offline kept a sync "in progress" until reconnect.
3. Planned material on a draft task was misread as an actual (JSON null vs SQL NULL).
4. Completion quantities had no unit path.
5. Breakdown reports without a location produced repair tasks that couldn't be assigned (they now take the equipment's location).
6. The dev gateway's CORS rejected supabase-js retry headers.

## Known gaps (honest)
1. **Photos and voice notes:** the `attachments` table exists, but there is no upload UI. The local stack has no Storage service, so this needs staging (VR-S01) or a Storage container.
2. **QR scan** is labelled "coming in a later phase" (it also needs printed QR labels).
3. **Shared-device PIN user switch, device revoke and local wipe, logout clearing local data:** not built (§3.6a).
4. **Warehouse UI:** the stock ledger, issue requests and receipts are built and tested in the DB, but there are no warehouse screens yet. Material shows on a task only when planned lines exist.
5. **Admin screens** for task types, problem categories, escalation rules, users/roles, workers/crews, assets and CSV import are still missing. These are configured through SQL for now.
6. **Bundle:** first load is about 192 KB gzipped (supabase-js includes the unused Realtime client). It is not measured on a device over throttled 3G. Next step: use auth-js + postgrest-js directly.
7. No PWA service worker yet, so a hard reload while offline does not load the app. Data and outbox survive in IndexedDB.
8. `pg_cron` is not available locally. The escalation scheduler is tested by calling `app.run_escalations()` directly.

## Quality gate (Phase 2 core loop)
Functionality ✅ · Data ✅ · Security ✅ (RLS + SoD tested in DB and through the UI) · Workflow ✅ (allowed + forbidden per transition) · Audit ✅ · UX ✅ field actions ≤ 3 taps · Localization ✅ (e2e in Arabic RTL) · Mobile ✅ phone viewport, offline ⚠ (no service worker yet) · Operational realism ⚠ (photos and PIN switch missing) · Regression ✅ · Data honesty ✅.
**Phase 2 is not closed** until gaps 1, 3 and 7 are done. They are the remaining 6:00 AM essentials.
