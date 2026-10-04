import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

const BASE = 'http://127.0.0.1:54321';
export const PASSWORD = 'demo-password-123';
const ANON = /ANON_KEY=(.*)/.exec(readFileSync('.local/secrets.env', 'utf8'))?.[1] ?? '';

export interface Session { token: string; userId: string }

export async function login(email: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: json.access_token, userId: json.user.id };
}

export async function rest<T>(s: Session, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: { apikey: ANON, authorization: `Bearer ${s.token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const rpc = <T>(s: Session, fn: string, args: Record<string, unknown>) => rest<T>(s, `rpc/${fn}`, { method: 'POST', body: args });

export async function one<T>(s: Session, path: string): Promise<T> {
  const rows = await rest<T[]>(s, path);
  if (!rows[0]) throw new Error(`no row for ${path}`);
  return rows[0];
}

/** Runs SQL as the database owner — only for what a scheduler or a test fixture would do. */
export function sql(statement: string): string {
  return execFileSync('psql', ['-X', '-q', '-tA', '-h', `${process.cwd()}/.local/run`, '-p', '54322', '-U', 'postgres', '-d', 'agri', '-c', statement], { encoding: 'utf8' }).trim();
}

/** Creates a task in the demo farm's Agriculture department and assigns it, through the real API. */
export async function assignedTask(manager: Session, supervisorEmail: string, title: string, departmentCode = 'agriculture', typeCode = 'general') {
  const dept = await one<{ id: string; farm_id: string }>(manager, `departments?code=eq.${departmentCode}&select=id,farm_id`);
  const type = await one<{ id: string }>(manager, `task_types?code=eq.${typeCode}&select=id`);
  const loc = await one<{ id: string }>(manager, 'locations?code=eq.DEMO-H4&select=id');
  const crew = await one<{ id: string }>(manager, 'crews?code=eq.DEMO-CREW-A&select=id');
  const sup = await one<{ id: string }>(manager, `user_profiles?select=id,full_name&id=eq.${(await login(supervisorEmail)).userId}`);
  const [task] = await rest<{ id: string; code: string }[]>(manager, 'tasks', {
    method: 'POST',
    body: { farm_id: dept.farm_id, department_id: dept.id, task_type_id: type.id, location_id: loc.id, crew_id: crew.id, title, planned_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date()) },
  });
  if (!task) throw new Error('task not created');
  await rpc(manager, 'transition_record', { p_entity_type: 'tasks', p_id: task.id, p_to_status: 'assigned', p_payload: { supervisor_id: sup.id } });
  return task;
}

export async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL(/\/(field|office)\//);
}
