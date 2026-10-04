# Implementation Architecture Plan

Status: working document · v0.1 · 4 Oct 2026 · Phase 0 output. Re-read `MASTER_PROMPT.md` before changing this.

## 1. Current state (Phase 0 inspection)

| Item | Finding |
|---|---|
| Repository | **Empty.** No commits, code, schema, migrations or tests. |
| Lovable prototype | **Not found.** It is not in this repo, and none of the owner's other GitHub repos is a prototype for this system. (The FactoryOps repos are excluded by §0.4 and were not opened.) |
| Supabase project | None reachable from this environment. No credentials and no project ref. |
| Real data to preserve | None found. E48 stays open: if a Lovable/Supabase project with real data exists elsewhere, the owner must say so before any production work. |

**Keep / refactor / replace:** nothing to classify. This is a greenfield build. ADR 0001 records why.

**Consequence:** Part 6 (prototype handling) does not apply unless the owner points to the Lovable project. If they do,
the procedure in §3.14 applies: export its schema as a baseline migration *before* these migrations, and map wells onto `water_sources`/`wells`.

## 2. Target architecture summary

- **Stack:** the §3.2 stack, unchanged. React + TS + Vite PWA · Tailwind (logical properties) · i18next (ar default) ·
  TanStack Query · Dexie outbox · Zod · Supabase (Postgres, Auth, RLS, Storage, Edge Functions) · Vitest · Playwright · pgTAP.
- **Business rules live in Postgres.** These include RLS, `transition_record()`, the audit triggers, the optimistic-concurrency
  and no-delete triggers, and the inventory ledger functions (Phase 2–3). The client is a thin, offline-capable executor.
- **Shared engines, scoped modules.** The work, exception and inventory engines are shared. Departments (Wells, Packing House
  Maintenance, Cattle, …) are scoped views plus a few specific tables. No module gets its own task, audit or permission system.

### Information architecture
`Farm → Location tree (production system → zone → block/house/field → sub-unit) → Assets / Water sources → Departments → People/Roles → Work (plans → work orders → tasks → entries) → Exceptions → Inventory → Quality → Outputs.`

### Module dependencies (build order)
```
Foundation (P1): org, roles/permissions, locations, assets, water sources, crop master, units,
                 audit, transitions, verification, i18n, shells, offline skeleton
   └─ Work + Exception engines (P2) ──┬─ Inventory core (P2–3, Main Warehouse) ─ Plant protection (P3)
                                      ├─ Agriculture / harvest (P3) ─ Packing house (P8) ─ QC/QA (P9)
                                      ├─ Irrigation & water (P4)
                                      ├─ Maintenance (P5) ─ Maintenance Warehouse (P6)
                                      └─ Fleet (P7)
   Analytics / KPIs / costing (P10) depend on verified rates and targets.
```

### Integration boundaries
FarmERP stays the system of record for accounting, valuation and (for now) financial harvest data (§1.2). The split per data type is E38 and is configurable (`settings.record_of_truth`).
Phases 1–9 use CSV export/import with stable codes. There is no live integration until E37/E38 are answered.

### Data validation
Zod schemas in `src/core/validation` mirror the DB constraints. The DB is the final authority (CHECKs, FKs, exclusion constraints,
`transition_record` required fields). Imported master data defaults to `not_yet_verified`.

### Offline / sync model (§3.7)
1. Dexie keeps the working set plus an outbox. Each mutation carries an `idempotency_key`, `client_recorded_at`, `device_id`,
   `entity_id` and `base_version`.
2. Replay runs per record in device-time order, parents first.
3. The server writes the key to `processed_mutations`, so a replay returns the stored result.
4. A rejected transition goes to `sync_conflicts` and is shown to the user. It is never dropped.
5. The client applies status changes provisionally (`pending`) using the synced `allowed_transitions` mirror.
6. Clock skew beyond `settings.clock_skew_flag_seconds` (tier C default 300 s) is flagged.

### Audit model (§3.8)
`audit_events` is append-only. Insert happens only through SECURITY DEFINER triggers. UPDATE/DELETE are revoked and also blocked by a trigger.
The actor is `auth.uid()`, or the `app.acting_user_id` that server functions set from their real caller. Scheduler rows use `actor_kind='scheduler'`, never "service".

### Localization (§3.9)
`ar` is the default (`dir=rtl`) and `en` is secondary. `normalize_ar()` in Postgres (and `normalizeArabic()` in TS) folds alef variants, ta marbuta,
alef maqsura, diacritics and tatweel. Master tables carry a generated `search_text` column. Codes and units are wrapped in `<bdi>`. The font is IBM Plex Sans Arabic, self-hosted (added in the PWA step).

## 3. Data model deltas vs. §3.4
Justified deviations (each also recorded in `DOMAIN_MODEL.md`):
1. **`user_profiles`, not `users`.** Supabase owns `auth.users`. The profile row is keyed by the same id.
2. **`role_permissions` is data** (role × object_type × action × allowed_states). Department and location scope come from `user_roles`.
   This gives the six dimensions without a cartesian table.
3. **`workflow_entities` registry.** It lets one `transition_record()` serve every domain table through dynamic SQL, with no per-module copies.
4. **`worker_private`** splits ID numbers and phone numbers out of `workers`, so privacy (§3.6a) is enforced by RLS, not by the UI.
5. **No farm name seeded.** The seed creates one farm row named "Not Yet Verified" so departments (tier A) have an owner.

## 4. Migration strategy
- Migrations live in `supabase/migrations`, one per logical change, never edited after they are applied. Each table has a `COMMENT` stating its operational purpose.
- Supabase specifics (`auth` schema and the `anon`/`authenticated` roles) are provided in CI and local tests by `supabase/tests/_shim.sql`.
  On a real Supabase project the shim is **not** applied.
- Seeds: `supabase/seed/seed.sql` holds structure only (§5.3). `supabase/seed/demo.sql` holds demo data for a separate demo farm and never runs in production (Phase 2).
  `supabase/seed/optional_well_placeholders.sql` holds 14 temporary W-01…W-14 codes and runs only if the owner chooses (VR-C05).

## 5. Phase order
As §7.2, with two recorded changes:
- **Main Warehouse core (items, units, stock movements, issue requests) moves into Phase 2.** Material consumption in Phase 2 needs a real item and
  ledger to point at. Faking it would break rule 3.
- **Phase 1 is split into 1a (database foundation, done) and 1b (UI: admin screens, PIN switch, PWA/offline shell).** 1b needs a
  reachable Supabase instance to test end to end (VR-S01).

## 6. Environment plan
| Env | What | Status |
|---|---|---|
| local | Postgres 16 + shim (`npm run db:test`); Supabase CLI + Docker when available | Postgres path working |
| CI | GitHub Actions: lint, typecheck, Vitest, build, migrations on a fresh PG16 + pgTAP | Added in Phase 1 |
| staging | Separate Supabase project | **Needed from owner** (VR-S01) |
| production | Owner's Supabase project | Untouched. Every change needs explicit owner approval |
Secrets live only in env vars. `.env.example` is committed and `.env` never is. Sentry, PITR and service-worker versioning come with Phase 1b/2 (§3.14).

## 7. Risks
| Risk | Mitigation |
|---|---|
| Building before discovery (Master Plan says Phase 0 = 2–4 weeks on site) | Foundation is outcome-neutral. Every value is configurable and tier-labelled |
| An unseen Lovable project holds real data | Nothing touches production. E48 stays open until the owner answers |
| No live backend in the dev environment | DB logic is tested directly with pgTAP. UI e2e waits for staging |
| Supervisors don't adopt (data burden) | ≤3-tap rule, one device per crew, pilot one department first |
| Scope creep | §2.10 exclusions enforced. Anything new needs owner approval |
