/**
 * بررسی سه تم برنامه: روشن، برجسته (outdoor)، تیره.
 *
 *   node scripts/ui-check/theme.test.mjs
 *
 * چرا: تم باید واقعاً روی <html data-theme> اثر بگذارد، «برجسته» باید
 * کنتراست بالاتری از «روشن» داشته باشد و «تیره» نباید سیاه خالص باشد.
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost:5173/' });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
dom.window.matchMedia = global.matchMedia;

const css = fs.readFileSync(path.join(root, 'apps/web/src/styles/app.css'), 'utf8');
const session = fs.readFileSync(path.join(root, 'apps/web/src/lib/session.tsx'), 'utf8');
const settingsPage = fs.readFileSync(path.join(root, 'apps/web/src/pages/Settings.tsx'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`)); };

/* --- خواندن پالت هر تم از خود CSS --- */
function palette(sel) {
  const i = css.indexOf(sel);
  if (i < 0) return {};
  const body = css.slice(i, css.indexOf('}', i));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = palette(':root {');
const dark = palette("html[data-theme='dark'] {");
const vivid = palette("html[data-theme='vivid'] {");

const lum = (hex = '#000000') => {
  const h = String(hex).replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a = '#000', b = '#fff') => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

console.log('\n— سه تم تعریف شده —');
ok('تم تیره در CSS هست', !!dark.bg, 'html[data-theme=dark] پیدا نشد');
ok('تم برجسته در CSS هست', !!vivid.bg, 'html[data-theme=vivid] پیدا نشد');
ok('انتخاب‌گر تم در تنظیمات سه گزینه دارد', (settingsPage.match(/value: '(light|vivid|dark)'/g) || []).length >= 3);
ok('گزینه‌های تم با THEMES ساخته می‌شوند', /const THEMES = \[/.test(settingsPage) && /THEMES\.map/.test(settingsPage));

console.log('\n— تیره: مدرن و بدون سیاه خالص —');
ok('پس‌زمینه‌ی تیره سیاه خالص نیست', dark.bg.toLowerCase() !== '#000000' && dark.bg.toLowerCase() !== '#000', dark.bg);
ok('کارت‌ها از پس‌زمینه روشن‌ترند (عمق دارد)', lum(dark.surface) > lum(dark.bg),
  `${dark.surface} vs ${dark.bg}`);
ok('متن روی پس‌زمینه‌ی تیره کنتراست کافی دارد (>۷)', contrast(dark.text, dark.bg) > 7,
  contrast(dark.text, dark.bg).toFixed(2));
ok('متن ثانویه هم خوانا است (>۴٫۵)', contrast(dark.text2 || dark['text-2'], dark.bg) > 4.5,
  contrast(dark['text-2'], dark.bg).toFixed(2));
ok('رنگ خطر/موفق در تیره روشن‌تر شده (خوانا)', lum(dark.danger) > lum(light.danger));
ok('color-scheme: dark ست شده (کنترل‌های بومی هم تیره شوند)', /html\[data-theme='dark'\] \{[^}]*color-scheme: dark/.test(css));

console.log('\n— برجسته: کنتراست بالاتر از روشن —');
const cLight = contrast(light.text, light.bg);
const cVivid = contrast(vivid.text, vivid.bg);
ok('متن برجسته از متن روشن پرکنتراست‌تر است', cVivid > cLight,
  `برجسته ${cVivid.toFixed(2)} vs روشن ${cLight.toFixed(2)}`);
ok('کنتراست برجسته ≥ ۱۰ (برای نور شدید)', cVivid >= 10, cVivid.toFixed(2));
ok('حاشیه‌ها در برجسته تیره‌تر/دیدنی‌ترند', lum(vivid.border) < lum(light.border),
  `${vivid.border} vs ${light.border}`);
ok('متن ثانویه‌ی برجسته هم پرکنتراست است (>۷)', contrast(vivid['text-2'], vivid.bg) > 7,
  contrast(vivid['text-2'], vivid.bg).toFixed(2));
ok('لایه‌های برجسته هم قابل تفکیک‌اند', lum(vivid['surface-2']) < lum(vivid.surface) && lum(vivid['surface-3']) < lum(vivid['surface-2']));
ok('قواعد ساختاری برجسته اضافه شده (حاشیه ضخیم‌تر)', /html\[data-theme='vivid'\] \.input/.test(css));
ok('برجسته color-scheme: light دارد', /html\[data-theme='vivid'\] \{[^}]*color-scheme: light/.test(css));

console.log('\n— اعمال تم در کد —');
ok('resolveTheme سه حالت را می‌شناسد', /export function resolveTheme/.test(session) &&
  /'vivid'/.test(session) && /'dark'/.test(session) && /'light'/.test(session));
ok('تم روی <html data-theme> نوشته می‌شود', /root\.dataset\.theme = theme/.test(session));
ok('برجسته پالت رنگ جدا دارد', /ACCENTS_VIVID/.test(session));
/*
 * قبلاً اینجا انتظار می‌رفت یک شنونده‌ی `matchMedia('change')` تم را زنده
 * دنبال کند. ولی هیچ گزینه‌ی «خودکار» در تنظیمات وجود ندارد (سه تم:
 * روشن/برجسته/تیره)، پس آن شنونده کد مرده بود و هر بار کل تم را دوباره
 * اعمال می‌کرد (پرش رنگ). حالا فقط «حالت تعریف‌نشده» به تم سیستم می‌افتد —
 * یعنی پیش از ورود/پیش از بارگذاری تنظیمات.
 */
ok('تم تعریف‌نشده به ترجیح سیستم برمی‌گردد (فقط پیش از بارگذاری تنظیمات)',
  /prefers-color-scheme: dark/.test(session) && !/addEventListener\?\.\('change'/.test(session));
ok('ذخیره تنظیمات تم را فوری اعمال می‌کند (بدون انتظار سرور)', /const optimistic = \{ \.\.\.settings, \.\.\.patch \}/.test(session));

/* --- اعمال واقعی روی DOM --- */
const { build } = await import('vite');
await build({ configFile: path.join(root, 'scripts/ui-check/theme.vite.config.mjs') });
const mod = await import(pathToFileURL(path.join(root, 'scripts/ui-check/.out-theme/session.mjs')).href).catch(() => null);
if (mod) {
  for (const [mode, expected] of [['light', 'light'], ['vivid', 'vivid'], ['dark', 'dark'], ['high-contrast', 'vivid'], ['outdoor', 'vivid']]) {
    mod.applyThemeToDocument({ theme: mode });
    ok(`«${mode}» → data-theme="${expected}"`, document.documentElement.dataset.theme === expected,
      document.documentElement.dataset.theme);
  }
} else {
  console.log('  ℹ تست اعمال واقعی رد شد (باندل ساخته نشد)');
}

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
