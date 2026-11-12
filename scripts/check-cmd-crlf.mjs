/**
 * بررسی پایان‌خط فایل‌های `.cmd`/`.bat` — جایگزین چک شکننده‌ی bash در CI.
 *
 *   node scripts/check-cmd-crlf.mjs
 *
 * ── چرا این فایل (دور ۴۳) ────────────────────────────────────────────────
 * در `.github/workflows/ci.yml` این چک بود:
 *
 *     for f in tools/*\/start.cmd; do
 *       if ! grep -q $'\r' "$f"; then ... fail=1; fi
 *     done
 *
 * و **از دور ۴۰ که اضافه شد، یک بار هم سبز نشد** — روی هر اجرا قرمز بود،
 * در حالی که همان فایل‌ها روی لینوکس CRLF داشتند. یعنی چک، خودش ابزار
 * خرابی بود که به همه می‌گفت «فایل‌ها خراب‌اند». این بدترین نوع تست است:
 * سیگنالی که همیشه قرمز است، هیچ‌کس دیگر به آن نگاه نمی‌کند.
 *
 * حالا با Node خوانده می‌شود: یک ابزار، روی هر سیستم، با پیام دقیق.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tools');

/** همه‌ی فایل‌های .cmd/.bat زیر tools/ (به‌صورت بازگشتی) */
function findCmdFiles(d) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) out.push(...findCmdFiles(full));
    else if (/\.(cmd|bat)$/i.test(e.name)) out.push(full);
  }
  return out;
}

const files = findCmdFiles(dir);

console.log('\n— پایان‌خط فایل‌های cmd —');
if (!files.length) {
  console.log('  ⚠ هیچ فایل .cmd/.bat در tools/ پیدا نشد — چک بی‌معنا می‌شود.');
  console.log('    (اگر ابزارهای ویندوزی حذف شده‌اند این درست است؛ وگرنه مسیر را ببینید.)\n');
  process.exit(0);
}

let bad = 0;
for (const f of files) {
  const rel = path.relative(root, f);
  const buf = fs.readFileSync(f);
  const text = buf.toString('latin1');

  /* خطوط جدا‌شده با \n که \r ندارند = خط LF تنها */
  const lines = text.split('\n');
  const lfOnly = [];
  for (let i = 0; i < lines.length; i++) {
    const isLast = i === lines.length - 1 && lines[i] === '';
    if (isLast) continue;
    if (!lines[i].endsWith('\r')) lfOnly.push(i + 1);
  }

  if (lfOnly.length === 0) {
    console.log(`  ✔ ${rel} — همه‌ی خطوط CRLF`);
  } else {
    bad++;
    console.log(`  ✘ ${rel} — ${lfOnly.length} خط با پایان‌خط LF تنها`);
    console.log(`     خطوط: ${lfOnly.slice(0, 12).join(', ')}${lfOnly.length > 12 ? ' …' : ''}`);
    console.log('     cmd.exe با LF می‌شکند (باگ دور ۳۶). .gitattributes باید *.cmd را CRLF کند.');
  }
}

if (bad) {
  console.log(`\n⛔ ${bad} فایل مشکل دارد\n`);
  process.exit(1);
}
console.log(`\n✅ ${files.length} فایل سالم\n`);
