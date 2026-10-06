import { expect, test } from '@playwright/test';

test('one tap signs the admin in to a horizontal office: departments across the top, section tabs, department cards', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /مدير النظام — كل الأقسام/ }).click();
  await expect(page).toHaveURL(/\/office\/command-center/);
  await expect(page.getByRole('heading', { name: 'مركز القيادة' })).toBeVisible();

  // Departments and sections run side by side in one bar, not down a side menu.
  const bar = page.getByRole('navigation', { name: 'واجهة المكتب' });
  const command = await bar.getByRole('link', { name: /مركز القيادة/ }).boundingBox();
  const operations = await bar.getByRole('link', { name: /العمليات/ }).boundingBox();
  expect(command && operations).toBeTruthy();
  expect(Math.abs((command?.y ?? 0) - (operations?.y ?? 99))).toBeLessThan(4);
  expect(command?.x).not.toBe(operations?.x);
  await expect(bar.getByRole('link', { name: /الزراعة/ })).toContainText('في مرحلة لاحقة'); // unbuilt stays honest

  // By-department cards replace the old table.
  await expect(page.getByRole('heading', { name: 'حسب القسم' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();

  // Opening a section shows its pages as a second row of tabs (only those the role may use: the admin does not plan).
  await bar.getByRole('link', { name: /العمليات/ }).click();
  const tabs = page.getByRole('navigation', { name: 'العمليات' });
  await expect(tabs.getByRole('link', { name: 'لوحة العمليات' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'التخطيط اليومي' })).toHaveCount(0);
  await tabs.getByRole('link', { name: 'البلاغات' }).click();
  await expect(page).toHaveURL(/\/office\/operations\/exceptions/);
});

test('a wrong password against the real server asks to check the password', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('البريد الإلكتروني').fill('demo.admin@demo.local');
  await page.getByLabel('كلمة المرور').fill('not-the-password');
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('تعذّر تسجيل الدخول. تحقق من البريد وكلمة المرور.');
});
