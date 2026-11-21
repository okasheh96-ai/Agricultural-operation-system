# Progress and recovery log — packhouse operations build

Purpose: resume from the last verified step after context loss. Newest entry last. Each entry: what was done, how it was
verified, what is next. Branch: `claude/packhouse-ops-system-rrefgr`.

## 2026-11-21

1. **Baseline (before any change):** `npm ci` ok; `npm run db:test` → 18 files, 817 pgTAP tests pass. pgTAP installed in
   the container with `apt-get install postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl`.
2. **Stage A:** every uploaded file read (S-04…S-09, all pages). SOURCES.md, DECISIONS.md, REQUIREMENTS.md, PLAN.md
   written. No spreadsheets and no SOP001 were supplied.
3. **Increment 1 database (shift core):** migration `20261121002000_po_shift_core.sql` + pgTAP `19_po_shift_core.sql`
   (80 tests). `npm run db:test` → 19 files, **897 pass**. Covers line-scoped roles, overrides, labour intervals (no overlap),
   teams, output, first-pack check, issues/QC routing, downtime (midnight, overlap, shared, open), order plan/variance, KPIs.
   Next: read model for the management overview + demo seed + UI (increment 2).
4. **Increment 2 (overview + phone form):** migration `20261121002100_po_overview.sql` (overview, at-risk orders, trend, sheet,
   my line shifts, logged exports), demo seed `demo_packhouse_ops.sql` (+3 demo users), new `/ops` area
   (`src/modules/ops/`: rail shell, overview, shift phone form, stops, orders & timing, daily KPI report), tokens in
   `src/index.css`, self-hosted IBM Plex Sans Arabic. Verified: pgTAP 908 pass; lint/typecheck/Vitest pass; stack e2e
   **24 pass** incl. new `ops-shift.spec.ts` (save → overview moves; lost connection keeps values, retry saves once;
   drill from open stop and back keeps filters; no sideways scroll at 390 px; line-B cannot read line A).
   Screenshots checked at 1440 ar/en and 390 ar. Playwright configs use /opt/pw-browsers/chromium when present.
   Next: increment 3 (dispatch, FG holds, forward trace, complaints).
