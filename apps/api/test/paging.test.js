/**
 * تست «صفحه‌بندی» — شکار باگ دور ۳۲ (ضد‌سرعت و بی‌سقف بودن پاسخ‌ها)
 *
 *   node apps/api/test/paging.test.js
 *
 * ## باگی که این تست نگه می‌دارد
 * `GET /customers` **همه‌ی** مشتریان را با **همه‌ی** ستون‌ها بی‌سقف
 * می‌فرستاد (با ۵۰۰ مشتری ۱۳۶ کیلوبایت) و هر جستجو دوباره همه را می‌کشید.
 * `GET /recycle/:table` هم تا ۱۰۰۰ ردیف یک‌جا می‌داد و `GET /system/timeline`
 * برای هر باز شدن، ۹ کوئری پیمایشی روی همه‌ی جدول‌های حذف‌نرم می‌زد.
 *
 * ## چرا «اختیاری»
 * فورم‌های فروش/رسید برای کشویی‌ها به آرایه‌ی **کامل** مشتریان تکیه دارند.
 * اگر صفحه‌بندی پیش‌فرض می‌شد، آن‌ها بی‌صدا ناقص می‌شدند. پس این تست
 * سه چیز را قفل می‌کند:
 *   ۱. بدون `page`/`pageSize` ⇒ **همان آرایه‌ی کامل** (سازگاری عقب‌رو).
 *   ۲. با صفحه‌بندی ⇒ همان ردیف‌ها، همان فیلدها، همان مانده — فقط تکه‌تکه.
 *   ۳. جمع‌ها (`debtTotal` / `total`) روی **کل** نتیجه حساب می‌شوند، نه صفحه.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const dist = path.join(root, 'apps/api/dist');
const PORT = 4447;
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-paging-'));
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
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
};

const boot = async () => {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

const kill = () => { try { child.kill('SIGKILL'); } catch { /* */ } };
setTimeout(() => { console.error('\n⛔ زمان تمام شد (۹۰ ثانیه).'); kill(); finish(1); }, 90_000).unref();

(async () => {
  if (!(await boot())) { console.error('\n⛔ سرور بالا نیامد.'); kill(); return finish(1); }
  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body.token;
  if (!token) { console.error('\n⛔ ورود ناموفق.'); kill(); return finish(1); }

  console.log('\n— صفحه‌بندی مشتریان —');
  const N = 40;
  for (let i = 1; i <= N; i++) {
    await api('POST', '/customers', { code: String(7000 + i), name: `مشتری آزمون ${String(i).padStart(2, '0')}`, openingBalance: i * 100 }, token);
  }

  /* ۱) سازگاری عقب‌رو: بدون پارامتر ⇒ آرایه‌ی کامل */
  const full = await api('GET', '/customers', undefined, token);
  check('بدون پارامتر، پاسخ همان آرایه‌ی قدیمی است', Array.isArray(full.body), typeof full.body);
  check('آرایه‌ی کامل همه‌ی مشتریان را دارد', full.body.length === N, String(full.body?.length));

  const light = await api('GET', '/customers?light=1', undefined, token);
  check('light=1 هم آرایه است (کشویی‌های فورم)', Array.isArray(light.body) && light.body.length === N, String(light.body?.length));
  check('light=1 ستون‌های سنگین را نمی‌فرستد', light.body.every((r) => !('note' in r) && !('address' in r)));

  /* ۲) صفحه‌بندی */
  const p1 = await api('GET', '/customers?page=1&pageSize=25', undefined, token);
  const p2 = await api('GET', '/customers?page=2&pageSize=25', undefined, token);
  check('صفحه‌بندی‌شده شیء با rows/total است', !Array.isArray(p1.body) && Array.isArray(p1.body.rows), JSON.stringify(p1.body).slice(0, 80));
  check('pageSize رعایت می‌شود', p1.body.rows.length === 25, String(p1.body.rows.length));
  check('total کل نتیجه است نه صفحه', p1.body.total === N, String(p1.body.total));
  check('صفحه‌ی دوم بقیه را می‌دهد', p2.body.rows.length === N - 25, String(p2.body.rows.length));
  const ids = new Set([...p1.body.rows, ...p2.body.rows].map((r) => r.id));
  check('صفحه‌ها هم‌پوشانی/جاافتادگی ندارند', ids.size === N, `${ids.size} از ${N}`);

  /* ۳) همان داده، همان فیلدها، همان مانده */
  const byId = new Map(full.body.map((r) => [r.id, r]));
  const sameKeys = p1.body.rows.every((r) => {
    const f = byId.get(r.id);
    return f && JSON.stringify(Object.keys(f).sort()) === JSON.stringify(Object.keys(r).sort());
  });
  check('فیلدهای ردیف صفحه‌بندی‌شده با حالت کامل یکی است', sameKeys);
  check('مانده‌ی هر ردیف در دو حالت یکی است', p1.body.rows.every((r) => byId.get(r.id)?.balance === r.balance));

  /* ۴) جمع‌ها روی کل، نه صفحه */
  const expectDebt = full.body.reduce((a, r) => a + Math.max(0, r.balance), 0);
  check('debtTotal روی کل نتیجه حساب شده', p1.body.debtTotal === expectDebt, `${p1.body.debtTotal} ≠ ${expectDebt}`);

  /* ۵) ورودی نامعتبر کرش نمی‌کند */
  const weird = await api('GET', '/customers?page=abc&pageSize=-5', undefined, token);
  check('page/pageSize نامعتبر → صفحه‌ی ۱ با اندازه‌ی پیش‌فرض', weird.status === 200 && weird.body.page === 1, JSON.stringify(weird.body).slice(0, 80));
  const huge = await api('GET', '/customers?pageSize=99999&page=1', undefined, token);
  check('pageSize بزرگ به سقف ۵۰۰ محدود می‌شود', huge.body.pageSize === 500, String(huge.body.pageSize));

  /* ۶) جستجو + صفحه‌بندی با هم */
  const s = await api('GET', `/customers?q=${encodeURIComponent('مشتری آزمون 1')}&page=1&pageSize=5`, undefined, token);
  const expectCount = full.body.filter((r) => (r.name || '').includes('مشتری آزمون 1')).length;
  check('total با نتیجه‌ی جستجو می‌خواند', s.body.total === expectCount, `${s.body.total} ≠ ${expectCount}`);
  check('صفحه‌ی نتیجه‌ی جستجو از ۵ ردیف بیشتر نیست', s.body.rows.length <= 5);

  console.log('\n— سطل بازیافت —');
  const all = (await api('GET', '/customers', undefined, token)).body;
  for (const c of all) await api('DELETE', `/customers/${c.id}`, undefined, token);

  const r1 = await api('GET', '/recycle/Customer?page=1&limit=15', undefined, token);
  const r2 = await api('GET', '/recycle/Customer?page=2&limit=15', undefined, token);
  const r3 = await api('GET', '/recycle/Customer?page=3&limit=15', undefined, token);
  check('سطل بازیافت total می‌دهد', r1.body.total === N, String(r1.body.total));
  check('صفحه‌ی اول سطل پر است', r1.body.rows.length === 15, String(r1.body.rows.length));
  const rids = new Set([...r1.body.rows, ...r2.body.rows, ...r3.body.rows].map((r) => r.id));
  check('صفحه‌های سطل هم‌پوشانی ندارند', rids.size === N, `${rids.size} از ${N}`);
  const r0 = await api('GET', '/recycle/Customer', undefined, token);
  /* ۴۰ ردیف < پیش‌فرض ۲۰۰ ⇒ همه باید بیایند (رفتار قبلی، بدون صفحه‌بندی) */
  check('بدون پارامتر، سطل رفتار قبلی را دارد (همه‌ی ردیف‌ها)',
    Array.isArray(r0.body.rows) && r0.body.rows.length === N, String(r0.body.rows?.length));

  console.log('\n— سابقه‌ی فعالیت —');
  const tl = await api('GET', '/system/timeline?limit=100&trash=0', undefined, token);
  check('trash=0 چیزی را حذف نمی‌کند (فهرست پر است)', Array.isArray(tl.body) && tl.body.length > 0, String(tl.body?.length));
  check('trash=0 پرچم بازگرداندن نمی‌سازد', tl.body.every((r) => r.restorable === false));
  const tl2 = await api('GET', '/system/timeline?limit=100', undefined, token);
  check('حالت معمولی پرچم بازگرداندن را می‌سازد', tl2.body.some((r) => r.restorable === true), String(tl2.body.filter((r) => r.restorable).length));
  check('سرور در طول آزمون خطای داخلی نداده', !/ERROR|Unhandled/i.test(log.slice(-4000)));

  kill();
  finish();
})().catch((e) => { console.error('\n⛔ خطای غیرمنتظره:', e); kill(); finish(1); });

function finish(code = 0) {
  console.log(`\n${failed === 0 ? '✅' : '⛔'} ${passed} موفق، ${failed} ناکام`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  console.log('');
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(failed === 0 && code === 0 ? 0 : 1);
}
