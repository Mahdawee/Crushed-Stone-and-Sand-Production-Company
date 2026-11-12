/**
 * تست «صفر کردن از خط فرمان» (`node dist/cli/reset.js`) — شکار باگ دور ۳۴
 *
 *   npm run test:reset-cli
 *
 * ## باگی که این تست نگه می‌دارد
 * این فرمان فهرست جدول‌های **خودش** را داشت: جدول‌های لایسنس، `Sequence`،
 * `Company` و `Setting` را پاک نمی‌کرد، پشتیبان نمی‌گرفت، فایل لایسنس را
 * برنمی‌داشت و در پایان چاپ می‌کرد «تنظیمات، مشخصات شرکت و کاربران محفوظ
 * ماند» — در حالی که در حالت `--all` چنین چیزی درست نبود.
 *
 * حالا همان `resetSystem` را صدا می‌زند که صفحه و ابزار بیرونی؛ پس سه چیز
 * باید برقرار باشد:
 *   ۱. بدون عبارت تأیید (`--confirm "صفر کردن"`) هیچ کاری نمی‌کند و کد ۲ می‌دهد.
 *   ۲. با تأیید: پشتیبان می‌گیرد، مُهر ریست می‌گذارد، داده‌ی کاری پاک می‌شود.
 *   ۳. کاربران سیستم دست‌نخورده می‌مانند («کاربران محفوظ می‌مانند»).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const dist = path.join(root, 'apps/api/dist');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-cli-'));
const dbFile = path.join(dir, 'farday.db');

let passed = 0, failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name}${extra ? ' → ' + extra : ''}`); }
}

if (!fs.existsSync(path.join(dist, 'cli', 'reset.js'))) {
  console.error('\n⛔ بسته‌ی API ساخته نشده. اول: npm run build -w @farday/api\n');
  process.exit(1);
}

const env = { ...process.env, FD_DATA_DIR: dir, FD_DB_FILE: dbFile, FD_LICENSE_DEV: '1', FD_LICENSE_PUBLIC_KEY: '' };
const run = (args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(dist, 'cli', 'reset.js'), ...args], { cwd: root, env, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
};

(async () => {
  /* ساخت شِما و چند ردیف داده‌ی کاری + یک کاربر، در همان پوشه */
  process.env.FD_DATA_DIR = dir;
  process.env.FD_DB_FILE = dbFile;
  process.env.FD_LICENSE_DEV = '1';
  const { ensureSchemaAsync } = await import(`file://${path.join(dist, 'schema.js')}`);
  await ensureSchemaAsync(true);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbFile);
  db.exec(`INSERT INTO "Customer" ("code","name","openingBalance") VALUES ('C-1','مشتری قدیمی',100)`);
  db.exec(`INSERT INTO "User" ("username","passwordHash","role") VALUES ('admin','x','manager')`);
  db.exec(`INSERT INTO "User" ("username","passwordHash","role") VALUES ('karmand','x','employee')`);
  db.close();

  console.log('\n— وضعیت —');
  const st = run(['--status']);
  check('گزارش وضعیت کار می‌کند', st.code === 0 && /Customer/.test(st.out), st.out.slice(0, 120));
  check('تعداد کل ردیف‌های کاری را می‌گوید', /مجموع ردیف/.test(st.out), st.out.slice(-120));

  console.log('\n— بدون تأیید هیچ چیز پاک نمی‌شود —');
  const noConfirm = run(['--yes']);
  check('بدون عبارت تأیید رد می‌شود', noConfirm.code === 2, String(noConfirm.code));
  check('پیام روشن می‌دهد چه چیزی لازم است', /--confirm/.test(noConfirm.out), noConfirm.out.slice(0, 120));
  const wrong = run(['--yes', '--confirm', 'صفر']);
  check('عبارت تأیید نادرست هم رد می‌شود', wrong.code === 2, String(wrong.code));
  const stillThere = new DatabaseSync(dbFile);
  check('داده هنوز سر جایش است', Number(stillThere.prepare('SELECT COUNT(*) c FROM "Customer" WHERE "code"=\'C-1\'').get().c) === 1);
  stillThere.close();

  console.log('\n— با تأیید: پاک‌سازی واقعی —');
  const ok = run(['--yes', '--confirm', 'صفر کردن']);
  check('صفر کردن موفق است', ok.code === 0, `${ok.code} ${ok.out.slice(-200)}`);
  check('گزارش می‌گوید سیستم صفر شد', /سیستم صفر شد/.test(ok.out), ok.out.slice(0, 120));
  check('نام فایل پشتیبان را چاپ می‌کند', /pre-reset-|backups/.test(ok.out), ok.out.slice(0, 200));
  check('پشتیبان واقعاً ساخته شد', fs.existsSync(path.join(dir, 'backups')) && fs.readdirSync(path.join(dir, 'backups')).length >= 1);
  check('مُهر «صفر شده» نوشته شد', fs.existsSync(path.join(dir, 'system-reset.json')));
  check('سابقه‌ی ریست ثبت شد', fs.existsSync(path.join(dir, 'reset-history.log')));

  const after = new DatabaseSync(dbFile);
  const custs = after.prepare('SELECT "name","isWalkIn" FROM "Customer"').all();
  check('داده‌ی کاری پاک شد (فقط مشتری گذری سیستمی ماند)',
    custs.length === 1 && Number(custs[0].isWalkIn) === 1, JSON.stringify(custs));
  const users = after.prepare('SELECT "username" FROM "User"').all().map((u) => u.username);
  check('کاربران سیستم محفوظ ماندند', users.includes('admin'), users.join(','));
  const seq = after.prepare('SELECT COUNT(*) c FROM "Sequence"').get();
  check('شمارنده‌ی شماره‌ی اسناد صفر شد (ردّ مشتری قبلی نمانَد)', Number(seq.c) === 0, String(seq.c));
  after.close();

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
