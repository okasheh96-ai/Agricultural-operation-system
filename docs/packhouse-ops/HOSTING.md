# Hosting, backup and recovery (owner instruction 2026-11-22)

## Architecture (free plans, no paid resources)

| Part | Where | Why |
|---|---|---|
| App + sign-in server + API (PostgREST) | Render web service, Docker, free plan, Frankfurt — `render.yaml` | Permanent HTTPS address, built from this branch on every push. Keeps nothing on disk. |
| Production database | **Neon PostgreSQL, free plan** (permanent, 1 GB, 6-hour point-in-time history) | The system is ~30 PostgreSQL migrations of business rules; it needs real PostgreSQL. Render's free database expires after 30 days and Cloudflare D1 is SQLite, so neither can hold the business data. |
| Staging (tests only) | Render web service + Render free PostgreSQL — `render.staging.yaml` | Same image with the invented DEMO farm; used for the end-to-end tests over HTTPS. Its database expires 2026-12-21: never real data. |

Cloudflare: checked first. Workers + D1 cannot run the PostgreSQL rules without a rewrite, and Workers need an external
PostgreSQL anyway; nothing would be gained over the design above.

## Secrets

Render generates `PH_JWT_SECRET`, `PH_AUTHENTICATOR_PASSWORD`, `PH_SERVER_DB_PASSWORD` and `PH_OWNER_SETUP_CODE`
(`generateValue`): they exist only in the Render dashboard. `DATABASE_URL` is pasted by the Owner from Neon into Render.
Nothing secret is in the repository or the handover.

## Every start (deploy/start.sh → deploy/migrate.mjs)

Roles → auth schema → each **new** migration in its own transaction (recorded in `supabase_migrations.schema_migrations`;
a failure rolls that migration back and the old version keeps serving) → structure seed → Owner bootstrap (only once; the
setup code can be replaced in Render until the Owner has activated). Redeploys therefore keep accounts, settings and records.
Verified on staging: identical record counts before and after a redeploy from a new commit.

## Owner's first sign-in

1. Open the app address → **دخول أول برمز التفعيل / First sign-in with a code**.
2. Username `owner`; code = Render → service → Environment → `PH_OWNER_SETUP_CODE` (copy it exactly).
3. Choose your own password (8+ characters, a letter and a digit). The code stops working once used.

## Backups

- **Neon**: point-in-time history (free plan: 6 hours) — restore from the Neon console.
- **Settings → Backup → Download full backup** (Owner only; recorded in the access log): a `pg_dump` archive of
  everything (records, photos, settings, accounts). Keep it private (encrypted drive). Recommended: weekly and before
  large changes.

## Restore (verified 2026-11-22)

`TARGET_URL=<empty database> PH_AUTHENTICATOR_PASSWORD=… PH_SERVER_DB_PASSWORD=… deploy/restore.sh FILE.dump`
(needs PostgreSQL 17 client tools, e.g. inside the app image), then point `DATABASE_URL` at the target and redeploy.
Verified: a backup downloaded from the live staging site over HTTPS was restored into a fresh PostgreSQL 17 as a
non-superuser and contained the records created by the tests minutes before; a locally downloaded backup restored into a
new cluster with identical records and the full owner scenario passed on the restored system.

## Known limits of the free plans

- Render free web service sleeps after ~15 minutes without visits; the next visit waits ~1 minute while it wakes.
  Scheduled work (recurring tasks, escalations) catches up on the first request after waking. Removing the sleep needs
  Render's paid Starter plan (owner approval required).
- Neon free: 1 GB storage and 100 compute-hours per month; scales to zero when idle (first query after idle ~1 s).
- Backups beyond Neon's 6-hour history are the Owner's downloads; automatic off-site copies need a storage account
  (e.g. Cloudflare R2 API token) that the Owner would have to create.
