/**
 * In-browser demo only. Answers the Supabase client's Auth calls (/auth/v1) for the demo people stored in the demo
 * database: password sign-in, token refresh, current user and sign-out. The password is checked by the database
 * (auth.browser_demo_sign_in). Tokens are unsigned: the database lives in this browser, so this is a demo sign-in that
 * decides which demo person you act as, not a security boundary. Server deployments use Supabase Auth.
 */
import type { PGlite } from '@electric-sql/pglite';

interface DemoUser { id: string; email: string; created_at: string }

const SESSION_SECONDS = 24 * 60 * 60;

function b64url(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(part: string): string {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function randomId(): string {
  return crypto.randomUUID();
}

function userJson(u: DemoUser) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '',
    email_confirmed_at: u.created_at, confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
    created_at: u.created_at, updated_at: u.created_at, is_anonymous: false,
  };
}

function session(u: DemoUser) {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = randomId();
  const claims = { aud: 'authenticated', role: 'authenticated', sub: u.id, email: u.email, iat: now, exp: now + SESSION_SECONDS, session_id: sessionId };
  const token = `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.browser-demo`;
  return {
    access_token: token, token_type: 'bearer', expires_in: SESSION_SECONDS, expires_at: now + SESSION_SECONDS,
    refresh_token: `${u.id}.${randomId()}`, user: userJson(u),
  };
}

/** Claims of a token issued above; null for the anon key or no token. Throws 'expired' for an expired session. */
export function claimsOf(authorization: string | null, anonKey: string): Record<string, unknown> | null {
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token || token === anonKey) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  const claims = JSON.parse(fromB64url(payload)) as Record<string, unknown>;
  if (typeof claims.exp === 'number' && claims.exp < Date.now() / 1000) throw new Error('expired');
  return claims;
}

export interface AuthResult { status: number; body?: unknown }

const invalid = { status: 400, body: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };

export async function handleAuth(db: PGlite, path: string, search: URLSearchParams, headers: Headers, body: unknown, anonKey: string): Promise<AuthResult> {
  const input = (body ?? {}) as Record<string, unknown>;
  if (path === 'token' && search.get('grant_type') === 'password') {
    const res = await db.query<DemoUser>('select id, email, created_at from auth.browser_demo_sign_in($1, $2)',
      [String(input.email ?? ''), String(input.password ?? '')]);
    const u = res.rows[0];
    return u ? { status: 200, body: session(u) } : invalid;
  }
  if (path === 'token' && search.get('grant_type') === 'refresh_token') {
    const id = String(input.refresh_token ?? '').split('.')[0] ?? '';
    const res = /^[0-9a-f-]{36}$/.test(id) ? await db.query<DemoUser>('select id, email, created_at from auth.browser_demo_user($1)', [id]) : null;
    const u = res?.rows[0];
    return u ? { status: 200, body: session(u) } : { status: 400, body: { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' } };
  }
  if (path === 'user') {
    let claims: Record<string, unknown> | null = null;
    try { claims = claimsOf(headers.get('authorization'), anonKey); } catch { claims = null; }
    const res = claims?.sub ? await db.query<DemoUser>('select id, email, created_at from auth.browser_demo_user($1)', [String(claims.sub)]) : null;
    const u = res?.rows[0];
    return u ? { status: 200, body: userJson(u) } : { status: 401, body: { code: 401, error_code: 'no_authorization', msg: 'This endpoint requires a valid session' } };
  }
  if (path === 'logout') return { status: 204 };
  return { status: 404, body: { code: 404, error_code: 'not_found', msg: `The in-browser demo does not provide /auth/v1/${path}` } };
}
