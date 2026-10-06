import { expect, test } from '@playwright/test';
import { assignedTask, login, one, rest, signIn } from './api';

const SUP = 'demo.supervisor@demo.local';
const SUP2 = 'demo.supervisor2@demo.local';

test('shared crew phone: queued work is sent only under its author; another supervisor cannot act on it', async ({ page, context }) => {
  const manager = await login('demo.agri.manager@demo.local');
  const title = `هاتف مشترك ${Date.now()}`;
  const task = await assignedTask(manager, SUP, title);

  // Supervisor 1 starts the task with no signal, then hands the phone over.
  await signIn(page, SUP);
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'ابدأ' }).click();
  await expect(page.getByText('بانتظار المزامنة').first()).toBeVisible();
  await page.goto('/field/sync');
  await page.getByRole('button', { name: 'تسجيل الخروج' }).last().click();
  await expect(page.getByRole('alertdialog')).toContainText('تغييرات لم تُرسل');
  await page.getByRole('button', { name: 'الخروج على أي حال' }).click();
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible(); // signed out even with no signal
  await context.setOffline(false);

  // Supervisor 2 signs in on the same phone, online: supervisor 1's change must not be sent under their name.
  await signIn(page, SUP2);
  await page.goto('/field/sync');
  await expect(page.getByText('تخص مستخدماً آخر')).toBeVisible();
  expect((await one<{ status: string }>(manager, `tasks?id=eq.${task.id}&select=status`)).status).toBe('assigned');
  // ...nor can supervisor 2 work a task assigned to someone else (no execution controls).
  await page.goto(`/field/tasks/${task.id}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ابدأ' })).toHaveCount(0);
  await page.goto('/field/sync');
  await page.getByRole('button', { name: 'تسجيل الخروج' }).last().click();
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible(); // sign-out finishes before the next sign-in

  // Supervisor 1 signs back in: their change is sent, attributed to them.
  await signIn(page, SUP);
  await expect.poll(async () => (await one<{ status: string }>(manager, `tasks?id=eq.${task.id}&select=status`)).status, { timeout: 20_000 })
    .toBe('in_progress');
  const sup1 = await login(SUP);
  const started = await rest<{ actor_user_id: string }[]>(manager, `record_transitions?entity_id=eq.${task.id}&to_status=eq.in_progress&select=actor_user_id`);
  expect(started).toEqual([{ actor_user_id: sup1.userId }]);
});

test('Operations routes a problem report; triage stays with the owning department', async ({ page }) => {
  const sup = await login(SUP);
  const farm = await one<{ farm_id: string }>(sup, 'departments?code=eq.agriculture&select=farm_id');
  const cat = await one<{ id: string }>(sup, 'problem_categories?code=eq.other&select=id');
  const description = `بلاغ للتحويل ${Date.now()}`;
  await rest(sup, 'problem_reports', { method: 'POST', body: { farm_id: farm.farm_id, category_id: cat.id, description } });

  await signIn(page, 'demo.ops@demo.local');
  await page.goto('/office/operations/exceptions');
  const card = page.getByRole('listitem').filter({ hasText: description });
  await expect(card.getByRole('button', { name: 'تحويل إلى عمل' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'معالجة بدون عمل' })).toHaveCount(0);
  await card.getByRole('button', { name: 'تحويل إلى قسم آخر' }).click();
  await card.getByLabel('القسم المسؤول').selectOption({ label: 'الصيانة' });
  await card.getByLabel('سبب التحويل').fill('عطل في معدة — اختصاص الصيانة');
  await card.getByRole('button', { name: 'حفظ' }).click();
  const ops = await login('demo.ops@demo.local');
  await expect.poll(async () => (await one<{ departments: { code: string } }>(ops,
    `problem_reports?description=eq.${encodeURIComponent(description)}&select=departments(code)`)).departments.code).toBe('maintenance');
});
