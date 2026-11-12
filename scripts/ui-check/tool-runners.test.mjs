/**
 * تست زنده‌ی اجراکننده‌ها و منطق مشترک ابزارهای بیرونی.
 *
 *   node scripts/ui-check/tool-runners.test.mjs
 *
 * ── چرا این تست (دور ۳۶) ────────────────────────────────────────────────
 * کاربر گزارش کرد «اجراکننده‌ها ابزار را باز نمی‌کنند». تست‌های قبلی فقط
 * **متن** فایل‌ها را می‌خواندند (`/start ""/.test(cmd)`)، پس باگی که در
 * رفتار واقعی بود دیده نمی‌شد. این تست ابزارها را واقعاً اجرا می‌کند:
 *   • سرور بالا می‌آید و صفحه را سرو می‌کند
 *   • `/__tool` شناسه‌ی درست را می‌دهد
 *   • پورت اشغال → پورت بعدی آزاد (نه مرگ با EADDRINUSE)
 *   • نسخه‌ی دوم همان ابزار → بازاستفاده، نه نسخه‌ی دوم
 *   • مرورگر: شکست باز کردن (ENOENT) سرور را نمی‌کشد ← باگ واقعی
 *   • `--port` کار می‌کند و اجراکننده‌های شل واقعاً بالا می‌آورند
 *   • `start.cmd` پایان‌خط CRLF دارد و هیچ `timeout /t` ندارد
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** یک پورت آزاد پیدا کن (با bind آزمایشی روی 0). */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** پورت را اشغال کن و سرور را برگردان. */
function occupy(port) {
  return new Promise((resolve, reject) => {
    const s = http.createServer((q, res) => res.end('occupied'));
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

/** HTTP GET ساده با مهلت. */
function get(port, pathName, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathName, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

/** تا وقتی شرط برقرار شود صبر کن. */
async function waitFor(fn, tries = 40, ms = 150) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await sleep(ms);
  }
  return false;
}

/** اجرای یک ابزار در پس‌زمینه با محیط کنترل‌شده. */
function runTool(tool, env, args = [], useShellRunner = false) {
  const cmd = useShellRunner ? 'bash' : process.execPath;
  const cmdArgs = useShellRunner
    ? [path.join(root, 'tools', tool, 'start.sh'), ...args]
    : [path.join(root, 'tools', tool, 'server.mjs'), ...args];
  const child = spawn(cmd, cmdArgs, {
    cwd: root,
    env: { ...process.env, FD_NO_BROWSER: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (b) => { out += b.toString('utf8'); });
  child.stderr.on('data', (b) => { out += b.toString('utf8'); });
  const done = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
  return { child, done, out: () => out };
}

/* ================================================================== */
console.log('\n— پورت آزاد و «همان ابزار از قبل باز است؟» —');
let base = 0;
{
  base = await freePort();
  const t1 = runTool('reset-ui', { FD_RESET_UI_PORT: String(base) });
  const up = await waitFor(async () => (await get(base, '/__tool')).status === 200);
  ok('سرور ابزار «صفر کردن» بالا می‌آید', up, t1.out().slice(0, 300));

  const tool = await get(base, '/__tool');
  let meta = {};
  try { meta = JSON.parse(tool.body); } catch { /* پایین بررسی می‌شود */ }
  ok('/__tool شناسه‌ی درست را می‌دهد', meta.tool === 'reset-ui', tokenLabel(meta));
  ok('/__tool پورت واقعی را می‌دهد', Number(meta.port) === base, String(meta.port));

  const page = await get(base, '/');
  ok('صفحه‌ی ابزار سرو می‌شود', page.status === 200 && page.body.includes('<!doctype html') || page.body.includes('<html'));
  ok('صفحه توکن CSRF دارد', /__CSRF__/.test(page.body) === false && page.body.length > 500);

  /* نسخه‌ی دوم روی همان پورت: باید بازاستفاده کند، نه پورت تازه */
  const t2 = runTool('reset-ui', { FD_RESET_UI_PORT: String(base) });
  await sleep(1200);
  ok('نسخه‌ی دوم روی همان پورت پیام «از قبل باز است» می‌دهد',
    /از قبل روی .* باز است/.test(t2.out()), t2.out().slice(0, 200));
  /* و نسخه‌ی دوم نباید سرور اول را کشته باشد */
  ok('نسخه‌ی اول بعد از تلاش دوم هنوز زنده است', (await get(base, '/__tool')).status === 200);
  t2.child.kill('SIGTERM');
  await t2.done;
  t1.child.kill('SIGTERM');
  await t1.done;
}

console.log('\n— پورت اشغال: پورت بعدی آزاد (نه مرگ با EADDRINUSE) —');
{
  const busy = await freePort();
  const blocker = await occupy(busy);
  const t = runTool('reset-ui', { FD_RESET_UI_PORT: String(busy) });
  const moved = await waitFor(async () => (await get(busy + 1, '/__tool')).status === 200);
  ok('پورت اشغال بود، سرور روی پورت بعدی بالا آمد', moved, t.out().slice(0, 300));
  ok('پیام فارسی می‌گوید پورت عوض شد', /پورت \d+ اشغال بود/.test(t.out()), t.out().slice(0, 200));
  const alive = t.child.exitCode === null;
  ok('سرور با EADDRINUSE نمی‌میرد', alive);
  t.child.kill('SIGTERM');
  await t.done;
  blocker.close();
}

console.log('\n— شکست باز کردن مرورگر نباید سرور را بکشد (باگ واقعی) —');
{
  const port = await freePort();
  /*
   * روی لینوکس `xdg-open` معمولاً نیست → spawn با ENOENT رویداد خطا می‌دهد.
   * نسخه‌ی قبلی آن را نمی‌گرفت و کل پروسه با
   *   Unhandled 'error' event … spawn xdg-open ENOENT
   * می‌مرد. حالا باید زنده بماند.
   */
  const t = spawn(process.execPath, [path.join(root, 'tools', 'reset-ui', 'server.mjs')], {
    cwd: root,
    env: { ...process.env, FD_RESET_UI_PORT: String(port) }, // FD_NO_BROWSER عمداً نیست
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  t.stdout.on('data', (b) => { out += b.toString('utf8'); });
  t.stderr.on('data', (b) => { out += b.toString('utf8'); });
  const up = await waitFor(async () => (await get(port, '/__tool')).status === 200);
  await sleep(600);
  ok('سرور با تلاش ناموفق باز کردن مرورگر زنده می‌ماند', up && t.exitCode === null, out.slice(0, 400));
  ok('خطای ENOENT در خروجی نیست', !/Unhandled 'error' event/.test(out), out.slice(0, 200));
  t.kill('SIGTERM');
}

console.log('\n— --port و اجراکننده‌ی شل —');
{
  const port = await freePort();
  const t = runTool('license', {}, ['--port', String(port)]);
  const up = await waitFor(async () => (await get(port, '/__tool')).status === 200);
  ok('ابزار لایسنس با --port بالا می‌آید', up, t.out().slice(0, 300));
  let meta = {};
  try { meta = JSON.parse((await get(port, '/__tool')).body); } catch { /* */ }
  ok('شناسه‌ی ابزار لایسنس درست است', meta.tool === 'license', JSON.stringify(meta));
  t.child.kill('SIGTERM');
  await t.done;

  /* اجراکننده‌ی شل (همان فایلی که کاربر اجرا می‌کند) */
  const p2 = await freePort();
  const sh = runTool('reset-ui', { FD_RESET_UI_PORT: String(p2) }, [], true);
  const upSh = await waitFor(async () => (await get(p2, '/__tool')).status === 200);
  ok('start.sh واقعاً سرور را بالا می‌آورد', upSh, sh.out().slice(0, 300));
  sh.child.kill('SIGTERM');
  await sh.done;
}

console.log('\n— اجراکننده‌ی ویندوز (ایستا: cmd.exe با LF می‌شکند) —');
{
  for (const tool of ['reset-ui', 'license']) {
    const f = path.join(root, 'tools', tool, 'start.cmd');
    const buf = fs.readFileSync(f);
    const s = buf.toString('utf8');
    ok(`${tool}/start.cmd پایان‌خط CRLF دارد`, buf.includes(Buffer.from('\r\n')));
    ok(`${tool}/start.cmd هیچ خط LF تنها ندارد`, !/[^\r]\n/.test(s.replace(/\r\n/g, '')));
    ok(`${tool}/start.cmd تأخیر حدسی ندارد (کار سرور است)`, !/timeout \/t/.test(s));
    ok(`${tool}/start.cmd مرورگر را خودش باز نمی‌کند`, !/^start .*http/m.test(s));
    ok(`${tool}/start.cmd سرور را صدا می‌زند`, /server\.mjs/.test(s));
    ok(`${tool}/start.cmd برای نبود Node پیام فارسی دارد`, /Node\.js/.test(s));
  }
  const ga = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  ok('.gitattributes CRLF را برای *.cmd تحمیل می‌کند', /\*\.cmd\s+text\s+eol=crlf/.test(ga));
}

function tokenLabel(meta) { return JSON.stringify(meta).slice(0, 120); }

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
