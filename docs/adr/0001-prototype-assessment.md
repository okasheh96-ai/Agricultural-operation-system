# ADR 0001 — Prototype assessment and greenfield start

Date: 2026-10-04 · Status: accepted (pending owner answer to VR-S02)

## Context
Master Prompt Part 6 expects a Lovable prototype in the repository (sign-in, 14 wells, maintenance, work orders, dashboard, departments, QA independence), to be classified keep/refactor/replace.

## Findings
- `okasheh96-ai/Agricultural-operation-system` was empty: no commits, code, schema or tests.
- The owner's other repositories are FactoryOps projects. §0.4 forbids referencing or reusing them, so they were not opened.
- No Supabase project or credentials are reachable from the development environment.

## Decision
Start greenfield on the §3.2 stack. Nothing is classified, because nothing exists to classify.

## Consequences
- **If a Lovable/Supabase project exists elsewhere (VR-S02 / E48):** before applying these migrations to it,
  (1) export its schema as a baseline migration, (2) map its wells onto `water_sources` + `wells` with status Not Yet Verified unless real statuses were entered,
  (3) migrate its maintenance records onto the work/exception engines (Phase 2/5) with data migrations, never by dropping tables, and (4) get the owner to confirm which project is production.
- Phase 1 migrations assume an empty database. Applying them to a non-empty project needs that baseline first.

## Alternatives considered
- Wait for the prototype before writing code. Rejected: the foundation (permissions, audit, transitions, master data) is needed in every outcome and does not depend on the prototype.
