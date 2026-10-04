import { expect, test } from '@playwright/test';
import { login, one, rest, signIn } from './api';

test('admin master data: asset created unverified, edited, status changed with reason, voided with reason', async ({ page }) => {
  const code = `DEMO-AST-${Date.now()}`;
  const admin = await login('demo.admin@demo.local');
  await signIn(page, 'demo.admin@demo.local');
  await page.goto('/office/admin/md/assets');
  await page.getByRole('button', { name: 'إضافة' }).click();
  await page.getByLabel('الرمز *').fill(code);
  await page.getByLabel('الاسم بالعربية *').fill('مولد تجريبي للاختبار');
  await page.getByLabel('فئة الأصل *').selectOption({ label: 'generator · مولّد' });
  await page.getByLabel('القسم *').selectOption({ label: 'maintenance · الصيانة' });
  await page.getByRole('button', { name: 'حفظ' }).click();

  const card = page.getByRole('listitem').filter({ hasText: code });
  await expect(card).toContainText('غير مؤكد بعد');
  const row = await one<{ id: string; verification_status: string; status: string }>(admin, `assets?code=eq.${code}&select=id,verification_status,status`);
  expect(row).toMatchObject({ verification_status: 'not_yet_verified', status: 'not_yet_verified' });

  await card.getByRole('button', { name: 'تعديل' }).click();
  await card.getByLabel('الطراز').fill('DEMO-MODEL');
  await card.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(async () => (await one<{ model: string }>(admin, `assets?id=eq.${row.id}&select=model`)).model).toBe('DEMO-MODEL');

  await card.getByRole('button', { name: 'تغيير الحالة' }).click();
  await card.getByLabel('الحالة الجديدة').selectOption({ label: 'فعّال' });
  await card.getByLabel('السبب / ما تمت معاينته').fill('شوهد يعمل أثناء الجولة');
  await card.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(async () => (await one<{ status: string }>(admin, `assets?id=eq.${row.id}&select=status`)).status).toBe('active');

  await card.getByRole('button', { name: 'إلغاء السجل' }).click();
  await card.getByLabel('سبب الإلغاء').fill('أُدخل بالخطأ');
  await card.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: code })).toHaveCount(0);
  const voided = await rest<{ void_reason: string }[]>(admin, `assets?id=eq.${row.id}&select=void_reason`);
  expect(voided).toEqual([{ void_reason: 'أُدخل بالخطأ' }]); // kept, not deleted
});

test('department scope in admin screens: create only in own department, no edit of other departments, crew membership rules', async ({ page }) => {
  await signIn(page, 'demo.agri.manager@demo.local');

  await page.goto('/office/admin/md/assets');
  const pump = page.getByRole('listitem').filter({ hasText: 'DEMO-PMP-1' });
  await expect(pump).toBeVisible();
  await expect(pump.getByRole('button', { name: 'تعديل' })).toHaveCount(0); // a Maintenance asset

  await page.goto('/office/admin/md/task_types');
  await page.getByRole('button', { name: 'إضافة' }).click();
  const options = await page.getByLabel('القسم').locator('option').allTextContents();
  expect(options.filter((o) => o !== 'كل الأقسام')).toEqual(['agriculture · الإنتاج الزراعي']);

  await page.goto('/office/admin/md/crews');
  const crewB = page.getByRole('listitem').filter({ hasText: 'DEMO-CREW-B' });
  await crewB.getByRole('button', { name: 'الأعضاء' }).click();
  // DEMO-W01 is already in crew A for the same period: the database refuses a second membership.
  await crewB.getByLabel('العامل').selectOption({ label: 'DEMO-W01 · عامل تجريبي 1' });
  await crewB.getByRole('button', { name: 'إضافة إلى الطاقم' }).click();
  await expect(crewB.getByRole('alert')).toContainText('العامل عضو في طاقم آخر');
});

test('no screen is wider than the phone (field and office)', async ({ page }) => {
  await signIn(page, 'demo.admin@demo.local');
  for (const path of ['/office/command-center', '/office/operations', '/office/operations/plan', '/office/operations/exceptions',
    '/office/irrigation/wells', '/office/admin/md/assets', '/office/admin/md/crews', '/office/admin/md/task_types', '/office/admin/locations']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const add = page.getByRole('button', { name: 'إضافة' });
    if (await add.count()) await add.first().click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.evaluate(() => localStorage.clear());
  await signIn(page, 'demo.supervisor@demo.local');
  for (const path of ['/field/my-day', '/field/tasks/new', '/field/report', '/field/crew', '/field/sync']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
