/**
 * محافظ‌های API — تست‌های «ضد بازگشتِ باگ» برای ورودی خراب.
 *
 *   node scripts/ui-check/api-guards.test.mjs
 *
 * چرا: در فاز تست (fuzz) سه باگ واقعی پیدا شد که هیچ تستی نمی‌گرفت‌شان:
 *
 *  ۱) `parseUserDate` استثنای ساده (`Error`) می‌اندازد نه `HttpException`.
 *     هر جا این تابع **بیرون از try** صدا زده شود، کاربر به‌جای پیام فارسی
 *     «تاریخ درست نیست…» پاسخ ۵۰۰ Internal server error می‌گیرد.
 *     (واقعاً اتفاق افتاده بود: `GET /reports/daily?from=bad` و
 *      `POST /salaries/sheet` با `payDate:''` و `GET /sales/next-no?date=bad`).
 *
 *  ۲) `PUT /settings` هیچ اعتبارسنجی نداشت: `{"calendar":"martian"}` با
 *     کد ۲۰۰ ذخیره می‌شد و بعد از آن تقویم/گزارش‌ها رفتار پیش‌بینی‌ناپذیر
 *     داشتند. حالا هر کلید باید قاعده داشته باشد (SETTING_RULES).
 *
 * این فایل هم ثابت‌های کد را می‌خواند (بدون اجرای سرور) تا مطمئن شویم
 * کسی دوباره این محافظ‌ها را حذف نمی‌کند.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modDir = path.join(root, 'apps/api/src/modules');
const commonDir = path.join(root, 'apps/api/src/common');

let pass = 0,
  fail = 0;
const ok = (n, c, extra = '') => {
  c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`));
};

/**
 * فراخوانی‌های `name(` را پیدا می‌کند که **داخل هیچ بلوک try ای** نیستند.
 * ردیابی آکولاد ساده است ولی برای TS کنترلرها کافی و دقیق است.
 */
function unguardedCalls(src, name) {
  const out = [];
  const re = new RegExp(`try\\s*\\{|\\{|\\}|${name}\\s*\\(`, 'g');
  const tryDepths = [];
  let depth = 0;
  let m;
  while ((m = re.exec(src))) {
    const t = m[0];
    if (t.startsWith('try')) {
      /* `try {` — خود آکولاد را در همین توکن شمردیم */
      tryDepths.push(depth);
      depth++;
    } else if (t === '{') {
      depth++;
    } else if (t === '}') {
      depth--;
      while (tryDepths.length && tryDepths[tryDepths.length - 1] > depth) tryDepths.pop();
      while (tryDepths.length && tryDepths[tryDepths.length - 1] === depth) tryDepths.pop();
    } else {
      if (!tryDepths.length) {
        const line = src.slice(0, m.index).split('\n').length;
        out.push(line);
      }
    }
  }
  return out;
}

console.log('\n— محافظ تاریخ (parseUserDate باید داخل try باشد) —');

const controllers = fs.readdirSync(modDir).filter((f) => f.endsWith('.controller.ts'));
let totalCalls = 0;
for (const f of controllers) {
  const src = fs.readFileSync(path.join(modDir, f), 'utf8');
  const calls = (src.match(/parseUserDate\s*\(/g) || []).length;
  if (!calls) continue;
  totalCalls += calls;
  const bad = unguardedCalls(src, 'parseUserDate');
  ok(`${f}: همه‌ی ${calls} فراخوانی parseUserDate داخل try هستند`, bad.length === 0,
    `خط(های) ${bad.join(', ')} → پاسخ ۵۰۰ به‌جای ۴۰۰`);
}
ok('کنترلرها واقعاً parseUserDate را استفاده می‌کنند (تست بی‌اثر نشده)', totalCalls >= 10, String(totalCalls));

/* گزارش روزانه — همان جایی که باگ ۵۰۰ واقعاً رخ داد */
const reports = fs.readFileSync(path.join(modDir, 'reports.controller.ts'), 'utf8');
ok('راپور روزانه: start/end داخل try محاسبه می‌شوند',
  /try\s*\{[^}]*start\s*=\s*from\s*\?\s*parseUserDate/.test(reports));

/* ورق معاش — ماه/کارمند نامعتبر نباید سند یتیم بسازد */
const salaries = fs.readFileSync(path.join(modDir, 'salaries.controller.ts'), 'utf8');
ok('ورق معاش: ماه ۱..۱۲ اعتبارسنجی می‌شود', /my\s*<\s*1|mm\s*<\s*1/.test(salaries));
ok('ورق معاش: وجود کارمند قبل از ذخیره بررسی می‌شود', /FROM "Employee" WHERE "id"=\?/.test(salaries));
ok('ورق معاش: ورق خالی رد می‌شود', /Array\.isArray\(body\.rows\)/.test(salaries));

console.log('\n— محافظ تنظیمات (بدون لیست سفید، مقدار خراب ذخیره می‌شد) —');

const settingsSrc = fs.readFileSync(path.join(commonDir, 'settings.ts'), 'utf8');
ok('SETTING_RULES وجود دارد', /export const SETTING_RULES/.test(settingsSrc));
ok('SETTING_RULES اعتبارسنجیِ calendar دارد', /calendar:\s*\(v\)\s*=>/.test(settingsSrc));
ok('setMany اول اعتبارسنجی می‌کند و بعد ذخیره', /SettingsService\.validate\(k, v\)/.test(settingsSrc));
ok('کلید ناشناخته ذخیره نمی‌شود (SKIP_UNKNOWN)', /SKIP_UNKNOWN/.test(settingsSrc));

/* هر کلید پیش‌فرض باید یا قاعده‌ی مقدار یا قاعده‌ی پیشوند داشته باشد */
const defaultsBlock = settingsSrc.match(/DEFAULT_SETTINGS[^{]*\{([\s\S]*?)\n\};/);
const keys = defaultsBlock ? [...defaultsBlock[1].matchAll(/^\s{2}(\w+):/gm)].map((x) => x[1]) : [];
ok('کلیدهای پیش‌فرض خوانده شدند', keys.length >= 15, String(keys.length));
const prefixKeys = (settingsSrc.match(/const PREFIX_KEYS = \[([^\]]*)\]/) || [, ''])[1];
const missing = keys.filter((k) => {
  if (prefixKeys.includes(`'${k}'`)) return false;
  return !new RegExp(`\\b${k}:\\s*\\(v\\)`).test(settingsSrc);
});
ok('برای هر کلید پیش‌فرض قاعده‌ی اعتبارسنجی هست', missing.length === 0, missing.join(', '));

const company = fs.readFileSync(path.join(modDir, 'company.controller.ts'), 'utf8');
ok('PUT /settings پیش از ذخیره اعتبارسنجی می‌کند و ۴۰۰ می‌دهد',
  /SettingsService\.validate\(k, v\)[\s\S]{0,160}HttpException\(err, 400\)/.test(company));

console.log('\n— یکتایی منبع حقیقت و محافظ‌های ثبت —');

const sales = fs.readFileSync(path.join(modDir, 'sales.controller.ts'), 'utf8');
ok('جمع کرایه فقط از متراژ × کرایه فی متر (یک منبع حقیقت)',
  /volume \* unitPrice \+ freightTotal/.test(sales) && !/sentFreight/.test(sales));
ok('ویرایش فروش، وجود مشتری را بررسی می‌کند', /UPDATE \"Sale\"[\s\S]{0,200}/.test(sales) && /مشتری پیدا نشد/.test(sales));
const delGuards = ['sales.controller.ts', 'receipts.controller.ts', 'expenses.controller.ts', 'salaries.controller.ts']
  .map((f) => [f, fs.readFileSync(path.join(modDir, f), 'utf8')]);
for (const [f, src] of delGuards) {
  /* حذف شناسه‌ی ناموجود باید ۴۰۴ بدهد، نه ۲۰۰ و یک ردیف ساختگی در فعالیت‌ها */
  const deleteBlock = src.slice(src.indexOf("@Delete(':id')"));
  ok(`${f}: حذف شناسه‌ی ناموجود ۴۰۴ می‌دهد`, /if \(!rows\?\.length\) throw new HttpException/.test(deleteBlock));
}

console.log('\n— کارایی (بدون بازگشت به مسیرهای کند) —');
const reportsSrc = fs.readFileSync(path.join(modDir, 'reports.controller.ts'), 'utf8');
ok('راپور روزانه با کوئری گروهی است (نه ۶ کوئری برای هر روز)',
  /private async rangeRows/.test(reportsSrc) && !/for \(const d of \[...days\]\.reverse\(\)\)/.test(reportsSrc));
ok('داشبورد نمودار ۱۴ روزه را با کوئری گروهی می‌سازد', /GROUP BY \"date\"/.test(reportsSrc));
const schemaSrc = fs.readFileSync(path.join(root, 'apps/api/src/schema.ts'), 'utf8');
ok('بررسی ستون‌ها در هر درخواست تکرار نمی‌شود (کش نسخه‌ی ساختار)',
  /schemaReadyFor/.test(schemaSrc) && /user_version/.test(schemaSrc));
ok('SQLite روی synchronous=NORMAL (نوشتن سریع‌تر، در WAL امن)', /PRAGMA synchronous = NORMAL/.test(schemaSrc));
const settingsFile = fs.readFileSync(path.join(commonDir, 'settings.ts'), 'utf8');
ok('تنظیمات کش می‌شوند و با set پاک می‌شوند',
  /private cache/.test(settingsFile) && /clearCache\(\)/.test(settingsFile));
ok('نرخ اضافه‌کاری در محاسبه معاش واقعاً اعمال می‌شود',
  /overtimeRate/.test(fs.readFileSync(path.join(modDir, 'salaries.controller.ts'), 'utf8')) &&
  /otHours \* hourly \* otRate/.test(fs.readFileSync(path.join(modDir, 'salaries.controller.ts'), 'utf8')));
const appTsx = fs.readFileSync(path.join(root, 'apps/web/src/App.tsx'), 'utf8');
ok('صفحه‌ها lazy بارگذاری می‌شوند (باندل اولیه سبک)',
  /lazy\(\(\) => import/.test(appTsx) && /Suspense/.test(appTsx));
ok('recharts در چانک جداگانه است', /'charts'/.test(fs.readFileSync(path.join(root, 'apps/web/vite.config.mts'), 'utf8')));

console.log('\n— محافظ حذف کارمند (پاک‌شدن خاموش سابقه‌ی حضور) —');
const emp = fs.readFileSync(path.join(modDir, 'employees.controller.ts'), 'utf8');
ok('حذف کارمند با سابقه‌ی حضور مسدود می‌شود', /Attendance/.test(emp) && /سابقه حضور/.test(emp));
ok('ثبت گروهی حضور، وجود کارمند را بررسی می‌کند', /FROM "Employee" WHERE "id"/.test(emp));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
