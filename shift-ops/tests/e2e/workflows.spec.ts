import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { as, api, seedRef, OWNER } from './helpers';
import { workbook } from './fixtures';

test.beforeAll(async ({ request }) => { await seedRef(request); });

test('real on-device OCR of a printed report; an unreadable value is left blank and flagged', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const DATE = '2026-11-07';
  const ctx = await as(browser, OWNER);
  // render a printed report (test fixture) and photograph it as PNG
  const shot = await ctx.newPage();
  await shot.setViewportSize({ width: 900, height: 420 });
  await shot.setContent(`<html><body style="margin:30px;background:#fff;font-family:Arial, sans-serif">
    <table style="border-collapse:separate;border-spacing:60px 18px;font-size:34px;color:#000">
      <tr><td>Line</td><td>Product</td><td>Time</td><td>Packed</td></tr>
      <tr><td>L2</td><td>TOM</td><td>09:00</td><td>1250</td></tr>
      <tr><td>L2</td><td>TOM</td><td>10:00</td><td><svg width="110" height="40"><path d="M2 30 C 20 0, 30 40, 50 12 S 80 38, 105 6" stroke="#000" stroke-width="7" fill="none"/><path d="M8 8 L 100 34" stroke="#000" stroke-width="5"/></svg></td></tr>
    </table></body></html>`);
  const png = join(process.cwd(), 'test-results', 'fixtures', 'printed-report.png');
  await shot.screenshot({ path: png });
  await shot.close();

  const page = await ctx.newPage();
  await page.goto('/import');
  await page.getByTestId('file-input').setInputFiles(png);
  await expect(page.getByText('Read. Low-confidence values')).toBeVisible({ timeout: 180_000 });
  const inspection = page.getByTestId('inspection');
  await expect(inspection).toContainText('1250');
  await expect(inspection).toContainText('09:00');
  await page.getByTestId('dataset').selectOption('production');
  // map: col 0 line, 1 product, 2 time, 3 packed kg
  await page.getByTestId('col-0-role').selectOption('reference'); await page.getByTestId('col-0-field').selectOption('line');
  await page.getByTestId('col-1-role').selectOption('reference'); await page.getByTestId('col-1-field').selectOption('product');
  await page.getByTestId('col-2-role').selectOption('reference'); await page.getByTestId('col-2-field').selectOption('time');
  await page.getByTestId('col-3-role').selectOption('actual'); await page.getByTestId('col-3-field').selectOption('measure');
  await page.getByTestId('col-3-metric').fill('qty'); await page.getByTestId('col-3-unit').selectOption('kg');
  await page.getByTestId('shift-date').fill(DATE);
  await page.getByTestId('stage').click();
  await expect(page.getByTestId('review')).toBeVisible();

  // row 1 printed value extracted beside its image region; row 2 unreadable -> blank and blocking
  await expect(page.getByTestId('row-0').getByTestId('val-m:qty')).toHaveText('1250');
  await expect(page.getByTestId('row-0').getByTestId('crop')).toBeVisible();
  const r2 = page.getByTestId('row-1');
  await expect(r2.getByTestId('val-m:qty')).toHaveText('∅');
  await expect(r2).toContainText(/Unreadable value|Uncertain reading|Missing field/);
  await expect(page.getByTestId('approve')).toBeDisabled();
  // any low-confidence printed value must be confirmed by the owner
  for (const b of await page.getByTestId('row-0').locator('[data-testid^="confirm-"]').all()) await b.click();
  // the owner reads the paper and types the value with a reason
  await page.getByTestId('edit-1-open').click();
  await page.getByTestId('edit-1-m:qty').fill('1300');
  await page.getByTestId('edit-1-reason').fill('Read from the paper sheet');
  await page.getByTestId('edit-1-save').click();
  for (const b of await page.locator('[data-testid^="row-"] [data-testid^="confirm-"]').all()) await b.click();
  await expect(page.getByTestId('approve')).toBeEnabled();
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('approved-ok')).toContainText('2 records published');
  // the private original is retrievable by the owner
  const f = await api(request).get<{ files: { id: string; name: string }[] }>('/api/files');
  const orig = f.files.find((x) => x.name === 'printed-report.png')!;
  const r = await request.get(`/api/files/${orig.id}`, { headers: { 'x-dev-email': OWNER } });
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toBe('image/png');
  await ctx.close();
});

test('interrupted import resumes; a revised workbook supersedes without double counting', async ({ browser, request }) => {
  const DATE = '2026-11-08';
  const rows = (bump: number) => [['Line', 'Product', 'Time', 'Packed kg'], ...Array.from({ length: 450 }, (_, i) => {
    const m = 6 * 60 + i;
    return ['L3', 'CUC', `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, i === 7 ? 10 + bump : 10];
  })];
  const v1 = await workbook('hourly-v1.xlsx', { Packing: rows(0) });
  const v2 = await workbook('hourly-v2.xlsx', { Packing: rows(5) });
  const ctx = await as(browser, OWNER);
  const page = await ctx.newPage();
  // break the connection after the first chunk of rows
  let calls = 0;
  await page.route('**/api/batches/*/rows', (route) => (++calls === 2 ? route.abort('connectionreset') : route.continue()));
  await page.goto('/import');
  await page.getByTestId('file-input').setInputFiles(v1);
  await page.getByTestId('dataset').selectOption('production');
  await page.getByTestId('shift-date').fill(DATE);
  await page.getByTestId('stage').click();
  await expect(page.locator('.action .err')).toBeVisible();
  await page.unroute('**/api/batches/*/rows');
  // resume: pick the same file; only missing rows are sent
  await page.goto('/import');
  await expect(page.getByTestId('interrupted')).toContainText('200/450');
  await page.getByTestId('resume').click();
  await page.getByTestId('file-input').setInputFiles(v1);
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('batch-status')).toHaveText('Awaiting approval');
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('approved-ok')).toContainText('450 records');
  const a = api(request);
  const sum = async () => (await a.get(`/api/dashboard?date=${DATE}`)).packedByGrade.reduce((s: number, g: { kg: number }) => s + g.kg, 0);
  expect(await sum()).toBe(4500000);

  // revised workbook: one value changed; marked as a correction of the first batch
  await page.goto('/import');
  await page.getByTestId('file-input').setInputFiles(v2);
  await expect(page.locator('.notice', { hasText: 'saved mapping' })).toHaveCount(0);
  await page.getByTestId('dataset').selectOption('production');
  await page.getByTestId('shift-date').fill(DATE);
  const firstBatch = (await a.get<{ batches: { id: string; file_name: string }[] }>('/api/batches?status=approved')).batches.find((b) => b.file_name === 'hourly-v1.xlsx')!;
  await page.getByTestId('supersedes').selectOption(firstBatch.id);
  await page.getByTestId('stage').click();
  await expect(page.getByTestId('diff')).toContainText('Added 0 · Changed 1 · Removed 0 · Unchanged 449');
  await expect(page.getByTestId('diff')).toContainText('15 kg');
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('approved-ok')).toBeVisible();
  expect(await sum()).toBe(4505000);
  const list = await a.get<{ batches: { id: string; status: string }[] }>('/api/batches');
  expect(list.batches.find((b) => b.id === firstBatch.id)!.status).toBe('superseded');
  await ctx.close();
});
