/**
 * تست دور ۱۶ — «هیچ‌چیز نشکسته، و آنچه باید کار کند، واقعاً کار می‌کند».
 *
 *   npm run test:round16
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) **CSV**: نوشتن/خواندن با کاراکترهای واقعی فارسی، فیلد چندخطی،
 *      گیومه‌ی داخلی، جداکننده‌ی `;` و tab، خط `sep=`، BOM، و رقم‌های فارسی.
 *   ۲) **خروجی اکسل**: فایل `.xls` معتبر (HTML workbook) با RTL و فرار HTML —
 *      نه اینکه «یک فایل بفرستیم و امیدوار باشیم».
 *   ۳) **خروجی/ورودی روی سرور واقعی**: `/api/export` (که قبلاً ۴۰۴ می‌داد)
 *      و `/api/import/*` با dry-run و ثبت واقعی.
 *   ۴) **حذف نرم**: ردیف حذف‌شده از فهرست و جمع‌ها بیرون می‌رود ولی در
 *      «سطل بازیافت» هست و با `restore` کامل برمی‌گردد.
 *   ۵) **تمدید لایسنس**: درخواست تمدید ساخته می‌شود، ابزار می‌تواند بخواندش،
 *      و مهم‌تر: فایل لایسنس از طریق `activate-file` فعال می‌شود.
 *   ۶) **محاسبات**: مجموع بل = متراژ×قیمت + متراژ×کرایه (یک منبع حقیقت).
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const PORT = 4467;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-r16-'));

let passed = 0;
let failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
}

/* ---------- ماژول‌های واقعی از بسته‌ی ساخته‌شده ---------- */
const dist = path.join(root, 'apps/api/dist');
let csv;
try {
  csv = require(path.join(dist, 'common/csv.js'));
} catch (e) {
  console.error('\n⛔ بسته‌ی API ساخته نشده. اول: npm run build -w @farday/api\n');
  process.exit(1);
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function makeLicense({ privateKey, payload }) {
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.sign(null, Buffer.from(body, 'utf8'), privateKey));
  return `-----BEGIN FARDAY LICENSE-----\nFR-1\n${body}\n${sig}\n-----END FARDAY LICENSE-----`;
}

(async () => {
  /* ================================================================ */
  console.log('\n— CSV: نوشتن و خواندن —');

  const rows = [
    ['احمد «کریمی»', 'کابل، سرک ۱', '1250.5'],
    ['شرکت الف; ب', 'متن با\nخط دوم', '0'],
    ['', 'خالی', '-3'],
  ];
  const headers = ['نام', 'آدرس', 'مبلغ'];
  const written = csv.toCsv(headers, rows, { sepLine: true });

  check('فایل با BOM شروع می‌شود (اکسل فارسی را درست بخواند)', written.charCodeAt(0) === 0xfeff, `0x${written.charCodeAt(0).toString(16)}`);
  check('خط `sep=,` در ابتدا هست', /^\uFEFFsep=,\r\n/.test(written), JSON.stringify(written.slice(0, 20)));
  /*
   * پایان خط: همه‌ی «پایان ردیف»ها باید CRLF باشند. توجه: خانه‌ی چندخطی
   * داخل گیومه می‌تواند `\n` خالص داشته باشد و این درست است — پس فقط
   * بیرون از گیومه‌ها بررسی می‌کنیم.
   */
  const outsideQuotes = written.replace(/"[^"]*(?:""[^"]*)*"/g, '""');
  check('پایان ردیف‌ها CRLF است', written.includes('\r\n') && !/[^\r]\n/.test(outsideQuotes.replace(/^\uFEFF/, '')));

  const back = csv.parseCsv(written);
  check('همان تعداد ردیف داده برگشت', back.rows.length === rows.length + 1, `سرصفحه + ${back.rows.length - 1}`);
  check('نام با گیومه‌ی داخلی سالم ماند', back.rows[1][0] === 'احمد «کریمی»', back.rows[1][0]);
  check('خانه‌ی چندخطی سالم ماند', back.rows[2][1] === 'متن با\nخط دوم', JSON.stringify(back.rows[2][1]));
  check('بدون هشدار ستون‌شماری', back.warnings.length === 0, back.warnings.join(' | '));

  const semi = csv.toCsv(headers, [['الف', 'ب', '1']], { delimiter: ';', sepLine: true });
  check('جداکننده‌ی ; با sep=; اعلام می‌شود', semi.includes('sep=;'));
  check('جداکننده‌ی ; خودکار تشخیص داده می‌شود', csv.guessDelimiter(semi) === ';', csv.guessDelimiter(semi));
  const tabCsv = csv.toCsv(headers, [['الف', 'ب', '1']], { delimiter: '\t', sepLine: true });
  check('جداکننده‌ی tab تشخیص داده می‌شود', csv.guessDelimiter(tabCsv) === '\t', JSON.stringify(csv.guessDelimiter(tabCsv)));

  /* تزریق فرمول */
  const inj = csv.toCsv(['a'], [['=1+1'], ['+cmd'], ['@x']]);
  check('مقدار شروع‌شده با = بی‌خطر می‌شود', /'=1\+1/.test(inj), inj.slice(0, 40));
  check('مقدار شروع‌شده با + بی‌خطر می‌شود', /'\+cmd/.test(inj));
  check('مقدار شروع‌شده با @ بی‌خطر می‌شود', /'@x/.test(inj));

  console.log('\n— CSV: عدد فارسی —');
  check('«۱٬۲۵۰٫۵» → 1250.5', csv.normalizeNumber('۱٬۲۵۰٫۵') === 1250.5, String(csv.normalizeNumber('۱٬۲۵۰٫۵')));
  check('«1,250.50» → 1250.5', csv.normalizeNumber('1,250.50') === 1250.5);
  check('«1.250,50» → 1250.5 (سبک اروپایی)', csv.normalizeNumber('1.250,50') === 1250.5);
  check('«۱۲۳» → 123', csv.normalizeNumber('۱۲۳') === 123);
  check('متن غیرعددی → null', csv.normalizeNumber('abc') === null);
  check('خالی → null', csv.normalizeNumber('') === null);
  check('منفی پذیرفته می‌شود', csv.normalizeNumber('-۴۵') === -45);

  /* ================================================================ */
  console.log('\n— خروجی اکسل (.xls) —');
  const ie = require(path.join(dist, 'modules/importexport.controller.js'));
  check('تابع ساخت کارپوشه صادر شده', typeof ie.toExcelHtml === 'function');
  if (typeof ie.toExcelHtml === 'function') {
    const html = ie.toExcelHtml('فروشات', ['شماره', 'مبلغ'], [['A-1', 1200]], [1]);
    check('XML/Excel workbook namespace دارد', html.includes('urn:schemas-microsoft-com:office:excel'));
    check('راست‌به‌چپ تنظیم شده', html.includes('DisplayRightToLeft'));
    check('کدگذاری UTF-8 در متا اعلام شده', /charset=utf-8/i.test(html));
    check('ستون عددی به عدد قالب‌بندی می‌شود', html.includes('mso-number-format'));
    const evil = ie.toExcelHtml('x', ['a'], [['<script>alert(1)</script>']]);
    check('محتوای HTML فرار داده می‌شود', !evil.includes('<script>alert'), evil.slice(0, 120));
  }

  /* ================================================================ */
  console.log('\n— سرور واقعی: خروجی، ورودی، حذف نرم —');
  const kp = crypto.generateKeyPairSync('ed25519');
  const pub = b64u(kp.publicKey.export({ type: 'spki', format: 'der' }));

  const child = spawn(process.execPath, [path.join(dist, 'main.js')], {
    cwd: root,
    env: {
      ...process.env,
      FD_DATA_DIR: dataDir,
      FD_PORT: String(PORT),
      FD_LICENSE_DEV: '1',
      FD_LICENSE_PUBLIC_KEY: pub,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  const api = async (method, url, body, token = '', raw = false) => {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-auth-token': token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (raw) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, buf, headers: res.headers, text: buf.toString('utf8') };
    }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
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
  if (!up) { child.kill(); return finish(); }

  /* فعال‌سازی لایسنس تا درها باز شود */
  const mk = (await api('GET', '/license/device')).body.machineKey;
  const lic = makeLicense({
    privateKey: kp.privateKey,
    payload: {
      v: 1, id: 'FR-LIC-R16', customer: 'آزمون', kind: 'yearly',
      start: addDays(todayISO(), -1), end: addDays(todayISO(), 200),
      machineKey: mk, seats: 1, note: '', issuedAt: new Date().toISOString(),
    },
  });
  /*
   * نکته: این تست روی «دیتابیس تازه» اجرا می‌شود؛ اگر باگی در فعال‌سازی باشد
   * ادامه‌ی تست بی‌معناست، پس با پیام روشن متوقف می‌شویم (به‌جای ۲۰ ناکامی
   * آبشاری که ریشه را پنهان می‌کند).
   */
  const act = await api('POST', '/license/activate', { text: lic });
  check('فعال‌سازی متن لایسنس', act.status === 200 || act.status === 201,
    `${act.status} ${JSON.stringify(act.body).slice(0, 200)}`);
  if (!(act.status === 200 || act.status === 201)) {
    child.kill();
    console.log('\n⛔ بدون لایسنس معتبر نمی‌توان بقیه را آزمود. لاگ سرور:\n' + log.slice(-800));
    return finish();
  }

  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body?.token || '';
  check('ورود مدیر', Boolean(token));

  /* --- خروجی: همان چیزی که ۴۰۴ می‌داد --- */
  const typesRes = await api('GET', '/export/types', undefined, token);
  check('GET /api/export/types کار می‌کند', typesRes.status === 200, `${typesRes.status} ${JSON.stringify(typesRes.body).slice(0, 800)}`);
  if (typesRes.status !== 200) {
    child.kill();
    console.log('\n⛔ ادامهٔ آزمون ممکن نیست؛ پاسخ فعال‌سازی: ' + JSON.stringify(act.body).slice(0, 800));
    return finish();
  }
  check('هفت نوع خروجی هست', (typesRes.body?.items || []).length >= 7, String((typesRes.body?.items || []).length));

  const csvOut = await api('GET', '/export?type=customers&format=csv', undefined, token, true);
  check('GET /api/export?format=csv → ۲۰۰', csvOut.status === 200, String(csvOut.status));
  check('CSV سرصفحه‌ی صحیح دارد', /text\/csv/.test(csvOut.headers.get('content-type') || ''));
  check('نام فایل با UTF-8 در هدر می‌آید', /filename\*=UTF-8''/.test(csvOut.headers.get('content-disposition') || ''));
  check('BOM در خروجی هست', csvOut.buf[0] === 0xef && csvOut.buf[1] === 0xbb && csvOut.buf[2] === 0xbf);

  const xlsOut = await api('GET', '/export?type=customers&format=xls', undefined, token, true);
  check('GET /api/export?format=xls → ۲۰۰', xlsOut.status === 200, String(xlsOut.status));
  check('نوع MIME اکسل است', /vnd\.ms-excel/.test(xlsOut.headers.get('content-type') || ''));
  check('پسوند .xls در نام فایل', /\.xls/.test(xlsOut.headers.get('content-disposition') || ''));

  /* --- ورودی: فایل نمونه و dry-run --- */
  const tpl = await api('GET', '/import/template?type=customers&format=csv', undefined, token, true);
  check('فایل نمونه‌ی مشتریان دانلود می‌شود', tpl.status === 200, String(tpl.status));
  check('فایل نمونه سرصفحه دارد', /نام/.test(tpl.text));

  const importTypes = await api('GET', '/import/types', undefined, token);
  check('GET /api/import/types کار می‌کند', importTypes.status === 200, String(importTypes.status));
  const customersCfg = (importTypes.body?.items || []).find((x) => x.key === 'customers');
  check('ورود مشتریان فعال است', customersCfg?.enabled === true);
  const salesCfg = (importTypes.body?.items || []).find((x) => x.key === 'sales');
  check('ورود فروشات عمداً غیرفعال است', salesCfg?.enabled === false, String(salesCfg?.enabled));
  check('دلیل غیرفعال‌بودن توضیح داده شده', Boolean((salesCfg?.reason || '').length > 10));

  const sampleCsv = csv.toCsv(
    customersCfg.headers,
    [['مشتری آزمون یک', 'احمد', '0700000001', 'KBL-123', '۱٬۵۰۰', 'یادداشت']],
    { sepLine: true },
  );
  const dry = await api('POST', '/import/customers', { csv: sampleCsv, dryRun: true }, token);
  check('dry-run → ۲۰۰', dry.status === 200 || dry.status === 201, `${dry.status} ${JSON.stringify(dry.body).slice(0, 120)}`);
  check('dry-run می‌گوید هنوز ذخیره نشده', dry.body?.dryRun === true);
  check('dry-run یک سطر سالم می‌شمارد', dry.body?.valid === 1, String(dry.body?.valid));

  const before = await api('GET', '/customers?q=مشتری آزمون یک', undefined, token);
  check('dry-run چیزی ذخیره نکرد', (before.body?.length ?? 0) === 0, String(before.body?.length));

  const real = await api('POST', '/import/customers', { csv: sampleCsv, dryRun: false }, token);
  check('ثبت واقعی → ۲۰۰', real.status === 200 || real.status === 201, `${real.status} ${JSON.stringify(real.body).slice(0, 160)}`);
  const after = await api('GET', '/customers?q=مشتری آزمون یک', undefined, token);
  check('مشتری ثبت شد', (after.body?.length ?? 0) === 1, String(after.body?.length));
  const importedCustomer = (after.body || [])[0];
  check('عدد فارسی «۱٬۵۰۰» درست ذخیره شد', Number(importedCustomer?.openingBalance) === 1500, String(importedCustomer?.openingBalance));
  check('کد خودکار داده شد', Boolean(importedCustomer?.code), String(importedCustomer?.code));

  const dupRun = await api('POST', '/import/customers', { csv: sampleCsv, dryRun: true }, token);
  check('تکراری بودن با دیتابیس گزارش می‌شود', (dupRun.body?.duplicates || []).length >= 1, JSON.stringify(dupRun.body?.duplicates));

  const badCsv = csv.toCsv(customersCfg.headers, [['', 'بی‌نام']]);
  const bad = await api('POST', '/import/customers', { csv: badCsv, dryRun: true }, token);
  check('سطر بدون نام خطا می‌دهد', (bad.body?.errors || []).length >= 1, JSON.stringify(bad.body?.errors));

  /* --- حذف نرم --- */
  if (!importedCustomer) {
    child.kill();
    console.log('\n⛔ مشتری وارد‌شده پیدا نشد؛ تست حذف نرم ممکن نیست.');
    return finish();
  }
  const custId = importedCustomer.id;
  const delRes = await api('DELETE', `/customers/${custId}`, undefined, token);
  check('حذف مشتری → ۲۰۰', delRes.status === 200, `${delRes.status} ${JSON.stringify(delRes.body).slice(0, 120)}`);
  check('پاسخ می‌گوید حذف نرم است', delRes.body?.softDeleted === true);

  const gone = await api('GET', '/customers?q=مشتری آزمون یک', undefined, token);
  check('حذف‌شده از فهرست بیرون رفت', (gone.body?.length ?? 0) === 0, String(gone.body?.length));

  const recycle = await api('GET', '/recycle', undefined, token);
  check('سطل بازیافت در دسترس است', recycle.status === 200, String(recycle.status));
  const custBucket = (recycle.body?.items || []).find((x) => x.table === 'Customer');
  check('سطل بازیافت یک مشتری حذف‌شده می‌شمارد', custBucket?.count === 1, String(custBucket?.count));

  const listDel = await api('GET', '/recycle/Customer', undefined, token);
  check('ردیف حذف‌شده در سطل دیده می‌شود', (listDel.body?.rows || []).length === 1);
  check('نام حذف‌کننده ثبت شده', Boolean((listDel.body?.rows || [])[0]?.deletedBy), String((listDel.body?.rows || [])[0]?.deletedBy));

  const restored = await api('POST', `/recycle/Customer/${custId}/restore`, {}, token);
  check('بازگرداندن → ۲۰۰', restored.status === 200 || restored.status === 201, String(restored.status));
  const backAgain = await api('GET', '/customers?q=مشتری آزمون یک', undefined, token);
  check('مشتری کامل برگشت', (backAgain.body?.length ?? 0) === 1, String(backAgain.body?.length));
  check('همان شناسه و همان داده', (backAgain.body || [])[0]?.id === custId && Number((backAgain.body || [])[0]?.openingBalance) === 1500);

  /* --- محاسبه‌ی بل فروش: یک منبع حقیقت --- */
  const sale = await api('POST', '/sales', {
    customerId: custId, date: todayISO(), volume: 10, unitPrice: 100, freightPerUnit: 5,
    materialName: 'ریگ', paymentType: 'cash', /* کلاینت عدد غلط می‌فرستد */
    freightTotal: 999999, total: 999999,
  }, token);
  check('بل فروش ثبت شد', sale.status === 200 || sale.status === 201, `${sale.status} ${JSON.stringify(sale.body).slice(0, 200)}`);
  check('مجموع کرایه = متراژ × کرایه (نه عدد کلاینت)', Number(sale.body?.freightTotal) === 50, String(sale.body?.freightTotal));
  check('مجموع بل = متراژ×قیمت + کرایه', Number(sale.body?.total) === 1050, String(sale.body?.total));

  const badSale = await api('POST', '/sales', { customerId: custId, date: todayISO(), volume: 0, unitPrice: 100, freightPerUnit: 5 }, token);
  check('متراژ صفر رد می‌شود', badSale.status >= 400, String(badSale.status));

  /* --- گزارش‌ها نباید بل حذف‌شده را بشمارند --- */
  /* گزارش روزانه فهرست روزهاست؛ جمع همه‌ی روزها را می‌سنجیم */
  const sumRows = (b) => (Array.isArray(b?.rows) ? b.rows : []).reduce((a, r) => a + Number(r.allSales || 0), 0);
  const dailyBefore = await api('GET', '/reports/daily', undefined, token);
  /*
   * `POST /sales` شناسه برنمی‌گرداند (فقط شماره سند و جمع). شناسه را از
   * فهرست می‌گیریم — همان کاری که UI می‌کند.
   */
  const saleList = await api('GET', `/sales?q=${encodeURIComponent(sale.body.no)}`, undefined, token);
  const saleId = (saleList.body?.rows || saleList.body || [])[0]?.id;
  const delSale = await api('DELETE', `/sales/${saleId}`, undefined, token);
  check('حذف بل فروش → ۲۰۰', delSale.status === 200, `${delSale.status} ${JSON.stringify(delSale.body).slice(0, 120)}`);
  const dailyAfter = await api('GET', '/reports/daily', undefined, token);
  const sumBefore = sumRows(dailyBefore.body);
  const sumAfter = sumRows(dailyAfter.body);
  check('بل ثبت شد و در گزارش دیده می‌شود', sumBefore >= 1050, String(sumBefore));
  check('حذف نرم، جمع گزارش را کاهش می‌دهد', sumAfter < sumBefore, `${sumBefore} → ${sumAfter}`);

  /* --- تمدید لایسنس --- */
  const rr = await api('POST', '/license/renew-request', { days: 365, note: 'آزمون' });
  check('درخواست تمدید ساخته می‌شود', rr.status === 200 || rr.status === 201, String(rr.status));
  check('متن درخواست قالب درست دارد', /BEGIN FARDAY RENEW REQUEST/.test(rr.body?.text || ''));
  /*
   * متن درخواست base64 است، پس نباید کلید خام را در آن بجوییم؛ باید
   * رمزگشایی کنیم — همان کاری که ابزار لایسنس می‌کند.
   */
  const reqB64 = String(rr.body?.text || '').split('\n').find((l) => l && !/^-{3,}|^SUM:/.test(l)) || '';
  let reqObj = {};
  try { reqObj = JSON.parse(Buffer.from(reqB64, 'base64url').toString('utf8')); } catch { reqObj = {}; }
  check('کلید دستگاه در درخواست تمدید هست', reqObj.machineKey === mk, String(reqObj.machineKey));
  check('شناسه‌ی لایسنس فعلی در درخواست هست', reqObj.currentLicenseId === 'FR-LIC-R16', String(reqObj.currentLicenseId));
  check('تعداد روز درخواست درست است', Number(reqObj.requestedDays) === 365, String(reqObj.requestedDays));

  const badFile = await api('POST', '/license/activate-file', { filename: 'x.lic', content: 'not a license' });
  check('فایل غیرلایسنس رد می‌شود', badFile.status === 400, String(badFile.status));
  check('پیام خطای فایل روشن است', /BEGIN FARDAY LICENSE/.test(String(badFile.body?.message || '')), String(badFile.body?.message).slice(0, 80));

  const goodFile = await api('POST', '/license/activate-file', { filename: 'r.lic', content: lic });
  check('فایل لایسنس معتبر از مسیر فایل فعال می‌شود', goodFile.status === 200 || goodFile.status === 201, `${goodFile.status} ${JSON.stringify(goodFile.body).slice(0, 160)}`);

  child.kill();
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
