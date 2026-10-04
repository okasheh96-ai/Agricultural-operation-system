import { expect, test } from '@playwright/test';
import { login, one, signIn, sql } from './api';

test('wells live under Irrigation & Water: 14 unverified placeholders, reasoned status change, no fake verification', async ({ page }) => {
  // Fixture: make the run repeatable on a long-lived demo stack (W-07 back to its placeholder state).
  const farm = sql(`select id from farms where code = 'DEMO'`);
  const admin = await login('demo.admin@demo.local');
  await signIn(page, 'demo.admin@demo.local');
  await page.goto('/office/irrigation');
  await expect(page).toHaveURL(/\/office\/irrigation\/wells$/);
  await expect(page.getByRole('heading', { name: 'الآبار' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'رمز مؤقت' })).toHaveCount(14);
  expect(Number(sql(`select count(*) from water_sources where farm_id = '${farm}' and kind = 'well' and status = 'active'`))).toBe(0);

  const card = page.getByRole('listitem').filter({ hasText: 'W-07' });
  await expect(card.getByRole('button', { name: 'تأكيد' })).toBeDisabled(); // cannot verify an unnamed placeholder
  const before = await one<{ status: string }>(admin, `water_sources?farm_id=eq.${farm}&code=eq.W-07&select=status`);
  const target = before.status === 'inactive' ? 'تحت الصيانة' : 'غير فعّال';
  await card.getByRole('button', { name: 'تغيير الحالة' }).click();
  await card.getByLabel('الحالة الجديدة').selectOption({ label: target });
  await card.getByLabel('السبب / ما تمت معاينته').fill('معاينة ميدانية تجريبية');
  await card.getByRole('button', { name: 'حفظ' }).click();
  await expect(card).toContainText(target);
  const history = sql(`select comment from record_transitions where entity_id = (select id from water_sources where farm_id = '${farm}' and code = 'W-07') order by server_received_at desc limit 1`);
  expect(history).toBe('معاينة ميدانية تجريبية');
});
