/**
 * نگهبان «import پویا روی ویندوز» — باگ دور ۴۳.
 *
 *   node scripts/ui-check/win-imports.test.mjs
 *
 * ── باگی که این تست قفل می‌کند ──────────────────────────────────────────
 * `npm test` روی ویندوز (test-windows در CI) با این می‌مرد:
 *
 *     Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in:
 *     file, data, and node are supported by the default ESM loader.
 *     On Windows, absolute paths must be valid file:// URLs.
 *     Received protocol 'd:'
 *
 * دو الگوی خراب که روی لینوکس **کاملاً سالم** کار می‌کنند و فقط روی ویندوز
 * می‌شکنند:
 *
 *   ۱) `await import(path.join(root, 'x.mjs'))`
 *      روی لینوکس مسیر `/home/...` است و Node آن را می‌پذیرد.
 *      روی ویندوز `D:\...` است و Node آن را به‌عنوان URL با پروتکل `d:`
 *      می‌خواند.
 *
 *   ۲) `await import(\`file://${path.join(...)}\`)`
 *      روی لینوکس `file:///home/...` درست است (چون مسیر با / شروع می‌شود).
 *      روی ویندوز `file://D:\...` می‌شود که URL معتبر نیست.
 *
 * راه درست در هر دو سیستم: `pathToFileURL(p).href`
 *
 * این تست فقط **الگو** را می‌بیند (بدون اجرا)، پس روی هر سه سیستم یکسان است.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

/** همه‌ی فایل‌های js/mjs/ts زیر پوشه‌های داده‌شده */
function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (['node_modules', '.git', 'dist', '.next'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(mjs|cjs|js|ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

const files = [
  ...walk(path.join(root, 'scripts')),
  ...walk(path.join(root, 'apps', 'api', 'test')),
  ...walk(path.join(root, 'apps', 'api', 'src')),
  ...walk(path.join(root, 'apps', 'web', 'src')),
];

console.log(`\n— ${files.length} فایل بررسی شد —`);

const barePath = [];
const twoSlash = [];

for (const f of files) {
  const rel = path.relative(root, f);
  /* خودِ این تست و فایل مستندات از بررسی خارج‌اند */
  if (rel.endsWith('win-imports.test.mjs')) continue;
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }

  const lines = text.split('\n');
  lines.forEach((line, i) => {
    /* ۱) import( <path.join|resolve|__dirname...> ) بدون pathToFileURL */
    if (/await\s+import\s*\(\s*(path\.(join|resolve)|__dirname|[\w.]+\s*\+\s*['"][/\\])/.test(line)) {
      barePath.push(`${rel}:${i + 1}`);
    }
    /* ۲) file:// + مسیر (دو اسلش، نه pathToFileURL) — مسیرهای fake در تست مسیر معاف‌اند */
    if (/file:\/\/\$\{/.test(line) && !/pathToFileURL/.test(line)) {
      twoSlash.push(`${rel}:${i + 1}`);
    }
  });
}

console.log('\n— import پویا با مسیر خام (روی ویندوز می‌شکند) —');
ok('هیچ `import(path.join(...))` خامی نیست', barePath.length === 0, barePath.slice(0, 8).join(', '));

console.log('\n— file:// با دو اسلش —');
ok('هیچ `file://${...}` خامی نیست', twoSlash.length === 0, twoSlash.slice(0, 8).join(', '));

/* ── اثبات این‌که الگوها واقعاً از هم قابل تفکیک‌اند ─────────────────── */
console.log('\n— خودِ سنجه درست کار می‌کند —');
const BAD = [
  "const m = await import(path.join(root, 'x.mjs'));",
  'const m = await import(`file://${path.join(root, "x.mjs")}`);',
];
const GOOD = [
  "const m = await import(pathToFileURL(path.join(root, 'x.mjs')).href);",
  "const m = await import('node:fs');",
  "const m = await import('react');",
];
const sawBare = BAD.filter((l) => /await\s+import\s*\(\s*(path\.(join|resolve)|__dirname)/.test(l));
const sawTwo = BAD.filter((l) => /file:\/\/\$\{/.test(l) && !/pathToFileURL/.test(l));
ok('الگوی خراب ۱ گرفته می‌شود', sawBare.length === 1, String(sawBare.length));
ok('الگوی خراب ۲ گرفته می‌شود', sawTwo.length === 1, String(sawTwo.length));
const falsePos = GOOD.filter((l) => /await\s+import\s*\(\s*(path\.(join|resolve)|__dirname)/.test(l) || (/file:\/\/\$\{/.test(l) && !/pathToFileURL/.test(l)));
ok('الگوهای سالم هشدار نمی‌دهند', falsePos.length === 0, falsePos.join(' | '));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
