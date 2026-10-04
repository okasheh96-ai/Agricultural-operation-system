# CLAUDE.md — Agricultural Operations Management System

Authoritative instructions: `docs/MASTER_PROMPT.md`. Re-read the relevant Part at the start of every phase.
Working docs: `docs/ARCHITECTURE_PLAN.md`, `docs/VERIFICATION_REGISTER.md`, `docs/phase-reports/`.

## Current phase
Phase 2, Operations execution. Status by area (UI/DB/logic/RLS/audit/tested/production) is in `docs/GAP_REPORT.md`; keep it current.
Still open: photos (needs Storage), PIN user switch + device wipe. Next phase: Agriculture (Phase 3).

## Non-negotiable rules
1. **Evidence tiers:** A Confirmed · B Research-supported · C Working assumption · D Not Yet Verified · E Requires On-Site Discovery.
   Only tier A may drive structure. Log every tier C assumption in the Verification Register in the same commit.
2. **No fabrication.** Never invent farm data, staff, well names or statuses, fleet counts, crops, chemicals, rates,
   QC parameters, QA standards, KPIs or reporting lines. Unknown values show "غير مؤكد بعد / Not Yet Verified".
3. **No fake functionality.** No fake buttons, mock arrays, fake auth, fake permissions, fake audit or localStorage pretending
   to be persistence. Unbuilt modules show "في مرحلة لاحقة / Coming in a later phase".
4. **QA is independent of Operations.** Operations cannot update or close QA records. Only QA closes QA findings.
5. **Status changes only through `transition_record()`.** Clients never write `status` columns.
6. **Database first, UI last.** RLS on every table. UI hiding is never the only control. No hard deletes: void with a reason.
7. **Arabic-first RTL.** Every string goes through i18n with `ar` and `en` keys. Use logical CSS only (`ms/me/ps/pe/start/end`), never left/right.
8. **Quantities and money use `numeric` plus a unit id.** Never floats.
9. **Production is protected.** Never run migrations, seeds or scripts against production, or touch production secrets,
   without explicit owner approval in the conversation. Never edit an applied migration.
10. **Not wells-centric, and not FactoryOps.** Never reference or borrow from FactoryOps.
11. **One phase at a time, one workflow end to end at a time.** Every transition gets an allowed test and a forbidden test.
    Every table gets RLS tests.

## Commands
- `npm run db:test` runs every migration on a throwaway Postgres 16, then the pgTAP suite.
- `scripts/dev-stack.sh up` starts the local stack (Postgres + Supabase Auth + PostgREST) on :54321 with the demo farm. Demo users are `demo.*@demo.local` / `demo-password-123`.
- `npm run test:e2e:stack` runs Playwright against that stack. `npm run lint && npm run typecheck && npm test && npm run build`.
- Every migration that creates tables or views ends with `select app.apply_api_grants();`.

## Open items
- A staging Supabase project is needed only for deployment rehearsal, Storage and pg_cron (VR-S01).
