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
/*
 * مُهر دوره‌ی آزمایشی و ساعت لایسنس — شکار باگ دور ۳۴: این دو فایل بعد از
 * «صفر کردن» می‌ماندند و مشتری **جدید** برنامه را با «دوره‌ی آزمایشی تمام
 * شد» تحویل می‌گرفت. حالا باید پاک شوند.
 */
fs.writeFileSync(path.join(dir, 'license.trial'), '{"anchor":1}');
fs.writeFileSync(path.join(dir, 'license.clock'), '{"anchor":1}');
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
  /*
   * عمداً **بدون** FARDAY_RESET_KEY: درخواست کاربر این است که ابزار بدون کلید
   * کار کند. اگر روزی کسی کلید را دوباره اجباری کند، همین تست می‌شکند.
   */
  env: { ...process.env, FD_DATA_DIR: dir, FD_DB_FILE: dbFile, FD_RESET_UI_PORT: String(PORT) },
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
check('کلید صفر کردن در صفحه نیست (دیگر لازم نیست)', !/id="resetKey"/.test(html) && !/print-reset-key/.test(html));
check('صفحه صریح می‌گوید «کلید لازم نیست»', /کلید لازم نیست/.test(html));
/*
 * باگ کاربر (`isWalkIn`): صفحه باید پیش از تأیید بگوید دیتابیس آماده است یا
 * نه، و دکمه‌ی اجرا را در حالت ناآماده قفل کند.
 */
check('صفحه جعبه‌ی «دیتابیس آماده نیست» دارد', /id="preflightBox"/.test(html) && /preflightList/.test(html));
check('دکمه‌ی اجرا در حالت ناآماده قفل می‌شود', /state\.preflight\.ok !== false/.test(html));
{
  const st0 = await (await fetch(BASE + '/api/state')).json();
  check('وضعیت، نتیجه‌ی پیش‌بررسی را برمی‌گرداند', st0.preflight && st0.preflight.ok === true,
    JSON.stringify(st0.preflight));
}
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

const noPhrase = await post('/api/reset', { acknowledge: true, acknowledged: true });
check('بدون عبارت تأیید رد می‌شود', noPhrase.status === 400, String(noPhrase.status));
check('پیام می‌گوید هیچ داده‌ای تغییر نکرد', /هیچ داده‌ای تغییر نکرد/.test(String(noPhrase.body?.message || '')),
  String(noPhrase.body?.message));

const noAck = await post('/api/reset', { confirm: 'صفر کردن' });
check('بدون تیک «می‌دانم» رد می‌شود', noAck.status === 400, String(noAck.status));

/*
 * درخواست کاربر: «کلید نیاز نباشد». پس درخواستی که هیچ کلیدی ندارد باید
 * جلو برود تا مرحله‌ی اجرا (و اگر همه‌چیز درست باشد، صفر کند).
 */
const noKeyState = await (await fetch(BASE + '/api/state')).json();
check('وضعیت می‌گوید کلید لازم نیست', noKeyState.keyRequired === false);

const noCsrf = await fetch(BASE + '/api/reset', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ confirm: 'صفر کردن', acknowledged: true }),
});
check('بدون توکن CSRF رد می‌شود', noCsrf.status === 400, String(noCsrf.status));

check('بعد از رد شدن‌ها، داده دست‌نخورده است',
  JSON.stringify(countNow()) === JSON.stringify(c0), JSON.stringify(countNow()));

/* ================================================================ */
console.log('\n— صفر کردن واقعی —');

const done = await post('/api/reset', {
  confirm: 'صفر کردن', acknowledged: true,
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
check('مُهر دوره‌ی آزمایشی پاک شد (مشتری جدید روزهای کامل می‌گیرد)', !fs.existsSync(path.join(dir, 'license.trial')));
check('ساعت لایسنس (license.clock) پاک شد', !fs.existsSync(path.join(dir, 'license.clock')));
check('پاسخ گزارش می‌دهد لایسنس پاک شد', done.body.removedLicense === true, String(done.body.removedLicense));
check('پشتیبان‌های قبلی پاک شدند',
  fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('old-')).length === 0,
  fs.readdirSync(path.join(dir, 'backups')).join(','));
const backups = fs.readdirSync(path.join(dir, 'backups'));
check('فقط پشتیبان همین عملیات مانده', backups.length === 1 && backups[0].startsWith('pre-reset-'), backups.join(','));
check('پشتیبان خالی نیست', fs.statSync(path.join(dir, 'backups', backups[0])).size > 0);
check('تاریخچه‌ی صفر کردن نوشته شد', fs.existsSync(path.join(dir, 'reset-history.log')));

/* ================================================================ */
console.log('\n— اجراکننده‌ها و خط فرمان —');

/*
 * ── اجراکننده‌ها (بازنویسی دور ۳۶) ──────────────────────────────────────
 * باگ گزارش‌شده: «اجراکننده‌ها ابزار را باز نمی‌کنند». دو ریشه پیدا شد:
 *   ۱) `start.cmd`ها با پایان‌خط LF در مخزن بودند. cmd.exe با LF ممکن است
 *      `goto`/`:label` و بلاک‌های پرانتزی را نشکند نخواند → پنجره باز و
 *      فوراً بسته می‌شود. راه‌حل: `.gitattributes` با `*.cmd eol=crlf`.
 *   ۲) باز کردن مرورگر با تأخیر ثابت ۲ ثانیه‌ای در cmd بود. حالا سرور خودش
 *      بعد از `listening` مرورگر را باز می‌کند (`openBrowser`).
 * پس دیگر `start ""` در cmd لازم نیست؛ چیزی که لازم است: CRLF + صدا زدن
 * server.mjs + پیدا کردن Node.
 */
for (const f of ['tools/license/start.cmd', 'tools/license/start.sh', 'tools/reset-ui/start.cmd', 'tools/reset-ui/start.sh']) {
  const full = path.join(root, f);
  const buf = fs.existsSync(full) ? fs.readFileSync(full) : Buffer.alloc(0);
  const body = buf.toString('utf8');
  check(`اجراکننده هست: ${f}`, body.length > 100);
  if (f.endsWith('.cmd')) {
    check(`  ${path.basename(f)} بررسی نصب Node`, /where node/.test(body) && /NODE_EXE/.test(body));
    check(`  ${path.basename(f)} سرور را صدا می‌زند`, /server\.mjs/.test(body));
    /* باگ واقعی: فایل LF در مخزن → cmd.exe خراب می‌خواند */
    check(`  ${path.basename(f)} پایان‌خط CRLF دارد`, buf.includes(Buffer.from('\r\n')));
    check(`  ${path.basename(f)} کوتیشن تودرتو/تأخیر حدسی ندارد`, !/timeout \/t/.test(body));
  } else {
    check(`  ${path.basename(f)} اجراپذیر و bash است`, /^#!.*bash/.test(body) && (fs.statSync(full).mode & 0o111) !== 0);
    check(`  ${path.basename(f)} سرور را exec می‌کند`, /exec .*server\.mjs/.test(body));
    /* باگ: مرورگر در شل هم باز می‌شد → دو بار / صفحه‌ی خطا */
    check(`  ${path.basename(f)} خودش مرورگر باز نمی‌کند (کار سرور است)`,
      !/xdg-open|sensible-browser|open "/.test(body));
  }
}
{
  const ga = path.join(root, '.gitattributes');
  check('.gitattributes وجود دارد', fs.existsSync(ga));
  const gaBody = fs.existsSync(ga) ? fs.readFileSync(ga, 'utf8') : '';
  check('.gitattributes برای *.cmd پایان‌خط CRLF را تضمین می‌کند', /\*\.cmd\s+text\s+eol=crlf/.test(gaBody));
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
  /*
   * هش رمز مدیر باید **همان** الگوریتم فعلی برنامه باشد. پیش‌تر این تست فقط
   * رشته‌ی `farday::salt` را می‌جست؛ بعد از رفتن به scrypt هم آن رشته در
   * مسیر سازگاری با هش‌های قدیمی مانده بود و تست سبز می‌ماند در حالی که
   * دو پیاده‌سازی می‌توانستند فرق کنند. حالا فرمت واقعی سنجیده می‌شود.
   */
  check('هش رمز ابزار همان فرمت scrypt برنامه است',
    /scrypt\$/.test(coreReset)
    && /return `scrypt\$\$\{SCRYPT\.N\}\$\$\{SCRYPT\.r\}\$\$\{SCRYPT\.p\}\$/.test(
      fs.readFileSync(path.join(root, 'apps', 'api', 'src', 'common', 'auth.ts'), 'utf8')));
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
  const serverSrc = fs.readFileSync(path.join(root, 'tools', 'reset-ui', 'server.mjs'), 'utf8');
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
  check('سوئیچ --cli --print-reset-key برای بررسی نسخه وجود دارد',
    /print-reset-key/.test(mainRs));
  check('ابزار صفر کردن دیگر کلید نمی‌خواهد (درخواست کاربر)',
    !/resetKey\(\)/.test(serverSrc) && !/FARDAY_RESET_KEY/.test(serverSrc),
    'server.mjs باید بدون کلید کار کند');
  check('کلید صفر کردن در git نیست', /reset-key\.txt/.test(gitignore));
  check('اسکریپت ساخت کلید هست و کامیت‌نشدن را هشدار می‌دهد',
    /reset-key\.txt/.test(keyScript) && /کامیت نکنید/.test(keyScript));
  check('کلید صفر کردن جدا از کلید لایسنس است (دو مقدار مستقل)',
    !/SEALED_RESET_KEY.*SEALED_PUBLIC_KEY[\s\S]{0,80}SEALED_PUBLIC_KEY/.test(buildRs));
}

{
  const doc = fs.readFileSync(path.join(root, 'docs', 'RESET.md'), 'utf8');
  check('راهنمای صفر کردن نوشته شده است', doc.length > 1200);
  check('راهنما اجراکننده‌ها، تأیید متنی و پشتیبان را توضیح می‌دهد',
    /start\.cmd/.test(doc) && /start\.sh/.test(doc) && /صفر کردن/.test(doc) && /pre-reset/.test(doc));
  check('راهنما صریح می‌گوید کلید لازم نیست', /کلید/.test(doc) && /بدون کلید|کلید برداشته شد|کلید لازم نیست/.test(doc));
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

/* ================================================================ */
/*
 * ── رگرسیون باگ گزارش‌شده‌ی کاربر ────────────────────────────────────────
 *   «صفر کردن سیستم درست کار نمی‌کند: table Customer has no column named
 *    isWalkIn.»
 *
 * سناریو: دیتابیس یک **نصب قدیمی** که مهاجرت ستون‌های `isWalkIn`/`isDemo`
 * را ندیده است (یا برنامه هرگز باز نشده). ابزار صفر کردن باید آن را
 * بسازد، نه این‌که وسط کار بشکند.
 */
console.log('\n— رگرسیون: صفر کردن روی دیتابیس نصب قدیمی (isWalkIn) —');
{
  const core = await import(path.join(root, 'tools', 'reset-ui', 'reset-core.mjs'));
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-reset-old-'));
  const oldDb = path.join(oldDir, 'farday.db');
  const odb = new DatabaseSync(oldDb);
  /* ساختار نسخه‌ی قدیمی: بدون isWalkIn/isDemo */
  odb.exec(`CREATE TABLE "Customer" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "code" TEXT NOT NULL,
    "name" TEXT NOT NULL, "contactPerson" TEXT NOT NULL DEFAULT '', "phone" TEXT NOT NULL DEFAULT '',
    "truckPlate" TEXT NOT NULL DEFAULT '', "openingBalance" REAL NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  odb.exec(`CREATE TABLE "User" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL DEFAULT '', "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'employee', "active" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  odb.exec(`CREATE TABLE "Sale" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "no" TEXT NOT NULL,
    "date" TEXT NOT NULL, "customerId" INTEGER, "total" REAL NOT NULL DEFAULT 0)`);
  odb.prepare(`INSERT INTO "Customer" ("code","name") VALUES (?,?)`).run('001', 'مشتری قدیمی');
  odb.close();

  const pre = await core.preflight({ dbFile: oldDb });
  check('پیش‌بررسی دیتابیس قدیمی را «آماده» می‌داند', pre.ok === true, JSON.stringify(pre.problems));

  const r = await core.resetOffline({ dbFile: oldDb, dataDir: oldDir }, { confirm: 'صفر کردن' });
  check('صفر کردن روی دیتابیس قدیمی موفق است (باگ isWalkIn رفع شد)', r.ok === true,
    JSON.stringify(r.message || r).slice(0, 200));
  const after = new DatabaseSync(oldDb, { readOnly: true });
  const cols = after.prepare('PRAGMA table_info("Customer")').all().map((c) => c.name);
  check('ستون isWalkIn در دیتابیس قدیمی ساخته شد', cols.includes('isWalkIn'), cols.join(','));
  const walk = after.prepare(`SELECT "code","isWalkIn" FROM "Customer"`).all();
  check('«مشتری گذری» ساخته شد و پرچم گذری دارد',
    walk.some((w) => w.code === '000' && Number(w.isWalkIn) === 1), JSON.stringify(walk));
  const users = after.prepare(`SELECT "username","role" FROM "User"`).all();
  check('کاربر مدیر بعد از صفر کردن وجود دارد (برنامه قابل ورود است)',
    users.some((u) => u.username === 'admin' && u.role === 'manager'), JSON.stringify(users));
  const hash = String(after.prepare(`SELECT "passwordHash" FROM "User" WHERE "username"='admin'`).get()?.passwordHash || '');
  check('رمز مدیر با فرمت scrypt ذخیره شده', /^scrypt\$/.test(hash), hash.slice(0, 16));
  after.close();

  /* ── برگشت خودکار وقتی وسط کار چیزی می‌شکند ── */
  const rbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-reset-rb-'));
  const rbDb = path.join(rbDir, 'farday.db');
  const rdb = new DatabaseSync(rbDb);
  rdb.exec(`CREATE TABLE "Customer" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "code" TEXT NOT NULL,
    "name" TEXT NOT NULL, "contactPerson" TEXT NOT NULL DEFAULT '', "phone" TEXT NOT NULL DEFAULT '',
    "truckPlate" TEXT NOT NULL DEFAULT '', "openingBalance" REAL NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '', "isWalkIn" INTEGER NOT NULL DEFAULT 0)`);
  rdb.exec(`CREATE TABLE "User" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL DEFAULT '', "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'employee', "active" INTEGER NOT NULL DEFAULT 1)`);
  rdb.exec(`CREATE TABLE "LookupItem" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "name" TEXT)`);
  rdb.prepare(`INSERT INTO "Customer" ("code","name") VALUES (?,?)`).run('777', 'مشتری حیاتی');
  rdb.prepare(`INSERT INTO "LookupItem" ("name") VALUES (?)`).run('قلم');
  /* تریگری که پاک کردن LookupItem را می‌شکند — شبیه‌سازی خطای وسط کار */
  rdb.exec(`CREATE TRIGGER "t_no_delete" BEFORE DELETE ON "LookupItem" BEGIN SELECT RAISE(ABORT,'blocked by test'); END`);
  rdb.close();
  const rr = await core.resetOffline({ dbFile: rbDb, dataDir: rbDir }, { confirm: 'صفر کردن' });
  check('خطای وسط کار، «موفق» گزارش نمی‌شود', rr.ok === false, JSON.stringify(rr).slice(0, 160));
  check('خطا می‌گوید دیتابیس برگردانده شد', rr.rolledBack === true && /برگردانده شد/.test(String(rr.message || '')),
    String(rr.message || '').slice(0, 160));
  const rbAfter = new DatabaseSync(rbDb, { readOnly: true });
  const kept = rbAfter.prepare(`SELECT "code" FROM "Customer"`).all().map((x) => x.code);
  check('داده‌ی مشتری بعد از برگشت خودکار سالم است', kept.includes('777'), JSON.stringify(kept));
  rbAfter.close();

  /* ── فایل غیر-SQLite نباید هیچ تغییری بدهد ── */
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-reset-bad-'));
  const badDb = path.join(badDir, 'farday.db');
  fs.writeFileSync(badDb, 'این یک دیتابیس نیست');
  const bad = await core.resetOffline({ dbFile: badDb, dataDir: badDir }, { confirm: 'صفر کردن' });
  check('فایل خراب، صفر کردن را رد می‌کند (نه نیمه‌کاره)', bad.ok === false && Array.isArray(bad.problems),
    JSON.stringify(bad).slice(0, 160));
  check('فایل خراب دست‌نخورده ماند', fs.readFileSync(badDb, 'utf8') === 'این یک دیتابیس نیست');

  for (const d of [oldDir, rbDir, badDir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
}

/* ================================================================ */
console.log('\n— تشخیص پوشه‌ی داده‌ی نسخه‌ی نصب‌شده (باگ دور ۳۴) —');
{
  const dd = await import(`file://${path.join(root, 'tools', 'reset-ui', 'data-dir.mjs')}`);

  /* ۱) APPDATA ویندوز: اولین جایی که `farday.db` دارد باید انتخاب شود */
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-home-'));
  const appdata = path.join(fakeHome, 'AppData', 'Roaming');
  const installed = path.join(appdata, 'af.farday.roshan');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'farday.db'), 'x');
  const winEnv = { APPDATA: appdata, USERPROFILE: fakeHome, PATH: process.env.PATH };
  const r1 = dd.resolveDataDir({ root, env: winEnv, argv: [], platform: 'win32' });
  check('نسخه‌ی نصب‌شده در %APPDATA% پیدا می‌شود', r1.dataDir === installed, r1.dataDir);
  check('فایل دیتابیس همان‌جا انتخاب می‌شود', r1.dbFile === path.join(installed, 'farday.db'), r1.dbFile);
  check('وجود دیتابیس تأیید می‌شود', r1.dbExists === true && r1.explicit === false, JSON.stringify({ e: r1.explicit }));
  check('منبع «تشخیص خودکار» گزارش می‌شود', /APPDATA/.test(r1.source), r1.source);

  /* ۲) مسیر صریح همیشه برنده است */
  const r2 = dd.resolveDataDir({ root, env: winEnv, argv: ['--data-dir', '/tmp/somewhere-else'], platform: 'win32' });
  check('--data-dir بر تشخیص خودکار اولویت دارد', r2.dataDir === path.resolve('/tmp/somewhere-else'), r2.dataDir);
  check('--data-dir «صریح» علامت می‌خورد', r2.explicit === true && r2.source === '--data-dir', r2.source);
  const r2b = dd.resolveDataDir({ root, env: winEnv, argv: ['--data-dir=/tmp/eq-form'], platform: 'win32' });
  check('شکل --data-dir=مسیر هم پذیرفته می‌شود', r2b.dataDir === path.resolve('/tmp/eq-form'), r2b.dataDir);

  /* ۳) FD_RESET_DATA_DIR / FD_DATA_DIR */
  const r3 = dd.resolveDataDir({ root, env: { ...winEnv, FD_RESET_DATA_DIR: '/tmp/fd-reset' }, argv: [], platform: 'win32' });
  check('FD_RESET_DATA_DIR پذیرفته می‌شود', r3.dataDir === path.resolve('/tmp/fd-reset'), r3.dataDir);
  const r3b = dd.resolveDataDir({ root, env: { ...winEnv, FD_DATA_DIR: '/tmp/fd-data' }, argv: [], platform: 'win32' });
  check('FD_DATA_DIR (قاعده‌ی برنامه) پذیرفته می‌شود', r3b.dataDir === path.resolve('/tmp/fd-data'), r3b.dataDir);

  /* ۴) لینوکس: XDG_DATA_HOME */
  const linHome = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-lin-'));
  const xdg = path.join(linHome, 'xdg');
  const linInstalled = path.join(xdg, 'af.farday.roshan');
  fs.mkdirSync(linInstalled, { recursive: true });
  fs.writeFileSync(path.join(linInstalled, 'farday.db'), 'x');
  const r4 = dd.resolveDataDir({
    root, env: { HOME: linHome, XDG_DATA_HOME: xdg, PATH: process.env.PATH }, argv: [], platform: 'linux',
  });
  check('روی لینوکس $XDG_DATA_HOME/af.farday.roshan پیدا می‌شود',
    r4.dataDir === linInstalled, `${r4.dataDir} ← ${r4.source}`);

  /* ۵) هیچ داده‌ای نیست → همه‌ی مسیرها گزارش می‌شوند (نه یک مسیر کور) */
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-empty-'));
  /* `root` را به یک پوشه‌ی خالی می‌دهیم، وگرنه `data/` خودِ مخزن پیدا می‌شد */
  const r5 = dd.resolveDataDir({
    root: emptyHome, env: { USERPROFILE: emptyHome, HOME: emptyHome, PATH: process.env.PATH }, argv: [], platform: 'win32',
  });
  check('وقتی داده نیست، dbExists=false است', r5.dbExists === false);
  check('همه‌ی مسیرهای گشته‌شده گزارش می‌شوند', Array.isArray(r5.searched) && r5.searched.length >= 3,
    String(r5.searched?.length));
  check('پیام راهنما می‌گوید با --data-dir مسیر را بدهید', /--data-dir/.test(String(r5.note || '')), String(r5.note));

  /* ۶) CLI باید مسیر نصب‌شده را واقعاً پیدا و صفر کند */
  const cliEnv = { ...process.env, APPDATA: appdata, USERPROFILE: fakeHome };
  delete cliEnv.FD_DATA_DIR; delete cliEnv.FD_DB_FILE; delete cliEnv.FD_RESET_DATA_DIR;
  const cliFile = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-cli-'));
  const cliInstalled = path.join(cliFile, 'af.farday.roshan');
  fs.mkdirSync(cliInstalled, { recursive: true });
  fs.copyFileSync(dbFile, path.join(cliInstalled, 'farday.db'));
  fs.writeFileSync(path.join(cliInstalled, 'license.trial'), '{"anchor":1}');
  const cliRun = execFileSync(process.execPath, [path.join(root, 'tools', 'reset-ui', 'cli.mjs'), '--info'], {
    cwd: os.tmpdir(), env: { ...cliEnv, APPDATA: cliFile }, encoding: 'utf8',
  });
  check('CLI داده‌ی نسخه‌ی نصب‌شده را پیدا می‌کند',
    cliRun.includes(cliInstalled), cliRun.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300));
  const cliInfo = execFileSync(process.execPath, [path.join(root, 'tools', 'reset-ui', 'cli.mjs'), '--info', '--data-dir', cliInstalled], {
    cwd: os.tmpdir(), env: { ...cliEnv, APPDATA: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'farday-none-')), 'x') }, encoding: 'utf8',
  });
  check('CLI با --data-dir هم کار می‌کند', cliInfo.includes(cliInstalled), cliInfo.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 200));

  for (const d of [fakeHome, linHome, emptyHome, cliFile]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
}

/* ================================================================ */
console.log('\n— جدول‌های لایسنس و شمارنده هم صفر می‌شوند (باگ دور ۳۴) —');
{
  const core = await import(`file://${path.join(root, 'tools', 'reset-ui', 'reset-core.mjs')}`);
  for (const t of ['License', 'LicenseClock', 'LicenseEvent', 'Sequence']) {
    check(`جدول ${t} در فهرست صفر کردن هست`, core.RESET_ORDER.includes(t), core.RESET_ORDER.join(','));
  }
  check('جدول User عمداً صفر نمی‌شود (کاربران می‌مانند)', !core.RESET_ORDER.includes('User'));

  /* یک دیتابیس تازه + لایسنس/شمارنده، بعد صفر کردن */
  const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-lic-'));
  const ldb = path.join(ldir, 'farday.db');
  const { DatabaseSync: DS } = await import('node:sqlite');
  const seed = new DS(ldb);
  seed.exec(`CREATE TABLE "User" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "username" TEXT NOT NULL, "fullName" TEXT NOT NULL DEFAULT '', "passwordHash" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'manager', "active" INTEGER NOT NULL DEFAULT 1)`);
  seed.exec(`CREATE TABLE "Customer" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "openingBalance" REAL NOT NULL DEFAULT 0)`);
  seed.exec(`CREATE TABLE "License" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "text" TEXT NOT NULL)`);
  seed.exec(`CREATE TABLE "LicenseClock" ("id" INTEGER PRIMARY KEY, "anchor" INTEGER NOT NULL DEFAULT 0)`);
  seed.exec(`CREATE TABLE "LicenseEvent" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "action" TEXT NOT NULL)`);
  seed.exec(`CREATE TABLE "Sequence" ("scope" TEXT PRIMARY KEY, "value" INTEGER NOT NULL DEFAULT 0)`);
  seed.exec(`INSERT INTO "Customer" ("code","name") VALUES ('C-9','مشتری قبلی')`);
  seed.exec(`INSERT INTO "License" ("text") VALUES ('FR-OLD-LICENSE')`);
  seed.exec(`INSERT INTO "LicenseClock" ("id","anchor") VALUES (1, 1)`);
  seed.exec(`INSERT INTO "LicenseEvent" ("action") VALUES ('activate')`);
  seed.exec(`INSERT INTO "Sequence" ("scope","value") VALUES ('S-1405', 41)`);
  seed.close();

  const lrun = await core.resetOffline({ dbFile: ldb, dataDir: ldir }, { confirm: 'صفر کردن', operator: 'test' });
  check('صفر کردن با جدول‌های لایسنس موفق است', lrun.ok === true, String(lrun.message).slice(0, 120));
  const after = new DS(ldb, { readOnly: true });
  try {
    for (const t of ['License', 'LicenseClock', 'LicenseEvent', 'Sequence']) {
      const c = Number(after.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c);
      check(`  ${t} خالی شد`, c === 0, String(c));
    }
    check('  کاربر مدیر ساخته شد', Number(after.prepare(`SELECT COUNT(*) c FROM "User"`).get().c) === 1);
  } finally { after.close(); }
  check('فایل دیتابیس بعد از VACUUM سالم است',
    fs.statSync(ldb).size > 0 && fs.readFileSync(ldb).subarray(0, 15).toString() === 'SQLite format 3');
  fs.rmSync(ldir, { recursive: true, force: true });
}

/* ================================================================ */
/*
 * «برنامه باز است» — تشخیص واقعی (شکار باگ دور ۳۴)
 *
 * پیش از این، سرور ابزار `/api/system/info` را می‌پرسید که پشت توکن است؛
 * پاسخ ۴۰۱ می‌آمد، مقایسه‌ی مسیر دیتابیس همیشه شکست می‌خورد و ابزار **همیشه**
 * فکر می‌کرد برنامه بسته است — بعد سراغ حالت آفلاین می‌رفت در حالی که
 * دیتابیس قفل بود. حالا با مسیر عمومی `info-light` تشخیص داده می‌شود.
 *
 * این بلوک یک API واقعی روی همان پوشه‌ی داده بالا می‌آورد، پورت را در فایل
 * `api-port` می‌نویسد (کاری که پوسته‌ی Tauri می‌کند) و می‌پرسد ابزار چه
 * می‌بیند. سپس با یک API روی پوشه‌ی **دیگر** بررسی می‌کند که ابزار گول
 * نخورد (دیتابیس دیگری را صفر نکند).
 */
console.log('\n— تشخیص «برنامه باز است» —');
{
  const apiPort = 4510, toolPort = 4511;
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-other-'));
  const distMain = path.join(root, 'apps', 'api', 'dist', 'main.js');
  const startApi = (dataDirX, port) => spawn(process.execPath, [distMain], {
    cwd: root,
    /* FD_DB_FILE ارثی نباید بماند — وگرنه «داده‌ی دیگر» همان داده‌ی قبلی می‌شود */
    env: {
      ...process.env, FD_DATA_DIR: dataDirX, FD_PORT: String(port), FD_LICENSE_DEV: '1',
      FD_DB_FILE: path.join(dataDirX, 'farday.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const waitHealth = async (port) => {
    for (let i = 0; i < 160; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return true; } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  };
  const readState = async (port) => {
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/state`); if (r.ok) return r.json(); } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    return {};
  };

  if (!fs.existsSync(distMain)) {
    check('بسته‌ی API برای تست «برنامه باز است» موجود است', false, distMain);
  } else {
    fs.writeFileSync(path.join(dir, 'api-port'), String(apiPort));
    const app = startApi(dir, apiPort);
    check('API روی همان داده بالا آمد', await waitHealth(apiPort));

    /* info-light باید بدون توکن جواب بدهد */
    const light = await fetch(`http://127.0.0.1:${apiPort}/api/system/info-light`).then((r) => r.json()).catch(() => ({}));
    check('info-light بدون توکن مسیر دیتابیس را می‌دهد', String(light?.dbFile || '').endsWith('farday.db'), JSON.stringify(light).slice(0, 120));
    check('info-light هیچ چیز حساسی ندارد', !('machineKey' in (light || {})) && !('license' in (light || {})));

    const tool = spawn(process.execPath, [path.join(root, 'tools', 'reset-ui', 'server.mjs')], {
      cwd: root,
      env: { ...process.env, FD_DATA_DIR: dir, FD_DB_FILE: dbFile, FD_RESET_UI_PORT: String(toolPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const st = await readState(toolPort);
    check('ابزار می‌فهمد برنامه باز است', st.appOpen === true, `appOpen=${st.appOpen} port=${st.port}`);
    check('ابزار پورت واقعی برنامه را می‌گوید', Number(st.port) === apiPort, String(st.port));
    check('در حالت باز، صفر کردن از راه خود برنامه انجام می‌شود', st.apiMode === true);
    try { tool.kill('SIGKILL'); } catch { /* */ }

    /* حالا یک برنامه‌ی دیگر (داده‌ی دیگر) روی همان پورت ثبت‌شده */
    const otherPort = 4512;
    fs.writeFileSync(path.join(dir, 'api-port'), String(otherPort));
    await waitHealth(apiPort);
    const other = startApi(otherDir, otherPort);
    check('API دوم روی داده‌ی دیگر بالا آمد', await waitHealth(otherPort));

    const tool2Port = 4513;
    const tool2 = spawn(process.execPath, [path.join(root, 'tools', 'reset-ui', 'server.mjs')], {
      cwd: root,
      env: { ...process.env, FD_DATA_DIR: dir, FD_DB_FILE: dbFile, FD_RESET_UI_PORT: String(tool2Port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const st2 = await readState(tool2Port);
    check('برنامه‌ی دیگر «برنامه‌ی من باز است» حساب نمی‌شود', st2.appOpen === false, `appOpen=${st2.appOpen}`);
    try { tool2.kill('SIGKILL'); } catch { /* */ }

    try { app.kill('SIGKILL'); } catch { /* */ }
    try { other.kill('SIGKILL'); } catch { /* */ }
    try { fs.rmSync(otherDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

/* ================================================================ */
console.log('\n— نسخه‌ی Node و node:sqlite —');
{
  const core = await import(`file://${path.join(root, 'tools', 'reset-ui', 'reset-core.mjs')}`);
  const rt = await core.runtimeInfo();
  check('وضعیت Node گزارش می‌شود', typeof rt.node === 'string' && rt.node.length > 0, rt.node);
  check('node:sqlite در این نسخه کار می‌کند', rt.sqlite === true, rt.message);
  /*
   * سرورِ اصلی تست در بلوک‌های قبلی بسته شد؛ برای خواندن `/api/state` یک
   * نمونه‌ی کوتاه روی پورت دیگر بالا می‌آوریم (همان پوشه‌ی داده، فقط خواندن).
   */
  {
    const p2 = 4478, b2 = `http://127.0.0.1:${p2}`;
    const srv = spawn(process.execPath, [path.join(root, 'tools', 'reset-ui', 'server.mjs')], {
      cwd: root,
      env: { ...process.env, FD_DATA_DIR: dir, FD_DB_FILE: dbFile, FD_RESET_UI_PORT: String(p2) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let st3 = {};
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(b2 + '/api/state'); if (r.ok) { st3 = await r.json(); break; } } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    try { srv.kill('SIGKILL'); } catch { /* */ }
    check('صفحه‌ی ابزار وضعیت Node را می‌گیرد', st3.runtime && st3.runtime.sqlite === true, JSON.stringify(st3.runtime));
    check('صفحه‌ی ابزار مسیرهای گشته‌شده را می‌گیرد', Array.isArray(st3.searched) && st3.searched.length >= 1,
      String(st3.searched?.length));
    check('صفحه‌ی ابزار منبع داده را می‌گوید', typeof st3.dataSource === 'string' && st3.dataSource.length > 0, st3.dataSource);
  }

  /*
   * ── باگ دور ۳۴: «برنامه باز است» هرگز تشخیص داده نمی‌شد ────────────────
   * ابزار با `/api/system/info` می‌پرسید «این دیتابیس همان دیتابیس من است؟»
   * ولی آن مسیر توکن می‌خواهد و ابزار توکن ندارد؛ پاسخ ۴۰۱ بود، مقایسه همیشه
   * شکست می‌خورد و ابزار فکر می‌کرد برنامه بسته است. حالا نسخه‌ی سبکِ عمومی
   * (`info-light`) بدون توکن همان مسیر دیتابیس را می‌دهد.
   */
  {
    check('مسیر عمومیِ info-light در سرور ابزار استفاده می‌شود',
      /info-light/.test(fs.readFileSync(path.join(root, 'tools', 'reset-ui', 'server.mjs'), 'utf8')));
    const ctl = fs.readFileSync(path.join(root, 'apps', 'api', 'src', 'modules', 'system.controller.ts'), 'utf8');
    check('info-light با @Public() علامت خورده (بدون توکن قابل خواندن است)',
      /@Public\(\)[\s\S]{0,200}infoLight/.test(ctl));
    check('info-light هیچ چیز حساسی برنمی‌گرداند (نه دستگاه، نه لایسنس)',
      !/machineKey|license|deviceId/.test((ctl.split('infoLight')[1] || '').split('@Get')[0]));
  }
  const uiSrc = fs.readFileSync(path.join(root, 'tools', 'reset-ui', 'ui.html'), 'utf8');
  check('صفحه جعبه‌ی «نسخه‌ی Node آماده نیست» دارد', /id="runtimeCard"/.test(uiSrc) && /runtimeBox/.test(uiSrc));
  check('صفحه مسیرهای گشته‌شده را نشان می‌دهد', /whereBox/.test(uiSrc) && /searched/.test(uiSrc));
  check('دکمه‌ی اجرا با Node ناسالم قفل می‌شود', /state\.runtime\.ok !== false/.test(uiSrc));
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
finish();

function finish() {
  console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  process.exit(fail === 0 ? 0 : 1);
}
