/**
 * تست تمدید لایسنس — از دید مشتری تا دید فروشنده.
 *
 *   npm run test:renew
 *
 * چرا این تست لازم است: «تمدید» تنها کاری است که پول‌ساز است و اگر خراب
 * باشد، مشتری لایسنس تازه می‌گیرد ولی روزهای باقی‌مانده‌اش می‌سوزد یا
 * لایسنس روی دستگاه فعال نمی‌شود. تست مسیر کامل را می‌سنجد:
 *
 *   صدور لایسنس اولیه → ساخت «درخواست تمدید» (همان قالب برنامه) →
 *   خواندن درخواست در ابزار → تمدید → بررسی امضا → بررسی تاریخ‌ها و
 *   اینکه روزهای باقی‌مانده نسوخته باشد.
 *
 * سرور ابزار لایسنس را خودِ تست بالا می‌آورد و در پایان می‌بندد.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4423;

/* روی کلیدهای واقعی پروژه تست نمی‌کنیم — پوشه‌ی موقت */
const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farday-renew-keys-'));

const child = spawn(process.execPath, [path.join(root, 'tools/license/server.mjs')], {
  cwd: root,
  env: { ...process.env, FD_LICENSE_UI_PORT: String(PORT), FD_LICENSE_KEYS_DIR: keyDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });

const BASE = `http://127.0.0.1:${PORT}`;
const ok = (n,c,x='') => console.log(`${c?'  ✔':'  ✘'} ${n}${c?'':' — '+x}`);
let pass=0, fail=0;
const check=(n,c,x='')=>{ if(c)pass++; else fail++; ok(n,c,x); };

/*
 * ⚠ اگر پورتی که می‌خواهیم آزاد نباشد، حتماً یک سرور **قدیمی** آنجاست.
 * در آن حالت تست به سرور قدیمی وصل می‌شود (که ممکن است حفاظ
 * `FD_LICENSE_KEYS_DIR` را نداشته باشد) و می‌تواند کلید عمومی واقعی پروژه
 * را بازنویسی کند — دقیقاً همان چیزی که یک بار رخ داد.
 * پس اول پورت را بررسی می‌کنیم و تمیز شکست می‌خوریم.
 */
{
  let busy = false;
  try { const r = await fetch(BASE + '/api/state'); busy = r.ok || r.status < 500; } catch { busy = false; }
  if (busy) {
    console.error(`\n⛔ پورت ${PORT} از قبل اشغال است — احتمالاً یک اجرای قبلی ابزار لایسنس.`);
    console.error('   اول آن را ببندید (یا کمپیوتر را ری‌استارت کنید) و بعد تست را بزنید.\n');
    process.exit(1);
  }
}

/* آماده‌سازی: صبر تا بالا آمدن، ساخت کلید تازه، گرفتن توکن CSRF */
let up = false;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(BASE + '/api/state'); if (r.ok) { up = true; break; } } catch { /* wait */ }
  if (child.exitCode !== null) break;
  await new Promise((r) => setTimeout(r, 250));
}
if (!up) { console.error('\n⛔ ابزار لایسنس بالا نیامد:\n' + log.slice(-600)); child.kill(); process.exit(1); }
let html = await (await fetch(BASE + '/')).text();
let csrf = (html.match(/CSRF\s*=\s*['"]([^'"]+)/) || [])[1] || '';
{
  const r = await fetch(BASE + '/api/keygen', { method: 'POST', headers: { 'content-type': 'application/json', 'x-license-csrf': csrf }, body: JSON.stringify({ force: true }) });
  if (!r.ok) { console.error('⛔ ساخت کلید تست ناموفق'); child.kill(); process.exit(1); }
  /* بعد از keygen صفحه دوباره خوانده می‌شود تا توکن CSRF تازه بگیریم */
  html = await (await fetch(BASE + '/')).text();
  csrf = (html.match(/CSRF\s*=\s*['"]([^'"]+)/) || [])[1] || '';
}
const post = async (p, b) => {
  const r = await fetch(BASE + p, { method:'POST', headers:{'content-type':'application/json','x-license-csrf':csrf}, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(()=>({})) };
};

const MK = 'A74PA-AW6C7-UAB99-PAPJU-VQWQW';
const today = new Date().toISOString().slice(0,10);
const first = await post('/api/issue', {
  customer: 'شرکت آزمون تمدید', kind: 'custom', start: today, end: today,
  machineKey: MK, seats: 1,
});
check('صدور لایسنس اولیه', first.status === 200, JSON.stringify(first.body).slice(0,150));
const firstId = first.body.id;

// درخواست تمدید — همان قالبی که خودِ برنامه می‌سازد
const reqObj = { kind:'farday-renew-request', v:1, machineKey:MK, currentLicenseId:firstId,
  currentEnd: today, requestedDays: 365, note:'تمدید آزمایشی', createdAt:new Date().toISOString() };
const b64 = Buffer.from(JSON.stringify(reqObj),'utf8').toString('base64url');
const sum = crypto.createHash('sha256').update(b64).digest('hex').slice(0,16);
const reqText = ['-----BEGIN FARDAY RENEW REQUEST-----', b64, 'SUM:'+sum, '-----END FARDAY RENEW REQUEST-----'].join('\n');

/*
 * بررسی محافظِ CSRF روی `renew-parse` (شکار باگ دور ۳۰): این تنها مسیر POST
 * بود که `guardMutation` نداشت و هر صفحه‌ای روی همین کمپیوتر می‌توانست
 * درخواست بفرستد. حالا بدون توکن، ۴۰۰ می‌دهد.
 */
{
  const bare = await fetch(BASE + '/api/renew-parse', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: reqText }),
  });
  check('renew-parse بدون توکن CSRF رد می‌شود', bare.status === 400, String(bare.status));
}

const parsed = await post('/api/renew-parse', { request: reqText });
check('درخواست خوانده می‌شود', parsed.status === 200 && parsed.body.machineKey === MK, JSON.stringify(parsed.body).slice(0,200));
check('checksum سالم است', parsed.body.checksumMismatch !== true);

const badParse = await post('/api/renew-parse', { request: 'سلام' });
check('متن غیرمعتبر رد می‌شود', badParse.status === 400);

const renewed = await post('/api/renew', { request: reqText, days: 365, customer: 'شرکت آزمون تمدید' });
check('تمدید انجام شد', renewed.status === 200, JSON.stringify(renewed.body).slice(0,200));
check('لایسنس جدید صادر شد', renewed.body.id && renewed.body.id !== firstId, String(renewed.body.id));
check('از فردای پایان قبلی شروع می‌شود', renewed.body.extendedFrom === today, String(renewed.body.extendedFrom));
check('به لایسنس قبلی وصل است', renewed.body.renewedFrom === firstId, String(renewed.body.renewedFrom));

const startNext = new Date(today+'T00:00:00Z'); startNext.setUTCDate(startNext.getUTCDate()+1);
check('تاریخ شروع = فردای پایان قبلی', renewed.body.payload.start === startNext.toISOString().slice(0,10),
  `${renewed.body.payload.start} vs ${startNext.toISOString().slice(0,10)}`);
const endExpect = new Date(startNext); endExpect.setUTCDate(endExpect.getUTCDate()+364);
check('تعداد روز درست است (۳۶۵ روز)', renewed.body.payload.end === endExpect.toISOString().slice(0,10),
  `${renewed.body.payload.end} vs ${endExpect.toISOString().slice(0,10)}`);
check('همان کلید دستگاه', renewed.body.payload.machineKey === MK);

// امضا باید معتبر باشد
const verified = await post('/api/verify', { text: renewed.body.text });
check('لایسنس تمدیدشده امضای معتبر دارد', verified.body.ok === true, JSON.stringify(verified.body).slice(0,200));

// فایل خروجی
const f = await fetch(BASE + '/api/file?id=' + encodeURIComponent(renewed.body.id));
const fileBody = await f.json();
check('فایل .lic برای دانلود موجود است', f.status === 200 && /BEGIN FARDAY LICENSE/.test(fileBody.text||''));

// دفتر
const st = await (await fetch(BASE + '/api/state')).json();
const prev = st.items.find((x)=>x.id===firstId);
check('لایسنس قبلی «تمدیدشده» علامت خورد', prev?.renewedBy === renewed.body.id, String(prev?.renewedBy));

child.kill();
try { fs.rmSync(keyDir, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\n${fail===0?'✅':'⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail ? 1 : 0);
