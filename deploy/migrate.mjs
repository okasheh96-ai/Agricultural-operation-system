// Hosted instance: prepares the database on every start, safely and idempotently.
//   1. API roles (anon, authenticated, service_role, authenticator, po_server) — works as a non-superuser database owner
//      with CREATEROLE (Neon, Render and other managed PostgreSQL).
//   2. The auth schema the migrations expect (supabase/appliance/auth.sql).
//   3. Each new migration in its own transaction, recorded in supabase_migrations.schema_migrations. A failure rolls that
//      migration back and stops the start: existing accounts, configuration and records are never touched by a redeploy.
//   4. The structure seed (idempotent), and the DEMO farm only when PH_DEMO=1 (staging).
//   5. The Owner: created once with the one-time setup code from PH_OWNER_SETUP_CODE (only its bcrypt hash is stored). While
//      the Owner has not activated, changing the variable replaces the code; once activated, the variable is ignored.
// Secrets come from the environment and are never printed.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`missing ${k}`); process.exit(2); } return v; };
const DATABASE_URL = need('DATABASE_URL');
const AUTH_PW = need('PH_AUTHENTICATOR_PASSWORD');
const SRV_PW = need('PH_SERVER_DB_PASSWORD');

export function sslFor(url) {
  const u = new URL(url);
  const mode = u.searchParams.get('sslmode') ?? (['localhost', '127.0.0.1'].includes(u.hostname) || u.hostname.startsWith('/') || u.searchParams.get('host') ? 'disable' : 'require');
  return mode === 'disable' ? false : { rejectUnauthorized: mode === 'verify-full' };
}
const client = new pg.Client({ connectionString: DATABASE_URL, ssl: sslFor(DATABASE_URL) });
const q = (sql, args) => client.query(sql, args);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const log = (m) => console.log(`[migrate] ${m}`);

await client.connect();
const who = (await q('select current_user, current_database() as db, (select rolsuper from pg_roles where rolname = current_user) as su')).rows[0];
log(`connected to ${who.db} as ${who.current_user}${who.su ? ' (superuser)' : ''}`);

// 1. Roles.
async function ensureRole(name, opts) {
  const exists = (await q('select 1 from pg_roles where rolname = $1', [name])).rowCount > 0;
  if (exists) return;
  try { await q(`create role ${name} ${opts}`); }
  catch (e) {
    if (!/bypassrls/i.test(opts)) throw e;
    log(`${name}: BYPASSRLS not permitted here; created without it (not used by the packhouse server)`);
    await q(`create role ${name} ${opts.replace(/\bbypassrls\b/i, '')}`);
  }
}
await ensureRole('anon', 'nologin noinherit');
await ensureRole('authenticated', 'nologin noinherit');
await ensureRole('service_role', 'nologin noinherit bypassrls');
await ensureRole('authenticator', 'login noinherit');
await ensureRole('po_server', 'login');
await ensureRole('po_auth', 'nologin');
await q(`alter role authenticator with login password ${lit(AUTH_PW)}`);
await q(`alter role po_server with login password ${lit(SRV_PW)}`);
await q('grant anon, authenticated to authenticator');
// A non-superuser owner must be able to SET ROLE to the API roles it grants (PostgreSQL 16 CREATEROLE rules).
await q(`grant anon, authenticated, service_role to ${who.current_user}`).catch(() => {});

if (process.argv.includes('--roles-only')) { log('roles ready'); await client.end(); process.exit(0); }

// 2. Auth schema.
await q(readFileSync(join(ROOT, 'supabase/appliance/auth.sql'), 'utf8'));

// 3. Migrations.
await q('create schema if not exists supabase_migrations');
await q('create table if not exists supabase_migrations.schema_migrations (version text primary key, applied_at timestamptz default now())');
const applied = new Set((await q('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version));
const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
let n = 0;
for (const f of files) {
  const v = f.replace(/\.sql$/, '');
  if (applied.has(v)) continue;
  log(`apply ${v}`);
  try {
    await q('begin');
    await q(readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8'));
    await q('insert into supabase_migrations.schema_migrations (version) values ($1)', [v]);
    await q('commit');
    n += 1;
  } catch (e) {
    await q('rollback').catch(() => {});
    console.error(`[migrate] ${v} failed and was rolled back: ${e.message}`);
    process.exit(1);
  }
}
log(`${n} new migration(s); ${files.length} in total`);

// 4. Seeds.
await q(readFileSync(join(ROOT, 'supabase/seed/seed.sql'), 'utf8'));
await q('grant po_auth to po_server');
if (env('PH_DEMO', '') === '1') {
  const loaded = (await q("select 1 from public.farms where code = 'DEMO'")).rowCount > 0;
  if (!loaded) {
    log('loading the DEMO farm (staging only: invented data)');
    await q(readFileSync(join(ROOT, 'supabase/seed/demo.sql'), 'utf8'));
    await q(execFileSync('node', [join(ROOT, 'scripts/appliance-demo-users.mjs')], { encoding: 'utf8' }));
    for (const s of ['demo_tasks', 'demo_packing_house', 'demo_packing_house_production', 'demo_packing_house_m2', 'demo_packhouse_ops']) {
      await q(readFileSync(join(ROOT, `supabase/seed/${s}.sql`), 'utf8'));
    }
  }
}

// 5. Owner.
const code = env('PH_OWNER_SETUP_CODE', '');
const username = env('PH_OWNER_USERNAME', 'owner').toLowerCase();
const farm = (await q("select id from public.farms where code = 'FARM'")).rows[0]?.id;
const acct = (await q('select user_id, activation_code_hash is not null as pending, app.po_check($2, activation_code_hash) as same from app.po_accounts where username = $1',
  [username, code || 'x'])).rows[0];
if (!acct && farm && code) {
  await q('begin');
  await q('select public.po_bootstrap_owner($1, $2, $3)', [farm, username, 'المالك / Owner']);
  await q("update app.po_accounts set activation_code_hash = app.po_hash($2), activation_expires_at = now() + interval '30 days' where username = $1", [username, code]);
  await q('commit');
  log(`Owner account "${username}" created; first sign-in uses the one-time setup code`);
} else if (acct?.pending && code && !acct.same) {
  await q("update app.po_accounts set activation_code_hash = app.po_hash($2), activation_expires_at = now() + interval '30 days' where username = $1", [username, code]);
  log('Owner has not activated yet: the setup code was replaced');
} else if (acct) {
  log(`Owner account "${username}" ${acct.pending ? 'waiting for first sign-in' : 'active'}`);
} else {
  log('no Owner yet: set PH_OWNER_SETUP_CODE to create one');
}
await client.end();
