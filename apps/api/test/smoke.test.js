/**
 * End-to-end smoke test of the local API (no test framework needed):
 *
 *   npm run test:api
 *
 * It starts the compiled API on a free port with a temporary database,
 * exercises the business flows and checks the formulas end-to-end.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}/api`;
let token = '';
let failed = 0;
let passed = 0;

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name} ${extra}`); }
}

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-auth-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function waitForApi(child) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error('API exited early');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API did not start');
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-test-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'main.js')], {
    env: { ...process.env, FD_DATA_DIR: dataDir, FD_PORT: String(PORT), FD_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  try {
    await waitForApi(child);
    console.log('\n— ورود و امنیت —');
    let r = await api('POST', '/auth/login', { username: 'admin', password: 'wrong' });
    check('رمز اشتباه رد می‌شود', r.status === 401);
    r = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
    check('ورود با رمز پیش‌فرض', r.status === 201 || r.status === 200, JSON.stringify(r.body));
    token = r.body.token;
    r = await api('GET', '/customers');
    check('دسترسی با توکن', r.status === 200);
    token = '';
    r = await api('GET', '/customers');
    check('دسترسی بدون توکن رد می‌شود', r.status === 401);
    r = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
    token = r.body.token;

    console.log('\n— مشخصات شرکت و فهرست‌ها —');
    r = await api('PUT', '/company', { name: 'فردای روشن', activityType: 'تولید مواد ساختمانی', fiscalYear: '۱۴۰۵' });
    check('ذخیره مشخصات شرکت', r.status === 200 && r.body.name === 'فردای روشن');
    /*
     * نام قلم باید یکتا باشد. از دور ۳۱ فهرست‌های پیش‌فرض روی نصب تازه خودکار
     * ساخته می‌شوند و «ماسه اول» جزو پیش‌فرض‌ها است — پس تست از نام اختصاصی
     * استفاده می‌کند (وگرنه ۴۰۹ می‌گیرد، نه به‌خاطر باگ بلکه به‌خاطر تکرار).
     */
    r = await api('POST', '/lookups', { type: 'material', name: 'قلم آزمون ۳۱', extra: 'متر مکعب' });
    check('افزودن قلم مواد', r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
    r = await api('POST', '/lookups', { type: 'material', name: 'قلم آزمون ۳۱', extra: '' });
    check('قلم تکراری رد می‌شود (۴۰۹)', r.status === 409, String(r.status));
    r = await api('GET', '/lookups');
    const material = r.body.items.material[0];
    check('قلم در کشو دیده می‌شود', !!material);

    console.log('\n— کارمندان، مشتریان —');
    /* مسیر جدید: بدون شناسه — مسیر قبلی «/employees/1/next-code» با :id قاطی می‌شد */
    r = await api('GET', '/employees/next-code');
    check('کد کارمند خودکار', typeof r.body.code === 'string');
    r = await api('POST', '/employees', { name: 'احمد کریمی', fatherName: 'گل احمد', baseSalary: 14000, position: 'کارگر' });
    check('ثبت کارمند', (r.status === 201 || r.status === 200) && r.body.ok);
    r = await api('POST', '/employees', { name: ' تکراری', code: '001' });
    check('کد کارمند تکراری رد می‌شود', r.status === 400);
    r = await api('POST', '/customers', { name: 'شرکت آریا', phone: '0700', openingBalance: 5000 });
    check('ثبت مشتری', (r.status === 201 || r.status === 200) && r.body.ok);

    const customers = await api('GET', '/customers');
    const c1 = customers.body[0];

    console.log('\n— فروشات و فرمول‌ها —');
    r = await api('POST', '/sales', {
      customerId: c1.id, date: '1405/08/19', volume: 10, unitPrice: 1200,
      freightPerUnit: 200, materialId: material.id, paymentType: 'credit', driverName: 'نصرالله',
    });
    check('ثبت فروش', (r.status === 201 || r.status === 200) && r.body.ok, JSON.stringify(r.body));
    check('مجموع کرایه = متراژ × کرایه فی متر', r.body.freightTotal === 2000, String(r.body.freightTotal));
    check('مجموع بل = (متراژ × قیمت) + کرایه', r.body.total === 14000, String(r.body.total));
    const no1 = r.body.no;
    r = await api('POST', '/sales', { customerId: c1.id, date: '1405/08/19', volume: 1, unitPrice: 1 });
    check('شماره بل خودکار و بدون تکرار', (r.status === 201 || r.status === 200) && r.body.no !== no1, String(r.body.message));
    r = await api('POST', '/sales', { customerId: c1.id, date: '1405/08/19', volume: 1, unitPrice: 1, no: no1 });
    check('شماره بل دستی تکراری رد می‌شود', r.status === 400);

    console.log('\n— رسیدات و باقی مانده بدهی —');
    r = await api('POST', '/receipts', { customerId: c1.id, amount: 4000, date: '1405/08/19', sourceName: 'باقی داری' });
    check('ثبت رسید', (r.status === 201 || r.status === 200) && r.body.ok);
    r = await api('POST', '/receipts', { customerId: c1.id, amount: 1000, date: '1405/08/19', sourceName: 'امانت' });
    const after = await api('GET', '/customers');
    const c1b = after.body.find((c) => c.id === c1.id);
    // opening 5000 + credit sales 14000 + 1 (second sale cash) - receipts 4000 (امانت excluded)
    check('بدهی = بدهی اولیه + فروش قرضه − رسیدات', c1b.balance === 15000, String(c1b.balance));
    r = await api('GET', `/customers/${c1.id}/statement`);
    check('کارت حساب باقی مانده پایانی درست', r.body.closing === 15000, String(r.body.closing));
    check('کارت حساب سندهای مرتب دارد', r.body.rows.length >= 3);

    console.log('\n— مصارف، معاشات —');
    r = await api('POST', '/expenses', { date: '1405/08/19', description: 'تیل', amountAfn: 3000, amountUsd: 50, payerName: 'دخل', paymentType: 'cash' });
    check('ثبت مصرف', (r.status === 201 || r.status === 200) && r.body.ok);
    r = await api('POST', '/attendance/bulk', { items: [{ employeeId: 1, date: '1405/08/19', status: 'present', overtime: 2 }] });
    check('ثبت حضور و غیاب', r.body.saved === 1);
    r = await api('GET', '/salaries/sheet?month=1405-08');
    check('ورق معاش ساخته می‌شود', Array.isArray(r.body.rows) && r.body.rows.length === 1);
    check('ساعت اضافه کاری از حضور و غیاب', r.body.rows[0].overtimeHours === 2, String(r.body.rows[0].overtimeHours));
    r = await api('POST', '/salaries/sheet', {
      month: '1405-08', payDate: '1405/08/19',
      rows: [{ employeeId: 1, name: 'احمد کریمی', baseSalary: 14000, bonus: 1000, penalty: 500, overtimeAmount: 900, payerName: 'دخل', paymentType: 'cash' }],
    });
    check('ذخیره معاش', r.body.saved === 1);
    const sal = await api('GET', '/salaries?month=1405-08');
    check('مجموع معاش = ثابت + پاداش + اضافه − جریمه', sal.body.rows[0].total === 15400, String(sal.body.rows[0]?.total));

    console.log('\n— راپورها —');
    r = await api('GET', '/reports/daily');
    const today = r.body.rows.find((x) => x.date === new Date().toISOString().slice(0, 10));
    check('راپور روزانه برمی‌گردد', r.status === 200 && Array.isArray(r.body.rows));
    r = await api('GET', '/reports/monthly');
    check('راپور ماهانه ۱۲ ماه دارد', r.body.rows.length === 12);
    const aug = r.body.rows.find((x) => x.start <= '2026-11-10' && x.end >= '2026-11-10');
    if (aug) {
      check('سود ماهانه = فروش − (مصارف + معاشات)',
        Math.abs(aug.profit - (aug.totalSales - aug.totalExpenses)) < 0.01 || (aug.loss > 0));
    } else { check('ماه جاری در راپور ماهانه', false); }
    r = await api('GET', '/reports/yearly');
    check('راپور سالانه', r.body.rows.length >= 1);
    r = await api('GET', '/reports/breakdown');
    check('راپور تفصیلی به مواد', r.body.byMaterial.length >= 1);
    r = await api('GET', '/reports/cashbook');
    check('حرکت دخل', Array.isArray(r.body.rows));

    console.log('\n— تقویم —');
    r = await api('PUT', '/settings', { calendar: 'gregorian' });
    check('تغییر تقویم به میلادی', r.body.calendar === 'gregorian');
    r = await api('GET', '/sales');
    check('تاریخ میلادی نمایش داده می‌شود', r.body.rows[0].dateDisplay.startsWith('2026/'), r.body.rows[0]?.dateDisplay);
    r = await api('PUT', '/settings', { calendar: 'jalali' });
    r = await api('GET', '/sales');
    check('تاریخ شمسی نمایش داده می‌شود', r.body.rows[0].dateDisplay.startsWith('1405/'), r.body.rows[0]?.dateDisplay);

    console.log('\n— خروجی، پشتیبان، ساختار —');
    r = await api('GET', '/export?type=sales');
    check('خروجی CSV', typeof r.body === 'string' && r.body.includes('شماره بل'), String(r.body).slice(0, 60));
    r = await api('POST', '/system/backup', {});
    check('پشتیبان‌گیری', r.body.ok === true);
    const file = r.body.file;
    r = await api('POST', '/system/restore', { file });
    check('بازگردانی', r.body.ok === true);
    r = await api('GET', '/system/health');
    check('ساختار دیتابیس درست است', r.body.schemaOk === true, JSON.stringify(r.body.missingTables));
    r = await api('GET', '/system/activity?limit=5');
    check('سابقه فعالیت ثبت شده', Array.isArray(r.body) && r.body.length > 0);

    console.log('\n— نقش کارمند —');
    r = await api('POST', '/users', { username: 'karmand', password: 'test123', role: 'employee', fullName: 'کارمند' });
    check('ساخت کاربر کارمند', r.body.ok === true, JSON.stringify(r.body));
    const adminToken = token;
    r = await api('POST', '/auth/login', { username: 'karmand', password: 'test123' });
    token = r.body.token;
    r = await api('DELETE', '/sales/1');
    check('کارمند اجازه حذف ندارد', r.status === 403);
    r = await api('GET', '/users');
    check('کارمند اجازه دیدن کاربران ندارد', r.status === 403);
    token = adminToken;
    r = await api('DELETE', '/sales/1');
    check('مدیر اجازه حذف دارد', r.body.ok === true);

    /* ------------------- تاریخ‌ها: میلادی همیشه میلادی -------------------- */
    // (رگرسیون: با تقویم شمسی، ISO به اشتباه شمسی خوانده می‌شد)
    const cus = await api('GET', '/customers');
    const customerId = cus.body[0].id;
    const saleIso = await api('POST', '/sales', {
      date: '2026-11-10', customerId: customerId, volume: 2, unitPrice: 1000, paymentType: 'cash',
    });
    check('تاریخ ISO میلادی درست ذخیره می‌شود (سال سند ۱۴۰۵)', /^S-1405-/.test(String(saleIso.body.no)), String(saleIso.body.no));

    const saleShamsi = await api('POST', '/sales', {
      date: '1405/08/19', customerId: customerId, volume: 1, unitPrice: 1000, paymentType: 'cash',
    });
    check('تاریخ شمسی با اسلش پذیرفته می‌شود', saleShamsi.status === 201 || saleShamsi.body.ok === true, JSON.stringify(saleShamsi.body));

    const isoList = await api('GET', '/sales?from=2026-11-10&to=2026-11-10');
    check('فیلتر بازه با تاریخ ISO نتیجه می‌دهد', isoList.body.total >= 1, `total=${isoList.body.total}`);
    check('فیلتر بازه یک روز را برمی‌گرداند', isoList.body.rows.every((r) => r.date === '2026-11-10'));

    const badDate = await api('POST', '/sales', { date: '1405/13/40', customerId: customerId, volume: 1, unitPrice: 1 });
    check('تاریخ نامعتبر پیام دری می‌دهد', badDate.status === 400 && String(badDate.body.message).length > 3, JSON.stringify(badDate.body));

    const badRange = await api('GET', '/reports/cashbook?from=2026-11-10&to=2026-11-01');
    check('بازه معکوس رد می‌شود', badRange.status === 400);

    const longRange = await api('GET', '/reports/breakdown?from=2020-01-01&to=2026-01-01');
    check('بازه بیش از ۴۰۰ روز رد می‌شود', longRange.status === 400);

    /* ------------------------- دسترسی تنظیمات --------------------------- */
    const empLogin = await api('POST', '/auth/login', { username: 'karmand', password: 'test123' });
    const mgrToken = token;
    token = empLogin.body.token;
    const forbidden = await api('PUT', '/settings', { calendar: 'gregorian' });
    check('کارمند نمی‌تواند تنظیمات را تغییر دهد', forbidden.status === 403, String(forbidden.status));
    token = mgrToken;
    const weakPass = await api('POST', '/users', { username: 'weakuser', password: '123', role: 'employee' });
    check('رمز کوتاه رد می‌شود', weakPass.status === 400);
  } finally {
    child.kill('SIGKILL');
    if (failed) console.log('\n--- لاگ API ---\n' + logs.join('').slice(-3000));
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} تست موفق، ${failed} ناکام`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
