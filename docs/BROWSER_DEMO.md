# In-browser demo (packing house M1 + M2)

A way to open and use the application from a link, on a phone or laptop, with nothing installed and no server. It is a
**demo**, not a deployment.

## What it is

- The normal React app, built with `--mode browserdb`.
- The system's own database runs **inside the viewer's browser**: PostgreSQL 17 compiled to WebAssembly (PGlite, Apache-2.0).
  - It runs every migration in `supabase/migrations`, the structure seed, the demo farm (`supabase/seed/demo.sql`) and the demo
    people (`scripts/demo-people.mjs`).
  - Row-level security, grants, triggers, `transition_record()`, the packing-house permission matrix, decision gates and the
    audit trail all run as they do on the server.
- The Supabase client's HTTP calls are answered inside the page:
  - `src/browser-db/postgrest.ts` translates PostgREST requests and runs each one in its own transaction, as the
    `authenticated` role with the caller's JWT claims, exactly as PostgREST does.
  - `src/browser-db/gotrue.ts` answers the sign-in calls.
  - Neither decides anything itself. Unsupported request shapes are refused with an error, not guessed.
- On the first visit, the time-based demo records are created by the same seeds the local stack uses, so their timers start
  then (`demo_tasks.sql`, `demo_packing_house.sql`, `demo_packing_house_production.sql`, `demo_packing_house_m2.sql`; the last
  records OD-11 as a labelled demo assumption so waste sign-off can be tried).
- Data is kept in that browser (IndexedDB), written before each request answers. "Reset demo data" (bottom corner) starts over.

## How it differs from a real deployment

| | In-browser demo | Deployment (Supabase + static host) |
|---|---|---|
| Data | Per browser and device; nobody else sees your changes | Shared by everyone |
| Sign-in | Demo people only; the password is checked by the database in your browser (`supabase/browser-demo/auth.sql`). **Not a security boundary**: the whole database is on the device | Supabase Auth |
| Rules, RLS, workflow, audit | Same SQL; PostgreSQL 17.5 (the local stack and CI run 16; every migration applies on both, and the pgTAP suite runs on 16) | Same |
| Photos | Stored in the database (≤ 5 MB each) | Same until Storage (VR-S01) |
| Printing | Not inside the claude.ai page (its frame blocks the print dialog); works from the standalone file | Works |
| Offline | Works offline after the first load while the tab stays open | PWA with offline queue |

It contains only the demo farm. It never connects to a server database and holds no secrets. The anon "key" and tokens are
placeholders.

## Build, test, publish

```bash
node scripts/build-browser-demo.mjs                        # .local/browser-demo/{site,standalone,preview}
npx playwright test -c playwright.browserdb.config.ts     # 9 tests, iPhone size, CSP like the artifact host's
node scripts/serve-browser-demo.mjs 4175                   # http://127.0.0.1:4175 (BROWSER_DEMO_CSP=artifact-wasm to mimic the host)
```

**Outputs:**
- `site/`: the files published to the claude.ai artifact.
  - The page is `index.html`; the host wraps it in a document.
  - The database files are shipped as base64 text, because the host serves only web file types.
- `standalone/index.html`: one self-contained file (about 29 MB) that opens from disk.

**What the host must allow:** WebAssembly. Under a policy without `wasm-unsafe-eval`, the page shows "The demo database could
not start", with the browser's reason (tested).

**Tests:** `tests/e2e/browserdb/packing-house.spec.ts`, `production.spec.ts`, `m2.spec.ts`, `session.spec.ts`
- Moves one pallet from arrival to QC-1 release through five demo roles, reloading between them.
- Takes a Job Card from plan to a finished pallet in a finished-goods fridge through six roles (partial issue, failed and
  corrected line start, QC-2 final pass, FG label, QC stamp, completion) and traces it back; checks no sideways scroll at phone width.
- M2 (`m2.spec.ts`): waste from the QC label to weighing, sign-off, ERP reference and disposal; the Job Card mass balance
  (1.9 kg variance, explanation required without a tolerance), reconciliation and closing; an order line (a refused past date
  corrected and sent again, a double tap creating one line), accepted, planned as a Job Card; a finished pallet split approved by
  the manager and traced back through the split; the daily plan.
- Checks the board, English and a read-only auditor.
- Runs the app inside a cross-origin sandboxed frame.
- A sign-in kept from an earlier demo version is dropped when the new version replaces the database (`session.spec.ts`);
  anyone signed in without an active role can sign out from that screen.
