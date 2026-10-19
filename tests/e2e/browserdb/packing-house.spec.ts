import { expect, test, type Locator, type Page } from '@playwright/test';

// In-browser demo: every step goes through the UI and the real database rules running in the browser (PGlite).
// One pallet travels receiving → G1 → registration → G2 → pre-cooling → QA acceptance (G3) → storage → QC-1 (G4),
// each step by the role that owns it, and the roles that do not own a step see why it is unavailable.

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date());
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function signInAs(page: Page, email: string) {
  // Signing out keeps the demo database in this browser; only the session goes.
  await page.evaluate(() => localStorage.removeItem('agri.auth')).catch(() => undefined);
  await page.goto('/');
  await page.getByText(email, { exact: true }).click({ timeout: 120_000 });
  await page.waitForURL(/#\/office/);
}

async function selectContaining(select: Locator, text: string) {
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
  if (!value) throw new Error(`no option containing ${text}`);
  await select.selectOption(value);
}

async function openPallet(page: Page, code: string) {
  await page.goto(`/#/office/packing-house/trace?ref=${code}`);
  await page.getByRole('link', { name: code }).click();
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
}

const actions = (page: Page) => page.getByRole('complementary', { name: 'الإجراءات' });
const statusOf = (page: Page) => page.locator('h1').locator('xpath=..');

async function okAll(scope: Locator) {
  for (const ok of await scope.getByRole('radio', { name: 'مطابق', exact: true }).all()) await ok.click();
}

test('one pallet from arrival to QC-1 release, each step by its own role, kept across reloads', async ({ page }) => {
  const plate = `WEB-${Date.now()}`;

  // ST-01 / G1 / ST-02 — receiving clerk (DEC).
  await signInAs(page, 'demo.ph.dec@demo.local');
  await expect(page).toHaveURL(/#\/office\/packing-house$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: '＋ وصول جديد' }).click();
  await selectContaining(page.getByLabel('المصدر (القطاع'), 'DEMO-B1S01');
  await selectContaining(page.getByLabel('الصنف'), 'cherry_tomato');
  await page.getByLabel('تاريخ الحصاد').fill(today());
  await page.getByLabel('وقت الحصاد').fill('06:00');
  await page.getByLabel('مشرف الحصاد').fill('مشرف اختبار');
  await page.getByLabel('لوحة المركبة').fill(plate);
  await page.getByLabel('اسم السائق').fill('سائق اختبار');
  await page.getByLabel('سبب التأخر').fill('اختبار آلي');
  await page.getByRole('button', { name: 'إنشاء الوصول' }).click();

  const arrival = page.getByRole('article').filter({ hasText: plate });
  await arrival.getByRole('button', { name: 'فحص المركبة' }).click();
  await okAll(arrival);
  await arrival.getByRole('radio', { name: 'ناجح' }).click();
  await arrival.getByRole('button', { name: 'تسجيل الفحص' }).click();
  await arrival.getByRole('button', { name: 'اجتياز البوابة (G1)' }).click();
  await arrival.getByRole('button', { name: 'تسجيل طبلية' }).click();
  await arrival.getByLabel('الوزن الصافي (كغ)').fill('401.5');
  await arrival.getByLabel('الميزان').selectOption({ index: 1 });
  await arrival.getByRole('button', { name: 'تسجيل', exact: true }).click();
  const registered = arrival.getByRole('status').filter({ hasText: 'سُجلت للتو' });
  await expect(registered).toBeVisible();
  const code = /[A-Z]{2}-\d{6}-[A-Z0-9-]+-\d{3}/.exec(await registered.innerText())?.[0];
  if (!code) throw new Error('no pallet code shown');

  // DEC cannot do the arrival check; the record says who can.
  await openPallet(page, code);
  await expect(statusOf(page)).toContainText('مسجلة');
  await expect(actions(page)).toContainText('لا يملك أي من أدوارك هذا الإجراء');
  await expect(actions(page)).toContainText('QCI');

  // G2 — QC inspector.
  await signInAs(page, 'demo.ph.qci@demo.local');
  await openPallet(page, code);
  await actions(page).getByRole('button', { name: 'فحص الوصول (G2)' }).click();
  await okAll(page.locator('form'));
  await page.locator('form').getByRole('button', { name: 'ناجح' }).click();
  await page.getByRole('button', { name: 'تسجيل فحص الوصول' }).click();
  await expect(page.locator('#ph-quality')).toContainText(/ARC-\d{6}-\d{4}/);

  // ST-04 — packing-house operator, pre-cooling in and out.
  await signInAs(page, 'demo.ph.pho@demo.local');
  await openPallet(page, code);
  await actions(page).getByRole('button', { name: 'دخول التبريد' }).click();
  await expect(statusOf(page)).toContainText('في التبريد الأولي');
  await actions(page).getByRole('button', { name: 'خروج من التبريد' }).click();
  await expect(statusOf(page)).toContainText('بانتظار ضمان الجودة');

  // G3 — QA officer accepts with a photo (V-23); the lot follows the demo assumption for OD-02.
  await signInAs(page, 'demo.ph.qao@demo.local');
  await openPallet(page, code);
  await actions(page).getByRole('button', { name: 'قبول ضمان الجودة (RMA)' }).click();
  const rma = page.locator('form');
  await okAll(rma);
  await rma.getByRole('radio', { name: 'قبول' }).click();
  await rma.locator('input[type=file]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: PNG });
  await rma.getByRole('button', { name: 'تسجيل قرار ضمان الجودة' }).click();
  await expect(statusOf(page)).toContainText('مقبولة');

  // ST-06 — operator stores it in the fridge of its storage group.
  await signInAs(page, 'demo.ph.pho@demo.local');
  await openPallet(page, code);
  await actions(page).getByRole('button', { name: 'نقل' }).click();
  await selectContaining(page.getByLabel('إلى الموقع'), 'HF');
  await page.locator('form').getByRole('button', { name: 'نقل' }).click();
  await expect(statusOf(page)).toContainText('مخزنة');

  // G4 — QC-1 release by the QC inspector.
  await signInAs(page, 'demo.ph.qci@demo.local');
  await openPallet(page, code);
  await actions(page).getByRole('button', { name: 'إفراج QC-1' }).click();
  await okAll(page.locator('form'));
  await page.locator('form').getByRole('button', { name: 'إفراج' }).click();
  await expect(statusOf(page)).toContainText('مُفرج عنها للإنتاج');
  await expect(page.locator('#ph-history')).toContainText('مُفرج عنها للإنتاج');

  // Kept in this browser: a reload starts the database from the device and shows the same record.
  await page.reload();
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible({ timeout: 120_000 });
  await expect(statusOf(page)).toContainText('مُفرج عنها للإنتاج');
});

test('board counts, English, and an auditor who can only read', async ({ page }) => {
  await signInAs(page, 'demo.ph.aud@demo.local');
  const nav = page.getByRole('navigation', { name: 'مراحل سير العمل' });
  await expect(nav.getByRole('button', { name: /الوصول/ }).first()).toContainText(/\d/);
  await expect(page.getByRole('button', { name: '＋ وصول جديد' })).toHaveCount(0);
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Packing House' })).toBeVisible();
  await page.goto('/#/office/packing-house/decisions');
  await expect(page.getByText('OD-25')).toBeVisible();
});

test('inside a frame on another site (as the artifact host shows it): starts, signs in, hides print', async ({ page }) => {
  await page.goto('http://localhost:4176/host');
  const app = page.frameLocator('iframe[title=demo]');
  await app.getByText('demo.ph.phm@demo.local', { exact: true }).click({ timeout: 120_000 });
  const stages = app.getByRole('navigation', { name: 'مراحل سير العمل' });
  await stages.getByRole('button', { name: /التخزين/ }).click();
  await app.getByRole('link', { name: /السجل الكامل/ }).first().click();
  await expect(app.locator('h1')).toBeVisible();
  await expect(app.getByRole('button', { name: /طباعة السجل/ })).toHaveCount(0);
});
