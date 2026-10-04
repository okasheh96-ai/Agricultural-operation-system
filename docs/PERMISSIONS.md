# Permission Matrix

Source of truth: `role_permissions` rows created by `supabase/seed/seed.sql`. This page documents them. Change the seed (or a migration) and this page together.

## Model
`allowed = role × department scope × location scope × object type × action × workflow state`

- **role_permissions** says what a role may do: object type + action, optionally only in `allowed_states`.
- **user_roles** says where: `department_id` (null = farm-wide), `location_id` (subtree; null = everywhere) and the validity period.
- A **department-scoped** role applies only to records owned by that department. Records with no owning department need a farm-wide grant (VR-C04).
- A person may hold roles in several departments. Effective permission is the union.
- **Delegations** give the delegate the delegator's roles, limited to the delegation's department if one is set. The delegate can never act on records where the delegator holds a segregated role.
- **Segregation of duties** is checked per record by `transition_record()` (`allowed_transitions.must_differ_from`). Holding two roles never lets anyone verify their own execution.
- Enforced in Postgres (RLS + SECURITY DEFINER functions). The UI mirrors it with the same data. Hiding a button is never the only control.

Actions: view · create · plan · dispatch · execute · review · verify · approve · close · configure · void

## Phase 1 matrix (tier C, VR-C01 to C04)

| Role | Phase 1 objects |
|---|---|
| All roles | **view**: farm, department, role, role_permission, user, user_role, unit, production_system, location, asset_class, asset, water_source, crop_master, worker, crew, setting, workflow |
| System Administrator (farm-wide) | create · configure · verify · void on all Phase 1 objects. Also view audit_log, review sync_conflict, view/create/configure worker_private. **Admin edits are audited like anyone else's.** |
| Department Manager (own department) | create · configure · verify · void on location, asset, water_source, worker, crew. Also worker_private view/create/configure, and delegation view/create/configure |
| Maintenance Manager (own department) | create · configure on asset (includes asset status changes) |
| QA User | view audit_log |
| Operations Manager | view only in Phase 1. Cross-department requests, comments and escalation arrive with Phase 2. **No department-internal approve/verify/close by default** |
| Executive Viewer | view only |
| Supervisor, Technician, Warehouse, Irrigation, Fleet, QC, Packing House users | view only in Phase 1. Execution rights arrive with the work engine (Phase 2) |

## Phase 2 matrix (tier C, VR-C17)

| Role | Phase 2 objects |
|---|---|
| All roles | **view**: task, plan, work_order, problem_report, task_type, problem_category, warehouse, item, issue_request, stock, escalation_rule. **Anyone may raise a problem report and comment.** |
| Supervisor, Maintenance Technician, Irrigation / Fleet / Packing House user (own department) | task: create, execute · issue_request: create, execute (confirm receipt) |
| Department Manager, Maintenance Manager (own department) | task: create, plan, dispatch, execute, review, verify, close, void · plan & work_order: create, configure, void · problem_report: review (triage) · issue_request: create, execute, approve · task_type: create, configure, verify · stock: execute, approve |
| Warehouse User (own warehouse department) | stock: execute (receipts, issues, returns) · issue_request: execute (issue/reject) |
| Operations Manager (farm-wide) | task: create (draft cross-department request) · work_order: create · problem_report: review (route/triage). **No plan/dispatch/verify/close inside departments.** |
| System Administrator | task_type, problem_category, escalation_rule, warehouse, item: create, configure, verify, void. **No task execution or verification.** |

Issue requests are checked per step: requester steps (receive, cancel) against the requesting department, warehouse steps (issue, reject) against the warehouse's department (`allowed_transitions.scope_column`).

## Fixed rules (tier A — tested)
- QA is independent. Operations will get read-only access to QA records, and only QA closes QA findings (enforced from Phase 9; the department is flagged `is_independent` now).
- Nobody can update or delete `audit_events`. Nobody deletes any operational or master record through the API.
- Anonymous users have no table access.
- Worker ID numbers and phone numbers live in `worker_private`, readable only with `worker_private:view`.

Tests: `supabase/tests/pgtap/03_permissions.sql`, `04_transitions.sql`.
