import { expect, test, type Page } from '@playwright/test';

// A sign-in kept in the browser for someone the demo database does not know (left from an earlier demo version, whose
// demo people had other ids) must never trap the visitor on "Your account has no active role on this farm".

const NO_ROLE = 'حسابك لا يملك أي دور فعّال';

/** Signs in as the packing-house manager, then rewrites the kept sign-in to a person who does not exist in this database. */
async function keepStaleSignIn(page: Page) {
  await page.goto('/');
  await page.getByText('demo.ph.phm@demo.local', { exact: true }).click({ timeout: 120_000 });
  await page.waitForURL(/#\/office/);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('agri.auth') ?? '{}') as { user: { id: string } };
    s.user.id = '00000000-0000-4000-8000-000000000001';
    localStorage.setItem('agri.auth', JSON.stringify(s));
  });
}

test('an unknown signed-in person can sign out from the "no active role" screen', async ({ page }) => {
  await keepStaleSignIn(page);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(NO_ROLE, { timeout: 120_000 });
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page.getByText('demo.ph.pe@demo.local', { exact: true })).toBeVisible();
});

test('a new demo version drops the sign-in of the previous one and opens on the demo sign-in', async ({ page }) => {
  await keepStaleSignIn(page);
  await page.evaluate(() => localStorage.setItem('agri.browserDemo.build', 'an-earlier-demo-version'));
  await page.reload();
  await expect(page.getByText('demo.ph.pe@demo.local', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(NO_ROLE)).toHaveCount(0);
  // The demo people of this version sign in with their roles.
  await page.getByText('demo.ph.ll@demo.local', { exact: true }).click();
  await expect(page).toHaveURL(/#\/office\/packing-house$/);
  await page.getByRole('navigation', { name: 'مراحل سير العمل' }).getByRole('button', { name: /الإنتاج/ }).click();
  await expect(page.getByRole('article').first()).toBeVisible();
});
