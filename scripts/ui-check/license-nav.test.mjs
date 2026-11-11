/**
 * بررسی «برگشت از صفحه‌ی لایسنس».
 *
 *   node scripts/ui-check/license-nav.test.mjs
 *
 * ## باگی که این تست از بازگشتش جلوگیری می‌کند
 * کاربر: «حالا نیز از صفحه لایسنس برگشت نمی‌شود به برنامه؛ این مشکل است و
 * باید رفع شود.»
 *
 * علت واقعی: صفحه‌ی لایسنس با `<a href="#/license">` باز می‌شد. `href`
 * باعث **بارگذاری کامل سند** می‌شود؛ بعد از آن مسیر `#/license` می‌ماند و
 * `sessionStorage` تازه است، پس «تأیید شروع» از دست می‌رفت و کاربر دوباره
 * در صفحه‌ی شروع/لایسنس زندانی می‌شد. هیچ دکمه‌ی برگشتی هم نبود.
 *
 * این تست سه چیز را می‌سنجد (بدون مرورگر، با تحلیل واقعی سورس):
 *   ۱) هیچ لینک `href="#/license"` نمانده باشد (علت ریشه‌ای).
 *   ۲) صفحه‌ی لایسنس راه برگشت داشته باشد (`onBack`) و دکمه‌اش رندر شود.
 *   ۳) مسیر `/license` در Shell قبل از گیت‌ها گرفته شود و در حالت قفل،
 *      برگشت داده نشود (چون برنامه بسته است).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name}${extra ? ' → ' + extra : ''}`); }
};

const app = read('apps/web/src/App.tsx');
const lic = read('apps/web/src/pages/License.tsx');
const start = read('apps/web/src/pages/StartupLicense.tsx');
const pages = fs.readdirSync(path.join(root, 'apps/web/src/pages'))
  .filter((f) => f.endsWith('.tsx'));

console.log('\n— علت ریشه‌ای: ناوبری با href —');
{
  /* هر href="#/..." در هر صفحه/کامپوننت: ناوبری SPA را می‌شکند */
  const offenders = [];
  const scan = (dir) => {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      const full = path.join(root, dir, f);
      const st = fs.statSync(full);
      if (st.isDirectory()) { scan(path.join(dir, f)); continue; }
      if (!/\.(tsx|ts)$/.test(f)) continue;
      const src = fs.readFileSync(full, 'utf8');
      /* فقط href به مسیرهای داخلی */
      const m = src.match(/href=["'`]#\//g);
      if (m) offenders.push(`${dir}/${f} (${m.length})`);
    }
  };
  scan('apps/web/src');
  ok('هیچ ناوبری داخلی با href="#/…" نمانده', offenders.length === 0, offenders.join(', '));
}

console.log('\n— صفحه‌ی لایسنس راه برگشت دارد —');
ok('LicensePage پراپ onBack می‌گیرد', /onBack\?: \(\) => void/.test(lic));
ok('دکمه‌ی «بازگشت به برنامه» رندر می‌شود', /بازگشت به برنامه/.test(lic));
ok('دکمه فقط وقتی برنامه باز است نشان داده می‌شود', /canContinue && onBack/.test(lic));
ok('در حالت قفل، پیام «برنامه قفل است» هست', /برنامه قفل است/.test(lic));
ok('لینک قدیمی «بازگشت به ورود» حذف شده', !/بازگشت به ورود/.test(lic));

console.log('\n— صفحه‌ی شروع: ادامه با کلیک/키보드 —');
ok('StartupLicense مسیر بازگشت می‌گیرد', /onContinue/.test(start));
ok('Escape/Enter هم ادامه می‌دهد', /Escape/.test(start) && /Enter/.test(start));
ok('دکمه‌ی «ورود به برنامه» هست', /ورود به برنامه/.test(start));
ok('لینک‌های href جای خود را به دکمه داده‌اند', !/href="#\/license"/.test(start));

console.log('\n— ترتیب گیت‌ها در Shell —');
{
  const shell = app.slice(app.indexOf('function Shell()'), app.indexOf('export default function App()'));
  const iLicense = shell.indexOf("location.pathname === '/license'");
  const iBoot = shell.indexOf('!acknowledged && isPlainRoute');
  const iLock = shell.indexOf('if (license && !license.ok)');
  ok('مسیر /license قبل از صفحه‌ی شروع بررسی می‌شود', iLicense > -1 && iLicense < iBoot);
  ok('مسیر /license قبل از قفل لایسنس بررسی می‌شود', iLicense > -1 && iLicense < iLock);
  ok('صفحه‌ی شروع فقط در مسیرهای عادی می‌آید (نه همه‌چیز)', /isPlainRoute/.test(shell));
  ok('در حالت قفل، صفحه‌ی ورود هم باز است', /path="\/login"[\s\S]{0,200}license/.test(shell));
  ok('برگشت با مسیر امن انجام می‌شود، نه history.back', /navigate\(back, \{ replace: true \}\)/.test(shell));
  ok('مسیر برگشت در sessionStorage نگه داشته می‌شود', /RETURN_KEY/.test(app));
  ok('مسیر برگشت به /license نمی‌افتد (حلقه نشود)', /startsWith\('\/license'\)/.test(shell));
}

console.log('\n— دکمه‌ی «راهنما» در صفحه‌ی لایسنس (باگ دور ۳۴) —');
{
  /*
   * باگ: `onHelp` کاربر را به `/help` می‌برد، ولی وقتی لایسنس نامعتبر است
   * گیت `if (license && !license.ok)` هر مسیری جز `/login` و `/license` را
   * به `/license` برمی‌گرداند — یعنی دکمه‌ی راهنما درست وقتی که کاربر به آن
   * نیاز داشت، هیچ کاری نمی‌کرد. حالا راهنما داخل همان صفحه باز می‌شود.
   */
  const lic = fs.readFileSync(path.join(root, 'apps', 'web', 'src', 'pages', 'License.tsx'), 'utf8');
  ok('کارت راهنما شناسه‌ی license-help دارد', /id="license-help"/.test(lic));
  ok('دکمه‌ی راهنما به مسیر /help ناوبری نمی‌کند', !/navigate\('\/help'\)/.test(app), 'مسیر /help زیر گیت لایسنس بسته است');
  ok('دکمه‌ی راهنما داخل صفحه اسکرول/برجسته می‌کند',
    /getElementById\('license-help'\)/.test(app) && /scrollIntoView/.test(app));
}

console.log('\n— مسیر /license فقط یک بار تعریف شده —');
{
  const count = (app.match(/path="\/license"/g) || []).length;
  ok('تعریف تکراری مسیر /license نمانده', count <= 1, String(count));
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
