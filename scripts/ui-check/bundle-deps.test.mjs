/**
 * نگهبان «ابزار بسته‌شده بعد از نصب باز می‌شود» — باگ دور ۴۳.
 *
 *   node scripts/ui-check/bundle-deps.test.mjs
 *
 * ── باگی که این تست قفل می‌کند ──────────────────────────────────────────
 * کاربر: «ابزار ریست بعد از نصب در لپ‌تاپ مشتری باز نمی‌شود».
 *
 * `stageTools()` در `scripts/build-desktop.mjs` فقط `tools/reset-ui` را
 * داخل بسته کاپی می‌کرد. ولی `reset-ui/server.mjs` این را دارد:
 *
 *     import { listenWithFallback, openBrowser } from '../shared/tool-server.mjs';
 *
 * بعد از نصب، `tools/shared/` نبود → Node با `ERR_MODULE_NOT_FOUND` می‌مرد
 * → پنجره‌ی cmd باز می‌شد و **فوراً بسته می‌شد**. مشتری فقط یک پلک دید.
 *
 * روی کمپیوتر توسعه دیده نمی‌شد چون `tools/shared/` همان‌جا هست. این تست
 * دقیقاً همان وضعیت «بعد از نصب» را بازسازی می‌کند: یک درخت جدا که فقط
 * شامل چیزی است که بسته‌بند کاپی می‌کند.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

/* ── ۱) آنچه بسته‌بند کاپی می‌کند را از خودِ کد بخوان (منبع حقیقت) ───── */
const buildSrc = read('scripts/build-desktop.mjs');
const listOf = (name) => {
  const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(buildSrc);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
};
const bundledTools = listOf('BUNDLED_TOOLS');
const bundledShared = listOf('BUNDLED_SHARED');

console.log('\n— فهرست کاپی —');
ok('BUNDLED_TOOLS تعریف شده', Array.isArray(bundledTools), String(bundledTools));
ok('BUNDLED_SHARED تعریف شده', Array.isArray(bundledShared), String(bundledShared));
ok('reset-ui در فهرست است', (bundledTools || []).includes('reset-ui'));
ok('ابزار فروشنده (license) کاپی نمی‌شود', !(bundledTools || []).includes('license'));

/* ── ۲) هر import نسبیِ ابزار، بعد از کاپی پیدا می‌شود؟ ──────────────── */
console.log('\n— وابستگی‌ها بعد از کاپی (همان چیزی که بعد از نصب می‌شود) —');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'bundledeps-'));
const staged = path.join(stage, 'tools');
fs.mkdirSync(staged, { recursive: true });
for (const name of [...(bundledTools || []), ...(bundledShared || [])]) {
  const from = path.join(root, 'tools', name);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(staged, name), { recursive: true });
}

const broken = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!/\.(mjs|js|cjs)$/i.test(e.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const re = /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
      const spec = m[1] || m[2];
      if (!fs.existsSync(path.resolve(path.dirname(full), spec))) {
        broken.push(`${path.relative(staged, full)} → ${spec}`);
      }
    }
  }
};
walk(staged);
ok('هیچ import نسبیِ شکسته‌ای نیست', broken.length === 0, broken.join(' | '));
ok('tools/shared/tool-server.mjs داخل بسته است', fs.existsSync(path.join(staged, 'shared', 'tool-server.mjs')));

/* ── ۳) نکته‌ی اصلی: رگرسیون نسخه‌ی قبل باید گرفته شود ──────────────── */
console.log('\n— رگرسیون: اگر shared کاپی نشود، تست باید قرمز شود —');
const brokenStage = fs.mkdtempSync(path.join(os.tmpdir(), 'bundledeps-broken-'));
for (const name of bundledTools || []) {
  const from = path.join(root, 'tools', name);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(brokenStage, name), { recursive: true });
}
const missing = [];
const walk2 = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk2(full); continue; }
    if (!/\.(mjs|js|cjs)$/i.test(e.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const re = /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text))) {
      if (!fs.existsSync(path.resolve(path.dirname(full), m[1]))) missing.push(m[1]);
    }
  }
};
walk2(brokenStage);
ok('بدون shared، وابستگی گمشده پیدا می‌شود', missing.length > 0, 'هیچ‌کدام — تست بی‌اثر است');
ok('همان tool-server.mjs است', missing.some((x) => x.includes('shared/tool-server')));

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(brokenStage, { recursive: true, force: true });

/* ── ۴) خودِ stageTools چک وابستگی دارد (نه فقط تست) ────────────────── */
console.log('\n— ساخت خودش هم چک می‌کند —');
/*
 * ⚠ نسخه‌ی اول این دو بررسی فقط وجود رشته‌ی `missingDeps` را می‌سنجید و با
 * حذف کردنِ خودِ چک هم سبز می‌ماند (تست خودم با خراب‌کردن عمدی این را
 * نشان داد). حالا «وجود» کافی نیست؛ باید چک **واقعاً خروجی را خراب کند**.
 */
ok('stageTools چک وابستگی دارد', /const missingDeps = \[\]/.test(buildSrc));
ok('چک، شکست را واقعاً برمی‌گرداند', /if \(missingDeps\.length\)[\s\S]{0,400}?return false;/.test(buildSrc));
ok('پیام خطا علت را می‌گوید', /ERR_MODULE_NOT_FOUND/.test(buildSrc));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
