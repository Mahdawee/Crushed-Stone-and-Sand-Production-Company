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

/* --- ۲) DatePicker: کلیک روی input تقویم را باز می‌کند --- */
console.log('\n— DatePicker در DOM واقعی —');
await render(React.createElement(Picker, { initial: '2026-11-10' }));
const container = host;
if (!host.innerHTML) console.log('DEBUG bundle import ok but nothing rendered');
const input = container.querySelector('input.dp-input');
ok('input رندر شد', !!input);
ok('مقدار اولیه نمایش داده می‌شود', input.value.length > 0, input.value);

fireEvent.click(input); await tick();
ok('کلیک روی کادر → تقویم باز می‌شود', !!document.querySelector('.dp-pop'));
ok('شبکه‌ی روزها رسم شده', document.querySelectorAll('.dp-cell').length > 25);

fireEvent.keyDown(document, { key: 'Escape' }); await tick();
ok('Esc → تقویم بسته می‌شود', !document.querySelector('.dp-pop'));

/* ورود دستی */
fireEvent.focus(input);
fireEvent.change(input, { target: { value: '1405/08/20' } });
await tick();
ok('تایپ دستی مقدار را تغییر می‌دهد', container.querySelector('[data-testid="val"]').textContent === '2026-11-11',
  container.querySelector('[data-testid="val"]').textContent);
ok('با تایپ، تقویم باز است', !!document.querySelector('.dp-pop'));
fireEvent.keyDown(input, { key: 'Enter' }); await tick();
ok('Enter → تقویم بسته و مقدار ثبت', !document.querySelector('.dp-pop') &&
  container.querySelector('[data-testid="val"]').textContent === '2026-11-11');

/* تاریخ نامعتبر */
fireEvent.change(input, { target: { value: '99/99/99' } });
fireEvent.blur(input);
await tick();
ok('تاریخ نامعتبر پیام می‌دهد', !!container.querySelector('.dp-err'));
ok('متن به مقدار معتبر برمی‌گردد', /^(۱۴۰۵|1405)\/08\/20$/.test(input.value) && !input.value.includes('99'), input.value);

cleanup();
console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
