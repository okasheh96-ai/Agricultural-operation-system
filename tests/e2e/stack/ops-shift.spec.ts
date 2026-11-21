import { expect, test, type Page } from '@playwright/test';
import { login, one, rpc } from './api';

// Packhouse operations increment 2 through the normal screens, against the real stack (demo farm only).
async function signInAs(page: Page, email: string) {
  await page.goto('/');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill('demo-password-123');
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(/\/(ops|office|field)/);
}

async function overviewPackedKg(email: string): Promise<number> {
  const s = await login(email);
  const ov = await rpc<{ totals: { packed_kg: string } }>(s, 'ph_ops_overview', {});
  return Number(ov.totals.packed_kg);
}

test('supervisor saves output on the phone; the overview total moves; a lost connection keeps the values and the retry saves once', async ({ page }) => {
  const before = await overviewPackedKg('demo.ph.phm@demo.local');
  await signInAs(page, 'demo.ph.lla@demo.local');
  await page.goto('/ops');
  await expect(page).toHaveURL(/\/ops\/shift/); // no KPI access → lands on the shift form
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A');

  // Choose a worker on the line, the 7 kg pack and enter 10 boxes.
  const worker = page.getByLabel('العامل');
  await worker.selectOption({ index: 1 });
  const packSelect = page.getByLabel('العبوة');
  await packSelect.selectOption((await packSelect.locator('option', { hasText: 'CTN-7KG' }).getAttribute('value')) ?? '');
  await page.locator('#ops-boxes').fill('10');
  await expect(page.getByText('= 70')).toBeVisible(); // review total 10 × 7 kg

  // Connection lost before the answer: the save fails, values stay, retry works and is saved once.
  let calls = 0;
  await page.route('**/rest/v1/rpc/ph_record_output', async (route) => {
    calls += 1;
    if (calls === 1) await route.abort('internetdisconnected');
    else await route.continue();
  });
  await page.getByRole('button', { name: /حفظ 70/ }).click();
  await expect(page.getByRole('alert')).toContainText('تعذّر الاتصال');
  await expect(page.locator('#ops-boxes')).toHaveValue('10');
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'حُفظ' })).toBeVisible();
  await expect(page.locator('#ops-boxes')).toHaveValue('');

  await expect.poll(() => overviewPackedKg('demo.ph.phm@demo.local')).toBeCloseTo(before + 70, 1);

  // No sideways scrolling at phone width; the primary action is a large touch target.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await page.getByRole('button', { name: /^حفظ/ }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('the same request id sent twice creates one record (double tap / retry after a lost answer)', async () => {
  const s = await login('demo.ph.lla@demo.local');
  const [ls] = await rpc<{ line_shift_id: string; line_code: string }[]>(s, 'ph_my_line_shifts', {});
  const sheet = await rpc<{ open: { worker_id: string }[] }>(s, 'ph_line_shift_sheet', { p_line_shift: ls?.line_shift_id });
  const pack = await one<{ id: string }>(s, 'ph_pack_formats?code=eq.CTN-7KG&select=id');
  const req = crypto.randomUUID();
  const body = { p: { line_shift_id: ls?.line_shift_id, worker_id: sheet.open[0]?.worker_id, grade: 'gr1', pack_format_id: pack.id, boxes: 2 }, p_request_id: req };
  const a = await rpc<{ id: string }>(s, 'ph_record_output', body);
  const b = await rpc<{ id: string; repeated: boolean }>(s, 'ph_record_output', body);
  expect(b.id).toBe(a.id);
  expect(b.repeated).toBe(true);
});

test('manager drills from an open stop to the stop log and comes back to the same filters', async ({ page }) => {
  await signInAs(page, 'demo.ph.phm@demo.local');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/ops');
  const lineFilter = page.getByLabel('الخط', { exact: true });
  await lineFilter.selectOption((await lineFilter.locator('option', { hasText: 'Aweta' }).getAttribute('value')) ?? ''); // line B has the open stop
  const url = page.url();
  expect(url).toContain('line=');
  await page.getByRole('link', { name: /DT-/ }).first().click();
  await expect(page).toHaveURL(/\/ops\/downtime\?.*stop=/);
  await expect(page.locator('li[id^="stop-"].ring-2')).toBeVisible(); // the stop opened from the overview is highlighted
  await page.goBack();
  await expect(page).toHaveURL(url);
  await expect(page.getByLabel('الخط', { exact: true })).not.toHaveValue('');
});

test('a line-B supervisor cannot read line A worker records through the API', async () => {
  const b = await login('demo.ph.llb@demo.local');
  const a = await login('demo.ph.lla@demo.local');
  const [lsA] = await rpc<{ line_shift_id: string }[]>(a, 'ph_my_line_shifts', {});
  await expect(rpc(b, 'ph_line_shift_sheet', { p_line_shift: lsA?.line_shift_id })).rejects.toThrow(/403|42501|P0403/);
});
