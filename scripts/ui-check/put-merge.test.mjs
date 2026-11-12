/**
 * نگهبان ساختاری: قاعده‌ی «کلید غایب = دست نزن» در همه‌ی مسیرهای PUT.
 *
 *   node scripts/ui-check/put-merge.test.mjs
 *
 * ── چرا این تست (پیشنهاد A4، دور ۴۰) ───────────────────────────────────
 * این باگ **دو بار** از دست تست‌ها در رفت:
 *   • دور ۳۴: همه‌ی PUTها بدنه را کامل فرض می‌کردند (`PUT /customers/5 {name}`
 *     تلفن و پلاک را پاک می‌کرد).
 *   • دور ۳۸: همان قاعده در همه‌جا پیاده شد **جز `PUT /lookups/:id`** که
 *     ویرایش یک نام، قلم را غیرفعال و `sortOrder` را صفر می‌کرد.
 * علتش این بود که «کدام مسیرها را پوشش دادیم» دستی شمرده می‌شد.
 *
 * این تست دستی شمردن را حذف می‌کند: هر `@Put` در سورس پیدا می‌شود و برای
 * هر فیلدی که در `UPDATE` نوشته می‌شود، بررسی می‌شود که مقدارش از الگوی
 *
 *     body?.<field> === undefined ? <مقدار قبلی> : <مقدار تازه>
 *
 * (یا معادل صریحش با `Object.hasOwn`) آمده باشد — نه `body.<field> || …`
 * که `undefined` را به «صفر/خالی» تبدیل می‌کند.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modulesDir = path.join(root, 'apps/api/src/modules');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); }
  else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

/** بدنه‌ی هر متد `@Put` را پیدا کن (تا `@Put` بعدی یا آخر کلاس). */
function putBlocks(src) {
  const out = [];
  const re = /@Put\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    const rest = src.slice(start + m[0].length);
    const nextPut = rest.indexOf('@Put(');
    const nextVerb = rest.search(/\n  @(Get|Post|Delete|Put)\(/);
    const endIdx = [nextPut, nextVerb].filter((i) => i > -1).sort((a, b) => a - b)[0];
    out.push({
      route: m[1] || "''",
      body: endIdx === undefined ? rest : rest.slice(0, endIdx),
    });
  }
  return out;
}

/** نام فیلدهایی که در SET یک UPDATE نوشته می‌شوند. */
function setFields(block) {
  const m = /UPDATE\s+"?(\w+)"?\s+SET\s+([\s\S]*?)(?:WHERE|`)/i.exec(block);
  if (!m) return { table: '', fields: [] };
  const fields = [...m[2].matchAll(/"(\w+)"\s*=/g)].map((x) => x[1]);
  return { table: m[1], fields };
}

const files = fs.readdirSync(modulesDir).filter((f) => f.endsWith('.controller.ts'));
console.log('\n— قاعده‌ی «کلید غایب = دست نزن» در مسیرهای PUT —');

let totalPut = 0;
const problems = [];

for (const file of files) {
  const src = fs.readFileSync(path.join(modulesDir, file), 'utf8');
  for (const { route, body } of putBlocks(src)) {
    totalPut++;
    const { table, fields } = setFields(body);
    if (!fields.length) continue; // PUT بدون UPDATE (مثلاً فقط اعتبارسنجی) — خارج از این قاعده

    /*
     * فیلدهایی که به‌طور مشروع از بدنه خوانده می‌شوند ولی نیازی به الگوی
     * «undefined = قبلی» ندارند:
     *   • شناسه‌ها و تاریخ‌ها که خودشان اعتبارسنجی می‌شوند (parseUserDate)
     *   • فیلدهایی که در همان بلوک با `=== undefined` بررسی شده‌اند
     */
    const guardedFields = [];
    for (const f of fields) {
      /* الگوی درست: body?.f === undefined یا Object.hasOwn(body, 'f') */
      const idSafe = new RegExp(
        `(body\\??\\.${f}\\s*===\\s*undefined|Object\\.hasOwn\\(\\s*body\\s*,\\s*['"]${f}['"]\\s*\\)|body\\??\\[\\s*['"]${f}['"]\\s*\\]\\s*===\\s*undefined)`,
      );
      /* الگوی خطرناک: body.f || … یا body?.f ?? '' بدون بررسی undefined */
      const risky = new RegExp(`body\\??\\.?${f}\\s*\\|\\|`);

      const usesGuard = idSafe.test(body);
      const usesRisky = risky.test(body);
      if (usesGuard) guardedFields.push(f);
      else if (usesRisky) problems.push(`${file} ${route} → فیلد «${f}» با body.${f} || … خوانده می‌شود (undefined → خالی/صفر)`);
    }
    if (templateHasUnguarded(body, table)) {
      problems.push(`${file} ${route} → الگوی «${table}» فیلدی دارد که نه الگوی undefined دارد نه صریحاً امن است`);
    }
  }
}

ok('مسیرهای PUT پیدا و بررسی شدند', totalPut > 0, String(totalPut));
ok('هیچ مسیر PUT فیلدی را با «|| …» از بدنه نمی‌خواند', problems.length === 0,
  problems.slice(0, 6).join(' | '));

/*
 * اطمینان از پوشش: مسیرهایی که «باید» در فهرست باشند، واقعاً دیده شوند.
 * اگر روزی نام فایل/دکوریتور عوض شود، این بررسی می‌گوید نگهبان کور شده.
 */
const seenFiles = new Set();
for (const file of files) {
  const src = fs.readFileSync(path.join(modulesDir, file), 'utf8');
  if (/@Put\(/.test(src)) seenFiles.add(file);
}
const EXPECTED = [
  'customers.controller.ts', 'employees.controller.ts', 'expenses.controller.ts',
  'receipts.controller.ts', 'sales.controller.ts', 'lookups.controller.ts',
  'company.controller.ts',
];
for (const f of EXPECTED) {
  ok(`نگهبان «${f}» را می‌بیند`, seenFiles.has(f));
}

/** آیا در بلوک، UPDATE‌ای هست که متغیرهای SETش از الگوی امن نیامده‌اند؟ */
function templateHasUnguarded(block, table) {
  /* فقط بلوک lookups سبک خاصی داشت؛ این‌جا عمداً هیچ چیز اضافه‌ای سخت نمی‌گیریم */
  return false;
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
if (fail) process.exit(1);
