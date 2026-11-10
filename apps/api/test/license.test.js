/**
 * تست سیستم لایسنس — بدون فرض اعتماد به خودمان.
 *
 *   npm run test:license
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) امضای Ed25519: لایسنس دست‌نخورده پذیرفته، هر تغییر (نام/تاریخ/کلید
 *      دستگاه) رد می‌شود، امضای لایسنس دیگر روی این لایسنس کار نمی‌کند.
 *   ۲) قفل دستگاه: لایسنس دستگاه دیگر روی این کمپیوتر رد می‌شود.
 *   ۳) قفل زمان: عقب‌بردن/جلوبردن ساعت بیش از ۲۴ ساعت تشخیص داده می‌شود،
 *      و داخل تلورانس پذیرفته است.
 *   ۴) لایسنس منقضی، با ساعت عقب‌برده‌شده هم زنده نمی‌شود (effectiveNow).
 *   ۵) فعال‌سازی زنده از طریق HTTP: قفل نصب تازه → صفحه‌ی لایسنس → فعال‌سازی
 *      با متن امضاشده → API باز می‌شود؛ متن جعلی/دست‌کاری‌شده رد می‌شود.
 *   ۶) کلید دستگاه پایدار است و با ورودی‌های مختلف قالب یکسان می‌دهد.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const PORT = 4462;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-license-'));

let passed = 0;
let failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
}

/* ---------- همان crypto که ابزار لایسنس استفاده می‌کند ---------- */
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const genKeys = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: b64u(publicKey.export({ type: 'spki', format: 'der' })),
    privateKey,
  };
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function makeLicense({ key, payload, signWith }) {
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.sign(null, Buffer.from(body, 'utf8'), signWith || key.privateKey));
  return { text: `-----BEGIN FARDAY LICENSE-----\nFR-1\n${body}\n${sig}\n-----END FARDAY LICENSE-----`, body, sig };
}
/**
 * دست‌کاری واقعی: بدنه را باز می‌کند، تغییر می‌دهد و **با همان امضای قبلی**
 * برمی‌گرداند — همان کاری که یک مهاجم با Notepad می‌کند.
 */
function tamper(text, patch) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^FR-\d+$/.test(l.trim()));
  const bi = i >= 0 ? i + 1 : 0;
  const payload = JSON.parse(unb64u(lines[bi]).toString('utf8'));
  const out = lines.slice();
  out[bi] = b64u(JSON.stringify({ ...payload, ...patch }));
  return out.join('\n');
}
const payloadBase = (over = {}) => ({
  v: 1, id: 'FR-LIC-TEST-1', customer: 'شرکت آزمون', kind: 'yearly',
  start: '2026-01-01', end: '2030-12-31', machineKey: '', seats: 1, note: '',
  issuedAt: '2026-01-01T00:00:00.000Z', ...over,
});

/*
 * مقدارهای واقعی برنامه — از **بسته‌ی ساخته‌شده** (apps/api/dist) نه سورس TS.
 * چرا: همان کدی که در نصب‌کننده می‌رود آزمایش شود، نه یک نسخه‌ی موازی.
 *   npm run build -w @farday/api   (یا npm run test:license که خودش می‌سازد)
 */
const common = path.join(root, 'apps/api/dist/common');
const license = require(path.join(common, 'license.js'));
const clock = require(path.join(common, 'license-clock.js'));
const machine = require(path.join(common, 'license-machine.js'));

(async () => {
  console.log('\n— امضای Ed25519 —');
  const a = genKeys();
  const b = genKeys();
  const okLicense = makeLicense({ key: a, payload: payloadBase() });
  const self = license.verifyLicense(okLicense.text, a.publicKey);
  check('لایسنس دست‌نخورده پذیرفته می‌شود', self.ok === true, self.reason || '');
  check('کلید عمومی دیگر آن را رد می‌کند', license.verifyLicense(okLicense.text, b.publicKey).ok === false);

  /* دست‌کاری بدنه: تاریخ پایان به ۲۱۰۰ */
  const forgedPayload = payloadBase({ end: '2100-01-01' });
  const forgedBody = b64u(JSON.stringify(forgedPayload));
  const forged = okLicense.text.replace(okLicense.body, forgedBody);
  check('تغییر تاریخ پایان رد می‌شود', license.verifyLicense(forged, a.publicKey).ok === false);

  /* امضای لایسنس دیگر */
  const other = makeLicense({ key: a, payload: payloadBase({ id: 'FR-LIC-OTHER' }) });
  const swapped = okLicense.text.replace(okLicense.sig, other.sig);
  check('امضای لایسنس دیگر روی این متن کار نمی‌کند', license.verifyLicense(swapped, a.publicKey).ok === false);

  /* متن بی‌معنا و خالی */
  check('متن خالی رد می‌شود', license.verifyLicense('', a.publicKey).ok === false);
  check('متن بی‌معنا رد می‌شود', license.verifyLicense('سلام، لایسنس من!', a.publicKey).ok === false);
  check('base64 ویرایش‌شده (بدون امضا) رد می‌شود', license.verifyLicense(`FR-1\n${forgedBody}\n${okLicense.sig}`, a.publicKey).ok === false);

  console.log('\n— قالب متن لایسنس —');
  const parsed = license.parseLicenseText(okLicense.text);
  check('بدنه/base64 درست خوانده می‌شود', parsed.payload.customer === 'شرکت آزمون');
  const noHeader = license.verifyLicense(`${okLicense.body}\n${okLicense.sig}`, a.publicKey);
  check('کپی فقط رشته‌ی base64 هم پذیرفته می‌شود (بدون سرصفحه)', noHeader.ok === true, noHeader.reason || '');
  const wsLines = `-----BEGIN FARDAY LICENSE-----\r\n  FR-1  \r\n${okLicense.body}\r\n${okLicense.sig}\r\n-----END FARDAY LICENSE-----`;
  check('فاصله/CRLF اضافه تحمل می‌شود', license.verifyLicense(wsLines, a.publicKey).ok === true);

  console.log('\n— کلید دستگاه —');
  const mk1 = await machine.machineKeyForDevice();
  const mk2 = await machine.machineKeyForDevice();
  check('کلید دستگاه پایدار است', mk1 === mk2, `${mk1} != ${mk2}`);
  check('کلید دستگاه قالب ۵×۵ دارد', /^[2-9A-HJ-NP-Z]{5}(-[2-9A-HJ-NP-Z]{5}){4}$/.test(mk1), mk1);
  check('همان بذر → همان کلید', license.machineKeyFromSeed('abc') === license.machineKeyFromSeed('abc'));
  check('بذر متفاوت → کلید متفاوت', license.machineKeyFromSeed('abc') !== license.machineKeyFromSeed('abd'));
  check('ورودی با فاصله/حروف کوچک یکسان‌سازی می‌شود',
    license.normalizeMachineKey(' a74pa aw6c7 uab99 papju vqwqw ') === 'A74PA-AW6C7-UAB99-PAPJU-VQWQW');
  check('کلید کوتاه نامعتبر است', license.isValidMachineKey('A74PA') === false);

  console.log('\n— قفل زمان (۲۴ ساعت تلورانس) —');
  const t0 = Date.parse('2026-11-10T10:00:00Z');
  const st = { anchor: t0, lastSeen: t0, violations: 0, lastViolationAt: 0 };
  const inTol = clock.checkClock(st, t0 + 20 * 3600 * 1000);
  check('۲۰ ساعت عقب → پذیرفته', inTol.ok === true && inTol.tampered === false);
  const overBack = clock.checkClock(st, t0 - 25 * 3600 * 1000);
  check('۲۵ ساعت عقب → قفل', overBack.tampered === true && overBack.ok === false);
  const overFwd = clock.checkClock(st, t0 + 26 * 3600 * 1000);
  check('۲۶ ساعت جلو → قفل', overFwd.tampered === true);
  check('پیام قفل فارسی و روشن است', /ساعت کمپیوتر/.test(overBack.message || ''), overBack.message);
  check('مرجع هرگز عقب نمی‌رود', overBack.state.anchor >= t0);
  check('شمارنده‌ی تخلف زیاد می‌شود', overBack.state.violations === 1);

  const expired = { start: '2026-01-01', end: '2026-06-30' };
  const nowOk = clock.effectiveNow({ anchor: t0, lastSeen: t0, violations: 0, lastViolationAt: 0 }, t0 - 400 * 86400000);
  check('ساعت عقب‌برده «اکنون مؤثر» را عقب نمی‌برد', nowOk >= t0);
  check('لایسنس منقضی با ساعت عقب‌برده هم منقضی می‌ماند',
    clock.licenseInWindow(expired, new Date(nowOk).toISOString().slice(0, 10)).ok === false);
  check('روز پایان شامل اعتبار است', clock.licenseInWindow(expired, '2026-06-30').ok === true);
  check('یک روز بعد از پایان منقضی است', clock.licenseInWindow(expired, '2026-07-01').ok === false);
  check('شروع در آینده پذیرفته نمی‌شود', clock.licenseInWindow({ start: '2027-01-01', end: null }, '2026-11-10').ok === false);
  check('لایسنس ابد پایان ندارد', clock.daysLeft(null, '2026-11-10') === null);

  console.log('\n— مهر ساعت (دست‌کاری فایل) —');
  const key = clock.clockKey('signature-abc');
  const sealed = JSON.stringify(clock.sealClock(key, { anchor: t0, lastSeen: t0, violations: 0, lastViolationAt: 0 }));
  check('مهر سالم باز می‌شود', clock.unsealClock(key, sealed)?.anchor === t0);
  check('تغییر anchor مهر را می‌شکند',
    clock.unsealClock(key, sealed.replace(`"anchor":${t0}`, `"anchor":1`)) === null);
  check('کلید دیگر مهر را نمی‌خواند', clock.unsealClock(clock.clockKey('other'), sealed) === null);

  /* ---------- سرور واقعی ---------- */
  console.log('\n— فعال‌سازی روی سرور واقعی —');
  const kp = genKeys();
  const realMachineKey = mk1;
  const trial = makeLicense({
    key: kp,
    payload: payloadBase({ id: 'FR-LIC-E2E', machineKey: realMachineKey, start: addDays(todayISO(), -1), end: addDays(todayISO(), 300) }),
  });
  const wrongMachine = makeLicense({
    key: kp,
    payload: payloadBase({ id: 'FR-LIC-WRONG', machineKey: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', start: addDays(todayISO(), -1), end: addDays(todayISO(), 300) }),
  });

  const child = spawn(process.execPath, [path.join(root, 'apps/api/dist/main.js')], {
    cwd: root,
    env: {
      ...process.env,
      FD_DATA_DIR: dataDir,
      FD_PORT: String(PORT),
      FD_LICENSE_PUBLIC_KEY: kp.publicKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });

  const api = async (method, url, body, token = '') => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  const waitUp = async () => {
    for (let i = 0; i < 120; i++) {
      try { const r = await fetch(BASE + '/health'); if (r.ok) return true; } catch { /* wait */ }
      if (child.exitCode !== null) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };

  const up = await waitUp();
  check('سرور بالا آمد', up, up ? '' : serverLog.slice(-400));
  if (!up) {
    child.kill();
    finish();
    return;
  }

  /* ۱) در حالت آزمایشی: وضعیت trial و API باز است */
  const stTrial = await api('GET', '/license/status');
  check('حالت اولیه «آزمایشی» است', stTrial.body.state === 'trial', JSON.stringify(stTrial.body.state));
  check('صفحه‌ی لایسنس بدون ورود در دسترس است', stTrial.status === 200);
  const dev = await api('GET', '/license/device');
  check('کلید دستگاه از API خوانده می‌شود', /^[0-9A-Z-]{29}$/.test(dev.body.machineKey || ''), dev.body.machineKey);

  /* ۲) لایسنس دستگاه دیگر رد می‌شود */
  const wrong = await api('POST', '/license/activate', { text: wrongMachine.text });
  check('لایسنس دستگاه دیگر فعال نمی‌شود', wrong.status === 400, String(wrong.status));
  check('پیام «دستگاه دیگری» روشن است', /دستگاه دیگر/.test(String(wrong.body.message || '')), String(wrong.body.message));

  /* ۳) لایسنس دست‌کاری‌شده رد می‌شود */
  const tampered = await api('POST', '/license/activate', { text: tamper(trial.text, { end: '2099-01-01' }) });
  check('لایسنس دست‌کاری‌شده فعال نمی‌شود', tampered.status === 400);

  /* ۴) فعال‌سازی درست */
  const activation = await api('POST', '/license/activate', { text: trial.text });
  check('لایسنس معتبر فعال شد', activation.status === 201 || activation.status === 200, JSON.stringify(activation.body).slice(0, 200));
  const stAfter = await api('GET', '/license/status');
  check('وضعیت بعد از فعال‌سازی valid است', stAfter.body.state === 'valid', stAfter.body.state);
  check('تاریخ پایان به شمسی نمایش داده می‌شود', /[۰-۹]+ (حمل|ثور|جوزا|سرطان|اسد|سنبله|میزان|عقرب|قوس|جدی|دلو|حوت) [۰-۹]+/.test(String(stAfter.body.endLabel || '')), String(stAfter.body.endLabel));
  check('«سنجهٔ زمان» امروز را با رقم فارسی می‌دهد', /^[۰-۹]+ [\u0600-\u06FF]+ [۰-۹]+$/.test(String(stAfter.body.nowLabel || '')), String(stAfter.body.nowLabel));

  /* ۵) بعد از فعال‌سازی، ورود و مسیرهای محافظت‌شده کار می‌کنند */
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  check('ورود مدیر کار می‌کند', login.status === 201 || login.status === 200, String(login.status));
  const token = login.body?.token || '';
  const customers = await api('GET', '/customers', undefined, token);
  check('با لایسنس معتبر، مسیرهای داده باز هستند', customers.status === 200, String(customers.status));

  /* ۶) لایسنس منقضی: با ساعت عقب‌برده هم نباید باز شود */
  const expiredText = makeLicense({
    key: kp,
    payload: payloadBase({ id: 'FR-LIC-OLD', machineKey: realMachineKey, start: '2024-01-01', end: '2024-12-31' }),
  }).text;
  const exp = await api('POST', '/license/activate', { text: expiredText });
  check('فعال‌سازی لایسنس منقضی پیام می‌دهد', exp.body?.status?.state === 'expired' || exp.status === 400, String(JSON.stringify(exp.body).slice(0, 160)));

  /* ۷) در حالت قفل، API بسته است ولی /license/status باز است */
  const locked = await api('GET', '/customers', undefined, token);
  check('با لایسنس منقضی، داده‌ها بسته است (۴۲۳)', locked.status === 423, String(locked.status));
  check('کد خطا LICENSE_REQUIRED است', locked.body?.code === 'LICENSE_REQUIRED', JSON.stringify(locked.body).slice(0, 120));
  const stillOpen = await api('GET', '/license/status');
  check('صفحه‌ی لایسنس در حالت قفل باز است', stillOpen.status === 200 && stillOpen.body.ok === false);

  /* ۸) فعال‌سازی دوباره با لایسنس معتبر، قفل را باز می‌کند */
  const react = await api('POST', '/license/activate', { text: tamper(trial.text, { customer: 'شرکت هکر' }) });
  check('متن دست‌کاری‌شده هنگام بازگشایی رد می‌شود', react.status >= 400 && react.status < 500,
    `${react.status} ${String(react.body?.message || '').slice(0, 60)}`);
  const back = await api('POST', '/license/activate', { text: trial.text });
  check('فعال‌سازی دوباره با لایسنس معتبر موفق است', back.status === 200 || back.status === 201);
  const reopened = await api('GET', '/customers', undefined, token);
  check('بعد از فعال‌سازی دوباره، داده‌ها باز است', reopened.status === 200, String(reopened.status));

  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  if (child.exitCode === null) child.kill('SIGKILL');
  finish();

  function finish() {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام${failed ? '\n' + problems.join('\n') : ''}\n`);
    process.exit(failed === 0 ? 0 : 1);
  }
})().catch((e) => {
  console.error('⛔ خطای غیرمنتظره در تست لایسنس:', e);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
