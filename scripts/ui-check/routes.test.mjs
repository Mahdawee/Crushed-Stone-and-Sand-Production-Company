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
  /* فقط دکوراتورهای سطح کنترلر (دو فاصله تودرتویی) */
  const routes = [];
  const re = /^  @(Get|Post|Put|Patch|Delete)\(([^)]*)\)/gm;
  let m;
  while ((m = re.exec(src))) {
    const method = m[1].toUpperCase();
    const raw = m[2].trim();
    const pathPart = raw.replace(/^['"`]|['"`]$/g, '');
    const line = src.slice(0, m.index).split('\n').length;
    routes.push({ method, path: pathPart, line });
  }
  if (!routes.length) continue;
  checked++;

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
      return os.every((part, i) => part === rs[i] || part.startsWith(':'));
    });
    if (clash.length) {
      ok(`${f}: «${r.path}» (${r.method}) قبل از مسیر پارامتری ثبت شده`, false,
        `${clash.map((c) => `«${c.path}» خط ${c.line}`).join(', ')} — این مسیر هرگز اجرا نمی‌شود`);
    }
  }
}

ok('همه‌ی کنترلرها بررسی شدند', checked >= 8, String(checked));

/* مشخصاً همان باگی که حضور و غیاب را از کار انداخت */
const emp = fs.readFileSync(path.join(dir, 'employees.controller.ts'), 'utf8');
const idx = (needle) => emp.indexOf(needle);
ok('«attendance» قبل از «employees/:id» ثبت شده (ترتیب ایمن برای ویرایش‌های بعدی)',
  idx("@Get('attendance')") < idx("@Get('employees/:id')"));
ok('«attendance/summary» ثبت شده است', idx("@Get('attendance/summary')") > 0);

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
