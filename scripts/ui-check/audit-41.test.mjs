/**
 * نگهبان سند دور ۴۱ — همان درس D3.
 *
 *   node scripts/ui-check/audit-41.test.mjs
 *
 * ── چرا سند هم تست می‌خواهد ─────────────────────────────────────────────
 * در D3 سند خودم نام فایلی داشت که وجود نداشت، و تست گرفتتش. همان خطر
 * این‌جا هست: سند ۴۱ ادعاهایی دارد (نام فایل، شمار تست، کد کامیت) که
 * می‌توانند به‌سادگی از واقعیت جدا شوند. سندی که دروغ بگوید بدتر از
 * سندی است که نباشد — چون به آن اعتماد می‌شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const doc = read('docs/AUDIT-ROUND-41.md');
const exists = (p) => fs.existsSync(path.join(root, p));

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); } else { fail++; console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n— هر فایلی که سند نام می‌برد هست —');

/** همه‌ی مسیرهای کد که در سند داخل بک‌تیک آمده‌اند */
const paths = [...doc.matchAll(/`([\w./-]+\.(?:ts|tsx|mjs|js|json|md))`/g)]
  .map((m) => m[1])
  .filter((p) => !p.startsWith('pre-') && !p.startsWith('before-'))
  .filter((p) => p.includes('/'));
const unique = [...new Set(paths)];
const missing = unique.filter((p) => {
  /* سند بعضی فایل‌ها را با نام نسبی می‌آورد (مثل common/debt-aging.ts) */
  return !exists(p) && !exists(`apps/api/src/${p}`) && !exists(`apps/web/src/${p}`);
});
ok(`همه‌ی ${unique.length} مسیر نام‌برده در سند موجودند`, missing.length === 0, missing.join(', '));

console.log('\n— شمار تست‌ها با واقعیت می‌خواند —');

/**
 * هر عددی که سند ادعا می‌کند، با اجرای واقعی همان تست سنجیده می‌شود.
 * فقط تست‌های سریع — نه کل زنجیره (که خودش همین را می‌سنجد).
 */
const claims = [
  ['apps/api/test/report-integrity.test.js', 35, ['--experimental-sqlite', '--no-warnings']],
  ['scripts/ui-check/put-merge.test.mjs', 9, []],
  ['scripts/ui-check/global-search.test.mjs', 32, []],
  ['scripts/ui-check/compact-backup.test.mjs', 14, []],
  ['scripts/ui-check/bugs-registry.test.mjs', 17, []],
  ['scripts/ui-check/recovery-doc.test.mjs', 24, []],
  ['scripts/ui-check/operator-identity.test.mjs', 18, ['--experimental-sqlite', '--no-warnings']],
  ['scripts/ui-check/print-docs.test.mjs', 51, []],
  ['scripts/ui-check/debts-aging.test.mjs', 21, ['--experimental-strip-types', '--no-warnings']],
  ['scripts/ui-check/debts-page.test.mjs', 23, []],
  ['scripts/ui-check/backup-bundle.test.mjs', 27, ['--experimental-strip-types', '--no-warnings']],
];
for (const [file, claimed, flags] of claims) {
  if (!exists(file)) { ok(`${file} موجود است`, false); continue; }
  let counted = -1;
  try {
    const out = execFileSync(process.execPath, [...flags, file], { cwd: root, encoding: 'utf8' });
    const m = /(\d+) موفق/.exec(out);
    counted = m ? Number(m[1]) : -1;
  } catch { counted = -1; }
  ok(`${path.basename(file)}: سند ${claimed} می‌گوید`, counted === claimed, `واقعی ${counted}`);
  /*
   * خودِ سند هم باید همان عدد را کنار همان فایل نوشته باشد — نه اینکه
   * عدد «جایی» در سند باشد. نسخه‌ی اول شرط `|| claimed === N` داشت که
   * برای نصف تست‌ها همیشه سبز می‌شد.
   */
  const tag = /([a-z-]+)\.test\.(?:m?js)/.exec(path.basename(file))?.[1] || path.basename(file);
  const row = new RegExp(String(claimed) + '[^0-9]{0,4}بررسی[^\n]{0,80}' + tag).test(doc);
  ok(`  سند عدد ${claimed} را کنار ${tag} نوشته`, row);
}

console.log('\n— کامیت‌های نام‌برده واقعاً وجود دارند —');
const commits = [...new Set([...doc.matchAll(/`([0-9a-f]{7})`/g)].map((m) => m[1]))];
ok(`سند ${commits.length} کامیت نام می‌برد`, commits.length >= 10, String(commits.length));
/*
 * ── باگ دور ۴۳: این بررسی در CI همیشه قرمز بود ──────────────────────────
 * `actions/checkout@v4` به‌طور پیش‌فرض **کم‌عمق** (depth=1) کلون می‌کند.
 * یعنی فقط آخرین کامیت در تاریخچه هست و هر کامیت قدیمی‌تری که سند نام
 * می‌برد «پیدا نمی‌شود» — نه چون واقعاً نیست، چون در کلون نیست.
 *
 * نتیجه: `npm test` روی گیت‌هاب قرمز می‌شد و محلی سبز. یک تست که به
 * کامل بودن تاریخچه‌ی git وابسته است، در CI کم‌عمق معنا ندارد.
 *
 * راه‌حل دو طرفه:
 *   ۱) اگر مخزن کم‌عمق است (`.git/shallow` هست)، وجود کامیت **قابل
 *      اثبات نیست** — پس به‌جای «قرمز» گزارش «نامعلوم» می‌دهیم و
 *      در همین حال بررسی می‌کنیم که سند اصلاً کامیت نام برده باشد.
 *   ۲) workflow حالا `fetch-depth: 0` می‌گیرد، تا در CI هم کامل باشد.
 */
const gitDir = (() => {
  try { return execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return ''; }
})();
const isShallow = (() => {
  if (!gitDir) return false;
  return fs.existsSync(path.join(root, gitDir, 'shallow'));
})();

if (isShallow) {
  console.log('  ⚠ مخزن کم‌عمق است (clone --depth) — وجود کامیت‌های قدیمی اثبات‌شدنی نیست');
  /*
   * ولی بی‌اثر هم نیست: اگر کامیت در همین مخزن هست باید پیدا شود. برای
   * کامیت‌های کم‌عمقِ ناموجود، «نامعلوم» درست است نه «قرمز» و نه «سبز».
   */
  const found = commits.filter((c) => {
    try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { cwd: root, stdio: 'pipe' }); return true; }
    catch { return false; }
  });
  ok('سند کامیت‌های تاریخی نام می‌برد', commits.length >= 10, String(commits.length));
  console.log(`  ⚠ ${found.length} از ${commits.length} کامیت در این کلون کم‌عمق پیدا شد (باقی نامعلوم)`);
} else {
  const badCommits = [];
  for (const c of commits) {
    try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { cwd: root, stdio: 'pipe' }); }
    catch { badCommits.push(c); }
  }
  ok('همه‌ی کامیت‌ها در تاریخچه هستند', badCommits.length === 0, badCommits.join(', '));
}

console.log('\n— صداقت سند —');
ok('بخش «سنجیده نشد» دارد', /سنجیده نشد/.test(doc));
ok('B3 به‌عنوان «رد مستند» آمده، نه «انجام شد»', /رد مستند/.test(doc) && /B3/.test(doc));
ok('هر دو باگ FIFO صریحاً نوشته شده', /تازه‌ترین بل/.test(doc) && /تسویه‌شده/.test(doc));
ok('C3 می‌گوید «احراز هویت نیست»', /احراز هویت نیست/.test(doc));
/*
 * ⚠ اولین نسخه‌ی این سطر یک «همان‌گویی» بود (`x === x`) و همیشه سبز
 * می‌شد — یعنی هیچ چیز را نمی‌سنجید. تستی که نمی‌تواند شکست بخورد،
 * بدتر از نبودِ تست است: اطمینان دروغ می‌دهد.
 */
ok('محدودیت Rust اعلام شده', /cargo/.test(doc));
ok('محدودیت ویندوز اعلام شده', /ویندوز نداریم/.test(doc));
ok('محدودیت CI اعلام شده', /CI/.test(doc) && /اجرا نشد|فعالش کند/.test(doc));
ok('ادعای «همه‌چیز سنجیده شد» نمی‌کند', !/همه‌ی موارد سنجیده شد/.test(doc));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
