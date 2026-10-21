# Open decisions OD-01 … OD-17: review for closing milestone M2

Date: 2026-10-21 · Reviewer: Claude (development assistant), for the owner's decision. This is **not** a decision record.

## How to read this review

**Sources and their standing**

| Source | Standing |
|---|---|
| PH-OAS-SPEC-001 v0.1 | "Draft 0.1 — Not for build"; built on the owner's instruction of 2026-10-19 (VR-PH-S01). The OD table (§10) gives the question, the options, the spec's recommendation and the owners. |
| Product SOPs: Cherry Tomato, Tomato, Blocky Capsicum Color, Sweet Bite Pepper, Melon, Watermelon | **Draft version 001, effective date blank** (VR-PH-E08). Evidence only, not approved rules. |
| QC Function charter | Draft. Evidence only. |
| SOP-RC, SOP-PC, SOP-WS, SOP-FC and the other spec SOP codes | As quoted inside the spec (C items). The SOP documents themselves were not supplied. |

**Status words**

| Status | Meaning |
|---|---|
| Approved | The listed owners signed the option in the app (`ph_decision_approvals`). **No OD is approved.** |
| Proposed | The spec recommends an option and the app is built to it, but nobody has approved it. |
| Awaiting confirmation | Evidence exists (spec text or draft SOP) but conflicts with, or does not settle, the question. A named owner must confirm. |
| Blocked | No usable evidence; the dependent steps stay refused on a real farm. |

**Demo farm.** The demo farm runs labelled *demo assumptions* for OD-01 (B), OD-02 (C), OD-03 (A), OD-17 (A), OD-38 (DEC) and, from
this increment, OD-11 (A, with QCM and QAM as signatories). A database trigger refuses demo assumptions on any farm that is not a
demo farm. On a real farm every OD below is open, and each step that depends on one is refused with the OD code (pgTAP 14–18).

**Approvers.** "Required approver" is the owner group the spec names for each OD. Where the spec names a function that has no
role in the system (Farm Operations, IT), this is said. Nothing here assigns authority; it records what the spec says.

## Summary

| OD | Question (short) | Spec recommendation | Built as | Status | Required approver (spec) |
|---|---|---|---|---|---|
| OD-01 | Point of system entry, rejected pallets, dispatch note | B | B, gated | Proposed | PHM + WHM + QAM; Farm Operations for CP-02 |
| OD-02 | Lot definition and point | C | C, gated | Proposed | QAM + PHM |
| OD-03 | Which system issues pallet IDs, lots, labels | Decide after Phase 0 identification | A, gated | Blocked | PHM + WHM + IT |
| OD-04 | ERP boundary | A now | A (references typed; no interface) | Proposed | WHM + FIN + IT |
| OD-05 | Raw-material tolerance schedule per crop | Supply the controlled document | No tolerance; RMA flagged | Blocked | QAM |
| OD-06 | Product / customer specifications | A (Sales maintains, QCM approves) | Free-text reference; no master | Proposed | SAL + QCM |
| OD-07 | Pre-cooling dwell by temperature | Rule table, else 30 min max | 30 min max; all pallets pre-cool | Awaiting confirmation | QAM + PHM |
| OD-08 | Temperature limits and alarms | QA to set; spec invents none | Storage ranges shown; no alarms | Awaiting confirmation | QAM |
| OD-09 | Start of the 48 h clock | C if both rules intended; confirm | Harvest-based age shown; no early alert | Awaiting confirmation | PHM + SAL |
| OD-10 | Loading regraded product beyond 72 h | Owner decision; block until decided | Not built (M3) | Blocked | PHM + QAM |
| OD-11 | Basis of the 1 t waste threshold, QA/QC signing level, e-signature | A (per report per shift; e-signature) | Routing gated; A as demo assumption | Proposed | PHM + FIN + WHM + QAM + QCM |
| OD-12 | Which engineer regrades | None | Works for whoever holds ENG | Awaiting confirmation | PHM + Farm Operations |
| OD-13 | Traceability team; who records JC inputs and FG pallets | None | LL issues, PHO creates FG (P cells); TRC/DEC pending | Awaiting confirmation | PHM + WHM |
| OD-14 | Custody of fridge stock moves | None | PHO / DEC move (P); STK pending | Awaiting confirmation | PHM + WHM |
| OD-15 | Job Card creator / approver, granularity, reopen window | A (PE creates, PHM approves; 1 JC per line × product × shift) | PE/PHM via P cells; granularity not enforced; reopen refused | Proposed | PHM |
| OD-16 | Emergency override, escalation times | A (§6.5 list) | Not built (M4) | Blocked | PHM + QCM + QAM + Top management |
| OD-17 | Scope of QC-1 vs arrival check and QA acceptance | None | A (separate QC-1 gate), gated | Awaiting confirmation | QCM + PHM |

Critical ODs (OD-01, 02, 03, 05) are all unresolved, so **the packing house is not ready for a real farm**.

## Per decision

### OD-01 — Point of system entry; registration of rejected pallets; farm dispatch note (critical)
- **Documented facts:** spec options A (register after QA acceptance, the current SOP-RC practice) and B (register every pallet at the
  scale with status, CP-01, plus the farm dispatch note, CP-02). Spec recommendation: "B — it is the only option that closes MB-03"
  (SOP-RC; SUM-3 #6).
- **Current implementation:** receiving registers every pallet at the scale (B). On a real farm registration is refused until OD-01
  is decided (gate `OD-01`). The farm dispatch weight (CP-02) is not captured, so the arrival balance (MB-03) starts at the scale and
  says so.
- **Recommended rule:** B, as the spec recommends: without it rejected product never enters the records and MB-03 cannot close.
- **Missing evidence:** the farm dispatch note format and who keys it; whether rejected pallets are weighed today.
- **Required approver:** PHM + WHM + QAM; Farm Operations for CP-02 (no Farm Operations role exists in the system; the PHM-side
  approval can be recorded, CP-02 needs the farm's confirmation).
- **Impact:** blocks all receiving on a real farm, and therefore every later step there.
- **Status:** Proposed.

### OD-02 — Lot definition and assignment point (critical)
- **Documented facts:** options A (lot at QA acceptance), B (per Job Card), C (both: raw lot on labels, Job Card as batch). Spec
  recommendation C (SOP-RC; SOP-PF; SUM-3 #8).
- **Current implementation:** C. The raw lot `L-<crop>-<YYMMDD>-<source>` is created at QA acceptance only when OD-02 is C; otherwise
  pallets show "Lot: pending OD-02". The Job Card is the production batch; finished pallets carry lot composition proportional to the
  kg issued (VR-PH-C16).
- **Recommended rule:** C, as recommended: it keeps the raw lot on the label for complaints while the Job Card links production.
- **Missing evidence:** the lot code format the company wants (the built format is a working assumption, VR-PH-C09).
- **Required approver:** QAM + PHM.
- **Impact:** labels (V-09), traces and the lot balance (MB-02).
- **Status:** Proposed.

### OD-03 — Which system issues pallet IDs, lot numbers and labels (critical)
- **Documented facts:** options A (new system issues IDs) and B (existing system issues IDs; the new one reads them). The spec makes
  **no** recommendation: "Decide after identification in Phase 0". The existing "pack house system" has not been identified.
- **Current implementation:** A, behind the gate: on a real farm numbering and receiving labels are refused until OD-03 is decided.
- **Recommended rule:** none can be given until the existing system is identified. If no other system issues these IDs, A follows.
- **Missing evidence:** the identity, owner and data of the current pack-house system (Phase 0).
- **Required approver:** PHM + WHM + IT (no IT role exists; ADM holds the system-admin approval slot in the app).
- **Impact:** blocks pallet numbers and labels on a real farm.
- **Status:** Blocked.

### OD-04 — ERP boundary and integration
- **Documented facts:** options A (no interface; ERP references captured), B (file export), C (API). Spec: "A now; reassess with
  measured keying time" (SOP-WS; SOP-PL; SOP-ST). No ERP API, file format or access was supplied.
- **Current implementation:** no integration exists. The waste record takes a typed ERP reference after sign-off; a reference already
  used on another waste record is a warning, not a block, because the ERP format is unknown.
- **Recommended rule:** A, as recommended. No integration should be built before the ERP, its owner and its interface are confirmed.
- **Missing evidence:** ERP product, reference format, who posts waste and packaging there.
- **Required approver:** WHM + FIN + IT.
- **Impact:** low now (references are typed); duplicate keying remains.
- **Status:** Proposed.

### OD-05 — Raw-material grading schedule (tolerances) per crop (critical)
- **Documented facts:** the spec needs a controlled tolerance schedule to configure G3 and recommends supplying it. None was supplied.
  The draft product SOPs give qualitative accept / conditional / reject criteria, critical defects and some figures (for example Brix
  bands for melon and watermelon, colour coverage for Sweet Bite pepper). They are **draft 001, not approved**, and are not a
  tolerance schedule.
- **Current implementation:** QA acceptance (RMA) records a judgement flagged `no_tolerance_set` and lists it for QAM review (exception
  OD-05). No figure from the draft SOPs is used as a limit.
- **Recommended rule:** the QAM supplies the controlled schedule (option A). The draft SOP figures may be a starting point for that
  document, but only the QAM can approve them.
- **Missing evidence:** the approved schedule per crop.
- **Required approver:** QAM.
- **Impact:** G3 cannot accept against limits; every acceptance is a flagged judgement.
- **Status:** Blocked.

### OD-06 — Product / customer specifications: owner, format, approval
- **Documented facts:** one option, "Sales maintains, QCM approves (proposed)"; recommendation "As proposed".
- **Current implementation:** order lines and Job Cards take a free-text customer specification reference; there is no customer or
  specification master (FR-MD-04). QC-2 without a specification is recorded as "no tolerance set" (exception OD-06).
- **Recommended rule:** as proposed, once a specification document exists to approve.
- **Missing evidence:** any customer specification; the format.
- **Required approver:** SAL + QCM.
- **Impact:** QC-2 and grades are judgements; customer-specific checks cannot run.
- **Status:** Proposed.

### OD-07 — Pre-cooling dwell rule by receiving temperature
- **Documented facts:** spec options A (temperature band → minutes) and B (single 30 min maximum); recommendation "rule table if QA can
  define it; else 30 min max". SOP-PC's 30-minute maximum is documented. **New evidence:** the draft Sweet Bite Pepper and Cherry Tomato
  SOPs say pre-cooling is required only when the harvest temperature at receiving is **above 25 °C**, and is skipped at 25 °C or
  below.
- **Current implementation:** every pallet that passes the arrival check goes through pre-cooling; the 30-minute maximum raises E-05.
- **Recommended rule:** B (30 min maximum) until QA defines bands. The 25 °C exemption **conflicts** with the built flow (every pallet
  pre-cools) and must be confirmed by QAM and PHM before it changes the workflow.
- **Missing evidence:** QA's band table, if any; confirmation of the 25 °C exemption and for which crops.
- **Required approver:** QAM + PHM.
- **Impact:** dwell alerts; a confirmed exemption would add a skip transition at G2.
- **Status:** Awaiting confirmation.

### OD-08 — Temperature limits, alarm tolerances, dispatch requirements
- **Documented facts:** spec: "QA to set; this specification invents none". SOP-PC storage ranges (tomato 10–12 °C). The draft product
  SOPs state Sweet Bite Pepper 7–10 °C, Watermelon 10–15 °C, Melon 2–5 °C, Blocky Capsicum 7–10 °C, tomato and cherry tomato 10–12 °C
  with 90–95 % RH (VR-PH-E02).
- **Current implementation:** crop storage ranges are shown as documented values; no alarm, no tolerance and no dispatch block exists
  (M3).
- **Recommended rule:** adopt the SOP ranges once QA confirms them and sets alarm tolerances (option A).
- **Missing evidence:** alarm tolerances; vehicle and product temperatures at dispatch; approval of the draft SOP ranges.
- **Required approver:** QAM.
- **Impact:** M3 (alerts, dispatch blocks).
- **Status:** Awaiting confirmation.

### OD-09 — Start of the 48 h clock
- **Documented facts:** options A (from harvest, SOP-PC), B (from order receipt, the manager's note), C (both as separate limits);
  recommendation "C if both rules are intended; confirm". **New evidence:** the draft Melon, Blocky Capsicum and Sweet Bite Pepper SOPs
  add a third clock: re-inspection is mandatory when a lot stays **in storage more than 48 hours**.
- **Current implementation:** pallet age from harvest is shown; no early alert is computed; the storage re-inspection is not built.
  The three clocks are not treated as interchangeable.
- **Recommended rule:** keep three separate limits only if the owner confirms each one is intended; none replaces another.
- **Missing evidence:** which clocks the company intends, and the alert lead time.
- **Required approver:** PHM + SAL (and QAM for the storage re-inspection, which is a QC rule).
- **Impact:** V-12, K5, M3 dispatch.
- **Status:** Awaiting confirmation.

### OD-10 — Loading regraded product beyond 72 h after harvest
- **Documented facts:** SOP-PC forbids > 72 h but also describes regrading after long storage; options A (never) and B (allowed after
  regrade with QA approval); "owner decision; system blocks until decided".
- **Current implementation:** not built (age blocking and dispatch are M3).
- **Recommended rule:** none; this is the owner's decision.
- **Missing evidence:** the owner's decision.
- **Required approver:** PHM + QAM.
- **Impact:** M3.
- **Status:** Blocked.

### OD-11 — Waste thresholds and signatories
- **Documented facts (SOP-WS, C):** waste is labelled by QC before weighing (V-16); up to 1 t the PHM signs; above 1 t the PHM,
  warehouse, finance and "QA and QC team" sign; long-storage waste above 1 t needs top management first. Open: the basis of the 1 t
  (per report, shift, day or event), the QA/QC signing level, and whether an electronic sign-off replaces wet signatures. One option,
  A "per waste report per shift (proposed)"; recommendation "per report per shift; e-signature accepted".
- **Current implementation:** the waste workflow is built (M2.2). Routing is refused while OD-11 is open (`ph.blocked.open`, exception
  OD-11 lists weighed waste waiting). Each record is routed on its own weight (VR-PH-C21); exactly 1 000 kg is "small". QCM and QAM
  sign-off cells stay pending until the decision activates them. On the demo farm, A is a labelled demo assumption with QCM and QAM
  activated.
- **Recommended rule:** A, as recommended, with the signing level named per role.
- **Missing evidence:** whether a record equals a shift report; the QA/QC level; e-signature acceptance.
- **Required approver:** PHM + FIN + WHM + QAM + QCM.
- **Impact:** waste cannot be signed off on a real farm; Job Card reconciliation still works (weighed waste counts).
- **Status:** Proposed.

### OD-12 — Which engineer regrades rejected incoming product
- **Documented facts:** options A (farm engineer), B (Production Engineer), C (other); no recommendation (SOP-RC).
- **Current implementation:** regrade works for whoever holds the ENG role; the regrader cannot also re-weigh (SoD-02).
- **Recommended rule:** none from the sources. Whoever is chosen is given the ENG role; no code change is needed.
- **Missing evidence:** the department and person.
- **Required approver:** PHM + Farm Operations (requiring management confirmation on the Farm Operations side).
- **Impact:** who receives regrade tasks.
- **Status:** Awaiting confirmation.

### OD-13 — Traceability team; who records Job Card inputs and finished pallets
- **Documented facts:** options A (data-entry clerks), B (PH staff), C (dedicated team); no recommendation (SOP-PC; SOP-ST).
- **Current implementation:** the Line Leader issues inputs and the PH operator creates finished pallets through proposed (P) cells;
  TRC/DEC cells stay pending.
- **Recommended rule:** none from the sources; record the choice, and the matching cells are activated by the decision.
- **Missing evidence:** the team's identity.
- **Required approver:** PHM + WHM.
- **Impact:** on a real farm, input issue and finished pallets need the approved cells.
- **Status:** Awaiting confirmation.

### OD-14 — Custody of fridge stock moves
- **Documented facts:** options A (PH operators), B (store keeper), C (data entry); no recommendation (SOP-PL; SOP-PC).
- **Current implementation:** PHO and DEC move pallets (P cells); the store keeper's cell is pending.
- **Recommended rule:** none from the sources.
- **Missing evidence:** the custody rule.
- **Required approver:** PHM + WHM.
- **Impact:** accountability of storage moves.
- **Status:** Awaiting confirmation.

### OD-15 — Job Card creator, approver, granularity, reopen window
- **Documented facts:** one option, A "PE creates, PHM approves; one JC per line per product per shift"; recommendation "As proposed"
  (CP-04, a proposal).
- **Current implementation:** PE creates, PHM approves and closes through P cells (refused on a real farm until approved). The
  granularity is **not enforced**. Reopening a closed Job Card is refused with OD-15 (no window).
- **Recommended rule:** A as proposed, with the reopen window stated.
- **Missing evidence:** the reopen window; confirmation of the granularity.
- **Required approver:** PHM.
- **Impact:** all of production on a real farm.
- **Status:** Proposed.

### OD-16 — Emergency override authority and escalation times
- **Documented facts:** one option, the §6.5 list (a proposal); recommendation "approve list in Section 6.5".
- **Current implementation:** no override exists anywhere; nothing can bypass a rule (M4).
- **Recommended rule:** none until the owners approve which rules can never be overridden, who may override the others, for how long
  and how it is reviewed.
- **Missing evidence:** the approved list.
- **Required approver:** PHM + QCM + QAM + Top management.
- **Impact:** none now (nothing is overridable).
- **Status:** Blocked.

### OD-17 — Scope of QC-1 versus arrival check and QA acceptance
- **Documented facts:** options A (separate QC-1 gate), B (merge with QA acceptance), C (QC-1 only on issue from storage after X h); no
  recommendation (SUM-3 #4). **New evidence:** the draft product SOPs give the receiving accept / reject decision to a "QC Inspector –
  Receiving" and the approval of rejections to a "Shift Supervisor – QC". The spec gives QA acceptance (RMA) to QAO. These differ.
- **Current implementation:** A (separate QC-1 gate), gated on a real farm.
- **Recommended rule:** none can be adopted until QCM and PHM reconcile the draft SOP roles with the spec: the difference changes who
  decides acceptance, which is a permission change.
- **Missing evidence:** the approved receiving roles.
- **Required approver:** QCM + PHM.
- **Impact:** QC-1 release on a real farm; possibly the RMA permission cells.
- **Status:** Awaiting confirmation.

## What it takes to close M2 for a real farm

1. Owners record OD-01, OD-02, OD-03 and OD-05 (critical) in the app; receiving then runs on a real farm.
2. The record-type owners approve the proposed cells M2 relies on (Job Cards, OD-15; split / merge; amend / cancel of order lines).
3. OD-11 recorded, so waste sign-off routes on a real farm.
4. The draft SOPs approved (or replaced) so that checklists and storage ranges stop being draft evidence.
5. A staging deployment rehearsal (VR-S01).
