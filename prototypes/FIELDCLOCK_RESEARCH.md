# FieldClock research and prototype notes

Date: 2026-10-12. Scope: inform `agricultural_operations_prototype.html`, a standalone management demo.
It is **not** part of the app in `src/` and must not be treated as Phase 2+ implementation.

## How the research was done, and its limits

- Sources: FieldClock's official site (fieldclock.com) and help center (support.fieldclock.com), plus Farm Bureau member pages.
- Direct page fetches were blocked by the build environment's network policy (proxy 403). All findings come from
  search-engine extracts of those official pages. Screenshots and videos could **not** be inspected.
- Result: we can describe documented *functions and workflow*. We cannot describe FieldClock's visual layout, and the
  prototype does not claim to reproduce its screens. All visuals, icons and code are original.

Evidence labels: **V** verified from an official source (help-center or product-page text) · **O** observed in a screenshot/demo
(none achieved) · **I** inferred · **N** not verifiable.

| Area | Finding | Evidence | Used in prototype as |
|---|---|---|---|
| Product parts | Web Admin Site, mobile FieldClock app, Kiosk app (PIN/badge clock-in at a central point), Employee Portal | V | Management pages vs. focused Supervisor and Packing House workspaces |
| Navigation | Admin Site has a left-hand navigation menu (Jobs, Employees, Reports…) | V | Fixed side navigation (start side in RTL) |
| Visual layout | Not inspectable | N | Original design |
| Locations | Ranch = physical location; Block = sub-location. Boundaries recorded by GPS (driving the perimeter) | V | Farm → Block → Section → Greenhouse schematic, **no GPS** (excluded by owner) |
| Map | Job "Map" tab shows GPS pins for time entries / pieces on an aerial map | V | Replaced by a clickable non-survey schematic |
| Jobs | Job = task at a ranch on a date. Admin tabs: Employees, Breaks, Finalize, Payouts. Mobile tabs: Info, Employees, Tickets | V | Task drawer: info, planned vs actual, records, history, state-dependent actions |
| Review step | Managers finalize jobs; crew bosses cannot. Un-finalize allowed before payroll batch | V | Supervisor submits → engineer/ops manager verifies → closes. Supervisor can't verify |
| Attendance | Clock in/out by badge scan, or manually if enabled; "Clock Out All" for crew bosses/managers | V | Simulated badge scan, manual roll call, "clock out all", roll-call submission |
| Production | Piecework via badge scan; Individual / Shared / Team modes; variable quantity; Bluetooth scales and ticket printers | V | Team-level quantity records only (assumption VR-P05). No hardware |
| Roles | Company Admin, Manager, Crew Boss, Employee Admin, Payroll Admin, Report Viewer, Production Viewer, Quality Controller, Ticketer, Roamer, Kiosk Admin; multiple roles per user; "Associated Crew Bosses" limits visibility | V | Six operational roles with scope (supervisor → own teams, engineer → own block) |
| Employee record | Badge number, work history, stats, payouts, printable badge | V | Worker profile without pay |
| Reports | Production by Field, Production by Employee, Daily Pay by crew boss, Labor Costs by Field, CSV | V | Production by location and team, attendance, box reconciliation. No pay or cost |
| QC | QC reports tied to an employee or a fruit box by scanning, with photos | V | Not included (QA is independent and a later phase) |
| Offline | Offline mode in the field app | V | Not in this file; the real app in `src/` has it |
| Box batches warehouse → field → packing house → return | **No evidence FieldClock offers this loop with reconciliation**. Competitors (Farmable, Hectre, Harvest Clock) advertise bin QR labels | N | Original design for this farm's need |
| Mobile vs desktop split | Crew boss works in the mobile app; office uses the Admin Site to finalize and report | I | Single-column supervisor workspace on phones |

Key sources: support.fieldclock.com articles `crew-boss-role`, `manager-role`, `tickets-tab-fieldclock-app`,
`clock-employee-in-out-fieldclock-app`, `map-tab-job-details-admin-site`, `ranches-list-admin-site`,
`job-finalization-admin-site`, `employee-details-admin-site`, `production-by-field-report`, `associated-crew-bosses`;
fieldclock.com `/features`, `/apps`, `/features/quality-control`.

## What the prototype is, in one paragraph

A single HTML file (vanilla HTML/CSS/JS, no build, works offline once loaded; Google Font optional) with a seeded,
internally consistent demo dataset (700 workers by default, adjustable to 2,000). Task and box-batch changes run through
one transition function each and update every view. State is saved in the viewer's browser `localStorage` **for the
demo only** and can be reset. Roles are a UI simulation, with no authentication. In the production app, permissions are
enforced by RLS. That localStorage use is a deliberate exception to CLAUDE.md rule 3: it is confined to `prototypes/`
and labelled on every page.

## Demo assumptions

Logged as VR-P01…VR-P06 in `docs/VERIFICATION_REGISTER.md`. None of them drives the structure of the production schema.
