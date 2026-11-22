// A full owner shift on an iPhone-sized screen in Arabic (RTL): plan, publish, timestamped updates, live figures,
// a mid-shift revision. Spec case 2 numbers are checked on screen.
import { test, expect, devices } from '@playwright/test';
import { as, nf, pf, noHorizontalOverflow, seedRef, OWNER } from './helpers';

const DATE = '2026-11-02';
const NOW = '2026-11-02T07:20:00.000Z'; // 10:20 Amman

test('owner runs a shift from an iPhone in Arabic', async ({ browser, request }) => {
  await seedRef(request);
  const ctx = await as(browser, OWNER, { ...devices['iPhone 13'] }, 'ar');
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('guide')).toBeVisible();
  await expect(page.getByTestId('guide')).toContainText('دليل الاستخدام السريع');
  await page.getByTestId('guide-dismiss').click();
  await noHorizontalOverflow(page);

  // ---- plan: 8,000 kg evenly over 06:00–14:00 with 20 workers
  await page.getByTestId('nav-nav_plan').click();
  await page.getByTestId('plan-date').fill(DATE);
  await page.getByTestId('plan-new-empty').click();
  await expect(page.getByTestId('plan-editor')).toBeVisible();
  await page.getByTestId('plan-shift-start').fill('06:00');
  await page.getByTestId('add-job').click();
  await page.getByTestId('job-0-line').selectOption('L1');
  await page.getByTestId('job-0-product').selectOption('TOM');
  await page.getByTestId('job-0-start').fill('06:00');
  await page.getByTestId('job-0-end').fill('14:00');
  await page.getByTestId('job-0-target').fill('8000');
  await page.getByTestId('job-0-unit').selectOption('kg');
  await page.getByTestId('job-0-crew').fill('20');
  await expect(page.getByTestId('job-0-calc')).toContainText(nf('ar', 160));
  await expect(page.getByTestId('job-0-calc')).toContainText(nf('ar', 50, 2));
  await noHorizontalOverflow(page);
  await page.getByTestId('plan-publish').click();
  await expect(page.getByTestId('version-1')).toContainText('منشورة');

  // ---- timestamped updates from the phone
  await page.getByTestId('nav-nav_today').click();
  await page.goto(`/?date=${DATE}&now=${NOW}`);
  await page.getByTestId('quick-open').click();
  await page.getByTestId('q-line').selectOption('L1');
  await page.getByTestId('q-product').selectOption('TOM');
  await page.getByTestId('q-qty').fill('3600');
  await page.getByTestId('q-time').fill('10:00');
  await page.getByTestId('q-approve').click();
  await expect(page.getByTestId('quick-form')).toBeHidden();
  await page.getByTestId('quick-open').click();
  await page.getByTestId('q-dataset').selectOption('labour');
  await page.getByTestId('q-line').selectOption('L1');
  await page.getByTestId('q-qty').fill('20');
  await page.getByTestId('q-start').fill('06:00');
  await page.getByTestId('q-end').fill('10:00');
  await page.getByTestId('q-approve').click();
  await expect(page.getByTestId('quick-form')).toBeHidden();

  // ---- spec case 2 on screen
  const line = page.getByTestId('line-L1');
  await expect(line.getByTestId('k-actual')).toContainText(nf('ar', 3600));
  await expect(line.getByTestId('k-due')).toContainText(nf('ar', 4000));
  await expect(line.getByTestId('k-variance')).toContainText(`−${nf('ar', 400)}`);
  await expect(line.getByTestId('k-pct-full')).toContainText(pf('ar', 0.45));
  await expect(line.getByTestId('k-pct-due')).toContainText(pf('ar', 0.9));
  await expect(line.getByTestId('k-remaining')).toContainText(nf('ar', 4400));
  await expect(line.getByTestId('k-pace')).toContainText(nf('ar', 1100, 1));
  await expect(line.locator('[data-status="behind"]')).toBeVisible();
  await expect(page.getByTestId('k-rate-actual')).toContainText(nf('ar', 45, 2));
  await expect(page.getByTestId('k-rate-planned')).toContainText(nf('ar', 50, 2));
  await expect(page.getByTestId('k-wh-actual')).toContainText(nf('ar', 80));
  await expect(page.getByTestId('k-wh-planned')).toContainText(nf('ar', 160));
  await expect(page.getByTestId('last-reading')).toContainText('10:00'.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]));
  await noHorizontalOverflow(page);

  // drill-down from the KPI to the approved row
  await line.getByTestId('k-actual').click();
  await expect(page.getByTestId('fact-table')).toContainText(nf('ar', 3600));
  await page.keyboard.press('Escape');

  // ---- mid-shift revision: 9,000 kg from 10:00, reason recorded; both versions kept
  await page.getByTestId('nav-nav_plan').click();
  await page.goto(`/plan?date=${DATE}`);
  await page.getByTestId('plan-revise').click();
  await page.getByTestId('job-0-target').fill('9000');
  await page.getByTestId('plan-eff').fill(`${DATE}T10:00`);
  await page.getByTestId('plan-reason').fill('طلبية إضافية من العميل');
  await page.getByTestId('plan-publish').click();
  await expect(page.getByTestId('version-2')).toContainText('طلبية إضافية');
  await page.getByTestId('plan-compare').click();
  await expect(page.getByTestId('plan-compare-table')).toContainText(nf('ar', 8000));
  await expect(page.getByTestId('plan-compare-table')).toContainText(nf('ar', 9000));

  // revised plan: what was due at 10:00 stays 4,000; original plan view still says 8,000 target
  await page.goto(`/?date=${DATE}&now=${NOW}`);
  await expect(page.getByTestId('line-L1').getByTestId('k-target')).toContainText(nf('ar', 9000));
  await expect(page.getByTestId('line-L1').getByTestId('k-due')).toContainText(nf('ar', 4000));
  await page.goto(`/?date=${DATE}&now=${NOW}&compare=baseline`);
  await expect(page.getByTestId('line-L1').getByTestId('k-target')).toContainText(nf('ar', 8000));

  // ---- fresh session: plan, approved figures and audit history persist
  const ctx2 = await as(browser, OWNER, { ...devices['iPhone 13'] }, 'ar');
  const p2 = await ctx2.newPage();
  await p2.goto(`/?date=${DATE}&now=${NOW}`);
  await expect(p2.getByTestId('line-L1').getByTestId('k-actual')).toContainText(nf('ar', 3600));
  await p2.goto('/settings/audit');
  await expect(p2.getByTestId('audit')).toContainText('publish_revision');
  await expect(p2.getByTestId('audit')).toContainText('approve');
  await ctx.close(); await ctx2.close();
});
