import { expect, test } from '@playwright/test';

test('sign-in renders Arabic RTL by default and switches to English LTR', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();

  const submit = page.getByRole('button', { name: 'دخول' });
  const box = await submit.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48); // touch target ≥ 48 px

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  // Preference survives reload.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('an unreachable server says so (not "check your password"), never a fake session', async ({ page }) => {
  // This build points at a closed port: the request never gets an answer.
  await page.goto('/');
  await page.getByLabel('البريد الإلكتروني').fill('someone@example.com');
  await page.getByLabel('كلمة المرور').fill('wrong-password');
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('alert')).toHaveText('تعذّر الاتصال بالخادم. تحقق من الاتصال ثم أعد تحميل الصفحة.');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
});

test('a normal build has no one-tap demo sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'دخول سريع إلى المزرعة التجريبية' })).toHaveCount(0);
});
