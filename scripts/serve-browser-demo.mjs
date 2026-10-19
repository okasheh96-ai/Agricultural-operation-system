// Serves the in-browser demo (.local/browser-demo) for local testing: the page wrapped in a document the way the artifact
// host wraps it, plus its files. BROWSER_DEMO_CSP=artifact sends a Content-Security-Policy like the artifact host's
// published rules (own files, inline scripts and the allowed CDNs; no network); =artifact-wasm also allows WebAssembly.
// Usage: node scripts/serve-browser-demo.mjs [port]   (default 4175)
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../.local/browser-demo');
const PORT = Number(process.argv[2] ?? 4175);
const TYPES = { '.html': 'text/html; charset=utf-8', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };
const cdns = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com';
const mode = process.env.BROWSER_DEMO_CSP ?? '';
const csp = mode.startsWith('artifact')
  ? `default-src 'self'; script-src 'self' 'unsafe-inline' ${cdns}${mode === 'artifact-wasm' ? " 'wasm-unsafe-eval'" : ''}; ` +
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; ` +
    `connect-src 'self' blob: data:; worker-src 'self' blob:`
  : null;

// /host: a page on another origin (localhost vs 127.0.0.1) that shows the demo in a sandboxed frame, as the artifact host does.
const host = (port) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>host</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%}</style></head>
<body><iframe title="demo" src="http://127.0.0.1:${port}/" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe></body></html>`;

http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (path === '/host') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(host(PORT));
    return;
  }
  const file = path === '/' ? 'preview/index.html' : path === '/standalone' ? 'standalone/index.html' : normalize(join('site', path));
  const full = join(ROOT, file);
  if (!full.startsWith(ROOT) || !existsSync(full)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(full)] ?? 'application/octet-stream', ...(csp ? { 'content-security-policy': csp } : {}) });
  res.end(readFileSync(full));
}).listen(PORT, () => console.log(`browser demo on http://127.0.0.1:${PORT} ${csp ? `(CSP: ${mode})` : ''}`));
