/**
 * تست «بروزرسانی بدون خراب شدن داده» — درخواست مالک:
 *
 *   «من این سیستم را بین شرکت‌ها توزیع کرده‌ام؛ بروزرسانی‌های آینده نباید داده‌ی
 *    کاربران را خراب کند و همه باید بتوانند بروزرسانی را درست بگیرند.»
 *
 *   node apps/api/test/upgrade.test.js
 *
 * ## چه چیزی واقعاً شبیه‌سازی می‌شود
 *
 * یک «نصب قدیمی مشتری» ساخته می‌شود: دیتابیسی با ساختار **کمتر** از امروز
 * (بدون چند ستون اخیر، مثلاً `isWalkIn` و `isDemo`)، با داده‌ی واقعی
 * (مشتری، بل فروش، رسید) و `PRAGMA user_version = 5`. بعد برنامه‌ی امروز روی
 * همان فایل بالا می‌آید — همان چیزی که هنگام نصب بروزرسانی روی کمپیوتر
 * مشتری رخ می‌دهد.
 *
 * سنجه‌ها:
 *   ۱) داده‌ی مشتری **دست‌نخورده** می‌ماند (همان تعداد و همان مبالغ)
 *   ۲) ستون‌های تازه اضافه می‌شوند و `user_version` به نسخه‌ی امروز می‌رسد
 *   ۳) **قبل** از مهاجرت یک پشتیبان `pre-upgrade-v5-*.db` گرفته می‌شود
 *      و آن پشتیبان خودش سالم و قابل بازگردانی است
 *   ۴) تاریخچه‌ی بروزرسانی نوشته می‌شود (چه از چه نسخه‌ای، با کدام پشتیبان)
 *   ۵) بار دوم که برنامه بالا می‌آید، مهاجرت **تکرار نمی‌شود** (پشتیبان
 *      تکراری ساخته نمی‌شود) — وگرنه هر بار باز کردن برنامه یک فایل اضافه
 *      می‌گذاشت
 *   ۶) دیتابیسی با ساختار **جدیدتر** از برنامه: برنامه قفل نمی‌کند، هشدار
 *      می‌دهد و داده را نمی‌شکند
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..', '..', '..');
const dist = path.join(root, 'apps/api/dist');
const PORT = 4416;
const BASE = `http://127.0.0.1:${PORT}/api`;

let passed = 0, failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name}${extra ? ' → ' + extra : ''}`); }
}

if (!fs.existsSync(path.join(dist, 'main.js'))) {
  console.error('\n⛔ بسته‌ی API ساخته نشده. اول: npm run build -w @farday/api\n');
  process.exit(1);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-upgrade-'));
const dbFile = path.join(dataDir, 'farday.db');

/**
 * ساخت «نصب قدیمی»: جدول‌ها بدون ستون‌های تازه، مهر نسخه = ۵، داده‌ی واقعی.
 * عمداً فقط ستون‌هایی ساخته می‌شوند که در نسخه‌ی قدیمی بودند.
 */
function buildOldDatabase() {
  /*
   * «نسخه‌ی قدیمی» از **خودِ فایل امروز** ساخته می‌شود، بعد چند ستونِ تازه
   * حذف می‌شود. چرا: یک نصب قدیمی واقعی هم همین ستون‌های مشترک را دارد؛
   * اگر جدول‌ها را دستی و ناقص بنویسیم، تست چیزی را می‌سنجد که در دنیای
   * واقعی وجود ندارد (همان اشتباهی که اول این تست را قرمز کرد: `no such
   * column: lastLoginAt`).
   */
  const tmp = path.join(dataDir, 'modern.db');
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(dist, 'cli', 'seed.js')], {
    cwd: root,
    env: { ...process.env, FD_DATA_DIR: dataDir, FD_DB_FILE: tmp, FD_LICENSE_DEV: '1', FD_LICENSE_PUBLIC_KEY: '' },
    stdio: 'ignore',
  });
  /*
   * ⚠ کاپی باید همراه `-wal`/`-shm` باشد: دیتابیسِ تازه‌ساخته در حالت WAL
   * ممکن است **همه‌ی** جدول‌هایش هنوز در فایل WAL باشد و فایل اصلی تقریباً
   * خالی. (اول همین تست قرمز شد: `no such table: User`.)
   */
  fs.copyFileSync(tmp, dbFile);
  for (const s2 of ['-wal', '-shm']) {
    if (fs.existsSync(tmp + s2)) fs.copyFileSync(tmp + s2, dbFile + s2);
  }
  fs.rmSync(tmp, { force: true });
  for (const s2 of ['-wal', '-shm']) fs.rmSync(tmp + s2, { force: true });

  const db = new DatabaseSync(dbFile);
  /* پاک کردن داده‌ی نمونه/پیش‌فرض تا فقط داده‌ی «مشتری قدیمی» بماند */
  for (const t of ['Sale', 'Receipt', 'Expense', 'Salary', 'Attendance', 'Employee', 'ActivityLog', 'Customer', 'User']) {
    try { db.exec(`DELETE FROM "${t}"`); } catch { /* ignore */ }
  }
  /*
   * کاربر مدیر با یک هش **واقعی** ساخته می‌شود، دقیقاً مثل نصب قدیمیِ یک
   * مشتریِ واقعی: هشِ scrypt با همان پارامترهای امروز (بخش `hashPassword`).
   */
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('admin123', salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const hash = `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
  db.prepare(`INSERT INTO "User" ("username","fullName","passwordHash","role","active")
              VALUES ('admin','مدیر',?, 'manager',1)`).run(hash);
  db.exec(`INSERT INTO "Customer" ("code","name","openingBalance") VALUES ('101','شرکت قدیمی بامیان',5000)`);
  db.exec(`INSERT INTO "Customer" ("code","name","openingBalance") VALUES ('102','شرکت قدیمی کندز',0)`);
  db.exec(`INSERT INTO "Sale" ("no","date","customerId","customerName","materialName","volume","unitPrice","total","paymentType")
           VALUES ('S-1404-0001','2025-05-01',2,'شرکت قدیمی بامیان','ریگ',10,100,1000,'credit')`);

  /*
   * حالا دیتابیس را به «نسخه‌ی ۵» برمی‌گردانیم: ستون‌هایی که بعداً اضافه
   * شده‌اند حذف می‌شوند (SQLite از ۳٫۳۵ حذف ستون را پشتیبانی می‌کند).
   */
  const dropCols = {
    Customer: ['isWalkIn', 'isDemo', 'deletedAt', 'deletedBy'],
    Sale: ['deletedAt', 'deletedBy', 'isDemo'],
    Receipt: ['deletedAt', 'deletedBy', 'isDemo'],
    Expense: ['deletedAt', 'deletedBy', 'isDemo'],
    Employee: ['deletedAt', 'deletedBy'],
    User: ['deletedAt', 'deletedBy'],
  };
  for (const [table, cols] of Object.entries(dropCols)) {
    const have = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => String(c.name));
    for (const c of cols) {
      if (have.includes(c)) {
        try { db.exec(`ALTER TABLE "${table}" DROP COLUMN "${c}"`); } catch { /* ignore */ }
      }
    }
  }
  db.exec('PRAGMA user_version = 5');
  /* نوشتن WAL داخل فایل اصلی، وگرنه نسخه‌ی بعدی ممکن است داده را نبیند */
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  db.close();
}

/** داده‌ی کاریِ زنده — همان چیزی که کاربر در برنامه می‌بیند. */
async function snapshot() {
  const t = await login();
  const c = await api('GET', '/customers', undefined, t);
  const s = await api('GET', '/sales', undefined, t);
  const rows = Array.isArray(s.body?.rows) ? s.body.rows : (Array.isArray(s.body) ? s.body : []);
  return {
    customers: (c.body || []).length,
    customerNames: (c.body || []).map((x) => x.name).sort(),
    opening: (c.body || []).reduce((a, x) => a + Number(x.openingBalance || 0), 0),
    sales: rows.length,
    salesTotal: rows.reduce((a, x) => a + Number(x.total || 0), 0),
  };
}

async function api(method, url, body, token = '') {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-auth-token': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let out; try { out = JSON.parse(text); } catch { out = text; }
  return { status: res.status, body: out };
}

async function login() {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const r = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
    if (r.body?.token) return r.body.token;
    last = r;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  throw new Error('ورود مدیر نشد — ' + JSON.stringify(last));
}

function startServer(env = {}) {
  const child = spawn(process.execPath, [path.join(dist, 'main.js')], {
    cwd: root,
    env: {
      ...process.env, FD_DATA_DIR: dataDir, FD_PORT: String(PORT),
      FD_LICENSE_DEV: '1', FD_LICENSE_PUBLIC_KEY: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = { text: '' };
  child.stdout.on('data', (d) => { log.text += d.toString(); });
  child.stderr.on('data', (d) => { log.text += d.toString(); });
  return { child, log };
}

/**
 * منتظر بالا آمدن **همین** سرور می‌مانیم، نه هر سروری روی این پورت.
 *
 * باگ (این تست گرفت): یک فرآیندِ قدیمیِ جامانده از اجرای ناموفق قبل روی همین
 * پورت زنده مانده بود؛ `/health` جواب می‌داد ولی از دیتابیس دیگری — و تست
 * با «ورود مدیر نشد» در جای اشتباهی می‌شکست. حالا مسیر دیتابیس بررسی می‌شود.
 */
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(BASE + '/health')).ok) {
        const info = await fetch(BASE + '/system/info').then((r) => r.json()).catch(() => ({}));
        const dir = String(info?.dataDir || '');
        if (!dir || path.resolve(dir) === path.resolve(dataDir)) return true;
        console.error(`⛔ پورت ${PORT} را یک فرآیند دیگر گرفته است (dataDir=${dir}). ` +
          'آن را ببندید یا پورت تست را عوض کنید.');
        return false;
      }
    } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function stop(srv) {
  try { srv.child.kill('SIGKILL'); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 400));
}

(async () => {
  buildOldDatabase();

  /* ============================================================== */
  console.log('\n— بالا آمدن برنامه‌ی امروز روی نصب قدیمی (ساختار ۵) —');
  const srv1 = startServer();
  const up1 = await ready();
  if (!up1) console.log('--- server log ---\n' + srv1.log.text.slice(-3000));
  if (process.env.UPGRADE_DEBUG) {
    const d0 = new DatabaseSync(dbFile);
    const u0 = d0.prepare('SELECT id,username,substr(passwordHash,1,20) h,active FROM "User"').all();
    console.log('DEBUG users:', JSON.stringify(u0));
    console.log('DEBUG hash len:', JSON.stringify(d0.prepare('SELECT length(passwordHash) l, passwordHash FROM "User"').all()));
    console.log('DEBUG verify:', JSON.stringify(require(path.join(root, 'apps/api/dist/common/auth.js')).verifyPassword('admin123', d0.prepare('SELECT passwordHash FROM "User"').get().passwordHash)));
    d0.close();
  }
  check('برنامه روی دیتابیس قدیمی بالا آمد', up1, srv1.log.text.slice(-300));
  if (!up1) { await stop(srv1); return finish(); }

  const t = await login();
  check('مدیر قدیمی می‌تواند وارد شود (رمز دست‌نخورده)', Boolean(t));

  const snap1 = await snapshot();
  check('مشتریان قدیمی سر جایشان‌اند', snap1.customers >= 2, String(snap1.customers));
  check('بل فروش قدیمی سر جایش است', snap1.sales >= 1, String(snap1.sales));
  check('مبلغ بل قدیمی عوض نشده', snap1.salesTotal === 1000, String(snap1.salesTotal));
  check('بدهی اولیه‌ی مشتریان عوض نشده', snap1.opening === 5000, String(snap1.opening));

  /* ستون‌های تازه باید اضافه شده باشند */
  {
    const db = new DatabaseSync(dbFile);
    const cols = db.prepare('PRAGMA table_info("Customer")').all().map((c) => String(c.name));
    const v = Number(db.prepare('PRAGMA user_version').get().user_version);
    db.close();
    check('ستون isWalkIn اضافه شد', cols.includes('isWalkIn'), cols.join(','));
    check('ستون isDemo اضافه شد', cols.includes('isDemo'), cols.join(','));
    check('ستون deletedAt اضافه شد', cols.includes('deletedAt'), cols.join(','));
    check('مهر ساختار به نسخه‌ی امروز رسید', v === 7, String(v));
    check('ستون‌های قدیمی دست نخوردند (هیچ delete/تغییر نوعی نیست)',
      cols.includes('openingBalance') && cols.includes('note') && cols.includes('truckPlate'));
  }

  /* پشتیبان قبل از مهاجرت */
  const backupDir = path.join(dataDir, 'backups');
  /* فقط فایل‌های .db — `-wal`/`-shm` همراه پشتیبان‌اند، نه پشتیبان جدا */
  const preUp = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((f) => f.startsWith('pre-upgrade-v5-') && f.endsWith('.db'));
  const preUpFiles = preUp(backupDir);
  check('قبل از مهاجرت پشتیبان گرفته شد (pre-upgrade-v5)', preUpFiles.length === 1, preUpFiles.join(','));

  if (preUpFiles.length) {
    const bfile = path.join(backupDir, preUpFiles[0]);
    const chk = await api('GET', `/system/backup/list`, undefined, t);
    const row = (chk.body?.rows || []).find((r) => r.file === preUpFiles[0]);
    check('پشتیبانِ قبل از مهاجرت سالم است (بررسی واقعی فایل)', Boolean(row?.healthy), JSON.stringify(row));
    check('اندازه‌ی پشتیبان صفر نیست', fs.statSync(bfile).size > 0, String(fs.statSync(bfile).size));
  }

  /* تاریخچه و پنل بروزرسانی */
  const st = await api('GET', '/system/upgrade/status', undefined, t);
  check('وضعیت بروزرسانی خوانده می‌شود', st.status === 200, String(st.status));
  check('ساختار اکنون هم‌تراز است', st.body?.dbShape === st.body?.expectedShape, JSON.stringify(st.body?.dbShape));
  check('پرچم «عقب‌مانده» نیست', st.body?.dbBehind === false, String(st.body?.dbBehind));
  const hist = st.body?.history || [];
  check('تاریخچه‌ی بروزرسانی نوشته شد', hist.length >= 1, JSON.stringify(hist).slice(0, 160));
  check('تاریخچه نسخه‌ی مبدأ و پشتیبان را می‌گوید',
    hist.some((h) => /از ساختار 5/.test(h) && /pre-upgrade-v5/.test(h)), JSON.stringify(hist).slice(0, 200));

  const after = await snapshot();
  check('هیچ مشتری‌ای در مهاجرت گم نشد', after.customers === snap1.customers,
    `${snap1.customers} → ${after.customers}`);
  check('نام مشتریان یکی است', JSON.stringify(after.customerNames) === JSON.stringify(snap1.customerNames));
  check('جمع بل‌های فروش یکی است', after.salesTotal === snap1.salesTotal,
    `${snap1.salesTotal} → ${after.salesTotal}`);

  await stop(srv1);

  /* ============================================================== */
  console.log('\n— اجرای دوم: مهاجرت نباید تکرار شود —');
  const srv2 = startServer();
  check('برنامه بار دوم بالا آمد', await ready(), srv2.log.text.slice(-200));
  const t2 = await login();
  const snap2 = await snapshot();
  check('داده‌ی بار دوم هم سالم است', snap2.salesTotal === snap1.salesTotal && snap2.customers === snap1.customers,
    JSON.stringify(snap2));
  const preUp2 = preUp(backupDir);
  check('پشتیبان تکراری ساخته نشد (مهاجرت فقط یک بار)', preUp2.length === 1, preUp2.join(','));
  const st2 = await api('GET', '/system/upgrade/status', undefined, t2);
  check('بار دوم هم ساختار هم‌تراز است', st2.body?.dbShape === st2.body?.expectedShape);
  await stop(srv2);

  /* ============================================================== */
  console.log('\n— دیتابیسِ ساختار جدیدتر از خود برنامه —');
  {
    const db = new DatabaseSync(dbFile);
    db.exec('PRAGMA user_version = 99');
    db.close();
  }
  const srv3 = startServer();
  const up3 = await ready();
  check('برنامه روی دیتابیس جدیدتر هم بالا می‌آید (قفل نمی‌کند)', up3, srv3.log.text.slice(-300));
  const t3 = await login();
  const snap3 = await snapshot();
  check('داده‌ی مشتری روی دیتابیس جدیدتر خوانده می‌شود', snap3.customers === snap1.customers,
    `${snap3.customers} vs ${snap1.customers}`);
  const st3 = await api('GET', '/system/upgrade/status', undefined, t3);
  check('برنامه می‌گوید «داده از این نسخه جدیدتر است»', st3.body?.dbNewer === true, JSON.stringify(st3.body?.dbShape));
  check('لاگ هشدار جدیدتر بودن را ثبت می‌کند', /DB_NEWER|جدیدتر/.test(srv3.log.text), srv3.log.text.slice(-200));
  check('هیچ ستونی روی دیتابیس جدیدتر دست‌کاری نشد (مهر همان ۹۹ ماند)', (() => {
    const db = new DatabaseSync(dbFile);
    const v = Number(db.prepare('PRAGMA user_version').get().user_version);
    db.close();
    return v === 99;
  })());
  await stop(srv3);

  finish();
})().catch((e) => { console.error('\n⛔ خطای غیرمنتظره:', e); finish(1); });

function finish(code = 0) {
  console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  console.log('');
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(failed === 0 && code === 0 ? 0 : 1);
}
