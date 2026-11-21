import { expect, test, type Page } from '@playwright/test';
import { BASE } from './helpers';

// Complete authentication workflow on an instance whose Super Admin has not been set up yet (PH_SETUP_CODE = the one-time
// setup code). One-time setup → Super Admin signs in → creates an employee with a one-time code → employee chooses a
// password → logout → login → reset by the admin → suspend. Runs once per instance (the setup closes after use).
const SETUP_CODE = process.env.PH_SETUP_CODE ?? '';
const n = Date.now().toString().slice(-5);
const ADMIN = process.env.PH_ADMIN_USER ?? `admin${n}`;
const ADMIN_PW = process.env.PH_ADMIN_PW ?? `Admin-pass-${n}A`;
const EMP = `emp${n}`;

async function login(page: Page, user: string, pw: string) {
  await page.goto('/');
  await page.getByLabel(/اسم المستخدم أو البريد|Username or e-mail/).fill(user);
  await page.getByLabel(/^كلمة المرور$|^Password$/).fill(pw);
  await page.getByRole('button', { name: /^(دخول|Sign in)$/ }).click();
}

const tokenOf = (p: Page) => p.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x === 'agri.auth' || x.includes('auth-token'));
  return k ? (JSON.parse(localStorage.getItem(k) ?? '{}') as { access_token?: string }).access_token ?? '' : '';
});

async function call(p: Page, path: string, body: unknown, token?: string): Promise<{ status: number; json: Record<string, unknown> & { code?: string; error?: string } }> {
  return p.evaluate(async ([u, b, tk]) => {
    const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json', ...(tk ? { authorization: `Bearer ${tk as string}` } : {}) }, body: JSON.stringify(b) });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }, [path, body, token] as const) as never;
}

async function activate(page: Page, user: string, code: string, pw: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'دخول أول برمز التفعيل' }).click();
  await page.getByLabel('اسم المستخدم', { exact: true }).fill(user);
  await page.getByLabel('رمز التفعيل').fill(code);
  await page.getByLabel('كلمة المرور الجديدة').fill(pw);
  await page.getByLabel('تأكيد كلمة المرور').fill(pw);
  await page.getByRole('button', { name: 'تفعيل والدخول' }).click();
}

const GIVEN_ADMIN = process.env.PH_ADMIN_USER ?? '';
test.skip(!SETUP_CODE && !GIVEN_ADMIN, 'needs PH_SETUP_CODE (instance not set up) or PH_ADMIN_USER / PH_ADMIN_PW');

test('Super Admin one-time setup, employee account with one-time code, login, logout, reset and suspension', async ({ page, browser }) => {
  test.setTimeout(240_000);
  if (SETUP_CODE) {
  // 1. The setup page is open; a wrong code is refused.
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'إعداد حساب المدير العام' })).toBeVisible();
  await page.getByLabel('رمز الإعداد').fill('not-the-code');
  await page.getByLabel('اسم المستخدم', { exact: true }).fill(ADMIN);
  await page.getByLabel('اسمك الكامل').fill('Super Admin (e2e)');
  await page.getByLabel('كلمة المرور الجديدة').fill(ADMIN_PW);
  await page.getByLabel('تأكيد كلمة المرور').fill(ADMIN_PW);
  await page.getByRole('button', { name: 'إنشاء حساب المدير العام' }).click();
  await expect(page.getByRole('alert')).toContainText('رمز الإعداد غير صحيح');

  // 2. The right code: the Super Admin chooses username and password and lands in Settings.
  await page.getByLabel('رمز الإعداد').fill(SETUP_CODE);
  await page.getByRole('button', { name: 'إنشاء حساب المدير العام' }).click();
  await page.waitForURL(/\/ops\/settings/);
  await expect(page.getByRole('heading', { name: 'إعدادات العمليات' })).toBeVisible();

  // 3. The setup is closed for everyone afterwards.
  const other = await (await browser.newContext({ locale: 'ar' })).newPage();
  await other.goto(`${BASE}/setup`);
  await expect(other.getByText('اكتمل الإعداد')).toBeVisible();
  const reuse = await call(other, '/api/setup', { code: SETUP_CODE, username: 'intruder', full_name: 'x', password: 'Intruder-pass-1' });
  expect(reuse.json.error).toBe('no_pending_setup');

  } else {
    await login(page, ADMIN, ADMIN_PW);
    await page.waitForURL(/\/(ops|office)/);
  }

  // 4. Full office administration too (System Administrator): departments screen opens.
  await page.goto('/office/admin/departments');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/غير مسموح|ليس لديك صلاحية|Not permitted/)).toHaveCount(0);

  // 5. The Super Admin creates an employee (quality inspector) with a one-time code.
  await page.goto('/ops/settings/people');
  const form = page.getByRole('region', { name: 'حساب جديد' });
  await form.getByLabel('اسم المستخدم').fill(EMP);
  await form.getByLabel('الاسم', { exact: true }).fill('موظف اختبار (e2e)');
  const roleSel = form.getByLabel('الدور', { exact: true });
  await roleSel.selectOption((await roleSel.locator('option', { hasText: 'QCI ·' }).first().getAttribute('value')) ?? '');
  await form.getByRole('button', { name: 'إضافة الدور' }).click();
  await form.getByRole('button', { name: 'إنشاء الحساب' }).click();
  const code1 = (await form.locator('p.select-all bdi').textContent())?.trim() ?? '';
  expect(code1).toMatch(/^[A-Z0-9]{8}$/);

  // 6. The employee sets a password with the code (phone), signs out, signs in again; a wrong password is refused.
  const emp = await (await browser.newContext({ locale: 'ar', viewport: { width: 390, height: 844 } })).newPage();
  await emp.goto(BASE);
  await activate(emp, EMP, code1, 'Employee-pass-1');
  await emp.waitForURL(/\/(ops|office|field)/);
  await emp.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(emp.getByRole('button', { name: /^دخول$/ })).toBeVisible();
  await login(emp, EMP, 'wrong-password-9');
  await expect(emp.getByRole('alert')).toBeVisible();
  await login(emp, EMP, 'Employee-pass-1');
  await emp.waitForURL(/\/(ops|office|field)/);

  // 7. The employee cannot administer accounts.
  const denied = await call(emp, '/rest/v1/rpc/ph_admin_create_account', { p: { username: `x${n}`, full_name: 'x', roles: [] } }, await tokenOf(emp));
  expect((await tokenOf(emp)).length).toBeGreaterThan(20); // a real session token, so the refusal below is the server's decision
  expect(denied.status).toBeGreaterThanOrEqual(400);
  expect(denied.json.code).toBe('P0403');

  // 8. The Super Admin resets the employee's access: old password stops working, a new one-time code works.
  await page.goto('/ops/settings/people');
  const row = page.getByRole('listitem').filter({ hasText: EMP }).first();
  await row.getByRole('button', { name: 'إدارة' }).click();
  await row.getByLabel('السبب (إلزامي)').fill('e2e: forgot password');
  await row.getByRole('button', { name: 'إعادة تعيين الدخول' }).click();
  const code2 = (await row.locator('p.select-all bdi').textContent())?.trim() ?? '';
  expect(code2).toMatch(/^[A-Z0-9]{8}$/);
  await emp.reload();
  await expect(emp.getByRole('button', { name: /^دخول$/ })).toBeVisible(); // sessions ended by the reset
  await login(emp, EMP, 'Employee-pass-1');
  await expect(emp.getByRole('alert')).toBeVisible();
  await activate(emp, EMP, code2, 'Employee-pass-2');
  await emp.waitForURL(/\/(ops|office|field)/);

  // 9. Suspension: the employee can no longer sign in.
  await row.getByLabel('السبب (إلزامي)').fill('e2e: left the company');
  await row.getByRole('button', { name: 'إيقاف', exact: true }).click();
  await expect.poll(async () => {
    const r = await call(page, '/rest/v1/rpc/ph_admin_accounts', {}, await tokenOf(page));
    return (r.json as unknown as { username: string; status: string }[]).find((a) => a.username === EMP)?.status;
  }).toBe('suspended');
  await emp.context().clearCookies(); await emp.evaluate(() => localStorage.clear());
  await login(emp, EMP, 'Employee-pass-2');
  await expect(emp.getByRole('alert')).toBeVisible();

  // 10. The Super Admin signs out and back in with the chosen username and password.
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page.getByRole('button', { name: /^دخول$/ })).toBeVisible(); // signed out: back on the sign-in screen
  await login(page, ADMIN, ADMIN_PW);
  await page.waitForURL(/\/ops/);
});
