/**
 * تست «صفر کردن کامل سیستم» از راه API و «هشدار لایسنس».
 *
 *   npm run test:reset
 *
 * چرا از راه API هم تست می‌شود: ابزار بیرونی ممکن است با برنامه‌ی **باز** کار
 * کند؛ آن مسیر از `/system/reset` می‌گذرد و باید همان حفاظ‌ها را داشته باشد:
 * فقط مدیر، فقط از همین کمپیوتر، عبارت تأیید، پشتیبان اجباری.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const PORT = 4474;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-resetapi-'));

let passed = 0, failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
}

const dist = path.join(root, 'apps/api/dist');
if (!fs.existsSync(path.join(dist, 'main.js'))) {
  console.error('\n⛔ بسته‌ی API ساخته نشده. اول: npm run build -w @farday/api\n');
  process.exit(1);
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  const kp = crypto.generateKeyPairSync('ed25519');
  const pub = b64u(kp.publicKey.export({ type: 'spki', format: 'der' }));
  const child = spawn(process.execPath, [path.join(dist, 'main.js')], {
    cwd: root,
    env: { ...process.env, FD_DATA_DIR: dataDir, FD_PORT: String(PORT), FD_LICENSE_DEV: '1', FD_LICENSE_PUBLIC_KEY: pub },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  const api = async (method, url, body, token = '') => {
    const res = await fetch(BASE + url, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-auth-token': token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let out; try { out = JSON.parse(text); } catch { out = text; }
    return { status: res.status, body: out };
  };

  let up = false;
  for (let i = 0; i < 160 && !up; i++) {
    try { up = (await fetch(BASE + '/health')).ok; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  check('سرور بالا آمد', up, up ? '' : log.slice(-400));
  if (!up) { try { child.kill(); } catch { /* */ } return finish(); }

  const mk = (await api('GET', '/license/device')).body.machineKey;
  const body = b64u(JSON.stringify({
    v: 1, id: 'FR-LIC-RST', customer: 'آزمون صفر کردن', kind: 'yearly',
    start: addDays(todayISO(), -1), end: addDays(todayISO(), 200), machineKey: mk, seats: 1,
    note: '', issuedAt: new Date().toISOString(),
  }));
  const lic = `-----BEGIN FARDAY LICENSE-----\nFR-1\n${body}\n${b64u(crypto.sign(null, Buffer.from(body, 'utf8'), kp.privateKey))}\n-----END FARDAY LICENSE-----`;
  await api('POST', '/license/activate', { text: lic });
  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body?.token || '';
  check('ورود مدیر', Boolean(token));

  /* چند سند واقعی بسازیم تا صفر کردن چیزی برای پاک‌کردن داشته باشد */
  const sale = await api('POST', '/sales', {
    materialName: 'ریگ', volume: 2, unitPrice: 100, freightPerUnit: 0, paymentType: 'cash', date: todayISO(),
  }, token);
  check('بل فروش ثبت شد', sale.status === 200 || sale.status === 201, String(sale.status));
  const cust = await api('POST', '/customers', { code: '900', name: 'مشتری آزمون' }, token);
  check('مشتری ثبت شد', cust.status === 200 || cust.status === 201, String(cust.status));

  /* ================================================================ */
  console.log('\n— وضعیت قبل از صفر کردن —');

  const info = await api('GET', '/system/reset/info', undefined, token);
  check('وضعیت داده خوانده می‌شود', info.status === 200, String(info.status));
  check('سیستم «آک» نیست', info.body?.clean === false, JSON.stringify(info.body?.total));
  check('تعداد ردیف‌های کاری گزارش می‌شود', Number(info.body?.total) > 0, String(info.body?.total));
  check('فروش و مشتری شمرده می‌شوند',
    Number(info.body?.counts?.Sale) >= 1 && Number(info.body?.counts?.Customer) >= 2,
    JSON.stringify(info.body?.counts));
  check('عبارت تأیید از سرور می‌آید', info.body?.phrase === 'صفر کردن', String(info.body?.phrase));
  check('فهرست جدول‌های هدف برمی‌گردد', Array.isArray(info.body?.plan?.tables) && info.body.plan.tables.length > 5,
    JSON.stringify(info.body?.plan?.tables?.slice(0, 5)));

  /* ================================================================ */
  console.log('\n— حفاظ‌ها —');

  const noPhrase = await api('POST', '/system/reset', { backup: true }, token);
  check('بدون عبارت تأیید رد می‌شود', noPhrase.status === 400, String(noPhrase.status));
  check('پیام می‌گوید هیچ‌چیز تغییر نکرد', /هیچ داده‌ای تغییر نکرد/.test(String(noPhrase.body?.message || '')),
    String(noPhrase.body?.message));

  const wrongPhrase = await api('POST', '/system/reset', { confirm: 'پاک کن' }, token);
  check('عبارت اشتباه رد می‌شود', wrongPhrase.status === 400, String(wrongPhrase.status));

  const saleAfter = await api('GET', '/sales', undefined, token);
  check('بعد از رد شدن، اسناد سر جایشان‌اند', Number(saleAfter.body?.total ?? 1) >= 1,
    String(saleAfter.body?.total));

  const noAuth = await api('POST', '/system/reset', { confirm: 'صفر کردن' });
  check('بدون ورود، رد می‌شود', noAuth.status === 401 || noAuth.status === 403, String(noAuth.status));

  /* کارمند عادی نباید بتواند */
  const emp = await api('POST', '/users', {
    username: 'emp-' + Date.now(), fullName: 'کارمند آزمون', password: 'emp12345', role: 'employee',
  }, token);
  if (emp.status === 200 || emp.status === 201) {
    const empToken = (await api('POST', '/auth/login', { username: emp.body.username, password: 'emp12345' })).body?.token || '';
    const byEmp = await api('POST', '/system/reset', { confirm: 'صفر کردن' }, empToken);
    /* ۴۰۳ = دسترسی ندارید، ۴۰۱ = ورود نشد؛ هر دو یعنی «نشد» */
    check('کارمند عادی نمی‌تواند سیستم را صفر کند', [401, 403].includes(byEmp.status), String(byEmp.status));
  }

  /* ================================================================ */
  console.log('\n— صفر کردن —');

  const done = await api('POST', '/system/reset', { confirm: 'صفر کردن', reason: 'آزمون' }, token);
  check('صفر کردن انجام شد', [200, 201].includes(done.status) && done.body?.ok === true,
    `${done.status} ${JSON.stringify(done.body).slice(0, 200)}`);
  check('پشتیبان قبل از پاک‌کردن گرفته شد', Boolean(done.body?.backupFile), String(done.body?.backupFile));
  /*
   * کاربر مدیر قبل از صفر کردن وجود داشت، پس `admin` نباید برگردد (رمز
   * عوض نمی‌شود). پیام هم نباید بی‌دلیل رمز پیش‌فرض را نشان بدهد.
   */
  check('رمز مدیر موجود دست‌نخورده می‌ماند (admin در پاسخ نمی‌آید)', !done.body?.admin, JSON.stringify(done.body?.admin));
  check('پیام تنها وقتی رمز را می‌گوید که کاربر ساخته باشد',
    !/admin123/.test(String(done.body?.message || '')), String(done.body?.message));
  const backupPath = path.join(dataDir, 'backups', String(done.body?.backupFile || ''));
  check('فایل پشتیبان روی دیسک هست', Boolean(done.body?.backupFile) && fs.existsSync(backupPath));

  const afterInfo = await api('GET', '/system/reset/info', undefined, token);
  check('سیستم حالا «آک» است', afterInfo.body?.clean === true, JSON.stringify(afterInfo.body?.counts));
  check('هیچ فروشی نمانده', Number(afterInfo.body?.counts?.Sale || 0) === 0, String(afterInfo.body?.counts?.Sale));
  check('مهر صفر کردن ثبت شد', Boolean(afterInfo.body?.mark?.at), JSON.stringify(afterInfo.body?.mark));
  check('دلیل در مهر هست', /آزمون/.test(String(afterInfo.body?.mark?.reason || '')), String(afterInfo.body?.mark?.reason));

  const salesNow = await api('GET', '/sales', undefined, token);
  check('فهرست فروشات خالی شد', Number(salesNow.body?.total || 0) === 0, String(salesNow.body?.total));

  const walk = await api('GET', '/customers?walkIn=1', undefined, token);
  check('«مشتری گذری» باقی ماند', (walk.body || []).some((c) => String(c.code) === '000'), JSON.stringify(walk.body));

  /* سیستم باید بعد از صفر کردن قابل استفاده باشد: بل فروش جدید ثبت شود */
  const fresh = await api('POST', '/sales', {
    materialName: 'ریگ', volume: 1, unitPrice: 50, freightPerUnit: 0, paymentType: 'cash', date: todayISO(),
  }, token);
  check('بعد از صفر کردن می‌شود بل تازه ثبت کرد', fresh.status === 200 || fresh.status === 201,
    `${fresh.status} ${JSON.stringify(fresh.body).slice(0, 120)}`);

  /* فایل‌ها: لایسنس باید پاک شده باشد، پشتیبان مانده باشد */
  check('لایسنس فعال پاک شد (ردّ مشتری قبلی)', !fs.existsSync(path.join(dataDir, 'license.key')));
  check('مُهر دوره‌ی آزمایشی پاک شد (license.trial)', !fs.existsSync(path.join(dataDir, 'license.trial')));
  /*
   * ── باگ دور ۳۴ ──────────────────────────────────────────────────────────
   * متن لایسنس در **جدول** `License` هم ذخیره می‌شود و `activeLicenseText`
   * اول از همان می‌خواند. `RESET_ORDER` این جدول‌ها را نداشت، پس با وجود
   * پاک شدن فایل، لایسنس مشتری قبلی روی نصب می‌ماند و مشتری بعدی با آن
   * وارد می‌شد. حالا جدول‌ها هم باید خالی باشند.
   */
  const { DatabaseSync: DSync } = require('node:sqlite');
  {
    const d = new DSync(path.join(dataDir, 'farday.db'), { readOnly: true });
    try {
      const cnt = (t) => Number(d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c);
      check('جدول License خالی شد (لایسنس مشتری قبلی نمی‌ماند)', cnt('License') === 0, String(cnt('License')));
      check('جدول LicenseEvent خالی شد', cnt('LicenseEvent') === 0, String(cnt('LicenseEvent')));
      /* شمارنده بعد از ثبت سند تازه (`fresh`) دوباره یک ردیف دارد — پس
         «صفر شدن» از روی شماره‌ی همان سند سنجیده می‌شود (پایین‌تر). */
      check('شمارنده‌ی شماره‌ی اسناد دوباره از یک شروع شده (نه ادامه‌ی مشتری قبلی)',
        cnt('Sequence') <= 2, String(cnt('Sequence')));
      check('کاربران سیستم باقی ماندند', cnt('User') >= 1, String(cnt('User')));
    } finally { d.close(); }
  }
  /* بعد از صفر کردن، شماره‌ی سند تازه باید از ۱ شروع شود، نه ادامه‌ی قبلی */
  {
    const no = String(fresh.body?.no || '');
    check('شماره‌ی سند بعد از صفر کردن از ۰۰۰۱ شروع می‌شود', /-0001$/.test(no), no);
  }
  const backups = fs.existsSync(path.join(dataDir, 'backups')) ? fs.readdirSync(path.join(dataDir, 'backups')) : [];
  check('فقط پشتیبان همین عملیات مانده', backups.length >= 1 && backups.every((f) => f.startsWith('pre-reset-') || f.startsWith('.')),
    backups.join(','));

  /* ================================================================ */
  console.log('\n— برگشت خودکار وقتی وسط صفر کردن خطا می‌دهد —');
  /*
   * باگ (شکار باگ دور ۳۰): ابزار آفلاین از دور ۲۸ برگشت خودکار داشت، ولی
   * مسیر آنلاین (`POST /system/reset`) نداشت. با یک تریگر که حذف را
   * می‌شکند، همین حالت را واقعاً می‌سازیم: صفر کردن باید شکست بخورد و
   * دیتابیس **دست‌نخورده** برگردد (بل قبلی سر جایش باشد).
   */
  const fresh2 = await api('POST', '/sales', {
    materialName: 'ریگ', volume: 3, unitPrice: 70, freightPerUnit: 0, paymentType: 'cash', date: todayISO(),
  }, token);
  check('بل دوم برای آزمون برگشت ثبت شد', [200, 201].includes(fresh2.status), String(fresh2.status));
  const beforeFail = await api('GET', '/sales', undefined, token);
  const saleCountBefore = Number(beforeFail.body?.total || 0);
  check('شمارش فروش قبل از شکست', saleCountBefore >= 1, String(saleCountBefore));

  /* تریگر مستقیم روی فایل دیتابیس (سرور باز است، ولی SQLite این را اجازه می‌دهد) */
  const { DatabaseSync } = require('node:sqlite');
  {
    const dbf = path.join(dataDir, 'farday.db');
    const con = new DatabaseSync(dbf);
    con.exec('CREATE TRIGGER IF NOT EXISTS reset_block BEFORE DELETE ON "Sale" BEGIN SELECT RAISE(ABORT, \'blocked for test\'); END');
    con.close();
  }

  const failedReset = await api('POST', '/system/reset', { confirm: 'صفر کردن', reason: 'آزمون برگشت' }, token);
  check('صفر کردن شکست خورد (نه ۲۰۰ بی‌اثر)', failedReset.status === 400, String(failedReset.status));
  check('پیام می‌گوید برگردانده شد', /برگردانده شد|بازگردانید/.test(String(failedReset.body?.message || '')),
    String(failedReset.body?.message));
  /*
   * ⚠ این بررسی روی runner گیت‌هاب قرمز می‌شد و محلی سبز. برای این‌که
   * دفعه‌ی بعد «چرا» معلوم باشد، نه فقط «false»، وضعیت کامل گزارش می‌شود:
   * چه فایل پشتیبانی ساخته شد، آیا وجود دارد، و بدنه‌ی پاسخ چه می‌گوید.
   */
  {
    const b = failedReset.body || {};
    const bakName = String(b.backupFile || '');
    const bakPath = bakName ? path.join(dataDir, 'backups', bakName) : '';
    const diag = {
      rolledBack: b.rolledBack,
      ok: b.ok,
      backupFile: bakName,
      backupExists: bakPath ? fs.existsSync(bakPath) : null,
      backupSize: bakPath && fs.existsSync(bakPath) ? fs.statSync(bakPath).size : null,
      rollbackError: String(b.rollbackError || '(none)'),
      messageHead: String(b.message || '').slice(0, 120),
      status: failedReset.status,
    };
    check('پرچم rolledBack در پاسخ هست', b.rolledBack === true, JSON.stringify(diag));
  }

  const afterFail = await api('GET', '/sales', undefined, token);
  check('داده‌ها بعد از شکست سر جایشان‌اند',
    Number(afterFail.body?.total || 0) === saleCountBefore,
    `${afterFail.body?.total} vs ${saleCountBefore}`);
  const loginAfterFail = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  check('برنامه بعد از برگشت هنوز کار می‌کند (ورود)', Boolean(loginAfterFail.body?.token),
    String(loginAfterFail.status));

  try { child.kill(); } catch { /* */ }
  finish();
})().catch((e) => { console.error('\n⛔ خطای غیرمنتظره:', e); finish(1); });

function finish(code = 0) {
  console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  console.log('');
  process.exit(failed === 0 && code === 0 ? 0 : 1);
}
