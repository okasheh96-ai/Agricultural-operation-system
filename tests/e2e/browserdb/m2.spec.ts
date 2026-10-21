import { expect, test, type Locator, type Page } from '@playwright/test';

// In-browser demo, milestone M2 (M2.2 + M2.3), through the UI against the real database rules running in the browser:
// waste from the QC label to disposal (V-16, V-17 with the labelled OD-11 demo assumption, SoD-03), the Job Card mass
// balance (MB-01: a variance with no approved tolerance needs an explanation), order lines (a refused save corrected and
// sent again, and a double tap that creates one line), a Job Card planned for an order line, and a finished pallet split
// approved by the manager and traced back through the split.

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

const actions = (page: Page) => page.getByRole('complementary', { name: 'الإجراءات' });
const form = (page: Page) => actions(page).locator('form');
const statusOf = (page: Page) => page.locator('h1').locator('xpath=..');
const hashOf = (page: Page) => `/${new URL(page.url()).hash}`;
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

async function openRecord(page: Page, url: string, code: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
}

async function act(page: Page, name: string) {
  await expect(form(page)).toHaveCount(0);
  await actions(page).getByRole('button', { name, exact: true }).first().click();
  await expect(form(page)).toHaveCount(1);
}

/** Opens a board tab and returns the record view address and code of the first panel matching the text. */
async function fromBoard(page: Page, stage: string, hasText: string | RegExp, codePattern: RegExp) {
  await page.goto(`/#/office/packing-house?stage=${stage}`);
  const panel = page.getByRole('article').filter({ hasText }).first();
  await expect(panel).toBeVisible({ timeout: 120_000 });
  const code = codePattern.exec(await panel.getByRole('heading').first().innerText())?.[0] as string;
  await panel.getByRole('link', { name: /السجل الكامل/ }).click();
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  return { code, url: hashOf(page) };
}

test('waste from the QC label to disposal, and the Job Card mass balance to closing', async ({ page }) => {
  // G7: QC labels the waste waiting on the board.
  await signInAs(page, 'demo.ph.qci@demo.local');
  const w1 = await fromBoard(page, 'waste', 'بانتظار الجودة', /WR-\d{6}-\d{4}/);
  await expect(page.getByText('ملصق الجودة', { exact: true }).first()).toBeVisible();
  // V-16: nobody weighs before the label (the weigh step is not offered to QC, and the record view says why).
  await act(page, 'ملصق هدر الجودة (G7)');
  await form(page).getByRole('radio', { name: 'اعتماد الملصق' }).click();
  await form(page).getByRole('button', { name: 'ملصق هدر الجودة (G7)' }).click();
  await expect(statusOf(page)).toContainText('اعتمدته الجودة');

  // The data entry clerk weighs it; with the OD-11 demo assumption it routes to the PHM (small).
  await signInAs(page, 'demo.ph.dec@demo.local');
  await openRecord(page, w1.url, w1.code);
  await act(page, 'وزن');
  await form(page).getByLabel('الوزن الصافي (كغ)').fill('6');
  await form(page).getByLabel('الميزان').selectOption({ index: 1 });
  await form(page).getByRole('button', { name: 'وزن' }).click();
  await expect(actions(page)).toContainText('تم الوزن: 6 كغ.');
  await actions(page).getByRole('button', { name: 'تم الحفظ.' }).click();
  await expect(statusOf(page)).toContainText('بانتظار التوقيعات');
  await expect(page.getByText('صغير: يوقّع مدير بيت التعبئة').first()).toBeVisible();
  // The clerk who weighed it cannot sign it (no sign-off cell; SoD-03 would refuse the weigher anyway).
  await expect(actions(page).getByRole('button', { name: 'توقيع', exact: true })).toBeDisabled();
  await noSideScroll(page);

  // The line leader completes the running cherry Job Card: 295 kg consumed, 5 kg returned.
  await signInAs(page, 'demo.ph.ll@demo.local');
  const jc = await fromBoard(page, 'production', 'قيد التشغيل', /JC-\d{6}-A-\d{2}/);
  const ip = (await page.locator('#jc-inputs').getByRole('link').first().innerText()).trim();
  await act(page, 'إكمال');
  await form(page).getByLabel(`كغ مستهلكة ${ip}`).fill('295');
  await form(page).getByRole('button', { name: 'إكمال بطاقة العمل' }).click();
  await expect(statusOf(page)).toContainText('مكتمل');

  // The manager signs the waste, then reconciles: 295 − 278.5 finished − 14.6 weighed waste = 1.9 kg, no approved tolerance.
  await signInAs(page, 'demo.ph.phm@demo.local');
  await openRecord(page, w1.url, w1.code);
  await act(page, 'توقيع');
  await form(page).getByRole('button', { name: 'توقيع' }).click();
  await expect(statusOf(page)).toContainText('مُوقّع');
  await openRecord(page, jc.url, jc.code);
  await expect(page.locator('#jc-balance')).toContainText('1.9 kg · 0.64 %');
  await expect(page.locator('#jc-balance')).toContainText('غير محدد (OD-28)');
  await act(page, 'المطابقة (MB-01)');
  // No approved tolerance (OD-28): the explanation is required (the server refuses without it too, pgTAP 17).
  await expect(form(page).getByLabel(/^تفسير الفرق/)).toHaveAttribute('required', '');
  await form(page).getByLabel(/^تفسير الفرق/).fill('فقد رطوبة أثناء التشغيل (اختبار)');
  await form(page).getByRole('button', { name: 'المطابقة (MB-01)' }).click();
  await expect(statusOf(page)).toContainText('تمت المطابقة');
  await expect(page.locator('#jc-balance')).toContainText('لا يوجد حد سماح (مع تفسير)');
  await act(page, 'إغلاق بطاقة العمل');
  await form(page).getByRole('button', { name: 'إغلاق بطاقة العمل' }).click();
  await expect(statusOf(page)).toContainText('مغلق');
  // Reopening waits on OD-15.
  await expect(actions(page)).toContainText('OD-15');

  // ERP reference and disposal — data entry clerk.
  await signInAs(page, 'demo.ph.dec@demo.local');
  await openRecord(page, w1.url, w1.code);
  await act(page, 'مرجع ERP');
  await form(page).getByLabel('مرجع ERP').fill('ERP-TEST-001');
  await form(page).getByRole('button', { name: 'مرجع ERP' }).click();
  await expect(actions(page)).toContainText('ERP-TEST-001');
  await actions(page).getByRole('button', { name: 'تم الحفظ.' }).click();
  await act(page, 'تم التخلص');
  await form(page).getByRole('button', { name: 'تم التخلص' }).click();
  await expect(statusOf(page)).toContainText('تم التخلص منه');

  // Large route: finance signs the long-storage waste; the other signatories are still listed.
  await signInAs(page, 'demo.ph.fin@demo.local');
  const w3 = await fromBoard(page, 'waste', 'تخزين طويل', /WR-\d{6}-\d{4}/);
  await act(page, 'توقيع');
  await form(page).getByRole('button', { name: 'توقيع' }).click();
  await expect(page.getByText(/بانتظار توقيع: .*QAM/).first()).toBeVisible();
  await expect(statusOf(page)).toContainText('بانتظار التوقيعات');
  await expect(page.locator('main')).toContainText(w3.code);
});

test('order lines, a Job Card for an order, and a finished pallet split approved by the manager', async ({ page }) => {
  // Sales enters an order line: a past date is refused, corrected and sent again; a double tap creates one line.
  await signInAs(page, 'demo.ph.sal@demo.local');
  await page.goto('/#/office/packing-house?stage=orders');
  await page.getByRole('button', { name: '＋ بند طلب جديد' }).click();
  const create = page.getByRole('region', { name: 'بند طلب جديد' });
  await create.getByLabel(/^العميل/).fill('عميل اختبار');
  await selectContaining(create.getByLabel('المحصول'), 'طماطم شيري');
  await create.getByLabel('الدرجة').selectOption('gr1');
  await create.getByLabel('مواصفة التعبئة').fill('علبة 500 غ');
  await create.getByLabel('الكمية').fill('250');
  await create.getByLabel('التاريخ المطلوب').fill('2020-01-01');
  await create.getByLabel('السوق').selectOption('local');
  await create.getByRole('button', { name: 'إدخال بند الطلب' }).click();
  await expect(create.getByRole('alert')).toContainText('التاريخ المطلوب في الماضي');
  const next = await page.evaluate(() => { const d = new Date(Date.now() + 3 * 864e5); return d.toISOString().slice(0, 10); });
  await create.getByLabel('التاريخ المطلوب').fill(next);
  await create.getByRole('button', { name: 'إدخال بند الطلب' }).dblclick();
  const line = page.getByRole('article').filter({ hasText: 'عميل اختبار' });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('بانتظار القبول');
  await noSideScroll(page);
  const ol = /OL-\d{6}-\d{4}/.exec(await line.getByRole('heading').innerText())?.[0] as string;

  // The manager accepts it.
  await signInAs(page, 'demo.ph.phm@demo.local');
  await page.goto('/#/office/packing-house?stage=orders');
  const forPhm = page.getByRole('article').filter({ hasText: 'عميل اختبار' });
  await forPhm.getByRole('button', { name: 'قبول / رفض' }).click();
  await forPhm.getByRole('radio', { name: 'قبول' }).click();
  await forPhm.locator('form').getByRole('button', { name: 'قبول / رفض' }).click();
  await expect(forPhm).toContainText('مقبول');

  // The production engineer plans a Job Card for it: crop and grade come from the line.
  await signInAs(page, 'demo.ph.pe@demo.local');
  await page.goto('/#/office/packing-house?stage=orders');
  const forPe = page.getByRole('article').filter({ hasText: 'عميل اختبار' });
  await forPe.getByRole('button', { name: 'تخطيط بطاقة عمل' }).click();
  await forPe.getByRole('combobox', { name: /^الخط/ }).selectOption({ index: 1 });
  await forPe.getByRole('button', { name: 'إنشاء بطاقة العمل' }).click();
  await expect(page.locator('h1')).toContainText(/JC-\d{6}-A-\d{2}/);
  await expect(page.locator('#jc-general')).toContainText(ol);
  await expect(page.locator('#jc-general')).toContainText('GR1');

  // The operator asks to split the stored demo pallet (50 boxes, 140.5 kg) in two.
  await signInAs(page, 'demo.ph.pho@demo.local');
  const fg = await fromBoard(page, 'fg_storage', 'F1', /FGP-\d{6}-\d{5}/);
  await act(page, 'تقسيم');
  await form(page).getByLabel('عدد الصناديق 1').fill('30');
  await form(page).getByLabel('الوزن الصافي (كغ) 1').fill('84.3');
  await form(page).getByLabel('عدد الصناديق 2').fill('20');
  await form(page).getByLabel('الوزن الصافي (كغ) 2').fill('56.2');
  await form(page).getByLabel(/^السبب/).fill('توصيلتان منفصلتان (اختبار)');
  await form(page).getByRole('button', { name: 'طلب التقسيم' }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(statusOf(page)).toContainText('في التخزين');
  await expect(actions(page)).toContainText('بانتظار الاعتماد');

  // The manager approves on the storage tab: the pallet closes, two new pallets keep F1 and the QC stamp.
  await signInAs(page, 'demo.ph.phm@demo.local');
  await page.goto('/#/office/packing-house?stage=fg_storage');
  const request = page.getByRole('region', { name: 'طلبات تقسيم / دمج بانتظار مدير بيت التعبئة' }).getByRole('article');
  await expect(request).toContainText(fg.code);
  await request.getByRole('button', { name: 'اتخاذ القرار' }).click();
  await request.getByRole('radio', { name: 'اعتماد' }).click();
  await request.locator('form').getByRole('button', { name: 'اتخاذ القرار' }).click();
  await expect(page.getByRole('region', { name: 'طلبات تقسيم / دمج بانتظار مدير بيت التعبئة' })).toHaveCount(0);
  await openRecord(page, fg.url, fg.code);
  await expect(statusOf(page)).toContainText('مقسومة / مدمجة');
  const children = page.locator('p', { hasText: 'أصبحت:' }).getByRole('link');
  await expect(children).toHaveCount(2);
  const child = (await children.first().innerText()).trim();

  // The trace of a new pallet passes through the split back to the original pallet and the incoming pallet.
  await page.goto(`/#/office/packing-house/trace?ref=${child}`);
  await expect(page.getByRole('link', { name: fg.code })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('ناتجة من:').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^[A-Z]{2}-\d{6}-[A-Z0-9-]+-\d{3}$/ }).first()).toBeVisible();
  await noSideScroll(page);

  // The daily plan lists the accepted order line and its planned Job Card.
  await page.goto('/#/office/packing-house/plan');
  await expect(page.getByText(ol).first()).toBeVisible({ timeout: 120_000 });
});
