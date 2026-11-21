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
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
// Prefer TLS; a private-network database that does not offer TLS is accepted (the start script follows what worked).
let client = new pg.Client({ connectionString: DATABASE_URL, ssl: sslFor(DATABASE_URL) });
let sslMode = sslFor(DATABASE_URL) ? 'require' : 'disable';
const q = (sql, args) => client.query(sql, args);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const log = (m) => console.log(`[migrate] ${m}`);

try { await client.connect(); }
catch (e) {
  if (!/does not support SSL|SSL off/i.test(String(e.message))) throw e;
  client = new pg.Client({ connectionString: DATABASE_URL, ssl: false }); sslMode = 'disable';
  await client.connect();
}
writeFileSync(join(process.env.TMPDIR || '/tmp', 'ph-sslmode'), sslMode);
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

// Host compatibility (migration files are never edited once applied anywhere): managed PostgreSQL that lists pg_cron but only
// allows it in the "postgres" database (Neon) takes the documented "no pg_cron here" path; the packhouse server's scheduler
// tick runs the periodic work instead. Each rewrite is logged.
const HOST_COMPAT = [{
  version: '20261005000710_work_exception_engines',
  find: "if exists (select 1 from pg_available_extensions where name = 'pg_cron') then",
  replace: "if exists (select 1 from pg_available_extensions where name = 'pg_cron') and current_database() = coalesce(nullif(current_setting('cron.database_name', true), ''), 'postgres') then",
}];
function hostCompatible(version, sql) {
  for (const c of HOST_COMPAT.filter((x) => x.version === version)) {
    if (!sql.includes(c.find)) throw new Error(`host-compat rule for ${version} no longer matches the file`);
    sql = sql.replace(c.find, c.replace);
    log(`${version}: pg_cron only where this database may create it (host compatibility)`);
  }
  return sql;
}

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
    await q(hostCompatible(v, readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8')));
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

// 5. Owner (Super Admin). Created once, only while the farm has no Owner at all. The setup code lives only in the hosting
//    dashboard; only its bcrypt hash is stored (upper-cased, as every code check compares). Codes are never printed.
const code = env('PH_OWNER_SETUP_CODE', '');
const farm = (await q("select id from public.farms where code = 'FARM'")).rows[0]?.id;
const ownerSql = `select a.user_id, a.username, a.password_hash is null and a.activation_code_hash is not null as pending,
    app.po_check(upper(trim($1)), a.activation_code_hash) as same
  from app.po_accounts a join public.user_roles ur on ur.user_id = a.user_id and ur.voided_at is null
  join public.ph_roles pr on pr.role_id = ur.role_id and pr.spec_code = 'OWN'
 where a.farm_id = $2 and a.status = 'active' order by a.created_at`;
const owners = farm ? (await q(ownerSql, [code || 'x', farm])).rows : [];
if (farm && owners.length === 0 && code) {
  await q('begin');
  await q('select public.po_bootstrap_owner($1, $2, $3)', [farm, 'owner', 'المالك / Owner']);
  await q("update app.po_accounts set activation_code_hash = app.po_code_hash($2), activation_expires_at = now() + interval '30 days' where username = $1", ['owner', code]);
  await q('commit');
  log('Super Admin account created: waiting for setup with the one-time code (open /setup)');
} else if (owners.length === 1 && owners[0].pending && code && !owners[0].same) {
  await q("update app.po_accounts set activation_code_hash = app.po_code_hash($2), activation_expires_at = now() + interval '30 days' where user_id = $1",
    [owners[0].user_id, code]);
  log('Super Admin not set up yet: the setup code was replaced');
} else if (owners.length) {
  log(`Super Admin: ${owners.some((o) => !o.pending) ? 'active' : 'waiting for setup (open /setup)'}`);
} else {
  log('no Super Admin yet: set PH_OWNER_SETUP_CODE in the hosting dashboard');
}
for (const o of owners.filter((x) => !x.pending)) await q('select app.po_owner_also_admin($1, $2)', [farm, o.user_id]).catch(() => {});
const recovery = env('PH_OWNER_RECOVERY_CODE', '');
if (recovery) {
  const r = (await q('select app.po_owner_recovery($1) as r', [recovery])).rows[0].r;
  log(r.startsWith('issued:') ? 'Super Admin recovery: one-time code active for 24 hours (sign in with "first sign-in with a code")'
    : r === 'already_used' ? 'Super Admin recovery code already used; set a new one to recover again' : `Super Admin recovery not applied: ${r}`);
}
await client.end();
