/**
 * تست دور ۱۷ — «بیانیه» یک مفهوم، «مربوط» شاخه‌ی مصرف، و مانده‌ی مشتری.
 *
 *   npm run test:round17
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) **ادغام «بیانیه» و «پیش‌پرداخت»**: فقط «بیانیه» می‌ماند، ولی سند
 *      قدیمی با نام «پیش پرداخت»/«بیانه» هم معتبر است و مانده‌اش عوض نمی‌شود.
 *   ۲) **مانده‌ی مشتری**: تصمیم «از بدهی کم می‌شود یا نه» از یک جای واحد
 *      (`common/domain`) می‌آید و با رفتار تاریخی می‌خواند (فقط «امانت»
 *      کم نمی‌کند) — یعنی هیچ مانده‌ای با این تغییر جابه‌جا نمی‌شود.
 *   ۳) **«مربوط» به‌عنوان شاخه‌ی مصرف**: در فروش، مصرف و رسید همان شاخه
 *      است و در راپور «مربوط» یک‌جا دیده می‌شود.
 *   ۴) **مهاجرت داده**: دیتابیس قدیمی با `sourceName='پیش پرداخت'` بعد از
 *      باز شدن برنامه، نام رسمی می‌گیرد و فهرست کشویی تکراری نمی‌ماند.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const PORT = 4469;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-r17-'));

let passed = 0;
let failed = 0;
const problems = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
}

const dist = path.join(root, 'apps/api/dist');
let domain;
try {
  domain = require(path.join(dist, 'common/domain.js'));
} catch (e) {
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
  /* ================================================================ */
  console.log('\n— یک مفهوم: بیانیه (نه پیش‌پرداخت) —');

  const names = domain.RECEIPT_SOURCE_NAMES;
  check('«بیانیه» در منابع رسمی هست', names.includes('بیانیه'));
  check('«پیش پرداخت» از منابع رسمی حذف شد', !names.includes('پیش پرداخت'));
  check('«پیش‌پرداخت» از منابع رسمی حذف شد', !names.includes('پیش‌پرداخت'));
  check('«بیانه» هم به‌عنوان منبع رسمی نیست', !names.includes('بیانه'));
  check('«مربوط» در منابع رسمی هست', names.includes('مربوط'));
  check('چهار منبع رسمی مانده', names.length === 4, String(names.length));

  check('«پیش پرداخت» → «بیانیه»', domain.canonicalReceiptSource('پیش پرداخت') === 'بیانیه');
  check('«پیش‌پرداخت» → «بیانیه»', domain.canonicalReceiptSource('پیش‌پرداخت') === 'بیانیه');
  check('«بیانه» → «بیانیه»', domain.canonicalReceiptSource('بیانه') === 'بیانیه');
  check('« بیانیه » با فاصله → «بیانیه»', domain.canonicalReceiptSource('  بیانیه ') === 'بیانیه');
  check('«شاخه مربوط» → «مربوط»', domain.canonicalReceiptSource('شاخه مربوط') === 'مربوط');
  check('نام ناشناخته دست‌نخورده می‌ماند', domain.canonicalReceiptSource('بانک') === 'بانک');
  check('رشته‌ی خالی → خالی', domain.canonicalReceiptSource('') === '');
  check('undefined → خالی', domain.canonicalReceiptSource(undefined) === '');

  /* ================================================================ */
  console.log('\n— تخصیص پول و مانده‌ی مشتری (هیچ مانده‌ای نباید جابه‌جا شود) —');

  check('«باقی داری» بدهی را کم می‌کند', domain.reducesCustomerDebt(null, 'باقی داری') === true);
  check('«امانت» بدهی را کم نمی‌کند', domain.reducesCustomerDebt(null, 'امانت') === false);
  /* رفتار تاریخی: هر چیزی جز امانت کم می‌کرد — این تغییر نباید عوضش کند */
  check('«بیانیه» مثل قبل بدهی را کم می‌کند', domain.reducesCustomerDebt(null, 'بیانیه') === true);
  check('«پیش پرداخت» (داده‌ی قدیمی) همان اثر «بیانیه» را دارد', domain.reducesCustomerDebt(null, 'پیش پرداخت') === true);
  check('«مربوط» بدهی را کم می‌کند', domain.reducesCustomerDebt(null, 'مربوط') === true);
  check('منبع ناشناخته = رفتار قبلی (کم می‌کند)', domain.reducesCustomerDebt(null, 'بانک') === true);
  check('allocation «deposit» کافی است حتی بی‌نام منبع', domain.reducesCustomerDebt('deposit', '') === false);
  check('allocation «credit» کافی است', domain.reducesCustomerDebt('credit', '') === true);

  const sqlAmanat = domain.receiptDebtSql('r."sourceName"');
  check('شرط SQL فقط «امانت» را بیرون می‌گذارد', /NOT IN \('امانت'\)/.test(sqlAmanat), sqlAmanat);
  check('شرط SQL مخالفِ null/خالی هم کار می‌کند (COALESCE)', /COALESCE\(r\."sourceName",''\)/.test(sqlAmanat), sqlAmanat);
  check('شرط SQL می‌تواند نام فیلد «امانت» را عوض کند', !/بیانیه/.test(sqlAmanat));

  /* ================================================================ */
  console.log('\n— «مربوط» = شاخه‌ی مصرف —');

  check('برچسب کوتاه «مربوط»', domain.RELATED_SHORT === 'مربوط');
  check('برچسب کامل شامل «شاخه مصرف»', /شاخه مصرف/.test(domain.RELATED_LABEL), domain.RELATED_LABEL);
  check('انواع شاخه: باربری و دمترک هست', domain.RELATED_KINDS.includes('باربری') && domain.RELATED_KINDS.includes('دمترک'));
  check('هر چهار تخصیص برچسب فارسی دارند', ['credit', 'advance', 'deposit', 'related'].every((k) => Boolean(domain.ALLOCATION_LABELS[k])));

  const variants = domain.receiptSourceVariants('بیانیه');
  check('فیلتر «بیانیه» نام‌های قدیمی را هم می‌گیرد', variants.includes('پیش پرداخت') && variants.includes('بیانه'), variants.join('|'));
  check('فیلتر «بیانیه» تکراری ندارد', variants.length === new Set(variants).size);

  /* ================================================================ */
  console.log('\n— مهاجرت داده: دیتابیس قدیمی —');

  /*
   * دیتابیس «قدیمی»: ساختار امروز را می‌سازیم، بعد چند سند را دستی به نام
   * قدیمی («پیش پرداخت»/«بیانه») برمی‌گردانیم و مهر نسخه را به ۳ می‌بریم —
   * یعنی همان حالتی که کاربر بعد از آپدیت برنامه دارد. سپس مهاجرت را اجرا
   * می‌کنیم و می‌بینیم داده سالم و یکسان می‌شود.
   */
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-r17-old-'));
  const oldDbFile = path.join(oldDir, 'farday.db');
  process.env.FD_DATA_DIR = oldDir;
  process.env.FD_DB_FILE = oldDbFile;
  const { ensureSchemaAsync, migrateReceiptSources } = require(path.join(dist, 'schema.js'));
  const { db } = require(path.join(dist, 'db.js'));
  await ensureSchemaAsync();
  const odb = db();
  await odb.$executeRawUnsafe(`INSERT INTO "Customer" ("code","name","openingBalance") VALUES ('OLD-1','مشتری قدیمی',0)`);
  const oldCust = (await odb.$queryRawUnsafe(`SELECT "id" FROM "Customer" WHERE "code"='OLD-1'`))[0].id;
  for (const [no, amount, src] of [['R-OLD-1', 100, 'پیش پرداخت'], ['R-OLD-2', 50, 'بیانه'], ['R-OLD-3', 25, 'امانت'], ['R-OLD-4', 10, 'باقی داری']]) {
    await odb.$executeRawUnsafe(
      `INSERT INTO "Receipt" ("no","date","customerId","customerName","amount","sourceName") VALUES (?,?,?,?,?,?)`,
      no, todayISO(), oldCust, 'مشتری قدیمی', amount, src,
    );
  }
  for (const nm of ['انتقال بانکی', 'چک', 'بیانیه']) {
    await odb.$executeRawUnsafe(`INSERT INTO "LookupItem" ("type","name","sortOrder","active") VALUES ('receipt_source',?,1,1)`, nm);
  }
  await odb.$executeRawUnsafe('PRAGMA user_version = 3');

  await migrateReceiptSources();

  const recRows = await odb.$queryRawUnsafe(`SELECT "no","sourceName" FROM "Receipt" WHERE "no" LIKE 'R-OLD-%' ORDER BY "no"`);
  const byNo = Object.fromEntries(recRows.map((r) => [r.no, r.sourceName]));
  check('مهاجرت: «پیش پرداخت» → «بیانیه»', byNo['R-OLD-1'] === 'بیانیه', String(byNo['R-OLD-1']));
  check('مهاجرت: «بیانه» → «بیانیه»', byNo['R-OLD-2'] === 'بیانیه', String(byNo['R-OLD-2']));
  check('مهاجرت: «امانت» دست‌نخورده', byNo['R-OLD-3'] === 'امانت', String(byNo['R-OLD-3']));
  check('مهاجرت: «باقی داری» دست‌نخورده', byNo['R-OLD-4'] === 'باقی داری', String(byNo['R-OLD-4']));
  check('مهاجرت: هیچ سندی حذف نشد', recRows.length === 4, String(recRows.length));
  check('مهاجرت: مبلغ‌ها دست‌نخورده', Number((await odb.$queryRawUnsafe(`SELECT COALESCE(SUM("amount"),0) s FROM "Receipt" WHERE "no" LIKE 'R-OLD-%'`))[0].s) === 185);

  const oldSrcs = await odb.$queryRawUnsafe(`SELECT "name","active" FROM "LookupItem" WHERE "type"='receipt_source'`);
  const activeOld = oldSrcs.filter((x) => x.active).map((x) => x.name);
  /* منبع سفارشی کاربر (نه نام قدیمی) نباید از فهرست غیب شود */
  check('مهاجرت: منبع سفارشی «چک» فعال می‌ماند', activeOld.includes('چک'), activeOld.join('|'));
  check('مهاجرت: منبع سفارشی «انتقال بانکی» فعال می‌ماند', activeOld.includes('انتقال بانکی'), activeOld.join('|'));
  check('مهاجرت: «بیانیه» در فهرست فعال هست', activeOld.includes('بیانیه'), activeOld.join('|'));
  check('مهاجرت: «مربوط» به فهرست اضافه شد', activeOld.includes('مربوط'), activeOld.join('|'));
  check('مهاجرت: هیچ ردیف فهرستی حذف نشد (فقط غیرفعال)', oldSrcs.length === 7, String(oldSrcs.length));
  check('مهاجرت: ردیف غیرفعال باقی مانده', oldSrcs.some((x) => !x.active));
  try { await db().$disconnect(); } catch { /* */ }

  /* از این‌جا سرور واقعی روی یک پوشه‌ی تازه بالا می‌آید */
  delete process.env.FD_DB_FILE;
  process.env.FD_DATA_DIR = dataDir;

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
      v: 1, id: 'FR-LIC-R17', customer: 'آزمون', kind: 'yearly',
      start: addDays(todayISO(), -1), end: addDays(todayISO(), 200),
      machineKey: mk, seats: 1, note: '', issuedAt: new Date().toISOString(),
    },
  });
  const act = await api('POST', '/license/activate', { text: lic });
  check('فعال‌سازی لایسنس', act.status === 200 || act.status === 201, `${act.status} ${JSON.stringify(act.body).slice(0, 160)}`);
  if (!(act.status === 200 || act.status === 201)) {
    try { child.kill(); } catch { /* */ }
    console.log('\n⛔ بدون لایسنس نمی‌توان ادامه داد:\n' + log.slice(-800));
    return finish(1);
  }

  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body?.token || '';
  check('ورود مدیر', Boolean(token));

  /* --- فهرست منابع رسید: فقط بیانیه، و «مربوط» موجود --- */
  const lk = await api('GET', '/lookups', undefined, token);
  const srcList = (lk.body?.items?.receipt_source || []).map((x) => x.name);
  check('فهرست «از درک» شامل بیانیه است', srcList.includes('بیانیه'), srcList.join('|'));
  check('فهرست «از درک» شامل مربوط است', srcList.includes('مربوط'), srcList.join('|'));
  check('فهرست «از درک» «پیش پرداخت» ندارد', !srcList.includes('پیش پرداخت'), srcList.join('|'));

  /* --- مشتری و سه رسید با نام‌های مختلف «بیانیه» --- */
  const cust = await api('POST', '/customers', { name: 'مشتری آزمون ۱۷', code: 'T17' }, token);
  check('ساخت مشتری تست', cust.status === 200 || cust.status === 201, `${cust.status} ${JSON.stringify(cust.body).slice(0, 120)}`);
  const custList = await api('GET', '/customers?q=T17', undefined, token);
  const cid = (custList.body || [])[0]?.id;
  check('مشتری در فهرست پیدا شد', Boolean(cid));

  const r1 = await api('POST', '/receipts', { customerId: cid, amount: 1000, sourceName: 'پیش پرداخت' }, token);
  const r2 = await api('POST', '/receipts', { customerId: cid, amount: 500, sourceName: 'بیانه' }, token);
  const r3 = await api('POST', '/receipts', { customerId: cid, amount: 200, sourceName: 'امانت' }, token);
  const r4 = await api('POST', '/receipts', { customerId: cid, amount: 300, sourceName: 'مربوط' }, token);
  check('ثبت رسید با نام قدیمی «پیش پرداخت»', r1.status === 200 || r1.status === 201, `${r1.status}`);
  check('ثبت رسید با نام قدیمی «بیانه»', r2.status === 200 || r2.status === 201, `${r2.status}`);
  check('ثبت رسید «امانت»', r3.status === 200 || r3.status === 201, `${r3.status}`);
  check('ثبت رسید «مربوط»', r4.status === 200 || r4.status === 201, `${r4.status}`);

  const rec = await api('GET', `/receipts?customerId=${cid}&pageSize=50`, undefined, token);
  const byAmount = {};
  for (const r of rec.body?.rows || []) byAmount[Number(r.amount)] = r;
  check('رسید «پیش پرداخت» با نام رسمی «بیانیه» ذخیره شد', byAmount[1000]?.sourceName === 'بیانیه', String(byAmount[1000]?.sourceName));
  check('رسید «بیانه» هم «بیانیه» شد', byAmount[500]?.sourceName === 'بیانیه', String(byAmount[500]?.sourceName));
  check('رسید بیانیه پرچم کاهش بدهی دارد', byAmount[1000]?.reducesDebt === true, String(byAmount[1000]?.reducesDebt));
  check('رسید «امانت» پرچم کاهش بدهی ندارد', byAmount[200]?.reducesDebt === false, String(byAmount[200]?.reducesDebt));
  check('رسید «مربوط» تخصیص related دارد', byAmount[300]?.allocation === 'related', String(byAmount[300]?.allocation));

  /* --- فیلتر «از درک»: بیانیه باید هر دو سند را بیاورد --- */
  const filt = await api('GET', `/receipts?source=${encodeURIComponent('بیانیه')}&pageSize=50`, undefined, token);
  const filtSources = (filt.body?.rows || []).map((r) => r.sourceName);
  check('فیلتر «بیانیه» رسیدهای قدیمی را هم می‌گیرد', filtSources.filter((s) => s === 'بیانیه').length >= 2, filtSources.join('|'));

  /* --- مانده‌ی مشتری: 1000+500+300 = 1800 کم می‌شود، امانت نه --- */
  const again = await api('GET', '/customers?q=T17', undefined, token);
  const row = (again.body || [])[0] || {};
  check('مانده‌ی مشتری فقط با رسیدهای کاهنده حساب شد', Number(row.receipts) === 1800, String(row.receipts));
  check('مانده‌ی مشتری منفی ۱۸۰۰ شد', Number(row.balance) === -1800, String(row.balance));

  /* --- کارت حساب: مبلغ امانت در ستون بستانکار صفر --- */
  const st = await api('GET', `/customers/${cid}/statement`, undefined, token);
  const stAmanat = (st.body?.rows || []).find((r) => Number(r.amount) === 200);
  const stBayanie = (st.body?.rows || []).find((r) => Number(r.amount) === 1000);
  check('کارت حساب: امانت بستانکار صفر', Number(stAmanat?.credit) === 0, String(stAmanat?.credit));
  check('کارت حساب: بیانیه بستانکار کامل', Number(stBayanie?.credit) === 1000, String(stBayanie?.credit));
  check('کارت حساب: نوع رسید با نام رسمی', /بیانیه/.test(String(stBayanie?.type)), String(stBayanie?.type));

  /* ================================================================ */
  console.log('\n— «مربوط» در فروش، مصرف و راپور —');

  /* شاخه (مربوط) را از فهرست می‌سازیم */
  const branch = await api('POST', '/lookups', { type: 'contractor', name: 'باربری آزمون ۱۷', extra: 'باربری' }, token);
  check('ساخت شاخه‌ی «مربوط»', branch.status === 200 || branch.status === 201, `${branch.status} ${JSON.stringify(branch.body).slice(0, 120)}`);
  const lk2 = await api('GET', '/lookups', undefined, token);
  const branchId = (lk2.body?.items?.contractor || []).find((c) => c.name === 'باربری آزمون ۱۷')?.id;
  check('شاخه در فهرست «مربوط» هست', Boolean(branchId));

  const sale = await api('POST', '/sales', {
    customerId: cid, materialName: 'ریگ', volume: 10, unitPrice: 100, freightPerUnit: 5,
    contractorId: branchId, paymentType: 'credit', date: todayISO(),
  }, token);
  check('ثبت بل فروش با شاخه‌ی مربوط', sale.status === 200 || sale.status === 201, `${sale.status} ${JSON.stringify(sale.body).slice(0, 140)}`);

  const exp = await api('POST', '/expenses', {
    description: 'کرایه بل تست', categoryName: 'کرایه وسایط', amountAfn: 700,
    contractorId: branchId, payerName: 'دخل', paymentType: 'cash', date: todayISO(),
  }, token);
  check('ثبت مصرف با همان شاخه', exp.status === 200 || exp.status === 201, `${exp.status} ${JSON.stringify(exp.body).slice(0, 140)}`);

  const from = addDays(todayISO(), -5);
  const to = addDays(todayISO(), 5);
  const bd = await api('GET', `/reports/breakdown?from=${from}&to=${to}`, undefined, token);
  check('راپور تفصیلی بارگذاری شد', bd.status === 200, `${bd.status} ${JSON.stringify(bd.body).slice(0, 160)}`);
  const rel = (bd.body?.byRelated || []).find((r) => r.name === 'باربری آزمون ۱۷');
  check('شاخه در راپور «مربوط» هست', Boolean(rel), JSON.stringify((bd.body?.byRelated || []).map((r) => r.name)));
  check('راپور «مربوط»: مجموع کرایه‌ی شاخه', Number(rel?.freight) === 50, String(rel?.freight));
  check('راپور «مربوط»: مصرف همان شاخه', Number(rel?.expenseAfn) === 700, String(rel?.expenseAfn));
  check('راپور «مربوط»: بل فروش شاخه', Number(rel?.saleDocs) === 1, String(rel?.saleDocs));
  check('جمع کل «مربوط» در راپور هست', Number(bd.body?.relatedTotals?.expenseAfn) >= 700, JSON.stringify(bd.body?.relatedTotals));
  /* رسیدها هم شاخه‌اند: «بیانیه» باید در همان راپور با مبلغش بیاید */
  const relBayanie = (bd.body?.byRelated || []).find((r) => r.name === 'بیانیه');
  check('راپور «مربوط»: رسیدهای «بیانیه» هم زیر شاخه‌ی خودش هست', Number(relBayanie?.receiptAmount) === 1500, String(relBayanie?.receiptAmount));
  const relRelated = (bd.body?.byRelated || []).find((r) => r.name === 'مربوط');
  check('راپور «مربوط»: رسید «مربوط» جدا شمرده می‌شود', Number(relRelated?.receiptAmount) === 300, String(relRelated?.receiptAmount));

  /* --- خروجی: سرستون «مربوط (شاخه مصرف)» --- */
  const outRes = await fetch(`${BASE}/export?type=sales&format=csv`, { headers: { 'x-auth-token': token } });
  const outText = Buffer.from(await outRes.arrayBuffer()).toString('utf8');
  check('خروجی فروشات ستون «مربوط (شاخه مصرف)» دارد', outText.includes('مربوط (شاخه مصرف)'));
  check('خروجی فروشات نام شاخه را دارد', outText.includes('باربری آزمون ۱۷'));
  const outExp = await fetch(`${BASE}/export?type=expenses&format=csv`, { headers: { 'x-auth-token': token } });
  const outExpText = Buffer.from(await outExp.arrayBuffer()).toString('utf8');
  check('خروجی مصارف ستون «مربوط (شاخه مصرف)» دارد', outExpText.includes('مربوط (شاخه مصرف)'));
  const outRec = await fetch(`${BASE}/export?type=receipts&format=csv`, { headers: { 'x-auth-token': token } });
  const outRecText = Buffer.from(await outRec.arrayBuffer()).toString('utf8');
  check('خروجی رسیدات نام قدیمی «پیش پرداخت» را با نام رسمی می‌نویسد', !outRecText.includes('پیش پرداخت'), outRecText.slice(0, 200));
  check('خروجی رسیدات «بیانیه» دارد', outRecText.includes('بیانیه'));

  /* ================================================================ */
  console.log('\n— هیچ چیز نشکسته: صفحات اصلی —');
  for (const [label, url] of [
    ['داشبورد', '/reports/dashboard'],
    ['راپور روزانه', '/reports/daily'],
    ['دفتر دخل', '/reports/cashbook'],
    ['فروشات', '/sales'],
    ['مصارف', '/expenses'],
    ['رسیدات', '/receipts'],
    ['مشتریان', '/customers'],
  ]) {
    const r = await api('GET', url, undefined, token);
    check(`${label} بدون خطا`, r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  }

  /* --- باگ: شاخه با شناسه ثبت می‌شود ولی نامش خالی می‌ماند → راپور «بدون شاخه» --- */
  const byId = await api('POST', '/sales', {
    customerId: cid, materialName: 'ریگ', volume: 2, unitPrice: 100, freightPerUnit: 7,
    contractorId: branchId, paymentType: 'credit', date: todayISO(),
  }, token);
  check('ثبت بل با فقط شناسه‌ی شاخه', byId.status === 200 || byId.status === 201, String(byId.status));
  const saleNo = byId.body?.no || '';
  const saleRow = (await api('GET', `/sales?q=${encodeURIComponent(saleNo)}`, undefined, token)).body?.rows?.[0] || {};
  check('نام شاخه در بل ذخیره شد (نه خالی)', saleRow.contractorName === 'باربری آزمون ۱۷', String(saleRow.contractorName));

  const expById = await api('POST', '/expenses', {
    description: 'مصرف با شناسه شاخه', categoryName: 'کرایه وسایط', amountAfn: 40,
    contractorId: branchId, payerName: 'دخل', paymentType: 'cash', date: todayISO(),
  }, token);
  check('ثبت مصرف با فقط شناسه‌ی شاخه', expById.status === 200 || expById.status === 201, String(expById.status));
  const expNo = expById.body?.no || '';
  const expRow = (await api('GET', `/expenses?q=${encodeURIComponent(expNo)}`, undefined, token)).body?.rows?.[0] || {};
  check('نام شاخه در مصرف ذخیره شد', expRow.contractorName === 'باربری آزمون ۱۷', String(expRow.contractorName));

  /* --- باگ: رسید با فقط sourceId → منبع خالی --- */
  const recById = await api('POST', '/receipts', { customerId: cid, amount: 60, sourceId: branchId }, token);
  check('ثبت رسید با فقط شناسه‌ی منبع', recById.status === 200 || recById.status === 201, String(recById.status));

  /* --- باگ: کارت حساب اسناد حذف‌شده را هم می‌آورد (مانده با فهرست نمی‌خواند) --- */
  const delTarget = (await api('GET', `/receipts?customerId=${cid}&pageSize=50`, undefined, token)).body?.rows
    ?.find((r) => Number(r.amount) === 300);
  if (delTarget) {
    const delRes = await api('DELETE', `/receipts/${delTarget.id}`, undefined, token);
    check('حذف نرم رسید انجام شد', delRes.status === 200, String(delRes.status));
    const st2 = await api('GET', `/customers/${cid}/statement`, undefined, token);
    check('کارت حساب رسید حذف‌شده را نشان نمی‌دهد',
      !(st2.body?.rows || []).some((r) => Number(r.amount) === 300),
      JSON.stringify((st2.body?.rows || []).map((r) => r.amount)));
    const cl = await api('GET', '/customers?q=T17', undefined, token);
    const row2 = (cl.body || [])[0] || {};
    /* ۱۸۰۰ = ۱۰۰۰+۵۰۰+۳۰۰ · منهای ۳۰۰ حذف‌شده · به‌علاوه ۶۰ رسید شناسه‌ای = ۱۵۶۰ */
    check('مانده‌ی فهرست با کارت حساب می‌خواند', Number(row2.receipts) === 1560, String(row2.receipts));
    /* سابقه فعالیت حذف باید ثبت شده باشد (کد مرده‌ی قبلی) */
    const act = await api('GET', '/system/activity?entity=Receipt&limit=20', undefined, token);
    const acts = Array.isArray(act.body) ? act.body : (act.body?.rows || []);
    check('حذف رسید در سابقه فعالیت‌ها ثبت شد',
      acts.some((a) => a.action === 'delete' && a.entity === 'Receipt'),
      JSON.stringify(acts.slice(0, 2)));
  } else {
    check('رسید مورد نظر برای حذف پیدا شد', false);
  }

  try { await client.$disconnect(); } catch { /* */ }
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
