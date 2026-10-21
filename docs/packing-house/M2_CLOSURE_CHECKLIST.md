# M2 closure checklist (packing house)

Date: 2026-10-21. M2 is **built and tested on the demo farm, and not closed**. It closes when every box in sections 2–4 is ticked
and the section 5 walk-through passes on a staging copy with real users.

## 0. How to test now

| Way | What it is |
|---|---|
| Link: https://claude.ai/artifact/3ToLcNe4z7Y9T8xfQ3gM7V (version 4) | The Claude preview. Private to the owner unless shared. Printing is blocked by the page frame. |
| `packing-house-demo-M2.html` (31 MB, the same build) | Open from disk in Chrome or Edge. Printing works. |

**What runs inside the file (no server):**
- The whole app, in Arabic and English, at phone or desktop size.
- The system's own PostgreSQL database, running every migration in the browser:
  - row-level security, the permission matrix, workflow transitions, segregation of duties and decision gates;
  - the audit trail, repeat-submission protection and in-app notifications.
- 16 packing-house demo sign-ins.
- Photos, stored inside the browser database.
- Printing, and offline use once the file is open.
- Data is kept in that browser on that device and survives a reload (checked in Chromium from `file://`). If a browser blocks
  storage for local files, the demo still runs but says changes are not kept. "Reset demo data" (bottom corner) starts over.
- Only Chrome and Edge (Chromium) have been tested; Safari and Firefox have not.
- The database runs inside the page. A save still running when the page reloads (signing out reloads it) is abandoned, so wait
  until the form closes before switching roles. On a server the save would finish.

**What needs a real server (the file does not provide it):**
- Data shared between people and devices; every copy of the file is separate.
- Real authentication. Demo passwords are checked inside the browser and the whole database is on the device, so this is not a
  security boundary.
- Real farms. The file holds the demo farm only. Real-farm refusals are tested on the server stack and in pgTAP.
- Photo storage (Supabase Storage), scheduled jobs (pg_cron), and email or push notifications. None of these exist yet.
- ERP integration. None exists anywhere.

## 1. Completed and tested

All tests pass: pgTAP 817, Vitest 78, server stack 20, browser demo 10 (including the section 5 walk-through,
`m2-chain.spec.ts`), shell 6.

| Feature | Evidence |
|---|---|
| Job Cards: plan, approve, inputs (partial issue), packaging, ready, two-person line start (G5), QC-2 (G6), complete | pgTAP 16, stack `production`, browser `production` |
| Finished pallets: create, FG label (V-09), QC stamp (24 h), move to FG fridge (V-07/V-08) | pgTAP 16, browser `production` |
| Waste: record, QC label (G7), weigh after label (V-16), route by weight (V-17), top management, sign-off (SoD-03), ERP reference, disposal | pgTAP 17, stack `m2`, browser `m2` |
| MB-01 Job Card balance, reconcile with explanation, close; MB-02 lot and MB-03 arrival balances | pgTAP 17 and 18, browser `m2` |
| Order lines: enter, accept / reject, amend, cancel, shortage notice; Job Card for an order (V-10) | pgTAP 18, stack `m2`, browser `m2` |
| Daily plan | pgTAP 18, stack `m2`, browser `m2` |
| Split / merge with PHM approval (V-22, no self-approval), lineage, trace through it | pgTAP 18, browser `m2` |
| Trace: FG pallet ↔ Job Card ↔ order line / customer ↔ lot ↔ incoming pallet ↔ arrival ↔ source, with waste | pgTAP 15–18, browser `production` and `m2` |
| Repeat submissions return the first record | pgTAP 17 and 18, stack `m2` |
| Direct writes refused; status only through server functions; audit on every change | pgTAP 14–18, stack `m2` |

## 2. Not yet built

| ☐ | Feature | What it needs before it can be built |
|---|---|---|
| ☐ | Rework Job Card (FR-PR-07, GEN-09) | The rule for the "rework" hold disposition and who approves it (refused since M1) |
| ☐ | Customer deviation (FR-PR-08) | Customer specifications (OD-06) and a named decision for the `deviation.create` SAL cell (NYV, VR-PH-E05) |
| ☐ | Relabel / void label (FR-FG-06) | Approval of the proposed `fg_pallet.relabel` DEC cell; the barcode format (OD-20) for the reprinted label |
| ☐ | Packaging waste count (FR-WS-06) | The warehouse counting procedure and a packaging item list (none supplied) |
| ☐ | Weight-loss adjustment (FR-WS-05, MB-04) | OD-28: weekly weight-loss % per crop and its approver |
| ☐ | Automatic E-20 timeout (top management, 24 h) | A scheduler: a staging Supabase project with pg_cron (VR-S01), set up only with your approval. Today the overdue record is listed on the exception board. |

Also found while preparing this list:

| ☐ | Gap | What it needs |
|---|---|---|
| ☐ | **Defect: the on-screen FG label leaves out the customer and order line.** The label content returned and stored with each print includes them (pgTAP 18), but the label drawn on screen does not show those two fields. Found by the section 5 walk-through. | A small change to the label view, then rebuild and republish the demo. Not done, so the build you have stays unchanged. |
| ☐ | The FG label for an order pallet shows the customer name, but not the **customer address** or the **customer-specific requirements** that §7.3 lists (C). V-09 does not yet refuse the label without them. | A customer master (FR-MD-04) and specification ownership (OD-06) |

## 3. Decisions and approvals

**Open decisions:**

| ☐ | Decision | Approvers (from the spec) | What it unblocks |
|---|---|---|---|
| ☐ | OD-01 (critical) | PHM + WHM + QAM; Farm Operations for CP-02 | Pallet registration |
| ☐ | OD-02 (critical) | QAM + PHM | Lots |
| ☐ | OD-03 (critical) | PHM + WHM + IT | Pallet numbers and labels |
| ☐ | OD-05 (critical) | QAM | Acceptance against tolerances |
| ☐ | OD-11 | PHM + FIN + WHM + QAM + QCM | Waste sign-off routing; QCM / QAM signatures |
| ☐ | OD-15 | PHM | Job Cards; the reopen window |
| ☐ | OD-28 | Owners per spec | Mass-balance tolerance; weight loss |
| ☐ | OD-37 | Owners per spec | Order source and format; planner keying |
| ☐ | OD-06 | SAL + QCM | Customer specifications |
| ☐ | OD-13 | PHM + WHM | Who records Job Card inputs and FG pallets |
| ☐ | OD-14 | PHM + WHM | Who moves fridge stock |
| ☐ | OD-17 | QCM + PHM | QC-1 scope; receiving roles |
| ☐ | OD-07, 09, 12, 16 and OD-20, 24, 29 | See `OD_REVIEW_M2.md` | Rules and settings outside the core M2 flow |

Of these, OD-01, 02 and 11 are the ones the build follows today; they still need sign-off.

**Proposed (P) permission cells M2 uses.** On a real farm each is refused until the owner of its record type approves it.

| ☐ | Cell | Roles |
|---|---|---|
| ☐ | `job_card.create` | PE, PHM |
| ☐ | `job_card.approve` | PHM |
| ☐ | `job_card.execute` | LL |
| ☐ | `job_card.record_inputs` | LL |
| ☐ | `job_card.close` | PHM |
| ☐ | `fg_pallet.create` | PHO |
| ☐ | `stock_move.execute` | PHO, DEC |
| ☐ | `stock_move.override_placement` | PHM |
| ☐ | `fg_pallet.split_merge` | PHO |
| ☐ | `fg_pallet.split_merge_approve` | PHM |
| ☐ | `customer_order.amend` | PHM, SAL |
| ☐ | `waste.create` | DEC |
| ☐ | the `*.view` cells | see section 4 |

**Without these approvals, no Job Card can run and no waste can be recorded on a real farm.**

**Not-yet-verified (NYV) cells that need a named decision:**

| ☐ | Cells | Decision |
|---|---|---|
| ☐ | `waste.signoff_large` QCM / QAM | OD-11 |
| ☐ | `job_card.record_inputs` and `fg_pallet.create` for TRC / DEC | OD-13 |
| ☐ | `stock_move.execute` STK | OD-14 |
| ☐ | `waste.create` PHO | None named |
| ☐ | `packaging.request` LL / PE | None named |

**Documents:**
- ☐ The six product SOPs and the QC Function charter approved (they are draft 001 with no effective date). Line-start and QC-2
  checklists cite them as drafts.

## 4. Access-control issues

| ☐ | Issue | Detail | What it needs |
|---|---|---|---|
| ☐ | **Customer names are visible to every packing-house role.** | Anyone holding any `ph_*` role on the farm can read order lines. Customer names also appear on the Job Card and FG boards, the FG label, the daily plan and the trace. The spec's `customer_order.view` cell lists 12 roles, all *proposed*: PHM, PE, LL, DEC, WHM, QCI, QCM, QAO, QAM, SAL, LOG, AUD. Eight roles therefore read customer names outside the matrix: **PHO, STK, ENG, TRC, FRM, FIN, TOP, ADM.** People with no packing-house role see nothing (tested). PHO prints FG labels, and §7.3 puts the customer on the label, so restricting PHO also affects label printing. | Decide which roles may see customer names, approve the view cells, then enforce them in the database. This is a permission change, so it is not made without that approval (VR-PH-C31). |
| ☐ | **View cells are not enforced in general.** | `job_card.view`, `fg_pallet.view` and the other view cells are proposals and not checked. Every packing-house role reads every packing-house record (VR-PH-C02). | Same as above, for each record type. |
| ☐ | **Two roles are working assumptions.** | The shortage notice uses the PHM's accept cell (VR-PH-C29). Disposal uses the clerk's waste cell (VR-PH-C24). The spec names neither. | Confirm or name the roles. |
| ☐ | **The demo is not a security boundary.** | Demo sign-in runs in the browser and is for testing only. Real accounts need the server (Supabase Auth). | — |
| ☐ | **PIN user switch on shared devices.** | Not built (open since Phase 2). | — |

## 5. Full M2 walk-through (demo data)

Each step names the demo sign-in to tap. Switch roles with "Sign out", after the last form has closed. "English" (top bar)
switches the language. This exact sequence is automated in `tests/e2e/browserdb/m2-chain.spec.ts`.

1. **Sales:** Orders → "+ New order line": a customer, Cherry tomato, Grade 1, a pack, 100 kg, a date 3 days ahead, Local →
   "Enter order line". Try a past date first: it is refused and can be corrected.
2. **Packing House Manager:** Orders → on the new line, "Accept / reject" → Accept.
3. **Production Engineer:** Orders → "Plan Job Card" → Line A → "Create Job Card" (opens the Job Card, Draft; the order line is
   shown).
4. **Packing House Manager:** the Job Card (Production tab, or search its code) → Approve.
5. **Store Keeper:** "Issue packaging" (any item, any quantity).
6. **Line Leader:** "Issue pallet" (the cherry pallet with kg left), 100 kg → "Mark ready".
7. **QC Inspector:** "Line-start check (G5)" → all OK → "Line ready" → "Record line-start check". Then **Line Leader:**
   "Confirm line start".
8. **QC Inspector:** "QC-2 inspection" → "Final (end of run)" → all OK → Pass.
9. **Packing House Operator:** "Finished pallet": 20 boxes, 90 kg, a scale → open it → "FG label". It prints in the standalone
   file; the customer is not drawn on it yet (defect, section 2).
10. **QC Inspector:** "QC stamp". Then **Packing House Operator:** "Move to FG fridge" → F1.
11. **Packing House Operator:** "Split": 10 / 45 kg and 10 / 45 kg, with a reason → "Request split". Then **Packing House
    Manager:** FG storage tab → "Decide" → Approve. The pallet closes and two new pallets appear in F1.
12. **Data Entry Clerk:** open the Job Card → "Record waste" (processed, estimate 6 kg).
    - **QC Inspector:** Waste tab → "QC waste label (G7)" → approve.
    - **Data Entry Clerk:** "Weigh" 6 kg. It routes to the PHM (OD-11 demo assumption).
    - **Packing House Manager:** "Sign off".
    - **Data Entry Clerk:** "ERP reference", then "Disposed".
13. **Line Leader:** the Job Card → "Complete": 98 kg consumed (2 kg returned).
14. **Packing House Manager:** "Reconcile (MB-01)". The balance shows 98 − 90 − 6 = 2 kg, and an explanation is required (no
    tolerance, OD-28). Then "Close Job Card". "Reopen" stays unavailable (OD-15).
15. **Anyone:**
    - Search a new pallet code: the trace shows the split parent, the Job Card, the order line and customer, the incoming pallet,
      the waste and the lot balance.
    - Packing House → Daily plan.
    - The Exceptions page lists MB-01.

**Checks along the way:**
- A role without the step sees the button disabled, with the reason.
- The person who requested the split cannot approve it.
- The weigher cannot sign.
- A double tap creates one record.
