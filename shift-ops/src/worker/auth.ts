// Identity and authorization. In production every /api request must carry a valid Cloudflare Access JWT
// (verified here, not just trusted), then the email is authorized against D1 on every request, so a
// revoked viewer is denied on the very next request.
import type { Env } from './env';
import type { Me } from '../shared/types';

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let jwksCache: { at: number; keys: Jwk[]; domain: string } | null = null;

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function getKeys(domain: string, force = false): Promise<Jwk[]> {
  if (!force && jwksCache && jwksCache.domain === domain && Date.now() - jwksCache.at < 10 * 60000) return jwksCache.keys;
  const r = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`certs ${r.status}`);
  const j = (await r.json()) as { keys: Jwk[] };
  jwksCache = { at: Date.now(), keys: j.keys, domain };
  return j.keys;
}

export async function verifyAccessJwt(token: string, env: Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>, now = Date.now()): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { return null; }
  if (header.alg !== 'RS256') return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!env.ACCESS_AUD || !aud.includes(env.ACCESS_AUD)) return null;
  if (!payload.exp || payload.exp * 1000 < now) return null;
  if (payload.nbf && payload.nbf * 1000 > now + 60000) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  let keys = await getKeys(env.ACCESS_TEAM_DOMAIN);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await getKeys(env.ACCESS_TEAM_DOMAIN, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok || !payload.email) return null;
  return payload.email.toLowerCase();
}

function cookie(req: Request, name: string): string | null {
  const c = req.headers.get('cookie') ?? '';
  for (const p of c.split(/;\s*/)) { const i = p.indexOf('='); if (i > 0 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1)); }
  return null;
}

/** Verified email of the caller, or null. */
export async function authenticate(req: Request, env: Env): Promise<string | null> {
  if (env.AUTH_MODE === 'dev') {
    // Local development only: refused unless the request is to localhost.
    const host = new URL(req.url).hostname;
    if (!['localhost', '127.0.0.1'].includes(host)) return null;
    const e = req.headers.get('x-dev-email') ?? cookie(req, 'dev_email');
    return e ? e.toLowerCase() : null;
  }
  if (env.AUTH_MODE !== 'access' || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = req.headers.get('cf-access-jwt-assertion') ?? cookie(req, 'CF_Authorization');
  if (!token) return null;
  try { return await verifyAccessJwt(token, env); } catch { return null; }
}

export async function authorize(email: string, env: Env): Promise<Me | null> {
  const owner = (env.OWNER_EMAIL ?? '').toLowerCase().trim();
  if (owner && email === owner) return { email, role: 'owner', show_workers: true };
  const g = await env.DB.prepare('SELECT show_workers FROM access_grants WHERE email = ? AND revoked_at IS NULL').bind(email).first<{ show_workers: number }>();
  if (!g) return null;
  const global = await env.DB.prepare("SELECT value FROM settings WHERE key = 'show_workers_to_viewers'").first<{ value: string }>();
  return { email, role: 'viewer', show_workers: g.show_workers === 1 || global?.value === 'true' };
}
