/**
 * تست تایپ‌کردن در فرم‌ها — همان شکایتی که کاربر گفت:
 * «با وارد نمودن یک عدد یا حرف، فیلد تا کلیک دوباره قابل ورود نیست».
 *
 *   node scripts/ui-check/form.test.mjs
 *
 * علت واقعی: در `Modal` افکتِ فوکوس به `onClose` وابسته بود، و `onClose` در
 * همه‌ی صفحه‌ها `() => setForm(null)` است — یعنی در هر رندر تابع تازه. با هر
 * کلید، state عوض می‌شد، افکت دوباره اجرا می‌شد و `boxRef.focus()` فوکوس را از
 * کادر ورودی می‌دزدید. این تست همان مسیر را شبیه‌سازی می‌کند.
 */
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/', pretendToBeVisual: true,
});
global.window = dom.window;
for (const k of ['document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'Event',
  'localStorage', 'getComputedStyle', 'FocusEvent', 'DocumentFragment', 'location', 'history', 'CSS']) {
  Object.defineProperty(global, k, { value: dom.window[k], configurable: true, writable: true });
}
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
const mql = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
global.matchMedia = mql;
dom.window.matchMedia = mql;

const entry = path.join(root, 'scripts/ui-check/entry.tsx');
const outDir = path.join(root, 'scripts/ui-check/.out-form');
await build({
  root, configFile: false, logLevel: 'silent',
  plugins: [react()],
  build: {
    outDir, emptyOutDir: true, minify: false,
    lib: { entry, formats: ['es'], fileName: () => 'bundle.mjs' },
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react-router-dom', 'recharts'] },
  },
});

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const act = React.act || ((fn) => fn());

const host = document.getElementById('root');
const rootReact = createRoot(host);
const tick = () => new Promise((r) => setTimeout(r, 30));
const render = async (el) => { act(() => { rootReact.render(el); }); await tick(); };

/** تایپ یک نویسه — دقیقاً مثل مرورگر: focus، سپس تغییر مقدار */
const typeChar = async (el, ch) => {
  act(() => { el.focus(); });
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(el, String(el.value ?? '') + ch);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await tick();
};
const active = () => document.activeElement;
const describe = (el) => (el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` : 'null');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`)); };

const { FormHarness, NumHarness } = await import(pathToFileURL(path.join(outDir, 'bundle.mjs')).href);

/* ------------------------------------------------------------------ */
console.log('\n— تایپ در فرم مودال (چند حرف پشت‌سرهم) —');
await render(React.createElement(FormHarness));

let input = host.querySelector('.modal input:not(.input-num)');
ok('فرم باز شد و کادر متن ساخته شد', !!input);
ok('فوکوس اولیه روی همان کادر است', active() === input, describe(active()));

for (const ch of 'علی') await typeChar(input, ch);
ok('بعد از ۳ حرف، فوکوس هنوز روی کادر متن است', active() === input, describe(active()));
ok('همه‌ی حروف در فیلد ثبت شده‌اند', input.value === 'علی', input.value);
const typedCount = (host.querySelector('[data-testid="typed"]').textContent || '').split('|').length - 1;
ok('onChange سه بار صدا زده شد (هیچ تایپی گم نشد)', typedCount === 3, String(typedCount));

/* کادر عددی — همان تست */
console.log('\n— تایپ در کادر عددی بدون کلیک دوباره —');
const num = host.querySelector('.modal input.input-num');
act(() => { num.focus(); });
ok('کلیک در کادر عددی فوکوس را می‌گیرد', active() === num, describe(active()));
for (const ch of '1234') await typeChar(num, ch);
ok('بعد از ۴ رقم، فوکوس روی کادر عددی مانده', active() === num, describe(active()));
ok('عدد کامل ثبت شده', num.value === '1234', num.value);

/* جابه‌جایی بین دو کادر بدون کلیک روی فرم */
console.log('\n— جابه‌جایی فوکوس بین کادرها —');
act(() => { input.focus(); });
await typeChar(input, '!');
ok('برگشت به کادر اول کار می‌کند', active() === input && input.value.endsWith('!'), `${describe(active())} / ${input.value}`);

/* Enter = ذخیره (بدون برداشتن ماوس) */
console.log('\n— Enter داخل کادر = ذخیره فرم —');
globalThis.__saved = 0;
act(() => { document.querySelector('.modal input:not(.input-num)')?.closest('.modal')?.ownerDocument; });
/* باز کردن دوباره‌ی فرم از دکمه */
const reopen = [...host.querySelectorAll('button')].find((b) => b.textContent === 'باز کن');
if (reopen) { act(() => { reopen.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await tick(); }
const box = host.querySelector('.modal');
ok('فرم دوباره باز شد', !!box);
if (box) {
  const field = host.querySelector('.modal input:not(.input-num)');
  act(() => { field.focus(); });
  act(() => { field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  await tick();
  ok('Enter در کادر متنی → ذخیره فرم اجرا شد', globalThis.__saved === 1, String(globalThis.__saved));
  const numField = host.querySelector('.modal input.input-num');
  act(() => { numField.focus(); });
  act(() => { numField.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  await tick();
  ok('Enter در کادر عددی هم ذخیره می‌کند', globalThis.__saved === 2, String(globalThis.__saved));
}

/* کلیک روی پس‌زمینه فقط وقتی می‌بندد که فشار و رها کردن هر دو بیرون باشد */
console.log('\n— بستن فرم با کلیک بیرون (بدون از دست رفتن داده) —');
const back = host.querySelector('.modal-back');
ok('پس‌زمینه هست', !!back);
/* فشار داخل فرم (رویداد از کادر بالا می‌آید)، رها کردن روی پس‌زمینه → نباید ببندد */
const inside = host.querySelector('.modal input.input-num');
act(() => { inside.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); });
await tick();
act(() => { back.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
await tick();
ok('کشیدن انتخاب متن به بیرون، فرم را نمی‌بندد', !!host.querySelector('.modal'));
/* فشار و رها کردن هر دو روی پس‌زمینه → باید ببندد */
act(() => { back.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); });
await tick();
act(() => { back.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
await tick();
ok('کلیک کامل روی پس‌زمینه، فرم را می‌بندد', !host.querySelector('.modal'));
/* باز کردن دوباره برای تست Esc */
const reopen2 = [...host.querySelectorAll('button')].find((b) => b.textContent === 'باز کن');
if (reopen2) { act(() => { reopen2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await tick(); }

/* Escape فرم را می‌بندد (افکت هنوز زنده است) */
act(() => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await tick();
ok('Esc فرم را می‌بندد (شنونده‌ی افکت از دست نرفته)', !host.querySelector('.modal'));

/* ------------------------------------------------------------------ */
console.log('\n— ورودی عددی: پاک کردن و منع نویسه‌ی نامعتبر —');
await render(React.createElement(NumHarness));
const n = host.querySelector('input.input-num');
const numVal = () => host.querySelector('[data-testid="num"]').textContent;
act(() => { n.focus(); });
for (const ch of '10') await typeChar(n, ch);
ok('تایپ رقم در Num', n.value === '10', n.value);
/* حذف با Backspace (تغییر مقدار به خالی) */
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
act(() => { setter.call(n, '5'); n.dispatchEvent(new window.Event('input', { bubbles: true })); });
await tick();
ok('پاک کردن/عوض کردن مقدار کار می‌کند', n.value === '5', n.value);
await typeChar(n, '-');
ok('علامت منفی پذیرفته نمی‌شود', !n.value.includes('-'), n.value);
await typeChar(n, 'x');
ok('حرف در کادر عددی تایپ نمی‌شود', !/[a-z]/i.test(n.value), n.value);
const before = host.querySelector('input.input-num');
ok('کادر عددی بعد از تغییر مقدار دوباره ساخته نشده (بدون پرش فوکوس)', before === n);

rootReact.unmount();
console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
