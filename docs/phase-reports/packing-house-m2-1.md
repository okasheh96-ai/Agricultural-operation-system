# Packing house M2.1 report: production → QC-2 → finished pallets in storage

Date: 2026-10-21 · Spec: PH-OAS-SPEC-001 v0.1 · Checklists: product SOPs (Cherry Tomato, Tomato, Blocky Capsicum Color, Sweet Bite
Pepper, Melon, Watermelon) and the QC Function charter, all **draft version 001 with no effective date** (VR-PH-E08).

Status: **M2.1 works end to end on the demo farm**, through the UI in the in-browser demo and through the API on the real local
stack. On a real farm, Job Cards are refused until the owner approves the proposed Job Card cells (OD-15). Finished-pallet grades
cannot be checked against a standard: none was supplied (OD-05, OD-06). The module is **not production-ready**: the critical
decisions are open, nothing has run on a staging project (VR-S01), and the SOPs are drafts.

## Built in this increment

**Database (migration `20261021001500_ph_production.sql`; no applied migration edited)**
- **Job Card (SM-JC, `JC-YYMMDD-<line>-NN`)**
  - Planning (PE/PHM) checks the approved crop and line and the crop's route (Figure 4.2; the washer is not a packing line), and
    needs a grade target.
  - Approval and cancellation by PHM; a cancelled Job Card must have no inputs.
  - Ready needs released inputs and packaging. Pause and resume need a reason.
  - Completion closes every input (consumed + returned = issued).
  - Reconciled, Closed and Reopen are declared and **refused until M2.2** (MB-01, OD-28, OD-15).
- **Inputs (V-05, GEN-04)**
  - Only QC-1 released pallets of the same crop, not held. Part of a pallet may be issued; the available kg is tracked.
  - On completion a pallet with kg left returns to Stored and needs QC-1 again (SM-IP); a pallet with none left is Consumed.
- **Packaging** is issued by the store keeper (SOP-PL) as a described item and quantity. There is no packaging master yet.
- **G5 line start**
  - One of QC / Line Leader records the crop's SOP checklist; a different person holding the other role confirms.
  - A fail blocks the Job Card (exception E-09; PHM and PE notified) until the Line Leader records the correction.
- **G6 QC-2 (ST-09)**
  - Online and final inspections use the crop's SOP checklist, with photos.
  - Without a customer specification the result is recorded as "no tolerance set" and listed for QA review.
  - A fail sends the re-sort task to PHM and PE, not the operators (T-10, E-10), and stops new finished pallets until a later
    final pass.
- **Finished pallet (SM-FGP, `FGP-YYMMDD-NNNNN`)**
  - Created only after a QC-2 final pass. It needs a grade (V-10), box count, net kg and a scale; a scale without a calibration
    date is flagged. Plausibility is not checked until OD-29.
  - Composition by lot is proportional to the kg issued, and the method is stored (GEN-05/06).
  - The FG label is refused while a §7.3 field is unknown (V-09); every print is logged, and a reprint needs a reason. Barcode:
    OD-20.
  - The QC stamp starts the 24 h validity (CP-06).
  - Moves go only into finished-goods fridges, with the storage-group check (V-07) and the capacity warning (V-08).
  - Allocation, loading, holds and split/merge are declared and refused (M2.3 / M3).
- **Read models**
  - Job Card, input, packaging and inspection lists, and the FG board.
  - Stage counts for production, QC-2, FG pallets and FG storage.
  - Exception rules E-09, E-10 and OD-06.
  - Trace from an FG pallet, Job Card, pallet, arrival or lot code: back to source and arrival, forward to Job Cards and FG pallets.
- **Access**: every write is a SECURITY DEFINER function checking the role × action cell. API users get no insert or update on the
  new tables and views, and statuses change only through `transition_record()`.

**Application**
- **Board**: the Production, QC-2, FG pallets and FG storage tabs are live, with counts. Job Card and FG panels have
  responsibility strips (who acted at each step, or which role queue it waits on).
- **Record views**:
  - Job Card: stepper; inputs and packaging; G5/QC-2 results with the checklist source; finished pallets; history.
  - FG pallet: composition by lot; QC stamp and validity; moves; history.
  - Both show every action with its permission basis, or why it is unavailable.
- **Forms**: Job Card, issue (from the Job Card or from the pallet), packaging, line start, confirm, correction, pause/resume,
  QC-2, FG pallet, FG label, QC stamp, FG move, completion.
- Notifications link to their record. Arabic and English throughout. There are new demo people: Production Engineer, Line
  Leader and Store Keeper.

**Demo farm** (`supabase/seed/demo_packing_house_production.sql`, after the receiving demo; demo farm only, labelled)
- Lines approved by the demo manager; F1 assigned to tomato & cherry.
- Three Job Cards:
  - one running, after an online QC-2 fail, a re-sort and a final pass, with two FG pallets (one labelled, stamped and stored
    in F1; one waiting for the QC stamp);
  - one planned, with a released regular-tomato pallet ready to issue;
  - one draft awaiting approval.
- Box counts, weights and packaging items are invented for the demo (VR-PH-E12).

## Tests (actual results, 2026-10-21)

| Suite | Result |
|---|---|
| `npm run db:test` (Postgres 16, all migrations, pgTAP) | 16 files, **626 tests pass**: 152 new in `16_ph_production.sql`; 1 M1 assertion updated because issuing is now built |
| `npm run lint` · `npm run typecheck` | pass |
| Vitest | 13 files, **74 tests pass** (5 new: status and action labels match the migration, every reason key has a sentence, V-09 field names) |
| `npm run build` | pass |
| `npm run test:e2e` (shell, phone + desktop) | 6 pass |
| `npm run test:e2e:stack` (real PostgREST + Auth + Postgres 16) | **19 pass**, including the new API test: direct writes refused, plan → partial issue → two-person G5 → G6 gate → FG pallet → F1 → completion → trace |
| In-browser demo e2e (iPhone size, artifact-like CSP with WebAssembly) | **5 pass**, including the new UI flow: six roles from plan to an FG pallet in F1, failed and corrected line start, completion, trace, reload, and no sideways scroll at phone width |

Fixed during testing:
- Inspections recorded in one transaction had the same time, so "latest QC-2" was ambiguous. They now use the clock time, with the
  record code as a tiebreak.
- On a phone, the completion table made the actions column wider than the screen. It is now a stacked list.
- A late "done" could close the next form a user had already opened. A form now closes only itself.

## Not built yet (next increments)

- **Waste and reconciliation (M2.2)**: the waste workflow (G7, V-16, V-17 sign-off routing, SoD-03), the Job Card mass balance
  MB-01 with its tolerance (OD-28) and the Reconciled / Closed / Reopen steps. The end-to-end flow requested (… → storage →
  waste reconciliation) therefore stops at storage and Job Card completion in M2.1.
- **Orders and plan (M2.3)**: order lines, the daily plan (ST-00, OD-37), order-pallet references (rest of V-10), split/merge (V-22,
  T-11) and FG holds.
- Dispatch (M3): FIFO, load, 24 h validity at load (V-11), age rules (V-12).

## Blocked or pending decisions (real farm)

| Item | Effect now |
|---|---|
| OD-15 | Job Card create, approve, close and reopen cells are proposals: refused on a real farm until the owner approves them |
| OD-05, OD-06 | No grading standard or customer tolerance: QC-2 records a judgement flagged "no tolerance set" |
| OD-13 | Traceability team identity: issuing by TRC/DEC and FG creation by TRC/DEC stay NYV |
| OD-20, OD-24 | No barcode on labels; printer model unknown |
| OD-28 | Mass-balance tolerance: reconciliation not built |
| OD-29 | Weight plausibility not checked on finished pallets |
| OD-30 | Blocky crop identity (the Blocky Capsicum SOP is evidence, not a decision): Blocky Job Cards refused |
| OD-01, 02, 03, 17 (critical) | Still gate receiving on a real farm, so no released pallets exist to issue there |
| SOP approval | The SOPs are draft 001 with no effective date; checklists cite them as such |
