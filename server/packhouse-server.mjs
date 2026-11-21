// Packhouse server: serves the app, signs people in, and passes API calls to PostgREST. No AI service, no external calls.
//
//   /              the built app (same origin, so no CORS)
//   /auth/v1/*     sign-in, token refresh, current user, sign-out (the subset of the Supabase Auth API the app uses)
//   /api/activate  first sign-in with a one-time activation code (the person chooses their password)
//   /api/health    database + API check
//   /rest/v1/*     PostgREST (it verifies every token; app.po_pre_request() checks the session on every call)
//
// Passwords are checked inside PostgreSQL (bcrypt, pgcrypto) by functions only the po_auth role may call. This process holds the
// token-signing secret and the po_server database password, both read from the instance's private config file.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';

const cfgPath = process.env.PH_CONFIG ?? '';
const cfg = cfgPath && existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const env = (k, d) => process.env[k] ?? cfg[k] ?? d;

const HTTP_HOST = env('PH_HTTP_HOST', '127.0.0.1');
const HTTP_PORT = Number(env('PH_HTTP_PORT', 8080));
const HTTPS_PORT = Number(env('PH_HTTPS_PORT', 8443));
const TLS_CERT = env('PH_TLS_CERT', '');
const TLS_KEY = env('PH_TLS_KEY', '');
const REST_URL = new URL(env('PH_REST_URL', 'http://127.0.0.1:3001'));
const STATIC = resolve(env('PH_STATIC', 'dist'));
const JWT_SECRET = env('PH_JWT_SECRET', '');
const ANON_PLACEHOLDER = 'packhouse-anon';
const ACCESS_SECONDS = Number(env('PH_ACCESS_SECONDS', 600));
const BACKUP_DIR = env('PH_BACKUP_DIR', '');
const BACKUP_HOURS = Number(env('PH_BACKUP_HOURS', 6));
const BACKUP_KEEP = Number(env('PH_BACKUP_KEEP', 28));
const PGBIN = env('PH_PGBIN', '');

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('PH_JWT_SECRET (32+ characters) is required; run scripts/packhouse.sh install');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: env('PH_DB_URL', ''), max: 5 });

// ---------------------------------------------------------------------------------------------
// Tokens (HS256, verified by PostgREST with the same secret)
// ---------------------------------------------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function signJwt(claims) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = String(token ?? '').split('.');
  if (!h || !b || !s) return null;
  const expect = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest());
  const a = Buffer.from(s); const e = Buffer.from(expect);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  const claims = JSON.parse(Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  if (typeof claims.exp === 'number' && claims.exp < Date.now() / 1000) return null;
  return claims;
}
function sessionBody(r) {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: r.user_id, aud: 'authenticated', role: 'authenticated', email: r.email ?? `${r.username}@packhouse.local`, phone: '',
    app_metadata: { provider: 'packhouse', providers: ['packhouse'] },
    user_metadata: { username: r.username, must_change_password: !!r.must_change_password },
    identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_anonymous: false,
  };
  const access = signJwt({ aud: 'authenticated', role: 'authenticated', sub: r.user_id, session_id: r.session_id, email: user.email,
    iat: now, exp: now + ACCESS_SECONDS, iss: 'packhouse-server', user_metadata: user.user_metadata });
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_SECONDS, expires_at: now + ACCESS_SECONDS, refresh_token: r.refresh_token, user };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(self), geolocation=(), microphone=()',
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; " +
    "connect-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
function send(res, status, body, extra = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra });
  res.end(text);
}
const authError = (res, code, msg, status = 400) => send(res, status, { code: status, error_code: code, msg });
async function readJson(req, limit = 64 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('too large'); chunks.push(c); }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}
const clientIp = (req) => req.socket.remoteAddress ?? '';
async function db(sql, args) {
  const r = await pool.query(sql, args);
  return r.rows[0];
}

// Sign-in throttle per address (the database also locks an account after repeated failures).
const attempts = new Map();
function throttled(ip) {
  const now = Date.now(); const w = attempts.get(ip) ?? [];
  const recent = w.filter((t) => now - t < 60_000);
  recent.push(now); attempts.set(ip, recent);
  return recent.length > 20;
}

// ---------------------------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------------------------
async function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, '');
  if (path === '/health' || path === '/settings') return send(res, 200, { name: 'packhouse-server' });
  if (path === '/token' && req.method === 'POST') {
    const body = await readJson(req);
    if (url.searchParams.get('grant_type') === 'password') {
      if (throttled(clientIp(req))) return authError(res, 'over_request_rate_limit', 'Too many attempts; wait a minute', 429);
      const login = String(body.email ?? body.username ?? body.phone ?? '').trim();
      const row = await db('select public.po_sign_in($1, $2, $3, $4) as r', [login, String(body.password ?? ''), req.headers['user-agent'] ?? null, clientIp(req)]);
      const r = row.r;
      if (!r.ok) return authError(res, r.error === 'locked' ? 'user_locked' : 'invalid_credentials', r.error === 'locked' ? 'Account locked for a while' : 'Invalid login credentials');
      return send(res, 200, sessionBody(r));
    }
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const r = (await db('select public.po_refresh($1) as r', [String(body.refresh_token ?? '')])).r;
      if (!r.ok) return authError(res, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      return send(res, 200, sessionBody(r));
    }
    return authError(res, 'unsupported_grant_type', 'Unsupported grant type');
  }
  const claims = verifyJwt((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  if (path === '/user' && req.method === 'GET') {
    if (!claims?.session_id) return authError(res, 'bad_jwt', 'invalid JWT', 401);
    const r = (await db('select public.po_session_user($1) as r', [claims.session_id])).r;
    if (!r) return authError(res, 'session_not_found', 'Session not found', 403);
    return send(res, 200, sessionBody({ ...r, session_id: claims.session_id, refresh_token: '' }).user);
  }
  if (path === '/logout' && req.method === 'POST') {
    if (claims?.session_id) await db('select public.po_sign_out($1)', [claims.session_id]);
    res.writeHead(204, SECURITY_HEADERS); return res.end();
  }
  return authError(res, 'not_found', 'Not found', 404);
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    try {
      await db('select 1');
      const rest = await fetch(new URL('/', REST_URL)).then((r) => r.status).catch(() => 0);
      return send(res, rest ? 200 : 503, { database: 'ok', api: rest ? 'ok' : 'down', time: new Date().toISOString() });
    } catch (e) {
      return send(res, 503, { database: 'down', error: String(e.message ?? e) });
    }
  }
  if (url.pathname === '/api/activate' && req.method === 'POST') {
    if (throttled(clientIp(req))) return authError(res, 'over_request_rate_limit', 'Too many attempts; wait a minute', 429);
    const b = await readJson(req);
    try {
      const r = (await db('select public.po_activate($1, $2, $3) as r', [String(b.username ?? ''), String(b.code ?? ''), String(b.new_password ?? '')])).r;
      return send(res, r.ok ? 200 : 400, r);
    } catch (e) {
      return send(res, 400, { ok: false, error: e.code === 'P0422' ? 'weak_password' : 'failed', detail: e.detail ?? null });
    }
  }
  return send(res, 404, { error: 'not found' });
}

// ---------------------------------------------------------------------------------------------
// API proxy → PostgREST (the anonymous placeholder key is dropped so PostgREST uses the anon role)
// ---------------------------------------------------------------------------------------------
function proxyRest(req, res, url) {
  const headers = { ...req.headers, host: REST_URL.host, connection: 'close' };
  delete headers.apikey;
  if ((headers.authorization ?? '').replace(/^Bearer\s+/i, '') === ANON_PLACEHOLDER) delete headers.authorization;
  const up = http.request({ host: REST_URL.hostname, port: REST_URL.port, method: req.method, path: url.pathname.replace(/^\/rest\/v1/, '') + url.search,
                            headers, agent: false }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, ...SECURITY_HEADERS });
    r.pipe(res);
  });
  up.on('error', () => send(res, 502, { message: 'API unavailable' }));
  req.pipe(up);
}

// ---------------------------------------------------------------------------------------------
// Static app with SPA fallback
// ---------------------------------------------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let file = normalize(join(STATIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC)) return send(res, 400, 'bad path');
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC, 'index.html');
  if (!existsSync(file)) return send(res, 503, 'The app is not built yet: run scripts/packhouse.sh install');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const immutable = /\/assets\//.test(file);
  res.writeHead(200, { 'content-type': type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', ...SECURITY_HEADERS });
  createReadStream(file).pipe(res);
}

async function handler(req, res) {
  const url = new URL(req.url ?? '/', 'http://local');
  try {
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/rest/v1')) return proxyRest(req, res, url);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(new Date().toISOString(), req.method, url.pathname, e.code ?? '', e.message);
    return send(res, 500, { message: 'Server error' });
  }
}

// ---------------------------------------------------------------------------------------------
// Scheduled backups: database (records, photos, settings, accounts) as a pg_dump custom archive, rotated
// ---------------------------------------------------------------------------------------------
function backupNow() {
  if (!BACKUP_DIR || !PGBIN) return;
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const out = join(BACKUP_DIR, `packhouse-${stamp}.dump`);
  const p = spawn(join(PGBIN, 'pg_dump'), ['-Fc', '-f', out, env('PH_DUMP_URL', '')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => {
    if (code !== 0) { console.error('backup failed', err.trim()); rmSync(out, { force: true }); return; }
    console.log('backup written', out);
    const dumps = readdirSync(BACKUP_DIR).filter((f) => /^packhouse-.*\.dump$/.test(f)).sort();
    for (const f of dumps.slice(0, Math.max(0, dumps.length - BACKUP_KEEP))) rmSync(join(BACKUP_DIR, f), { force: true });
  });
}
if (BACKUP_DIR && BACKUP_HOURS > 0) setInterval(backupNow, BACKUP_HOURS * 3600_000).unref();

http.createServer(handler).listen(HTTP_PORT, HTTP_HOST, () => console.log(`packhouse server: http://${HTTP_HOST}:${HTTP_PORT}`));
if (TLS_CERT && TLS_KEY && existsSync(TLS_CERT) && existsSync(TLS_KEY)) {
  https.createServer({ cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) }, (req, res) => {
    res.setHeader('strict-transport-security', 'max-age=31536000');
    return handler(req, res);
  }).listen(HTTPS_PORT, '0.0.0.0', () => console.log(`packhouse server (private network): https://0.0.0.0:${HTTPS_PORT}`));
}
process.on('SIGTERM', () => { pool.end().finally(() => process.exit(0)); });
