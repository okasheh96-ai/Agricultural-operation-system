import { expect, test, type Page } from '@playwright/test';
import { api, signIn, signOut, sql, token } from './helpers';

// Owner acceptance scenario 2, through the normal screens of a packhouse-server instance (DEMO farm, invented people).
const n = Date.now().toString().slice(-6);
const SUP = `e2e.sup${n}`;
const SUP2 = `e2e.mgr${n}`;
const ROLE = `E2E_LEAD_${n}`;

async function addRole(scope: ReturnType<Page['locator']>, code: string, line: RegExp | null) {
  const roleSel = scope.getByLabel('الدور', { exact: true });
  await roleSel.selectOption((await roleSel.locator('option', { hasText: `${code} ·` }).first().getAttribute('value')) ?? '');
  if (line) {
    const lineSel = scope.getByLabel('نطاق الخط');
    await lineSel.selectOption((await lineSel.locator('option', { hasText: line }).first().getAttribute('value')) ?? '');
  }
  await scope.getByRole('button', { name: 'إضافة الدور' }).click();
}

test('Owner creates a username account, a custom role and a line-scoped delegation; the manager is held to it; access changes apply to open sessions', async ({ page, browser }) => {
  // 1. Owner: username-only account with a one-time code, role LL on line A, effective access shown before saving.
  await signIn(page, 'demo.owner');
  await page.goto('/ops/settings/people');
  const form = page.getByRole('region', { name: 'حساب جديد' });
  await form.getByLabel('اسم المستخدم').fill(SUP);
  await form.getByLabel('الاسم', { exact: true }).fill('مشرف اختبار (e2e)');
  await addRole(form, 'LL', /ELIFAB/);
  await expect(form.getByText(/الصلاحيات الفعلية قبل الحفظ/)).toBeVisible();
  await expect(form.getByText('labour.record')).toBeVisible();
  await form.getByRole('button', { name: 'إنشاء الحساب' }).click();
  const code = (await form.locator('p.select-all bdi').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  expect(sql(`select email is null from auth.users u join app.po_accounts a on a.user_id = u.id where a.username = '${SUP}'`)).toBe('t');

  // 2. Owner: custom role cloned from the line supervisor.
  await page.getByRole('tab', { name: 'الأدوار' }).click();
  await page.getByLabel('رمز الدور').fill(ROLE);
  await page.getByLabel('الاسم بالعربية').fill('قائد اختبار');
  const cloneSel = page.getByLabel('نسخ من');
  await cloneSel.selectOption((await cloneSel.locator('option', { hasText: 'LL' }).first().getAttribute('value')) ?? '');
  await page.getByLabel('السبب (إلزامي)').first().fill('Pilot lead role (e2e)');
  await page.getByRole('button', { name: 'إنشاء الدور' }).click();
  await expect(page.getByRole('button', { name: new RegExp(ROLE) })).toBeVisible();
  expect(Number(sql(`select count(*) from public.ph_permission_cells where spec_code = '${ROLE}' and voided_at is null and evidence = 'O'`))).toBeGreaterThan(0);

  // 3. Owner: delegate account creation for LL on line A to the PHM.
  await page.getByRole('tab', { name: 'التفويض' }).click();
  const mgrSel = page.getByLabel('المدير');
  await mgrSel.selectOption((await mgrSel.locator('option', { hasText: 'demo.ph.phm' }).getAttribute('value')) ?? '');
  await page.locator('label', { hasText: /^LL$/ }).locator('input').check();
  await page.locator('label', { hasText: 'ELIFAB' }).locator('input').check();
  await page.getByLabel('السبب (إلزامي)').fill('PHM hires line A supervisors (e2e)');
  await page.getByRole('button', { name: 'حفظ التفويض' }).click();
  await expect(page.getByText('حُفظ')).toBeVisible();

  // 4. The manager creates an allowed account; the UI and the server refuse anything outside the delegation.
  await signOut(page);
  await signIn(page, 'demo.ph.phm');
  await page.goto('/ops/settings/people');
  const mform = page.getByRole('region', { name: 'حساب جديد' });
  await mform.getByLabel('اسم المستخدم').fill(SUP2);
  await mform.getByLabel('الاسم', { exact: true }).fill('مشرف ثانٍ (e2e)');
  await addRole(mform, 'QCI', null);
  await mform.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(mform.getByRole('alert')).toContainText('خارج ما فُوّض إليك');
  await mform.getByRole('button', { name: 'إزالة' }).click();
  await addRole(mform, 'LL', /ELIFAB/);
  await mform.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(mform.locator('p.select-all bdi')).toHaveText(/^[A-Z0-9]{8}$/);
  const lineB = sql(`select l.id from public.ph_lines l join public.farms f on f.id = l.farm_id where f.code = 'DEMO' and l.code = 'B'`);
  const mgrTok = await token('demo.ph.phm');
  const outside = await api<{ code: string }>(mgrTok, 'ph_admin_create_account', { p: { username: `e2e.x${n}`, full_name: 'x', roles: [{ code: 'LL', line_id: lineB }] } });
  expect(outside.status).toBeGreaterThanOrEqual(400); // the server refuses a grant outside the delegated scope, whatever the screen offers
  expect(outside.body.code).toBe('P0403');

  // 5. The new supervisor's first sign-in with the code; they choose a password and land on their shift form.
  const supPage = await (await browser.newContext({ locale: 'ar', viewport: { width: 390, height: 844 } })).newPage();
  await supPage.goto('/');
  await supPage.getByRole('button', { name: 'دخول أول برمز التفعيل' }).click();
  await supPage.getByLabel('اسم المستخدم', { exact: true }).fill(SUP);
  await supPage.getByLabel('رمز التفعيل').fill(code);
  await supPage.getByLabel('كلمة المرور الجديدة').fill('Shiftline2026');
  await supPage.getByLabel('تأكيد كلمة المرور').fill('Shiftline2026');
  await supPage.getByRole('button', { name: 'تفعيل والدخول' }).click();
  await expect(supPage).toHaveURL(/\/ops\/shift/);

  // 6. Access changed while the session is open: revoking it signs the device out at the next action.
  const owner = await token('demo.owner');
  const supId = sql(`select user_id from app.po_accounts where username = '${SUP}'`);
  const revoked = await api<{ sessions_revoked: number }>(owner, 'ph_admin_account_step', { p_user: supId, p_step: 'revoke_sessions', p_reason: 'e2e: device lost' });
  expect(revoked.status).toBe(200);
  await supPage.reload();
  await expect(supPage.getByRole('button', { name: /^دخول$/ })).toBeVisible();

  // 7. A role change applies to the next request of an open session.
  const supTok = await token(SUP, 'Shiftline2026');
  const lineA = sql(`select l.id from public.ph_lines l join public.farms f on f.id = l.farm_id where f.code = 'DEMO' and l.code = 'A'`);
  const before = await api<{ line_id: string }[]>(supTok, 'ph_my_lines', { p_action: 'labour.record' });
  expect(before.body.map((l) => l.line_id)).toEqual([lineA]);
  await api(owner, 'ph_admin_set_roles', { p_user: supId, p_roles: [{ code: 'LL', line_id: lineB }], p_reason: 'e2e: moved to line B' });
  const after = await api<{ line_id: string }[]>(supTok, 'ph_my_lines', { p_action: 'labour.record' });
  expect(after.body.map((l) => l.line_id)).toEqual([lineB]);

  // 8. Owner resets access and archives the account through the screens; history stays attributable; the audit shows it all.
  await signOut(page);
  await signIn(page, 'demo.owner');
  await page.goto('/ops/settings/people');
  const row = page.getByRole('listitem').filter({ hasText: SUP }).first();
  await row.getByRole('button', { name: 'إدارة' }).click();
  await row.getByLabel('السبب (إلزامي)').fill('e2e: forgot password');
  await row.getByRole('button', { name: 'إعادة تعيين الدخول' }).click();
  await expect(row.locator('p.select-all bdi')).toHaveText(/^[A-Z0-9]{8}$/);
  expect((await fetch(`${page.url().split('/ops')[0]}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: SUP, password: 'Shiftline2026' }) })).status).toBe(400);
  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'أرشفة' }).click();
  await expect.poll(() => sql(`select status from app.po_accounts where username = '${SUP}'`)).toBe('archived');
  expect(sql(`select full_name from public.user_profiles where id = '${supId}'`)).toBe('مشرف اختبار (e2e)');
  await page.getByRole('tab', { name: 'سجل الصلاحيات' }).click();
  await expect(page.getByText('e2e: moved to line B').first()).toBeVisible();
  await expect(page.getByText('e2e: forgot password').first()).toBeVisible();
});
