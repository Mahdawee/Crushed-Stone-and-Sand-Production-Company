/**
 * نگهبان دفتر باگ‌ها — پیشنهاد D1، دور ۴۰.
 *
 *   node scripts/ui-check/bugs-registry.test.mjs
 *
 * دفتری از باگ‌های رفع‌شده که ادعا می‌کند هر کدام یک **نگهبان خودکار** دارند.
 * بدون این تست، آن ادعا فقط یک جمله است: کسی فایل نگهبان را پاک یا از زنجیره
 * خارج می‌کند و هیچ‌کس نمی‌فهمد.
 *
 * این تست چهار چیز را می‌سنجد:
 *   ۱) ساختار JSON درست است (شناسه یکتا، فیلدهای لازم).
 *   ۲) هر نگهبانی که نام برده شده **واقعاً روی دیسک هست**.
 *   ۳) هر نگهبان در زنجیره‌ی npm test **اجرا می‌شود** (وگرنه وجودش بی‌فایده است).
 *   ۴) توضیح «علت ریشه‌ای» و «درس» خالی نیست — دفتر بدون آن، فهرست عنوان است.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const docPath = path.join(root, 'docs/BUGS.json');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— دفتر باگ‌ها —');

ok('docs/BUGS.json وجود دارد', fs.existsSync(docPath));
const doc = JSON.parse(fs.readFileSync(docPath, 'utf8'));

ok('شکل کلی درست است', doc && Array.isArray(doc.bugs) && doc.bugs.length > 0);
ok('حداقل ۱۰ باگ ثبت شده', doc.bugs.length >= 10, String(doc.bugs.length));

/* ۱) ساختار */
const ids = new Set();
const problems = [];
for (const b of doc.bugs) {
  if (!/^B-\d{3}$/.test(b.id || '')) problems.push(`${b.id}: شناسه نامعتبر`);
  if (ids.has(b.id)) problems.push(`${b.id}: تکراری`);
  ids.add(b.id);
  for (const f of ['area', 'summary', 'why', 'fix', 'lesson']) {
    if (!b[f] || String(b[f]).trim().length < 4) problems.push(`${b.id}: ${f} خالی/کوتاه`);
  }
  if (typeof b.round !== 'number' || b.round < 1) problems.push(`${b.id}: round باید عدد مثبت باشد`);
}
ok('همه‌ی ردیف‌ها شناسه یکتا و فیلدهای لازم دارند', problems.length === 0, problems.slice(0, 4).join(' | '));

/* ۲) هر نگهبان روی دیسک هست */
const missing = doc.bugs
  .filter((b) => b.guard)
  .filter((b) => !fs.existsSync(path.join(root, b.guard)));
ok('هر فایل نگهبان نام‌برده وجود دارد', missing.length === 0,
  missing.map((b) => `${b.id}: ${b.guard}`).join(' | '));

/* ۳) هر نگهبان در زنجیره‌ی npm test اجرا می‌شود */
const chain = String(pkg.scripts?.test || '');
/* اسکریپت‌هایی که زنجیره به آن‌ها ارجاع می‌دهد */
const called = new Set([...chain.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map((m) => m[1]));
const scriptFiles = new Set();
for (const name of called) {
  const cmd = String(pkg.scripts?.[name] || '');
  for (const m of cmd.matchAll(/(?:node|scripts\/[^\s]+)[^\n]*?((?:scripts|apps|tools)\/[\w./-]+\.(?:mjs|js|ts))/g)) {
    scriptFiles.add(m[1]);
  }
  /* مسیر اول دستور هم ممکن است خودِ فایل باشد */
  const m2 = cmd.match(/(scripts|apps|tools)\/[\w./-]+\.(?:mjs|js|ts)/);
  if (m2) scriptFiles.add(m2[0]);
}

const notRun = doc.bugs
  .filter((b) => b.guard && /\.(mjs|js|ts)$/.test(b.guard))
  .filter((b) => !called.has(Object.keys(pkg.scripts).find((k) =>
    String(pkg.scripts[k]).includes(b.guard))));
ok('هر نگهبان یک اسکریپت npm دارد', notRun.length === 0,
  notRun.map((b) => `${b.id}: ${b.guard}`).join(' | '));

const sc = Object.keys(pkg.scripts).find((k) => String(pkg.scripts[k]).includes('bugs-registry'));
/* اعتبار خود زنجیره: تست‌های نگهبان باید در test فراخوانی شده باشند */
for (const b of doc.bugs.filter((x) => x.guard && /\.(mjs|js)$/.test(x.guard))) {
  const holder = Object.keys(pkg.scripts).find((k) => String(pkg.scripts[k]).includes(b.guard));
  const inChain = holder ? called.has(holder) : false;
  ok(`${b.id}: نگهبان در زنجیره‌ی test اجرا می‌شود`, inChain,
    holder ? `${holder} در زنجیره نیست` : 'اسکریپتی پیدا نشد');
}

/* ۴) درس‌ها واقعاً نوشته شده‌اند */
const thin = doc.bugs.filter((b) => String(b.why).length < 30 || String(b.lesson).length < 15);
ok('همه‌ی «علت ریشه‌ای» و «درس» توضیح کافی دارند', thin.length === 0,
  thin.map((b) => b.id).join(', '));

/*
 * ⚠ بند «هر فایل ui-check باید در دفتر باشد» عمداً حذف شد: بیش از ۲۰ نگهبان
 * عمومی (routes، theme، sidebar، …) از دورهای قبل هستند و به یک باگ خاص
 * مربوط نیستند. اجبار کردنشان به ثبت در دفتر، دفتر را به فهرست بی‌معنا تبدیل
 * می‌کرد. دفتر فقط برای باگ‌هایی است که **واقعاً رخ داده‌اند**.
 */
console.log('\n— پوشش نگهبان‌ها —');
const uiDir = path.join(root, 'scripts/ui-check');
const allGuards = fs.existsSync(uiDir) ? fs.readdirSync(uiDir).filter((f) => f.endsWith('.test.mjs')).length : 0;
ok('نگهبان‌های عمومی ui-check دست‌نخورده‌اند', allGuards >= 20, String(allGuards));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
