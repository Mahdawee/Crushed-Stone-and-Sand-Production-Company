/**
 * تست «حذف نرم چه اثری روی حساب‌ها و گزارش‌ها دارد».
 *
 *   npm run test:softdelete
 *
 * پرسش کاربر: «آیا حذف کردن چیزی که به سطل بازیافت می‌رود، محاسبات را
 * متأثر می‌کند؟ آیا معاملات و داده‌های سطل بازیافت هنوز در محاسبات و
 * گزارشات شامل است یا خیر؟»
 *
 * پاسخ طراحی (و چیزی که این تست تضمین می‌کند):
 *   • ردیف در سطل بازیافت **در هیچ** محاسبه/گزارشی شمرده نمی‌شود
 *     (نه مانده‌ی مشتری، نه فروش، نه مصرف، نه معاش، نه حضور و غیاب).
 *   • بازیابی، اثر مالی را دقیقاً برمی‌گرداند (چون ردیف دست‌نخورده مانده).
 *   • سابقه در «فعالیت‌ها» می‌ماند، پس معلوم است چه کسی چه چیزی را برد.
 *   • در فرم‌ها، اگر سندی در سطل باشد، ثبت دوباره‌ی همان دوره به خطای
 *     «تکراری» نمی‌خورد و ردیف برمی‌گردد.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const PORT = 4471;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-sd-'));

let passed = 0;
let failed = 0;
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
const makeLicense = ({ privateKey, payload }) => {
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.sign(null, Buffer.from(body, 'utf8'), privateKey));
  return `-----BEGIN FARDAY LICENSE-----\nFR-1\n${body}\n${sig}\n-----END FARDAY LICENSE-----`;
};

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
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };

  const up = await (async () => {
    for (let i = 0; i < 160; i++) {
      try { const r = await fetch(BASE + '/health'); if (r.ok) return true; } catch { /* wait */ }
      if (child.exitCode !== null) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })();
  check('سرور بالا آمد', up, up ? '' : log.slice(-500));
  if (!up) { try { child.kill(); } catch { /* */ } return finish(); }

  const mk = (await api('GET', '/license/device')).body.machineKey;
  const lic = makeLicense({
    privateKey: kp.privateKey,
    payload: {
      v: 1, id: 'FR-LIC-SD', customer: 'آزمون', kind: 'yearly',
      start: addDays(todayISO(), -1), end: addDays(todayISO(), 200),
      machineKey: mk, seats: 1, note: '', issuedAt: new Date().toISOString(),
    },
  });
  await api('POST', '/license/activate', { text: lic });
  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body?.token || '';
  check('ورود مدیر', Boolean(token));

  /* ================================================================ */
  console.log('\n— باگ: بخش ثبت کارمندان باز نمی‌شد —');

  const nextCode = await api('GET', '/employees/next-code', undefined, token);
  check('GET /employees/next-code جواب می‌دهد (نه ۴۰۴)', nextCode.status === 200, `${nextCode.status} ${JSON.stringify(nextCode.body).slice(0, 100)}`);
  check('کد بعدی عددی و سه‌رقمی است', /^\d{3}$/.test(String(nextCode.body?.code || '')), String(nextCode.body?.code));

  const emp = await api('POST', '/employees', { name: 'کارمند آزمون', position: 'اپراتور', baseSalary: 10000, hireDate: todayISO() }, token);
  check('ساخت کارمند با فورم همان کد بعدی', emp.status === 200 || emp.status === 201, String(emp.status));
  const empList = await api('GET', '/employees?q=کارمند آزمون', undefined, token);
  const empRow = (empList.body?.rows || [])[0] || {};
  check('کارمند در فهرست هست', Boolean(empRow.id));
  const profile = await api('GET', `/employees/${empRow.id}`, undefined, token);
  check('صفحه‌ی کارمند باز می‌شود', profile.status === 200 && Boolean(profile.body?.employee));
  check('صفحه‌ی کارمند پرچم «حذف‌نشده» دارد', profile.body?.deleted === false, String(profile.body?.deleted));

  /*
   * ── باگ دور ۳۴: «ایام حاضر» فقط از ۶۰ ردیف آخر جمع می‌شد ────────────────
   * فهرست حضور در پروفایل `LIMIT 60` دارد، ولی UI همان فهرست را جمع می‌زد؛
   * برای کارمند با سابقه‌ی چندماهه عدد کمتر از واقعیت بود. سرور حالا جمعِ کل
   * را در `totals` می‌فرستد و `listTruncated` می‌گوید فهرست بریده است.
   */
  {
    const mkDay = (i) => addDays('2025-01-01', i);
    const items = Array.from({ length: 70 }, (_, i) => ({
      employeeId: empRow.id, date: mkDay(i),
      status: i % 7 === 6 ? 'absent' : 'present', overtime: i % 3,
    }));
    const bulk = await api('POST', '/attendance/bulk', { items }, token);
    check('۷۰ روز حضور و غیاب ثبت شد', bulk.status === 200 || bulk.status === 201, String(bulk.status));
    const p2 = await api('GET', `/employees/${empRow.id}`, undefined, token);
    const t = p2.body?.totals || {};
    check('totals.days همه‌ی روزها را می‌شمارد (نه فقط ۶۰)', Number(t.days) === 70, String(t.days));
    check('totals.present از فهرست ۶۰ ردیفی بیشتر است', Number(t.present) === 60, String(t.present));
    check('totals.absent درست است', Number(t.absent) === 10, String(t.absent));
    check('totals.overtime جمع کل است', Number(t.overtime) === 69, String(t.overtime));
    check('listTruncated=true وقتی بیش از ۶۰ روز سابقه است', t.listTruncated === true, String(t.listTruncated));
    check('فهرست نمایشی همچنان حداکثر ۶۰ ردیف است', (p2.body?.attendance || []).length === 60, String((p2.body?.attendance || []).length));
  }

  /* ================================================================ */
  console.log('\n— حضور و غیاب: حذف نرم و اثرش —');

  const att1 = await api('POST', '/attendance/bulk', { items: [{ employeeId: empRow.id, date: todayISO(), status: 'present', overtime: 3 }] }, token);
  check('ثبت حضور و غیاب', att1.status === 200 || att1.status === 201, String(att1.status));
  const attSheet = await api('GET', `/attendance?date=${todayISO()}`, undefined, token);
  const seen = (attSheet.body?.rows || []).filter((r) => r.employeeId === empRow.id);
  check('حضور در ورق روز دیده می‌شود', seen.length === 1 && seen[0].status === 'present', JSON.stringify(seen).slice(0, 100));

  /* پاک کردن سلول (remove: true) → باید نرم باشد، نه DELETE */
  const attDel = await api('POST', '/attendance/bulk', { items: [{ employeeId: empRow.id, date: todayISO(), remove: true }] }, token);
  check('پاک کردن سلول حضور', attDel.status === 200 || attDel.status === 201, String(attDel.status));
  const attSheet2 = await api('GET', `/attendance?date=${todayISO()}`, undefined, token);
  check('بعد از پاک کردن، حضور در ورق نیست', !(attSheet2.body?.rows || []).some((r) => r.employeeId === empRow.id));
  /* شناسه‌ی ردیف حضور را قبل از پاک کردن نگه می‌داریم تا بازیابی دقیق باشد */
  const attRowId = (seen[0] || {}).id;
  const recycleAtt = await api('GET', '/recycle/Attendance', undefined, token);
  check('ردیف حضور در سطل بازیافت هست (حذف نرم شد، پاک نشد)',
    (recycleAtt.body?.rows || []).some((r) => r.id === attRowId),
    `${recycleAtt.status} ids=${(recycleAtt.body?.rows || []).map((r) => r.id).join(',')} want=${attRowId}`);
  const attRestore = await api('POST', `/recycle/Attendance/${attRowId}/restore`, {}, token);
  check('بازیابی ردیف حضور', attRestore.status === 200 || attRestore.status === 201, String(attRestore.status));
  const attSheet3 = await api('GET', `/attendance?date=${todayISO()}`, undefined, token);
  check('بعد از بازیابی، حضور برگشت', (attSheet3.body?.rows || []).some((r) => r.employeeId === empRow.id));

  /* دوباره ثبت همان روز (بازگشت از سطل) */
  await api('POST', '/attendance/bulk', { items: [{ employeeId: empRow.id, date: todayISO(), remove: true }] }, token);
  const attRe = await api('POST', '/attendance/bulk', { items: [{ employeeId: empRow.id, date: todayISO(), status: 'present', overtime: 1 }] }, token);
  check('ثبت دوباره‌ی همان روز بعد از حذف کار می‌کند', attRe.status === 200 || attRe.status === 201, String(attRe.status));
  const attSheet4 = await api('GET', `/attendance?date=${todayISO()}`, undefined, token);
  check('ردیف دوباره ثبت‌شده با ساعت اضافه‌کاری تازه دیده می‌شود',
    (attSheet4.body?.rows || []).some((r) => r.employeeId === empRow.id && Number(r.overtime) === 1));

  /* ================================================================ */
  console.log('\n— حذف کارمند: از محاسبات بیرون، در سطل بازیافت —');

  /* ۱) کارمندی که سابقه‌ی معاش/حضور دارد نباید حذف شود (محافظ) */
  const guardDel = await api('DELETE', `/employees/${empRow.id}`, undefined, token);
  check('کارمند دارای سابقه‌ی معاش/حضور حذف نمی‌شود و پیام راهنما می‌دهد',
    guardDel.status === 400 && String(guardDel.body?.message || guardDel.body || '').includes('غیر فعال'),
    `${guardDel.status} ${JSON.stringify(guardDel.body).slice(0, 90)}`);

  /* ۲) کارمند تازه (بدون سابقه) حذف نرم می‌شود */
  const emp2 = await api('POST', '/employees', { name: 'کارمند برای حذف', position: 'راننده', baseSalary: 9000, hireDate: todayISO() }, token);
  check('ساخت کارمند دوم', emp2.status === 200 || emp2.status === 201, String(emp2.status));
  const emp2Row = ((await api('GET', '/employees?q=' + encodeURIComponent('کارمند برای حذف'), undefined, token)).body?.rows || [])[0] || {};
  const empDel = await api('DELETE', `/employees/${emp2Row.id}`, undefined, token);
  check('حذف کارمند (نرم)', empDel.status === 200, `${empDel.status} ${JSON.stringify(empDel.body).slice(0, 90)}`);
  const empList2 = await api('GET', '/employees?q=' + encodeURIComponent('کارمند برای حذف'), undefined, token);
  check('کارمند حذف‌شده در فهرست نیست', (empList2.body?.rows || []).length === 0, JSON.stringify((empList2.body?.rows || []).length));
  const recycleEmp = await api('GET', '/recycle', undefined, token);
  const empCount = (recycleEmp.body?.items || []).find((i) => i.table === 'Employee')?.count || 0;
  check('کارمند در سطل بازیافت شمرده می‌شود', empCount >= 1, String(empCount));
  const attAfter = await api('GET', `/attendance?date=${todayISO()}`, undefined, token);
  check('کارمند حذف‌شده در فهرست کشویی حضور نیست',
    !(attAfter.body?.employees || []).some((e) => e.id === emp2Row.id));
  const profileDel = await api('GET', `/employees/${emp2Row.id}`, undefined, token);
  check('صفحه‌ی کارمند حذف‌شده با پرچم «در سطل بازیافت» باز می‌شود',
    profileDel.status === 200 && profileDel.body?.deleted === true, `${profileDel.status} ${profileDel.body?.deleted}`);
  const empRestore = await api('POST', `/recycle/Employee/${emp2Row.id}/restore`, {}, token);
  check('بازیابی کارمند', empRestore.status === 200 || empRestore.status === 201, String(empRestore.status));
  const empList3 = await api('GET', '/employees?q=' + encodeURIComponent('کارمند برای حذف'), undefined, token);
  check('بعد از بازیابی کارمند برمی‌گردد', (empList3.body?.rows || []).length === 1);

  /* ================================================================ */
  console.log('\n— بل فروش: حذف نرم نباید در گزارش/مانده بیاید —');
  const cust = await api('POST', '/customers', { name: 'مشتری حذف‌نرم', code: 'SD-1' }, token);
  check('ساخت مشتری', cust.status === 200 || cust.status === 201, String(cust.status));
  const cid = ((await api('GET', '/customers?q=SD-1', undefined, token)).body || [])[0]?.id;

  const sale = await api('POST', '/sales', {
    customerId: cid, materialName: 'ریگ', volume: 5, unitPrice: 100, freightPerUnit: 0,
    paymentType: 'credit', date: todayISO(),
  }, token);
  check('ثبت بل فروش', sale.status === 200 || sale.status === 201, String(sale.status));

  const balBefore = ((await api('GET', '/customers?q=SD-1', undefined, token)).body || [])[0] || {};
  check('مانده‌ی مشتری با بل فروش ۵۰۰ شد', Number(balBefore.balance) === 500, String(balBefore.balance));

  const dashBefore = await api('GET', '/reports/dashboard', undefined, token);
  const salesBefore = Number(dashBefore.body?.today?.allSales ?? 0);
  check('داشبورد فروش امروز را می‌شمارد', salesBefore >= 500, String(salesBefore));

  const saleId = ((await api('GET', `/sales?q=${encodeURIComponent(sale.body?.no || '')}`, undefined, token)).body?.rows || [])[0]?.id;
  const saleDel = await api('DELETE', `/sales/${saleId}`, undefined, token);
  check('حذف نرم بل فروش', saleDel.status === 200, String(saleDel.status));

  const balAfter = ((await api('GET', '/customers?q=SD-1', undefined, token)).body || [])[0] || {};
  check('بل فروش حذف‌شده از مانده‌ی مشتری بیرون رفت', Number(balAfter.balance) === 0, String(balAfter.balance));
  const dashAfter = await api('GET', '/reports/dashboard', undefined, token);
  check('بل فروش حذف‌شده از داشبورد بیرون رفت',
    Number(dashAfter.body?.today?.allSales ?? 0) === salesBefore - 500,
    `${dashAfter.body?.today?.allSales} vs ${salesBefore}`);
  const brd = await api('GET', `/reports/breakdown?from=${addDays(todayISO(), -3)}&to=${addDays(todayISO(), 3)}`, undefined, token);
  check('بل فروش حذف‌شده در راپور تفصیلی نیست',
    !(brd.body?.byCustomer || []).some((r) => r.name === 'مشتری حذف‌نرم'),
    JSON.stringify((brd.body?.byCustomer || []).map((r) => r.name)));
  const csvAll = await fetch(`${BASE}/export?type=sales&format=csv`, { headers: { 'x-auth-token': token } });
  const csvText = Buffer.from(await csvAll.arrayBuffer()).toString('utf8');
  check('بل فروش حذف‌شده در خروجی اکسل نیست', !csvText.includes(String(sale.body?.no || '###')), csvText.slice(0, 120));

  const saleRestore = await api('POST', `/recycle/Sale/${saleId}/restore`, {}, token);
  check('بازیابی بل فروش', saleRestore.status === 200 || saleRestore.status === 201, String(saleRestore.status));
  const balRestored = ((await api('GET', '/customers?q=SD-1', undefined, token)).body || [])[0] || {};
  check('بعد از بازیابی، مانده دقیقاً برمی‌گردد', Number(balRestored.balance) === 500, String(balRestored.balance));

  /* ================================================================ */
  console.log('\n— مصرف و معاش: اثر روی راپور روزانه —');
  const exp = await api('POST', '/expenses', {
    description: 'مصرف آزمون حذف نرم', categoryName: 'کرایه وسایط', amountAfn: 300,
    payerName: 'دخل', paymentType: 'cash', date: todayISO(),
  }, token);
  check('ثبت مصرف', exp.status === 200 || exp.status === 201, String(exp.status));
  const dayBefore = await api('GET', `/reports/daily?from=${todayISO()}&to=${todayISO()}`, undefined, token);
  const expBefore = Number(dayBefore.body?.totals?.expensesAfn ?? 0);
  check('مصرف در راپور روزانه هست', expBefore >= 300, String(expBefore));
  const expId = ((await api('GET', `/expenses?q=${encodeURIComponent(exp.body?.no || '')}`, undefined, token)).body?.rows || [])[0]?.id;
  await api('DELETE', `/expenses/${expId}`, undefined, token);
  const dayAfter = await api('GET', `/reports/daily?from=${todayISO()}&to=${todayISO()}`, undefined, token);
  check('مصرف حذف‌شده از راپور روزانه بیرون رفت',
    Number(dayAfter.body?.totals?.expensesAfn ?? 0) === expBefore - 300,
    `${dayAfter.body?.totals?.expensesAfn} vs ${expBefore}`);

  /* ================================================================ */
  console.log('\n— معاش: سند حذف‌شده از راپور بیرون، از محاسبه‌ی ورق معاش بیرون —');

  const sheet = await api('GET', '/salaries/sheet', undefined, token);
  check('ورق معاش باز می‌شود', sheet.status === 200 && Array.isArray(sheet.body?.rows), String(sheet.status));
  const sheetRow = (sheet.body?.rows || []).find((r) => r.employeeId === empRow.id);
  check('کارمند در ورق معاش هست', Boolean(sheetRow), JSON.stringify((sheet.body?.rows || []).map((r) => r.employeeId)));
  /* اضافه‌کاری روزانه‌ای که در بخش قبل «پاک» شد نباید در ورق حساب شود */
  check('اضافه‌کاری روز پاک‌شده در ورق معاش صفر است (فقط ۱ ساعت بازمانده)',
    Number(sheetRow?.overtimeHours) === 1, String(sheetRow?.overtimeHours));

  const salSave = await api('POST', '/salaries/sheet', {
    month: sheet.body?.month, payDate: todayISO(),
    rows: [(sheetRow || {})].map((r) => ({ ...r, bonus: 100, total: undefined })),
  }, token);
  check('ذخیره‌ی ورق معاش', salSave.status === 200 || salSave.status === 201, `${salSave.status} ${JSON.stringify(salSave.body).slice(0, 120)}`);

  const daySal1 = await api('GET', `/reports/daily?from=${todayISO()}&to=${todayISO()}`, undefined, token);
  const salBefore = Number(daySal1.body?.totals?.salaries ?? 0);
  check('معاش در راپور روزانه‌ی روز پرداخت هست', salBefore > 0, String(salBefore));

  const sheet2 = await api('GET', '/salaries/sheet', undefined, token);
  const salId = (sheet2.body?.rows || []).find((r) => r.employeeId === empRow.id)?.salaryId;
  check('سند معاش شناسه دارد', Boolean(salId), String(salId));
  const salDel = await api('DELETE', `/salaries/${salId}`, undefined, token);
  check('حذف سند معاش', salDel.status === 200, String(salDel.status));

  const daySal2 = await api('GET', `/reports/daily?from=${todayISO()}&to=${todayISO()}`, undefined, token);
  check('سند معاش حذف‌شده از راپور روزانه بیرون رفت',
    Number(daySal2.body?.totals?.salaries ?? 0) === salBefore - salBefore,
    `${daySal2.body?.totals?.salaries} vs ${salBefore}`);
  const sheet3 = await api('GET', '/salaries/sheet', undefined, token);
  check('سند حذف‌شده دوباره در ورق معاش «ذخیره‌شده» نشان داده نمی‌شود',
    (sheet3.body?.rows || []).find((r) => r.employeeId === empRow.id)?.saved === false);
  const salRestore = await api('POST', `/recycle/Salary/${salId}/restore`, {}, token);
  check('بازیابی سند معاش', salRestore.status === 200 || salRestore.status === 201, String(salRestore.status));
  const daySal3 = await api('GET', `/reports/daily?from=${todayISO()}&to=${todayISO()}`, undefined, token);
  check('بعد از بازیابی، معاش دقیقاً به راپور برگشت',
    Number(daySal3.body?.totals?.salaries ?? 0) === salBefore, `${daySal3.body?.totals?.salaries} vs ${salBefore}`);

  /* ثبت دوباره‌ی همان ماه روی سند بازیابی‌شده نباید خطای «تکراری» بدهد */
  const sheet4 = await api('GET', '/salaries/sheet', undefined, token);
  const resave = await api('POST', '/salaries/sheet', {
    month: sheet4.body?.month, payDate: todayISO(),
    rows: [(sheet4.body?.rows || []).find((r) => r.employeeId === empRow.id) || {}],
  }, token);
  check('ثبت دوباره‌ی همان ماه بدون خطای تکراری', resave.status === 200 || resave.status === 201, `${resave.status} ${JSON.stringify(resave.body).slice(0, 120)}`);

  /* ================================================================ */
  console.log('\n— ویرایش ردیفِ سطل بازیافت (باگ: ۲۰۰ «ذخیره شد» ولی اثری نداشت) —');

  const s2 = await api('POST', '/sales', {
    customerId: cid, materialName: 'ریگ', volume: 2, unitPrice: 100, freightPerUnit: 0,
    paymentType: 'credit', date: todayISO(),
  }, token);
  const sale2Id = ((await api('GET', `/sales?q=${encodeURIComponent(s2.body.no)}`, undefined, token)).body?.rows || [])[0]?.id;
  await api('DELETE', `/sales/${sale2Id}`, undefined, token);
  const editTrashed = await api('PUT', `/sales/${sale2Id}`, {
    customerId: cid, volume: 99, unitPrice: 100, freightPerUnit: 0, paymentType: 'credit', date: todayISO(),
  }, token);
  check('ویرایش بلِ سطل بازیافت رد می‌شود (نه ۲۰۰ بی‌اثر)', editTrashed.status === 409, `${editTrashed.status}`);
  check('پیام می‌گوید اول بازگردانید',
    String(editTrashed.body?.message || '').includes('سطل بازیافت'), String(editTrashed.body?.message));
  await api('POST', `/recycle/Sale/${sale2Id}/restore`, {}, token);
  const afterRestore = await api('GET', `/sales/${sale2Id}`, undefined, token);
  check('پس از بازیابی، عددهای بل دست‌نخورده‌اند (۲ متر، ۲۰۰ افغانی)',
    Number(afterRestore.body?.volume) === 2 && Number(afterRestore.body?.total) === 200,
    `${afterRestore.body?.volume} / ${afterRestore.body?.total}`);
  await api('DELETE', `/sales/${sale2Id}`, undefined, token);

  /* رسید و مصرف هم همین قاعده را دارند */
  const r2 = await api('POST', '/receipts', { customerId: cid, amount: 150, date: todayISO(), sourceName: 'بیانیه' }, token);
  const r2id = ((await api('GET', `/receipts?q=${encodeURIComponent(r2.body?.no || '')}`, undefined, token)).body?.rows || [])[0]?.id;
  await api('DELETE', `/receipts/${r2id}`, undefined, token);
  const r2edit = await api('PUT', `/receipts/${r2id}`, { customerId: cid, amount: 9999, date: todayISO() }, token);
  check('ویرایش رسیدِ سطل بازیافت رد می‌شود', r2edit.status === 409, `${r2edit.status}`);
  await api('POST', `/recycle/Receipt/${r2id}/restore`, {}, token);
  const r2one = await api('GET', `/receipts/${r2id}`, undefined, token);
  check('مبلغ رسید بعد از بازیابی ۱۵۰ مانده (نه ۹۹۹۹)', Number(r2one.body?.amount) === 150, String(r2one.body?.amount));

  /* ================================================================ */
  console.log('\n— شناسه‌ی نامعتبر: ۴۰۰ روشن، نه ۴۰۴ گمراه‌کننده —');
  for (const [path, label] of [
    ['/sales/abc', 'بل فروش'], ['/receipts/abc', 'رسید'], ['/expenses/abc', 'مصرف'],
    ['/employees/abc', 'کارمند'], ['/customers/abc/statement', 'مشتری'], ['/salaries/abc', 'سند معاش'],
  ]) {
    const r = await api('GET', path, undefined, token);
    check(`GET ${path} → ۴۰۰ (${label})`, r.status === 400, `${r.status}`);
    check(`GET ${path} پیام فارسی دارد`, /نامعتبر/.test(String(r.body?.message || '')), String(r.body?.message));
  }
  const putBad = await api('PUT', '/sales/abc', { customerId: cid, volume: 1, unitPrice: 1, date: todayISO() }, token);
  check('PUT با شناسه‌ی نامعتبر ۴۰۰ می‌دهد', putBad.status === 400, `${putBad.status}`);

  /* ================================================================ */
  console.log('\n— سابقه: حذف‌ها در «فعالیت‌ها» می‌مانند —');
  const acts = await api('GET', '/system/activity?entity=Sale&limit=50', undefined, token);
  const saleActs = (Array.isArray(acts.body) ? acts.body : []).filter((a) => a.action === 'soft-delete' || a.action === 'delete');
  check('حذف بل فروش در سابقه ثبت شد', saleActs.length >= 1, JSON.stringify((Array.isArray(acts.body) ? acts.body : []).slice(0, 2)));
  check('سابقه می‌گوید چه کسی حذف کرد', saleActs.some((a) => Boolean(a.username) && String(a.detail || '').length > 0));

  /* ================================================================ */
  console.log('\n— ماشینری و فهرست‌ها —');
  const mach = await api('POST', '/machinery', { name: 'لودر آزمون' }, token);
  check('ساخت ماشین', mach.status === 200 || mach.status === 201, String(mach.status));
  const machList = await api('GET', '/machinery', undefined, token);
  const machRow = (Array.isArray(machList.body) ? machList.body : []).find((m) => m.name === 'لودر آزمون');
  check('ماشین در فهرست هست', Boolean(machRow));
  if (machRow) {
    await api('DELETE', `/machinery/${machRow.id}`, undefined, token);
    const machList2 = await api('GET', '/machinery', undefined, token);
    check('ماشین حذف‌شده از فهرست رفت', !(Array.isArray(machList2.body) ? machList2.body : []).some((m) => m.id === machRow.id));
    const rec = await api('GET', '/recycle', undefined, token);
    check('ماشین در سطل بازیافت هست',
      ((rec.body?.items || []).find((i) => i.table === 'Machinery')?.count || 0) >= 1);
    const back = await api('POST', `/recycle/Machinery/${machRow.id}/restore`, {}, token);
    check('بازیابی ماشین', back.status === 200 || back.status === 201, String(back.status));
    const machList3 = await api('GET', '/machinery', undefined, token);
    check('ماشین بعد از بازیابی برگشت', (Array.isArray(machList3.body) ? machList3.body : []).some((m) => m.id === machRow.id));
  }

  try { child.kill(); } catch { /* */ }
  finish();
})().catch((e) => {
  console.error('\n⛔ خطای غیرمنتظره:', e);
  finish(1);
});

function finish(code = 0) {
  console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  console.log('');
  process.exit(failed === 0 && code === 0 ? 0 : 1);
}
