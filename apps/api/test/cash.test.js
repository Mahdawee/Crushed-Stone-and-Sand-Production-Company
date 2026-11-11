/**
 * تست «صندوق دخل» — شکار باگ دور ۳۲
 *
 *   node apps/api/test/cash.test.js
 *
 * ## باگی که این تست نگه می‌دارد
 * در «راپور روزانه»، ستون آخر «متحرک دخل» برای **همه‌ی** ردیف‌های یک بازه
 * یک عدد ثابت نشان می‌داد (در تست واقعی: ۱۰۰ برای هر روز) و در کارت
 * خلاصه هم «موجودی متحرک دخل» در واقع جمع «موجودی دخل روز» بود. علت:
 * `running` از صفر بازه شروع می‌شد، نه از مانده‌ی قبل از بازه.
 *
 * نتیجه‌ی عملی: کاربر بازه‌ی ماه را باز می‌کرد و عدد آخر جدول با راپور کل
 * سال نمی‌خواند؛ عدد «متحرک» اصلاً حرکت نمی‌کرد.
 *
 * حالا: ستون آخر = مانده‌ی تجمعی دخل از اولین سند تا آن روز؛ برای هر بازه
 * **همان** عددی است که راپور کل سال می‌دهد (سه مسیر، یک عدد).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const dist = path.join(root, 'apps/api/dist');
const PORT = 4455;
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-cash-'));
const child = spawn(process.execPath, [path.join(dist, 'main.js')], {
  cwd: root,
  env: {
    ...process.env, FD_DATA_DIR: dataDir, FD_PORT: String(PORT),
    FD_LICENSE_DEV: '1', FD_LICENSE_PUBLIC_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });

const api = async (method, url, body, token = '') => {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-auth-token': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
};

const kill = () => { try { child.kill('SIGKILL'); } catch { /* */ } };
setTimeout(() => { console.error('\n⛔ زمان تمام شد.'); kill(); finish(1); }, 90_000).unref();

const daily = (token, from, to) =>
  api('GET', `/reports/daily?from=${from}&to=${to}`, undefined, token).then((r) => r.body);

(async () => {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body.token;
  if (!token) { console.error('\n⛔ ورود ناموفق.'); kill(); return finish(1); }

  await api('POST', '/customers', { code: '600', name: 'مشتری آزمون' }, token);
  const cust = (await api('GET', '/customers', undefined, token)).body[0];

  /* مهر: فروش نقدی ۵۰۰۰ − مصرف ۱۰۰۰ = مانده‌ی ۴۰۰۰ قبل از آبان */
  await api('POST', '/sales', { materialName: 'ریگ', volume: 1, unitPrice: 5000, paymentType: 'cash', date: '2026-10-01' }, token);
  await api('POST', '/expenses', { description: 'دیزل', amountAfn: 1000, date: '2026-10-01' }, token);
  /* آبان: +۱۰۰ فروش نقدی، +۷۰۰ رسید به دخل، ۳۰۰ امانت (نباید به دخل بیاید) */
  await api('POST', '/sales', { materialName: 'ریگ', volume: 1, unitPrice: 100, paymentType: 'cash', date: '2026-11-01' }, token);
  await api('POST', '/receipts', { customerId: cust.id, amount: 700, date: '2026-11-02', sourceName: 'باقی داری', receivedBy: 'دخل' }, token);
  await api('POST', '/receipts', { customerId: cust.id, amount: 300, date: '2026-11-02', sourceName: 'امانت' }, token);

  console.log('\n— «متحرک دخل» در حالت ساده —');
  const win = await daily(token, '2026-11-01', '2026-11-03');
  const byDate = new Map(win.rows.map((r) => [r.date, r]));
  check('روز ۱۱-۰۱: مانده = ۴۰۰۰ + ۱۰۰', byDate.get('2026-11-01')?.runningCash === 4100, String(byDate.get('2026-11-01')?.runningCash));
  check('روز ۱۱-۰۲: +۷۰۰ (امانت وارد دخل نشد)', byDate.get('2026-11-02')?.runningCash === 4800, String(byDate.get('2026-11-02')?.runningCash));
  check('روز ۱۱-۰۳: مانده تکان نمی‌خورد', byDate.get('2026-11-03')?.runningCash === 4800, String(byDate.get('2026-11-03')?.runningCash));
  check('متحرک در طول بازه تغییر می‌کند (باگ قبلی: ثابت بود)', win.rows[win.rows.length - 1].runningCash !== win.rows[0].runningCash,
    win.rows.map((r) => r.runningCash).join(','));

  const full = await daily(token, '2026-01-01', '2026-11-03');
  const fullLast = full.rows.find((r) => r.date === '2026-11-03')?.runningCash;
  check('همان عدد راپور کل سال و بازه‌ی ماه یکی است', fullLast === byDate.get('2026-11-03')?.runningCash, `${fullLast} ≠ ${byDate.get('2026-11-03')?.runningCash}`);

  console.log('\n— «موجودی دخل روز» و جمع‌ها —');
  check('دخل روز ۱۱-۰۲ فقط ۷۰۰ است (امانت نه)', byDate.get('2026-11-02')?.cashBalance === 700, String(byDate.get('2026-11-02')?.cashBalance));
  check('جمع cashIn بازه = ۸۰۰', win.totals.cashIn === 800, String(win.totals.cashIn));
  check('جمع cashBalance بازه = ۸۰۰', win.totals.cashBalance === 800, String(win.totals.cashBalance));

  console.log('\n— حالت «دقیق» —');
  await api('PUT', '/settings', { cashMode: 'accurate' }, token);
  const accFull = await daily(token, '2026-01-01', '2026-11-03');
  const accWin = await daily(token, '2026-11-01', '2026-11-03');
  const aFull = accFull.rows.find((r) => r.date === '2026-11-03')?.runningCash;
  const aWin = accWin.rows.find((r) => r.date === '2026-11-03')?.runningCash;
  check('حالت دقیق هم بین بازه و کل سال یکی است', aFull === aWin, `${aFull} ≠ ${aWin}`);
  check('حالت دقیق مانده‌ی مثبت است', aFull > 0, String(aFull));

  console.log('\n— سلامت —');
  check('سرور خطای داخلی نداده', !/Internal server error|Unhandled/i.test(log));
  const empty = await daily(token, '2026-12-25', '2026-12-26');
  check('بازه‌ی بی‌سند کرش نمی‌کند', Array.isArray(empty.rows), String(empty.status));

  kill();
  finish();
})().catch((e) => { console.error('\n⛔ خطای غیرمنتظره:', e); kill(); finish(1); });

function finish(code = 0) {
  console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  console.log('');
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(failed === 0 && code === 0 ? 0 : 1);
}
