# Build plan — packhouse operations management system

Instruction: owner, 2026-11-21 ("Build my packhouse operations management system"). Sources: `SOURCES.md`.
Conflicts and open items: `DECISIONS.md`. Requirement status: `REQUIREMENTS.md`. Recovery log: `PROGRESS.md`.

## Honest scope statement

The instruction describes a complete operations platform (shift execution, traceability to dispatch and recall, people
and tasks, maintenance, a no-code operation/form/KPI/dashboard builder, user and authority administration, imports,
reporting, packaging and backups). That is several months of engineering for a team. This build delivers it in
increments, each one database-first, tested and committed, in the order below. Whatever is not finished when the session
ends is listed as **pending** in `REQUIREMENTS.md` and in the handover — not described as done.

## Architecture (extends the existing repository)

```
Browser (React, Arabic RTL default / English)        Staff phones and desktops on the private network
   │  https://<host>:8443  (LAN, local CA)   http://127.0.0.1:8080 (fallback)
   ▼
Packhouse server  (server/, Node 20+, no AI service)
   ├─ /             built app (static)
   ├─ /auth/v1      sign-in, refresh, sign-out, activation, password change  → SQL functions (bcrypt in PostgreSQL)
   ├─ /rest/v1      reverse proxy → PostgREST (JWT verified; pre-request check per call)
   ├─ /api/export   CSV/PDF exports (permission-checked in SQL)
   └─ backups       scheduled pg_dump (database + evidence + settings) with rotation; restore command
   ▼
PostgreSQL 16 — every rule: RLS on every table, ph_* SECURITY DEFINER writes, transition_record(), audit
```

- **Same database rules everywhere.** The browser never writes a table; every write is a `ph_*` function that calls
  `app.ph_authorize*()` (role × action × line scope, plus individual overrides) and, where needed, `app.ph_decision_gate()`.
- **Sessions.** A token carries its session id. PostgREST runs `app.po_pre_request()` before every request: a revoked
  session, a suspended or archived account, or a pending password change is refused on the next call.
- **Configuration engine.** Operation types, forms, tasks, rules, KPI cards and dashboards are versioned definitions.
  Built-in core workflows expose hook points; owner-defined steps attach to them and can block them (e.g. a customer-
  specific reinspection before dispatch).
- **Portability.** The only runtime pieces are PostgreSQL 16, PostgREST and Node. The launcher installs pinned PostgREST
  binaries (Linux and macOS builds exist) and uses the host's PostgreSQL 16 (Linux packages, or Postgres.app / Homebrew on
  macOS). Data lives in one folder; backups are plain SQL dumps.

## Increments (in build order)

| # | Increment | Database | App | Tests |
|---|---|---|---|---|
| 1 | Scoped authority + shift core: line-scoped roles, individual overrides, shifts, line-shifts, labour intervals, shared-team periods, output by worker/team, pack formats, customers, downtime (shared equipment, midnight), order plan baseline/revisions/timing, three KPIs | `20261121002000_po_shift_core.sql` | — | pgTAP 19 (incl. 70 kg/h, mixed 5/7 kg, mid-shift move, team change, +30 min, midnight stop, overlap refused, duplicate submission, conflicting edit, line scope) |
| 2 | Management overview + supervisor phone form + daily KPI report (print/CSV) + new theme and rail | read models | `src/modules/packhouse-ops/` | Vitest + Playwright (1440 / 390, ar / en) |
| 3 | Dispatch (M3), finished-pallet holds, forward/backward trace + recall search, complaints and corrective action | `…2100_po_dispatch_trace.sql` | Dispatch board, trace timeline | pgTAP 20 + e2e |
| 4 | Packhouse server, username accounts, activation codes, first-use change, sessions, suspend/archive, custom roles, delegated user management, effective access, permissions audit | `…2200_po_identity.sql` | Settings → People & access | pgTAP 21 + e2e on the server |
| 5 | Configuration engine: operation types, steps, fields, conditions, approvals, tasks and triggers, reusable actions, KPI measure builder, dashboards, draft/preview/validate/publish/rollback | `…2300_po_config_engine.sql` | Settings → Operations, Forms, Tasks, KPIs, Dashboards | pgTAP 22 + e2e (owner acceptance scenario) |
| 6 | Master data and imports: grading spec S-07 as versioned spec (awaiting approval), AWETA schedules S-08/S-09 (pending), meter readings → due work, cleaning vs technician work, spreadsheet import with preview / duplicates / exception queue, accountability (draft, restricted) | `…2400_po_master_import.sql` | Settings → Specifications, Maintenance, Import | pgTAP 23 + e2e |
| 7 | Acceptance runs, screenshots, backup → restore to a clean instance, restart persistence, launchers (Linux verified; macOS script not verifiable here), Arabic handover | — | — | `docs/packhouse-ops/ACCEPTANCE.md` |

## Rules carried from CLAUDE.md

Evidence tiers; no fabrication (unknown → "غير مؤكد بعد / Not Yet Verified"); no fake functionality; QA independent of
Operations; statuses only through `transition_record()`; RLS on every table, no hard deletes; Arabic-first RTL with `ar`
and `en` keys and logical CSS; numeric quantities with units; production untouched; one workflow end to end at a time,
each transition with an allowed and a forbidden test.
