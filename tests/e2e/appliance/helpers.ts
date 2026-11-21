import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

export const PH_HOME = process.env.PH_HOME ?? '/home/user/ph-demo';
export const BASE = process.env.PH_URL ?? 'http://127.0.0.1:8090';
const PG_PORT = process.env.PH_PG_PORT ?? '54340';

/** SQL as the instance's database owner — only for reading back what the screens did (never to perform the step under test). */
export function sql(statement: string): string {
  return execFileSync('psql', ['-X', '-q', '-tA', '-h', process.env.PH_SQL_HOST ?? `${PH_HOME}/run`, '-p', PG_PORT, '-U', 'postgres',
    '-d', process.env.PH_SQL_DB ?? 'packhouse', '-c', statement], { encoding: 'utf8' }).trim();
}

export const DEMO_PW = process.env.PH_DEMO_PASSWORD ?? 'demo-password-123';

export async function signIn(page: Page, username: string, password = DEMO_PW) {
  await page.goto('/');
  await page.getByLabel(/اسم المستخدم أو البريد|Username or e-mail/).fill(username);
  await page.getByLabel(/كلمة المرور|Password/).first().fill(password);
  await page.getByRole('button', { name: /^(دخول|Sign in)$/ }).click();
  await page.waitForURL(/\/(ops|office|field)(\/|$)/);
}

export async function signOut(page: Page) {
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
}

export async function api<T>(token: string, fn: string, args: Record<string, unknown>): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

export async function token(username: string, password = DEMO_PW): Promise<string> {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: username, password }) });
  const j = (await res.json()) as { access_token: string };
  return j.access_token;
}

/** Read through the REST API as a signed-in person (row-level security applies), for checking what the screens did on any
 *  instance, including a hosted one whose database is not reachable from the test machine. */
export async function rest<T = Record<string, unknown>[]>(tok: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: { authorization: `Bearer ${tok}` } });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
