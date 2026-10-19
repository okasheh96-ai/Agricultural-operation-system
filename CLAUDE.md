# CLAUDE.md — Agricultural Operations Management System

Authoritative instructions: `docs/MASTER_PROMPT.md`. Re-read the relevant Part at the start of every phase.
Working docs: `docs/ARCHITECTURE_PLAN.md`, `docs/VERIFICATION_REGISTER.md`, `docs/phase-reports/`.

## Current phase
Packing house (owner instruction 2026-10-19, spec `docs/packing-house/PH-OAS-SPEC-001_v0.1.pdf`): milestone M1 (receiving → QC-1)
is built; next is M2 (production, QC-2, FG pallets, waste). Plan: `docs/BUILD_ASSESSMENT.md`; per-ID status:
`docs/packing-house/TRACEABILITY.md`. Open decisions live in `ph_open_decisions` (critical: OD-01, 02, 03, 05, 24, 25). On a real farm,
steps that depend on an open decision stay blocked; demo assumptions are allowed only on the demo farm and are labelled.
Status by area is in `docs/GAP_REPORT.md`; keep it current. Still open from Phase 2: photos via Storage, PIN user switch + device wipe.
Agriculture (Phase 3) follows the packing house unless the owner reorders (VR-PH-S03).

Packing-house rules: every write is a `ph_*` SECURITY DEFINER function that calls `app.ph_authorize()` (role × action cell) and, where
needed, `app.ph_decision_gate()`; API users get no insert/update on `ph_*` tables or views. Keep the C/P/NYV label of every cell and
parameter; never turn P or NYV into a rule without an approval or a recorded decision.

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
- `npm run codespaces` serves the current build on :4173 for hands-on testing in GitHub Codespaces (one port; the app server proxies the API).
- `npm run test:e2e:stack` runs Playwright against that stack. `npm run lint && npm run typecheck && npm test && npm run build`.
- `node scripts/build-browser-demo.mjs` builds the in-browser demo (app + PostgreSQL in the browser, demo farm only) and
  `npx playwright test -c playwright.browserdb.config.ts` tests it; see `docs/BROWSER_DEMO.md`. It is a demo, not a deployment.
- Every migration that creates tables or views ends with `select app.apply_api_grants();`.

## Open items
- A staging Supabase project is needed only for deployment rehearsal, Storage and pg_cron (VR-S01).
