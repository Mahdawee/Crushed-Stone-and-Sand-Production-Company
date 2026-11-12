/**
 * بررسی نحوی همه‌ی فایل‌های اجرایی مخزن.
 *
 *   node scripts/ui-check/js-syntax.test.mjs
 *
 * ── چرا این تست (دور ۳۹) ────────────────────────────────────────────────
 * `npm run desktop:build` روی کمپیوتر کاربر با «SyntaxError: Unexpected
 * token» مرد، در کامنتِ تابع stageTools.
 *
 * ریشه: در یک کامنت بلوکی، دنباله‌ی «ستاره + اسلش» کامنت را همان‌جا تمام
 * می‌کند. من الگوی glob را عیناً در کامنت نوشته بودم، پس کامنت نیمه‌کاره بسته
 * شد و بقیه‌ی متن به‌عنوان کد تفسیر شد. یک اشتباه نوشتاری که **هیچ تستی**
 * نمی‌گرفت، چون آن تست‌ها فایل را فقط با readFileSync می‌خواندند و هیچ‌وقت
 * import/check نمی‌کردند.
 *
 * حالا هر فایل .mjs/.js/.cjs مخزن (جز خروجی‌های ساخت) با `node --check`
 * بررسی می‌شود. ارزان است و همین کلاس خطا را برای همیشه می‌بندد.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* خروجی ساخت و وابستگی‌ها: نه منبع‌اند نه مال ما */
const SKIP = /(^|\/)(node_modules|\.git|dist|target|coverage)(\/|$)|^src-tauri\/(api|tools)\//;

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if (SKIP.test(rel)) continue;
    if (entry.isDirectory()) { walk(abs); continue; }
    /* فایل‌های .js در apps/web بسته‌ی Vite هستند؛ آن‌ها هم بررسی می‌شوند */
    if (/\.(mjs|cjs|js)$/.test(entry.name)) files.push(rel);
  }
})(root);

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

const broken = [];
for (const rel of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'pipe' });
  } catch (e) {
    const msg = String(e.stderr || '').split('\n').find((l) => /Error|error/.test(l)) || 'خطای نحوی';
    broken.push(`${rel} → ${msg.trim()}`);
  }
}
console.log('\n— بررسی نحوی همه‌ی فایل‌های اجرایی —');
console.log(`  ${broken.length ? '✘' : '✔'} ${files.length} فایل بررسی شد`);
if (broken.length) {
  fail++;
  console.log('  ناکام:');
  for (const b of broken) console.log(`   • ${b}`);
} else pass++;

/*
 * ── تله‌ی مشخص دور ۳۹ ────────────────────────────────────────────────────
 * مهم‌ترین فایل همین `build-desktop.mjs` است (اجرای `desktop:build`).
 * صریح بررسی می‌شود که الگوی glob در کامنت بلوکی **عیناً** نوشته نشده باشد،
 * حتی اگر امروز نحوش درست باشد — چون یک ادیت بعدی دوباره می‌شکندش.
 */
console.log('\n— الگوی glob داخل کامنت بلوکی (تله‌ی دور ۳۹) —');
{
  const suspects = [];
  for (const rel of files) {
    if (/^(scripts|tools)\//.test(rel) === false && !rel.startsWith('apps/api/src')) continue;
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    // هر کامنت بلوکی که در متنش دنباله‌ی «ستاره + اسلش» آمده = تله
    const blocks = src.match(/\/\*[\s\S]*?\*\//g) || [];
    for (const b of blocks) {
      // دو کاراکتر آخر، خودِ بسته‌شدن است؛ فقط متن داخل بررسی می‌شود
      const inner = b.slice(2, -2);
      if (inner.includes('**/') || inner.includes('/*/')) suspects.push(rel);
    }
  }
  const uniq = [...new Set(suspects)];
  ok('هیچ کامنت بلوکی الگوی glob را عیناً در خود ندارد', uniq.length === 0, uniq.join(', '));
  if (uniq.length === 0) console.log('  ✔ هیچ کامنت بلوکی الگوی glob را عیناً در خود ندارد');
  else console.log(`  ✘ ${uniq.join(', ')}`);
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
