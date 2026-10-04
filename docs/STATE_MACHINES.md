# State Machines

Implemented as data (`workflow_versions`, `workflow_statuses`, `allowed_transitions`) and enforced by `transition_record()`.
Records keep the workflow version they started under. Changing rules means publishing a new version, because published versions are frozen.
Each transition row names the permission action, required fields and `must_differ_from` (segregation of duties).

## Implemented (Phase 1)

### Asset / water-source status — `asset_status` v1 (VR-C10)
Every change requires `configure` plus a reason (`comment`). New records always start in **Not Yet Verified**. No seed sets Active.
```mermaid
stateDiagram-v2
  [*] --> not_yet_verified
  not_yet_verified --> active
  not_yet_verified --> inactive
  not_yet_verified --> under_maintenance
  active --> inactive
  active --> under_maintenance
  inactive --> active
  inactive --> under_maintenance
  under_maintenance --> active
  under_maintenance --> inactive
  active --> not_yet_verified
  inactive --> not_yet_verified
  under_maintenance --> not_yet_verified
```

### Task — `task` v1 (Phase 2, implemented; VR-C18)
Path depends on the task type (`guard`): with verification → `pending_verification → verified → closed`; without → `completed → closed`.
`verified/completed → in_progress` (reopen for correction) needs `review` + reason. `pending_verification → in_progress` (send back) needs `verify` + reason and increments `rejection_count`. Block needs a reason (material, equipment, water, labour, weather, access, other); resuming clears it.

### Problem report — `problem_report` v1 (Phase 2, implemented)
`open → acknowledged → converted` (only through `triage_problem_report()`, which creates the work order/task) · `→ resolved` / `→ rejected` with a reason.

### Stock issue request — `issue_request` v1 (Phase 2, implemented; VR-C19)
`requested → (approved) → partially_issued → issued → received`; `rejected` (warehouse, reason), `cancelled` (requester, reason).

## Starting definitions for later phases (from Master Prompt §3.5; seeded as data when the phase starts)

### Task (diagram)
```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> planned
  planned --> assigned
  assigned --> in_progress
  in_progress --> blocked
  blocked --> in_progress
  in_progress --> completed
  completed --> pending_verification
  pending_verification --> verified: verifier ≠ executor
  pending_verification --> in_progress: rejected (reason, count kept)
  verified --> closed
  draft --> cancelled
  planned --> cancelled
  assigned --> cancelled
```
Task types may skip verification only when their policy says so.

### Maintenance work order (Phase 5)
```mermaid
stateDiagram-v2
  [*] --> requested
  requested --> under_review
  under_review --> prioritized
  prioritized --> approved: if policy requires
  prioritized --> scheduled
  approved --> scheduled
  scheduled --> in_progress
  in_progress --> waiting_parts
  waiting_parts --> in_progress
  in_progress --> completed
  completed --> tested
  tested --> pending_verification
  pending_verification --> verified
  verified --> closed
  under_review --> rejected
  requested --> cancelled
```

### Irrigation run (Phase 4)
`planned → scheduled → in_progress → completed (actual water; fertilizer where applicable) → pending_verification → verified`, plus `exception/interrupted`.

### Plant-protection application (Phase 3)
`planned → approved → materials_issued → applied → recorded → verified`. Generates REI/PHI windows on the block. Harvest on that block inside PHI is blocked unless an authorised, logged override exists.

### Harvest lot (Phase 3)
`created → in_transit → received → inspected → accepted | on_hold | rejected`

### Quality hold (Phase 9)
`placed → under_review → released | rejected_disposed`. Authority comes from the QA matrix (E3, Not Yet Verified, configurable).

### QA finding (Phase 9)
`raised (QA) → acknowledged (owning department) → corrective_action_in_progress → submitted → verified (QA) → closed (QA only)`

### Stock issue request (Phase 2)
`requested → approved (if policy) → issued → received_confirmed | partially_issued | rejected`
