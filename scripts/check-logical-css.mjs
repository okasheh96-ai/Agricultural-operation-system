// Fails if physical-direction CSS utilities appear in src (Master Prompt §3.9: logical properties only).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const banned = /(?<![\w-])(?:-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr)-[\w[\]./-]+|text-left|text-right|float-left|float-right)(?![\w-])/g;
const cssBanned = /\b(?:margin|padding)-(?:left|right)\b|\b(?:left|right)\s*:/g;
const bad = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(name)) {
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const re = name.endsWith('.css') ? cssBanned : banned;
        for (const m of line.matchAll(re)) bad.push(`${p}:${i + 1}: ${m[0]}`);
      });
    }
  }
}
walk('src');
if (bad.length) {
  console.error('Physical left/right styling found; use logical properties (ms/me/ps/pe/start/end):\n' + bad.join('\n'));
  process.exit(1);
}
console.log('logical-css: ok');
