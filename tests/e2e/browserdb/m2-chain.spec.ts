import { expect, test, type Locator, type Page } from '@playwright/test';

// The M2 closure walk-through (docs/packing-house/M2_CLOSURE_CHECKLIST.md §5) as one chain through the UI, each step by its
// role: order line → accepted → Job Card for it → G5 → QC-2 → finished pallet → label → QC stamp → FG fridge → split approved
// by the PHM → waste from the same Job Card (label, weigh, sign, ERP, disposal) → completion → MB-01 (98 − 90 − 6 = 2 kg,
// explanation required) → closed → trace from a split pallet back to the order line, Job Card, incoming pallet and waste.

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
const hashOf = (page: Page) => `/${new URL(page.url()).hash}`;

async function openRecord(page: Page, url: string, code: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
}

async function act(page: Page, name: string) {
  await expect(form(page)).toHaveCount(0);
  await actions(page).getByRole('button', { name, exact: true }).first().click();
  await expect(form(page)).toHaveCount(1);
}

async function as(page: Page, email: string, url: string, code: string) {
  await signInAs(page, email);
  await openRecord(page, url, code);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.print = () => undefined; });
});

test('the full M2 chain from an order line to a closed, reconciled Job Card and a traced split pallet', async ({ page }) => {
  test.setTimeout(600_000);
  // 1–2. Sales enters the order line; the manager accepts it.
  await signInAs(page, 'demo.ph.sal@demo.local');
  await page.goto('/#/office/packing-house?stage=orders');
  await page.getByRole('button', { name: '＋ بند طلب جديد' }).click();
  const create = page.getByRole('region', { name: 'بند طلب جديد' });
  await create.getByLabel(/^العميل/).fill('عميل سلسلة M2');
  await selectContaining(create.getByLabel('المحصول'), 'طماطم شيري');
  await create.getByLabel('الدرجة').selectOption('gr1');
  await create.getByLabel('مواصفة التعبئة').fill('علبة 250 غ');
  await create.getByLabel('الكمية').fill('100');
  await create.getByLabel('التاريخ المطلوب').fill(await page.evaluate(() => new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)));
  await create.getByLabel('السوق').selectOption('local');
  await create.getByRole('button', { name: 'إدخال بند الطلب' }).click();
  const line = page.getByRole('article').filter({ hasText: 'عميل سلسلة M2' });
  await expect(line).toContainText('بانتظار القبول');
  const ol = /OL-\d{6}-\d{4}/.exec(await line.getByRole('heading').innerText())?.[0] as string;
  await signInAs(page, 'demo.ph.phm@demo.local');
  await page.goto('/#/office/packing-house?stage=orders');
  const forPhm = page.getByRole('article').filter({ hasText: 'عميل سلسلة M2' });
  await forPhm.getByRole('button', { name: 'قبول / رفض' }).click();
  await forPhm.getByRole('radio', { name: 'قبول' }).click();
  await forPhm.locator('form').getByRole('button', { name: 'قبول / رفض' }).click();
  await expect(forPhm).toContainText('مقبول');

  // 3–4. The engineer plans the Job Card for it; the manager approves.
  await signInAs(page, 'demo.ph.pe@demo.local');
  await page.goto('/#/office/packing-house?stage=orders');
  const forPe = page.getByRole('article').filter({ hasText: 'عميل سلسلة M2' });
  await forPe.getByRole('button', { name: 'تخطيط بطاقة عمل' }).click();
  await forPe.getByRole('combobox', { name: /^الخط/ }).selectOption({ index: 1 });
  await forPe.getByRole('button', { name: 'إنشاء بطاقة العمل' }).click();
  await expect(page.locator('h1')).toContainText(/JC-\d{6}-A-\d{2}/);
  const jc = /JC-\d{6}-A-\d{2}/.exec(await page.locator('h1').innerText())?.[0] as string;
  const jcUrl = hashOf(page);
  await expect(page.locator('#jc-general')).toContainText(ol);
  await as(page, 'demo.ph.phm@demo.local', jcUrl, jc);
  await act(page, 'اعتماد');
  await form(page).getByRole('button', { name: 'اعتماد' }).click();
  await expect(statusOf(page)).toContainText('مخطط');

  // 5–6. Packaging (store keeper); 100 kg of a cherry pallet and Ready (line leader).
  await as(page, 'demo.ph.stk@demo.local', jcUrl, jc);
  await act(page, 'صرف مواد التعبئة');
  await form(page).getByLabel('مادة التعبئة').fill('علبة 250 غ');
  await form(page).getByLabel('الكمية (قطعة)').fill('400');
  await form(page).getByRole('button', { name: 'تسجيل صرف مواد التعبئة' }).click();
  await expect(page.locator('#jc-inputs')).toContainText('علبة 250 غ');
  await as(page, 'demo.ph.ll@demo.local', jcUrl, jc);
  await act(page, 'صرف طبلية');
  const pallet = form(page).getByLabel('الطبلية الواردة');
  await pallet.selectOption({ index: 1 });
  const ip = /[A-Z]{2}-\d{6}-[A-Z0-9-]+-\d{3}/.exec(await pallet.locator('option:checked').innerText())?.[0] as string;
  await form(page).getByLabel('كغ مصروفة').fill('100');
  await form(page).getByRole('button', { name: 'صرف', exact: true }).click();
  await expect(page.locator('#jc-inputs')).toContainText(ip);
  await act(page, 'جاهز للتشغيل');
  await form(page).getByRole('button', { name: 'جاهز للتشغيل' }).click();
  await expect(statusOf(page)).toContainText('جاهز');

  // 7–8. G5 (QC records, line leader confirms) and the QC-2 final pass.
  await as(page, 'demo.ph.qci@demo.local', jcUrl, jc);
  await act(page, 'فحص بدء الخط (G5)');
  await okAll(form(page));
  await form(page).getByRole('radio', { name: 'الخط جاهز' }).click();
  await form(page).getByRole('button', { name: 'تسجيل فحص بدء الخط' }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(actions(page)).toContainText('الشخص الذي سجّل فحص بدء الخط');
  await as(page, 'demo.ph.ll@demo.local', jcUrl, jc);
  await act(page, 'تأكيد بدء الخط');
  await form(page).getByRole('button', { name: 'تأكيد بدء الخط' }).click();
  await expect(statusOf(page)).toContainText('قيد التشغيل');
  await as(page, 'demo.ph.qci@demo.local', jcUrl, jc);
  await act(page, 'فحص QC-2');
  await form(page).getByRole('radio', { name: 'نهائي (نهاية التشغيل)' }).click();
  await okAll(form(page));
  await form(page).getByRole('radio', { name: 'مطابق', exact: true }).last().click();
  await form(page).getByRole('button', { name: 'تسجيل QC-2' }).click();
  await expect(page.locator('#jc-quality')).toContainText(/QC2-\d{6}-\d{4}/);

  // 9–10. Finished pallet 20 boxes / 90 kg, label, QC stamp, F1.
  await as(page, 'demo.ph.pho@demo.local', jcUrl, jc);
  await act(page, 'طبلية منتج نهائي');
  await form(page).getByLabel('عدد الصناديق').fill('20');
  await form(page).getByLabel('الوزن الصافي (كغ)').fill('90');
  await form(page).getByLabel('الميزان').selectOption({ index: 1 });
  await form(page).getByRole('button', { name: 'إنشاء طبلية منتج نهائي' }).click();
  const created = actions(page).getByRole('status').filter({ hasText: 'أُنشئت' });
  const fg = /FGP-\d{6}-\d{5}/.exec(await created.innerText())?.[0] as string;
  await page.reload();
  await page.locator('#jc-output').getByRole('link', { name: fg }).click({ timeout: 120_000 });
  await expect(page.getByRole('heading', { name: new RegExp(fg) })).toBeVisible();
  const fgUrl = hashOf(page);
  await act(page, 'ملصق المنتج النهائي');
  await form(page).getByRole('button', { name: 'طباعة' }).click();
  // The printed label shows the pallet; the customer and order line are in the printed content but not yet drawn on the label
  // (open defect, docs/packing-house/M2_CLOSURE_CHECKLIST.md §2).
  await expect(page.locator('#ph-label')).toContainText(fg);
  await actions(page).getByRole('button', { name: 'تم الحفظ.' }).click();
  await as(page, 'demo.ph.qci@demo.local', fgUrl, fg);
  await act(page, 'ختم الجودة');
  await form(page).getByRole('button', { name: 'ختم الجودة' }).click();
  await expect(statusOf(page)).toContainText('معتمدة من الجودة');
  await as(page, 'demo.ph.pho@demo.local', fgUrl, fg);
  await act(page, 'نقل إلى ثلاجة المنتج النهائي');
  await selectContaining(form(page).getByLabel('إلى الموقع'), 'F1');
  await form(page).getByRole('button', { name: 'نقل' }).click();
  await expect(statusOf(page)).toContainText('في التخزين');

  // 11. Split 10 / 45 + 10 / 45, approved by the manager (the requester cannot approve).
  await act(page, 'تقسيم');
  await form(page).getByLabel('عدد الصناديق 1').fill('10');
  await form(page).getByLabel('الوزن الصافي (كغ) 1').fill('45');
  await form(page).getByLabel('عدد الصناديق 2').fill('10');
  await form(page).getByLabel('الوزن الصافي (كغ) 2').fill('45');
  await form(page).getByLabel(/^السبب/).fill('توصيلتان');
  await form(page).getByRole('button', { name: 'طلب التقسيم' }).click();
  await expect(actions(page)).toContainText('بانتظار الاعتماد');
  await signInAs(page, 'demo.ph.phm@demo.local');
  await page.goto('/#/office/packing-house?stage=fg_storage');
  const request = page.getByRole('region', { name: 'طلبات تقسيم / دمج بانتظار مدير بيت التعبئة' }).getByRole('article').filter({ hasText: fg });
  await request.getByRole('button', { name: 'اتخاذ القرار' }).click();
  await request.getByRole('radio', { name: 'اعتماد' }).click();
  await request.locator('form').getByRole('button', { name: 'اتخاذ القرار' }).click();
  await expect(request).toHaveCount(0);
  await openRecord(page, fgUrl, fg);
  await expect(statusOf(page)).toContainText('مقسومة / مدمجة');
  const child = (await page.locator('p', { hasText: 'أصبحت:' }).getByRole('link').first().innerText()).trim();

  // 12. Waste from the Job Card: clerk records, QC labels, clerk weighs 6 kg, manager signs, clerk enters ERP and disposes.
  await as(page, 'demo.ph.dec@demo.local', jcUrl, jc);
  await act(page, 'تسجيل هدر');
  await form(page).getByLabel('الوزن المرجعي (كغ)').fill('6');
  await form(page).getByRole('button', { name: 'تسجيل وإرسال إلى الجودة' }).click();
  await expect(page.locator('#jc-balance').getByRole('link', { name: /WR-\d{6}-\d{4}/ })).toBeVisible();
  const wr = (await page.locator('#jc-balance').getByRole('link', { name: /WR-\d{6}-\d{4}/ }).innerText()).trim();
  await page.locator('#jc-balance').getByRole('link', { name: wr }).click();
  await expect(page.getByRole('heading', { name: new RegExp(wr) })).toBeVisible();
  const wrUrl = hashOf(page);
  await as(page, 'demo.ph.qci@demo.local', wrUrl, wr);
  await act(page, 'ملصق هدر الجودة (G7)');
  await form(page).getByRole('radio', { name: 'اعتماد الملصق' }).click();
  await form(page).getByRole('button', { name: 'ملصق هدر الجودة (G7)' }).click();
  await expect(statusOf(page)).toContainText('اعتمدته الجودة');
  await as(page, 'demo.ph.dec@demo.local', wrUrl, wr);
  await act(page, 'وزن');
  await form(page).getByLabel('الوزن الصافي (كغ)').fill('6');
  await form(page).getByLabel('الميزان').selectOption({ index: 1 });
  await form(page).getByRole('button', { name: 'وزن' }).click();
  await actions(page).getByRole('button', { name: 'تم الحفظ.' }).click();
  await expect(statusOf(page)).toContainText('بانتظار التوقيعات');
  await as(page, 'demo.ph.phm@demo.local', wrUrl, wr);
  await act(page, 'توقيع');
  await form(page).getByRole('button', { name: 'توقيع' }).click();
  await expect(statusOf(page)).toContainText('مُوقّع');
  await as(page, 'demo.ph.dec@demo.local', wrUrl, wr);
  await act(page, 'مرجع ERP');
  await form(page).getByLabel('مرجع ERP').fill('ERP-CHAIN-1');
  await form(page).getByRole('button', { name: 'مرجع ERP' }).click();
  await actions(page).getByRole('button', { name: 'تم الحفظ.' }).click();
  await act(page, 'تم التخلص');
  await form(page).getByRole('button', { name: 'تم التخلص' }).click();
  await expect(statusOf(page)).toContainText('تم التخلص منه');

  // 13–14. Completion 98 kg consumed; MB-01 2 kg needs an explanation; closed; reopen waits on OD-15.
  await as(page, 'demo.ph.ll@demo.local', jcUrl, jc);
  await act(page, 'إكمال');
  await form(page).getByLabel(`كغ مستهلكة ${ip}`).fill('98');
  await form(page).getByRole('button', { name: 'إكمال بطاقة العمل' }).click();
  await expect(statusOf(page)).toContainText('مكتمل');
  await as(page, 'demo.ph.phm@demo.local', jcUrl, jc);
  await expect(page.locator('#jc-balance')).toContainText('2 kg · 2.04 %');
  await act(page, 'المطابقة (MB-01)');
  await expect(form(page).getByLabel(/^تفسير الفرق/)).toHaveAttribute('required', '');
  await form(page).getByLabel(/^تفسير الفرق/).fill('فقد أثناء الفرز (اختبار)');
  await form(page).getByRole('button', { name: 'المطابقة (MB-01)' }).click();
  await expect(statusOf(page)).toContainText('تمت المطابقة');
  await act(page, 'إغلاق بطاقة العمل');
  await form(page).getByRole('button', { name: 'إغلاق بطاقة العمل' }).click();
  await expect(statusOf(page)).toContainText('مغلق');
  await expect(actions(page)).toContainText('OD-15');

  // 15. Trace from a split pallet: parent, Job Card with order line and customer, incoming pallet, waste.
  await page.goto(`/#/office/packing-house/trace?ref=${child}`);
  await expect(page.getByRole('link', { name: fg })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('link', { name: jc })).toBeVisible();
  await expect(page.getByText('عميل سلسلة M2').first()).toBeVisible();
  await expect(page.getByRole('link', { name: ip })).toBeVisible();
  await expect(page.getByRole('link', { name: wr })).toBeVisible();
  await page.goto('/#/office/packing-house/exceptions');
  await expect(page.getByText(jc).first()).toBeVisible({ timeout: 120_000 });
});
