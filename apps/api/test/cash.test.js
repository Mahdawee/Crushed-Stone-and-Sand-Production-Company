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

  console.log('\n— ورق معاش: کارمند آینده و جمع ثبت‌شده —');
  /*
   * باگ دور ۳۲: کارمندی که تاریخ استخدامش از ماه بعد است در ورق معاش
   * همین ماه می‌آمد (مدیر می‌توانست برای ماهی که کار نکرده معاش ثبت کند).
   * و `totalPaid` فقط در API بود و در UI دیده نمی‌شد.
   */
  const rowsOf = (r) => (Array.isArray(r) ? r : (r.rows || []));
  await api('POST', '/employees', { name: 'کارمند ماه قبل', position: 'دیور', baseSalary: 20000, hireDate: '2026-01-01' }, token);
  await api('POST', '/employees', { name: 'کارمند ماه آینده', position: 'دیور', baseSalary: 20000, hireDate: '2027-06-01' }, token);
  const emps = rowsOf((await api('GET', '/employees', undefined, token)).body);
  const oldEmp = emps.find((e) => e.name === 'کارمند ماه قبل');
  let sheet = (await api('GET', '/salaries/sheet?month=1405-08', undefined, token)).body;
  const names = sheet.rows.map((r) => r.name);
  check('کارمند استخدام‌شده در این ماه در ورق هست', names.includes('کارمند ماه قبل'), names.join(','));
  check('کارمند آینده در ورق این ماه نیست', !names.includes('کارمند ماه آینده'), names.join(','));
  check('totalPaid در پاسخ هست (برای نمایش «ثبت‌شده»)', typeof sheet.totalPaid === 'number', String(sheet.totalPaid));

  await api('PUT', `/employees/${oldEmp.id}`, { ...oldEmp, status: 'inactive' }, token);
  sheet = (await api('GET', '/salaries/sheet?month=1405-08', undefined, token)).body;
  check('کارمند غیرفعال (رفته) از ورق ماه‌های بعد حذف می‌شود', !sheet.rows.some((r) => r.name === 'کارمند ماه قبل'),
    sheet.rows.map((r) => r.name).join(','));

  console.log('\n— حضور و غیاب: «شاغل در این بازه» —');
  /*
   * باگ دور ۳۲: ورق حضور همه‌ی کارمندان فعال را می‌آورد، بی‌توجه به تاریخ
   * استخدام؛ و کارمند رفته از ورق ماه‌های گذشته هم غیب می‌شد.
   */
  await api('POST', '/attendance/bulk', {
    items: [{ employeeId: oldEmp.id, date: '2026-11-01', status: 'present', overtime: 3 }],
  }, token);
  let att = (await api('GET', '/attendance?month=1405-08', undefined, token)).body;
  const attNames = att.employees.map((e) => e.name);
  check('ورق حضور کارمند آینده را نمی‌آورد', !attNames.includes('کارمند ماه آینده'), attNames.join(','));
  check('ورق حضور کارمند شاغل را می‌آورد', attNames.includes('کارمند ماه قبل'), attNames.join(','));

  /* کارمند رفته: نباید از ورق ماه‌های بعد بیاید، ولی سابقه‌اش در ماه قبل بماند */
  att = (await api('GET', '/attendance?month=1405-08', undefined, token)).body;
  check('کارمند غیرفعال با سابقه‌ی این ماه در ورق می‌ماند', attNames.includes('کارمند ماه قبل'));
  const nextMonth = (await api('GET', '/attendance?month=1405-10', undefined, token)).body;
  check('کارمند غیرفعال در ماه‌های بدون سابقه نمی‌آید',
    !nextMonth.employees.some((e) => e.name === 'کارمند ماه قبل'),
    nextMonth.employees.map((e) => e.name).join(','));

  console.log('\n— «مجموع بدهی»: یک عدد در همه‌ی صفحه‌ها —');
  /*
   * باگ دور ۳۲: راپور تفصیلی همه‌ی مانده‌ها را جمع می‌زد (بستانکار از بدهی
   * کم می‌کرد) ولی داشبورد و فهرست مشتریان فقط مانده‌ی مثبت. دو عدد
   * متفاوت با یک نام.
   */
  await api('POST', '/customers', { code: '710', name: 'بستانکار آزمون', openingBalance: -5000 }, token);
  await api('POST', '/customers', { code: '711', name: 'بدهکار آزمون', openingBalance: 3000 }, token);
  const dashBody = (await api('GET', '/reports/dashboard', undefined, token)).body;
  const brk = (await api('GET', '/reports/breakdown?from=2026-01-01&to=2026-12-31', undefined, token)).body;
  const listPaged = (await api('GET', '/customers?page=1&pageSize=25', undefined, token)).body;
  check('داشبورد: مجموع بدهی = ۳۰۰۰', dashBody.debtTotal === 3000, String(dashBody.debtTotal));
  check('راپور تفصیلی همان ۳۰۰۰ را می‌دهد (قبلاً −۲۰۰۰)', brk.debtTotal === 3000, String(brk.debtTotal));
  check('فهرست مشتریان همان ۳۰۰۰ را می‌دهد', listPaged.debtTotal === 3000, String(listPaged.debtTotal));
  /*
   * 「بستانکار」 از قبل هم وجود داشت: ۳۰۰ امانت به مشتری اول داده شده و
   * هیچ بدهی ندارد ⇒ مانده‌اش ۳۰۰− است. پس جمع بستانکاری ۵۳۰۰ است.
   * (تست عدد ثابت را روی ۵۰۰۰ تنظیم می‌کند اگر آن امانت را نسازیم.)
   */
  /*
   * «بستانکاری» = جمع مانده‌های منفی. در این سناریو: ۵۰۰۰ (بستانکار آزمون)
   * + ۳۰۰ امانت مشتری اول + ۴۰۰ امانتِ ۷۰۰/۳۰۰ ⇒ ۵۷۰۰.
   * تست خودش از روی داده حساب می‌کند تا با تغییر سناریو نشکند.
   */
  const allCust = (await api('GET', '/customers', undefined, token)).body;
  const expectCredit = allCust.reduce((a, c) => a + Math.max(0, -Number(c.balance)), 0);
  check('بستانکاری جدا گزارش می‌شود', brk.creditTotal === expectCredit, `${brk.creditTotal} ≠ ${expectCredit}`);

  console.log('\n— نرخ دالر: از تنظیمات تا سود/زیان —');
  /*
   * باگ دور ۳۲: `usdRate` ذخیره و اعتبارسنجی می‌شد ولی هیچ‌جا خوانده
   * نمی‌شد؛ کاربر نرخ می‌زد و هیچ عددی عوض نمی‌شد.
   */
  await api('POST', '/expenses', { description: 'روغن دالری', amountUsd: 50, date: '2026-11-04', paymentType: 'cash', payerName: 'دخل' }, token);
  const offDay = (await api('GET', '/reports/daily?from=2026-11-04&to=2026-11-04', undefined, token)).body.rows[0];
  check('پیش‌فرض: دالری در مجموع مصارف نیست', offDay.usdInProfit === false && offDay.expensesUsdAfn === 0,
    JSON.stringify({ f: offDay.usdInProfit, a: offDay.expensesUsdAfn }));
  await api('PUT', '/settings', { usdRate: '70', usdInProfit: '1' }, token);
  const onDay = (await api('GET', '/reports/daily?from=2026-11-04&to=2026-11-04', undefined, token)).body.rows[0];
  check('با نرخ ۷۰: ۵۰ دالر = ۳۵۰۰ افغانی', onDay.expensesUsdAfn === 3500, String(onDay.expensesUsdAfn));
  const aug = (await api('GET', '/reports/monthly?year=1405', undefined, token)).body.rows.find((r) => r.month === 8);
  check('راپور ماهانه هم همان ۳۵۰۰ را کم می‌کند', aug.expensesUsdAfn === 3500, String(aug.expensesUsdAfn));
  const dash2 = (await api('GET', '/reports/dashboard', undefined, token)).body;
  check('داشبورد هم همان تبدیل را داراست', dash2.month.expensesUsdAfn === 3500, String(dash2.month.expensesUsdAfn));
  /*
   * ── باگ (شکار باگ دور ۳۴): راپور سالانه مصرف دالری را کم نمی‌کرد ────────
   * ماهانه، روزانه و داشبورد همه با نرخ تبدیل کم می‌کردند؛ سالانه نه. یعنی
   * سود سال ۳۵۰۰ افغانی بیشتر از مجموع سود ماه‌های همان سال بود.
   */
  const yr = (await api('GET', '/reports/yearly', undefined, token)).body.rows.find((r) => r.year === 1405);
  check('راپور سالانه هم دالری را با همان نرخ کم می‌کند', yr && yr.expensesUsdAfn === 3500,
    JSON.stringify(yr && { usd: yr.expensesUsdAfn }));
  const months1405 = (await api('GET', '/reports/monthly?year=1405', undefined, token)).body.rows;
  const sumProfit = Math.round(months1405.reduce((a, r) => a + r.profit, 0) * 100) / 100;
  const sumLoss = Math.round(months1405.reduce((a, r) => a + r.loss, 0) * 100) / 100;
  check('سود سالانه = سود ماه‌های همان سال', yr && Math.abs((yr.profit - yr.loss) - (sumProfit - sumLoss)) < 0.02,
    `سال ${yr && (yr.profit - yr.loss)} ≠ ماه‌ها ${sumProfit - sumLoss}`);

  const badSet = await api('PUT', '/settings', { usdInProfit: 'yes' }, token);
  check('مقدار نامعتبر رد می‌شود (۴۰۰)', badSet.status === 400, String(badSet.status));

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
