/**
 * تست ایمنی پشتیبان و ابزار نجات — `npm run test:recovery`
 *
 * ── باگ‌های جدی که از بازگشتشان جلوگیری می‌کند (شکار باگ دور ۲۸) ──────────
 *
 * ۱) `POST /system/restore` فایل را **بدون بررسی** روی دیتابیس زنده کپی
 *    می‌کرد. یک فایل خراب ⇒ دیتابیس سالم از بین می‌رفت و از آن لحظه همه‌ی
 *    درخواست‌ها ۵۰۰ می‌دادند (`SQLITE_NOTADB`)، از جمله خودِ صفحه‌ی
 *    بازیابی. یعنی کاربر از داخل برنامه راه برگشت نداشت.
 * ۲) فایل‌های خراب حتی در فهرست پشتیبان‌ها «سالم» نشان داده می‌شدند.
 * ۳) مسیر نجاتِ خط فرمان برای دیتابیس خراب وجود نداشت (`--repair-db`،
 *    `--restore-backup`).
 * ۴) ورود از اکسل: «باقی اولیه» منفی و تاریخ استخدام شمسیِ تبدیل‌نشده.
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
/*
 * پورت ثابت نگه داشته نمی‌شود: اگر سرویس دیگری (یا اجرای قبلی همین تست) روی
 * پورت مانده باشد، تست به سرور **دیگری** وصل می‌شد و نتیجه‌ی گمراه‌کننده
 * می‌داد. پورت تصادفی + تأیید هویت سرور با `dataDir` (درس دور ۲۷).
 */
const PORT = 4600 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-recovery-'));
const dist = path.join(root, 'apps/api/dist');

let passed = 0, failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
}

let token = '';
async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-auth-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function main() {
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

  try {
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* wait */ }
      if (child.exitCode !== null) throw new Error(`API بسته شد:\n${log}`);
      await new Promise((r) => setTimeout(r, 400));
    }
    token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body?.token || '';
    check('ورود مدیر', !!token);
    /*
     * تأیید این‌که سرورِ روی این پورت واقعاً سرورِ ماست. `/system/info` پشت
     * نگهبان است، پس بعد از ورود پرسیده می‌شود؛ بدون این بررسی، یک پروسه‌ی
     * جامانده روی همان پورت تست را به سرور **دیگری** وصل می‌کرد و نتیجه
     * کاملاً گمراه‌کننده می‌شد (همین اتفاق یک‌بار در این دور افتاد).
     */
    const who = await api('GET', '/system/info');
    if (String(who?.body?.dataDir || '') !== dataDir) {
      throw new Error(`سرور روی پورت ${PORT} سرورِ این تست نیست (dataDir=${who?.body?.dataDir}). یک پروسه‌ی جامانده است.`);
    }

    /* داده‌ی واقعی بسازیم تا پشتیبان «معنادار» باشد */
    await api('POST', '/customers', { name: 'مشتری الف', code: '101' });
    await api('POST', '/sales', { date: '1404/06/15', volume: 3, unitPrice: 500, paymentType: 'cash' });

    console.log('\n— ۱) پشتیبان سالم —');
    const bk = await api('POST', '/system/backup', {});
    check('پشتیبان‌گیری انجام شد', [200, 201].includes(bk.status), JSON.stringify(bk.body).slice(0, 140));
    const goodName = bk.body?.file;
    const info = await api('GET', '/system/info');
    const backupDir = info.body?.backupDir;
    check('مسیر پوشه‌ی پشتیبان مشخص است', fs.existsSync(backupDir), String(backupDir));

    const list1 = await api('GET', '/system/backup/list');
    const goodRow = (list1.body?.rows || []).find((r) => r.file === goodName);
    check('پشتیبان سالم در فهرست «سالم» علامت خورده', goodRow?.healthy === true, JSON.stringify(goodRow));

    console.log('\n— ۲) فایل خراب نباید دیتابیس را نابود کند —');
    const corrupt = path.join(backupDir, 'corrupt.db');
    fs.writeFileSync(corrupt, 'این یک دیتابیس نیست — فقط متن است.'.repeat(60));
    const list2 = await api('GET', '/system/backup/list');
    const badRow = (list2.body?.rows || []).find((r) => r.file === 'corrupt.db');
    check('فایل خراب در فهرست «خراب» علامت می‌خورد', badRow?.healthy === false, JSON.stringify(badRow));

    const restoreBad = await api('POST', '/system/restore', { file: 'corrupt.db' });
    check('بازگردانی فایل خراب رد می‌شود (۴۰۰، نه ۵۰۰)', restoreBad.status === 400, String(restoreBad.status));
    check('پیام می‌گوید دیتابیس فعلی دست‌نخورده است',
      /دست‌نخورده/.test(String(restoreBad.body?.message || '')), String(restoreBad.body?.message).slice(0, 120));

    const healthAfter = await api('GET', '/system/health');
    check('دیتابیس بعد از تلاش ناموفق سالم است', healthAfter.status === 200 && healthAfter.body?.schemaOk === true,
      `${healthAfter.status}`);
    const saleAfter = await api('POST', '/sales', { date: '1404/06/16', volume: 1, unitPrice: 100, paymentType: 'cash' });
    check('ثبت سند بعد از تلاش ناموفق کار می‌کند', [200, 201].includes(saleAfter.status), String(saleAfter.status));

    /* فایل خالی و فایل با اندازه‌ی بزرگ‌تر ولی غیر-SQLite */
    const emptyFile = path.join(backupDir, 'empty.db');
    fs.writeFileSync(emptyFile, '');
    const restoreEmpty = await api('POST', '/system/restore', { file: 'empty.db' });
    check('فایل صفر بایتی رد می‌شود', restoreEmpty.status === 400, String(restoreEmpty.status));

    const bigJunk = path.join(backupDir, 'junk-big.db');
    fs.writeFileSync(bigJunk, Buffer.alloc(80 * 1024, 7));
    const restoreJunk = await api('POST', '/system/restore', { file: 'junk-big.db' });
    check('فایل بزرگ ولی غیر-SQLite رد می‌شود', restoreJunk.status === 400, String(restoreJunk.status));
    check('پیام خطای فایل غیر-SQLite قابل‌فهم است',
      /دیتابیس نیست|قابل خواندن نیست|آسیب/.test(String(restoreJunk.body?.message || '')),
      String(restoreJunk.body?.message).slice(0, 120));

    console.log('\n— ۳) بازگردانی پشتیبان سالم —');
    await api('POST', '/customers', { name: 'مشتری بعد از پشتیبان', code: '102' });
    const before = await api('GET', '/customers');
    const countBefore = (Array.isArray(before.body) ? before.body : []).length;
    const restoreGood = await api('POST', '/system/restore', { file: goodName });
    check('بازگردانی پشتیبان سالم موفق است', [200, 201].includes(restoreGood.status),
      `${restoreGood.status} ${JSON.stringify(restoreGood.body).slice(0, 140)}`);
    check('گزارش بازگردانی، شمارش ردیف‌ها را می‌دهد', typeof restoreGood.body?.counts?.User === 'number',
      JSON.stringify(restoreGood.body?.counts));
    const after = await api('GET', '/customers');
    const rowsAfter = Array.isArray(after.body) ? after.body : [];
    check('داده‌ی بعد از پشتیبان حذف شد (بازگردانی واقعاً اثر کرد)',
      rowsAfter.length < countBefore, `${countBefore} → ${rowsAfter.length}`);
    check('داده‌ی داخل پشتیبان برگشت', rowsAfter.some((c) => c.name === 'مشتری الف'));

    console.log('\n— ۴) ابزار نجات خط فرمان —');
    /* دیتابیس را واقعاً خراب می‌کنیم و می‌بینیم ابزار نجات نجاتش می‌دهد */
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));
    const dbFile = path.join(dataDir, 'farday.db');
    fs.writeFileSync(dbFile, 'خراب شده — این دیتابیس نیست');
    for (const s of ['-wal', '-shm']) { try { fs.rmSync(dbFile + s, { force: true }); } catch { /* ignore */ } }

    const run = (args) => spawnSync(process.execPath, [path.join(dist, 'main.js'), '--recovery', ...args], {
      cwd: root,
      env: { ...process.env, FD_DATA_DIR: dataDir },
      encoding: 'utf8',
      timeout: 60000,
    });

    const repair = run(['--repair-db']);
    check('--repair-db بدون کرش اجرا می‌شود', repair.status === 0, (repair.stderr || '').slice(0, 160));
    check('--repair-db می‌گوید فایل کنار گذاشته شد (پاک نشد)',
      /کنار گذاشته/.test(repair.stdout) && /پاک نشد/.test(repair.stdout), repair.stdout.slice(-200));
    check('دیتابیس تازه ساخته شد', fs.existsSync(dbFile) && fs.statSync(dbFile).size > 1024);
    const corruptCopies = fs.readdirSync(dataDir).filter((f) => f.startsWith('farday-corrupt-'));
    check('فایل خراب نگه داشته شد (برای پشتیبانی)', corruptCopies.length === 1, corruptCopies.join(','));

    const restoreCli = run(['--restore-backup', goodName]);
    check('--restore-backup اجرا می‌شود', restoreCli.status === 0, (restoreCli.stderr || '').slice(0, 160));
    check('--restore-backup بازگردانی را تأیید می‌کند', /بازگردانی انجام شد/.test(restoreCli.stdout),
      restoreCli.stdout.slice(-200));

    const badCli = run(['--restore-backup', 'corrupt.db']);
    check('--restore-backup فایل خراب را رد می‌کند', /سالم نیست/.test(badCli.stdout), badCli.stdout.slice(-160));

    const noName = run(['--restore-backup']);
    check('--restore-backup بدون نام، فهرست را نشان می‌دهد', /نام فایل پشتیبان را بدهید/.test(noName.stdout),
      noName.stdout.slice(-160));

    console.log('\n— ۵) دیتابیس ترمیم‌شده دوباره بالا می‌آید —');
    const child2 = spawn(process.execPath, [path.join(dist, 'main.js')], {
      cwd: root,
      env: { ...process.env, FD_DATA_DIR: dataDir, FD_PORT: String(PORT + 1) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const B2 = `http://127.0.0.1:${PORT + 1}/api`;
    let up = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${B2}/health`)).ok) { up = true; break; } } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    check('برنامه بعد از ترمیم/بازگردانی بالا می‌آید', up);
    if (up) {
      const who2 = await fetch(`${B2}/system/info`, { headers: { 'x-auth-token': 'x' } })
        .then((r) => r.json()).catch(() => ({}));
      /* ۴۰۱ یعنی سرور بالا است ولی توکن ندارد — همان چیزی که می‌خواهیم */
      check('سرور ترمیم‌شده پاسخ می‌دهد', !!who2 && String(who2?.statusCode || '') !== '', JSON.stringify(who2).slice(0, 80));
    }
    if (up) {
      const lg = await fetch(`${B2}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      });
      check('ورود مدیر بعد از بازگردانی کار می‌کند (هش رمز سالم)', lg.ok, String(lg.status));
    }
    try { child2.kill('SIGKILL'); } catch { /* ignore */ }

    console.log('\n— ۶) ورود از اکسل: داده‌ی نامعتبر —');
    /* همان نمونه‌ی داده‌ی «مشتری الف» را داریم؛ سرور تازه لازم است */
    const impDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-imp-'));
    const child3 = spawn(process.execPath, [path.join(dist, 'main.js')], {
      cwd: root,
      env: { ...process.env, FD_DATA_DIR: impDir, FD_PORT: String(PORT + 2) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const B3 = `http://127.0.0.1:${PORT + 2}/api`;
    let tk3 = '';
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${B3}/health`)).ok) break; } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    const l3 = await fetch(`${B3}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    tk3 = (await l3.json()).token || '';
    const post3 = async (u, b) => {
      const r = await fetch(B3 + u, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-auth-token': tk3 },
        body: JSON.stringify(b),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };

    const csv = 'نام,شخص رابط,شماره تماس,پلیت,باقی اولیه,توضیحات\n'
      + 'مشتری منفی,,,, -500,\n'
      + 'مشتری سالم,,,,2500,\n';
    const imp = await post3('/import/customers', { csv, dryRun: false });
    check('ورود مشتریان انجام شد', [200, 201].includes(imp.status), `${imp.status} ${JSON.stringify(imp.body).slice(0, 140)}`);
    const list3 = await (await fetch(`${B3}/customers`, { headers: { 'x-auth-token': tk3 } })).json();
    const rows3 = Array.isArray(list3) ? list3 : [];
    const neg = rows3.find((c) => c.name === 'مشتری منفی');
    check('باقی اولیه‌ی منفی، صفر ذخیره شد (نه عدد منفی)', neg && Number(neg.openingBalance) === 0, String(neg?.openingBalance));
    check('هشدار منفی‌بودن به کاربر داده شد',
      (imp.body?.warnings || []).some((w) => /منفی/.test(w)), JSON.stringify(imp.body?.warnings));

    const empCsv = 'نام,نام پدر,وظیفه,تاریخ استخدام,معاش ثابت,شماره تماس,شماره تذکره,آدرس,مدت قرارداد,توضیحات\n'
      + 'کارمند تاریخ‌خراب,,کارگر,۳۲/۱۳/۱۴۰۴,15000,,,,,\n'
      + 'کارمند سالم,,کارگر,۱۴۰۴/۰۱/۱۵,15000,,,,,\n';
    const impEmp = await post3('/import/employees', { csv: empCsv, dryRun: true });
    check('تاریخ استخدام نامعتبر در ورود، خطا می‌دهد',
      (impEmp.body?.errors || []).some((e) => /تاریخ/.test(e)), JSON.stringify(impEmp.body?.errors).slice(0, 160));
    const impEmp2 = await post3('/import/employees', { csv: empCsv, dryRun: false });
    check('ورود با سطر خطادار ثبت نمی‌شود', impEmp2.status === 400, String(impEmp2.status));
    console.log('\n— ۷) «کد بعدی» و کدهای تصادمی —');
    const post = async (u, b) => post3(u, b);
    /* کد دستی غیرعددی نباید کد بعدی را بشکند */
    const manual = await post('/customers', { name: 'مشتری با کد دستی', code: 'A-7' });
    check('کد دستی غیرعددی پذیرفته می‌شود', [200, 201].includes(manual.status), JSON.stringify(manual.body));
    const nextC = await (await fetch(`${B3}/customers/next-code`, { headers: { 'x-auth-token': tk3 } })).json();
    check('کد بعدی بعد از کد دستیِ غیرعددی، عدد گم‌شده نمی‌سازد', /^\d{3,}$/.test(String(nextC.code)), JSON.stringify(nextC));
    check('کد بعدی هرگز «۰۰۰» (رزرو گذری) نیست', String(nextC.code) !== '000', String(nextC.code));

    /* چند مشتری پشت سر هم: هیچ کد تکراری، هیچ شکست */
    let collide = 0, created = 0;
    for (let i = 0; i < 12; i++) {
      const r = await post('/customers', { name: `مشتری ${i}`, code: '' });
      if ([200, 201].includes(r.status)) created++; else collide++;
      if (r.status === 201 && !r.body?.code) collide++;
    }
    check('۱۲ مشتری بدون کد، همه ثبت شدند', created === 12, `${created}/12`);
    check('هیچ ثبت مشتری شکست نخورد', collide === 0, `${collide} مورد`);

    /* کارمندان */
    await post('/employees', { name: 'کارمند کد دستی', code: 'EMP-4', hireDate: '1404/01/01' });
    const nextE = await (await fetch(`${B3}/employees/next-code`, { headers: { 'x-auth-token': tk3 } })).json();
    check('کد بعدی کارمند عددی و آزاد است', /^\d{3,}$/.test(String(nextE.code)), JSON.stringify(nextE));

    console.log('\n— ۸) ورودی‌های مخرب/غیرمنطقی (نباید ۵۰۰ بدهند) —');
    /*
     * `1e308` عدد متناهی است ولی SQLite آن را به `Infinity` گرد می‌کرد؛ مانده‌ی
     * مشتری و همه‌ی جمع‌ها برای همیشه خراب می‌شد (شکار باگ دور ۲۸). حالا سقف
     * دارد و ۴۰۰ با پیام فارسی برمی‌گردد — نه ۵۰۰.
     */
    const huge = await post('/customers', { name: 'مشتری غول', openingBalance: 1e308 });
    check('باقی اولیه‌ی غول‌آسا رد می‌شود (۴۰۰، نه ذخیره)', huge.status === 400, `${huge.status} ${JSON.stringify(huge.body).slice(0, 100)}`);
    const hugeSale = await post('/sales', { date: '1404/06/15', volume: 1e308, unitPrice: 1e308, paymentType: 'cash' });
    check('فروش با اعداد غول‌آسا رد می‌شود', hugeSale.status === 400, String(hugeSale.status));
    const hugeExp = await post('/expenses', { date: '1404/06/15', amountAfn: 1e308, description: 'x' });
    check('مصرف با مبلغ غول‌آسا رد می‌شود', hugeExp.status === 400, String(hugeExp.status));
    const hugeRc = await post('/receipts', { date: '1404/06/15', amount: 1e308, customerId: 1 });
    check('رسید با مبلغ غول‌آسا رد می‌شود', hugeRc.status === 400, String(hugeRc.status));

    const probes = [
      ['POST', '/sales', { date: 'garbage', volume: 1, unitPrice: 1 }],
      ['POST', '/sales', { date: '1404/06/15', volume: 'abc', unitPrice: 1 }],
      ['POST', '/employees', { name: '   ' }],
      ['POST', '/employees', { name: 'x', hireDate: '1404/13/45' }],
      ['GET', '/customers/abc/statement', undefined],
      ['GET', '/reports/daily?from=1404/13/01&to=1404/01/01', undefined],
      ['GET', '/reports/breakdown?from=xxx&to=yyy', undefined],
      ['POST', '/lookups', { type: 'nope', name: 'x' }],
      ['POST', '/system/restore', { file: '../../farday.db' }],
    ];
    let hard = [];
    for (const [m, u, b] of probes) {
      const r = m === 'GET'
        ? await fetch(B3 + u, { headers: { 'x-auth-token': tk3 } })
        : await post(u, b);
      if (r.status >= 500) hard.push(`${m} ${u} → ${r.status}`);
    }
    check('هیچ ورودی نامعتبری خطای ۵۰۰ نمی‌دهد', hard.length === 0, hard.join(' | '));

    console.log('\n— ۹) وضعیت حضور و غیاب —');
    const empList = async () => {
      const j = await (await fetch(`${B3}/employees`, { headers: { 'x-auth-token': tk3 } })).json();
      return Array.isArray(j) ? j : (j.rows || []);
    };
    const emps = await empList();
    const emp = emps.find((e) => /سالم/.test(String(e.name)));
    let empId = emp?.id;
    if (!empId) {
      const made = await post('/employees', { name: 'کارمند گزارش', code: '', hireDate: '1404/01/01' });
      empId = (await empList()).find((e) => e.name === 'کارمند گزارش')?.id;
    }
    check('کارمند برای گزارش حضور ساخته شد', !!empId, String(empId));

    const badStatus = await post('/attendance/bulk', {
      items: [{ employeeId: empId, date: '1404/01/10', status: 'presentt' }],
    });
    check('وضعیت ناشناخته در ذخیره‌ی گروهی رد می‌شود', badStatus.status === 400, `${badStatus.status}`);
    const goodStatus = await post('/attendance/bulk', {
      items: [
        { employeeId: empId, date: '1404/01/10', status: 'present' },
        { employeeId: empId, date: '1404/01/11', status: 'friday' },
      ],
    });
    check('وضعیت معتبر ذخیره می‌شود', [200, 201].includes(goodStatus.status), JSON.stringify(goodStatus.body));

    const sum = await (await fetch(`${B3}/attendance/summary?month=1404/01`, { headers: { 'x-auth-token': tk3 } })).json();
    const row = (sum.rows || []).find((r) => r.employeeId === empId);
    check('گزارش ماهانه ردیف کارمند را دارد', !!row, JSON.stringify(sum).slice(0, 120));
    check('«جمعه» در سبد تعطیل شمرده می‌شود', row?.holiday === 1, `holiday=${row?.holiday}`);
    check('هیچ وضعیت ناشناخته‌ای در گزارش نیست', row?.unknown === 0, `unknown=${row?.unknown}`);

    try { child3.kill('SIGKILL'); } catch { /* ignore */ }
  } finally {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }

  console.log(`\n${failed === 0 ? '✔' : '✘'} ${passed} تست موفق، ${failed} ناموفق`);
  if (failed) { console.log('\nمشکلات:'); problems.forEach((p) => console.log(` • ${p}`)); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
