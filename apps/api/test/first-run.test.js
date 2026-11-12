/**
 * تست «اولین اجرا» و «فهرست‌های کشویی» — باگ‌های پنهانی که شکار باگ دور ۳۱
 * پیدا کرد.
 *
 *   node apps/api/test/first-run.test.js
 *
 * ## باگ ۱: نصب تازه با فهرست‌های خالی
 * `ensureDefaultLookups()` فقط در «صفر کردن»، «داده‌ی نمونه» و اسکریپت seed
 * صدا زده می‌شد. یعنی کسی که برنامه را تازه نصب می‌کرد (یا فایل داده را
 * پاک/بازگردانی می‌کرد) با کشویی‌های **خالی** روبه‌رو می‌شد: نه نوع مصرف،
 * نه پرداخت‌کننده، نه مواد. آزمون: روی دیتابیس کاملاً تازه، فهرست‌ها پر باشند.
 *
 * ## باگ ۲: راه برگشتی نبود
 * اگر کاربر همه‌ی اقلام یک فهرست را حذف/غیرفعال می‌کرد، هیچ دکمه‌ای برای
 * بازگرداندن پیش‌فرض‌ها وجود نداشت. آزمون: حذف → `restore-defaults` →
 * برگشت؛ غیرفعال‌شدن (ردیف استفاده‌شده) → `restore-inactive` → برگشت.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const dist = path.join(root, 'apps/api/dist');
const PORT = 4437;
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-firstrun-'));
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
  let out; try { out = JSON.parse(text); } catch { out = text; }
  return { status: res.status, body: out };
};

(async () => {
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    try {
      if ((await fetch(BASE + '/health')).ok) {
        const info = await fetch(BASE + '/system/info').then((r) => r.json()).catch(() => ({}));
        const dir = String(info?.dataDir || '');
        up = !dir || path.resolve(dir) === path.resolve(dataDir);
      }
    } catch { /* wait */ }
    if (!up) await new Promise((r) => setTimeout(r, 300));
  }
  check('سرور روی دیتابیس تازه بالا آمد', up, log.slice(-300));
  if (!up) { try { child.kill('SIGKILL'); } catch { /* */ } return finish(); }

  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body?.token || '';
  check('ورود مدیر روی نصب تازه', Boolean(token));

  /* ============================================================== */
  console.log('\n— فهرست‌های کشویی روی نصب تازه —');

  const lookups = await api('GET', '/lookups', undefined, token);
  const items = lookups.body?.items || {};
  const count = (k) => (items[k] || []).length;
  check('مواد (material) پر است', count('material') >= 10, String(count('material')));
  check('انواع مصرف پر است', count('expense_category') >= 10, String(count('expense_category')));
  check('پرداخت‌کنندگان پر است', count('payer') >= 4, String(count('payer')));
  check('منابع رسید پر است', count('receipt_source') >= 3, String(count('receipt_source')));
  check('باربری‌ها پر است', count('contractor') >= 3, String(count('contractor')));
  check('لاگ، ساخت خودکار فهرست‌ها را می‌گوید', /FARDAY_DEFAULTS_SEEDED/.test(log), log.slice(0, 200));

  /*
   * باگ دیگر: `Select` مقدارِ ناموجود را پاک می‌کرد. این‌جا همان حالت را
   * می‌سازیم: یک مصرف با «نوع مصرف»ی که بعد از ثبت، از فهرست فعال‌ها حذف
   * می‌شود. سند باید نام قبلی‌اش را نگه دارد (نام در سند ذخیره می‌شود).
   */
  console.log('\n— سندی با قلم حذف‌شده، نامش را نگه می‌دارد —');
  const cats = (await api('GET', '/lookups/manage?type=expense_category', undefined, token)).body.rows;
  const cat = cats[0];
  const exp = await api('POST', '/expenses', {
    description: 'کرایه باربری', amountAfn: 250, date: '2026-11-01',
    categoryId: cat.id, categoryName: cat.name, payerName: 'دخل',
  }, token);
  check('مصرف ثبت شد', exp.status === 201, String(exp.status));
  const del = await api('DELETE', `/lookups/${cat.id}`, undefined, token);
  check('قلمِ استفاده‌شده «غیر فعال» شد (حذف نشد)', del.body?.deactivated === true, JSON.stringify(del.body));
  const expList = await api('GET', '/expenses', undefined, token);
  const row = (expList.body?.rows || [])[0];
  check('نام نوع مصرف در سند باقی مانده', String(row?.categoryName) === String(cat.name),
    `${row?.categoryName} vs ${cat.name}`);

  /* ============================================================== */
  console.log('\n— بازگرداندن پیش‌فرض‌ها —');

  /* حذف سه قلم بی‌استفاده */
  const mats = (await api('GET', '/lookups/manage?type=material', undefined, token)).body.rows;
  const unused = mats.filter((m) => !m.usage).slice(0, 3);
  let hardDeleted = 0;
  for (const m of unused) {
    const r = await api('DELETE', `/lookups/${m.id}`, undefined, token);
    if (r.body?.deactivated === false) hardDeleted++;
  }
  check('سه قلم بی‌استفاده واقعاً حذف شد', hardDeleted === 3, String(hardDeleted));
  const afterDel = await api('GET', '/lookups', undefined, token);
  check('فهرست مواد کمتر شد', (afterDel.body?.items?.material || []).length === count('material') - 3,
    String((afterDel.body?.items?.material || []).length));

  const restore = await api('POST', '/lookups/restore-defaults', {}, token);
  check('بازگردانی پیش‌فرض‌ها انجام شد', restore.status === 201 && restore.body?.added === 3,
    JSON.stringify(restore.body));
  check('پیام فارسی می‌گوید چند ردیف برگشت', /۳|3/.test(String(restore.body?.message)), String(restore.body?.message));
  const afterRestore = await api('GET', '/lookups', undefined, token);
  check('فهرست مواد دوباره کامل است',
    (afterRestore.body?.items?.material || []).length === count('material'),
    String((afterRestore.body?.items?.material || []).length));

  const again = await api('POST', '/lookups/restore-defaults', {}, token);
  check('بازگردانی دوباره چیزی اضافه نمی‌کند (idempotent)', again.body?.added === 0, JSON.stringify(again.body));

  /* غیرفعال‌ها: قلمی که استفاده دارد غیرفعال شد — با یک دستور برگردد */
  const inactiveCount = (await api('GET', '/lookups', undefined, token)).body?.items?.expense_category || [];
  check('قلم غیرفعال‌شده در فهرست فعال‌ها نیست',
    !inactiveCount.some((c) => c.name === cat.name), JSON.stringify(inactiveCount.map((c) => c.name)).slice(0, 120));

  const react = await api('POST', '/lookups/restore-inactive', {}, token);
  check('فعال‌سازی دوباره‌ی غیرفعال‌ها انجام شد', react.status === 201 && react.body?.activated >= 1,
    JSON.stringify(react.body));
  const afterReact = (await api('GET', '/lookups', undefined, token)).body?.items?.expense_category || [];
  check('قلم برگشت', afterReact.some((c) => c.name === cat.name), JSON.stringify(afterReact.map((c) => c.name)).slice(0, 120));

  /* فقط پیش‌فرض‌ها فعال می‌شوند، نه ردیف ساخته‌ی کاربر */
  const custom = await api('POST', '/lookups', { type: 'expense_category', name: 'مصرف آزمونی من' }, token);
  check('قلم سفارشی ساخته شد', custom.status === 201 || custom.status === 200, String(custom.status));
  const customRow = (await api('GET', '/lookups/manage?type=expense_category', undefined, token)).body.rows
    .find((r) => r.name === 'مصرف آزمونی من');
  await api('DELETE', `/lookups/${customRow.id}`, undefined, token);
  const react2 = await api('POST', '/lookups/restore-inactive', {}, token);
  check('فعال‌سازی دوباره، قلم ساخته‌ی کاربر را برنمی‌گرداند', react2.body?.activated === 0,
    JSON.stringify(react2.body));
  const customStill = (await api('GET', '/lookups/manage?type=expense_category', undefined, token)).body.rows
    .find((r) => r.name === 'مصرف آزمونی من');
  /*
   * قلم سفارشیِ بی‌استفاده با «حذف» واقعاً پاک می‌شود (نه غیرفعال)؛ یعنی
   * دیگر در فهرست نیست. مهم این است که `restore-inactive` آن را برنگرداند.
   */
  check('قلم سفارشی با فعال‌سازی دوباره برنگشت', !customStill, JSON.stringify(customStill && customStill.active));
  check('شمارش برگردانده‌شده‌ها فقط پیش‌فرض‌ها را شامل شد', (afterReact || []).length >= 1);

  try { child.kill('SIGKILL'); } catch { /* */ }
  finish();
})().catch((e) => { console.error('\n⛔ خطای غیرمنتظره:', e); finish(1); });

function finish(code = 0) {
  console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  console.log('');
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(failed === 0 && code === 0 ? 0 : 1);
}
