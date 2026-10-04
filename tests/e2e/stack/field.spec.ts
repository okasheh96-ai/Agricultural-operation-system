import { expect, test } from '@playwright/test';
import { assignedTask, login, one, rest, rpc, signIn, sql } from './api';

const SUP = 'demo.supervisor@demo.local';
const MGR = 'demo.agri.manager@demo.local';

test('supervisor works offline: start, crew hours, done → syncs → awaiting verification', async ({ page, context }) => {
  const manager = await login(MGR);
  const title = `مهمة اختبار دون اتصال ${Date.now()}`;
  const task = await assignedTask(manager, SUP, title);

  await signIn(page, SUP);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('بيانات تجريبية', { exact: false }).first()).toBeVisible();
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'ابدأ' }).click();
  await expect(page.getByText('بانتظار المزامنة').first()).toBeVisible();
  await page.getByLabel('ساعات').first().fill('6');
  await page.getByRole('button', { name: 'تسجيل ساعات' }).click();
  await page.getByRole('button', { name: 'أنهيت المهمة' }).click();
  await expect(page.getByTestId('connectivity')).toContainText('غير متصل');
  expect((await one<{ status: string }>(manager, `tasks?id=eq.${task.id}&select=status`)).status).toBe('assigned');

  await context.setOffline(false);
  await expect.poll(async () => (await one<{ status: string }>(manager, `tasks?id=eq.${task.id}&select=status`)).status, { timeout: 20_000 })
    .toBe('pending_verification');
  const labour = await rest<{ hours: number; headcount: number }[]>(manager, `labour_entries?task_id=eq.${task.id}&select=hours,headcount`);
  expect(labour).toEqual([{ hours: 6, headcount: 6 }]);
  const history = await rest<{ to_status: string; device_id: string | null }[]>(manager, `record_transitions?entity_id=eq.${task.id}&select=to_status,device_id&order=server_received_at`);
  expect(history.map((h) => h.to_status)).toEqual(['assigned', 'in_progress', 'pending_verification']);
  expect(history[1]?.device_id).toBeTruthy();
});

test('an offline change the server rejects lands in the conflict queue with a readable reason', async ({ page, context }) => {
  const manager = await login(MGR);
  const title = `مهمة تعارض ${Date.now()}`;
  const task = await assignedTask(manager, SUP, title);

  await signIn(page, SUP);
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'ابدأ' }).click();
  // Meanwhile the planner cancels the task on the server.
  await rpc(manager, 'transition_record', { p_entity_type: 'tasks', p_id: task.id, p_to_status: 'cancelled', p_comment: 'أُلغيت لسوء الطقس' });
  await context.setOffline(false);
  await expect(page.getByRole('alert')).toContainText('رفضه الخادم', { timeout: 20_000 });
  await expect(page.getByRole('alert')).toContainText('cancelled');
  const conflicts = await rest<{ reason_code: string }[]>(await login(SUP), `sync_conflicts?entity_id=eq.${task.id}&select=reason_code`);
  expect(conflicts).toEqual([{ reason_code: 'P0422' }]);
});

test('blocked task with reason appears on the Operations board and escalates per configured rule', async ({ page }) => {
  const manager = await login(MGR);
  const title = `مهمة متوقفة ${Date.now()}`;
  const task = await assignedTask(manager, SUP, title);

  await signIn(page, SUP);
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await page.getByRole('button', { name: 'توقف — مع السبب' }).click();
  await page.getByRole('button', { name: 'معدة/آلية غير متاحة' }).click();
  await page.getByLabel('ملاحظة (اختياري)').fill('الجرار التجريبي معطل');
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(async () => (await one<{ status: string }>(manager, `tasks?id=eq.${task.id}&select=status`)).status).toBe('blocked');

  // Test-only escalation fixture (production ships unconfigured); the scheduler run is what pg_cron does.
  const farm = sql(`select id from farms where code = 'DEMO'`);
  sql(`insert into escalation_rules (farm_id, entity_type, condition, max_priority, after_minutes, notify_role_id)
       select '${farm}', 'tasks', 'blocked', 4, 1, id from roles where farm_id = '${farm}' and code = 'operations_manager'
       and not exists (select 1 from escalation_rules where farm_id = '${farm}' and condition = 'blocked')`);
  // History is immutable; the fixture bypasses triggers to age the block by five minutes.
  sql(`set session_replication_role = replica; update record_transitions set server_received_at = now() - interval '5 minutes' where entity_id = '${task.id}' and to_status = 'blocked'`);
  expect(Number(sql('select app.run_escalations()'))).toBeGreaterThanOrEqual(1);

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, 'demo.ops@demo.local');
  await page.goto('/office/operations?bucket=blocked');
  const row = page.getByRole('row', { name: new RegExp(title) });
  await expect(row).toContainText('معدة/آلية غير متاحة');
  await expect(row).toContainText('الجرار التجريبي معطل');
  await page.goto('/office/notifications');
  await expect(page.getByText('تصعيد: مهمة متوقفة').first()).toBeVisible();
});
