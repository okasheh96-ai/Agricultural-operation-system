import { test, expect } from '@playwright/test';
import { copyFileSync } from 'node:fs';
import { as, api, nf, seedRef, OWNER } from './helpers';
import { workbook } from './fixtures';

test.beforeAll(async ({ request }) => { await seedRef(request); });

test('spec case 1: lot gap flagged, corrected, approved; re-import does not double count', async ({ browser, request }) => {
  const DATE = '2026-11-05';
  const file = await workbook('lot-report.xlsx', {
    Notes: [['Test fixture — not farm data']],
    Lots: [
      ['Lot', 'Line', 'Product', 'Received kg', 'Packed kg', 'Waste kg'],
      ['LOT-1', 'L1', 'TOM', 4100, 4000, 40],
      ['Total', null, null, 4100, 4000, 40],
    ],
  });
  const ctx = await as(browser, OWNER);
  const page = await ctx.newPage();
  await page.goto('/import');
  await page.getByTestId('file-input').setInputFiles(file);
  await page.getByTestId('sheet-1').click();
  await expect(page.getByTestId('inspection')).toContainText('1 rows · 1 subtotal rows excluded');
  await page.getByTestId('dataset').selectOption('mixed');
  // columns 3..5: Received -> receiving, Packed -> production, Waste -> waste (all kg, actual)
  for (const [col, ds] of [[3, 'receiving'], [4, 'production'], [5, 'waste']] as const) {
    await expect(page.getByTestId(`col-${col}-role`)).toHaveValue('actual');
    await expect(page.getByTestId(`col-${col}-unit`)).toHaveValue('kg');
    await page.getByTestId(`col-${col}-dataset`).selectOption(ds);
  }
  await page.getByTestId('shift-date').fill(DATE);
  await page.getByTestId('default-time').fill('14:00');
  await page.getByTestId('mapping-name').fill('Lot report v1');
  await page.getByTestId('stage').click();
  await expect(page.getByTestId('review')).toBeVisible();

  // closed lot: the 60 kg gap is flagged with expected, reported, difference and source cells
  await page.getByTestId('lot-toggle-LOT-1').click();
  const issues = page.getByTestId('batch-issues');
  await expect(issues).toContainText('Lot balance gap');
  await expect(issues).toContainText('Expected: 4100');
  await expect(issues).toContainText('Reported: 4040');
  await expect(issues).toContainText('Difference: 60');
  await expect(issues).toContainText('Lots!');
  await expect(page.getByTestId('approve')).toBeDisabled(); // needs acknowledgement or correction

  // correct waste to 100 kg with a reason; history keeps the edit
  await page.getByTestId('edit-0-open').click();
  await page.getByTestId('edit-0-m:waste.qty').fill('100');
  await page.getByTestId('edit-0-reason').fill('Scale re-read by supervisor');
  await page.getByTestId('edit-0-save').click();
  await expect(page.getByTestId('batch-issues')).toHaveCount(0);
  await expect(page.getByTestId('gap-LOT-1')).toHaveText('0');
  await expect(page.getByTestId('edit-history')).toContainText('Scale re-read by supervisor');
  await expect(page.getByTestId('edit-history')).toContainText('"40 kg"');
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('approved-ok')).toContainText('3 records published');

  // re-import the same report, renamed: flagged as duplicate and cannot be approved
  const renamed = file.replace('lot-report', 'lot-report-copy');
  copyFileSync(file, renamed);
  await page.goto('/import');
  await page.getByTestId('file-input').setInputFiles(renamed);
  await expect(page.getByTestId('dup-file')).toContainText('lot-report.xlsx');
  await page.getByTestId('sheet-1').click();
  await expect(page.locator('.notice', { hasText: 'saved mapping' })).toBeVisible();
  await page.getByTestId('shift-date').fill(DATE);
  await page.getByTestId('default-time').fill('14:00');
  await page.getByTestId('stage').click();
  await expect(page.getByTestId('batch-issues')).toContainText('Same file already approved');
  await expect(page.getByTestId('approve')).toBeDisabled();

  const d = await api(request).get(`/api/dashboard?date=${DATE}`);
  expect(d.packedByGrade.reduce((s: number, g: { kg: number }) => s + g.kg, 0)).toBe(4000000);
  expect(d.lots[0]).toMatchObject({ lot: 'LOT-1', input: 4100000, output: 4100000, gap: 0, flagged: false });
  await page.goto(`/?date=${DATE}`);
  await expect(page.getByTestId('lots-table')).toContainText(nf('en', 4000));
  await expect(page.getByTestId('k-waste-pct')).toContainText('2.4%');
  await ctx.close();
});

test('spec case 3: dispatch milestones and invoiced sales; re-imported invoice leaves the figure unchanged', async ({ browser, request }) => {
  const DATE = '2026-11-06';
  const a = api(request);
  const d = await a.post<{ id: string }>('/api/plans/draft', { date: DATE, from: 'empty' });
  const iso = (hm: string) => new Date(`${DATE}T${hm}:00+03:00`).toISOString();
  await a.put(`/api/plans/versions/${d.id}`, { data: { shift_start: '06:00', jobs: [], sales: [
    { id: 's-dispatch', period: 'day', period_start: DATE, basis: 'dispatch', measure: 'qty', unit: 'pallet', target: 10000, milestones: [{ at: iso('10:00'), cumulative: 4000 }, { at: iso('16:00'), cumulative: 10000 }] },
    { id: 's-invoiced', period: 'day', period_start: DATE, basis: 'invoiced', measure: 'value', unit: 'JOD', target: 2000000, milestones: [{ at: iso('12:00'), cumulative: 800000 }] },
  ] } });
  await a.post(`/api/plans/versions/${d.id}/publish`, {});
  const ctx = await as(browser, OWNER);
  const page = await ctx.newPage();
  const importCsv = async (name: string, csv: string, dataset: string) => {
    await page.goto('/import');
    await page.getByTestId('file-input').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByTestId('dataset').selectOption(dataset);
    await page.getByTestId('shift-date').fill(DATE);
    return page;
  };
  // three pallets shipped
  await importCsv('dispatch.csv', 'Customer,Order,Product,Time,Pallets\nCUST-A,PO-1,TOM,08:00,1\nCUST-A,PO-1,TOM,09:00,1\nCUST-A,PO-2,TOM,09:30,1\n', 'dispatch');
  await page.getByTestId('col-4-unit').selectOption('pallet');
  await page.getByTestId('stage').click();
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('approved-ok')).toBeVisible();
  // invoice 650 and a credit of 50
  const invoice = 'Invoice No,Customer,Amount JOD\nINV-100,CUST-A,650\n';
  await importCsv('invoice.csv', invoice, 'invoice');
  await page.getByTestId('col-0-field').selectOption('doc_no');
  await page.getByTestId('col-2-metric').fill('value');
  await page.getByTestId('stage').click();
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('approved-ok')).toBeVisible();
  await importCsv('credit.csv', 'Credit No,Invoice,Customer,Amount JOD\nCR-7,INV-100,CUST-A,50\n', 'credit');
  await page.getByTestId('col-0-field').selectOption('doc_no');
  await page.getByTestId('col-1-role').selectOption('reference');
  await page.getByTestId('col-1-field').selectOption('ref_doc_no');
  await page.getByTestId('col-3-metric').fill('value');
  await page.getByTestId('stage').click();
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('approved-ok')).toBeVisible();

  await page.goto(`/?date=${DATE}&now=${new Date(`${DATE}T13:00:00+03:00`).toISOString()}`);
  const disp = page.getByTestId('sales-dispatch');
  await expect(disp.getByTestId('s-due')).toContainText('4');
  await expect(disp.getByTestId('s-actual')).toContainText('3');
  await expect(disp.getByTestId('s-variance')).toContainText('−1');
  await expect(disp.getByTestId('s-remaining')).toContainText('7');
  await expect(disp.locator('[data-status="behind"]')).toBeVisible();
  const inv = page.getByTestId('sales-invoiced');
  await expect(inv.getByTestId('s-actual')).toContainText('600');
  await expect(inv.getByTestId('s-due')).toContainText('800');
  await expect(inv.getByTestId('s-variance')).toContainText('−200');

  // re-import the same invoice with a different file name: blocked as already approved
  await importCsv('invoice (1).csv', invoice, 'invoice');
  await page.getByTestId('col-0-field').selectOption('doc_no');
  await page.getByTestId('col-2-metric').fill('value');
  await page.getByTestId('stage').click();
  await expect(page.getByTestId('batch-issues')).toContainText('Same file already approved');
  await expect(page.getByTestId('row-0')).toContainText('Already approved (duplicate)');
  await expect(page.getByTestId('approve')).toBeDisabled();
  const dash = await a.get(`/api/dashboard?date=${DATE}&now=${new Date(`${DATE}T13:00:00+03:00`).toISOString()}`);
  const s = dash.sales.find((x: { id: string }) => x.id === 's-invoiced');
  expect(s).toMatchObject({ actual: 600000, due: 800000, variance: -200000 });
  await ctx.close();
});
