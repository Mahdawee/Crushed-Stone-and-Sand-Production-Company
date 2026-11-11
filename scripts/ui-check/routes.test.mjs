/**
 * بررسی ترتیب مسیرها در کنترلرهای API.
 *
 *   node scripts/ui-check/routes.test.mjs
 *
 * چرا: در NestJS اولین مسیر منطبق برنده است. اگر `@Get('employees/:id')` قبل از
 * `@Get('attendance')` ثبت شود، درخواست `GET /api/attendance` با `:id='attendance'`
 * مطابقت می‌کند و همیشه ۴۰۴ می‌دهد — این باگ یک بار حضور و غیاب را در نسخه‌ی
 * نصب‌شده کاملاً از کار انداخت و هیچ تستی آن را نگرفته بود.
 *
 * قاعده: در هر کنترلر، مسیرهای **ثابت** باید قبل از مسیرهای **پارامتری** بیایند.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'apps/api/src/modules');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`)); };

console.log('\n— ترتیب مسیرها (ثابت قبل از پارامتری) —');

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.controller.ts'));
let checked = 0;

for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  /*
   * ⚠ یک فایل می‌تواند **چند** کنترلر داشته باشد (مثلاً
   * `importexport.controller.ts` هم `ExportController` و هم `ImportController`).
   * ترتیب مسیرها فقط **داخل همان کنترلر** معنا دارد؛ اگر مرزها را در نظر
   * نگیریم، `GET /export` با `GET /import/types` به‌غلط «تعارض» شمرده
   * می‌شود و تست باگی را گزارش می‌کند که وجود ندارد.
   */
  const bounds = [];
  const cre = /^@Controller\(([^)]*)\)/gm;
  let cm;
  while ((cm = cre.exec(src))) bounds.push(cm.index);
  if (!bounds.length) bounds.push(0);
  bounds.push(src.length);

  let anyRoutes = false;
  for (let b = 0; b + 1 < bounds.length; b++) {
  const routes = [];
  const re = /^  @(Get|Post|Put|Patch|Delete)\(([^)]*)\)/gm;
  re.lastIndex = bounds[b];
  let m;
  while ((m = re.exec(src)) && m.index < bounds[b + 1]) {
    const method = m[1].toUpperCase();
    const raw = m[2].trim();
    const pathPart = raw.replace(/^['\"`]|['\"`]$/g, '');
    const line = src.slice(0, m.index).split('\n').length;
    routes.push({ method, path: pathPart, line });
  }
  if (!routes.length) continue;
  anyRoutes = true;

  /*
   * تعارض واقعی زمانی رخ می‌دهد که یک مسیر **ثابت** بعد از یک مسیر
   * **پارامتری** با همان تعداد تکه ثبت شده باشد؛ آن‌وقت مسیر پارامتری همه‌ی
   * درخواست‌های مسیر ثابت را می‌بلعد (۴۰۴/۴۰۰ گمراه‌کننده). مقایسه‌ی
   * «attendance» با «employees/:id» بی‌معناست چون تعداد تکه‌ها یکی نیست.
   */
  const seg = (p) => p.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.path.includes(':')) continue;
    const rs = seg(r.path);
    const clash = routes.filter((o) => {
      if (o === r || o.method !== r.method || o.line > r.line) return false;
      const os = seg(o.path);
      if (os.length !== rs.length) return false;
      /*
       * ⚠ هم‌طول بودن کافی نیست: `employees/:id` و `employees/next-code` هر
       * دو دو تکه‌اند و دومی را می‌بلعید. مقایسه باید تکه‌به‌تکه باشد
       * (`:id` فقط جای یک تکه می‌نشیند). این همان باگی بود که دکمه‌ی
       * «کارمند» را از کار انداخته بود: کد بعدی هرگز نمی‌رسید.
       */
      return os.every((part, i) => part === rs[i] || part.startsWith(':'));
    });
    if (clash.length) {
      ok(`${f}: «${r.path}» (${r.method}) قبل از مسیر پارامتری ثبت شده`, false,
        `${clash.map((c) => `«${c.path}» خط ${c.line}`).join(', ')} — این مسیر هرگز اجرا نمی‌شود`);
    }
  }
  }
  if (anyRoutes) checked++;
}

ok('همه‌ی کنترلرها بررسی شدند', checked >= 8, String(checked));

/* مشخصاً همان باگی که حضور و غیاب را از کار انداخت */
const emp = fs.readFileSync(path.join(dir, 'employees.controller.ts'), 'utf8');
const idx = (needle) => emp.indexOf(needle);
ok('«attendance» قبل از «employees/:id» ثبت شده (ترتیب ایمن برای ویرایش‌های بعدی)',
  idx("@Get('attendance')") < idx("@Get('employees/:id')"));
ok('«attendance/summary» ثبت شده است', idx("@Get('attendance/summary')") > 0);
/*
 * باگ واقعی کاربر («بخش ثبت کارمندان باز نمی‌شود»): `employees/next-code`
 * بعد از `employees/:id` ثبت شده بود، پس با `:id='next-code'` مطابقت می‌کرد،
 * `Number('next-code')` می‌شد NaN و ۴۰۴ برمی‌گشت → فورم باز نمی‌شد.
 */
{
  /*
   * مقایسه باید روی **تعریف مسیر** باشد، نه اولین جای نام آن در فایل
   * (توضیح فارسی هم همان رشته را دارد).
   */
  /* فقط خطی که خودش تعریف مسیر است (نه توضیحی که همان رشته را نقل می‌کند) */
  const def = (p) => {
    const line = emp.split('\n').find((l) => l.trim() === `@Get('${p}')`);
    return line ? emp.indexOf(line) : -1;
  };
  ok('«employees/next-code» قبل از «employees/:id» ثبت شده (فورم کارمند باز می‌شود)',
    def('employees/next-code') > 0 && def('employees/next-code') < def('employees/:id'),
    `${def('employees/next-code')} vs ${def('employees/:id')}`);
}
ok('مسیر «کد بعدی» کارمند در UI همان چیزی است که سرور می‌دهد',
  /api\.get\('\/employees\/next-code'\)/.test(fs.readFileSync(path.join(root, 'apps/web/src/pages/Employees.tsx'), 'utf8')));

/* ------------------------------------------------------------------ *
 * مسیرهای دور ۱۶: خروجی/ورودی اکسل، سطل بازیافت، لایسنس
 * ------------------------------------------------------------------ */
{
  const ie = fs.readFileSync(path.join(dir, 'importexport.controller.ts'), 'utf8');
  ok('خروجی: GET /export قبل از GET /export/types ثبت شده (وگرنه types هرگز اجرا نمی‌شود)',
    ie.indexOf("@Get()") < ie.indexOf("@Get('types')"), '');
  ok('ورودی: نوع از مسیر خوانده می‌شود (باگ @Query/«نوع ناشناخته»)',
    /@Param\('type'\)\s*type/.test(ie), 'باید @Param باشد نه @Query');

  const rc = fs.readFileSync(path.join(dir, 'recycle.controller.ts'), 'utf8');
  ok('سطل بازیافت: فقط برای مدیر', /@ManagerOnly\(\)/.test(rc));
  ok('سطل بازیافت: بازیابی از مسیر POST /:table/:id/restore', /:table\/:id\/restore/.test(rc));

  const lic = fs.readFileSync(path.join(dir, 'license.controller.ts'), 'utf8');
  ok('تمدید: مسیر ساخت درخواست وجود دارد', /license\/renew-request/.test(lic));
  ok('تمدید: درخواست با checksum همراه است', /SUM:/.test(lic));
  ok('فایل: فعال‌سازی از فایل وجود دارد', /license\/activate-file/.test(lic));
  ok('فایل: فقط فایل لایسنس/تمدید پذیرفته می‌شود', /BEGIN FARDAY \(LICENSE\|RENEW\)/.test(lic));

  /* حذف نرم در همه‌ی کنترلرهای داده */
  const softFiles = ['sales', 'receipts', 'expenses', 'customers', 'employees', 'salaries'];
  const missing = softFiles.filter((f) => {
    const src = fs.readFileSync(path.join(dir, `${f}.controller.ts`), 'utf8');
    return !/softDelete\(/.test(src);
  });
  ok('همه‌ی کنترلرهای داده حذف نرم دارند', missing.length === 0, missing.join(', '));

  const hardDeletes = softFiles.filter((f) => {
    const src = fs.readFileSync(path.join(dir, `${f}.controller.ts`), 'utf8');
    return /DELETE FROM "(Sale|Receipt|Expense|Customer|Employee|Salary)"/.test(src);
  });
  ok('هیچ حذف سختی روی جداول داده نمانده', hardDeletes.length === 0, hardDeletes.join(', '));

  const mach = fs.readFileSync(path.join(dir, 'company.controller.ts'), 'utf8');
  ok('ماشینری هم حذف نرم دارد', /softDelete\('Machinery'/.test(mach));
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
