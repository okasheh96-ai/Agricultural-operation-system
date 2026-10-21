// Builds the in-browser demo: the app plus its real database (PostgreSQL via PGlite) running in the viewer's browser,
// with the demo farm only. Demo data, demo people, no secrets; nothing here connects to a server database.
// Usage: node scripts/build-browser-demo.mjs
// Output (.local/browser-demo/):
//   site/        index.html (page content, wrapped by the host) + pglite.wasm and, as base64 text (hosts that serve only web
//                file types), pglite.data, btree_gist.tar.gz and demo-db.tar.gz
//   standalone/  index.html: one self-contained file (everything embedded) to open from disk
//   preview/     index.html: site/ wrapped in a full HTML document, for local testing
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_PASSWORD, USERS } from './demo-people.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.local/browser-demo');
const SITE = join(OUT, 'site');
const FILES = join(OUT, 'files');
const PGLITE_DIST = join(ROOT, 'node_modules/@electric-sql/pglite/dist');
const sqlFile = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const q = (s) => (s === null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const step = (label) => console.log(`== ${label}`);

rmSync(OUT, { recursive: true, force: true });
for (const d of [SITE, FILES, join(OUT, 'standalone'), join(OUT, 'preview')]) mkdirSync(d, { recursive: true });

// 1. The database: the same migrations and seeds as the local stack and CI, then the demo people.
step('database snapshot');
const db = await PGlite.create({ extensions: { btree_gist } });
await db.exec(sqlFile('supabase/tests/_shim.sql'));
await db.exec(sqlFile('supabase/browser-demo/auth.sql'));
for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(sqlFile(`supabase/migrations/${f}`));
}
await db.exec(sqlFile('supabase/seed/seed.sql'));
await db.exec(sqlFile('supabase/seed/demo.sql'));
const people = ["do $$ declare f uuid := (select id from public.farms where code = 'DEMO' and is_demo); u uuid; begin"];
for (const u of USERS) {
  people.push(`insert into auth.users (email, password_sha256) values (${q(u.email)}, encode(sha256(convert_to(${q(DEMO_PASSWORD)}, 'UTF8')), 'hex')) returning id into u;`);
  people.push(`insert into public.user_profiles (id, farm_id, full_name) values (u, f, ${q(u.name)});`);
  for (const [role, dept] of u.roles) {
    people.push(`insert into public.user_roles (farm_id, user_id, role_id, department_id, valid_from)
      select f, u, (select id from public.roles where farm_id = f and code = ${q(role)}),
             ${dept ? `(select id from public.departments where farm_id = f and code = ${q(dept)})` : 'null'}, now() - interval '1 day';`);
  }
}
people.push('end $$;');
await db.exec(people.join('\n'));
const snapshot = Buffer.from(await (await db.dumpDataDir('gzip')).arrayBuffer());
writeFileSync(join(FILES, 'demo-db.tar.gz'), snapshot);
const build = createHash('sha256').update(snapshot).digest('hex').slice(0, 16);
console.log(`   ${(snapshot.length / 1e6).toFixed(1)} MB, build ${build}`);

// 2. Check the first-visit seeds against the snapshot, as the browser will run them.
step('first-visit seeds');
const check = await PGlite.create({ loadDataDir: new Blob([snapshot]), extensions: { btree_gist } });
const t0 = Date.now();
await check.exec(sqlFile('supabase/seed/demo_tasks.sql'));
await check.exec(sqlFile('supabase/seed/demo_packing_house.sql'));
await check.exec(sqlFile('supabase/seed/demo_packing_house_production.sql'));
await check.exec(sqlFile('supabase/seed/demo_packing_house_m2.sql'));
const counts = (await check.query(`select (select count(*)::int from public.tasks) as tasks, (select count(*)::int from public.ph_arrivals) as arrivals,
  (select count(*)::int from public.ph_incoming_pallets) as pallets, (select count(*)::int from auth.users) as people,
  (select count(*)::int from public.ph_job_cards) as job_cards, (select count(*)::int from public.ph_fg_pallets) as fg_pallets,
  (select count(*)::int from public.ph_order_lines) as order_lines, (select count(*)::int from public.ph_waste_records where weighed_at is not null) as waste`)).rows[0];
console.log(`   ${Date.now() - t0} ms in Node:`, counts);
if (!counts.arrivals || !counts.pallets || !counts.tasks || !counts.job_cards || !counts.fg_pallets || !counts.order_lines || !counts.waste) {
  throw new Error('demo seeds produced no records');
}
await check.close();
await db.close();

// 3. The app.
step('app build');
execFileSync('npx', ['vite', 'build', '--mode', 'browserdb', '--outDir', join(OUT, 'app'), '--emptyOutDir'], {
  cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, BROWSER_DB_BUILD: build },
});
const html = readFileSync(join(OUT, 'app/index.html'), 'utf8');
const jsPath = /<script[^>]+src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
const cssPath = /<link[^>]+href="\.\/(assets\/[^"]+\.css)"/.exec(html)?.[1];
if (!jsPath || !cssPath) throw new Error('could not find the app script or stylesheet in index.html');
const js = readFileSync(join(OUT, 'app', jsPath), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(OUT, 'app', cssPath), 'utf8');

// 4. The page. The host wraps it in <!doctype html><html><head>…</head><body>, so it starts at the title.
step('page');
const page = `<title>Packing House Operations</title>
<style>:root { color-scheme: light; } body { background: #fafaf9; color: #1c1917; }
${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync(join(SITE, 'index.html'), page);
for (const f of ['pglite.wasm', 'pglite.data', 'btree_gist.tar.gz']) copyFileSync(join(PGLITE_DIST, f), join(FILES, f));
copyFileSync(join(FILES, 'pglite.wasm'), join(SITE, 'pglite.wasm'));
const BASE64 = ['pglite.data', 'btree_gist.tar.gz', 'demo-db.tar.gz'];
for (const f of BASE64) writeFileSync(join(SITE, `${f}.b64.txt`), readFileSync(join(FILES, f)).toString('base64'));
// PGlite (PostgreSQL in WebAssembly) is Apache-2.0; its licence travels with the files we redistribute.
copyFileSync(join(PGLITE_DIST, '../LICENSE'), join(SITE, 'pglite-LICENSE.txt'));

const shell = (head, body) => `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}</head>
<body>
${body}</body>
</html>
`;
writeFileSync(join(OUT, 'preview/index.html'), shell('', page));

// 5. One self-contained file: the same page with the database files embedded (base64).
step('standalone file');
const embedded = Object.fromEntries(['pglite.wasm', 'pglite.data', 'btree_gist.tar.gz', 'demo-db.tar.gz']
  .map((f) => [f, readFileSync(join(FILES, f)).toString('base64')]));
writeFileSync(join(OUT, 'standalone/index.html'),
  shell('', `<script>window.__AGRI_EMBEDDED_ASSETS__ = ${JSON.stringify(embedded)};</script>\n${page}`));

for (const d of ['site', 'standalone']) {
  for (const f of readdirSync(join(OUT, d))) {
    console.log(`   ${d}/${f}  ${(readFileSync(join(OUT, d, f)).length / 1e6).toFixed(1)} MB`);
  }
}
