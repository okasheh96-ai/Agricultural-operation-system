# Packing house M2 report: waste, mass balance, orders, plan, split / merge (M2.2 + M2.3)

Date: 2026-10-21 · Spec: PH-OAS-SPEC-001 v0.1 · Follows `packing-house-m2-1.md` (Job Cards, G5, QC-2, finished pallets).

**Status: every M2 workflow listed below runs end to end on the demo farm. M2 is not closed for a real farm.**
- The critical decisions (OD-01, 02, 03, 05) are open, so receiving, and everything after it, is refused there.
- OD-11 (waste routing), OD-15 (Job Cards) and OD-28 (mass-balance tolerance, weight loss) are open.
- Five M2 functions are not built (see "Not built").
- The SOPs are draft 001. Nothing has run on a staging project (VR-S01).
- The 17 first open decisions are reviewed in `docs/packing-house/OD_REVIEW_M2.md`. None is approved.

## Built

**Database**
- Migration `20261021001600_ph_waste_reconciliation.sql`: waste, MB-01, balances and the duplicate-request guard.
- Migration `20261021001700_ph_orders_plan_splitmerge.sql`: orders, plan and split / merge.
- Migration `20261021001800_ph_m2_read_model_fixes.sql`: the fix described below.
- No applied migration was edited.

| Area | What it does |
|---|---|
| Duplicate submissions | Each form sends one request id. A repeat (double tap, retry after a lost answer) gets the first answer back and creates nothing. Another person or function reusing the id is refused. Covers arrival, pallet, Job Card (also for an order), packaging issue, finished pallet, waste record, order line, split and merge (VR-PH-C32). |
| Waste (ST-11, SM-WR) | Recorded by DEC from its source: a running, paused or completed Job Card, a finished pallet, an incoming pallet, or a store. Long-storage waste needs photos. QC labels it, or refuses it back to the line (G7). It is weighed only after the label (V-16). It is routed by weight (V-17; OD-11 gate): small goes to the PHM; large goes to PHM, WHM and FIN (QCM and QAM after OD-11); long storage above 1 t goes to top management first. SoD-03: the creator, labeller and weigher never sign, and each person and each role signs once. Then the ERP reference (typed, OD-04) and disposal. |
| MB-01 Job Card balance | Live from the records: issued − returned = consumed; consumed − finished − weighed waste = variance. Nothing is forced. Unweighed waste blocks reconciliation. With no approved tolerance (OD-28) any variance needs an explanation and is listed (exception MB-01). Completed → Reconciled → Closed; reopening is refused until OD-15 sets a window. |
| MB-02 / MB-03 | Lot balance (accepted, consumed, in production, in stock, raw waste, in finished pallets, unexplained) and arrival balance (from the scale; the farm dispatch weight is not captured, OD-01 / CP-02). |
| Orders (ST-00) | Sales enters order lines (C). The PHM accepts, or rejects with a reason (C). Amend and cancel are proposals (P). A shortage notice goes to Sales and Logistics and records whether the 24 h local / 48 h export notice was met. The customer is free text: there is no customer master (OD-06). |
| Daily plan (FR-PL-03) | Open order lines; Job Cards by line; raw stock, oldest first; finished stock. |
| Job Card for an order | Crop and grade come from the accepted line (V-10). The label content stored with each print carries the customer and order line; **the on-screen label does not draw them yet** (defect found 2026-10-21, see `docs/packing-house/M2_CLOSURE_CHECKLIST.md`). |
| Split / merge (FR-FG-04/05) | The operator requests (the children must add up), and the PHM, a different person, approves; approval executes. Children keep the QC stamp time (the 24 h validity does not restart) and the location; composition is pro rata. Merge needs the same crop, grade, customer and storage group (V-22) and the same Job Card. |
| Trace | Through splits and merges, plus the waste and the order line / customer. |
| Board | Counts for Orders and Waste. Exceptions E-20 (top management overdue), OD-11 (weighed waste waiting) and MB-01. |

**Fixed during this increment.**
- A split or merge closes its parent pallets (status split_merged) and creates new ones on the same Job Card.
- MB-01 and the Job Card board summed every finished pallet, so after a split the finished kilograms were counted twice.
- Migration `001800` counts only pallets that still exist. Regression tests in pgTAP 18 fail without the fix and pass with it.

**Application**
- **Board tabs:** Orders (new order line, accept / reject, amend, cancel, shortage notice, plan a Job Card) and Waste (record,
  QC label, weigh, route, top management, sign-off, ERP reference, disposal).
- **Record views:**
  - Waste: stepper, strips, sign-offs, photos, history, server actions with reasons.
  - Job Card: mass balance and its waste, reconcile, close, record waste, order line.
  - Finished pallet: split, merge, record waste, lineage, order line, QC stamp carried from.
- **Other pages:**
  - Split / merge requests wait for the PHM on the FG storage tab.
  - New Daily plan page.
  - The Trace page shows waste, the order line and lot / arrival balances.
- All new text is in Arabic and English.
- **Demo:** new people Sales, Finance and QC Manager. The demo seed adds three order lines (accepted with a planned Job Card,
  pending, rejected) and three waste records (awaiting QC; weighed and waiting for the PHM; long storage with one of five
  signatures). OD-11 is a labelled demo assumption.

## Tests (actual results, 2026-10-21)

| Suite | Result |
|---|---|
| `npm run db:test` (Postgres 16, all migrations, pgTAP) | 18 files, **817 tests pass** (`17_ph_waste_reconciliation.sql` 88, `18_ph_orders_splitmerge.sql` 103) |
| `npm run lint` · `npm run typecheck` · `npm run build` | pass |
| Vitest | 13 files, **78 tests pass** (4 new: order / split statuses match the migration, every waste, Job Card and FG action, reason, notification and exception rule has both languages) |
| `npm run test:e2e` (shell, phone + desktop) | 6 pass |
| `npm run test:e2e:stack` (real PostgREST + Auth + Postgres 16) | **20 pass**. New: request ids through PostgREST (a repeat returns the first record), direct writes refused, waste routed on the demo assumption, plan empty for a non-packing-house user. The M2.1 test was made re-runnable on a kept local database. |
| In-browser demo e2e (iPhone size, artifact-like CSP) | **9 pass**. New: waste → sign-off → ERP → disposal and reconcile → close; orders with a refused-then-corrected save and a double tap; Job Card for an order; split approved and traced; daily plan; no sideways scroll at phone width. |

Every new transition has an allowed and a forbidden case in pgTAP 17 / 18:
- wrong role;
- wrong state;
- outside the server function;
- direct status write;
- self-approval;
- a real farm with proposals off.

## Not built (M2 scope)

| Function | Why |
|---|---|
| Rework Job Card (FR-PR-07, GEN-09) | Needs the "rework" hold disposition, refused since M1, and its approval rule |
| Customer deviation (FR-PR-08) | Needs customer specifications (OD-06) and the deviation cell (NYV, VR-PH-E05) |
| Relabel / void label (FR-FG-06) | Not built |
| Packaging waste count (FR-WS-06) | Counted by the warehouse; refused with a reason |
| Weight-loss adjustment (FR-WS-05, MB-04) | OD-28 |
| Automatic E-20 timeout | Needs a scheduler (VR-S01); listed on the exception board |

## Decisions that block a real farm

See `docs/packing-house/OD_REVIEW_M2.md` for OD-01…OD-17. Beyond them:
- OD-28: mass-balance tolerance and weight loss.
- OD-37: order source and planner keying.
- OD-20 / OD-24: barcode and printer.
- OD-29: weight plausibility.
- The proposed cells M2 uses: Job Cards (OD-15), amend / cancel, split / merge and its approval.
