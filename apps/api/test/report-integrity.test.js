/**
 * آزمون «حساب‌ها با هم می‌خوانند» روی داده‌ی تصادفی.
 *
 *   node apps/api/test/report-integrity.test.js
 *
 * ── چرا این تست (پیشنهاد A3، دور ۴۰) ───────────────────────────────────
 * تا امروز گزارش‌ها با **چند نمونه‌ی دستی** تست می‌شدند. این برای مبالغ
 * کافی نیست: اگر روزی یک JOIN دوبار بشمارد، یک گردکردن اعشاری جا بیفتد، یا
 * یک `deletedAt` از قلم بیفتد، تست دستی سبز می‌ماند در حالی که جمع گزارش با
 * جمع ردیف‌ها نمی‌خواند — و کسی تا آخر ماه نمی‌فهمد.
 *
 * این تست داده‌ی تصادفی (با seed ثابت، پس تکرارپذیر) می‌سازد و این قاعده‌ها
 * را می‌سنجد — **بدون** فرض کردن فرمول درونی:
 *
 *   ۱) جمع ردیف‌های راپور روزانه == خود فیلد `totals` (خودسازگاری)
 *   ۲) مجموع ماه‌های راپور ماهانه == راپور سالانه برای همان سال
 *   ۳) راپور روزانه برای یک روز == ردیف همان روز در بازه‌ی همان روز
 *   ۴) هیچ مقدار NaN/Infinity در خروجی نیست (تقسیم بر صفر پنهان)
 *   ۵) حذف نرم‌شده در هیچ گزارشی شمرده نمی‌شود (سند حذف‌شده جمع را عوض نمی‌کند)
 *   ۶) مانده‌ی نقدی روز آخر == مانده‌ی نمایش‌داده‌شده در دفتر نقدی
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const dist = path.join(root, 'apps/api/dist');
const PORT = 4488;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-ri-'));

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

/** مولد شبه‌تصادفی با seed ثابت — تست تکرارپذیر است. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const hasBadNumber = (v, depth = 0) => {
  if (depth > 6 || v === null || v === undefined) return false;
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v !== 'object') return false;
  return Object.values(v).some((x) => hasBadNumber(x, depth + 1));
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
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  })();
  check('سرور بالا آمد', up, up ? '' : log.slice(-400));
  if (!up) { try { child.kill(); } catch { /* */ } return finish(); }

  const mk = (await api('GET', '/license/device')).body.machineKey;
  const payload = {
    v: 1, id: 'FR-LIC-RI', customer: 'آزمون حساب', kind: 'yearly',
    start: addDays(todayISO(), -1), end: addDays(todayISO(), 400),
    machineKey: mk, seats: 1, note: '', issuedAt: new Date().toISOString(),
  };
  const body64 = b64u(JSON.stringify(payload));
  const lic = `-----BEGIN FARDAY LICENSE-----\nFR-1\n${body64}\n${b64u(crypto.sign(null, Buffer.from(body64, 'utf8'), kp.privateKey))}\n-----END FARDAY LICENSE-----`;
  await api('POST', '/license/activate', { text: lic });
  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body?.token || '';
  check('ورود مدیر', Boolean(token));

  /* ── داده‌ی تصادفی ─────────────────────────────────────────────────── */
  const rand = rng(20261110);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const customers = [];
  for (let i = 0; i < 6; i++) {
    const r = await api('POST', '/customers', { name: `مشتری تصادفی ${i + 1}` }, token);
    if (r.status < 300) customers.push(`مشتری تصادفی ${i + 1}`);
  }
  const custRows = (await api('GET', '/customers?page=1', undefined, token)).body?.rows || [];
  const custIds = custRows.slice(0, 6).map((c) => c.id);
  check('مشتریان تصادفی ساخته شدند', custIds.length >= 3, String(custIds.length));

  const base = addDays(todayISO(), -40);
  let madeSales = 0, madeExpenses = 0, madeReceipts = 0;
  for (let i = 0; i < 40; i++) {
    const date = addDays(base, Math.floor(rand() * 40));
    const volume = Math.round(rand() * 500) / 10;      // یک رقم اعشار
    const unitPrice = Math.floor(rand() * 900) + 100;
    const payType = pick(['cash', 'credit', 'credit']);
    const r = await api('POST', '/sales', {
      date, customerId: pick(custIds), volume, unitPrice,
      freightPerUnit: Math.round(rand() * 30), paymentType: payType, note: '',
    }, token);
    if (r.status < 300) madeSales++;
  }
  for (let i = 0; i < 25; i++) {
    const date = addDays(base, Math.floor(rand() * 40));
    const r = await api('POST', '/expenses', {
      date, description: `مصرف ${i}`, amountAfn: Math.round(rand() * 100000) / 100, amountUsd: 0,
    }, token);
    if (r.status < 300) madeExpenses++;
  }
  for (let i = 0; i < 18; i++) {
    const date = addDays(base, Math.floor(rand() * 40));
    const r = await api('POST', '/receipts', {
      date, customerId: pick(custIds), amount: Math.round(rand() * 50000) / 100,
    }, token);
    if (r.status < 300) madeReceipts++;
  }
  check('بل‌های فروش ساخته شدند', madeSales > 20, String(madeSales));
  check('مصارف ساخته شدند', madeExpenses > 15, String(madeExpenses));
  check('رسیدات ساخته شدند', madeReceipts > 10, String(madeReceipts));

  const FROM = addDays(base, -1), TO = addDays(base, 45);

  /* ── ۱) خودسازگاری جمع ────────────────────────────────────────────── */
  console.log('\n— ۱) جمع ردیف‌ها == totals —');
  {
    const d = await api('GET', `/reports/daily?from=${FROM}&to=${TO}`, undefined, token);
    check('راپور روزانه جواب داد', d.status === 200, String(d.status));
    const rows = d.body?.rows || [];
    const t = d.body?.totals || {};
    const KEYS = ['creditSales', 'cashSales', 'receipts', 'expensesAfn', 'salaries', 'totalExpenses', 'cashIn', 'cashOut'];
    for (const k of KEYS) {
      const sum = round2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
      check(`جمع ستون «${k}» با totals می‌خواند`, Math.abs(sum - round2(t[k] || 0)) < 0.02, `${sum} ≠ ${t[k]}`);
    }
    check('هیچ عدد نامعتبری (NaN/Infinity) در خروجی نیست', !hasBadNumber(d.body));

    /*
     * ── قاعده‌ای که دور ۳۴ اصلاح شد و این‌جا دوباره قفل می‌شود ─────────────
     * «متحرک دخل» هر روز = cashIn − cashOut همان روز. قبلاً `cashOut` مبلغ
     * دالری را نمی‌شمرد ولی `cashBalance` می‌شمرد، و جمع ستون «خروج» با
     * «موجودی» نمی‌خواند. این تست همان ناسازگاری را روی داده‌ی تصادفی
     * می‌گیرد، هر جا که دوباره برگردد.
     */
    const badRows = rows.filter((r) => Math.abs(round2((Number(r.cashIn) || 0) - (Number(r.cashOut) || 0)) - round2(r.cashBalance || 0)) > 0.02);
    check('در هر روز: cashIn − cashOut == cashBalance', badRows.length === 0,
      `${badRows.length} روز ناسازگار — نمونه: ${JSON.stringify(badRows[0] || {}).slice(0, 160)}`);
    check('totals: cashIn − cashOut == cashBalance',
      Math.abs(round2((t.cashIn || 0) - (t.cashOut || 0)) - round2(t.cashBalance || 0)) < 0.02,
      `${t.cashIn} - ${t.cashOut} ≠ ${t.cashBalance}`);

    /*
     * `runningCash` تجمعی است (قدیمی‌ترین روز اول، ولی خروجی جدیدترین اول
     * برمی‌گردد). پس: مانده‌ی تجمعیِ «جدیدترین ردیف» باید همان totals باشد،
     * و هر ردیف باید relative به ردیف قبلی‌اش درست جلو رفته باشد.
     */
    const newest = rows[0] || {};
    check('مانده‌ی تجمعیِ جدیدترین روز == totals.cashBalance',
      Math.abs(round2(newest.runningCash || 0) - round2(t.cashBalance || 0)) < 0.02,
      `${newest.runningCash} ≠ ${t.cashBalance}`);
    let runOk = true; let prev = 0;
    for (let i = rows.length - 1; i >= 0; i--) {   // از قدیمی به جدید
      prev = round2(prev + (Number(rows[i].cashBalance) || 0));
      if (Math.abs(prev - round2(rows[i].runningCash || 0)) > 0.02) { runOk = false; break; }
    }
    check('مانده‌ی تجمعی روز‌به‌روز درست جمع می‌شود', runOk);
  }

  /* ── ۲) روزانه یک‌روزه == ردیف همان روز ───────────────────────────── */
  console.log('\n— ۲) بازه‌ی یک‌روزه == ردیف همان روز در بازه‌ی بزرگ —');
  {
    const big = await api('GET', `/reports/daily?from=${FROM}&to=${TO}`, undefined, token);
    const rows = big.body?.rows || [];
    const sample = rows.filter((r) => (Number(r.cashIn) || 0) + (Number(r.cashOut) || 0) > 0).slice(0, 3);
    check('روزی با گردش پیدا شد', sample.length > 0, String(sample.length));
    for (const row of sample) {
      const one = await api('GET', `/reports/daily?from=${row.date}&to=${row.date}`, undefined, token);
      const r1 = (one.body?.rows || [])[0] || {};
      const okAll = ['creditSales', 'cashSales', 'receipts', 'expensesAfn', 'totalExpenses', 'cashIn', 'cashOut']
        .every((k) => Math.abs(round2(r1[k] || 0) - round2(row[k] || 0)) < 0.02);
      check(`روز ${row.date}: خروجی تک‌روزه با ردیف بازه یکی است`, okAll,
        JSON.stringify({ one: r1, big: row }).slice(0, 200));
    }
  }

  /* ── ۳) ماهانه == سالانه ──────────────────────────────────────────── */
  console.log('\n— ۳) جمع ماه‌ها == سالانه —');
  {
    const monthly = await api('GET', '/reports/monthly', undefined, token);
    check('راپور ماهانه جواب داد', monthly.status === 200, String(monthly.status));
    const rows = monthly.body?.rows || [];
    const year = (await api('GET', '/reports/yearly', undefined, token)).body;
    const yRow = (year?.rows || []).find((r) => Number(r.year) === Number(monthly.body?.year)) || year?.rows?.[0] || {};
    const KEYS = ['creditSales', 'cashSales', 'receipts', 'expensesAfn', 'totalExpenses'];
    for (const k of KEYS) {
      if (yRow[k] === undefined) continue;
      const sum = round2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
      check(`جمع ماهانه‌ی «${k}» == سالانه`, Math.abs(sum - round2(yRow[k] || 0)) < 0.02, `${sum} ≠ ${yRow[k]}`);
    }
  }

  /* ── ۴) حذف نرم جمع را عوض می‌کند، ولی نه وقتی بازیابی شود ────────── */
  console.log('\n— ۴) سند حذف‌شده در گزارش شمرده نمی‌شود —');
  {
    const before = (await api('GET', `/reports/daily?from=${FROM}&to=${TO}`, undefined, token)).body.totals;
    const list = (await api('GET', '/sales?page=1', undefined, token)).body?.rows || [];
    const victim = list[0] || {};
    if (victim.id) {
      const total = Number(victim.total) || 0;
      const del = await api('DELETE', `/sales/${victim.id}`, undefined, token);
      check('بل حذف (نرم) شد', del.status < 300, String(del.status));
      const after = (await api('GET', `/reports/daily?from=${FROM}&to=${TO}`, undefined, token)).body.totals;
      const key = victim.paymentType === 'credit' ? 'creditSales' : 'cashSales';
      const diff = round2(before[key] || 0) - round2(after[key] || 0);
      check(`حذف بل، «${key}» را به اندازه‌ی مبلغش کم کرد`, Math.abs(diff - total) < 0.02, `${diff} ≠ ${total}`);
      /*
       * نام جدول در سطل بازیافت، نام کلاس Prisma است (`Sale`)، نه مسیر API
       * (`sales`). تست اول اشتباه `sales` می‌فرستاد و ۴۰۰ می‌گرفت — اشتباهِ
       * تست بود، نه محصول. این‌جا همان نام درست استفاده می‌شود.
       */
      const restored = await api('POST', `/recycle/Sale/${victim.id}/restore`, undefined, token);
      check('بل از سطل بازیافت برگشت', restored.status < 300, `${restored.status} ${JSON.stringify(restored.body).slice(0, 120)}`);
      const back = (await api('GET', `/reports/daily?from=${FROM}&to=${TO}`, undefined, token)).body.totals;
      check('پس از بازیابی، جمع دقیقاً به حالت قبل برگشت',
        Math.abs(round2(back[key] || 0) - round2(before[key] || 0)) < 0.02,
        `${back[key]} ≠ ${before[key]}`);
    } else {
      check('بل برای آزمون حذف پیدا شد', false);
    }
  }

  /* ── ۵) مانده‌ی نقدی با دفتر نقدی می‌خواند ────────────────────────── */
  console.log('\n— ۵) مانده‌ی نقدی == دفتر نقدی —');
  {
    const daily = (await api('GET', `/reports/daily?from=${FROM}&to=${TO}`, undefined, token)).body;
    const cash = await api('GET', `/reports/cashbook?from=${FROM}&to=${TO}`, undefined, token);
    check('دفتر نقدی جواب داد', cash.status === 200, String(cash.status));
    const cb = cash.body || {};
    const rows = cb.rows || cb.entries || [];
    if (rows.length) {
      const lastRow = rows[rows.length - 1] || {};
      const lastDaily = (daily.rows || [])[0] || {};
      /* فقط وقتی هر دو «مانده‌ی تجمعی» می‌دهند مقایسه معنا دارد */
      /*
       * مانده‌ی دفتر نقدی **تجمعی** است، پس با `runningCash` مقایسه می‌شود —
       * نه با `cashBalance` (که فقط «متحرک همان روز» است). تست اول این را
       * اشتباه گرفته بود و «۰ ≠ ۲۴۹۸۲۴» می‌داد؛ عدد ۰ مانده‌ی روز بی‌گردش
       * بود. مقایسه‌ی درست این‌جاست.
       */
      const comparable = lastRow.balance !== undefined;
      if (comparable) {
        const expected = round2(daily.totals?.cashBalance || 0);
        check('مانده‌ی دفتر نقدی == مانده‌ی تجمعی راپور روزانه',
          Math.abs(round2(lastRow.balance) - expected) < 0.02,
          `${lastRow.balance} ≠ ${expected}`);
      } else {
        check('دفتر نقدی ستون مانده دارد', false, JSON.stringify(lastRow).slice(0, 160));
      }
    } else {
      check('دفتر نقدی ردیف داشت', false, JSON.stringify(cb).slice(0, 120));
    }
  }

  /* ── ۶) گردکردن: مبلغ با دو رقم اعشار گم نمی‌شود ─────────────────── */
  console.log('\n— ۶) مبلغ اعشاری دقیق ذخیره/جمع می‌شود —');
  {
    const odd = 1234.56;
    const r = await api('POST', '/expenses', {
      date: TODAY_STR(), description: 'آزمون گردکردن', amountAfn: odd, amountUsd: 0,
    }, token);
    check('مصرف با مبلغ اعشاری ساخته شد', r.status < 300, String(r.status));
    const day = await api('GET', `/reports/daily?from=${TODAY_STR()}&to=${TODAY_STR()}`, undefined, token);
    const row = (day.body?.rows || [])[0] || {};
    check('مبلغ اعشاری در جمع روز با خطای صفر آمد',
      Math.abs(round2(row.expensesAfn || 0) - odd) < 0.005, `${row.expensesAfn} ≠ ${odd}`);
  }

  try { child.kill(); } catch { /* */ }
  finish();
})().catch((e) => {
  console.error('\n⛔ خطای غیرمنتظره:', e);
  finish(1);
});

function TODAY_STR() { return todayISO(); }

function finish(code = 0) {
  console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  console.log('');
  process.exit(failed === 0 && code === 0 ? 0 : 1);
}
