/**
 * تست «ویرایش ناقص نباید فیلدهای دیگر را پاک کند» — شکار باگ دور ۳۴
 *
 *   node apps/api/test/partial-edit.test.js
 *
 * ## باگی که این تست نگه می‌دارد
 * همه‌ی مسیرهای `PUT` بدنه را **کامل** فرض می‌کردند. یعنی:
 *   • `PUT /customers/5 {name}` تلفن، شخص رابط، پلاک موتر و یادداشت را خالی
 *     می‌کرد (و «باقی اولیه» را صفر).
 *   • `PUT /sales/5 {note}` بل را به **مشتری گذری** می‌برد — بدهی مشتری واقعی
 *     بی‌صدا گم می‌شد — و راننده/پلاک/مقصد/مواد را خالی می‌کرد.
 *   • `PUT /receipts/5 {note}` شماره بل مرتبط، «تحویل‌دهنده» و یادداشت را پاک
 *     می‌کرد، ولی `sourceName` می‌ماند (رسید متناقض).
 *   • `PUT /expenses/5 {note}` مبلغ دالری را صفر و شرح/دسته/فروشگاه را پاک.
 *   • `PUT /machinery/5 {name}` مدل، پلاک، تعداد و وضعیت را بازنویسی می‌کرد.
 *   • `PUT /company {name}` آدرس/تلفن/سال مالی/مدیر مالی را پاک می‌کرد —
 *     همان چیزهایی که روی سرصفحه‌ی اسناد چاپی می‌آیند.
 *
 * قاعده‌ی طراحی: **کلیدِ غایب = «دست نزن»**. فرم‌های وب کل شیء را می‌فرستند،
 * پس این تغییر برای UI بی‌اثر است ولی برای API/CLI/اسکریپت حیاتی است.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const dist = path.join(root, 'apps/api/dist');
const PORT = 4479;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-pe-'));

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
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };

  const up = await (async () => {
    for (let i = 0; i < 160; i++) {
      try { const r = await fetch(BASE + '/health'); if (r.ok) return true; } catch { /* wait */ }
      if (child.exitCode !== null) return false;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  })();
  check('سرور بالا آمد', up, up ? '' : log.slice(-400));
  if (!up) { try { child.kill(); } catch { /* */ } return finish(); }

  const mk = (await api('GET', '/license/device')).body.machineKey;
  const payload = {
    v: 1, id: 'FR-LIC-PE', customer: 'آزمون', kind: 'yearly',
    start: addDays(todayISO(), -1), end: addDays(todayISO(), 200),
    machineKey: mk, seats: 1, note: '', issuedAt: new Date().toISOString(),
  };
  const body64 = b64u(JSON.stringify(payload));
  const lic = `-----BEGIN FARDAY LICENSE-----\nFR-1\n${body64}\n${b64u(crypto.sign(null, Buffer.from(body64, 'utf8'), kp.privateKey))}\n-----END FARDAY LICENSE-----`;
  await api('POST', '/license/activate', { text: lic });
  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body?.token || '';
  check('ورود مدیر', Boolean(token));

  /* ---------------------------- مشتری ---------------------------- */
  console.log('\n— مشتری: ویرایش ناقص فیلدها را پاک نمی‌کند —');
  await api('POST', '/customers', { name: 'مشتری آزمون', phone: '0700111222', truckPlate: 'KBL-321', note: 'یادداشت مشتری' }, token);
  const cust = ((await api('GET', `/customers?page=1&q=${encodeURIComponent('مشتری آزمون')}`, undefined, token)).body?.rows || [])[0] || {};
  check('مشتری ساخته شد', Boolean(cust.id));
  const cUp = await api('PUT', `/customers/${cust.id}`, { name: 'مشتری آزمون' }, token);
  check('ویرایش فقط نام، موفق است', cUp.status === 200, String(cUp.status));
  const cust2 = ((await api('GET', `/customers?page=1&q=${encodeURIComponent('مشتری آزمون')}`, undefined, token)).body?.rows || [])[0] || {};
  check('تلفن حفظ شد', cust2.phone === '0700111222', String(cust2.phone));
  check('پلاک موتر حفظ شد', cust2.truckPlate === 'KBL-321', String(cust2.truckPlate));
  check('یادداشت حفظ شد', cust2.note === 'یادداشت مشتری', String(cust2.note));

  /* ----------------------------- فروش ---------------------------- */
  console.log('\n— بل فروش: ویرایش یادداشت، بل را به «گذری» نمی‌برد —');
  const sale = await api('POST', '/sales', {
    date: todayISO(), customerId: cust.id, volume: 2, unitPrice: 1000,
    driverName: 'گل احمد', truckPlate: 'KBL-77', destination: 'کابل', paymentType: 'credit', note: 'بل اول',
  }, token);
  check('بل ساخته شد', sale.status === 200 || sale.status === 201, String(sale.status));
  const saleRow = (await api('GET', '/sales', undefined, token)).body?.rows?.find((r) => r.no === sale.body.no) || {};
  check('شماره بل در فهرست هست', Boolean(saleRow.id));
  const sUp = await api('PUT', `/sales/${saleRow.id}`, { note: 'بل ویرایش‌شده' }, token);
  check('ویرایش فقط یادداشت موفق است (تاریخ/متراژ لازم نیست)', sUp.status === 200, `${sUp.status} ${JSON.stringify(sUp.body).slice(0, 120)}`);
  const sale2 = (await api('GET', `/sales/${saleRow.id}`, undefined, token)).body || {};
  check('مشتری بل عوض نشد (به «گذری» نرفت)', Number(sale2.customerId) === Number(cust.id), `${sale2.customerId} ≠ ${cust.id}`);
  check('نام مشتری حفظ شد', sale2.customerName === 'مشتری آزمون', String(sale2.customerName));
  check('متراژ حفظ شد', Number(sale2.volume) === 2, String(sale2.volume));
  check('قیمت واحد حفظ شد', Number(sale2.unitPrice) === 1000, String(sale2.unitPrice));
  check('جمع بل حفظ شد', Number(sale2.total) === 2000, String(sale2.total));
  check('راننده حفظ شد', sale2.driverName === 'گل احمد', String(sale2.driverName));
  check('پلاک موتر حفظ شد', sale2.truckPlate === 'KBL-77', String(sale2.truckPlate));
  check('مقصد حفظ شد', sale2.destination === 'کابل', String(sale2.destination));
  check('نوع پرداخت حفظ شد (قرضه)', sale2.paymentType === 'credit', String(sale2.paymentType));
  check('یادداشت تازه نوشته شد', sale2.note === 'بل ویرایش‌شده', String(sale2.note));
  check('شماره بل حفظ شد', sale2.no === sale.body.no, `${sale2.no} ≠ ${sale.body.no}`);

  /* ---------------------------- رسید ---------------------------- */
  console.log('\n— رسید: ویرایش یادداشت، مبلغ و بل مرتبط را نگه می‌دارد —');
  const rec = await api('POST', '/receipts', {
    date: todayISO(), customerId: cust.id, amount: 300, relatedBillNo: sale.body.no, receivedBy: 'صندوق', note: 'رسید اول',
  }, token);
  check('رسید ساخته شد', rec.status === 200 || rec.status === 201, String(rec.status));
  const recRow = (await api('GET', '/receipts', undefined, token)).body?.rows?.find((r) => r.no === rec.body.no) || {};
  const rUp = await api('PUT', `/receipts/${recRow.id}`, { note: 'رسید ویرایش' }, token);
  check('ویرایش فقط یادداشت موفق است', rUp.status === 200, `${rUp.status} ${JSON.stringify(rUp.body).slice(0, 120)}`);
  const rec2 = (await api('GET', `/receipts/${recRow.id}`, undefined, token)).body || {};
  check('مبلغ حفظ شد', Number(rec2.amount) === 300, String(rec2.amount));
  check('بل مرتبط حفظ شد', rec2.relatedBillNo === sale.body.no, String(rec2.relatedBillNo));
  check('تحویل‌دهنده حفظ شد', rec2.receivedBy === 'صندوق', String(rec2.receivedBy));
  check('نوع رسید حفظ شد', String(rec2.sourceName || '') === String(recRow.sourceName || ''), `${rec2.sourceName} ≠ ${recRow.sourceName}`);
  check('شماره رسید حفظ شد', rec2.no === rec.body.no, `${rec2.no} ≠ ${rec.body.no}`);
  check('یادداشت تازه نوشته شد', rec2.note === 'رسید ویرایش', String(rec2.note));

  /* ---------------------------- مصرف ---------------------------- */
  console.log('\n— مصرف: ویرایش یادداشت، مبلغ دالری و فروشگاه را نگه می‌دارد —');
  const exp = await api('POST', '/expenses', {
    date: todayISO(), description: 'کرایه لاری', shopName: 'دکان الف', purchaseBillNo: 'B-9',
    amountAfn: 500, amountUsd: 7, paymentType: 'credit', note: 'یادداشت اول',
  }, token);
  const expRow = (await api('GET', '/expenses', undefined, token)).body?.rows?.find((r) => r.no === exp.body.no) || {};
  const eUp = await api('PUT', `/expenses/${expRow.id}`, { note: 'یادداشت دوم' }, token);
  check('ویرایش فقط یادداشت موفق است', eUp.status === 200, `${eUp.status} ${JSON.stringify(eUp.body).slice(0, 120)}`);
  const exp2 = (await api('GET', `/expenses/${expRow.id}`, undefined, token)).body || {};
  check('مبلغ افغانی حفظ شد', Number(exp2.amountAfn) === 500, String(exp2.amountAfn));
  check('مبلغ دالری حفظ شد (صفر نشد)', Number(exp2.amountUsd) === 7, String(exp2.amountUsd));
  check('شرح حفظ شد', exp2.description === 'کرایه لاری', String(exp2.description));
  check('فروشگاه حفظ شد', exp2.shopName === 'دکان الف', String(exp2.shopName));
  check('شماره بل خرید حفظ شد', exp2.purchaseBillNo === 'B-9', String(exp2.purchaseBillNo));
  check('نوع پرداخت حفظ شد', exp2.paymentType === 'credit', String(exp2.paymentType));

  /* --------------------------- ماشین‌ری --------------------------- */
  console.log('\n— ماشین: ویرایش نام، مدل/پلاک/تعداد/وضعیت را نگه می‌دارد —');
  await api('POST', '/machinery', { name: 'لودر آزمون ۳۴', model: 'CAT 950', plateNo: 'M-1', count: 2, status: 'repair', note: 'در تعمیر' }, token);
  const mach = (await api('GET', '/machinery', undefined, token)).body?.find((m) => m.name === 'لودر آزمون ۳۴') || {};
  const mUp = await api('PUT', `/machinery/${mach.id}`, { name: 'لودر ویرایش‌شده' }, token);
  check('ویرایش فقط نام موفق است', mUp.status === 200, String(mUp.status));
  const mach2 = (await api('GET', '/machinery', undefined, token)).body?.find((m) => m.id === mach.id) || {};
  check('نام عوض شد', mach2.name === 'لودر ویرایش‌شده', String(mach2.name));
  check('مدل حفظ شد', mach2.model === 'CAT 950', String(mach2.model));
  check('پلاک حفظ شد', mach2.plateNo === 'M-1', String(mach2.plateNo));
  check('تعداد حفظ شد', Number(mach2.count) === 2, String(mach2.count));
  check('وضعیت حفظ شد', mach2.status === 'repair', String(mach2.status));
  check('یادداشت حفظ شد', mach2.note === 'در تعمیر', String(mach2.note));

  /* --------------------------- شرکت --------------------------- */
  console.log('\n— شرکت: ویرایش نام، بقیه‌ی سرصفحه‌ی اسناد را پاک نمی‌کند —');
  await api('PUT', '/company', {
    name: 'شرکت آزمون', address: 'کابل، سرک ۱', phone: '0200000', fiscalYear: '1404', financeManager: 'مدیر مالی',
  }, token);
  const coUp = await api('PUT', '/company', { name: 'شرکت آزمون ۲' }, token);
  check('ویرایش فقط نام موفق است', coUp.status === 200, String(coUp.status));
  const co = (await api('GET', '/company', undefined, token)).body || {};
  check('نام عوض شد', co.name === 'شرکت آزمون ۲', String(co.name));
  check('آدرس حفظ شد', co.address === 'کابل، سرک ۱', String(co.address));
  check('تلفن حفظ شد', co.phone === '0200000', String(co.phone));
  check('سال مالی حفظ شد', co.fiscalYear === '1404', String(co.fiscalYear));
  check('مدیر مالی حفظ شد', co.financeManager === 'مدیر مالی', String(co.financeManager));

  /* نام خالی هنوز رد می‌شود (محافظ قبلی نشکسته باشد) */
  const bad = await api('PUT', '/company', { name: '   ' }, token);
  check('نام شرکتِ خالی هنوز ۴۰۰ می‌گیرد', bad.status === 400, String(bad.status));

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
