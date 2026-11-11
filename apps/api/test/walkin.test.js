/**
 * تست «مشتری گذری»، «داده‌ی نمونه‌ی موقت» و «سابقه‌ی فعالیت ادغام‌شده».
 *
 *   npm run test:walkin
 *
 * سه درخواست کاربر:
 *   ۱) «یک مشتری گذری باید ایجاد کنی که اگر مشتری انتخاب نشود، معامله به
 *      مشتری بدون حساب ثبت شود.»
 *   ۲) «یک گزینه‌ی موقت نصب و حذف داده‌های نمونه.»
 *   ۳) «سطل بازیافت را در بخش سابقه فعالیت ادغام کن.»
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const PORT = 4473;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-wi-'));

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
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };

  let up = false;
  for (let i = 0; i < 160 && !up; i++) {
    try { up = (await fetch(BASE + '/health')).ok; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  check('سرور بالا آمد', up, up ? '' : log.slice(-400));
  if (!up) { try { child.kill(); } catch { /* */ } return finish(); }

  const mk = (await api('GET', '/license/device')).body.machineKey;
  const body = b64u(JSON.stringify({
    v: 1, id: 'FR-LIC-WI', customer: 'آزمون', kind: 'yearly',
    start: addDays(todayISO(), -1), end: addDays(todayISO(), 200), machineKey: mk, seats: 1,
    note: '', issuedAt: new Date().toISOString(),
  }));
  const lic = `-----BEGIN FARDAY LICENSE-----\nFR-1\n${body}\n${b64u(crypto.sign(null, Buffer.from(body, 'utf8'), kp.privateKey))}\n-----END FARDAY LICENSE-----`;
  await api('POST', '/license/activate', { text: lic });
  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body?.token || '';
  check('ورود مدیر', Boolean(token));

  /* ================================================================ */
  console.log('\n— مشتری گذری (بدون حساب) —');

  const custs = await api('GET', '/customers', undefined, token);
  check('فهرست مشتریان با «مشتری گذری» آلوده نیست',
    !(custs.body || []).some((c) => String(c.code) === '000' || Number(c.isWalkIn) === 1),
    JSON.stringify((custs.body || []).map((c) => c.code)));

  const walkList = await api('GET', '/customers?walkIn=1', undefined, token);
  check('با walkIn=1 خودِ «مشتری گذری» دیده می‌شود',
    (walkList.body || []).some((c) => String(c.code) === '000' && Number(c.isWalkIn) === 1),
    JSON.stringify(walkList.body));
  check('نامش گویاست', String((walkList.body || [])[0]?.name || '').includes('گذری'), String((walkList.body || [])[0]?.name));

  /* بل فروش بدون مشتری → گذری */
  const sale = await api('POST', '/sales', {
    materialName: 'ریگ', volume: 3, unitPrice: 100, freightPerUnit: 0,
    paymentType: 'cash', date: todayISO(), driverName: 'ناشناس',
  }, token);
  check('بل فروش بدون انتخاب مشتری ثبت می‌شود (گذری)', sale.status === 200 || sale.status === 201,
    `${sale.status} ${JSON.stringify(sale.body).slice(0, 140)}`);
  check('پاسخ می‌گوید بل «گذری» است', sale.body?.walkIn === true, String(sale.body?.walkIn));

  const list = await api('GET', '/sales?q=' + encodeURIComponent(String(sale.body?.no || '')), undefined, token);
  const row = (list.body?.rows || [])[0] || {};
  check('بل گذری در فهرست فروشات هست', Boolean(row.id));
  check('نام مشتری روی بل «مشتری گذری» است', String(row.customerName).includes('گذری'), String(row.customerName));

  /* فروش قرضه به گذری باید رد شود (بدهی بدون صاحب) */
  const credit = await api('POST', '/sales', {
    materialName: 'ریگ', volume: 3, unitPrice: 100, freightPerUnit: 0,
    paymentType: 'credit', date: todayISO(),
  }, token);
  check('فروش «قرضه» به گذری رد می‌شود', credit.status === 400, String(credit.status));
  check('پیام می‌گوید برای قرضه مشتری لازم است',
    String(credit.body?.message || '').includes('قرضه'), String(credit.body?.message));

  /* رسید بدون مشتری → گذری */
  const rc = await api('POST', '/receipts', { amount: 500, date: todayISO(), sourceName: 'باقی داری' }, token);
  check('رسید بدون مشتری ثبت می‌شود (گذری)', rc.status === 200 || rc.status === 201,
    `${rc.status} ${JSON.stringify(rc.body).slice(0, 120)}`);

  /* گذری نباید در مجموع بدهی مشتریان بیاید */
  const dash = await api('GET', '/reports/dashboard', undefined, token);
  check('داشبورد «گذری» را در بدهکاران نمی‌آورد',
    !(dash.body?.debtors || []).some((d) => String(d.name || '').includes('گذری')),
    JSON.stringify((dash.body?.debtors || []).map((d) => d.name)));
  check('شمارش مشتریان گذری را نمی‌شمارد', Number(dash.body?.counts?.customers) === 0,
    String(dash.body?.counts?.customers));

  /* گذری حذف/ویرایش نمی‌شود */
  const walkId = (walkList.body || [])[0]?.id;
  const delWalk = await api('DELETE', `/customers/${walkId}`, undefined, token);
  check('«مشتری گذری» حذف نمی‌شود', delWalk.status === 400, String(delWalk.status));
  const editWalk = await api('PUT', `/customers/${walkId}`, { code: '000', name: 'چیز دیگر' }, token);
  check('«مشتری گذری» ویرایش نمی‌شود', editWalk.status === 400, String(editWalk.status));
  const dupCode = await api('POST', '/customers', { code: '000', name: 'مشتری با کد رزرو' }, token);
  check('کد «۰۰۰» برای گذری رزرو است', dupCode.status === 400, String(dupCode.status));

  /* ---------------- «چه کسی حذف کرد» در سطل بازیافت ---------------- */
  /*
   * باگ: `deletedBy` همیشه `system` بود، چون هیچ کنترلری نام کاربر را به
   * لایه‌ی حذف نرم نمی‌داد. ستون «حذف توسط» در سطل بازیافت همیشه خالی/سیستمی.
   */
  const delSale = await api('DELETE', `/sales/${row.id}`, undefined, token);
  check('حذف بل فروش از برنامه', delSale.status === 200 || delSale.status === 201, String(delSale.status));
  const saleBin = await api('GET', '/recycle/Sale', undefined, token);
  const removed = (saleBin.body?.rows || []).find((r) => Number(r.id) === Number(row.id));
  check('بل حذف‌شده در سطل بازیافت است', Boolean(removed));
  check('نام کسی که حذف کرد ثبت شده (نه system)', removed?.deletedBy === 'admin', String(removed?.deletedBy));
  await api('POST', `/recycle/Sale/${row.id}/restore`, {}, token);

  /* ================================================================ */
  console.log('\n— داده‌ی نمونه: نصب موقت —');

  const before = await api('GET', '/system/demo', undefined, token);
  check('وضعیت اولیه: نمونه نصب نیست', before.body?.installed === false, JSON.stringify(before.body?.counts));

  const install = await api('POST', '/system/demo/install', { months: 1, force: true }, token);
  check('نصب داده‌ی نمونه موفق', install.status === 200 || install.status === 201,
    `${install.status} ${JSON.stringify(install.body).slice(0, 140)}`);
  check('شمرده می‌شود چند ردیف نصب شد', Number(install.body?.total) > 50, String(install.body?.total));

  const afterInstall = await api('GET', '/system/demo', undefined, token);
  check('وضعیت: نمونه نصب است', afterInstall.body?.installed === true);
  check('فروشات نمونه شمرده می‌شود', Number(afterInstall.body?.counts?.Sale) > 10, String(afterInstall.body?.counts?.Sale));
  check('همه‌ی جدول‌های نمونه پر شدند',
    ['Employee', 'Customer', 'Sale', 'Receipt', 'Expense', 'Salary', 'Attendance']
      .every((t) => Number(afterInstall.body?.counts?.[t]) > 0),
    JSON.stringify(afterInstall.body?.counts));

  /* داده‌ی نمونه در گزارش‌ها دیده می‌شود (هدف تمرین) */
  const daily = await api('GET', `/reports/daily?from=${addDays(todayISO(), -3)}&to=${todayISO()}`, undefined, token);
  check('راپور روزانه داده‌ی نمونه را نشان می‌دهد (برای تمرین)',
    Number(daily.body?.totals?.creditSales || 0) + Number(daily.body?.totals?.cashSales || 0) > 0,
    JSON.stringify(daily.body?.totals));

  const twice = await api('POST', '/system/demo/install', { months: 1, force: true }, token);
  check('نصب دوباره رد می‌شود (اسناد تکراری ساخته نشود)', twice.status === 400, String(twice.status));

  /* ================================================================ */
  console.log('\n— داده‌ی نمونه: حذف موقت (نرم) —');

  const remove = await api('POST', '/system/demo/remove', {}, token);
  check('حذف داده‌ی نمونه', remove.status === 200 || remove.status === 201, String(remove.status));
  check('همان تعداد به سطل بازیافت رفت', Number(remove.body?.total) > 50, String(remove.body?.total));

  const afterRemove = await api('GET', '/system/demo', undefined, token);
  check('بعد از حذف، نمونه‌ای نمانده', Number(afterRemove.body?.counts?.total) === 0,
    JSON.stringify(afterRemove.body?.counts));

  const daily2 = await api('GET', `/reports/daily?from=${addDays(todayISO(), -3)}&to=${todayISO()}`, undefined, token);
  /*
   * فقط داده‌ی نمونه باید برود؛ بلِ واقعیِ گذری (۳۰۰ افغانی) و رسیدِ ۵۰۰
   * باید سر جایشان بمانند — این دقیقاً همان چیزی است که تفکیک `isDemo`
   * تضمین می‌کند.
   */
  check('داده‌ی نمونه از راپور بیرون رفت و فقط داده‌ی واقعی ماند',
    Number(daily2.body?.totals?.cashSales || 0) === 300 && Number(daily2.body?.totals?.creditSales || 0) === 0,
    JSON.stringify(daily2.body?.totals));

  /* داده‌ی واقعی (بل گذری که خودمان ثبت کردیم) باید سر جایش باشد */
  const listAfter = await api('GET', '/sales?q=' + encodeURIComponent(String(sale.body?.no || '')), undefined, token);
  check('بلِ واقعی (گذری) بعد از حذف نمونه سالم است', (listAfter.body?.rows || []).length === 1,
    String((listAfter.body?.rows || []).length));

  const bins = await api('GET', '/recycle/bins', undefined, token);
  check('سطل بازیافت حالا ردیف‌های نمونه را دارد', Number(bins.body?.total) > 50, String(bins.body?.total));
  check('همه‌ی بخش‌ها در خروجی سطل بازیافت‌اند',
    ['Sale', 'Customer', 'Employee', 'Salary', 'Attendance'].every((t) => t in (bins.body?.bins || {})),
    Object.keys(bins.body?.bins || {}).join(','));
  check('ردیف حذف‌شده می‌گوید چه کسی حذف کرد',
    (bins.body?.bins?.Sale?.[0]?.deletedBy || '').length > 0, String(bins.body?.bins?.Sale?.[0]?.deletedBy));

  /* ================================================================ */
  console.log('\n— سابقه‌ی فعالیت ادغام‌شده —');

  /* ستون زمانی فقط ۴۰۰ رویداد آخر را می‌آورد؛ نصب اول ممکن است بیرون بیفتد */
  const tlAll = await api('GET', '/system/timeline?limit=1000', undefined, token);
  check('رویداد «نصب داده نمونه» در سابقه هست',
    (tlAll.body || []).some((r) => r.action === 'demo-install'), String((tlAll.body || []).length));
  const tl = await api('GET', '/system/timeline?limit=400', undefined, token);
  check('ستون زمانی برمی‌گردد', Array.isArray(tl.body) && tl.body.length > 0, String(tl.body?.length));
  check('رویداد «حذف داده نمونه» در سابقه هست',
    (tl.body || []).some((r) => r.action === 'demo-remove'));
  const restorable = (tl.body || []).filter((r) => r.restorable);
  check('حذف‌های داخل سطل بازیافت «قابل بازگرداندن» علامت خورده‌اند', restorable.length > 0, String(restorable.length));
  check('عنوان خوانا برای ردیف حذف‌شده دارد', restorable.some((r) => String(r.rowTitle || '').length > 0),
    JSON.stringify(restorable.slice(0, 2)));
  check('برچسب فارسی بخش دارد', restorable.every((r) => !['Sale', 'Customer'].includes(r.entityLabel)),
    JSON.stringify(restorable.slice(0, 2).map((r) => r.entityLabel)));

  /* بازگرداندن از داخل همان ستون زمانی */
  const first = restorable[0];
  const back = await api('POST', `/recycle/${first.entity}/${first.entityId}/restore`, {}, token);
  check('بازگرداندن از سابقه فعالیت کار می‌کند', back.status === 200 || back.status === 201, String(back.status));
  const tl2 = await api('GET', '/system/timeline?limit=400', undefined, token);
  const stillRestorable = (tl2.body || []).some((r) => r.restorable && r.entity === first.entity && Number(r.entityId) === Number(first.entityId));
  check('بعد از بازگرداندن، دیگر «قابل بازگرداندن» نیست', !stillRestorable);

  const filtered = await api('GET', '/system/timeline?entity=Sale', undefined, token);
  check('فیلتر بخش در ستون زمانی کار می‌کند',
    (filtered.body || []).every((r) => r.entity === 'Sale'), JSON.stringify((filtered.body || []).map((r) => r.entity).slice(0, 4)));

  try { child.kill(); } catch { /* */ }
  finish();
})().catch((e) => { console.error('\n⛔ خطای غیرمنتظره:', e); finish(1); });

function finish(code = 0) {
  console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  console.log('');
  process.exit(failed === 0 && code === 0 ? 0 : 1);
}
