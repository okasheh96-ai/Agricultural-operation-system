// Dev-only gateway: one base URL like hosted Supabase. /auth/v1 → Auth (GoTrue), /rest/v1 → PostgREST.
import http from 'node:http';

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const routes = [
  { prefix: '/auth/v1', port: Number(process.env.AUTH_PORT ?? 9999) },
  { prefix: '/rest/v1', port: Number(process.env.REST_PORT ?? 3001) },
];

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, content-location',
};

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      // Echo whatever headers the client asks for (supabase-js adds e.g. x-retry-count on retries), like hosted Supabase.
      const asked = req.headers['access-control-request-headers'];
      res.writeHead(204, { ...cors, ...(asked ? { 'access-control-allow-headers': asked } : {}), 'access-control-max-age': '600' });
      res.end();
      return;
    }
    const route = routes.find((r) => req.url?.startsWith(r.prefix));
    if (!route || !req.url) {
      res.writeHead(404, cors);
      res.end('not found');
      return;
    }
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: route.port,
        method: req.method,
        path: req.url.slice(route.prefix.length) || '/',
        headers: { ...req.headers, host: `127.0.0.1:${route.port}` },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors });
        up.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      res.writeHead(502, cors);
      res.end(`upstream error: ${e.message}`);
    });
    req.pipe(upstream);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`gateway http://127.0.0.1:${PORT}`));
