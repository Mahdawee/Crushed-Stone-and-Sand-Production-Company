/**
 * تست واقعی DOM: کامپوننت‌ها mount می‌شوند و با کلیک/تایپ بررسی می‌شوند.
 * (بدون مرورگر — jsdom + build واقعی Vite)
 *
 *   node scripts/ui-check/dom.test.mjs
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const web = path.join(root, 'apps/web');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/', pretendToBeVisual: true,
});
global.window = dom.window;
for (const k of ['document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'Event', 'localStorage', 'getComputedStyle']) {
  Object.defineProperty(global, k, { value: dom.window[k], configurable: true, writable: true });
}
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
let NARROW = false;
const mql = (q) => {
  const ls = new Set();
  return { media: q, get matches() { return /max-width:\s*1100px/.test(q) ? NARROW : false; },
    addEventListener: (_, f) => ls.add(f), removeEventListener: (_, f) => ls.delete(f),
    addListener: (f) => ls.add(f), removeListener: (f) => ls.delete(f) };
};
global.matchMedia = mql;
dom.window.matchMedia = mql;

/* --- ۱) بیلد یک ورودی آزمایشی با همان تنظیمات پروژه (JSX واقعی) --- */
const entry = path.join(root, 'scripts/ui-check/entry.tsx');
const outDir = path.join(root, 'scripts/ui-check/.out-dom');
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const act = React.act || ((fn) => fn());   /* اگر در این ساخت React.act نبود، بدون batching */

/* ابزار مینیمال جای testing-library — بدون وابستگی اضافه */
const host = document.getElementById('root');
const rootReact = createRoot(host);
const tick = () => new Promise((r) => setTimeout(r, 30));
const render = async (el) => { act(() => { rootReact.render(el); }); await tick(); };
const cleanup = () => act(() => { rootReact.unmount(); });
const fireEvent = {
  click: (el) => act(() => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }),
  focus: (el) => act(() => { el.focus(); el.dispatchEvent(new window.FocusEvent('focus', { bubbles: false })); }),
  blur: (el) => act(() => { el.blur(); el.dispatchEvent(new window.FocusEvent('blur', { bubbles: false })); }),
  keyDown: (el, init) => act(() => { el.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init })); }),
  change: (el, init) => act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, init.target.value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  }),
};
const { Picker } = await import(path.join(outDir, 'bundle.mjs'));

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`)); };

/* --- ۲) DatePicker: فقط انتخاب از تقویم --- */
console.log('\n— DatePicker در DOM واقعی —');
await render(React.createElement(Picker, { initial: '2026-11-10' }));
const container = host;
const val = () => container.querySelector('[data-testid="val"]').textContent;
const pop = () => document.querySelector('.dp-pop');
const trigger = () => container.querySelector('.dp-trigger');

ok('کادر انتخاب تاریخ رندر شد', !!trigger());
ok('کادر یک دکمه است (input تایپ‌شدنی نیست)', !container.querySelector('input'));
ok('مقدار اولیه به شمسی نمایش داده می‌شود', /۱۴۰۵|1405/.test(trigger().textContent), trigger().textContent);

fireEvent.click(trigger()); await tick();
ok('کلیک روی کادر → تقویم باز می‌شود', !!pop());
ok('شبکه‌ی روزها رسم شده', document.querySelectorAll('.dp-cell').length > 25);

/* انتخاب یک روز از شبکه */
const cells = [...document.querySelectorAll('.dp-cell:not(.empty)')];
const pick = cells.find((c) => c.textContent === '20') || cells[10];
fireEvent.click(pick); await tick();
ok('انتخاب روز → تقویم بسته می‌شود', !pop());
ok('انتخاب روز → مقدار عوض می‌شود', val() !== '2026-11-10', val());
ok('مقدار ISO میلادی معتبر است', /^\d{4}-\d{2}-\d{2}$/.test(val()), val());
ok('مقدار نمایش‌داده‌شده همان روز انتخاب‌شده است', trigger().textContent.includes(pick.textContent), trigger().textContent);

/* باز کردن با کلیک روی آیکن هم کار می‌کند (کل کادر یک دکمه است) */
fireEvent.click(container.querySelector('.dp-cal')); await tick();
ok('کلیک روی خود آیکن هم تقویم را باز می‌کند', !!pop());

fireEvent.keyDown(document, { key: 'Escape' }); await tick();
ok('Esc → تقویم بسته می‌شود', !pop());

/* دکمه امروز */
fireEvent.click(trigger()); await tick();
const todayBtn = [...document.querySelectorAll('.dp-foot .btn')].find((b) => b.textContent === 'امروز');
fireEvent.click(todayBtn); await tick();
ok('دکمه «امروز» تاریخ امروز را می‌گذارد و می‌بندد', !pop() && val().length === 10, val());

/* پاک کردن */
const clear = container.querySelector('.dp-clear');
ok('دکمه پاک کردن هست', !!clear);
fireEvent.click(clear); await tick();
ok('پاک کردن → مقدار خالی می‌شود', val() === '');
ok('پاک کردن → متن راهنما نشان داده می‌شود', trigger().textContent.includes('انتخاب تاریخ'), trigger().textContent);

cleanup();
console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
