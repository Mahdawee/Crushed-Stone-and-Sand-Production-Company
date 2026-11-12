/**
 * تست «خروجی ← ورودی» اکسل — شکار باگ دور ۳۲
 *
 *   node apps/api/test/import-roundtrip.test.js
 *
 * ## باگ‌هايی که این تست نگه می‌دارد
 *  ۱) خروجی مشتریان ۷ ستون با عنوان «باقی مانده بدهی» می‌داد و ورودی ۶ ستون
 *     با «باقی اولیه» و بدون «کد». فایلِ خروجی‌شده که دوباره وارد می‌شد،
 *     هر ستون یک خانه جابه‌جا می‌نشست: تلفن به‌جای شخص رابط، پلیت به‌جای
 *     تلفن، و **بدهی به ستون توضیحات** — یعنی مانده‌ی مشتری بی‌صدا صفر
 *     می‌شد. حالا ستون‌ها یکی‌اند و یک تست رفت‌وبرگشت دارد.
 *  ۲) تطبیق ستون‌ها با **نام** انجام می‌شود (نه جای ثابت) و عنوان‌های
 *     اکسل (نیم‌فاصله، «ي/ك» عربی، «/») نرمال می‌شوند؛ فایل جابه‌جا یا
 *     tab-delimited هم درست خوانده می‌شود.
 *  ۳) بررسی تکراریِ «پیش‌نمایش» ردیف‌های سطل بازیافت را آزاد می‌دانست ولی
 *     ثبت واقعی آن‌ها را تکراری می‌دید ⇒ «۰ ردیف ثبت شد» بی‌دلیل.
 *  ۴) استفاده‌ی دوباره از کدِ یک ردیف حذف‌شده، خطای UNIQUE و **۵۰۰** می‌داد.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const dist = path.join(root, 'apps/api/dist');
const PORT = 4451;
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-import-'));
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

const kill = () => { try { child.kill('SIGKILL'); } catch { /* */ } };
setTimeout(() => { console.error('\n⛔ زمان تمام شد.'); kill(); finish(1); }, 90_000).unref();

(async () => {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const token = (await api('POST', '/auth/login', { username: 'admin', password: 'admin123' })).body.token;
  if (!token) { console.error('\n⛔ ورود ناموفق.'); kill(); return finish(1); }

  console.log('\n— رفت‌وبرگشت خروجی ← ورودی —');
  await api('POST', '/customers', {
    code: '500', name: 'شرکت آلفا', contactPerson: 'احمد', phone: '0700111222',
    truckPlate: 'کابل ۱۲۳', openingBalance: 1500, note: 'یادداشت اول',
  }, token);

  const csv = (await api('GET', '/export?type=customers', undefined, token)).body;
  check('خروجی CSV رشته است', typeof csv === 'string' && csv.length > 10, typeof csv);

  const headerLine = String(csv).split(/\r?\n/).find((l) => l && !l.startsWith('sep=')) || '';
  check('عنوان ستون بدهی همان عنوان ورودی است («باقی اولیه»)', headerLine.includes('باقی اولیه'), headerLine);
  check('عنوان «باقی مانده بدهی» (که ورودی نمی‌شناخت) رفته', !headerLine.includes('باقی مانده بدهی'));
  check('کد مشتری در ستون آخر خروجی است', headerLine.trim().endsWith('کد مشتری'), headerLine);

  const dry = await api('POST', '/import/customers', { csv, dryRun: true }, token);
  check('پیش‌نمایش فایل خروجی بدون خطاست', dry.body.errors.length === 0, JSON.stringify(dry.body.errors));
  const prev = dry.body.preview?.[0] || {};
  check('نام درست خوانده شد', prev.name === 'شرکت آلفا', String(prev.name));
  check('شخص رابط جابه‌جا نشده', prev.contactPerson === 'احمد', String(prev.contactPerson));
  check('تلفن جابه‌جا نشده', prev.phone === '0700111222', String(prev.phone));
  check('بدهی در ستون درست خوانده شد (نه صفر)', prev.openingBalance === 1500, String(prev.openingBalance));
  check('توضیحات جابه‌جا نشده', prev.note === 'یادداشت اول', String(prev.note));

  /* حذف و بازگردانی: همان فایلی که خروجی گرفته‌ایم باید دوباره ثبت شود */
  const list = (await api('GET', '/customers', undefined, token)).body;
  for (const c of list) await api('DELETE', `/customers/${c.id}`, undefined, token);

  const real = await api('POST', '/import/customers', { csv, dryRun: false }, token);
  check('ثبت واقعی ۵۰۰ نمی‌دهد (کد ردیف حذف‌شده قفل نمی‌کند)', real.status === 201, `${real.status} ${JSON.stringify(real.body).slice(0, 120)}`);
  check('ردیف ثبت شد (ردیف حذف‌شده مانع نیست)', real.body.inserted === 1, JSON.stringify(real.body));
  const after = (await api('GET', '/customers', undefined, token)).body;
  const back = after.find((c) => c.name === 'شرکت آلفا');
  check('مشتری با همان تلفن/بدهی برگشت', back && back.phone === '0700111222' && back.openingBalance === 1500,
    JSON.stringify(back && { phone: back.phone, b: back.openingBalance }));
  check('برای کدِ اشغال‌شده هشدار صریح داده شد', (real.body.warnings || []).some((w) => w.includes('کد')), JSON.stringify(real.body.warnings));

  /*
   * ── باگ (شکار باگ دور ۳۴): ستونِ نبوده، مقدار ستون دیگر را می‌گرفت ────────
   * فایل با سرستون ولی بدون «پلیت موتر»: ستون پلیت از ایندکس ۳ خوانده
   * می‌شد، یعنی **باقی اولیه** داخل پلیت می‌نشست و بدهی صفر می‌شد.
   */
  console.log('\n— فایل با سرستون ولی ستون کم —');
  const partial = [
    'نام مشتری/شرکت,شماره تماس,باقی اولیه,شخص رابط',
    'شرکت گاما,0700000,900,کریم',
  ].join('\n');
  const pg = await api('POST', '/import/customers', { csv: partial, dryRun: true }, token);
  const pgRow = (pg.body.preview || [])[0] || {};
  check('پیش‌نمایش: باقی اولیه در ستون درست خوانده شد', pgRow.openingBalance === 900, String(pgRow.openingBalance));
  check('پیش‌نمایش: پلیت موتر خالی است (نه ۹۰۰)', String(pgRow.truckPlate || '') === '', String(pgRow.truckPlate));

  console.log('\n— فایل نامرتب: ستون جابه‌جا، tab، عدد فارسی —');
  const shuffled = [
    'توضیحات\tباقی اولیه\tنام مشتری/شرکت\tشماره تماس',
    '"یادداشت ۲"\t۲۰۰\t"شرکت بتا"\t0799999999',
  ].join('\n');
  const sh = await api('POST', '/import/customers', { csv: shuffled, dryRun: false }, token);
  check('فایل tab-delimited با ستون جابه‌جا ثبت شد', sh.status === 201 && sh.body.inserted === 1, JSON.stringify(sh.body).slice(0, 150));
  const beta = (await api('GET', '/customers', undefined, token)).body.find((c) => c.name === 'شرکت بتا');
  check('بدهی ۲۰۰ با رقم فارسی درست ثبت شد', beta && beta.openingBalance === 200, String(beta && beta.openingBalance));
  check('تلفن در ستون درست نشست', beta && beta.phone === '0799999999', String(beta && beta.phone));

  console.log('\n— امنیت و پیام‌ها —');
  const bad = await api('POST', '/import/customers', { csv: 'نام مشتری/شرکت\n\n,,\n' }, token);
  check('فایل بی‌نام خطای روشن می‌دهد', bad.status === 400 || bad.body.errors?.length > 0, JSON.stringify(bad.body).slice(0, 120));
  const csvInj = await api('POST', '/import/customers', {
    csv: 'نام مشتری/شرکت,شخص رابط\n"=cmd|\' /c calc",x', dryRun: true,
  }, token);
  check('فرمول اکسل در پیش‌نمایش پذیرفته نمی‌شود (بی‌خطر)', csvInj.status === 201 || csvInj.status === 400, String(csvInj.status));
  check('سرور در طول آزمون خطای داخلی نداده', !/Internal server error/i.test(log));

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
