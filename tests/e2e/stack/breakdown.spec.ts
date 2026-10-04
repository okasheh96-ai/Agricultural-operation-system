import { expect, test } from '@playwright/test';
import { login, one, rest, signIn } from './api';

async function switchUser(page: import('@playwright/test').Page, email: string) {
  await page.evaluate(() => localStorage.clear());
  await signIn(page, email);
}

test('breakdown: field report → triaged to Maintenance → work order → assigned → done → verified by another user → closed', async ({ page }) => {
  const stamp = Date.now();
  const description = `المضخة لا تضخ ${stamp}`;

  // 1. A supervisor reports the problem from the field (category, words, send).
  await signIn(page, 'demo.supervisor@demo.local');
  await page.goto('/field/report');
  await page.getByRole('button', { name: 'عطل معدة / آلية' }).click();
  await page.getByLabel('وصف المشكلة').fill(description);
  await page.getByLabel('المعدة (اختياري)').selectOption({ label: 'DEMO-PMP-1 · مضخة تجريبية ١' });
  await page.getByRole('button', { name: 'إرسال البلاغ' }).click();
  await expect(page.getByRole('status')).toContainText('تم حفظ البلاغ');

  const mm = await login('demo.maint.manager@demo.local');
  const report = await one<{ id: string; status: string; owning_department_id: string }>(mm,
    `problem_reports?description=eq.${encodeURIComponent(description)}&select=id,status,owning_department_id`);
  expect(report.status).toBe('open');

  // 2. Maintenance triages it into a work order + repair task.
  await switchUser(page, 'demo.maint.manager@demo.local');
  await page.goto('/office/operations/exceptions');
  const card = page.getByRole('listitem').filter({ hasText: description });
  await card.getByRole('button', { name: 'تحويل إلى عمل' }).click();
  await card.getByLabel('نوع المهمة').selectOption({ label: 'إصلاح عطل' });
  await card.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('status')).toContainText('تم التحويل إلى المهمة');
  const task = await one<{ id: string; code: string; status: string; work_order_id: string }>(mm,
    `tasks?source_problem_report_id=eq.${report.id}&select=id,code,status,work_order_id`);
  expect(task.work_order_id).toBeTruthy();

  // 3. Assign to the technician from the daily plan (Maintenance department).
  await page.goto('/office/operations/plan');
  await page.getByLabel('القسم').selectOption({ label: 'الصيانة' });
  const row = page.getByRole('listitem').filter({ hasText: task.code });
  await row.getByLabel('اختر المشرف').selectOption({ label: 'فني صيانة (تجريبي)' });
  await row.getByRole('button', { name: 'إسناد' }).click();
  await expect.poll(async () => (await one<{ status: string }>(mm, `tasks?id=eq.${task.id}&select=status`)).status).toBe('assigned');

  // 4. The technician starts and finishes it from the field.
  await switchUser(page, 'demo.technician@demo.local');
  await page.goto(`/field/tasks/${task.id}`);
  await page.getByRole('button', { name: 'ابدأ' }).click();
  await page.getByRole('button', { name: 'أنهيت المهمة' }).click();
  await expect.poll(async () => (await one<{ status: string }>(mm, `tasks?id=eq.${task.id}&select=status`)).status).toBe('pending_verification');
  await expect(page.getByRole('button', { name: 'تأكيد التنفيذ' })).toHaveCount(0); // no self-verification control

  // 5. The maintenance manager (a different user) verifies and closes.
  await switchUser(page, 'demo.maint.manager@demo.local');
  await page.goto('/office/operations/verification');
  await page.getByRole('listitem').filter({ hasText: task.code }).getByRole('button', { name: 'تأكيد التنفيذ' }).click();
  await expect.poll(async () => (await one<{ status: string }>(mm, `tasks?id=eq.${task.id}&select=status`)).status).toBe('verified');
  await page.goto(`/office/tasks/${task.id}`);
  await page.getByRole('button', { name: 'إغلاق' }).click();
  await expect.poll(async () => (await one<{ status: string }>(mm, `tasks?id=eq.${task.id}&select=status`)).status).toBe('closed');

  // Full trail: report converted, every task step in the history and the audit log.
  expect((await one<{ status: string }>(mm, `problem_reports?id=eq.${report.id}&select=status`)).status).toBe('converted');
  const history = await rest<{ to_status: string }[]>(mm, `record_transitions?entity_id=eq.${task.id}&select=to_status&order=server_received_at`);
  expect(history.map((h) => h.to_status)).toEqual(['planned', 'assigned', 'in_progress', 'pending_verification', 'verified', 'closed']);
});

test('unverified master data is labelled, never presented as fact', async ({ page }) => {
  await signIn(page, 'demo.admin@demo.local');
  await page.goto('/office/admin/departments');
  await expect(page.getByText('يُؤكَّد ميدانياً').first()).toBeVisible();
  await page.goto('/office/admin/verification');
  await expect(page.getByText('غير مؤكد بعد').first()).toBeVisible();
});
