# Traceability index — PH-OAS-SPEC-001 v0.1

Generated 2026-10-19 from the specification (read in full). Milestone plan: `docs/BUILD_ASSESSMENT.md` §3. Updated at the end of milestone M1 (receiving → QC-1). Migrations: `001000` engine/config, `001100` master data, `001200` receiving, `001300` read models, `001400` view grants. UI: `src/modules/packing-house/`.

Status: **Done** = data model, server rules, permissions, audit, UI and tests in place for the stated scope · **Partial** = see note · **Gated** = built but refused until the named open decision is recorded · **Planned** = not built yet (milestone shown) · **Blocked** = cannot be built without the decision or input named.
Tests: `pgtap:NN` = `supabase/tests/pgtap/NN_*.sql` · `e2e:name` = `tests/e2e/stack/name.spec.ts` · `unit:path` = Vitest.

## Functional requirements (90)

| ID | Function | Module | Milestone | Status | Implementation | Tests | Limitation / dependency |
|---|---|---|---|---|---|---|---|
| FR-MD-01 | Crop master | PH-MD | M1 | Done | ph_crops (versioned), ph_save_master / ph_approve_master; Master data page | pgtap:15 | SOP crop list loaded as Not Yet Verified until approved; Blocky crop gated by OD-30 |
| FR-MD-02 | Location master (capacity, storage group, occupancy) | PH-MD | M1 | Done | ph_locations + ph_location_occupancy; Location board | pgtap:15, e2e:packing-house | Capacities not in sources stay "Not Yet Verified" |
| FR-MD-03 | Quality parameter sets (versioned, maker-checker) | PH-MD | M1 | Partial | ph_storage_groups (QAM, maker-checker), inspection templates | pgtap:15 | No quality parameter values exist in the sources (VR E34); none invented |
| FR-MD-04 | Customers & customer specifications | PH-MD | M2 | Planned |  |  |  |
| FR-MD-05 | Sources (blocks/sections, suppliers) | PH-MD | M1 | Done | ph_sources (own-farm block/section or supplier), ph_varieties | pgtap:15, e2e:packing-house |  |
| FR-MD-06 | Equipment & calibration | PH-MD | M1 | Partial | ph_equipment.calibration_due_on; weights flagged; exception rule FR-MD-06 | pgtap:15 | Calibration dates unknown (VR-PH-E04) so every weight is flagged |
| FR-MD-07 | Rule parameters (effective-dated) | PH-CFG | M1 | Done | ph_rule_parameters (versioned, source, label); Rules page | pgtap:14 | Pending values shown as Not Yet Verified with their OD |
| FR-AC-01 | Named user accounts | PH-ACL | M1 | Done | Supabase Auth named accounts; ph_* roles per person | pgtap:14, e2e:packing-house | PIN switch on shared devices not built (gap shared with Phase 2) |
| FR-AC-02 | Permission enforcement (role x object x action) | PH-ACL | M1 | Done | ph_permission_cells + app.ph_authorize in every RPC; no direct table writes | pgtap:14 (T-20), pgtap:15 |  |
| FR-AC-03 | Segregation-of-duties enforcement | PH-ACL | M1 | Done | must_differ_from on transitions; SoD checks in RPCs | pgtap:14, pgtap:15 | SoD-01/02/05/06/07/09 in M1 |
| FR-AC-04 | Electronic signature (PIN) | PH-AU | M4 | Planned |  |  |  |
| FR-AC-05 | Access review | PH-ACL | M4 | Planned |  |  |  |
| FR-AC-06 | Fast user switching on shared devices | PH-ACL | M4 | Planned |  |  |  |
| FR-PL-01 | Record order lines | PH-PL | M2 | Planned |  |  |  |
| FR-PL-02 | Accept / reject order lines | PH-PL | M2 | Planned |  |  |  |
| FR-PL-03 | Daily plan view | PH-PL | M2 | Planned |  |  |  |
| FR-PL-04 | Shortage notification | PH-PL | M2 | Planned |  |  |  |
| FR-RC-01 | Create arrival | PH-RC | M1 | Done | ph_create_arrival; New arrival form | pgtap:15, e2e:packing-house |  |
| FR-RC-02 | Incoming vehicle inspection & exception | PH-RC | M1 | Done | ph_record_vehicle_inspection, ph_vehicle_exception_decide (PHM+QAM+TOP) | pgtap:15 (T-05), e2e:packing-house | Inspector role OD-38; SOP-TR checklist content missing (VR-PH-E01) |
| FR-RC-03 | Register incoming pallet | PH-RC | M1 | Gated | ph_register_pallet; Register pallet form | pgtap:15, e2e:packing-house | Refused on a real farm until OD-01 = B and OD-03 = A are recorded |
| FR-RC-04 | Arrival visual check | PH-RC | M1 | Done | ph_record_arrival_check (per-pallet result, destination, photos) | pgtap:15 (T-02) |  |
| FR-RC-05 | Pre-cooling tracking | PH-RC | M1 | Done | ph_precool_scan in/out, dwell vs 30 min (SOP) | pgtap:15 | Temperature-dependent dwell table pending OD-07 |
| FR-RC-06 | Void registration | PH-RC | M1 | Done | ph_request_void / ph_approve_void (different person) | pgtap:15 |  |
| FR-QG-01 | Raw-material acceptance (RMA) | PH-QG | M1 | Done | ph_submit_rma, ph_cosign_rma; lot assignment | pgtap:15 | No product tolerances (OD-05/OD-15): judgement recorded and flagged for QAM review; lot rule gated by OD-02 |
| FR-QG-02 | Rejection loop (regrade, re-weigh, recheck) | PH-QG | M1 | Done | ph_start_regrade, ph_complete_regrade, ph_reweigh, ph_recheck | pgtap:15 (T-03, T-04) | Regrade engineer identity OD-12 |
| FR-QG-03 | QC-1 release | PH-QG | M1 | Gated | ph_qc1_release | pgtap:15 | Refused on a real farm until OD-17 = A |
| FR-QG-04 | Line start check | PH-PR | M2 | Planned |  |  |  |
| FR-QG-05 | QC-2 online and final inspection | PH-FG | M2 | Planned |  |  |  |
| FR-QG-06 | Instruction routing to PHM/PE | PH-NT | M2 | Planned |  |  |  |
| FR-QG-07 | Inspection templates (versioned) | PH-QG | M1 | Done | ph_inspection_templates (versioned); records keep template_id | pgtap:15 |  |
| FR-ST-01 | Stock move by scan | PH-ST | M1 | Done | ph_move_pallet (scan or type); ph_stock_move_log | pgtap:15 |  |
| FR-ST-02 | FIFO suggestion | PH-DS | M3 | Planned |  |  |  |
| FR-ST-03 | Ageing monitor | PH-ST | M1 | Partial | grading_overdue (24 h) on board and exception board | pgtap:15 (T-06) | FG 48/72 h ageing is M3 |
| FR-ST-04 | Temperature readings | PH-ST | M3 | Planned |  |  |  |
| FR-ST-05 | Location board | PH-ST | M1 | Done | ph_location_occupancy; Location board | pgtap:15, e2e:packing-house |  |
| FR-ST-06 | Fridge group assignment | PH-ST | M1 | Done | ph_set_location_group (reason when occupied); Location board | pgtap:15 |  |
| FR-ST-07 | Customer crates & LSS boxes | PH-ST | M3 | Planned |  |  |  |
| FR-PR-01 | Create & approve Job Card | PH-PR | M2 | Planned |  |  |  |
| FR-PR-02 | Issue inputs | PH-PR | M2 | Planned |  |  |  |
| FR-PR-03 | Packaging issue reference | PH-PR | M2 | Planned |  |  |  |
| FR-PR-04 | Run control | PH-PR | M2 | Planned |  |  |  |
| FR-PR-05 | Record outputs | PH-PR | M2 | Planned |  |  |  |
| FR-PR-06 | Mass balance | PH-PR | M2 | Planned |  |  |  |
| FR-PR-07 | Rework Job Card | PH-PR | M2 | Planned |  |  |  |
| FR-PR-08 | Customer deviation | PH-PR | M2 | Planned |  |  |  |
| FR-FG-01 | Create FG pallet | PH-FG | M2 | Planned |  |  |  |
| FR-FG-02 | Print FG label | PH-FG | M2 | Planned |  |  |  |
| FR-FG-03 | QC validity | PH-FG | M2 | Planned |  |  |  |
| FR-FG-04 | Split pallet | PH-FG | M2 | Planned |  |  |  |
| FR-FG-05 | Merge pallets | PH-FG | M2 | Planned |  |  |  |
| FR-FG-06 | Relabel / void label | PH-FG | M2 | Planned |  |  |  |
| FR-WS-01 | Create waste record | PH-WS | M2 | Planned |  |  |  |
| FR-WS-02 | QC waste approval | PH-WS | M2 | Planned |  |  |  |
| FR-WS-03 | Sign-off routing | PH-WS | M2 | Planned |  |  |  |
| FR-WS-04 | ERP reference capture | PH-WS | M2 | Planned |  |  |  |
| FR-WS-05 | Weight-loss adjustment | PH-WS | M2 | Planned |  |  |  |
| FR-WS-06 | Packaging waste count | PH-WS | M2 | Planned |  |  |  |
| FR-DS-01 | Create load & allocate | PH-DS | M3 | Planned |  |  |  |
| FR-DS-02 | Load by scan | PH-DS | M3 | Planned |  |  |  |
| FR-DS-03 | Vehicle inspection | PH-DS | M3 | Planned |  |  |  |
| FR-DS-04 | Product temperature at dispatch | PH-DS | M3 | Planned |  |  |  |
| FR-DS-05 | Dispatch rejection & replacement | PH-DS | M3 | Planned |  |  |  |
| FR-DS-06 | Logger & seal | PH-DS | M3 | Planned |  |  |  |
| FR-DS-07 | Packing list | PH-DS | M3 | Planned |  |  |  |
| FR-DS-08 | Loading window | PH-DS | M3 | Planned |  |  |  |
| FR-DS-09 | Shelf-life samples | PH-DS | M3 | Planned |  |  |  |
| FR-DS-10 | Departure | PH-DS | M3 | Planned |  |  |  |
| FR-NC-01 | Raise hold | PH-NC | M1 | Done | ph_raise_hold (quality / food safety / operational) | pgtap:15 |  |
| FR-NC-02 | Disposition & release | PH-NC | M1 | Partial | ph_hold_step (assess, decide, execute, verify, close) | pgtap:15 | M1 dispositions: release and waste; regrade/rework/return M2, concession M4 |
| FR-NC-03 | CAPA | PH-NC | M4 | Planned |  |  |  |
| FR-NC-04 | Emergency override | PH-NC | M4 | Planned |  |  |  |
| FR-TR-01 | Complaint intake | PH-TR | M4 | Planned |  |  |  |
| FR-TR-02 | Backward trace | PH-TR | M1 | Partial | ph_backward_trace; Trace page | pgtap:15 | Reaches source, arrival, inspections, moves, holds; production/dispatch links M2–M3 |
| FR-TR-03 | Forward trace & recall scope | PH-TR | M4 | Planned |  |  |  |
| FR-TR-04 | Mock recall mode | PH-TR | M4 | Planned |  |  |  |
| FR-TR-05 | Investigation & response | PH-TR | M4 | Planned |  |  |  |
| FR-RP-01 | Daily stock report | PH-RP | M4 | Planned |  |  |  |
| FR-RP-02 | Exception board | PH-RP | M1 | Done | ph_exception_items; Exception board | pgtap:15 | M1 rules only |
| FR-RP-03 | KPI reports | PH-RP | M4 | Planned |  |  |  |
| FR-RP-04 | Export | PH-RP | M4 | Planned |  |  |  |
| FR-AU-01 | Audit capture | PH-AU | M1 | Done | register_table audit trigger + record_transitions | pgtap:15 |  |
| FR-AU-02 | Audit viewer | PH-AU | M1 | Partial | ph_record_history per record; existing Audit Log page | pgtap:15 | No packing-house-specific audit search screen |
| FR-AU-03 | Corrections | PH-AU | M4 | Planned |  |  |  |
| FR-AU-04 | Downtime back-entry | PH-AU | M4 | Planned |  |  |  |
| FR-NT-01 | Tasks & notifications | PH-NT | M1 | Partial | app.ph_notify_role → notifications (13 kinds) | pgtap:15 | In-app only; escalation timers M4 |
| FR-NT-02 | E-mail notifications | PH-NT | M4 | Planned |  |  |  |
| FR-NT-03 | Escalation timers | PH-NT | M4 | Planned |  |  |  |
| FR-IN-01 | External references | PH-IN | M2 | Planned |  |  |  |
| FR-IN-02 | ERP-ready summaries | PH-IN | M2 | Planned |  |  |  |
| FR-IN-03 | Import templates | PH-IN | M4 | Planned |  |  |  |

## State models, gates, validations, SoD, audit, genealogy, controls

| ID | Rule | Module | Milestone | Status | Implementation | Tests | Limitation / dependency |
|---|---|---|---|---|---|---|---|
| SM-IP | Incoming Pallet state model | PH-RC/QG | M1 | Done | workflow ph_incoming_pallet (16 statuses) via transition_record | pgtap:15 | Issued/consumed transitions belong to M2 |
| SM-JC | Job Card state model | PH-PR | M2 | Planned |  |  |  |
| SM-FGP | Finished-goods pallet state model | PH-FG | M2 | Planned |  |  |  |
| SM-WR | Waste record state model | PH-WS | M2 | Planned |  |  |  |
| SM-NC | Hold / nonconformity state model | PH-NC | M1 | Done | workflow ph_hold | pgtap:15 |  |
| SM-LD | Dispatch load state model | PH-DS | M3 | Planned |  |  |  |
| SM-CMP | Customer complaint state model | PH-TR | M4 | Planned |  |  |  |
| G1 | Arrival gate | PH-RC | M1 | Done | guard ph_arrival submit | pgtap:15, e2e:packing-house |  |
| G2 | Arrival visual check | PH-RC | M1 | Done | arrival check result per pallet | pgtap:15 |  |
| G3 | QA raw-material acceptance | PH-QG | M1 | Done | RMA accept/reject; G2 must pass first | pgtap:15 |  |
| G4 | QC-1 release | PH-QG | M1 | Gated | QC-1 release | pgtap:15 | OD-17 |
| G5 | Line start check | PH-PR | M2 | Planned |  |  |  |
| G6 | QC-2 online & final | PH-FG | M2 | Planned |  |  |  |
| G7 | Waste QC approval | PH-WS | M2 | Planned |  |  |  |
| G8 | Dispatch release | PH-DS | M3 | Planned |  |  |  |
| G9 | Hold release | PH-NC | M1 | Done | hold release returns to the prior state (held_from_status) | pgtap:15 | Spec SM-IP shows OnHold→Stored only (VR-PH-C03) |
| V-01 | Harvest-tag fields mandatory | PH-RC | M1 | Done | ph_create_arrival | pgtap:15, unit:packingHouse |  |
| V-02 | Net weight > 0 with scale ID | PH-RC | M1 | Done | ph_register_pallet | pgtap:15 |  |
| V-03 | Receipt after 17:00 flagged with reason | PH-RC | M1 | Done | last_harvest_receipt_time 17:00 (SOP) | pgtap:15 |  |
| V-04 | Pre-cooling dwell alert | PH-RC | M1 | Done | precool_max_dwell_minutes 30 (SOP); E-05 | pgtap:15 | OD-07 table pending |
| V-05 | Issue to JC only if Released and not held | PH-PR | M2 | Planned |  |  |  |
| V-06 | Grading overdue 24 h from receiving | PH-ST | M1 | Done | grading_limit_hours 24 (SOP); E-06 | pgtap:15 (T-06) |  |
| V-07 | Storage-group match or PHM override | PH-ST | M1 | Done | ph_move_pallet; PHM override with reason | pgtap:15 (T-07) |  |
| V-08 | Location capacity warning | PH-ST | M1 | Done | capacity warning (non-blocking) | pgtap:15 |  |
| V-09 | FG label mandatory fields | PH-FG | M2 | Planned |  |  |  |
| V-10 | Customer pallet needs accepted order line | PH-FG | M2 | Planned |  |  |  |
| V-11 | QC approval 24 h validity at load | PH-DS | M3 | Planned |  |  |  |
| V-12 | Age > 48 h reason / > 72 h block | PH-DS | M3 | Planned |  |  |  |
| V-13 | Seal (and logger) before departure | PH-DS | M3 | Planned |  |  |  |
| V-14 | Vehicle temperature blocks loading | PH-DS | M3 | Planned |  |  |  |
| V-15 | Loading window 01:00-09:00 needs override | PH-DS | M3 | Planned |  |  |  |
| V-16 | Waste weight only after QC approval | PH-WS | M2 | Planned |  |  |  |
| V-17 | Waste sign-off routing | PH-WS | M2 | Planned |  |  |  |
| V-18 | Complaint fields and timers | PH-TR | M4 | Planned |  |  |  |
| V-19 | IDs unique, never reused | ALL | M1 | Done | app.ph_next per farm and day; unique codes | pgtap:15 |  |
| V-20 | Mass-balance variance blocks Reconciled | PH-PR | M2 | Planned |  |  |  |
| V-21 | Weight plausibility (non-blocking) | PH-RC | M1 | Gated | plausibility check | pgtap:15 | Not checked until OD-29 sets a tolerance; shown as such |
| V-22 | Merge compatibility | PH-FG | M2 | Planned |  |  |  |
| V-23 | Photos mandatory on RMA and dispatch QC | PH-QG | M1 | Partial | RMA rejection needs ≥1 photo | pgtap:15 | Dispatch QC photos M3 |
| V-24 | Shelf-life sample or waiver before departure | PH-DS | M3 | Planned |  |  |  |
| V-25 | Fridge temperature overdue / out of range | PH-ST | M3 | Planned |  |  |  |
| V-26 | At most one recheck after regrade | PH-QG | M1 | Done | one recheck after regrade; second rejection → E-04 | pgtap:15 (T-04) |  |
| V-27 | Server event time; late-entry flag | PH-AU | M1 | Partial | server_received_at on every record | pgtap:15 | Late-entry threshold pending OD-16 |
| V-28 | No physical deletion | ALL | M1 | Done | no-delete trigger; void with reason | pgtap:15 |  |
| V-29 | Non-FIFO pick needs reason | PH-DS | M3 | Planned |  |  |  |
| V-30 | QC/QA instruction routed to PHM/PE | PH-NT | M2 | Planned |  |  |  |
| SoD-01 | Registrar cannot record QA acceptance | PH-ACL | M1 | Done | registrar ≠ QA acceptance | pgtap:15 |  |
| SoD-02 | Regrade and recheck by different people | PH-ACL | M1 | Done | regrade ≠ recheck | pgtap:15 |  |
| SoD-03 | Waste maker != QC label != sign-off | PH-ACL | M2 | Planned |  |  |  |
| SoD-04 | Dispatch release only by QC | PH-ACL | M3 | Planned |  |  |  |
| SoD-05 | Quality hold released only by QCM/QAM | PH-ACL | M1 | Done | quality hold closed only by QCM/QAM; food safety by QAM | pgtap:15 |  |
| SoD-06 | Admin performs no operational transactions | PH-ACL | M1 | Done | ADM holds no operational cells | pgtap:14 |  |
| SoD-07 | Quality parameters maker-checker | PH-ACL | M1 | Done | maker ≠ checker on master data, decisions and P-cell approvals | pgtap:14, pgtap:15 |  |
| SoD-08 | Override not reviewed by invoker | PH-ACL | M4 | Planned |  |  |  |
| SoD-09 | No self-edit after approval | PH-ACL | M1 | Done | approved crop edit creates a new version; approved records not editable by API | pgtap:15 |  |
| SoD-10 | Dual-role conflict flag | PH-ACL | M4 | Planned |  |  |  |
| AT-01 | Every action logged with before/after | PH-AU | M1 | Done | audit_events before/after per change | pgtap:15 |  |
| AT-02 | Audit append-only | PH-AU | M1 | Done | append-only audit, moves, approvals, attachments | pgtap:15 |  |
| AT-03 | E-signature meaning stored | PH-AU | M4 | Planned |  |  |  |
| AT-04 | Event time and entry time; late flag | PH-AU | M1 | Partial | event and entry time recorded | pgtap:15 | Late-entry flag waits on OD-16 |
| AT-05 | Attachments hashed, superseded not replaced | PH-ATT | M1 | Done | SHA-256, size, uploader; no replacement | pgtap:15 |  |
| AT-06 | Effective-dated master data versions on quality records | PH-MD | M1 | Done | records keep crop version and template version | pgtap:15 |  |
| AT-07 | Label prints logged with content | PH-RC | M1 | Done | label prints logged with content and reprint reason | pgtap:15 | Barcode format OD-20 |
| AT-08 | Retention per OD-21 | PH-AU | M4 | Planned |  |  |  |
| AT-09 | Audit viewer searchable | PH-AU | M1 | Partial | existing Audit Log page filters by entity type | - | No full-text search |
| AT-10 | Admin actions logged and reported | PH-AU | M4 | Planned |  |  |  |
| GEN-01 | Arrival contains 1..n IPs | PH-RC | M1 | Done | ph_incoming_pallets.arrival_id | pgtap:15 |  |
| GEN-02 | IP carries one source and harvest date | PH-RC | M1 | Done | source and harvest date per pallet | pgtap:15 |  |
| GEN-03 | IP belongs to one lot (OD-02) | PH-QG | M1 | Gated | ph_assign_lot | pgtap:15 | OD-02 |
| GEN-04 | JC consumes IPs, partial issue | PH-PR | M2 | Planned |  |  |  |
| GEN-05 | JC produces FG pallets with composition | PH-PR | M2 | Planned |  |  |  |
| GEN-06 | Lot attribution method recorded | PH-PR | M2 | Planned |  |  |  |
| GEN-07 | Split | PH-FG | M2 | Planned |  |  |  |
| GEN-08 | Merge | PH-FG | M2 | Planned |  |  |  |
| GEN-09 | Rework inherits lots and harvest dates | PH-PR | M2 | Planned |  |  |  |
| GEN-10 | Load contains FG pallets | PH-DS | M3 | Planned |  |  |  |
| GEN-11 | Holds/QC records link to IDs | PH-NC | M1 | Done | holds and inspections link to pallet ids | pgtap:15 |  |
| GEN-12 | No ID reused or deleted; void keeps ID | ALL | M1 | Done | void keeps the id | pgtap:15 |  |
| TQ-01 | Backward trace | PH-TR | M1 (to arrival) | Planned |  |  |  |
| TQ-02 | Forward trace | PH-TR | M4 | Planned |  |  |  |
| TQ-03 | Recall scope | PH-TR | M4 | Planned |  |  |  |
| TQ-04 | Mass balance query | PH-PR | M2 | Planned |  |  |  |
| MB-01 | Job Card balance | PH-PR | M2 | Planned |  |  |  |
| MB-02 | Lot balance | PH-PR | M2 | Planned |  |  |  |
| MB-03 | Daily receiving balance (needs CP-01/CP-02) | PH-RC | M1 (data) / OD-01 | Blocked | — |  | Needs CP-01/CP-02 farm dispatch data (OD-01); dispatch note captured when given |
| MB-04 | Weight loss | PH-WS | M2 | Planned |  |  |  |
| X-01 | Hold & nonconformity | PH-NC | M1 | Done | holds (SM-NC) | pgtap:15 |  |
| X-02 | CAPA | PH-NC | M4 | Planned |  |  |  |
| X-03 | Customer deviation / concession | PH-PR | M2 | Planned |  |  |  |
| X-04 | Shelf-life samples | PH-DS | M3 | Planned |  |  |  |
| X-05 | Customer crates & LSS boxes | PH-ST | M3 | Planned |  |  |  |
| X-06 | Emergency override | PH-NC | M4 | Planned |  |  |  |
| X-07 | Temperature records | PH-ST | M3 | Planned |  |  |  |

## Acceptance scenarios (Section 12.2)

| ID | Scenario | Milestone | Status | Tests | Note |
|---|---|---|---|---|---|
| T-01 | End-to-end happy path | M3 | Planned |  |  |
| T-02 | Arrival rejection | M1 | Done | pgtap:15 |  |
| T-03 | QA reject -> regrade -> accept | M1 | Done | pgtap:15 |  |
| T-04 | QA reject -> regrade -> reject | M1 | Done | pgtap:15 |  |
| T-05 | Non-compliant incoming vehicle | M1 | Done | pgtap:15 |  |
| T-06 | Grading overdue | M1 | Done | pgtap:15 |  |
| T-07 | Storage-group conflict | M1 | Done | pgtap:15 |  |
| T-08 | Partial issue | M2 | Planned |  |  |
| T-09 | Line start fail | M2 | Planned |  |  |
| T-10 | QC-2 fail | M2 | Planned |  |  |
| T-11 | Split & merge | M2 | Planned |  |  |
| T-12 | Dispatch re-inspection & rejection | M3 | Planned |  |  |
| T-13 | Vehicle temperature | M3 | Planned |  |  |
| T-14 | Non-lockable vehicle | M3 | Planned |  |  |
| T-15 | 72 h age | M3 | Planned |  |  |
| T-16 | Waste thresholds | M2 | Planned |  |  |
| T-17 | Valid complaint & recall scope | M4 | Planned |  |  |
| T-18 | Late complaint | M4 | Planned |  |  |
| T-19 | Override | M4 | Planned |  |  |
| T-20 | Permission matrix (every role x non-granted action) | M1 (implemented objects) | Done | pgtap:14 | Generated from ph_permission_cells: every role × every M1 action, both proposal modes |
| T-21 | Downtime back-entry | M4 | Planned |  |  |
| T-22 | Mock recall | M3 | Planned |  |  |

## Non-functional requirements

| ID | Requirement | Decision | Status | Note |
|---|---|---|---|---|
| NFR-01 | Availability during operating hours | OD-25 | Planned |  |
| NFR-02 | Scan-to-confirmation <= 2 s | OD-24 | Planned |  |
| NFR-03 | Rugged devices and desktop browsers | OD-24 | Planned |  |
| NFR-04 | Connectivity resilience (queued actions) | OD-24 | Planned |  |
| NFR-05 | Language (Arabic/English, OD-26) | OD-26 | Done | Arabic default (RTL), English; OD-26 open |
| NFR-06 | Security (encrypted transport, named accounts, PIN, server-side RBAC) | - | Partial | Named accounts, server-side RBAC; PIN not built |
| NFR-07 | Backup & recovery | OD-25 | Planned |  |
| NFR-08 | Retention | OD-21 | Planned |  |
| NFR-09 | Time synchronised, Asia/Amman | - | Done | Asia/Amman for local rules |
| NFR-10 | Photo storage sizing | - | Partial | ≤5 MB per photo in the database until Storage (VR-S01) |
| NFR-11 | Configurability (data, not code) | - | Partial | Rules, parameters, permissions and decisions are data |
| NFR-12 | Floor usability (<= 3 screens, scan over typing) | OD-24 | Planned |  |

Open decisions (OD-01…OD-41) and their blocking effect are stored as data (`ph_open_decisions`) and shown in the app under Packing House → Decisions; Standards rows STD-01…STD-28 map to the requirement IDs above and carry no compliance claim (spec §3, §14).
