import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { as, api, seedRef, stage, OWNER } from './helpers';

test('backup of D1 and originals, restore rehearsal into an isolated database, portable export', async ({ browser, request }) => {
  await seedRef(request);
  const a = api(request);
  const id = await stage(request, { dataset: 'waste', shift_date: '2026-11-11', rows: [{ dims: { lot: 'LOT-B' }, measures: [{ metric: 'qty', value: '12.5', unit: 'kg', role: 'actual' }] }] });
  await a.post(`/api/batches/${id}/approve`, {});
  // an original file to back up (test fixture)
  const buf = Buffer.from('Line,Product,Time,Packed\nL1,TOM,08:00,5\n');
  const up = await request.post('/api/files', { headers: { 'x-dev-email': OWNER, 'x-requested-with': 'shift-ops', 'content-type': 'text/csv', 'x-file-name': 'backup-test.csv' }, data: buf });
  expect(up.status()).toBe(200);
  const sha = createHash('sha256').update(buf).digest('hex');
  expect((await up.json()).sha256).toBe(sha);

  const ctx = await as(browser, OWNER);
  const page = await ctx.newPage();
  await page.goto('/settings/backup');
  await expect(page.getByTestId('backup-last')).toContainText('No backup has succeeded yet');
  await page.getByTestId('backup-run').click();
  await expect(page.getByTestId('backup-last')).not.toContainText('No backup', { timeout: 30_000 });
  await page.getByTestId('rehearse').click();
  await expect(page.getByTestId('rehearse-result')).toContainText('Restore passed', { timeout: 60_000 });
  await expect(page.getByTestId('rehearse-result')).toContainText('facts');

  // the isolated restore destination really holds the records; live data is untouched
  const runs = await a.get<{ tests: { status: string; report: string }[] }>('/api/backups');
  const rep = JSON.parse(runs.tests[0].report) as { tables: { name: string; rows: number; restored: number; hashOk: boolean }[]; files: { sha256: string; ok: boolean }[] };
  expect(rep.tables.find((t) => t.name === 'facts')!.restored).toBeGreaterThan(0);
  expect(rep.tables.every((t) => t.hashOk)).toBe(true);
  expect(rep.files.find((f) => f.sha256 === sha)?.ok).toBe(true);

  // portable export from the browser, with originals
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download full export with originals' }).click();
  const file = await (await dl).path();
  const z = unzipSync(new Uint8Array(readFileSync(file)));
  const manifest = JSON.parse(strFromU8(z['manifest.json']));
  expect(manifest.tables.find((t: { name: string }) => t.name === 'facts').rows).toBeGreaterThan(0);
  expect(strFromU8(z['approved_facts.csv'])).toContain('LOT-B');
  const orig = Object.keys(z).find((k) => k.startsWith('originals/') && k.endsWith('backup-test.csv'))!;
  expect(createHash('sha256').update(z[orig]).digest('hex')).toBe(sha);
  expect(strFromU8(z['schema.sql'])).toContain('CREATE TRIGGER facts_immutable');
  await ctx.close();
});
