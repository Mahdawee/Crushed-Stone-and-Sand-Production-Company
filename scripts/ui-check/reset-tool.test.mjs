/**
 * تست «صفر کردن سیستم» (ابزار بیرونی) و «هشدار لایسنس».
 *
 *   npm run test:reset-tool
 *
 * دو خواسته‌ی کاربر:
 *   ۱) «نزدیک شدن ختم لایسنس یا دوره‌ی آزمایشی در یک alert حرفه‌ای دیده شود.»
 *   ۲) «صفر کردن تمام داده‌ها برای تحویل سیستم آک — به‌صورت ابزار بیرونی در
 *      پوشه‌ی tools، با صفحه‌ی نمایش و اجراکننده، بعد از اخطار و تأیید.»
 *
 * تست واقعاً یک دیتابیس می‌سازد، داده می‌ریزد، ابزار را بالا می‌آورد و صفر
 * می‌کند — روی پوشه‌ی موقت، نه داده‌ی واقعی.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4433;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-reset-'));
const dbFile = path.join(dir, 'farday.db');

let pass = 0, fail = 0;
const problems = [];
const check = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); }
  else { fail++; problems.push(`${n}${x ? ` — ${x}` : ''}`); console.log(`  ✘ ${n} ${x}`); }
};

/* ================================================================ */
console.log('\n— ساخت یک دیتابیس «داده‌دار» —');

/*
 * ساختار واقعی برنامه را با تابع شِما می‌سازیم (نه دستی)، تا اگر ستونی
 * اضافه/کم شود، تست همان ساختار را ببیند. بعد چند ردیف در جدول‌های کاری
 * می‌ریزیم تا صفر کردن چیزی برای پاک‌کردن داشته باشد.
 */
{
  process.env.FD_DATA_DIR = dir;
  process.env.FD_DB_FILE = dbFile;
  process.env.FD_LICENSE_DEV = '1';
  const schemaDist = path.join(root, 'apps', 'api', 'dist', 'schema.js');
  check('ساختار API ساخته شده است', fs.existsSync(schemaDist), 'اول npm run build -w @farday/api');
  const { ensureSchemaAsync } = await import(`file://${schemaDist}`);
  await ensureSchemaAsync(true);
}
const db = new DatabaseSync(dbFile);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const hasCustomers = tables.includes('Customer');
check('جدول مشتریان ساخته شد', hasCustomers, tables.join(','));

/* چند ردیف داده‌ی کاری + یک فایل لایسنس و دو پشتیبان قدیمی */
db.exec(`INSERT INTO "Customer" ("code","name","openingBalance") VALUES ('C-1','شرکت قدیمی',0)`);
if (tables.includes('Sale')) {
  db.exec(`INSERT INTO "Sale" ("no","date","customerId","customerName","materialName","volume","unitPrice","total","paymentType")
           VALUES ('S-1','2026-11-01',1,'شرکت قدیمی','ریگ',2,100,200,'cash')`);
}
if (tables.includes('ActivityLog')) {
  db.exec(`INSERT INTO "ActivityLog" ("username","action","entity","entityId","detail") VALUES ('admin','create','Sale',1,'تست')`);
}
if (tables.includes('LookupItem')) {
  db.exec(`INSERT INTO "LookupItem" ("type","name","sortOrder","active") VALUES ('material','ریگ',1,1)`);
}
db.close();
fs.writeFileSync(path.join(dir, 'license.key'), '-----BEGIN FARDAY LICENSE-----\nFR-1\nx\ny\n-----END FARDAY LICENSE-----\n');
fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
fs.writeFileSync(path.join(dir, 'backups', 'old-1.db'), 'backup');
fs.writeFileSync(path.join(dir, 'backups', 'old-2.db'), 'backup');

/* ================================================================ */
console.log('\n— صفحه و وضعیت ابزار —');

/* شبکه‌ی امنیتی: پورت باید آزاد باشد (سرور قدیمی نباید جواب بدهد) */
{
  let busy = false;
  try { const r = await fetch(BASE + '/api/state'); busy = r.ok || r.status < 500; } catch { busy = false; }
  if (busy) { console.error(`\n⛔ پورت ${PORT} اشغال است.\n`); process.exit(1); }
}

const child = spawn(process.execPath, [path.join(root, 'tools', 'reset-ui', 'server.mjs')], {
  cwd: root,
  env: { ...process.env, FD_DATA_DIR: dir, FD_DB_FILE: dbFile, FD_RESET_UI_PORT: String(PORT), FARDAY_RESET_KEY: 'FD-TEST-RESET-KEY' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });
let up = false;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(BASE + '/api/state'); if (r.ok) { up = true; break; } } catch { /* wait */ }
  if (child.exitCode !== null) break;
  await new Promise((r) => setTimeout(r, 200));
}
check('ابزار بالا آمد', up, log.slice(-400));
if (!up) { try { child.kill(); } catch { /* */ } finish(); }

const html = await (await fetch(BASE + '/')).text();
const csrf = (html.match(/CSRF\s*=\s*['"]([^'"]+)/) || [])[1] || '';
const post = async (p, b) => {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-reset-csrf': csrf },
    body: JSON.stringify(b),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

check('صفحه‌ی ابزار راست‌به‌چپ و فارسی است', /dir="rtl"/.test(html) && /صفر کردن سیستم/.test(html));
check('صفحه هشدار صریح «برگشت‌ناپذیر» دارد', /برگشت‌ناپذیر/.test(html));
check('صفحه دو تأیید می‌گیرد (تیک + عبارت)', /id="ack"/.test(html) && /id="confirm"/.test(html));
check('کلید صفر کردن هرگز در HTML نمی‌آید', !html.includes('FD-TEST-RESET-KEY'));
check('صفحه‌ی نمایش بخش «گزارش عملیات» دارد', /گزارش عملیات/.test(html));

const st = await (await fetch(BASE + '/api/state')).json();
check('وضعیت داده گزارش می‌شود', Number(st.total) > 0, JSON.stringify(st.counts));
check('تعداد مشتری/فروش دیده می‌شود', (st.counts.Customer || 0) >= 1 && (st.counts.Sale || 0) >= 1,
  JSON.stringify(st.counts));
check('پشتیبان‌های موجود شمرده می‌شوند', Number(st.backups) === 2, String(st.backups));
check('برنامه «بسته» تشخیص داده می‌شود (حالت آفلاین)', st.appOpen === false && st.apiMode === false);

/* ================================================================ */
console.log('\n— حفاظ‌ها: بدون تأیید هیچ کاری نمی‌شود —');

const before = {
  customers: db.queryAll ?? null,
};
const countNow = () => {
  const d = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const c = d.prepare('SELECT COUNT(*) c FROM "Customer"').get();
    const s = tables.includes('Sale') ? d.prepare('SELECT COUNT(*) c FROM "Sale"').get() : { c: 0 };
    return { customers: Number(c.c), sales: Number(s.c) };
  } finally { d.close(); }
};
const c0 = countNow();
check('داده قبل از هر کاری سر جایش است', c0.customers >= 1, JSON.stringify(c0));

const noPhrase = await post('/api/reset', { acknowledge: true, acknowledged: true, resetKey: 'FD-TEST-RESET-KEY' });
check('بدون عبارت تأیید رد می‌شود', noPhrase.status === 400, String(noPhrase.status));
check('پیام می‌گوید هیچ داده‌ای تغییر نکرد', /هیچ داده‌ای تغییر نکرد/.test(String(noPhrase.body?.message || '')),
  String(noPhrase.body?.message));

const noAck = await post('/api/reset', { confirm: 'صفر کردن', resetKey: 'FD-TEST-RESET-KEY' });
check('بدون تیک «می‌دانم» رد می‌شود', noAck.status === 400, String(noAck.status));

const wrongKey = await post('/api/reset', { confirm: 'صفر کردن', acknowledged: true, resetKey: 'WRONG' });
check('کلید نادرست رد می‌شود', wrongKey.status === 403, String(wrongKey.status));

const noCsrf = await fetch(BASE + '/api/reset', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ confirm: 'صفر کردن', acknowledged: true, resetKey: 'FD-TEST-RESET-KEY' }),
});
check('بدون توکن CSRF رد می‌شود', noCsrf.status === 400, String(noCsrf.status));

check('بعد از رد شدن‌ها، داده دست‌نخورده است',
  JSON.stringify(countNow()) === JSON.stringify(c0), JSON.stringify(countNow()));

/* ================================================================ */
console.log('\n— صفر کردن واقعی —');

const done = await post('/api/reset', {
  confirm: 'صفر کردن', acknowledged: true, resetKey: 'FD-TEST-RESET-KEY',
  operator: 'اپراتور تست', reason: 'تحویل به مشتری آزمایشی',
});
check('صفر کردن انجام شد', done.status === 200 && done.body.ok === true,
  `${done.status} ${JSON.stringify(done.body).slice(0, 200)}`);
check('حالت «آفلاین» گزارش می‌شود', done.body.mode === 'offline', String(done.body.mode));
check('پشتیبان پیش از پاک‌کردن گرفته شد', Boolean(done.body.backupFile), String(done.body.backupFile));
check('نام اپراتور در گزارش عملیات هست', done.body.operator === 'اپراتور تست', String(done.body.operator));
/*
 * دلیل در «مهر» (system-reset.json) و تاریخچه می‌نشیند، نه لزوماً در پاسخ.
 * خواندن از فایل، همان چیزی است که اپراتور بعداً می‌بیند.
 */
{
  const mark = JSON.parse(fs.readFileSync(path.join(dir, 'system-reset.json'), 'utf8'));
  check('دلیل در مهر سیستم ثبت شد', /تحویل/.test(String(mark.reason || '')), String(mark.reason));
  check('گزارش پشتیبان را نام می‌برد', Boolean(mark.backupFile), String(mark.backupFile));
  check('آک بودن در مهر ثبت شد', Number(mark.total) >= 2, String(mark.total));
}

const after = countNow();
check('مشتریان پاک شدند', after.customers <= 1, String(after.customers)); /* فقط «مشتری گذری» */
check('فروشات پاک شدند', after.sales === 0, String(after.sales));

const st2 = await (await fetch(BASE + '/api/state')).json();
check('وضعیت بعدی: هیچ داده‌ی کاری نمانده', Number(st2.total) === 0, JSON.stringify({ ...st2.counts, total: st2.total }));
/* «مشتری گذری» شمرده نمی‌شود، وگرنه سیستم همیشه «داده‌دار» نشان داده می‌شود */
check('«مشتری گذری» داده‌ی کاری شمرده نمی‌شود', (st2.counts.Customer || 0) === 1 && Number(st2.total) === 0,
  `${st2.counts.Customer} / ${st2.total}`);
check('مهر صفر کردن ثبت شد', Boolean(st2.mark?.at) && st2.mark.operator === 'اپراتور تست', JSON.stringify(st2.mark));
check('گزارش «چند ردیف پاک شد» دارد', Number(st2.mark?.total) >= 2, String(st2.mark?.total));

/* کاربر مدیر و مشتری گذری باید باقی بمانند (سیستم آک ولی قابل ورود) */
{
  const d = new DatabaseSync(dbFile, { readOnly: true });
  try {
    if (tables.includes('User')) {
      const u = d.prepare(`SELECT "username","role" FROM "User"`).all();
      check('کاربر مدیر بازسازی شد', u.some((x) => x.username === 'admin' && x.role === 'manager'), JSON.stringify(u));
    }
    const walk = d.prepare(`SELECT "code","name" FROM "Customer" WHERE "code"='000'`).all();
    check('«مشتری گذری» باقی ماند', walk.length === 1, JSON.stringify(walk));
    if (tables.includes('LookupItem')) {
      const l = d.prepare(`SELECT COUNT(*) c FROM "LookupItem"`).get();
      check('فهرست‌ها پاک شدند (برنامه دوباره می‌سازد)', Number(l.c) === 0, String(l.c));
    }
  } finally { d.close(); }
}

/* فایل‌ها */
check('لایسنس فعال پاک شد (ردّ مشتری قبلی)', !fs.existsSync(path.join(dir, 'license.key')));
check('پشتیبان‌های قبلی پاک شدند',
  fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('old-')).length === 0,
  fs.readdirSync(path.join(dir, 'backups')).join(','));
const backups = fs.readdirSync(path.join(dir, 'backups'));
check('فقط پشتیبان همین عملیات مانده', backups.length === 1 && backups[0].startsWith('pre-reset-'), backups.join(','));
check('پشتیبان خالی نیست', fs.statSync(path.join(dir, 'backups', backups[0])).size > 0);
check('تاریخچه‌ی صفر کردن نوشته شد', fs.existsSync(path.join(dir, 'reset-history.log')));

/* ================================================================ */
console.log('\n— اجراکننده‌ها و خط فرمان —');

for (const f of ['tools/license/start.cmd', 'tools/license/start.sh', 'tools/reset-ui/start.cmd', 'tools/reset-ui/start.sh']) {
  const full = path.join(root, f);
  const body = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
  check(`اجراکننده هست: ${f}`, body.length > 100);
  if (f.endsWith('.cmd')) {
    check(`  ${path.basename(f)} بررسی نصب Node و باز کردن مرورگر`, /where node/.test(body) && /start ""/.test(body));
  } else {
    check(`  ${path.basename(f)} اجراپذیر و bash است`, /^#!.*bash/.test(body) && (fs.statSync(full).mode & 0o111) !== 0);
  }
}
{
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  check('دستور npm برای ابزار صفر کردن هست', Boolean(pkg.scripts['reset:ui']), JSON.stringify(Object.keys(pkg.scripts)));
  check('دستور npm برای اجراکننده‌ی متنی هست', Boolean(pkg.scripts.reset));
}

/* هسته‌ی مشترک: فهرست جدول‌ها باید با نسخه‌ی API یکی باشد */
{
  const apiReset = fs.readFileSync(path.join(root, 'apps', 'api', 'src', 'common', 'reset.ts'), 'utf8');
  const coreReset = fs.readFileSync(path.join(root, 'tools', 'reset-ui', 'reset-core.mjs'), 'utf8');
  const listOf = (s) => {
    const m = s.match(/RESET_ORDER\s*=\s*\[([\s\S]*?)\];/);
    return m ? m[1].split(/[\s,']+/).filter((x) => /^[A-Z]\w+$/.test(x)) : [];
  };
  const a = listOf(apiReset);
  const b = listOf(coreReset);
  check('فهرست جدول‌های صفر کردن در API و ابزار یکی است',
    a.length > 5 && JSON.stringify(a) === JSON.stringify(b), `${a.length} vs ${b.length}`);
  check('عبارت تأیید در هر دو یکی است',
    /صفر کردن/.test(apiReset) && /RESET_PHRASE = 'صفر کردن'/.test(coreReset));
  check('هش رمز مدیر همان الگوریتم برنامه است',
    /farday::salt/.test(coreReset) && /farday::salt/.test(fs.readFileSync(path.join(root, 'apps', 'api', 'src', 'common', 'auth.ts'), 'utf8')));
}

/* CLI: بدون تأیید نباید کاری کند */
{
  const run = (args) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [path.join(root, 'tools', 'reset-ui', 'cli.mjs'), ...args], {
          cwd: root, env: { ...process.env, FD_DATA_DIR: dir, FD_DB_FILE: dbFile }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }),
      };
    } catch (e) { return { code: e.status || 1, out: String(e.stdout || '') + String(e.stderr || '') }; }
  };
  const info = run(['--info']);
  check('CLI وضعیت را نشان می‌دهد', info.code === 0 && /وضعیت/.test(info.out), info.out.slice(0, 160));
  /*
   * بعد از صفر کردن، CLI باید «آک» بگوید — نه «N ردیف داده». نکته: خودِ
   * خروجی «وضعیت داده» هم کلمه‌ی «آک» را دارد، پس برچسبِ هدر را نگاه می‌کنیم.
   */
  check('CLI می‌گوید سیستم آک است',
    /هیچ ردیف داده‌ی کاری نیست/.test(info.out) && !/ردیف‌های کاری:/.test(info.out.replace(/\x1b\[[0-9;]*m/g, '')),
    info.out.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 220));
  const deny = run(['--yes']);
  check('CLI بدون عبارت تأیید کاری نمی‌کند', deny.code === 1 && /تأیید|صفر کردن/.test(deny.out), deny.out.slice(0, 160));
  const okRun = run(['--yes', '--confirm', 'صفر کردن', '--operator', 'cli-test']);
  check('CLI با تأیید کار می‌کند', okRun.code === 0, okRun.out.slice(0, 200));
}

/* ================================================================ */
console.log('\n— زنجیره‌ی «کلید صفر کردن» (مُهر در باینری) —');
{
  const buildRs = fs.readFileSync(path.join(root, 'src-tauri', 'build.rs'), 'utf8');
  const sealRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'seal.rs'), 'utf8');
  const sidecar = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'api_sidecar.rs'), 'utf8');
  const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const keyScript = fs.readFileSync(path.join(root, 'scripts', 'reset-key.mjs'), 'utf8');

  check('build.rs کلید صفر کردن را می‌خواند و مُهر می‌کند',
    /reset-key\.txt/.test(buildRs) && /SEALED_RESET_KEY/.test(buildRs) && /RESET_FINGERPRINT/.test(buildRs));
  check('seal.rs مُهر را باز می‌کند و اثر انگشت را بررسی می‌کند',
    /unsealed_reset_key/.test(sealRs) && /RESET_FINGERPRINT/.test(sealRs) && /has_reset_key/.test(sealRs));
  check('کلید صفر کردن به سرویس داخلی داده می‌شود', /FARDAY_RESET_KEY/.test(sidecar));
  check('سوئیچ --cli --print-reset-key وجود دارد',
    /print-reset-key/.test(mainRs) && /FARDAY_RESET_KEY/.test(mainRs));
  check('کلید صفر کردن در git نیست', /reset-key\.txt/.test(gitignore));
  check('اسکریپت ساخت کلید هست و کامیت‌نشدن را هشدار می‌دهد',
    /reset-key\.txt/.test(keyScript) && /کامیت نکنید/.test(keyScript));
  check('کلید صفر کردن جدا از کلید لایسنس است (دو مقدار مستقل)',
    !/SEALED_RESET_KEY.*SEALED_PUBLIC_KEY[\s\S]{0,80}SEALED_PUBLIC_KEY/.test(buildRs));
}

{
  const doc = fs.readFileSync(path.join(root, 'docs', 'RESET.md'), 'utf8');
  check('راهنمای صفر کردن نوشته شده است', doc.length > 1200);
  check('راهنما اجراکننده‌ها، کلید و پشتیبان را توضیح می‌دهد',
    /start\.cmd/.test(doc) && /start\.sh/.test(doc) && /print-reset-key/.test(doc) && /pre-reset/.test(doc));
  check('راهنما می‌گوید چه چیزی پاک می‌شود و چه چیزی می‌ماند',
    /مشتری گذری/.test(doc) && /admin123/.test(doc) && /برگشت‌ناپذیر/.test(doc));
}

/* ================================================================ */
console.log('\n— هشدار لایسنس در برنامه (alert) —');
{
  const alertSrc = fs.readFileSync(path.join(root, 'apps', 'web', 'src', 'components', 'LicenseAlert.tsx'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'apps', 'web', 'src', 'components', 'Layout.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'apps', 'web', 'src', 'styles', 'app.css'), 'utf8');
  check('کامپوننت هشدار با role=alertdialog ساخته شده', /role="alertdialog"/.test(alertSrc) && /aria-modal/.test(alertSrc));
  check('هشدار لایسنس در چیدمان برنامه گذاشته شده', /<LicenseAlert/.test(layout));
  check('نشانگر دائمی در نوار بالا هست', /lic-strip/.test(layout) && /lic-strip/.test(css));
  check('سه سطح هشدار تعریف شده (قرمز/زرد/آبی)', /tone: 'bad'/.test(alertSrc) && /tone: 'warn'/.test(alertSrc) && /tone: 'info'/.test(alertSrc));
  check('دوره‌ی آزمایشی جدا هشدار می‌گیرد', /state === 'trial'/.test(alertSrc) || /st === 'trial'/.test(alertSrc));
  check('«بعداً» تا چند روز یادآوری را عقب می‌اندازد', /remindDays/.test(alertSrc) && /isSnoozed/.test(alertSrc));
  check('همه‌ی حالت‌های نامعتبر پوشش داده شده', ['expired', 'machine', 'clock', 'invalid'].every((s) => alertSrc.includes(`'${s}'`)));
  check('استایل هشدار در CSS هست', /\.lic-alert-back/.test(css) && /\.lic-alert\.tone-bad/.test(css));
}

try { child.kill(); } catch { /* */ }
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
finish();

function finish() {
  console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  process.exit(fail === 0 ? 0 : 1);
}
