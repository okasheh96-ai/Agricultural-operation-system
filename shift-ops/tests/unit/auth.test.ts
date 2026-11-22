import { describe, expect, it, vi, beforeAll } from 'vitest';
import { authenticate, verifyAccessJwt } from '../../src/worker/auth';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-123';
let priv: CryptoKey;
let jwk: JsonWebKey;
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString('base64url');
async function sign(payload: Record<string, unknown>, kid = 'k1') {
  const h = b64(JSON.stringify({ alg: 'RS256', kid }));
  const p = b64(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64(sig)}`;
}
beforeAll(async () => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  priv = kp.privateKey;
  jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1' }] }))));
});
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const good = () => ({ aud: [AUD], email: 'Owner@Example.com', iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 600 });

describe('Cloudflare Access JWT verification', () => {
  it('accepts a valid token and lower-cases the email', async () => {
    expect(await verifyAccessJwt(await sign(good()), env)).toBe('owner@example.com');
  });
  it('rejects wrong audience, issuer, expired tokens, unknown keys and tampering', async () => {
    expect(await verifyAccessJwt(await sign({ ...good(), aud: ['other'] }), env)).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...good(), iss: 'https://evil.example' }), env)).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...good(), exp: Math.floor(Date.now() / 1000) - 5 }), env)).toBeNull();
    expect(await verifyAccessJwt(await sign(good(), 'unknown'), env)).toBeNull();
    const t = await sign(good());
    const [h, , s] = t.split('.');
    expect(await verifyAccessJwt(`${h}.${b64(JSON.stringify({ ...good(), email: 'attacker@x.com' }))}.${s}`, env)).toBeNull();
  });
  it('production mode ignores the local dev identity header, even on localhost', async () => {
    const req = new Request('http://localhost/api/me', { headers: { 'x-dev-email': 'owner@example.com' } });
    expect(await authenticate(req, { ...env, AUTH_MODE: 'access' } as never)).toBeNull();
  });
  it('dev mode is refused on a non-local host', async () => {
    const req = new Request('https://shift-ops.example.workers.dev/api/me', { headers: { 'x-dev-email': 'owner@example.com' } });
    expect(await authenticate(req, { AUTH_MODE: 'dev' } as never)).toBeNull();
  });
  it('production mode with no Access configuration refuses everyone', async () => {
    const req = new Request('https://x.workers.dev/api/me', { headers: { 'cf-access-jwt-assertion': await sign(good()) } });
    expect(await authenticate(req, { AUTH_MODE: 'access', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' } as never)).toBeNull();
  });
});
