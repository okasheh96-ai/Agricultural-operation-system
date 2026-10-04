# Agricultural Operations Management System

An Arabic-first, mobile-first, offline-capable execution layer for a commercial farm in Jordan:
**Plan → Assign → Execute → Record → Verify → Close → Measure**, across 13 departments and the packing house.

- Instructions: [`docs/MASTER_PROMPT.md`](docs/MASTER_PROMPT.md) · digest: [`CLAUDE.md`](CLAUDE.md)
- Plan and status: [`docs/ARCHITECTURE_PLAN.md`](docs/ARCHITECTURE_PLAN.md) · [`docs/phase-reports/`](docs/phase-reports/)
- Open questions: [`docs/VERIFICATION_REGISTER.md`](docs/VERIFICATION_REGISTER.md)

## Develop
```bash
npm install
scripts/dev-stack.sh up         # local Postgres + Supabase Auth + PostgREST + demo farm; writes .env.local
npm run dev                     # sign in as demo.supervisor@demo.local / demo-password-123 (demo farm only)
```
Other demo users: `demo.agri.manager`, `demo.maint.manager`, `demo.technician`, `demo.ops`, `demo.warehouse`, `demo.qa`, `demo.exec`, `demo.admin` (`@demo.local`).
Everything they see is labelled **Demo Data**; it is not farm data. To use a hosted project instead, put its URL and anon key in `.env.local` (never the service-role key).

## Check
```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run db:test                  # migrations + seed on a throwaway local Postgres 16, then pgTAP
npm run test:e2e                 # Playwright smoke, phone + desktop, Arabic RTL
npm run test:e2e:stack           # Playwright workflows against the local stack (offline sync, triage, verification)
```

## Database
- `supabase/migrations`: never edit an applied migration; add a new one.
- `supabase/seed/seed.sql`: structure only. Run it on production **only with explicit owner approval**.
- After the seed, the owner creates the first admin from the SQL editor:
  `select public.bootstrap_first_admin('<farm id>', '<auth user id>', '<full name>');`
