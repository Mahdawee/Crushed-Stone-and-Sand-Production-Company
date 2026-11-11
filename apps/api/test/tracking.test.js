/**
 * تست «پیگیری بل فروش» (round 25) — `npm run test:tracking`
 *
 * ── باگی که این تست از بازگشتش جلوگیری می‌کند ─────────────────────────────
 *
 * سرور بل فروش را با شماره‌ای ذخیره می‌کند که از سند خودش (`Sequence`) می‌آید
 * (مثلاً `F-1404-0007`). اما فورم ویرایش در رابط، شماره‌ی بل را **نمی‌فرستاد**
 * و کد `PUT /sales/:id` هم شماره را ذخیره نمی‌کرد. نتیجه:
 *
 *   ۱) با هر ذخیره، فورم شماره‌ی *جدید* (`next-no`) را نشان می‌داد و کاربر
 *      فکر می‌کرد شماره‌ی بل عوض شده؛
 *   ۲) شماره روی سند با شماره‌ای که در فهرست/چاپ دیده می‌شد یکی نبود
 *      (گزارش «شماره‌های بل تکراری»).
 *
 * حالا: شماره در ویرایش حفظ می‌شود، و اگر کاربر عمداً شماره را عوض کند،
 * شماره باید یکتا باشد (تکراری → ۴۰۹).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const PORT = 4481;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-track-'));

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

  try {
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* wait */ }
      if (child.exitCode !== null) throw new Error(`API بسته شد:\n${log}`);
      await new Promise((r) => setTimeout(r, 400));
    }

    const login = await api('POST', '/auth/login', { username: 'admin', password: 'admin123' });
    token = login.body?.token || '';
    check('ورود مدیر', !!token, JSON.stringify(login.body).slice(0, 120));
    if (!token) throw new Error('no token');

    /* ---------- ساخت دو بل ---------- */
    const mk = (v, price, extra = {}) => api('POST', '/sales', {
      date: '1404/06/15', volume: v, unitPrice: price, freightPerUnit: 0,
      paymentType: 'cash', materialName: 'ماسه', ...extra,
    });
    const a = await mk(10, 1000);
    check('بل اول ساخته شد', [200, 201].includes(a.status), JSON.stringify(a.body));
    const noA = a.body?.no;
    check('شماره بل اول برگشت', typeof noA === 'string' && noA.length > 0, String(noA));

    const b = await mk(5, 1000);
    const noB = b.body?.no;
    check('بل دوم با شماره دیگر ساخته شد', noB && noB !== noA, `${noA} / ${noB}`);

    const list = await api('GET', '/sales?page=1&pageSize=50');
    const rowA = (list.body?.rows || []).find((r) => r.no === noA);
    check('بل اول در فهرست هست', !!rowA);
    check('شناسه بل اول عدد است', Number.isFinite(Number(rowA?.id)), String(rowA?.id));

    /* ---------- ویرایش: شماره باید حفظ شود ---------- */
    const edit = await api('PUT', `/sales/${rowA.id}`, {
      date: '1404/06/16', customerId: '', volume: 12, unitPrice: 1000,
      freightPerUnit: 0, paymentType: 'cash', materialName: 'ماسه',
    });
    check('ویرایش موفق بود', [200, 201, 204].includes(edit.status), JSON.stringify(edit.body).slice(0, 200));

    const after = await api('GET', `/sales/${rowA.id}`);
    check('شماره بل بعد از ویرایش عوض نشده', after.body?.no === noA, `${noA} → ${after.body?.no}`);
    check('متراژ ویرایش اعمال شد', Number(after.body?.volume) === 12, String(after.body?.volume));
    check('تاریخ ویرایش اعمال شد (شمسی → ISO)', String(after.body?.date).startsWith('2025-09'), String(after.body?.date));

    /* ---------- شماره تکراری نباید پذیرفته شود ---------- */
    const dup = await api('PUT', `/sales/${rowA.id}`, {
      date: '1404/06/16', no: noB, customerId: '', volume: 12, unitPrice: 1000,
      freightPerUnit: 0, paymentType: 'cash', materialName: 'ماسه',
    });
    check('ویرایش با شماره تکراری رد می‌شود', dup.status === 409, `${dup.status} ${JSON.stringify(dup.body).slice(0, 120)}`);

    const still = await api('GET', `/sales/${rowA.id}`);
    check('پس از رد شدن، شماره بل دست‌نخورده ماند', still.body?.no === noA, String(still.body?.no));

    /* ---------- شماره سفارشی معتبر پذیرفته شود ---------- */
    const custom = 'KH-1404-999';
    const okEdit = await api('PUT', `/sales/${rowA.id}`, {
      date: '1404/06/16', no: custom, customerId: '', volume: 12, unitPrice: 1000,
      freightPerUnit: 0, paymentType: 'cash', materialName: 'ماسه',
    });
    check('ویرایش با شماره سفارشی یکتا موفق است', [200, 201, 204].includes(okEdit.status), String(okEdit.status));
    const got = await api('GET', `/sales/${rowA.id}`);
    check('شماره سفارشی ذخیره شد', got.body?.no === custom, String(got.body?.no));

    /* ---------- رسید: شماره در ویرایش حفظ شود ---------- */
    const rc = await api('POST', '/receipts', {
      date: '1404/06/15', customerId: '', amount: 500, sourceName: 'باقی داری', receivedBy: 'دخل',
    });
    check('رسید ساخته شد', [200, 201].includes(rc.status), JSON.stringify(rc.body).slice(0, 160));
    const rNo = rc.body?.no;
    const rcList = await api('GET', '/receipts?page=1&pageSize=20');
    const rcRow = (rcList.body?.rows || []).find((r) => r.no === rNo);
    check('رسید در فهرست هست', !!rcRow);
    const rcEdit = await api('PUT', `/receipts/${rcRow.id}`, {
      date: '1404/06/16', customerId: '', amount: 700, sourceName: 'باقی داری', receivedBy: 'دخل',
    });
    check('ویرایش رسید موفق است', [200, 201].includes(rcEdit.status), String(rcEdit.status));
    const rcAfter = await api('GET', '/receipts?page=1&pageSize=20');
    const rcNew = (rcAfter.body?.rows || []).find((r) => r.id === rcRow.id);
    check('شماره رسید بعد از ویرایش حفظ شد', rcNew?.no === rNo, `${rNo} → ${rcNew?.no}`);
    check('مبلغ رسید ویرایش شد', Number(rcNew?.amount) === 700, String(rcNew?.amount));

    /* ---------- مصرف: شماره در ویرایش حفظ شود ---------- */
    const ex = await api('POST', '/expenses', {
      date: '1404/06/15', description: 'تست', amountAfn: 120, paymentType: 'cash', payerName: 'دخل',
    });
    check('سند مصرف ساخته شد', [200, 201].includes(ex.status), JSON.stringify(ex.body).slice(0, 160));
    const eNo = ex.body?.no;
    const exList = await api('GET', '/expenses?page=1&pageSize=20');
    const exRow = (exList.body?.rows || []).find((r) => r.no === eNo);
    check('سند مصرف در فهرست هست', !!exRow);
    const exEdit = await api('PUT', `/expenses/${exRow.id}`, {
      date: '1404/06/16', description: 'تست ویرایش', amountAfn: 150, paymentType: 'cash', payerName: 'دخل',
    });
    check('ویرایش مصرف موفق است', [200, 201].includes(exEdit.status), String(exEdit.status));
    const exAfter = await api('GET', '/expenses?page=1&pageSize=20');
    const exNew = (exAfter.body?.rows || []).find((r) => r.id === exRow.id);
    check('شماره سند مصرف بعد از ویرایش حفظ شد', exNew?.no === eNo, `${eNo} → ${exNew?.no}`);

    /* ---------- خروجی اکسل: اعداد عددی، متن‌ها از فرمول بی‌خطر ---------- */
    const xls = await fetch(`${BASE}/export?type=sales&format=xls`, { headers: { 'x-auth-token': token } });
    const html = await xls.text();
    check('خروجی اکسل گرفته شد', xls.ok && html.includes('<table'), String(xls.status));
    check('ستون عددی با فرمت عددی نوشته شده (نه متن)',
      html.includes('mso-number-format:General'));
    check('محافظت فرمول برای متن‌ها هست', html.includes('mso-number-format:\\@') || html.includes("'="));

    /* ---------- حذف نرم: شماره رزرو می‌ماند و بازیابی سالم است ---------- */
    /*
     * تصمیم آگاهانه (نه باگ): شماره‌ی سندِ حذف‌شده **دوباره استفاده نمی‌شود**.
     * چرا: شماره‌ی بل روی کاغذ/رسید مشتری نوشته شده؛ اگر همان شماره به بل
     * دیگری برسد، دو سند با یک شماره در دست مردم می‌چرخد. ایندکس یکتای
     * `Sale_no_key` (که ردیف‌های حذف‌شده را هم می‌گیرد) همین را تضمین می‌کند.
     *
     * چیزی که *باگ* بود: بازیابی از سطل بازیافت اگر شماره‌اش عوض شده بود،
     * پیام خشک ۵۰۰ می‌داد. حالا پیام روشن می‌دهد.
     */
    {
      const s2 = await api('POST', '/sales', { date: '1404/06/15', volume: 1, unitPrice: 100, paymentType: 'cash' });
      check('بل سوم ساخته شد', [200, 201].includes(s2.status), String(s2.status));
      const three = await api('GET', '/sales?page=1&pageSize=50');
      const row3 = (three.body?.rows || []).find((r) => r.no === s2.body?.no);
      const del = await api('DELETE', `/sales/${row3.id}`);
      check('بل سوم نرم حذف شد', [200, 201].includes(del.status), String(del.status));

      const s4 = await api('POST', '/sales', { date: '1404/06/15', volume: 1, unitPrice: 100, paymentType: 'cash' });
      check('شماره سند حذف‌شده دوباره به بل تازه داده نمی‌شود (روی کاغذ مشتری است)',
        s4.body?.no !== s2.body?.no, `${s2.body?.no} → ${s4.body?.no}`);

      /* شماره‌ی سند تازه را به شماره‌ی آزاد «قرض» می‌دهیم تا بازیابی واقعاً تعارض کند */
      const s4Row = (await api('GET', '/sales?page=1&pageSize=50')).body.rows.find((r) => r.no === s4.body?.no);
      await api('DELETE', `/sales/${s4Row.id}`);
      const clash = await api('POST', '/sales', {
        date: '1404/06/15', no: s2.body?.no, volume: 1, unitPrice: 100, paymentType: 'cash',
      });
      check('شماره سند حذف‌شده به سند تازه داده نمی‌شود (ایندکس یکتا)',
        [400, 409].includes(clash.status), `${clash.status}`);

      const back = await api('POST', `/recycle/Sale/${row3.id}/restore`, {});
      check('سند حذف‌شده با موفقیت بازیابی می‌شود', [200, 201].includes(back.status), `${back.status} ${JSON.stringify(back.body).slice(0, 120)}`);
      const restored = await api('GET', `/sales/${row3.id}`);
      check('شماره سند بعد از بازیابی همان است', restored.body?.no === s2.body?.no, String(restored.body?.no));
    }

    /* ---------- راپورها: بازه‌ی شمسی باید داده بدهد (باگ تاریخ) ---------- */
    {
      /*
       * بل‌ها با تاریخ شمسی ۱۴۰۴/۰۶/۱۵ ثبت شدند. اگر سرور تاریخ را تبدیل
       * نکند، بازه‌ی «۱۴۰۴/۰۶/۰۱ تا ۱۴۰۴/۰۶/۳۱» خالی برمی‌گردد (مقایسه‌ی
       * رشته‌ای «1404/...» با «2025-...»). تست دقیقاً همین را می‌سنجد.
       */
      const cb = await api('GET', '/reports/cashbook?from=1404/06/01&to=1404/06/31');
      check('دفتر صندوق با بازه شمسی داده دارد', cb.status === 200 && (cb.body?.rows || []).length > 0,
        `${cb.status} rows=${(cb.body?.rows || []).length}`);
      check('دفتر صندوق تاریخ‌ها را میلادی برمی‌گرداند',
        (cb.body?.rows || []).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.date))),
        JSON.stringify((cb.body?.rows || [])[0] || {}).slice(0, 120));

      const bd = await api('GET', '/reports/breakdown?from=1404/06/01&to=1404/06/31');
      check('تفصیلی با بازه شمسی داده دارد', bd.status === 200,
        `${bd.status} ${JSON.stringify(bd.body).slice(0, 120)}`);
      const bdAny = JSON.stringify(bd.body || {});
      check('تفصیلی فروش غیر صفر دارد', /"total"\s*:\s*[1-9]|"sales"\s*:\s*[1-9]/.test(bdAny),
        bdAny.slice(0, 160));

      const daily = await api('GET', '/reports/daily?from=1404/06/01&to=1404/06/31');
      check('راپور روزانه با بازه شمسی کار می‌کند', daily.status === 200 && (daily.body?.rows || []).length > 0,
        String(daily.status));

      const bad = await api('GET', '/reports/cashbook?from=1404/13/01&to=1404/13/05');
      check('تاریخ نامعتبر در دفتر صندوق ۴۰۰ می‌دهد (نه ۵۰۰)', bad.status === 400, String(bad.status));
    }

    /* ---------- کارمندان، حضور و غیاب، معاش ---------- */
    {
      const emp = await api('POST', '/employees', {
        name: 'احمد تست', code: '901', position: 'کارگر', baseSalary: 26000, status: 'active', hireDate: '1404/01/01',
      });
      check('کارمند ساخته شد', [200, 201].includes(emp.status), JSON.stringify(emp.body).slice(0, 160));
      const emps = await api('GET', '/employees');
      const row = (emps.body?.rows || []).find((e) => e.name === 'احمد تست');
      check('کارمند در فهرست هست', !!row);
      check('شمارنده معاش در فهرست کارمندان هست (بدون کوئری N+1)',
        row && typeof row.salaryCount === 'number', String(row?.salaryCount));

      /* ثبت حضور گروهی: کارمند ناموجود باید رد شود */
      const bad = await api('POST', '/attendance/mark-day', {
        date: '1404/06/15', employeeIds: [999999], status: 'present',
      });
      check('ثبت حضور برای کارمند ناموجود رد می‌شود (ردیف یتیم ساخته نمی‌شود)', bad.status === 400, String(bad.status));
      const badStatus = await api('POST', '/attendance/mark-day', {
        date: '1404/06/15', employeeIds: [row.id], status: 'چیز-نامعتبر',
      });
      check('وضعیت نامعتبر حضور رد می‌شود', badStatus.status === 400, String(badStatus.status));
      const good = await api('POST', '/attendance/mark-day', {
        date: '1404/06/15', employeeIds: [row.id], status: 'present',
      });
      check('ثبت حضور گروهی موفق است', [200, 201].includes(good.status), String(good.status));
      const act = await api('GET', '/system/activity?page=1&pageSize=20');
      const logged = JSON.stringify(act.body || {});
      check('ثبت حضور گروهی در سابقه فعالیت‌ها می‌آید', /Attendance|حضور/.test(logged));

      /* معاش: نام کارمند از خود رکورد خوانده می‌شود (نه از بدنه) */
      const sheet = await api('POST', '/salaries/sheet', {
        month: '1404-06',
        rows: [{ employeeId: row.id, baseSalary: 26000, bonus: 0, penalty: 0, overtimeAmount: 0 }],
      });
      check('ورق معاش ذخیره شد', [200, 201].includes(sheet.status), `${sheet.status} ${JSON.stringify(sheet.body).slice(0, 140)}`);
      const salList = await api('GET', '/salaries?page=1&pageSize=20');
      const sal = (salList.body?.rows || [])[0];
      check('سند معاش با نام کارمند ثبت شد (نه خالی)', sal?.employeeName === 'احمد تست', String(sal?.employeeName));
    }

    /* ---------- اعتبارسنجی نام‌ها (شکار باگ دور ۲۵) ---------- */
    {
      const blankCust = await api('POST', '/customers', { name: '   ', code: '777' });
      check('مشتری با نام فقط-فاصله رد می‌شود', blankCust.status === 400, String(blankCust.status));
      const dupCust = await api('POST', '/customers', { name: 'یک', code: '778' });
      const dupCust2 = await api('POST', '/customers', { name: 'دو', code: '778' });
      check('کد تکراری مشتری رد می‌شود', [200, 201].includes(dupCust.status) && dupCust2.status === 400,
        `${dupCust.status}/${dupCust2.status}`);
      /* فهرست مشتریان آرایه‌ی خالص برمی‌گرداند (نه { rows }) */
      const custRows = (r) => (Array.isArray(r.body) ? r.body : (r.body?.rows || []));
      const listC = await api('GET', '/customers');
      const c1 = custRows(listC).find((c) => c.code === '778');
      check('مشتری آزمایشی ساخته شد', !!c1);
      const badCode = await api('PUT', `/customers/${c1.id}`, { name: 'دو', code: '000' });
      check('کد رزروشده ۰۰۰ در ویرایش رد می‌شود', badCode.status === 400, String(badCode.status));
      const keptCode = await api('PUT', `/customers/${c1.id}`, { name: 'دو', code: '' });
      check('ویرایش بدون کد، کد فعلی را حفظ می‌کند', [200, 201].includes(keptCode.status), String(keptCode.status));
      const listC2 = await api('GET', '/customers');
      const c2 = custRows(listC2).find((c) => c.id === c1.id);
      check('کد مشتری بعد از ویرایش خالی نشد', c2?.code === '778', String(c2?.code));

      const blankEmp = await api('POST', '/employees', { name: '  ', code: '950' });
      check('کارمند با نام فقط-فاصله رد می‌شود', blankEmp.status === 400, String(blankEmp.status));
      const negEmp = await api('POST', '/employees', { name: 'کارمند منفی', code: '951', baseSalary: -5 });
      check('معاش منفی رد می‌شود', negEmp.status === 400, String(negEmp.status));
      const emp3 = await api('POST', '/employees', { name: 'کارمند بی‌کد', code: '952' });
      const empList = await api('GET', '/employees');
      const e3 = (empList.body?.rows || []).find((e) => e.name === 'کارمند بی‌کد');
      const e3put = await api('PUT', `/employees/${e3.id}`, { name: 'کارمند بی‌کد', code: '' });
      const empList2 = await api('GET', '/employees');
      const e3b = (empList2.body?.rows || []).find((e) => e.id === e3.id);
      check('ویرایش کارمند بدون کد، کد را خالی نمی‌کند', e3b?.code === '952', `${e3b?.code} (${e3put.status})`);

      const blankCo = await api('PUT', '/company', { name: '  ' });
      check('نام شرکت خالی رد می‌شود (سرصفحه‌ی همه‌ی اسناد است)', blankCo.status === 400, String(blankCo.status));
      const co = await api('PUT', '/company', { name: 'شرکت آزمایشی' });
      check('نام شرکت معتبر ذخیره می‌شود', [200, 201].includes(co.status) && co.body?.name === 'شرکت آزمایشی');

      const mNeg = await api('POST', '/machinery', { name: 'لودر', count: -3 });
      check('تعداد منفی ماشین رد می‌شود', mNeg.status === 400, String(mNeg.status));
      const mBadStatus = await api('POST', '/machinery', { name: 'لودر', count: 1, status: 'چیز-نامعتبر' });
      check('وضعیت نامعتبر ماشین رد می‌شود', mBadStatus.status === 400, String(mBadStatus.status));
      const mOk = await api('POST', '/machinery', { name: 'لودر ۴۷۰', count: 2, status: 'active' });
      check('ماشین معتبر ساخته می‌شود', [200, 201].includes(mOk.status), String(mOk.status));

      /* اقلام فهرست: نام تکراری و شناسه‌ی ناموجود */
      const lk1 = await api('POST', '/lookups', { type: 'material', name: 'خاک سرند' });
      const lkDup = await api('POST', '/lookups', { type: 'material', name: 'خاک سرند' });
      check('قلم تکراری فهرست رد می‌شود', [200, 201].includes(lk1.status) && lkDup.status === 409,
        `${lk1.status}/${lkDup.status}`);
      const lkBlank = await api('POST', '/lookups', { type: 'material', name: '   ' });
      check('قلم با نام خالی رد می‌شود', lkBlank.status === 400, String(lkBlank.status));
      const lkUpdGhost = await api('PUT', '/lookups/999999', { name: 'چیزی' });
      check('ویرایش قلم ناموجود ۴۰۴ می‌دهد (نه ۲۰۰ دروغ)', lkUpdGhost.status === 404, String(lkUpdGhost.status));
      const lkList = await api('GET', '/lookups/manage?type=material');
      const lkRow = (lkList.body?.rows || []).find((r) => r.name === 'خاک سرند');
      const lkReorderBad = await api('POST', '/lookups/reorder', { type: 'payer', ids: [lkRow.id] });
      check('جابه‌جایی با شناسه‌ی نوع دیگر رد می‌شود', lkReorderBad.status === 400, String(lkReorderBad.status));
    }

    /* ---------- «شماره بعدی» نباید با شماره‌های موجود قاطی شود ---------- */
    const next = await api('GET', '/sales/next-no?date=1404/06/16');
    check('پیش‌نمایش شماره بعدی کار می‌کند', next.status === 200 && typeof next.body?.no === 'string',
      JSON.stringify(next.body).slice(0, 120));
  } finally {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }

  console.log(`\n${failed === 0 ? '✔' : '✘'} ${passed} تست موفق، ${failed} ناموفق`);
  if (failed) { console.log('\nمشکلات:'); problems.forEach((p) => console.log(` • ${p}`)); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
