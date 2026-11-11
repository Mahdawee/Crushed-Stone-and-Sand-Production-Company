/**
 * تست «تاریخ‌های لایسنس و گزینه‌های تکراری» — ابزار گرافیکی واقعی.
 *
 *   npm run test:license-dates
 *
 * سه ایراد کاربر:
 *   ۱) «فکر می‌کنم [ابد و قفل دستگاه] عین هم است؛ بهتر نیست فقط یکی بماند.»
 *   ۲) «تاریخ شروع خوب است همیشه امروز باشد و تاریخ شروع و ختم مرتبط با نوع
 *      لایسنس تطبیق شود؛ مثلاً آزمایشی از امروز تا هفت روز.»
 *   ۳) «گزینه‌ی ذخیره به‌عنوان فایل هم بعد از ساخت لایسنس وجود داشته باشد.»
 *
 * سرور ابزار را با پوشه‌ی کلید موقت بالا می‌آورد تا به کلیدهای واقعی پروژه
 * دست نزند.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4431;
const BASE = `http://127.0.0.1:${PORT}`;
const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-dates-keys-'));

let pass = 0, fail = 0;
const problems = [];
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; problems.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✘ ${name} ${extra}`); }
};

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = new Date().toISOString().slice(0, 10);

/* اگر پورتی که می‌خواهیم آزاد نباشد، ممکن است ابزار واقعی آن‌جا باشد */
{
  let busy = false;
  try { const r = await fetch(BASE + '/api/state'); busy = r.ok || r.status < 500; } catch { busy = false; }
  if (busy) {
    console.error(`\n⛔ پورت ${PORT} اشغال است — یک اجرای قبلی ابزار لایسنس را ببندید.\n`);
    process.exit(1);
  }
}

const child = spawn(process.execPath, [path.join(root, 'tools/license/server.mjs')], {
  cwd: root,
  env: { ...process.env, FD_LICENSE_UI_PORT: String(PORT), FD_LICENSE_KEYS_DIR: keyDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });

let up = false;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(BASE + '/api/state'); if (r.ok) { up = true; break; } } catch { /* wait */ }
  if (child.exitCode !== null) break;
  await new Promise((r) => setTimeout(r, 250));
}
check('ابزار لایسنس بالا آمد', up, log.slice(-400));
if (!up) { try { child.kill(); } catch { /* */ } finish(); }

let html = await (await fetch(BASE + '/')).text();
let csrf = (html.match(/CSRF\s*=\s*['"]([^'"]+)/) || [])[1] || '';
const post = async (p, b) => {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-license-csrf': csrf },
    body: JSON.stringify(b),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

{
  const r = await fetch(BASE + '/api/keygen', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-license-csrf': csrf },
    body: JSON.stringify({ force: true }),
  });
  check('جفت‌کلید تست ساخته شد', r.ok, String(r.status));
}

/* ================================================================ */
console.log('\n— نوع دوره: یکی از دو گزینه‌ی تکراری —');

const st = await (await fetch(BASE + '/api/state')).json();
const meta = st.kindMeta || [];
const issuable = meta.filter((m) => m.issuable !== false).map((m) => m.value);
check('فراداده‌ی نوع‌ها از سرور می‌آید', meta.length >= 5, JSON.stringify(meta.map((m) => m.value)));
check('«ابد» در گزینه‌های صدور هست', issuable.includes('perpetual'), issuable.join('|'));
check('«فقط قفل دستگاه» از گزینه‌های صدور حذف شد', !issuable.includes('machine'), issuable.join('|'));
check('نوع قدیمی «machine» فقط برای خواندن شناخته می‌شود', meta.some((m) => m.value === 'machine' && m.issuable === false));
check('هیچ دو گزینه‌ای هم‌معنی نمانده‌اند',
  issuable.filter((k) => ['perpetual', 'machine'].includes(k)).length === 1, issuable.join('|'));
check('صفحه دیگر جدول نوع‌های خودش را ندارد',
  !/monthly:\{label:/.test(html) && /kindMeta/.test(html));

/* ================================================================ */
console.log('\n— تاریخ شروع همیشه امروز —');

/* اعداد فارسی‌اند، پس قبل از الگو به لاتین تبدیل می‌شوند */
const lat = (x) => String(x || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
check('سرور تاریخ امروز شمسی را برای فورم می‌دهد', /^1\d{3}\/\d{2}\/\d{2}$/.test(lat(st.todayJalali)),
  String(st.todayJalali));
/*
 * تاریخ شمسی امروز باید همان «امروزِ میلادی» باشد — با جابه‌جایی تقویم،
 * لایسنس یک روز جلو/عقب می‌افتد و همان باگ «معتبر نیست» برمی‌گردد.
 */
{
  /* jalaali-js یک ماژول CommonJS است — default ندارد */
  const jm = await import('jalaali-js');
  const jalaali = jm.default || jm;
  const [gy, gm, gd] = today.split('-').map(Number);
  const j = jalaali.toJalaali(gy, gm, gd);
  const expect = `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
  check('تاریخ شمسی امروز با تقویم جلالی یکی است', lat(st.todayJalali) === expect,
    `${lat(st.todayJalali)} vs ${expect}`);
}
check('تاریخ شمسی امروز با تقویم درست است (نه ۰۱/۰۱)',
  !/\/01\/01$/.test(String(st.todayJalali || '')) || today.startsWith(new Date().toISOString().slice(0, 4) + '-01-01'),
  String(st.todayJalali));
check('کادر تاریخ شروع در صفحه فقط‌خواندنی است', /id="start"[^>]*readonly/.test(html));
check('صفحه دیگر تاریخ شروع را با محاسبه‌ی ساختگی نمی‌سازد', !/Number\(\) \+ 1;\s*\n\s*return String\(jy\) \+ '\/01\/01'/.test(html));

/* هر نوع: شروع = امروز، پایان مطابق نوع */
const expects = { trial: 7, monthly: 30, yearly: 365 };
for (const [kind, days] of Object.entries(expects)) {
  const r = await post('/api/issue', { customer: 'آزمون ' + kind, kind, start: st.todayJalali, seats: 1 });
  check(`صدور «${kind}» موفق`, r.status === 200 && r.body.payload, JSON.stringify(r.body).slice(0, 160));
  if (r.body?.payload) {
    check(`«${kind}»: شروع = امروز`, r.body.payload.start === today,
      `${r.body.payload.start} ≠ ${today}`);
    check(`«${kind}»: پایان = امروز + ${days - 1} روز`, r.body.payload.end === addDays(today, days - 1),
      `${r.body.payload.end} vs ${addDays(today, days - 1)}`);
  }
}

/* آزمایشی با تاریخ شروع آینده → با امروز جایگزین می‌شود، نه اینکه لایسنس باطل باشد */
const future = await post('/api/issue', {
  customer: 'آزمون آینده', kind: 'trial', start: addDays(today, 40), seats: 1,
});
check('تاریخ شروع آینده جایگزین امروز می‌شود',
  future.body?.payload?.start === today, String(future.body?.payload?.start));
check('پاسخ می‌گوید تاریخ جایگزین شد', /جایگزین/.test(String(future.body?.message || '')), String(future.body?.message));

/* پایان ناسازگار: آزمایشی با پایان یک‌ساله باید رد شود */
const mismatch = await post('/api/issue', {
  customer: 'آزمون ناسازگار', kind: 'trial', start: st.todayJalali, end: addDays(today, 364), seats: 1,
});
check('پایانِ ناسازگار با نوع «آزمایشی» رد می‌شود', mismatch.status === 400, String(mismatch.status));
check('پیام خطا راه درست را می‌گوید', /دلخواه/.test(String(mismatch.body?.message || '')), String(mismatch.body?.message));

/* «ابد» بی‌پایان است، حتی اگر تاریخ پایان بفرستیم */
const perp = await post('/api/issue', { customer: 'آزمون ابد', kind: 'perpetual', end: addDays(today, 10), seats: 1 });
check('«ابد» پایان ندارد', perp.body?.payload?.end === null, JSON.stringify(perp.body?.payload?.end));
check('«ابد» شروعش امروز است', perp.body?.payload?.start === today, String(perp.body?.payload?.start));

/* «دلخواه» بازه‌ی دستی را نگه می‌دارد */
const custom = await post('/api/issue', {
  customer: 'آزمون دلخواه', kind: 'custom', start: st.todayJalali, end: addDays(today, 100), seats: 1,
});
check('«دلخواه» بازه‌ی دستی را نگه می‌دارد', custom.body?.payload?.end === addDays(today, 100),
  String(custom.body?.payload?.end));

/* نوع قدیمی هنوز معتبر است */
const legacy = await post('/api/issue', { customer: 'قدیمی', kind: 'machine', seats: 1 });
check('نوع قدیمی «machine» هنوز پذیرفته می‌شود (لایسنس‌های قبلی)', legacy.status === 200,
  `${legacy.status} ${JSON.stringify(legacy.body).slice(0, 120)}`);
check('«machine» هم مثل «ابد» بی‌پایان است', legacy.body?.payload?.end === null, String(legacy.body?.payload?.end));

/* ================================================================ */
console.log('\n— ذخیره به‌عنوان فایل بعد از ساخت —');

const issued = await post('/api/issue', { customer: 'آزمون فایل', kind: 'monthly', start: st.todayJalali, seats: 1 });
const id = issued.body?.id;
check('پاسخ صدور آدرس ذخیره‌ی فایل را می‌دهد', /^\/api\/download\?id=/.test(String(issued.body?.downloadUrl || '')),
  String(issued.body?.downloadUrl));
check('پاسخ می‌گوید فایل کجا ذخیره شد', Boolean(issued.body?.savedFile), String(issued.body?.savedFile));

const dl = await fetch(BASE + issued.body?.downloadUrl);
check('دانلود فایل .lic کار می‌کند', dl.status === 200, String(dl.status));
check('فایل با نام درست و به‌صورت پیوست می‌آید',
  /attachment/.test(dl.headers.get('content-disposition') || '') &&
  String(dl.headers.get('content-disposition')).includes(`${id}.lic`),
  String(dl.headers.get('content-disposition')));
const dlText = await dl.text();
check('محتوای فایل همان لایسنس امضاشده است',
  dlText.includes('BEGIN FARDAY LICENSE') && dlText.trim() === String(issued.body?.text || '').trim());

const bad = await fetch(BASE + '/api/download?id=../../etc/passwd');
check('شناسه‌ی نامعتبر برای دانلود رد می‌شود', bad.status === 400, String(bad.status));

check('صفحه دکمه‌ی «ذخیره فایل .lic» بعد از ساخت دارد', /saveIssuedFile|ذخیره فایل \.lic/.test(html));
check('دکمه‌ی ذخیره در کادر خروجی صدور است',
  /id="issueOut"[\s\S]{0,900}saveIssuedFile/.test(html));

/* فایل شماره‌گذاری‌شده در دفتر */
const ledger = await (await fetch(BASE + '/api/state')).json();
const row = (ledger.items || []).find((x) => x.id === id);
check('لایسنس در دفتر ثبت شد', Boolean(row), String(id));
check('وضعیت «فعال» و بازه‌ی درست', row?.state === 'active', String(row?.state));
check('برچسب فارسی پایان دارد', Boolean(row?.endLabel) && row.endLabel !== 'ابد', String(row?.endLabel));

/* ================================================================ */
console.log('\n— خط فرمان: همان قاعده‌ی تاریخ‌ها —');

{
  const { execFileSync } = await import('node:child_process');
  const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-cli-keys-'));
  const realBefore = fs.existsSync(path.join(root, 'license-keys', 'issued.json'))
    ? fs.readFileSync(path.join(root, 'license-keys', 'issued.json'), 'utf8') : '';
  const cli = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [path.join(root, 'scripts/license-tool.mjs'), ...args], {
        cwd: root, env: { ...process.env, FD_LICENSE_KEYS_DIR: cliDir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }) };
    } catch (e) { return { code: e.status || 1, out: String(e.stdout || '') + String(e.stderr || '') }; }
  };
  /* کلیدهای داخل بسته — نباید با keygen در پوشه‌ی موقت عوض شوند */
  const bundled = [
    'src-tauri/public-key/farday-public.b64',
    'apps/api/public-key/farday-public.b64',
    'src-tauri/seal/public-key.txt',
  ].map((f) => path.join(root, f));
  const readAll = () => bundled.map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''));
  const bundledBefore = readAll();
  cli(['keygen']);
  check('خط فرمان پوشه‌ی کلید موقت را می‌پذیرد (FD_LICENSE_KEYS_DIR)',
    fs.existsSync(path.join(cliDir, 'private.key')));
  check('keygen با پوشه‌ی جایگزین، کلید داخل بسته را عوض نمی‌کند',
    JSON.stringify(bundledBefore) === JSON.stringify(readAll()),
    'کلید داخل بسته عوض شد — لایسنس‌های واقعی‌اند که باطل می‌شوند');
  const r1 = cli(['issue', '--customer', 'تست CLI', '--kind', 'trial']);
  check('CLI: «آزمایشی» صادر شد', r1.code === 0, r1.out.slice(0, 200));
  check('CLI: شروع امروز و پایان امروز+۶ است', r1.out.includes(today) && r1.out.includes(addDays(today, 6)),
    r1.out.split('\n').filter((l) => l.includes('شروع')).join(' '));
  check('CLI: فایل را در پوشه‌ی موقت ذخیره می‌کند', r1.out.includes(cliDir), r1.out.slice(0, 300));
  const r2 = cli(['issue', '--customer', 'تست CLI', '--kind', 'trial', '--end', addDays(today, 364)]);
  check('CLI: پایان ناسازگار رد می‌شود', r2.code !== 0 && /دلخواه/.test(r2.out), r2.out.slice(0, 200));
  const r3 = cli(['issue', '--customer', 'تست CLI', '--kind', 'machine']);
  check('CLI: گزینه‌ی تکراری «machine» دیگر پذیرفته نمی‌شود', r3.code !== 0 && /نوع لایسنس/.test(r3.out),
    r3.out.slice(0, 160));
  check('CLI: «ابد» هنوز کار می‌کند', cli(['issue', '--customer', 'تست', '--kind', 'perpetual']).code === 0);
  /* هیچ نوشتنی در license-keys واقعی نشود */
  const realAfter = fs.existsSync(path.join(root, 'license-keys', 'issued.json'))
    ? fs.readFileSync(path.join(root, 'license-keys', 'issued.json'), 'utf8') : '';
  check('CLI به دفتر لایسنس‌های واقعی پروژه دست نزد', realBefore === realAfter);
  try { fs.rmSync(cliDir, { recursive: true, force: true }); } catch { /* */ }
}

/* ================================================================ */
console.log('\n— مستندات هم‌خوان —');
{
  const doc = fs.readFileSync(path.join(root, 'docs/LICENSE.md'), 'utf8');
  check('راهنما دیگر «فقط قفل دستگاه» را به‌عنوان نوع جدا ندارد',
    !/--kind machine/.test(doc), 'docs/LICENSE.md');
}

try { child.kill(); } catch { /* */ }
try { fs.rmSync(keyDir, { recursive: true, force: true }); } catch { /* */ }
finish();

function finish() {
  console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
  if (problems.length) console.log('مشکل‌ها:\n - ' + problems.join('\n - '));
  process.exit(fail === 0 ? 0 : 1);
}
