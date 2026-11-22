import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { as, api, seedRef, stage, OWNER, VIEWER, BASE } from './helpers';

test.beforeAll(async ({ request }) => { await seedRef(request); });
const DATE = '2026-11-09';

test('viewer sees the live dashboard, cannot write, sees new approvals; snapshot stays frozen; revocation and expiry', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const a = api(request);
  // owner-approved production with a named worker
  const b1 = await stage(request, { dataset: 'production', shift_date: DATE, rows: [{ dims: { line: 'L4', product: 'TOM', grade: 'G1' }, time: '09:00', measures: [{ metric: 'qty', value: '700', unit: 'kg', role: 'actual' }] }] });
  await a.post(`/api/batches/${b1}/approve`, {});
  const b2 = await stage(request, { dataset: 'labour', shift_date: DATE, rows: [{ dims: { line: 'L4', worker: 'Worker Test-7' }, start_time: '06:00', end_time: '09:00', measures: [] }] });
  await a.post(`/api/batches/${b2}/approve`, {});

  // before the grant, the person is authenticated but denied
  const vctx = await as(browser, VIEWER);
  const v = await vctx.newPage();
  await v.goto(`/?date=${DATE}`);
  await expect(v.getByTestId('auth-error')).toContainText('do not have access');

  // owner grants "View entire live dashboard" in Settings and freezes a snapshot
  const octx = await as(browser, OWNER);
  const o = await octx.newPage();
  await o.goto('/settings/access');
  await o.getByTestId('grant-email').fill(VIEWER);
  await o.getByTestId('grant').click();
  await expect(o.getByTestId(`grant-${VIEWER}`)).toBeVisible();
  await o.goto(`/?date=${DATE}`);
  await o.getByRole('button', { name: 'Frozen snapshot' }).click();
  await o.getByTestId('snap-title').fill('Morning snapshot');
  await o.getByTestId('snap-create').click();
  const snapUrl = await o.getByTestId('snap-link').locator('a').getAttribute('href');
  expect(snapUrl).toContain('/s/');

  // viewer: full dashboard, own filters, drill-down, no owner navigation, worker names hidden
  await v.goto(`/?date=${DATE}`);
  await expect(v.getByTestId('role')).toHaveText('Read-only');
  await expect(v.locator('.bottomnav')).toHaveCount(0);
  await expect(v.getByTestId('quick-open')).toHaveCount(0);
  await expect(v.locator('#sec-production')).toContainText('700');
  await v.getByTestId('more-filters').locator('summary').click();
  await v.getByTestId('f-line').selectOption('L4');
  await expect(v).toHaveURL(/line=L4/);
  await v.locator('#sec-productivity').getByTestId('k-wh-actual').click();
  await expect(v.getByTestId('fact-table')).toContainText('•••');
  await expect(v.getByTestId('fact-table')).not.toContainText('Worker Test-7');
  await v.keyboard.press('Escape');

  // every write, private file, owner screen and export is denied server-side
  const va = api(request, VIEWER);
  await va.post('/api/batches', { source: 'manual', dataset: 'production', shift_date: DATE, total_rows: 1 }, 403);
  await va.post(`/api/batches/${b1}/approve`, {}, 403);
  await va.post('/api/plans/draft', { date: DATE, from: 'empty' }, 403);
  await va.post('/api/access', { email: 'x@y.z' }, 403);
  await va.put('/api/settings', { lot_tol_pct: 5 }, 403);
  await va.get('/api/settings', 403);
  await va.get('/api/files', 403);
  await va.get('/api/export.zip', 403);
  await va.get('/api/batches', 403);
  const files = await a.get<{ files: { id: string }[] }>('/api/files');
  if (files.files[0]) await va.get(`/api/files/${files.files[0].id}`, 403);
  // missing CSRF header and missing identity are refused too
  expect((await request.post(`${BASE}/api/access`, { headers: { 'x-dev-email': OWNER }, data: { email: 'a@b.c' } })).status()).toBe(403);
  expect((await request.get(`${BASE}/api/dashboard?date=${DATE}`)).status()).toBe(401);

  // owner approves a brand-new dataset; it appears in the viewer's open page without a reload
  await v.goto(`/?date=${DATE}&line=L4`);
  const b3 = await stage(request, { dataset: 'custom:cold_room', shift_date: DATE, rows: [
    { dims: { line: 'L4' }, time: '08:00', measures: [{ metric: 'temp_c', value: '4.5', unit: 'minute', role: 'actual' }] },
  ] });
  await a.post(`/api/batches/${b3}/approve`, {});
  await expect(v.getByTestId('ds-custom:cold_room')).toBeVisible({ timeout: 30_000 });
  await expect(v).toHaveURL(/line=L4/); // filters kept

  // the earlier snapshot is frozen: no new dataset in it
  await v.goto(snapUrl!);
  await expect(v.getByTestId('snapshot')).toContainText('Morning snapshot');
  await expect(v.getByTestId('snapshot')).toContainText('700');
  await expect(v.getByTestId('ds-custom:cold_room')).toHaveCount(0);

  // revoke the viewer: the next request is denied; the snapshot link still works until revoked
  await o.goto('/settings/access');
  await o.getByTestId(`revoke-${VIEWER}`).click();
  await expect(o.getByTestId(`grant-${VIEWER}`)).toContainText('Revoked');
  await va.get(`/api/dashboard?date=${DATE}`, 403);
  await v.goto(`/?date=${DATE}`);
  await expect(v.getByTestId('auth-error')).toBeVisible();
  await v.goto(snapUrl!);
  await expect(v.getByTestId('snapshot')).toBeVisible();
  await o.goto('/settings/snapshots');
  await o.getByTestId('snap-revoke-Morning snapshot').click();
  await expect(o.getByTestId('snap-Morning snapshot')).toContainText('Revoked');
  await v.goto(snapUrl!);
  await expect(v.getByTestId('snapshot-gone')).toBeVisible();

  // expiry and recipient lists
  const s2 = await a.post<{ path: string }>('/api/snapshots', { title: 'Short', filters: { date: DATE }, sections: ['production'], expires_at: new Date(Date.now() + 2500).toISOString(), recipients: ['someone@example.test'] });
  await api(request, 'someone@example.test').get(`/api/s/${s2.path.slice(3)}`);
  await api(request, 'other@example.test').get(`/api/s/${s2.path.slice(3)}`, 403);
  await new Promise((r) => setTimeout(r, 3000));
  await api(request, 'someone@example.test').get(`/api/s/${s2.path.slice(3)}`, 410);
  await vctx.close(); await octx.close();
});

test('published plans, approved facts and the audit log are frozen at the database level', async ({ request }) => {
  const a = api(request);
  const D2 = '2026-11-10';
  const d = await a.post<{ id: string }>('/api/plans/draft', { date: D2, from: 'empty' });
  await a.post(`/api/plans/versions/${d.id}/publish`, {}, 400); // an empty plan cannot become the baseline
  const job = { id: 'j', line: 'L1', product: 'TOM', start: '2026-11-10T03:00:00.000Z', end: '2026-11-10T11:00:00.000Z', target: 1000000, unit: 'kg', crew: 5 };
  await a.put(`/api/plans/versions/${d.id}`, { data: { shift_start: '06:00', jobs: [job], sales: [] } });
  await a.post(`/api/plans/versions/${d.id}/publish`, {});
  await a.put(`/api/plans/versions/${d.id}`, { data: { shift_start: '06:00', jobs: [{ ...job, target: 1 }], sales: [] } }, 400);
  const r = await a.post<{ id: string }>('/api/plans/draft', { date: D2, from: 'current' });
  await a.post(`/api/plans/versions/${r.id}/publish`, {}, 400); // a revision needs an effective time and a reason
  // direct SQL against the local database: triggers refuse changes even outside the API
  const sql = (q: string) => { try { execSync(`npx wrangler d1 execute DB --local --persist-to .wrangler/e2e --command "${q}"`, { stdio: 'pipe' }); return 'ok'; } catch (e) { return String((e as { stderr?: Buffer }).stderr ?? e); } };
  expect(sql("UPDATE plan_versions SET data = '{}' WHERE status = 'published'")).toContain('frozen');
  expect(sql('UPDATE facts SET qty = qty + 1')).toContain('immutable');
  expect(sql('DELETE FROM facts')).toContain('no hard deletes');
  expect(sql("UPDATE audit_log SET actor = 'x'")).toContain('append-only');
  expect(sql('DELETE FROM audit_log')).toContain('append-only');
});
