/**
 * بازرسی «بسته‌ی ساخته‌شده» — نه تنظیمات، خودِ فایل نصبی.
 *
 *   node scripts/verify-bundle.mjs [--bundle <پوشه>]
 *
 * ── چرا این فایل (پیشنهاد A1، دور ۴۰) ──────────────────────────────────
 * تا امروز همه‌ی بررسی‌های بسته‌بندی **از روی `tauri.conf.json`** استدلال
 * می‌کردند: «الگو چنین است، پس ابزار لایسنس در بسته نیست». این استدلال فقط
 * تا وقتی درست است که الگوها همان‌طور که فکر می‌کنیم حل شوند — و دور ۳۶ دقیقاً
 * همین‌جا شکست (الگو هیچ فایلی پیدا نمی‌کرد و کسی نفهمید).
 *
 * این اسکریپت بعد از `npm run desktop:build` اجرا می‌شود و **فایل نصبی** را
 * باز می‌کند:
 *   • NSIS (.exe)  → با دیکشنری string‌های 7-Zip خوانده می‌شود (بدون وابستگی)
 *   • MSI           → با `msiexec /a` روی ویندوز، وگرنه فقط نام فایل
 *
 * و این‌ها را تأیید می‌کند:
 *   ۱) `tools/reset-ui/server.mjs` **هست**  (ابزار مشتری باید باشد)
 *   ۲) `tools/license/…` **نیست**            (ابزار فروشنده نباید باشد)
 *   ۳) `license-keys/private.key` **نیست**   (کلید امضا نباید باشد)
 *   ۴) `api/app.js` و `public-key/…` **هستند**
 *
 * ⚠ صادقانه: خواندن کامل آرشیو NSIS روی لینوکس ممکن نیست (هدر 7z روش
 * اختصاصی Tauri دارد). در آن حالت اسکریپت **خارج ۰** با پیام «نتوانستم
 * ببینم» می‌دهد، نه «سالم است» — چون سکوتِ سبز بدترین نوع دروغ است.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argAt = (name) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : '';
};

let pass = 0, fail = 0, unknown = 0;
const ok = (s) => { pass++; console.log(`  ✔ ${s}`); };
const bad = (s) => { fail++; console.log(`  ✘ ${s}`); };
const skip = (s) => { unknown++; console.log(`  ⚠ ${s}`); };

/*
 * ── ۱) کدام فایل نصبی؟ ───────────────────────────────────────────────────
 */
function findInstallers(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const kind of fs.readdirSync(dir)) {
    const kd = path.join(dir, kind);
    if (!fs.statSync(kd).isDirectory()) continue;
    for (const f of fs.readdirSync(kd)) {
      if (/\.(exe|msi)$/i.test(f)) out.push({ kind, file: f, abs: path.join(kd, f) });
    }
  }
  return out;
}

const explicit = argAt('--bundle');
const bundleRoot = explicit
  ? path.resolve(explicit)
  : path.join(root, 'src-tauri', 'target', 'release', 'bundle');

console.log('\n=== بازرسی بسته‌ی نصبی ===\n');
console.log(`— پوشه‌ی بسته: ${path.relative(root, bundleRoot) || bundleRoot} —`);

const installers = findInstallers(bundleRoot);
if (!installers.length) {
  console.log('\n  ⚠ هیچ فایل نصبی (.exe/.msi) پیدا نشد — اول npm run desktop:build');
  console.log('  (این «سالم است» نیست، «چیزی برای بررسی نبود» است.)\n');
  process.exit(2);
}
for (const i of installers) {
  console.log(`   • ${i.kind}/${i.file}  ${(fs.statSync(i.abs).size / 1024 / 1024).toFixed(1)} MB`);
}

/*
 * ── ۲) خواندن محتوا ─────────────────────────────────────────────────────
 *
 * برای NSIS: فایل اجرایی Tauri یک آرشیو 7z چسبیده به انتها دارد. جست‌وجوی
 * خام رشته‌ها (ASCII و UTF-16LE) بدون باز کردن آرشیو انجام می‌شود؛ برای
 * «بودن/نبودنِ نام فایل» کافی و قابل‌اعتماد است، چون نام مسیرها در فهرست
 * آرشیو به‌صورت متن ذخیره می‌شوند. اگر حتی یک نام مورد انتظار پیدا نشود،
 * نتیجه «نامعلوم» است، نه «سالم».
 */
function rawStrings(file) {
  const buf = fs.readFileSync(file);
  return {
    buf,
    has(pattern) {
      const ascii = Buffer.from(pattern, 'utf8');
      if (buf.includes(ascii)) return true;
      /* UTF-16LE (مسیرهای ویندوزی در برخی بخش‌ها) */
      const utf16 = Buffer.from(pattern.split('').join('\0') + '\0', 'latin1');
      return buf.includes(utf16);
    },
    size: buf.length,
  };
}

const MUST_HAVE = ['tools\\reset-ui\\server.mjs', 'tools/reset-ui/server.mjs', 'reset-ui/ui.html'];
const MUST_NOT = [
  'tools\\license\\server.mjs', 'tools/license/server.mjs',
  'license-keys/private.key', 'license-keys\\private.key',
  'issued.json',
];

for (const inst of installers) {
  console.log(`\n— محتوای ${inst.kind}/${inst.file} —`);
  const r = rawStrings(inst.abs);

  /*
   * پیش‌بررسی: آیا اصلاً می‌توانیم فهرست فایل‌ها را ببینیم؟ یکی از نام‌هایی
   * که مطمئناً باید باشد (`api/app.js`) باید پیدا شود، وگرنه کور هستیم.
   */
  const canSee = r.has('api/app.js') || r.has('api\\app.js') || r.has('app.js');
  if (!canSee) {
    skip('فهرست فایل‌های داخل بسته خوانده نشد (فرمت فشرده) — بازرسی محتوا ممکن نیست');
    skip('این بسته تأیید نشد؛ روی ویندوز با msiexec/7z باز کنید یا installer را نصب و پوشه‌ی نصب را ببینید');
    continue;
  }

  /* ۱) ابزار مشتری باید باشد */
  if (MUST_HAVE.some((n) => r.has(n))) ok('ابزار «صفر کردن» (reset-ui) داخل بسته هست');
  else bad('ابزار «صفر کردن» داخل بسته نیست — مشتری نمی‌تواند سیستم را صفر کند');

  /* ۲) ابزار فروشنده نباید باشد */
  const leaked = MUST_NOT.filter((n) => r.has(n));
  if (leaked.length === 0) ok('ابزار لایسنس و کلید خصوصی داخل بسته نیستند');
  else bad(`این‌ها داخل بسته‌اند (نباید باشند): ${leaked.join(', ')}`);

  /* ۳) اجزای لازم */
  if (r.has('app.js')) ok('سرویس API داخل بسته هست');
  else bad('api/app.js داخل بسته نیست — برنامه بالا نمی‌آید');
  if (r.has('farday-public.b64')) ok('کلید عمومی لایسنس داخل بسته هست');
  else bad('public-key/farday-public.b64 داخل بسته نیست');
}

console.log('');
if (fail === 0 && unknown === 0) {
  console.log(`✅ بسته سالم است (${pass} بررسی)\n`);
  process.exit(0);
}
if (fail > 0) {
  console.log(`⛔ ${fail} مورد مشکل دارد (${pass} سالم، ${unknown} نامعلوم)\n`);
  process.exit(1);
}
console.log(`⚠ بسته تأیید نشد: ${unknown} مورد قابل بررسی نبود (${pass} سالم)\n`);
process.exit(2);
