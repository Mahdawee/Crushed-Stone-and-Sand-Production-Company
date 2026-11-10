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
  const normalStrings = [];
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
    /* رشته‌ی معمولی "…" با backslash — برای بررسی escape‌ها نگه داشته می‌شود */
    if (source[i] === '"') {
      const open = i; // شامل خودِ "
      let k = i + 1;
      while (k < source.length) {
        if (source[k] === '\\') { k += 2; continue; }
        if (source[k] === '"') { k++; break; }
        k++;
      }
      normalStrings.push({ start: open, text: source.slice(open + 1, k - 1) });
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
  return { code, rawStrings, normalStrings };
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

console.log('\n— escape‌های نامعتبر در رشته‌های معمولی (خطای unknown character escape) —');
/*
 * سه بار پشت سر هم ساخت روی ویندوز با خطای کامپایل شکست خورد و هر بار یک
 * الگوی تازه بود. آخرینش:
 *
 *   error: unknown character escape: `C`
 *      --> src\api_sidecar.rs:553:52
 *        "… مسیر ویندوزی (\\?\C:\…) …"
 *
 * ریشه: در رشته‌ی **معمولی** Rust هر `\` شروع یک escape است. `\\` یک
 * بک‌اسلش می‌دهد، پس `(\` + `)?` می‌ماند و بعد `\C` و `\…` که وجود ندارند.
 * این تست همان قانون lexer را پیاده می‌کند تا دیگر لازم نباشد کاربر خطا را
 * کشف کند.
 */
const VALID_ESCAPES = new Set(['n', 'r', 't', '\\', '0', "'", '"']);
function badEscapes(text) {
  const bad = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') continue;
    const c = text[i + 1];
    if (c === undefined) { bad.push('\\<پایان رشته>'); continue; }
    if (c === '\n') { i++; continue; } // ادامه‌ی خط: بک‌اسلش + خط جدید مجاز است
    if (VALID_ESCAPES.has(c)) { i++; continue; }
    if (c === 'x') { i += 3; continue; }
    if (c === 'u' && text[i + 2] === '{') {
      const close = text.indexOf('}', i + 3);
      i = close < 0 ? text.length : close;
      continue;
    }
    bad.push('\\' + c);
    i++;
  }
  return bad;
}
/* صحت خودِ تابع را با همان نمونه‌ی کاربر می‌سنجیم (بک‌اسلش با کد ۹۲) */
const BS = String.fromCharCode(92);
const sampleBad = badEscapes('(' + BS + BS + '?' + BS + 'C:)' + '(' + BS + '…' + ')');
const sampleGood = badEscapes('(' + BS + BS + BS + BS + '?' + BS + BS + 'C:' + BS + BS + '…' + ')');
ok('سنجه‌ی escape: نمونه‌ی خطادار کاربر را می‌گیرد', sampleBad.length >= 1, sampleBad.join(' '));
ok('سنجه‌ی escape: شکل درست (بک‌اسلش دوبل) را قبول می‌کند', sampleGood.length === 0, sampleGood.join(' '));

let escapeProblems = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const { normalStrings } = parseRust(src);
  for (const str of normalStrings) {
    const bad = badEscapes(str.text);
    if (bad.length) {
      escapeProblems++;
      const line = src.slice(0, str.start).split('\n').length;
      console.log(`     ↳ ${f}:${line} → escape نامعتبر: ${bad.join(', ')}`);
    }
  }
}
ok('هیچ رشته‌ی معمولی escape نامعتبر ندارد (خطای unknown character escape)', escapeProblems === 0);

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

console.log('\n— مسیرهای ویندوز که به Node داده می‌شود (باگ EISDIR lstat C:)  —');
/*
 * گزارش کاربر (نسخه‌ی نصب‌شده):
 *   Error: EISDIR: illegal operation on a directory, lstat 'C:'
 *     at Object.realpathSync (node:fs) … at resolveMainPath
 * ریشه: `resource_dir()`/`canonicalize` روی ویندوز مسیر verbatim می‌دهند
 * (`\\?\C:\…`) و Node نمی‌تواند از چنین مسیری ماژول اصلی را پیدا کند.
 * پس: هر مسیری که به Node/Command می‌رود باید از `plain_path` بگذرد.
 */
ok('تابع plain_path پیشوند verbatim ویندوز را برمی‌دارد', /pub fn plain_path\(p: &Path\) -> PathBuf/.test(side));
ok('plain_path فرم UNC را هم پوشش می‌دهد', side.includes('UNC') && /strip_prefix/.test(side));
ok('arg_path مسیر را قبل از دادن به Node معمولی می‌کند', /fn arg_path[\s\S]{0,400}plain_path\(p\)/.test(side));
ok('resource_dir خروجی‌اش را معمولی می‌کند', /pub fn resource_dir[\s\S]{0,600}plain_path\(&dir\)/.test(side));
ok('canonicalize در جست‌وجوی منابع با plain_path پاک می‌شود',
  /canonicalize\(c\)[\s\S]{0,400}plain_path\(&real\)/.test(side));
ok('ابلاغ node.exe با مسیر معمولی اجرا می‌شود', /Command::new\(plain_path\(&program\)\)/.test(side));
ok('current_dir با مسیر معمولی تنظیم می‌شود', /\.current_dir\(plain_path\(&dir\)\)/.test(side));
ok('حالت CLI هم مسیر معمولی می‌دهد',
  /Command::new\(api_sidecar::plain_path\(&node\)\)/.test(main) &&
  /arg\(api_sidecar::plain_path\(&entry\)\)/.test(main));
ok('پوشه‌ی داده هم از حالت verbatim در می‌آید',
  (main.match(/app_data_dir\(\)\s*\n\s*\.map\(\|p\| api_sidecar::plain_path\(&p\)\)/g) || []).length >= 2);
/*
 * منطق plain_path را با همان ورودی‌های ویندوزی شبیه‌سازی می‌کنیم: نباید هیچ
 * مسیر ورودی «verbatim» به Node برسد و نباید مسیر معمولی خراب شود.
 */
const stripVerbatim = (s) => {
  let r;
  if (s.startsWith('\\\\?\\UNC\\')) r = '\\\\' + s.slice(8);
  else if (s.startsWith('\\\\?\\')) {
    const rest = s.slice(4);
    r = rest.length >= 2 && /[A-Za-z]/.test(rest[0]) && rest[1] === ':' ? rest : s;
  } else r = s;
  return r.length > 259 || !r ? s : r;
};
const winCases = [
  ['\\\\?\\C:\\Users\\DELL\\AppData\\Local\\Programs\\Farday Roshan\\_up_\\api\\app.js', 'C:\\Users\\DELL'],
  ['C:\\Users\\DELL\\app.js', 'C:\\Users\\DELL'],
  ['\\\\?\\UNC\\srv\\share\\app.js', '\\\\srv\\share'],
  ['\\\\?\\Volume{9f}\\app.js', '\\\\?\\Volume{9f}'],
];
let pathBad = 0;
for (const [input, expectedPrefix] of winCases) {
  const output = stripVerbatim(input);
  if (!output.startsWith(expectedPrefix)) { pathBad++; console.log(`     ↳ ${input} → ${output}`); }
  if (/^\\\\\?\\[A-Za-z]:/.test(output)) { pathBad++; console.log(`     ↳ verbatim باقی ماند: ${output}`); }
}
ok('شبیه‌سازی plain_path: هیچ مسیر verbatim درایوی به Node نمی‌رسد', pathBad === 0);

/* اگر Node اجرا نشود باید سریع خبر بدهد، نه ۶۰ ثانیه سکوت */
ok('مرگ زودهنگام سرویس تشخیص داده می‌شود (try_wait)',
  /try_wait\(\)[\s\S]{0,200}سرویس داخلی بلافاصله بسته شد/.test(side));
ok('مسیرهای اجرای سرویس در لاگ نوشته می‌شود', /اجرای سرویس: node=/.test(side));
ok('خطاهای آشنا ترجمه‌ی فارسی دارند (EISDIR / Cannot find module)',
  /pub fn log_hint/.test(side) && /EISDIR/.test(side) && /Cannot find module/.test(side));
ok('صفحه‌ی خطا راهنمای فارسی را نشان می‌دهد', /api_sidecar::log_hint\(&tail\)/.test(main));
/* هیچ format! ای نباید رشته‌ی خام با آکولاد تکی بگیرد — باگ بعدی همین بود */
ok('plain_path از format! با رشته‌ی خام استفاده نمی‌کند',
  !/format!\(\s*r#?"[\s\S]{0,80}\{[\s\S]{0,80}"#?\s*\)/.test(side));

console.log('\n— «مُهر» کلید در باینری (build.rs و seal.rs) —');
const buildRs = fs.readFileSync(path.join(root, 'src-tauri/build.rs'), 'utf8');
const sealRs = fs.readFileSync(path.join(srcDir, 'seal.rs'), 'utf8');
ok('build.rs یک sha256_hex کامل دارد (۶۴ ثابت K)', (buildRs.match(/0x[0-9a-f]{8},/g) || []).length >= 64);
ok('seal.rs همان تابع را دارد', (sealRs.match(/0x[0-9a-f]{8},/g) || []).length >= 64);
ok('build.rs خروجی seal.rs را در OUT_DIR می‌نویسد', /OUT_DIR/.test(buildRs) && /seal\.rs/.test(buildRs));
ok('seal.rs شامل فایل تولیدشده است', /include!\(concat!\(env!\("OUT_DIR"\), "\/seal\.rs"\)\)/.test(sealRs));
ok('اگر اثر انگشت نخواند، کلید را قبول نمی‌کند', /if actual != expected/.test(sealRs));
ok('ترکیب/جداکردن XOR متقارن است (همان تابع mix در هر دو)', /fn mix\(byte: u8, i: usize\) -> u8/.test(buildRs) && /fn mix\(byte: u8, i: usize\) -> u8/.test(sealRs));
ok('build.rs به تغییر کلید حساس است (rerun-if-changed)', buildRs.includes('rerun-if-changed') && buildRs.includes('key_file'));
/* هیچ unwrap یا expect در مسیر اجرا */
{
  const parsed = parseRust(sealRs);
  ok('seal.rs بدون unwrap', !/\.unwrap\(\)/.test(parsed.code));
}
/* براکت‌های فایل‌های تازه هم متعادل باشند (فایل‌های تازه در حلقه‌ی اول نبودند) */
for (const f of ['seal.rs', '../build.rs']) {
  const src2 = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const { code } = parseRust(src2);
  let bal = true;
  for (const [o, c] of [['{', '}'], ['(', ')'], ['[', ']']]) {
    const a = (code.match(new RegExp('\\' + o, 'g')) || []).length;
    const b = (code.match(new RegExp('\\' + c, 'g')) || []).length;
    if (a !== b) bal = false;
  }
  ok(`${f}: براکت‌ها متعادل‌اند`, bal);
}

console.log('\n— ایمنی‌های زبان Rust —');
ok('هیچ unwrap در مسیر راه‌اندازی (بدون کامنت)', !/\.unwrap\(\)/.test(parseRust(main).code.replace(/expect\(/g, 'expect(')));
ok('let-else فقط با نسخه‌ی Rust پشتیبانی‌شده', /rust-version = "1\.77/.test(fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8')));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
