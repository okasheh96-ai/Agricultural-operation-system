import { expect, test, type Page } from '@playwright/test';
import { api, rest, signIn, signOut, token } from './helpers';

// Owner acceptance scenario 1 (no-code), through the normal screens of a packhouse-server instance (DEMO farm, invented data):
// a new customer and a 6 kg pack (maker-checker), a reinspection before dispatch for that customer only with a temperature
// field, assigned to QC, with an authorised release; an "outstanding inspections" card for management; then retire it — the
// old run stays readable. Order, load and stock set-up that is not part of the scenario is done through the API as the roles
// that own those steps.
const n = Date.now().toString().slice(-5);
const letters = n.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)] ?? 'x');
const CUST = `NEWCO${n}`;
const PACK = `C6KG${n}`;
const OP = `REINSP${n}`;
const KPI = `OUTSTANDING${n}`;
const OP_NAME = `إعادة فحص ${letters}`;
const KPI_TITLE = `فحوصات معلّقة ${letters}`;

async function md(page: Page, tab: string) {
  await page.goto('/ops/settings/master');
  await page.getByRole('tab', { name: tab }).click();
}

test('Owner builds a conditional reinspection before dispatch with a release and a KPI card, QC runs it, the Owner retires it', async ({ page, browser }) => {
  test.setTimeout(180_000);
  // 1. Master data: the Owner enters a customer and a 6 kg carton; other people approve (the Owner cannot approve their own).
  await signIn(page, 'demo.owner');
  await md(page, 'العملاء');
  await page.getByRole('button', { name: /سجل جديد/ }).click();
  let ed = page.getByRole('dialog', { name: 'سجل جديد' });
  await ed.getByRole('textbox', { name: 'الرمز', exact: true }).fill(CUST);
  await ed.getByRole('textbox', { name: 'الاسم (إنجليزي)', exact: true }).fill('New customer (e2e)');
  await ed.getByRole('combobox', { name: 'السوق', exact: true }).selectOption('export');
  await ed.getByRole('button', { name: 'حفظ للاعتماد' }).click();
  await expect(page.getByRole('row').filter({ hasText: CUST })).toContainText('بانتظار الاعتماد');
  await md(page, 'أشكال التعبئة');
  await page.getByRole('button', { name: /سجل جديد/ }).click();
  ed = page.getByRole('dialog', { name: 'سجل جديد' });
  await ed.getByRole('textbox', { name: 'الرمز', exact: true }).fill(PACK);
  await ed.getByRole('textbox', { name: 'الاسم (عربي)', exact: true }).fill('كرتونة 6 كغ (e2e)');
  await ed.getByRole('combobox', { name: 'النوع', exact: true }).selectOption('carton');
  await ed.getByRole('textbox', { name: 'الوزن الصافي للعبوة كغم', exact: true }).fill('6');
  await ed.getByRole('textbox', { name: 'رمز المحصول', exact: true }).fill('cherry_tomato');
  await ed.getByRole('button', { name: 'حفظ للاعتماد' }).click();
  const packRow = page.getByRole('row').filter({ hasText: PACK });
  await expect(packRow).toContainText('بانتظار الاعتماد');
  await page.getByLabel(/ملاحظة الاعتماد/).fill('self (e2e)');
  await packRow.getByRole('button', { name: 'اعتماد' }).click();
  await expect(page.getByRole('alert')).toBeVisible(); // segregation of duties: refused
  const ownerTok = await token('demo.owner');
  expect((await rest<{ verification_status: string }[]>(ownerTok, `ph_pack_formats?code=eq.${PACK}&select=verification_status`))[0]?.verification_status).not.toBe('verified');

  const checker = await browser.newContext({ locale: 'ar' });
  const cp = await checker.newPage();
  await signIn(cp, 'demo.ph.qcm');
  await md(cp, 'العملاء');
  await cp.getByLabel(/ملاحظة الاعتماد/).fill('Customer specification received (e2e)');
  await cp.getByRole('row').filter({ hasText: CUST }).getByRole('button', { name: 'اعتماد' }).click();
  await expect(cp.getByRole('row').filter({ hasText: CUST })).toContainText('معتمد');
  await signOut(cp);
  await signIn(cp, 'demo.ph.phm');
  await md(cp, 'أشكال التعبئة');
  await cp.getByLabel(/ملاحظة الاعتماد/).fill('Carton checked (e2e)');
  await cp.getByRole('row').filter({ hasText: PACK }).getByRole('button', { name: 'اعتماد' }).click();
  await expect(cp.getByRole('row').filter({ hasText: PACK })).toContainText('معتمد');

  // 2. Settings → Operations: the reinspection, built from menus, previewed, validated and published.
  await page.goto('/ops/settings/operations');
  const nw = page.getByRole('region', { name: 'عملية جديدة' });
  await nw.getByLabel('الرمز (أحرف لاتينية كبيرة)').fill(OP);
  await nw.getByLabel('الاسم بالعربية').fill(OP_NAME);
  await nw.getByLabel('تنطبق على').selectOption('load');
  await nw.getByRole('button', { name: 'إنشاء مسودة' }).click();
  await expect(page.getByRole('button', { name: new RegExp(OP) })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(OP) }).click();
  await expect(page.getByLabel('تُربط بـ')).toHaveValue('dispatch.before_depart');
  const when = page.getByRole('group', { name: /فقط عندما/ });
  await when.getByRole('button', { name: /إضافة شرط/ }).click();
  await when.getByLabel('الحقل').selectOption('customer_code');
  await when.getByLabel('القيمة').fill(CUST);

  await page.getByRole('button', { name: /إضافة خطوة نموذج/ }).click();
  const s1 = page.getByRole('region', { name: 'الخطوة 1' });
  await s1.getByLabel('اسم الخطوة (عربي)').fill('إعادة الفحص');
  await s1.getByLabel('من يسجلها').selectOption('QCI');
  await s1.getByRole('button', { name: /إضافة حقل/ }).click();
  const f1 = s1.getByRole('group', { name: 'الحقل 1' });
  await f1.getByLabel('التسمية (عربي)').fill('حرارة اللب');
  await f1.getByLabel('النوع').selectOption('number');
  await f1.getByLabel('المفتاح').fill('pulp_temp');
  await f1.getByLabel('إلزامي').check();
  await f1.getByLabel('الوحدة').selectOption('degC');
  await f1.getByLabel('الحد الأدنى').fill('-5');
  await f1.getByLabel('الحد الأعلى').fill('40');
  await s1.getByRole('button', { name: /إضافة حقل/ }).click();
  const f2 = s1.getByRole('group', { name: 'الحقل 2' });
  await f2.getByLabel('التسمية (عربي)').fill('النتيجة');
  await f2.getByLabel('النوع').selectOption('select');
  await f2.getByLabel('المفتاح').fill('result');
  await f2.getByLabel('إلزامي').check();
  for (const [v, l] of [['pass', 'مطابق'], ['fail', 'غير مطابق']]) {
    await f2.getByRole('button', { name: /إضافة خيار/ }).click();
    await f2.getByLabel('القيمة المخزنة').last().fill(v ?? '');
    await f2.getByLabel('التسمية (عربي)').last().fill(l ?? '');
  }
  const passIf = s1.getByRole('group', { name: /تنجح عندما/ });
  await passIf.getByRole('button', { name: /إضافة شرط/ }).click();
  await passIf.getByLabel('الحقل').selectOption('result');
  await passIf.getByLabel('القيمة').fill('pass');
  await s1.getByLabel('عند الفشل').selectOption('hold');
  await page.getByRole('button', { name: /إضافة خطوة اعتماد/ }).click();
  const s2 = page.getByRole('region', { name: 'الخطوة 2' });
  await s2.getByLabel('اسم الخطوة (عربي)').fill('الإفراج المعتمد');
  await s2.getByLabel('من يسجلها').selectOption('QCM');

  // Live preview: step 1 as QC will see it, with the pass rule evaluated on sample values.
  await s1.getByRole('button', { name: 'معاينة' }).click();
  const preview = page.getByRole('complementary', { name: 'معاينة مباشرة (هاتف)' });
  await expect(preview.getByLabel(/حرارة اللب/)).toBeVisible();
  await preview.getByLabel(/النتيجة/).selectOption('fail');
  await expect(preview.getByText('ستفشل')).toBeVisible();
  await preview.getByLabel(/النتيجة/).selectOption('pass');
  await expect(preview.getByText('ستنجح')).toBeVisible();

  await page.getByLabel('ما الذي تغيّر (ملاحظة)').fill('Owner scenario (e2e)');
  await page.getByRole('button', { name: 'حفظ المسودة والتحقق' }).click();
  await expect(page.getByText('المسودة سليمة.').first()).toBeVisible();
  await page.getByRole('button', { name: 'نشر', exact: true }).click();
  await expect(page.getByText('نُشر كإصدار 1.')).toBeVisible();
  expect((await rest<{ spec_code: string }[]>(ownerTok, `ph_permission_cells?action_key=like.op_${OP.toLowerCase()}.*&voided_at=is.null&select=spec_code&order=spec_code`))
    .map((c) => c.spec_code).join(',')).toBe('QCI,QCM');

  // 3. Settings → KPI cards: outstanding inspections for management, previewed live, then published.
  await page.goto('/ops/settings/kpis');
  await page.getByRole('button', { name: /بطاقة جديدة/ }).click();
  await page.getByLabel('الرمز', { exact: true }).fill(KPI);
  await page.getByLabel('العنوان (عربي)').fill(KPI_TITLE);
  await page.getByLabel('مصدر البيانات').selectOption('op_runs');
  await page.getByLabel('الفترة').selectOption('open_now');
  const filters = page.getByRole('group', { name: /فقط السجلات التي/ });
  for (const [f, o, v] of [['op_code', 'eq', OP], ['run_state', 'neq', 'completed'], ['run_state', 'neq', 'cancelled']]) {
    await filters.getByRole('button', { name: /إضافة مرشح/ }).click();
    await filters.getByLabel('الحقل').last().selectOption(f ?? '');
    await filters.getByLabel('المقارنة').last().selectOption(o ?? '');
    await filters.getByLabel('القيمة').last().fill(v ?? '');
  }
  const vis = page.getByRole('group', { name: 'تظهر لـ' });
  await vis.getByLabel('PHM').check();
  await vis.getByLabel('OWN').check();
  const live = page.getByRole('complementary', { name: 'معاينة مباشرة (هاتف)' });
  await expect(live).toContainText('0');
  await page.getByRole('button', { name: 'نشر', exact: true }).click();
  await expect(page.getByText(/نُشر كإصدار 1/)).toBeVisible();

  // 4. A load for the new customer (order and load set up by Sales, the PHM and the PE through the API).
  const id1 = async (path: string) => (await rest<{ id: string }[]>(ownerTok, `${path}&select=id`))[0]?.id ?? '';
  const crop = await id1('ph_crops?code=eq.cherry_tomato&superseded_at=is.null&voided_at=is.null');
  const custId = await id1(`ph_customers?code=eq.${CUST}`);
  const packId = await id1(`ph_pack_formats?code=eq.${PACK}`);
  const runs = (load: string) => rest<{ id: string; run_state: string }[]>(ownerTok, `ph_op_runs?subject_id=eq.${load}&select=id,run_state`);
  const sal = await token('demo.ph.sal');
  const ol = await api<{ id: string }>(sal, 'ph_create_order_line', { p: { customer_name: CUST, crop_id: crop, pack_spec: '6 kg carton', grade: 'gr1', quantity: 300,
    quantity_unit: 'kg', required_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), market_type: 'export' } });
  expect(ol.status).toBe(200);
  expect((await api(sal, 'ph_set_order_line_refs', { p_line: ol.body.id, p_customer: custId, p_pack: packId })).status).toBe(200);
  expect((await api(await token('demo.ph.phm'), 'ph_decide_order_line', { p_line: ol.body.id, p_decision: 'accept' })).status).toBe(200);
  const pe = await token('demo.ph.pe');
  const ld = await api<{ id: string; code: string }>(pe, 'ph_create_load', { p: { customer_id: custId, destination: 'Test (e2e)', order_line_ids: [ol.body.id], vehicle_plate: 'E2E-1' } });
  expect(ld.status).toBe(200);
  expect((await runs(ld.body.id)).map((r) => r.run_state)).toEqual(['open']); // an open run holds the departure (pgTAP 22 proves the block)

  // Management sees 1 outstanding inspection on the overview.
  await page.goto('/ops');
  const card = page.locator('.ops-card').filter({ hasText: KPI_TITLE });
  await expect(card.locator('.text-3xl')).toHaveText('1');

  // 5. QC finds the task on the task board (phone), records the temperature; a wrong value is refused by the server.
  const qc = await (await browser.newContext({ locale: 'ar', viewport: { width: 390, height: 844 } })).newPage();
  await signIn(qc, 'demo.ph.qci');
  await qc.goto('/ops/tasks');
  const task = qc.getByRole('article').filter({ hasText: OP_NAME });
  await task.getByRole('link', { name: /فتح العملية/ }).click();
  await qc.getByLabel(/حرارة اللب/).fill('80');
  await qc.getByLabel(/النتيجة/).selectOption('pass');
  await qc.getByRole('button', { name: 'تسجيل الخطوة' }).click();
  await expect(qc.getByRole('alert')).toContainText('خارج المدى المسموح');
  await qc.getByLabel(/حرارة اللب/).fill('8');
  await qc.getByRole('button', { name: 'تسجيل الخطوة' }).click();
  await expect(qc.getByText('سُجّلت؛ أُسندت الخطوة التالية.')).toBeVisible();
  expect(await qc.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // 6. The authorised release by the QC manager completes it; departure no longer waits; the card drops to 0.
  await signOut(cp);
  await signIn(cp, 'demo.ph.qcm');
  await cp.goto('/ops/tasks');
  await cp.getByRole('article').filter({ hasText: OP_NAME }).getByRole('link', { name: /فتح العملية/ }).click();
  await cp.getByRole('button', { name: 'اعتماد الإفراج' }).click();
  await expect(cp.getByText('اكتملت.')).toBeVisible();
  expect((await runs(ld.body.id)).map((r) => r.run_state)).toEqual(['completed']);
  await page.reload();
  await expect(page.locator('.ops-card').filter({ hasText: KPI_TITLE }).locator('.text-3xl')).toHaveText('0');

  // 7. The Owner retires the operation through Settings; a new load for the customer is not held; the old run stays readable.
  await page.goto('/ops/settings/operations');
  await page.getByRole('button', { name: new RegExp(OP) }).click();
  const retire = page.getByRole('region', { name: 'إيقاف هذه العملية' });
  await retire.getByLabel('السبب (إلزامي)').fill('Customer requirement ended (e2e)');
  await retire.getByRole('button', { name: 'إيقاف' }).click();
  await expect(page.getByText(/أُوقفت؛/)).toBeVisible();
  const ld2 = await api<{ id: string }>(pe, 'ph_create_load', { p: { customer_id: custId, order_line_ids: [ol.body.id], vehicle_plate: 'E2E-2' } });
  expect(await runs(ld2.body.id)).toEqual([]);
  const runId = (await runs(ld.body.id))[0]?.id ?? '';
  await page.goto(`/ops/run/${runId}`);
  await expect(page.getByText('موقوفة').first()).toBeVisible();
  await expect(page.getByText(/8 °م/)).toBeVisible();
  await expect(page.getByText('أُفرج')).toBeVisible();
  await checker.close();
});
