/**
 * نگهبان «پوشه و فشرده‌ی پشتیبان» — پیشنهاد C2، دور ۴۰.
 *
 *   node scripts/ui-check/backup-bundle.test.mjs
 *
 * ── چه چیزی را می‌گیرد ──────────────────────────────────────────────────
 *  ۱) ZIP خراب: یک بایت غلط در CRC یا طول، فایل را برای Windows Explorer
 *     «خراب» می‌کند. کد **بی‌خطا اجرا می‌شود** و فایل دانلود می‌شود؛ فقط
 *     باز نمی‌شود. تنها راه اطمینان، بازخوانی واقعی فایل است.
 *  ۲) تزریق مسیر در open-folder: اگر مسیر از کلاینت گرفته شود، مدیر
 *     می‌تواند `C:\Windows` را باز کند.
 *  ۳) باز کردن شل به‌جای execFile (خطر تزریق فرمان).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— ZIP ساخته‌شده واقعاً باز می‌شود —');

/*
 * ⚠ از `src` تست می‌کنیم، نه از `dist`.
 *
 * اولین نسخه‌ی این فایل `dist/common/zip.js` را import می‌کرد. مشکل: زنجیره‌ی
 * `npm test` **نمی‌سازد**. یعنی روی یک checkout تازه، یا با یک `dist` کهنه،
 * تست یا می‌شکست یا — بدتر — نسخه‌ی قدیمی را سبز می‌کرد. تستی که کد
 * ارسالی را نمی‌سنجد، ارزش ندارد.
 *
 * `zip.ts` هیچ import اجرایی ندارد (فقط node:fs / node:zlib)، پس Node خودش
 * با `--experimental-strip-types` آن را بارگذاری می‌کند. این اسکریپت باید
 * با همان فلگ اجرا شود.
 */
const zipTs = read('apps/api/src/common/zip.ts');
let buildZip;
try {
  ({ buildZip } = await import('../../apps/api/src/common/zip.ts'));
} catch (e) {
  console.log(`  ⛔ بارگذاری zip.ts نشد: ${e.message}`);
  console.log('     این تست باید با: node --experimental-strip-types اجرا شود.');
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipcheck-'));
const uniName = 'پوشه/رسید-۱۴۰۵.txt';
const uniBody = Buffer.from('سلام دنیا — آزمون فارسی', 'utf8');
const binBody = Buffer.alloc(4096);
for (let i = 0; i < binBody.length; i++) binBody[i] = (i * 37) & 0xff;

const zipPath = path.join(dir, 'out.zip');
fs.writeFileSync(zipPath, buildZip([
  { name: uniName, data: uniBody },
  { name: 'binary.bin', data: binBody },
  { name: 'empty.txt', data: Buffer.alloc(0) },
]));

/* بازخوانی با ابزار مستقل — نه با کد خودمان */
const py = `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
names = z.namelist()
data = {n: z.read(n) for n in names}
import json
sys.stdout.write(json.dumps({
  'bad': bad, 'names': names,
  'uni': data[names[0]].decode('utf-8'),
  'binLen': len(data[names[1]]),
  'binOk': data[names[1]][:5].hex(),
  'empty': len(data[names[2]]),
  'utf8flag': bool(z.getinfo(names[0]).flag_bits & 0x800),
}))
`;
let parsed = null;
try {
  const out = execFileSync('python3', ['-c', py, zipPath]).toString();
  parsed = JSON.parse(out);
} catch (e) {
  ok('فایل ZIP با python قابل خواندن است', false, String(e.message).slice(0, 120));
}

if (parsed) {
  ok('CRC همه‌ی اعضا سالم است', parsed.bad === null, String(parsed.bad));
  ok('نام فارسی درست ذخیره شده', parsed.names[0] === uniName, parsed.names[0]);
  ok('پرچم UTF-8 در هدر ست است (وگرنه ویندوز نام را به‌هم می‌ریزد)', parsed.utf8flag === true);
  ok('محتوای فارسی دست‌نخورده برگشت', parsed.uni === uniBody.toString('utf8'));
  ok('فایل باینری کامل برگشت', parsed.binLen === binBody.length, String(parsed.binLen));
  ok('بایت‌های باینری یکسان‌اند', parsed.binOk === binBody.subarray(0, 5).toString('hex'));
  ok('فایل تهی هم عضو معتبری است', parsed.empty === 0);
}
fs.rmSync(dir, { recursive: true, force: true });

console.log('\n— ایمنی باز کردن پوشه —');

const of = read('apps/api/src/common/open-folder.ts');
ok('از execFile استفاده می‌شود (بدون شل)', /execFile\(/.test(of));
ok('هرگز exec( برای باز کردن پوشه نیست', !/[^A-Za-z]exec\(/.test(of));
ok('مسیر از کلاینت پذیرفته نمی‌شود — فقط کلید', /isFolderKey/.test(of) && /'data' \|\| v === 'backups'/.test(of));
ok('ویندوز explorer.exe را صدا می‌زند', /explorer\.exe/.test(of));
ok('مک و لینوکس هم پوشش دارند', /'darwin'/.test(of) && /xdg-open/.test(of));
ok('نبود فایل‌منیجر پیام روشن دارد (نه استثنا)', /برنامه‌ای برای باز کردن پوشه/.test(of));
ok('مسیر ناموجود پیش از اجرا بررسی می‌شود', /fs\.existsSync\(dir\)/.test(of));

console.log('\n— مسیرهای سرور —');
const sys = read('apps/api/src/modules/system.controller.ts');
ok('مسیر open-folder وجود دارد', /@Post\('open-folder\/:key'\)/.test(sys));
ok('فقط مدیر', /@Post\('open-folder\/:key'\)\s*\n\s*@ManagerOnly\(\)/.test(sys));
ok('کلید ناشناخته ۴۰۰ می‌دهد', /پوشه‌ی خواسته‌شده شناخته نشد/.test(sys));
ok('مسیر backup/bundle وجود دارد', /@Get\('backup\/bundle'\)/.test(sys));
ok('پیش از کاپی، WAL چک‌پوینت می‌شود', /wal_checkpoint/.test(sys));
ok('سقف ۳۰ فایل در بسته رعایت می‌شود', /slice\(-30\)/.test(sys));
ok('README برای بازگردانی داخل بسته است', /README\.txt/.test(sys));
ok('نوع محتوا zip است', /application\/zip/.test(sys));

console.log('\n— رابط کاربری —');
const bak = read('apps/web/src/pages/Backup.tsx');
const set = read('apps/web/src/pages/Settings.tsx');
ok('دکمه‌ی فشرده در صفحه‌ی پشتیبان هست', /باز کردن پوشه/.test(bak) && /دانلود همه \(ZIP\)/.test(bak));
ok('نام فایل از هدر خوانده می‌شود، نه حدس', /Content-Disposition/.test(bak));
ok('شکست باز کردن پوشه بی‌صدا نیست', /toast\.warn\(/.test(bak));
ok('مسیر داده در تنظیمات دکمه‌ی باز کردن دارد', /open-folder\/data/.test(set));
ok('مسیر «باز شد» فقط وقتی ok است گفته می‌شود', /if \(r\.ok\)/.test(bak) && /if \(r\.ok\)/.test(set));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
