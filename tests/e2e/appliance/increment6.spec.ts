import { expect, test, type Page } from '@playwright/test';
import { signIn, signOut, sql } from './helpers';

// Grading specs, AWETA maintenance/cleaning, spreadsheet import and accountability, driven through the screens on the DEMO
// appliance. Every value typed here is a synthetic test value; the read-backs use SQL only to check what the screens did.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('agri.locale', 'en'); } catch { /* preference only */ } });
});

async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
}

test('QA manager reviews S-07, runs an advisory grade check and approves the specification', async ({ page }) => {
  await signIn(page, 'demo.ph.qam');
  await page.goto('/ops/specs');
  await expect(page.getByRole('heading', { name: 'Grading specifications' })).toBeVisible();
  await expect(page.getByText('Awaiting QA approval (OD-43)').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Tomato', exact: true }).click();
  const check = page.getByRole('complementary', { name: 'Grade check' });
  await check.getByLabel('Colour stage').fill('4');
  await check.getByLabel('Weight (g)').fill('120');
  await check.getByRole('button', { name: 'Check grades' }).click();
  await expect(check.getByRole('status')).toContainText(/Meets|Does not meet|Boundary|QA review/);
  await page.getByLabel('Approval note').fill('Reviewed against S-07 (e2e test)');
  await page.getByRole('button', { name: 'Approve specification' }).click();
  await expect(page.getByText(/Approved \d/).first()).toBeVisible();
  expect(sql(`select state from public.ph_specs where code = 'S-07' and farm_id = (select id from public.farms where code = 'DEMO') and voided_at is null order by version_no desc limit 1`)).toBe('approved');
  await signOut(page);
});

test('Owner approves the cleaning schedule; maintenance records running hours', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await page.goto('/ops/maintenance');
  await expect(page.getByRole('heading', { name: 'Maintenance & cleaning' })).toBeVisible();
  const s09 = page.getByRole('region', { name: /^S-09/ });
  await s09.getByLabel('Approval note').fill('Cleaning schedule approved (e2e test)');
  await s09.getByRole('button', { name: 'Approve schedule' }).click();
  await expect(page.getByText(/Approved \d/).first()).toBeVisible();
  expect(sql(`select state from public.ph_pm_plans where code = 'S-09' and farm_id = (select id from public.farms where code = 'DEMO') and voided_at is null`)).toBe('approved');
  await signOut(page);

  await signIn(page, 'demo.ph.mnt');
  await page.goto('/ops/maintenance');
  const before = Number(sql(`select coalesce(max(hours), 0) from public.ph_pm_meter where farm_id = (select id from public.farms where code = 'DEMO') and voided_at is null`));
  await page.getByLabel('Hour meter now').fill(String(before + 12.5));
  await page.getByRole('button', { name: 'Save reading' }).click();
  await expect(page.getByText(/Read /)).toBeVisible();
  expect(Number(sql(`select max(hours) from public.ph_pm_meter where farm_id = (select id from public.farms where code = 'DEMO') and voided_at is null`))).toBe(before + 12.5);
  await page.getByLabel('Hour meter now').fill(String(before));
  await page.getByRole('button', { name: 'Save reading' }).click();
  await expect(page.getByText('The hour meter cannot go below the last reading.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await signOut(page);
});

test('Import offers only tables the person may edit; the Owner imports causes and refused rows wait in the queue', async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  await signIn(page, 'demo.ph.phm'); // import.run, but no master-data edit right
  await page.goto('/ops/settings/import');
  await expect(page.getByText(/nothing you can import/)).toBeVisible();
  await expect(page.getByLabel('File (.csv or .xlsx)')).toHaveCount(0);
  await signOut(page);
  await signIn(page, 'demo.owner');
  await page.goto('/ops/settings/import');
  await page.getByRole('tab', { name: /Downtime causes|causes/i }).click();
  const csv = `code,name_ar,name_en,category\nT${stamp}A,سبب تجريبي أ,Test cause A,test\nT${stamp}B,سبب تجريبي ب,Test cause B,test\nT${stamp}A,مكرر,Duplicate,test\n`;
  await page.getByLabel('File (.csv or .xlsx)').setInputFiles({ name: 'causes-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/3 rows read from causes-test.csv/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 3 rows' }).click();
  await expect(page.getByText('2 saved, 0 already existed, 1 sent to the exception queue.')).toBeVisible();
  expect(sql(`select string_agg(verification_status::text, ',' order by code) from public.ph_downtime_causes where code like 'T${stamp}%'`)).toBe('not_yet_verified,not_yet_verified');
  expect(sql(`select count(*) from public.ph_downtime_causes where code like 'T${stamp}%' and voided_at is null`)).toBe('2');
  const queue = page.locator('li').filter({ hasText: 'Duplicate code in the file' }).filter({ hasText: `T${stamp}A` }).first();
  await queue.getByLabel('Reason to dismiss').fill('Duplicate row in the test file');
  await queue.getByRole('button', { name: 'Dismiss' }).click();
  await expect.poll(() => sql(`select count(*) from public.ph_import_exceptions e join public.ph_import_batches b on b.id = e.batch_id where b.file_name = 'causes-test.csv' and e.data ->> 'code' like 'T${stamp}%' and e.resolved_at is null`)).toBe('0');
  await signOut(page);
});

test('Accountability stays a draft until the Owner decides the scope; then the manager records a warning', async ({ page }) => {
  await signIn(page, 'demo.ph.phm');
  await page.goto('/ops/settings/accountability');
  await expect(page.getByText('Draft — not in force')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Put the policy in force' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Record a violation' })).toHaveCount(0);
  await signOut(page);

  await signIn(page, 'demo.owner');
  await page.goto('/ops/settings/accountability');
  await page.getByLabel('Line supervisors').check();
  await page.getByLabel('Decision note').fill('Scope for the demo farm (e2e test)');
  await page.getByRole('button', { name: 'Put the policy in force' }).click();
  await expect(page.getByText(/^In force since .* Line supervisors$/)).toBeVisible();
  await signOut(page);

  await signIn(page, 'demo.ph.phm');
  await page.goto('/ops/settings/accountability');
  const person = page.getByLabel('Person');
  await expect(person.locator('option')).toHaveCount(4); // placeholder + the three demo line supervisors
  await person.selectOption({ index: 1 });
  await page.getByLabel('What happened').fill('Late shift report (e2e test)');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/Verbal warning \(#\d+\)/)).toBeVisible();
  await expect(page.getByText('Late shift report (e2e test)')).toBeVisible();
  await signOut(page);
});
