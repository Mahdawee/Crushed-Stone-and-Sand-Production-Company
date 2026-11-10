/**
 * بررسی تنظیمات نصب‌کننده ویندوز (NSIS) — بدون نیاز به ویندوز/راست.
 *
 *   node scripts/ui-check/nsis-langs.test.mjs
 *   npm run test:nsis
 *
 * چرا؟ ساخت نصب‌کننده با این خطا شکست خورد:
 *     Can't open language file - "...\Contrib\Language files\Persian.nlf"!
 * یعنی نام زبان در tauri.conf.json با نام فایل زبانِ NSIS یکی نبود
 * (NSIS زبان فارسی را «Farsi» می‌شناسد، نه «Persian»).
 *
 * این تست همان اشتباه را قبل از رسیدن به makensis می‌گیرد.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const confPath = path.join(root, 'src-tauri/tauri.conf.json');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`));
};

/**
 * فهرست کامل زبان‌هایی که NSIS 3.13 همراه دارد
 * (Contrib/Language files/*.nlf) — نام‌ها حساس به حرف بزرگ/کوچک هستند
 * چون makensis دقیقاً «<Name>.nlf» را باز می‌کند.
 */
const NSIS_LANGUAGES = [
  'Afrikaans', 'Albanian', 'Arabic', 'Armenian', 'Asturian', 'Basque', 'Belarusian',
  'Bosnian', 'Breton', 'Bulgarian', 'Catalan', 'Cibemba', 'Corsican', 'Croatian',
  'Czech', 'Danish', 'Dutch', 'Efik', 'English', 'Esperanto', 'Estonian', 'Farsi',
  'Finnish', 'French', 'Galician', 'Georgian', 'German', 'Greek', 'Hebrew', 'Hindi',
  'Hungarian', 'Icelandic', 'Igbo', 'Indonesian', 'Irish', 'Italian', 'Japanese',
  'Khmer', 'Korean', 'Kurdish', 'Latvian', 'Lithuanian', 'Luxembourgish', 'Macedonian',
  'Malagasy', 'Malay', 'Mongolian', 'Norwegian', 'NorwegianNynorsk', 'Pashto', 'Polish',
  'Portuguese', 'PortugueseBR', 'Romanian', 'Russian', 'ScotsGaelic', 'Serbian',
  'SerbianLatin', 'SimpChinese', 'Slovak', 'Slovenian', 'Spanish',
  'SpanishInternational', 'Swahili', 'Swedish', 'Tatar', 'Thai', 'TradChinese',
  'Turkish', 'Ukrainian', 'Uzbek', 'Valencian', 'Vietnamese', 'Welsh', 'Yoruba',
];

/* نام‌های مستعارِ قدیمی که tauri-cli هنوز می‌پذیرد اما در نسخه ۳ حذف می‌شوند */
const DEPRECATED = ['Persian'];

console.log('\n— تنظیمات NSIS در tauri.conf.json —');

ok('فایل tauri.conf.json هست', fs.existsSync(confPath));

let conf;
try {
  conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  ok('JSON معتبر است', true);
} catch (e) {
  ok('JSON معتبر است', false, e.message);
  process.exit(1);
}

const nsis = conf?.bundle?.windows?.nsis;
ok('بخش bundle.windows.nsis وجود دارد', !!nsis);
if (!nsis) {
  console.log(`\n⛔ ${pass} موفق، ${fail} ناکام\n`);
  process.exit(1);
}

const languages = nsis.languages ?? ['English'];
ok('حداقل یک زبان تعریف شده', languages.length > 0);

/* ۱) هر زبان باید یکی از نام‌های شناخته‌شده NSIS باشد — وگرنه makensis
      دنبال <Name>.nlf می‌گردد که نیست و کل ساخت می‌افتد. */
for (const lang of languages) {
  ok(
    `«${lang}» نام زبان معتبر NSIS است`,
    NSIS_LANGUAGES.includes(lang),
    `نام‌های درست: Farsi (نه Persian), English, …`,
  );
  ok(`«${lang}» نام منسوخ نیست`, !DEPRECATED.includes(lang), `به‌جای ${lang} از Farsi استفاده کنید`);
}

/* ۲) برای هر زبان، tauri یا ترجمه داخلی دارد یا فایل سفارشی لازم است.
      فارسی در cli 2.12.x داخل خودِ tauri نیست → باید فایل سفارشی بدهیم. */
const custom = nsis.customLanguageFiles ?? {};
for (const lang of languages) {
  const builtIn = ['English', 'German', 'French', 'Spanish', 'SpanishInternational',
    'Italian', 'Japanese', 'Korean', 'Russian', 'Portuguese', 'PortugueseBR',
    'TradChinese', 'SimpChinese', 'Turkish', 'Swedish', 'Ukrainian', 'Norwegian',
    'Vietnamese', 'Arabic', 'Bulgarian', 'Dutch', 'Hebrew'].includes(lang);
  if (builtIn) continue;
  ok(`«${lang}» فایل پیام سفارشی دارد (customLanguageFiles)`, !!custom[lang],
    'برای این زبان ترجمه‌ی داخلی tauri-cli موجود نیست');
}

/* ۳) فایل‌های سفارشی باید واقعاً روی دیسک باشند و مسیرشان از src-tauri نسبی باشد */
for (const [lang, rel] of Object.entries(custom)) {
  ok(`«${lang}» در فهرست languages هم آمده`, languages.includes(lang),
    'کلید customLanguageFiles باید عیناً در languages هم باشد');
  const abs = path.resolve(root, 'src-tauri', rel);
  ok(`فایل ${rel} موجود است`, fs.existsSync(abs), abs);
  if (!fs.existsSync(abs)) continue;

  const buf = fs.readFileSync(abs);
  const text = buf.toString('utf8');
  ok(`${rel} متن معتبر UTF-8 است`, !text.includes('\uFFFD'));
  ok(`${rel} دور ریخته نشده (خالی نیست)`, text.trim().length > 0);

  /* NSIS زبان فارسی را با LANG_FARSI می‌شناسد */
  const expected = `\${LANG_${lang.toUpperCase()}}`;
  ok(`${rel} از ${expected} استفاده می‌کند`, text.includes(expected));
  ok(
    `${rel} هیچ LANG_ اشتباهی ندارد`,
    ![...text.matchAll(/\$\{LANG_([A-Z0-9_]+)\}/g)].some((m) => m[1] !== lang.toUpperCase()),
    [...new Set([...text.matchAll(/\$\{LANG_([A-Z0-9_]+)\}/g)].map((m) => m[1]))].join(','),
  );

  /* Tauri فایل سفارشی را رندر نمی‌کند → جای‌نگهدار handlebars در آن کار نمی‌کند */
  ok(
    `${rel} جای‌نگهدار {{…}} ندارد (Tauri آن را جایگزین نمی‌کند)`,
    !/\{\{[^}]*\}\}/.test(text),
    (text.match(/\{\{[^}]*\}\}/) || [])[0],
  );

  /* رشته‌ها باید با " بسته شوند و رشته‌ی بی‌پایان نسازند */
  const badLines = text
    .split(/\r?\n/)
    .filter((l) => /^\s*LangString\s/.test(l))
    .filter((l) => (l.match(/"/g) || []).length % 2 !== 0);
  ok(`${rel} رشته‌های ناتمام ندارد`, badLines.length === 0, badLines[0]);

  /* تعداد پیام‌ها */
  const count = (text.match(/^\s*LangString\s/gm) || []).length;
  ok(`${rel} پیام‌های لازم را دارد (≥ ۲۵)`, count >= 25, String(count));

  /* همه‌ی رشته‌هایی که قالب رسمی installer.nsi (tauri-cli 2.12.x) استفاده می‌کند.
     اگر یکی نباشد، makensis هشدار «language string not set» می‌دهد و متن انگلیسی
     یا خالی نشان داده می‌شود. `choowHowToInstall` عمداً نیست (خود قالب مقدار
     پیش‌فرض خالی را ست می‌کند). */
  const NEEDED = [
    'addOrReinstall', 'alreadyInstalled', 'alreadyInstalledLong', 'chooseHowToInstall',
    'chooseMaintenanceOption', 'createDesktop', 'deleteAppData', 'dontUninstall',
    'dontUninstallDowngrade', 'installingWebview2', 'newerVersionInstalled', 'older',
    'olderOrUnknownVersionInstalled', 'silentDowngrades', 'unableToUninstall',
    'uninstallApp', 'uninstallBeforeInstalling', 'unknown', 'webview2AbortError',
    'webview2DownloadError', 'webview2DownloadSuccess', 'webview2Downloading',
    'webview2InstallError', 'webview2InstallSuccess',
  ];
  const defined = new Set([...text.matchAll(/^\s*LangString\s+(\w+)/gm)].map((m) => m[1]));
  const missing = NEEDED.filter((n) => !defined.has(n));
  ok(`${rel} همه‌ی رشته‌های نصب‌کننده را تعریف می‌کند`, missing.length === 0, missing.join(', '));
}

/* ۴) انتخاب‌گر زبان فقط وقتی معنی دارد که بیش از یک زبان باشد */
if (nsis.displayLanguageSelector === true) {
  ok('displayLanguageSelector با یک زبان معنی ندارد', languages.length > 1);
} else {
  ok('displayLanguageSelector boolean است', nsis.displayLanguageSelector === undefined || nsis.displayLanguageSelector === false);
}

/* ۵) کلیدهای ناشناخته باعث خطای deny_unknown_fields می‌شوند */
const KNOWN = ['installMode', 'languages', 'customLanguageFiles', 'displayLanguageSelector',
  'compression', 'startMenuFolder', 'installerHooks', 'template', 'headerImage',
  'sidebarImage', 'installerIcon', 'uninstallerIcon', 'uninstallerHeaderImage',
  'minimumWebview2Version'];
for (const k of Object.keys(nsis)) {
  ok(`کلید «${k}» شناخته‌شده است`, KNOWN.includes(k), 'tauri.conf.json کلید ناشناخته را رد می‌کند');
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
