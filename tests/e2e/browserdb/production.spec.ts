import { expect, test, type Locator, type Page } from '@playwright/test';

// In-browser demo, milestone M2.1: a Job Card from plan to completion through the UI, each step by the role that owns
// it, against the real database rules running in the browser. A QC-1 released incoming pallet is issued in part (GEN-04),
// the line-start check fails and is corrected (T-09), QC-2 passes (G6), a finished pallet is weighed, labelled (V-09),
// stamped by QC and stored in a finished-goods fridge, the Job Card is completed (consumed + returned = issued) and the
// trace runs from the finished pallet back to the incoming pallet.

async function signInAs(page: Page, email: string) {
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

async function okAll(scope: Locator) {
  for (const ok of await scope.getByRole('radio', { name: 'مطابق', exact: true }).all()) await ok.click();
}

const actions = (page: Page) => page.getByRole('complementary', { name: 'الإجراءات' });
const form = (page: Page) => actions(page).locator('form');
const statusOf = (page: Page) => page.locator('h1').locator('xpath=..');

/** Opens a record view by its address (kept from when it was first opened) and waits for it. */
async function openRecord(page: Page, url: string, code: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
}
const hashOf = (page: Page) => `/${new URL(page.url()).hash}`;

/** Opens one action's form from the record's action list, once the previous form has closed. */
async function act(page: Page, name: string) {
  await expect(form(page)).toHaveCount(0);
  await actions(page).getByRole('button', { name, exact: true }).first().click();
  await expect(form(page)).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  // The label form opens the print dialog where printing is possible; the test has no printer.
  await page.addInitScript(() => { window.print = () => undefined; });
});

test('a Job Card from plan to finished goods in storage, each step by its own role', async ({ page }) => {
  // ST-08 plan — production engineer.
  await signInAs(page, 'demo.ph.pe@demo.local');
  await page.goto('/#/office/packing-house?stage=production');
  await page.getByRole('button', { name: '＋ بطاقة عمل جديدة' }).click();
  const create = page.getByRole('region', { name: 'بطاقة عمل جديدة' });
  await selectContaining(create.getByLabel('المحصول'), 'طماطم عادية');
  await selectContaining(create.getByRole('combobox', { name: /^الخط/ }), 'Aweta');
  await create.getByLabel('الدرجة المستهدفة').selectOption('gr1');
  await create.getByRole('button', { name: 'إنشاء بطاقة العمل' }).click();
  await expect(page.locator('h1')).toContainText(/JC-\d{6}-B-\d{2}/);
  const jc = /JC-\d{6}-B-\d{2}/.exec(await page.locator('h1').innerText())?.[0] as string;
  const jcUrl = hashOf(page);
  await expect(statusOf(page)).toContainText('مسودة');
  // The engineer cannot approve: the record says who can.
  await expect(actions(page)).toContainText('PHM');

  // Approval — packing-house manager.
  await signInAs(page, 'demo.ph.phm@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'اعتماد');
  await form(page).getByRole('button', { name: 'اعتماد' }).click();
  await expect(statusOf(page)).toContainText('مخطط');

  // Packaging — store keeper.
  await signInAs(page, 'demo.ph.stk@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'صرف مواد التعبئة');
  await form(page).getByLabel('مادة التعبئة').fill('كرتون اختبار');
  await form(page).getByLabel('الكمية (قطعة)').fill('40');
  await form(page).getByRole('button', { name: 'تسجيل صرف مواد التعبئة' }).click();
  await expect(page.locator('#jc-inputs')).toContainText('كرتون اختبار');

  // Inputs (V-05, partial issue) and Ready — line leader.
  await signInAs(page, 'demo.ph.ll@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'صرف طبلية');
  const pallet = form(page).getByLabel('الطبلية الواردة');
  await pallet.selectOption({ index: 1 });
  const ip = /[A-Z]{2}-\d{6}-[A-Z0-9-]+-\d{3}/.exec(await pallet.locator('option:checked').innerText())?.[0] as string;
  await form(page).getByLabel('كغ مصروفة').fill('300');
  await form(page).getByRole('button', { name: 'صرف', exact: true }).click();
  await expect(page.locator('#jc-inputs')).toContainText(ip);
  await act(page, 'جاهز للتشغيل');
  await form(page).getByRole('button', { name: 'جاهز للتشغيل' }).click();
  await expect(statusOf(page)).toContainText('جاهز');

  // G5 line start (T-09): QC records a fail, the line leader corrects, QC records a pass, the line leader confirms.
  await signInAs(page, 'demo.ph.qci@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'فحص بدء الخط (G5)');
  await form(page).getByRole('radio', { name: 'غير جاهز' }).click();
  await form(page).getByLabel('السبب').fill('بقايا على السير');
  await form(page).getByRole('button', { name: 'تسجيل فحص بدء الخط' }).click();
  await expect(statusOf(page)).toContainText('فشل فحص بدء الخط');
  await signInAs(page, 'demo.ph.ll@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'تم تصحيح الخط');
  await form(page).getByLabel('تعليق').fill('تم تنظيف السير');
  await form(page).getByRole('button', { name: 'تم تصحيح الخط' }).click();
  await expect(statusOf(page)).toContainText('جاهز');
  await signInAs(page, 'demo.ph.qci@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'فحص بدء الخط (G5)');
  await expect(form(page)).toContainText('AWETA');
  await okAll(form(page));
  await form(page).getByRole('radio', { name: 'الخط جاهز' }).click();
  await form(page).getByRole('button', { name: 'تسجيل فحص بدء الخط' }).click();
  // The recorder cannot also confirm (two people: QC + Line Leader).
  await expect(actions(page)).toContainText('الشخص الذي سجّل فحص بدء الخط');
  await signInAs(page, 'demo.ph.ll@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'تأكيد بدء الخط');
  await form(page).getByRole('button', { name: 'تأكيد بدء الخط' }).click();
  await expect(statusOf(page)).toContainText('قيد التشغيل');

  // G6 QC-2 final pass — QC inspector.
  await signInAs(page, 'demo.ph.qci@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'فحص QC-2');
  await form(page).getByRole('radio', { name: 'نهائي (نهاية التشغيل)' }).click();
  await okAll(form(page));
  await form(page).getByRole('radio', { name: 'مطابق', exact: true }).last().click();
  await form(page).getByRole('button', { name: 'تسجيل QC-2' }).click();
  await expect(page.locator('#jc-quality')).toContainText(/QC2-\d{6}-\d{4}/);

  // ST-10 finished pallet — operator weighs and labels it.
  await signInAs(page, 'demo.ph.pho@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'طبلية منتج نهائي');
  await form(page).getByLabel('عدد الصناديق').fill('28');
  await form(page).getByLabel('الوزن الصافي (كغ)').fill('280');
  await form(page).getByLabel('الميزان').selectOption({ index: 1 });
  await form(page).getByRole('button', { name: 'إنشاء طبلية منتج نهائي' }).click();
  const created = actions(page).getByRole('status').filter({ hasText: 'أُنشئت' });
  await expect(created).toContainText(/FGP-\d{6}-\d{5}/);
  const fg = /FGP-\d{6}-\d{5}/.exec(await created.innerText())?.[0] as string;
  await page.reload();
  await page.locator('#jc-output').getByRole('link', { name: fg }).click({ timeout: 120_000 });
  await expect(page.getByRole('heading', { name: new RegExp(fg) })).toBeVisible();
  const fgUrl = hashOf(page);
  await act(page, 'ملصق المنتج النهائي');
  await form(page).getByRole('button', { name: 'طباعة' }).click();
  await expect(page.locator('#ph-label')).toContainText(fg);

  // QC stamp (24 h validity), then storage in a finished-goods fridge.
  await signInAs(page, 'demo.ph.qci@demo.local');
  await openRecord(page, fgUrl, fg);
  await act(page, 'ختم الجودة');
  await form(page).getByRole('button', { name: 'ختم الجودة' }).click();
  await expect(statusOf(page)).toContainText('معتمدة من الجودة');
  await signInAs(page, 'demo.ph.pho@demo.local');
  await openRecord(page, fgUrl, fg);
  await act(page, 'نقل إلى ثلاجة المنتج النهائي');
  await selectContaining(form(page).getByLabel('إلى الموقع'), 'F1');
  await form(page).getByRole('button', { name: 'نقل' }).click();
  await expect(statusOf(page)).toContainText('في التخزين');

  // Completion — line leader: 290 kg consumed, 10 kg returned.
  await signInAs(page, 'demo.ph.ll@demo.local');
  await openRecord(page, jcUrl, jc);
  await act(page, 'إكمال');
  // Phone width: nothing on the record view is wider than the screen (no sideways page scroll).
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await form(page).getByLabel(`كغ مستهلكة ${ip}`).fill('290');
  await form(page).getByRole('button', { name: 'إكمال بطاقة العمل' }).click();
  await expect(statusOf(page)).toContainText('مكتمل');
  await expect(page.locator('#jc-inputs')).toContainText('290');

  // Trace from the finished pallet back to the incoming pallet, kept across a reload.
  await page.goto(`/#/office/packing-house/trace?ref=${fg}`);
  await expect(page.getByRole('link', { name: ip })).toBeVisible();
  await expect(page.getByRole('link', { name: jc })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: fg })).toBeVisible({ timeout: 120_000 });
});

test('the production board shows the demo Job Cards and finished pallets with live counts', async ({ page }) => {
  await signInAs(page, 'demo.ph.aud@demo.local');
  const nav = page.getByRole('navigation', { name: 'مراحل سير العمل' });
  await nav.getByRole('button', { name: /الإنتاج/ }).click();
  await expect(page.getByRole('article').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '＋ بطاقة عمل جديدة' })).toHaveCount(0);
  await nav.getByRole('button', { name: /تخزين المنتج النهائي/ }).click();
  await expect(page.getByRole('article').first()).toContainText('F1');
});
