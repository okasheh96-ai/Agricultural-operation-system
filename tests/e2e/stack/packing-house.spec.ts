import { expect, test, type Page } from '@playwright/test';
import { login, one, rest, rpc, signIn } from './api';

// Packing house M1 against the real stack (demo farm, labelled demo assumptions for OD-01/02/03/17/38).

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date());

async function switchUser(page: Page, email: string) {
  await page.evaluate(() => localStorage.clear());
  await signIn(page, email);
}

test('receiving: DEC creates an arrival, inspects the vehicle, passes G1 and registers a pallet; quality steps stay unavailable with a reason', async ({ page }) => {
  const plate = `E2E-${Date.now()}`;
  const dec = await login('demo.ph.dec@demo.local');
  const source = await one<{ id: string }>(dec, 'ph_sources?code=eq.DEMO-B1S01&verification_status=eq.verified&select=id');
  const variety = await one<{ id: string }>(dec, 'ph_varieties?verification_status=eq.verified&voided_at=is.null&select=id&limit=1');
  const scale = await one<{ id: string }>(dec, 'ph_equipment?kind=eq.scale&verification_status=eq.verified&select=id&limit=1');

  // Someone who holds only a packing-house role starts on the packing-house board, in Arabic RTL.
  await signIn(page, 'demo.ph.dec@demo.local');
  await expect(page).toHaveURL(/\/office\/packing-house$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('navigation', { name: 'مراحل سير العمل' })).toContainText('فحص الوصول');

  // ST-01: the arrival with its harvesting tag (V-01).
  await page.getByRole('button', { name: '＋ وصول جديد' }).click();
  await page.getByLabel('المصدر (القطاع').selectOption(source.id);
  await page.getByLabel('الصنف').selectOption(variety.id);
  await page.getByLabel('تاريخ الحصاد').fill(today());
  await page.getByLabel('وقت الحصاد').fill('06:00');
  await page.getByLabel('مشرف الحصاد').fill('مشرف اختبار آلي');
  await page.getByLabel('لوحة المركبة').fill(plate);
  await page.getByLabel('اسم السائق').fill('سائق اختبار آلي');
  await page.getByLabel('سبب التأخر').fill('اختبار آلي'); // used only when the arrival is after the documented cut-off (V-03)
  await page.getByRole('button', { name: 'إنشاء الوصول' }).click();
  await expect.poll(async () => (await rest<unknown[]>(dec, `ph_arrivals?vehicle_plate=eq.${plate}&select=id`)).length).toBe(1);
  const arrival = await one<{ id: string; code: string; status: string }>(dec, `ph_arrivals?vehicle_plate=eq.${plate}&select=id,code,status`);
  expect(arrival.status).toBe('draft');

  // Vehicle inspection (OD-38 demo assumption: DEC inspects), then gate G1.
  const panel = page.getByRole('article', { name: arrival.code });
  await panel.getByRole('button', { name: 'فحص المركبة' }).click();
  for (const ok of await panel.getByRole('radio', { name: 'مطابق' }).all()) await ok.click();
  await panel.getByRole('radio', { name: 'ناجح' }).click();
  await panel.getByRole('button', { name: 'تسجيل الفحص' }).click();
  await panel.getByRole('button', { name: 'اجتياز البوابة (G1)' }).click();
  await expect.poll(async () => (await one<{ status: string }>(dec, `ph_arrivals?id=eq.${arrival.id}&select=status`)).status).toBe('submitted');

  // ST-02: register a pallet (OD-01 B / OD-03 A demo assumptions); the weight is flagged because no calibration is recorded.
  await panel.getByRole('button', { name: 'تسجيل طبلية' }).click();
  await panel.getByLabel('الوزن الصافي (كغ)').fill('401.5');
  await panel.getByLabel('الميزان').selectOption(scale.id);
  await panel.getByRole('button', { name: 'تسجيل', exact: true }).click();
  await expect.poll(async () => (await rest<unknown[]>(dec, `ph_incoming_pallets?arrival_id=eq.${arrival.id}&select=id`)).length).toBe(1);
  const pallet = await one<{ id: string; code: string; status: string; net_kg: string; calibration_flag: boolean; decision_basis: Record<string, string> }>(dec,
    `ph_incoming_pallets?arrival_id=eq.${arrival.id}&select=id,code,status,net_kg,calibration_flag,decision_basis`);
  expect(pallet).toMatchObject({ status: 'registered', calibration_flag: true });
  expect(Number(pallet.net_kg)).toBe(401.5);
  expect(JSON.stringify(pallet.decision_basis)).toContain('demo:OD-01');

  // The record view explains why the next quality step (G2) is not available to DEC, naming the roles that hold it.
  await page.goto(`/office/packing-house/pallets/${pallet.id}`);
  await expect(page.getByRole('heading', { name: new RegExp(pallet.code) })).toBeVisible();
  const actions = page.getByRole('complementary', { name: 'الإجراءات' });
  await expect(actions).toContainText('فحص الوصول (G2)');
  await expect(actions).toContainText('لا يملك أي من أدوارك هذا الإجراء');
  await expect(actions).toContainText('QCI');

  // And the server refuses it regardless of the UI (forbidden path).
  await expect(rpc(dec, 'ph_submit_rma', {
    p_pallets: [pallet.id], p_decision: 'accept', p_checklist: {}, p_product_temp: null, p_sample_note: null, p_reason: null, p_attachment_ids: [],
  })).rejects.toThrow(/ph\.(denied|g2)/);
  // No direct writes to packing-house tables through the API.
  await expect(rest(dec, `ph_incoming_pallets?id=eq.${pallet.id}`, { method: 'PATCH', body: { net_kg: 1 } })).rejects.toThrow(/^(401|403)/);
});

test('board counts come from the database and the board reads in English too', async ({ page }) => {
  const qao = await login('demo.ph.qao@demo.local');
  await signIn(page, 'demo.ph.qao@demo.local');
  const counts = await rpc<{ stage: string; total: number }[]>(qao, 'ph_stage_counts', {});
  const qa = counts.find((c) => c.stage === 'qa_acceptance')?.total ?? 0;
  const tab = page.getByRole('navigation', { name: 'مراحل سير العمل' }).getByRole('button', { name: /قبول ضمان الجودة/ });
  await expect(tab).toContainText(String(qa));

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Packing House' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: /QA acceptance/ })).toContainText(String(qa));

  // Open decisions: the six critical ones are listed; demo assumptions are labelled as such.
  await page.goto('/office/packing-house/decisions');
  await expect(page.getByText('OD-25')).toBeVisible();
  await expect(page.getByText('Demo assumption', { exact: false }).first()).toBeVisible();
});

test('an auditor has read access only; a signer is not offered a signature twice; the location board counts pallets', async ({ page }) => {
  await signIn(page, 'demo.ph.aud@demo.local');
  await page.goto('/office/packing-house?stage=storage');
  await expect(page.getByRole('button', { name: '＋ وصول جديد' })).toHaveCount(0);
  const aud = await login('demo.ph.aud@demo.local');
  const perms = await rpc<{ action_key: string }[]>(aud, 'ph_my_permissions', {});
  expect(perms.every((p) => p.action_key.endsWith('.view') || p.action_key.startsWith('audit'))).toBe(true);

  // PHM already signed the demo vehicle exception: the board no longer offers PHM the signature.
  await switchUser(page, 'demo.ph.phm@demo.local');
  await page.goto('/office/packing-house?stage=arrivals');
  const held = page.getByRole('article').filter({ hasText: 'محجوز — المركبة' }).first();
  await expect(held).toBeVisible();
  await expect(held.getByRole('button', { name: 'توقيع استثناء المركبة' })).toHaveCount(0);

  // Location board (FR-ST-05): occupancy comes from the pallets; PHM may change a fridge's storage group (FR-ST-06).
  const phm = await login('demo.ph.phm@demo.local');
  const busiest = (await rest<{ code: string; occupancy: number; capacity_pallets: number | null }[]>(phm,
    'ph_location_occupancy?select=code,occupancy,capacity_pallets&order=occupancy.desc&limit=1'))[0];
  if (!busiest) throw new Error('no locations');
  await page.goto('/office/packing-house/master');
  const card = page.getByRole('article', { name: busiest.code });
  await expect(card).toContainText(`${busiest.occupancy} / ${busiest.capacity_pallets ?? '—'}`);
  await expect(card.getByRole('button', { name: 'تغيير مجموعة التخزين' })).toBeVisible();
});
