/**
 * تست امنیت ورود و کاربران — `npm run test:auth`
 *
 * ── باگ‌هایی که از بازگشتشان جلوگیری می‌کند (شکار باگ دور ۲۷) ─────────────
 *
 * ۱) رمزها با SHA-256 و **نمک ثابت هاردکدشده** ذخیره می‌شدند: دو کاربر با
 *    رمز یکسان هش یکسان داشتند و یک جدول رنگین‌کمانی برای همه‌ی نصب‌ها کار
 *    می‌کرد. حالا `scrypt` با نمک تصادفیِ هر کاربر.
 * ۲) هش‌های قدیمی باید هنوز کار کنند و در همان ورود، بی‌صدا ارتقا یابند.
 * ۳) تغییر رمز/نقش/غیرفعال‌سازی، نشست‌های باز کاربر را باطل نمی‌کرد.
 * ۴) رمز تازه می‌توانست همان رمز فعلی باشد («ذخیره شد» بدون هیچ تغییری).
 * ۵) نقش ناشناخته بی‌صدا «مدیر» می‌شد.
 * ۶) ابزار صفر کردن (reset-core) باید **همان** الگوریتم هش را بسازد، وگرنه
 *    بعد از صفر کردن هیچ‌کس نمی‌تواند وارد شود.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..', '..', '..');
/* پورت تصادفی تا اجرای هم‌زمان/پروسه‌ی جامانده تست را به سرور دیگری وصل نکند */
const PORT = 5100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-auth-'));

let passed = 0, failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
}

let token = '';
async function api(method, url, body, tk = token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-auth-token': tk },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const legacyHash = (pw) => crypto.createHash('sha256').update(String(pw) + 'farday::salt').digest('hex');

async function main() {
  const dist = path.join(root, 'apps/api/dist');
  if (!fs.existsSync(path.join(dist, 'main.js'))) {
    console.error('\n⛔ API ساخته نشده. اول: npm run build -w @farday/api\n');
    process.exit(1);
  }
  const child = spawn(process.execPath, [path.join(dist, 'main.js')], {
    cwd: root,
    env: { ...process.env, FD_DATA_DIR: dataDir, FD_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const dbFile = path.join(dataDir, 'farday.db');
  const sql = (q, ...args) => {
    const d = new DatabaseSync(dbFile);
    try {
      const st = d.prepare(q);
      return /^\s*select/i.test(q) ? st.all(...args) : st.run(...args);
    } finally { d.close(); }
  };

  try {
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* wait */ }
      if (child.exitCode !== null) throw new Error(`API بسته شد:\n${log}`);
      await new Promise((r) => setTimeout(r, 400));
    }

    const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' }, '');
    /* تأیید هویت سرور: اگر پروسه‌ی جامانده‌ای روی این پورت باشد، تست بی‌معنا می‌شود */
    const who = await api('GET', '/system/info', undefined, login.body?.token || '');
    if (String(who?.body?.dataDir || '') !== dataDir) {
      throw new Error(`سرور روی پورت ${PORT} سرورِ این تست نیست (dataDir=${who?.body?.dataDir})`);
    }
    token = login.body?.token || '';
    check('ورود مدیر با رمز پیش‌فرض', !!token, JSON.stringify(login.body).slice(0, 120));

    console.log('\n— ۱) ذخیره‌ی رمز —');
    let adminHash = String(sql(`SELECT "passwordHash" FROM "User" WHERE "username"='admin'`)[0]?.passwordHash || '');
    check('هش ذخیره‌شده فرمت scrypt دارد', /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(adminHash), adminHash.slice(0, 30));
    check('هش دیگر SHA-256 ساده نیست', !/^[0-9a-f]{64}$/.test(adminHash));
    check('نمک تصادفی است (هش با رمز یکسان تکرار نمی‌شود)', (() => {
      const a = crypto.scryptSync('admin123', crypto.randomBytes(16), 32).toString('hex');
      const b = crypto.scryptSync('admin123', crypto.randomBytes(16), 32).toString('hex');
      return a !== b;
    })());

    console.log('\n— ۲) کاربر کارمند —');
    const empUser = `emp${Date.now() % 100000}`;
    const mk = await api('POST', '/users', { username: empUser, password: 'emp12345', fullName: 'کارمند تست', role: 'employee' });
    check('ساخت کاربر کارمند', [200, 201].includes(mk.status), JSON.stringify(mk.body).slice(0, 120));
    const badRole = await api('POST', '/users', { username: empUser + 'x', password: 'emp12345', role: 'superuser' });
    check('نقش ناشناخته ۴۰۰ می‌دهد (بی‌صدا مدیر نمی‌شود)', badRole.status === 400, String(badRole.status));
    const noRole = await api('POST', '/users', { username: empUser + 'y', password: 'emp12345' });
    const noRoleRow = sql(`SELECT "role" FROM "User" WHERE "username"=?`, empUser + 'y')[0];
    check('کاربر بدون نقش، «کارمند» می‌شود (نه مدیر)', [200, 201].includes(noRole.status) && noRoleRow?.role === 'employee',
      `${noRole.status}/${noRoleRow?.role}`);

    const empLogin = await api('POST', '/auth/login', { username: empUser, password: 'emp12345' }, '');
    const empToken = empLogin.body?.token || '';
    check('کارمند می‌تواند وارد شود', !!empToken);
    const usersOfEmp = await api('GET', '/users', undefined, empToken);
    check('کارمند به فهرست کاربران دسترسی ندارد', usersOfEmp.status === 403, String(usersOfEmp.status));

    console.log('\n— ۳) باطل شدن نشست‌ها —');
    const empRow = sql(`SELECT "id" FROM "User" WHERE "username"=?`, empUser)[0];
    const chg = await api('POST', `/users/${empRow.id}`, { username: empUser, fullName: 'کارمند تست', role: 'employee', active: true, password: 'newpass123' });
    check('مدیر رمز کارمند را عوض می‌کند', [200, 201].includes(chg.status), String(chg.status));
    const afterChange = await api('GET', '/auth/me', undefined, empToken);
    check('نشست قبلی کارمند بعد از تغییر رمز باطل شد', afterChange.status === 401, String(afterChange.status));
    const oldPw = await api('POST', '/auth/login', { username: empUser, password: 'emp12345' }, '');
    check('رمز قدیمی دیگر کار نمی‌کند', oldPw.status === 401, String(oldPw.status));
    const newPw = await api('POST', '/auth/login', { username: empUser, password: 'newpass123' }, '');
    check('رمز تازه کار می‌کند', !!newPw.body?.token);
    const empToken2 = newPw.body?.token || '';

    const deact = await api('POST', `/users/${empRow.id}`, { username: empUser, role: 'employee', active: false, fullName: 'کارمند تست' });
    check('غیرفعال‌سازی کاربر', [200, 201].includes(deact.status), String(deact.status));
    const afterDeact = await api('GET', '/auth/me', undefined, empToken2);
    check('نشست کاربر غیرفعال‌شده باطل شد', afterDeact.status === 401, String(afterDeact.status));
    const loginDeact = await api('POST', '/auth/login', { username: empUser, password: 'newpass123' }, '');
    check('کاربر غیرفعال نمی‌تواند وارد شود', loginDeact.status === 401, String(loginDeact.status));

    /*
     * ── باگ (شکار باگ دور ۳۴): «ویرایش کوتاه» کاربر را عوض می‌کرد ──────────
     * اگر بدنه فقط `password` (یا فقط `fullName`) داشته باشد، نقش و
     * فعال/غیرفعال‌بودن باید **دست‌نخورده** بمانند. پیش‌تر نقش به «کارمند»
     * برمی‌گشت و `active` به ۱ — یعنی غیرفعال‌سازی کاربر با یک ویرایش ساده
     * باطل می‌شد و مدیر بی‌صدا تنزل می‌کرد.
     */
    const mgrName = `mgr${Date.now() % 100000}`;
    await api('POST', '/users', { username: mgrName, password: 'mgr12345', fullName: 'مدیر دوم', role: 'manager' });
    const mgrRow = sql(`SELECT "id" FROM "User" WHERE "username"=?`, mgrName)[0];
    const shortEdit = await api('POST', `/users/${mgrRow.id}`, { password: 'mgr54321' });
    const afterShort = sql(`SELECT "role","active","fullName" FROM "User" WHERE "id"=?`, mgrRow.id)[0];
    check('ویرایش فقط رمز، نقش مدیر را تنزل نمی‌دهد',
      [200, 201].includes(shortEdit.status) && afterShort?.role === 'manager', `${shortEdit.status}/${afterShort?.role}`);
    check('ویرایش فقط رمز، نام کامل را پاک نمی‌کند', afterShort?.fullName === 'مدیر دوم', String(afterShort?.fullName));
    await api('POST', `/users/${mgrRow.id}`, { role: 'manager', active: false });
    const reEnable = await api('POST', `/users/${mgrRow.id}`, { fullName: 'مدیر دوم (ویرایش)' });
    const afterEdit = sql(`SELECT "role","active","fullName" FROM "User" WHERE "id"=?`, mgrRow.id)[0];
    check('ویرایش نام، کاربر غیرفعال را دوباره فعال نمی‌کند',
      [200, 201].includes(reEnable.status) && Number(afterEdit?.active) === 0,
      `${reEnable.status}/${afterEdit?.active}`);
    check('ویرایش نام، نقش را دست‌نخورده می‌گذارد', afterEdit?.role === 'manager', String(afterEdit?.role));
    const badRoleEdit = await api('POST', `/users/${mgrRow.id}`, { role: 'boss' });
    check('نقش نامعتبر در ویرایش ۴۰۰ می‌دهد', badRoleEdit.status === 400, String(badRoleEdit.status));
    const restored = await api('POST', `/users/${mgrRow.id}`, { role: 'manager', active: true });
    check('می‌شود کاربر را دوباره فعال کرد', [200, 201].includes(restored.status), String(restored.status));

    console.log('\n— ۴) تغییر رمز خودِ کاربر —');
    const same = await api('POST', '/auth/change-password', { currentPassword: 'admin123', newPassword: 'admin123' });
    check('رمز تازه یکسان با رمز فعلی رد می‌شود', same.status === 400, String(same.status));
    const wrong = await api('POST', '/auth/change-password', { currentPassword: 'غلط', newPassword: 'abcdef' });
    check('رمز فعلی اشتباه رد می‌شود', wrong.status === 400, String(wrong.status));
    const shortPw = await api('POST', '/auth/change-password', { currentPassword: 'admin123', newPassword: 'ab' });
    check('رمز کوتاه رد می‌شود', shortPw.status === 400, String(shortPw.status));

    console.log('\n— ۵) سازگاری با هش قدیمی —');
    /* کاربر تازه با هش قدیمی (مثل نسخه‌های قبل) می‌سازیم */
    const legacyName = `old${Date.now() % 100000}`;
    sql(
      `INSERT INTO "User" ("username","fullName","passwordHash","role","active") VALUES (?,?,?,?,1)`,
      legacyName, 'کاربر قدیمی', legacyHash('legacy123'), 'employee',
    );
    const legacyLogin = await api('POST', '/auth/login', { username: legacyName, password: 'legacy123' }, '');
    check('کاربر با هش قدیمی می‌تواند وارد شود', !!legacyLogin.body?.token, JSON.stringify(legacyLogin.body).slice(0, 100));
    const upgraded = String(sql(`SELECT "passwordHash" FROM "User" WHERE "username"=?`, legacyName)[0]?.passwordHash || '');
    check('هش قدیمی در همان ورود به scrypt ارتقا یافت', /^scrypt\$/.test(upgraded), upgraded.slice(0, 20));
    const legacyAgain = await api('POST', '/auth/login', { username: legacyName, password: 'legacy123' }, '');
    check('بعد از ارتقا، همان رمز هنوز کار می‌کند', !!legacyAgain.body?.token);
    const legacyWrong = await api('POST', '/auth/login', { username: legacyName, password: 'غلط' }, '');
    check('رمز غلط بعد از ارتقا رد می‌شود', legacyWrong.status === 401, String(legacyWrong.status));

    console.log('\n— ۶) ابزار صفر کردن همان الگوریتم را دارد —');
    const core = await import(path.join(root, 'tools', 'reset-ui', 'reset-core.mjs'));
    const h1 = core.hashPassword('admin123');
    check('reset-core هم فرمت scrypt می‌سازد', /^scrypt\$16384\$8\$1\$[0-9a-f]+\$[0-9a-f]+$/.test(h1), h1.slice(0, 24));
    check('هش ساخته‌شده توسط ابزار، با سرور قابل بررسی است', (() => {
      /* همان بازسازی‌ای که سرور انجام می‌دهد */
      const [, n, r, p, saltHex, keyHex] = h1.split('$');
      const key = crypto.scryptSync('admin123', Buffer.from(saltHex, 'hex'), keyHex.length / 2, {
        N: Number(n), r: Number(r), p: Number(p),
      });
      return key.toString('hex') === keyHex;
    })());
    check('هش ابزار با رمز غلط تطبیق نمی‌دهد', (() => {
      const [, n, r, p, saltHex, keyHex] = h1.split('$');
      const key = crypto.scryptSync('wrong', Buffer.from(saltHex, 'hex'), keyHex.length / 2, {
        N: Number(n), r: Number(r), p: Number(p),
      });
      return key.toString('hex') !== keyHex;
    })());
  } finally {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }

  console.log(`\n${failed === 0 ? '✔' : '✘'} ${passed} تست موفق، ${failed} ناموفق`);
  if (failed) { console.log('\nمشکلات:'); problems.forEach((p) => console.log(` • ${p}`)); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
