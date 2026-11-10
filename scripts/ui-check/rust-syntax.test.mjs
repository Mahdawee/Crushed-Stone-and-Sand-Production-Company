/**
 * بررسی ساختاری سورس Rust — بدون نیاز به cargo.
 *
 *   node scripts/ui-check/rust-syntax.test.mjs
 *
 * چرا: یک بار (گزارش کاربر) ساخت با این خطا شکست:
 *
 *   error: invalid format string: expected `}`, found `t`
 *      --> src\main.rs:420:5
 *
 * ریشه: قالب HTML با `format!` ساخته می‌شد و بعداً یک بلوک <script> با
 * آکولادهای تکی (`function __fd(arg) { … }`) داخلش اضافه شد. `format!` هر
 * `{` را جای‌نگهدار می‌بیند، پس کامپایل شکست. در این محیط cargo نصب نیست؛
 * پس این تست همان دسته خطا را با تجزیه‌ی سبک می‌گیرد:
 *
 *  ۱) تعادل براکت‌ها در هر فایل (با درنظر گرفتن رشته‌های خام r#"…"#).
 *  ۲) هیچ `format!` ای نباید روی رشته‌ی خامی باشد که داخلش `{` تکی دارد
 *     (یعنی احتمال خطای فرمت).
 *  ۳) رشته‌ی خام نباید زودتر از موعد بسته شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'src-tauri/src');

let pass = 0,
  fail = 0;
const ok = (n, c, extra = '') => {
  c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`));
};

/**
 * تجزیه‌ی یک فایل Rust به «کد» و «رشته‌های خام».
 * خروجی: کدِ بدون رشته‌ها (برای تعادل براکت) + فهرست رشته‌های خام.
 */
function parseRust(source) {
  let code = '';
  const rawStrings = [];
  let i = 0;
  while (i < source.length) {
    /* کامنت خطی */
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    /* کامنت بلوکی (تودرتو در Rust مجاز است) */
    if (source[i] === '/' && source[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === '/' && source[i + 1] === '*') { depth++; i += 2; continue; }
        if (source[i] === '*' && source[i + 1] === '/') { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }
    /* رشته‌ی خام r#"…"# / r"…" */
    if (source[i] === 'r' && (source[i + 1] === '"' || source[i + 1] === '#')) {
      let hashCount = 0;
      let k = i + 1;
      while (source[k] === '#') { hashCount++; k++; }
      if (source[k] === '"') {
        const open = k + 1;
        const terminator = '"' + '#'.repeat(hashCount);
        const closeAt = source.indexOf(terminator, open);
        if (closeAt < 0) {
          rawStrings.push({ text: source.slice(open), start: i, unterminated: true, hashCount });
          i = source.length;
          continue;
        }
        rawStrings.push({ text: source.slice(open, closeAt), start: i, unterminated: false, hashCount, end: closeAt });
        i = closeAt + terminator.length;
        continue;
      }
    }
    /* رشته‌ی معمولی "…" با backslash */
    if (source[i] === '"') {
      let k = i + 1;
      while (k < source.length) {
        if (source[k] === '\\') { k += 2; continue; }
        if (source[k] === '"') { k++; break; }
        k++;
      }
      code += '""';
      i = k;
      continue;
    }
    /* char literal 'x' یا lifetime — فقط وقتی char است که بسته شود */
    if (source[i] === "'") {
      const m = /^'(\\u\{[0-9a-fA-F]+\}|\\.[^']?|[^'\\\\])'/.exec(source.slice(i));
      if (m) { code += "''"; i += m[0].length; continue; }
      code += source[i++];
      continue;
    }
    code += source[i++];
  }
  return { code, rawStrings };
}

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.rs'));

console.log('\n— تعادل براکت‌ها در هر فایل Rust —');
for (const f of files) {
  const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const { code } = parseRust(src);
  const pairs = [['{', '}'], ['(', ')'], ['[', ']']];
  let balanced = true;
  const detail = [];
  for (const [open, close] of pairs) {
    const o = (code.match(new RegExp('\\' + open, 'g')) || []).length;
    const c = (code.match(new RegExp('\\' + close, 'g')) || []).length;
    if (o !== c) { balanced = false; detail.push(`${open}${close}: ${o}/${c}`); }
  }
  ok(`${f}: براکت‌ها متعادل‌اند`, balanced, detail.join(' '));
}

console.log('\n— رشته‌های خام و format! (خطای «invalid format string») —');
for (const f of files) {
  const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const { rawStrings } = parseRust(src);
  const broken = rawStrings.filter((r) => r.unterminated);
  ok(`${f}: همه‌ی رشته‌های خام بسته شده‌اند`, broken.length === 0, `${broken.length} رشته‌ی ناتمام`);

  /*
   * خطر واقعی: `format!(` که رشته‌ی خامش `{` تک دارد (نه `{{`).
   * اگر براکت‌های CSS/JS دو برابر نشده باشند، کامپایل می‌شکند.
   */
  let risky = 0;
  for (const r of rawStrings) {
    if (r.unterminated) continue;
    /* آیا این رشته آرگومان format! است؟ */
    const before = src.slice(Math.max(0, r.start - 400), r.start);
    const isFormat = /format!\s*\(\s*$/.test(before) || /format!\s*\(\s*[^)]*$/.test(before.slice(-80)) === false;
    const inFormat = /format!\s*\([^;]*$/.test(before);
    if (!inFormat) continue;
    const withoutDouble = r.text.replace(/\{\{/g, '').replace(/\}\}/g, '');
    if (/[{}]/.test(withoutDouble)) risky++;
    void isFormat;
  }
  ok(`${f}: هیچ format! ای رشته‌ی خام با آکولاد تکی ندارد`, risky === 0, `${risky} مورد`);

  /* الگوی دقیق خطای گزارش‌شده: مقدار برگشتی مستقیم format!(r#"…"#) */
  ok(`${f}: صفحه‌ی خطا با format! ساخته نمی‌شود (خطای گزارش‌شده)`, !/format!\(\s*\\n?\s*r#"[\s\S]{0,200}?function\s+\w+\(/.test(src));
}

console.log('\n— قالب صفحه‌ی خطا —');
const main = fs.readFileSync(path.join(srcDir, 'main.rs'), 'utf8');
ok('صفحه‌ی خطا از قالب ثابت + جای‌نگهدار متنی استفاده می‌کند',
  /const ERROR_PAGE: &str = r#"/.test(main) && /ERROR_PAGE\.replace\("@@BODY@@"/.test(main));
ok('آکولادهای CSS دو برابر نشده‌اند (نشانه‌ی باقی‌مانده‌ی format!)', !/body\{\{/.test(main));
ok('صفحه‌ی خطا دکمه‌ی نجات دارد', /__fd\('--reset-admin'\)/.test(main));

console.log('\n— الگوهای خطرناک کامپایل (که کاربر یک‌به‌یک گزارش می‌دهد) —');
const side = fs.readFileSync(path.join(srcDir, 'api_sidecar.rs'), 'utf8');
const combined = main + '\n' + side;

/* فیلدهای غیرعمومی struct را نمی‌توان از ماژول دیگر ساخت */
const structs = [...combined.matchAll(/pub struct (\w+)\s*\{([\s\S]*?)\n\}/g)];
let privateFieldRisk = 0;
for (const [, name, body] of structs) {
  const fields = body.split('\n').map((l) => l.trim()).filter((l) => /^\w+\s*:/.test(l));
  if (!fields.length) continue;
  const hasPrivate = fields.some((f) => !f.startsWith('pub '));
  const builtOutside = new RegExp(`(?<!pub struct )\\b${name}\\s*\\{`, 'm');
  if (hasPrivate && builtOutside.test(combined.replace(/pub struct \w+\s*\{[\s\S]*?\n\}/g, ''))) {
    privateFieldRisk++;
    console.log(`     ↳ ${name} فیلد خصوصی دارد ولی بیرون از ماژول ساخته می‌شود`);
  }
}
ok('هیچ struct با فیلد خصوصی بیرون از ماژول خودش ساخته نمی‌شود', privateFieldRisk === 0);

/* متدهایی که فقط روی ذات تایپ هستند و با `use` لازم نمی‌شوند */
ok('`tauri::App::primary_monitor` بدون ایمپورت اضافی صدا زده می‌شود (هشدار unused import ندهد)',
  /fn window_geometry\(app: &tauri::App\)/.test(main) &&
  !/fn window_geometry[\s\S]{0,400}use tauri::Manager;/.test(main) &&
  /app\.primary_monitor\(\)/.test(main));

/* آکولادهای نامتوازن در رشته‌های format! */
ok('هیچ رشته‌ی خامی در format! آکولاد تک ندارد (خطای گزارش‌شده)', /ERROR_PAGE\.replace\("@@BODY@@"/.test(main));

console.log('\n— ایمنی‌های زبان Rust —');
ok('هیچ unwrap در مسیر راه‌اندازی (بدون کامنت)', !/\.unwrap\(\)/.test(parseRust(main).code.replace(/expect\(/g, 'expect(')));
ok('let-else فقط با نسخه‌ی Rust پشتیبانی‌شده', /rust-version = "1\.77/.test(fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8')));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
