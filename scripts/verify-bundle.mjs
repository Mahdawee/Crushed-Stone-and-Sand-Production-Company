/**
 * بازرسی «بسته‌ی ساخته‌شده» — نه تنظیمات، خودِ فایل نصبی.
 *
 *   node scripts/verify-bundle.mjs [--bundle <پوشه>]
 *
 * ── چرا این فایل (پیشنهاد A1، دور ۴۰) ──────────────────────────────────
 * همه‌ی بررسی‌های بسته‌بندی **از روی `tauri.conf.json`** استدلال می‌کردند:
 * «الگو چنین است، پس ابزار لایسنس در بسته نیست». این استدلال در دور ۳۶
 * شکست (الگو هیچ فایلی پیدا نمی‌کرد و کسی نفهمید). پس خودِ فایل نصبی
 * باید خوانده شود.
 *
 * ── بازنویسی کامل در دور ۴۲ ────────────────────────────────────────────
 * نسخه‌ی اول محتوا را با «جست‌وجوی رشته در بایت‌های خام» می‌سنجید. روی
 * اولین بیلد واقعی ویندوز این نتایج را داد:
 *
 *     ✘ ابزار «صفر کردن» داخل بسته نیست
 *     ✔ ابزار لایسنس و کلید خصوصی داخل بسته نیستند
 *
 * هر دو بی‌ارزش بودند:
 *   • آن ✘ **غلط** بود — ابزار هست، ولی نامش در بار فشرده پیدا نمی‌شود.
 *   • و خطرناک‌تر: آن ✔ هم بی‌اثبات بود. نبودنِ یک رشته در داده‌ی فشرده
 *     هیچ چیزی را ثابت نمی‌کند. یعنی ممکن بود کلید امضا داخل بسته باشد
 *     و ابزار بگوید «سالم است».
 *
 * نسخه‌ی فعلی فهرست فایل‌ها را از **ساختار واقعی** بسته می‌خواند
 * (`scripts/lib/msi-inspect.mjs`: CFB → جدول‌ها → هدر CAB).
 *
 * ── قاعده‌ی طلایی ───────────────────────────────────────────────────────
 * «نتوانستم بخوانم» هرگز «نیست» نیست و هرگز «هست» نیست. اگر فهرست فایل‌ها
 * خوانده نشود، نتیجه **نامعلوم** است و اسکریپت خارج ۲ می‌دهد — نه ۰.
 */
import fs from 'node:fs';
import { inspectMsi } from './lib/msi-inspect.mjs';
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
 * ── چه چیزی باید باشد، چه چیزی نباید ────────────────────────────────────
 *
 * تطبیق **جزء به جزء** روی مسیر است، نه «زیررشته در کل بایت‌ها». این
 * تفاوت مهم است: الگوی قبلی `reset-ui/ui.html` را می‌پذیرفت، ولی
 * `/app\.js/i` روی `myapp.js` هم می‌خورد. اینجا هر نام فایل جدا سنجیده
 * می‌شود و پسوند مسیر (`tools/reset-ui/...`) هم چک می‌شود.
 */
/*
 * ── نام کوتاه ۸.۳ هم پذیرفته می‌شود ─────────────────────────────────────
 * WiX (و در نتیجه بسته‌بند MSI تاو��ری) نام فایل‌ها را در جدول `File` اغلب
 * به شکل کوتاه ۸.۳ نگه می‌دارد: `RESETU~1.MJS` به‌جای
 * `tools\reset-ui\server.mjs`. نام بلند در ستون `LongName` است که به
 * راحتی از CAB خوانده نمی‌شود.
 *
 * اگر فقط مسیر کامل را بپذیریم، روی بسته‌ی واقعی «✘ نیست» می‌دهد در حالی
 * که هست — همان خطایی که این بازنویسی برای رفعش شروع شد. پس هر دو شکل
 * پذیرفته می‌شود: مسیر کامل **یا** نام کوتاه ۸.۳.
 *
 * ⚠ هزینه‌اش: تطبیق ۸.۳ سست‌تر است. برای همین در خروجی می‌گوییم با کدام
 * شکل شناخته شد، تا کاربر بداند چقدر محکم است.
 */
const re83 = (base, ext) => new RegExp(`^${base.slice(0, 6).replace(/[^A-Za-z0-9]/g, '')}~?\\d*\\.${ext}$`, 'i');

const NEED = [
  {
    id: 'reset-ui', label: 'ابزار «صفر کردن» (reset-ui)',
    /* هم مسیر کامل، هم نام کوتاهِ server.mjs در ریشه‌ی CAB */
    re: /(^|[\\/])tools[\\/]reset-ui[\\/]/i,
    short: /^(SERVER|RESETU|RESET)~?\d*\.MJS$/i,
    why: 'مشتری نمی‌تواند سیستم را صفر کند',
  },
  {
    id: 'api', label: 'سرویس API (app.js)',
    re: /(^|[\\/])api[\\/](app|main)\.js$/i,
    short: /^(APP|APPMAIN|MAIN)~?\d*\.JS$/i,
    why: 'برنامه بالا نمی‌آید',
  },
  {
    id: 'pubkey', label: 'کلید عمومی لایسنس',
    re: /farday-public\.b64$/i,
    short: /^(FARDAY~?\d*|PUBKEY|LICENS)~?\d*\.B64$/i,
    why: 'فعال‌سازی لایسنس از کار می‌افتد',
  },
];
const FORBID = [
  { id: 'license-tool', label: 'ابزار لایسنس (فروشنده)', re: /(^|[\\/])tools[\\/]license[\\/]/i },
  { id: 'privkey', label: 'کلید خصوصی امضا', re: /private\.key$|private\.pem$/i },
  { id: 'issued', label: 'فهرست مجوزهای صادرشده', re: /issued\.json$/i },
];

/** آیا این فهرست فایل، «واقعاً خوانده شد»؟ */
function readable(list) {
  return Array.isArray(list) && list.length > 0;
}

for (const inst of installers) {
  console.log(`\n— محتوای ${inst.kind}/${inst.file} —`);

  /*
   * ── NSIS ───────────────────────────────────────────────────────────────
   * آرشیو NSIS با هدر اختصاصی 7z فشرده شده و روی ویندوز هم بدون بستن
   * فایل قابل خواندن نیست. صادقانه: **نامعلوم**، نه سالم.
   *
   * ولی یک چیز را می‌توان با اطمینان گفت: NSIS از همان `bundle.resources`
   * ساخته می‌شود که MSI. پس اگر MSI سالم باشد، NSIS هم همان فایل‌ها را
   * دارد — این را در پیام می‌گوییم، نه به‌عنوان «تأیید».
   */
  if (/\.exe$/i.test(inst.file)) {
    skip('فهرست فایل‌های داخل NSIS خوانده نشد (آرشیو 7z داخلی)');
    skip('این بسته تأیید نشد — اشتراک تنظیمات با MSI، یکسان بودن محتوای نصب‌کننده‌ها را ثابت نمی‌کند');
    continue;
  }

  const info = inspectMsi(inst.abs);
  if (!info) {
    /*
     * نتوانستیم بخوانیم. **هیچ ادعایی نمی‌کنیم** — نه «هست»، نه «نیست».
     * خارج ۲ در پایان، تا بیلد بگوید «تأیید نشد».
     */
    skip('ساختار MSI خوانده نشد — بازرسی محتوا ممکن نیست (نه سالم، نه خراب)');
    skip('روی ویندوز: msiexec /a "فایل.msi" TARGETDIR=<پوشه> و بعد پوشه را ببینید');
    continue;
  }

  const files = info.files;
  console.log(`  ${files.length} فایل از ${info.cabs.length} آرشیو CAB خوانده شد`);
  if (!readable(files)) {
    skip('آرشیو CAB خالی یا خوانده‌نشدنی بود — ادعایی درباره‌ی محتوا نمی‌شود');
    continue;
  }

  /* ── ۱) چیزهایی که باید باشند ── */
  for (const n of NEED) {
    const full = files.find((f) => n.re.test(f));
    const short = !full && n.short ? files.find((f) => n.short.test(path.basename(f).replace(/\\/g, '/'))) : null;
    if (full) ok(`${n.label} داخل بسته هست`);
    else if (short) skip(`${n.label}: نام کوتاه ${path.basename(short)} پیدا شد، ولی هویت و مسیر آن تأیید نشد`);
    else skip(`${n.label}: در فهرست خوانده‌شده پیدا نشد؛ کامل بودن فهرست ثابت نشده است`);
  }

  /* ── ۲) چیزهایی که نباید باشند ── */
  /*
   * این بخش فقط وقتی معنا دارد که فهرست **کامل** خوانده شده باشد. اگر
   * فقط بخشی خوانده شد، «نبود» بی‌معناست — و همان اشتباهی است که نسخه‌ی
   * قبلی می‌کرد و به‌خاطرش ممکن بود کلید خصوصی برای مشتری برود.
   */
  const leaked = FORBID.filter((n) => files.some((f) => n.re.test(f)));
  if (leaked.length) bad(`این‌ها داخل بسته‌اند (نباید باشند): ${leaked.map((x) => x.label).join('، ')}`);
  else skip('نبود فایل فروشنده تأیید نشد: خوانندهٔ CAB کامل بودن فهرست MSI را ثابت نمی‌کند');

  /* ── ۳) هشدار ساختاری، نه خطا ── */
  const zero = Number(info.zeroBytesTotal || 0);
  if (zero > 0) skip(`${zero} فایل با حجم صفر در بسته است — بسته‌بندی را بررسی کنید`);
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
