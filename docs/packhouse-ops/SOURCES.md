# Source register — packhouse operations build

Inventory made 2026-11-21 at the start of the owner's "Build my packhouse operations management system" instruction.
Only files that were actually opened are marked as read. The uploaded files themselves are **not** committed
(owner instruction: keep source documents and identifiable worker records out of commits); this register, the extracted
reference values and the requirement matrix are.

## Supplied and read

| ID | File (as uploaded) | Pages read | Revision / approval stated | Standing used here |
|---|---|---|---|---|
| S-04 | `Packhouse_Roles_and_Daily_KPIs1.pdf` (English) | 1–4 of 4 | Header "PACKHOUSE OPERATIONS / DRAFT FOR REVIEW". No revision number, date, author or approver. | **Draft proposal.** Responsibilities become forms, checklists and routing; authorities it gives are proposals (see DECISIONS.md). KPI formulas are implemented exactly as written, labelled "draft". |
| S-05 | `Packhouse_Roles_and_Daily_KPIs_AR.pdf` (Arabic) | 1–4 of 4 | Same header in Arabic ("مسودة للمراجعة"). | Arabic text of S-04, but **not identical** (C-01). Used for Arabic labels. |
| S-06 | `Line_Supervisor_Responsibilities_and_Accountability_AR.pdf` (Arabic) | 1–2 of 2 | "مسودة للمراجعة". | Line Supervisor page identical to S-05 p.1. Its accountability page applies to line supervisors only (C-02). |
| S-07 | `Produce_Grading_Final_Updated.pdf` | 1–21 of 21 (image pages, read visually incl. colour scales and diagrams) | Cover: "Master SOP for Quality Inspectors · October 2026". **No revision number, approver, signature or effective date.** | Owner-supplied grading specification, approval not stated. Imported as specification **version 1, status "imported — awaiting QA/QC approval"** (OD-43). Shown to inspectors as reference; the system suggests a grade against it and labels the result "spec not approved"; no automatic release or rejection. |
| S-08 | `AWETA_Maintenance_A4_Poster.pdf` | 1 of 1 | Footer: "Proposed Jordan site plan for 10/16-hour days; 30/120/500 h are not OEM-approved intervals." Source: prior plan (CUP/CLD). | **Draft proposal.** Loaded as a maintenance schedule in state *pending approval*; nothing is generated from it until a Maintenance owner approves it (OD-44). |
| S-09 | `AWETA_Cleaning_A4_Poster.pdf` | 1 of 1 | Footer: "30/120 h are proposed site intervals from the prior plan." | **Draft proposal.** Cleaning schedule, pending approval (OD-44). Prohibitions for the cleaning team are shown as checklist text. |
| S-03 | `docs/packing-house/PH-OAS-SPEC-001_v0.1.pdf` (already in the repository) | Read in full on 2026-10-19 (`docs/BUILD_ASSESSMENT.md`) | "DRAFT — for management review. Not approved. Not for build." | Unchanged: every rule keeps its C / P / NYV label; 41 open decisions stay in `ph_open_decisions`. |

Product SOPs (Cherry Tomato, Tomato, Blocky Capsicum, Sweet Bite Pepper, Melon, Watermelon — draft 001) were reviewed in
an earlier session (VR-PH-E08). They were **not** re-supplied now and were not re-read.

## Named in the instruction but not supplied

None of these is a blocker; each gap is handled by the rules in DECISIONS.md.

| Expected source | Status | Consequence |
|---|---|---|
| SOP001 "English SOP - 2026 updated need photos, index and organogram, V4" (the stated primary reference) | **Not supplied** (not in the upload, not in the repository, no `sources/` folder) | Its revision, approval status and duplicate copies cannot be identified. SOP content is available only where PH-OAS-SPEC-001 quotes it (C-labelled items). No SOP step is invented. |
| Packing House Operations — Engineering Summary Rev. 2.2 (`Packing_House_Summary(1).pdf`) | Not supplied | Only what PH-OAS-SPEC-001 quotes (SUM-n references). |
| PH-OAS-SPEC-001 registers workbook | Not supplied | Permission matrix stays as transcribed from the PDF (VR-PH-S02). |
| `Line_Supervisor_Responsibilities_and_Accountability.pdf` (English) | Not supplied | The Arabic version (S-06) is used. |
| QC/QA responsibility decision brief | Not supplied | QC/QA split stays as in the spec; QA independence rule unchanged. |
| Spreadsheets: equipment-hour schedules, breakdown logs, staffing plans, order plans, daily reports, labour sheets, worker productivity examples, pack weights, downtime corrections | **None supplied** | No operational history can be imported. The spreadsheet import tool is built and tested with synthetic files; the operational database starts with reference data only. |
| Crop-specific specifications beyond S-07, approved customer amendments, grading photos, bilingual guides | Not supplied | S-07 is the only specification. Its product photos are not extracted (they illustrate, they do not specify). |
| Ingro washer / ELIFAB documentation | Not supplied | Lines exist as in the spec (Line A ELIFAB, Line B AWETA, Line C manual, washer-dryer); no capacities are invented. |

## Extracted reference data (committed)

- `supabase/seed/reference/grading_spec_s07.json` — every value of S-07 pages 6–20 with page references and flags.
- `supabase/seed/reference/aweta_schedules_s08_s09.json` — every interval and task of S-08/S-09.
- Roles and KPI text (S-04/05/06) is transcribed into checklists and help text with the source page.

Personal names: S-06 item 9 names a store after a person ("near Yousef's store"). The system calls it "external box
storage area" and the location name is left for the owner to enter.
