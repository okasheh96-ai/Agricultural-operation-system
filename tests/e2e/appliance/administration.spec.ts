import { expect, test } from '@playwright/test';
import { rest, signIn, token } from './helpers';

test('tablet administrator creates a department and imports production lines with review and database read-back', async ({page}) => {
  const suffix = Date.now().toString(36).toUpperCase();
  await page.setViewportSize({width:820, height:1180});
  await signIn(page, 'demo.owner');
  await page.getByRole('button', {name:'English', exact:true}).click();
  await page.goto('/ops/settings/departments');
  await page.getByRole('button', {name:'Add department'}).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code', {exact:true}).fill('DEPT_' + suffix);
  await dialog.getByLabel('Arabic name').fill('قسم الاختبار');
  await dialog.getByLabel('English name').fill('Verification department');
  await dialog.getByLabel('Type').selectOption('service');
  await dialog.getByRole('button', {name:'Save',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole('searchbox').fill(suffix);
  await expect(page.getByRole('row').filter({hasText:'DEPT_' + suffix})).toContainText('Verification department');
  const auth = await token('demo.owner');
  expect(await rest(auth,'departments?code=eq.DEPT_' + suffix + '&select=kind')).toEqual([{kind:'service'}]);

  await page.goto('/ops/settings/master');
  await page.getByRole('tab', {name:'Production lines'}).click();
  await page.getByRole('button', {name:'Import CSV'}).click();
  dialog = page.getByRole('dialog');
  const line = 'L_' + suffix;
  const csv = 'code,name_ar,name_en,kind\r\n' + line + ',خط اختبار,"Line, test",manual';
  const file = (content:string) => ({name:'lines.csv',mimeType:'text/csv',buffer:Buffer.from(content)});
  await dialog.getByLabel('CSV file').setInputFiles(file(csv + '\r\n' + line + ',خط,Duplicate,manual'));
  await expect(dialog.getByText('Duplicate code')).toBeVisible();
  await expect(dialog.getByRole('button', {name:'Submit records for approval'})).toBeDisabled();
  await dialog.getByLabel('CSV file').setInputFiles(file(csv));
  await expect(dialog.getByText('Ready', {exact:true})).toBeVisible();
  expect(await rest(auth,'ph_lines?code=eq.' + line + '&select=id')).toEqual([]);
  await dialog.getByRole('button', {name:'Submit records for approval'}).click();
  await expect(dialog.getByRole('status')).toContainText('Saved 1');
  expect(await rest(auth,'ph_lines?code=eq.' + line + '&select=name_en,verification_status')).toEqual([
    {name_en:'Line, test', verification_status:'not_yet_verified'},
  ]);
});

test('first sign-in deep link shows the activation form on a phone', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.goto('/?setup=1');
  await expect(page.getByLabel('رمز التفعيل')).toBeVisible();
  await page.getByRole('button', {name:/العودة|الرجوع/}).click();
  await expect(page.getByLabel(/اسم المستخدم أو البريد/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/اسم المستخدم أو البريد/)).toBeVisible();
});
