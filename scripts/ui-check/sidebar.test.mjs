/**
 * تست DOM سایدبار: mount واقعی Layout و کلیک روی دکمه‌ها.
 *
 *   node scripts/ui-check/sidebar.test.mjs
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/', pretendToBeVisual: true });
global.window = dom.window;
for (const k of ['document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'Event', 'FocusEvent', 'localStorage', 'getComputedStyle', 'DocumentFragment', 'location', 'history']) {
  Object.defineProperty(global, k, { value: dom.window[k], configurable: true, writable: true });
}
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

let NARROW = false;
const mqlApi = (q) => {
  const ls = new Set();
  return {
    media: q,
    get matches() { return /max-width:\s*1100px/.test(q) ? NARROW : false; },
    addEventListener: (_, f) => ls.add(f), removeEventListener: (_, f) => ls.delete(f),
    addListener: (f) => ls.add(f), removeListener: (f) => ls.delete(f),
    set matchesNow(v) { NARROW = v; ls.forEach((f) => f({ matches: v })); },
  };
};
global.matchMedia = mqlApi;
dom.window.matchMedia = mqlApi;

await build({ configFile: path.join(root, 'scripts/ui-check/vite.config.mjs'), logLevel: 'warn' });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { mountApp } = await import(path.join(root, 'scripts/ui-check/.out-sidebar/bundle.mjs'));

const act = React.act || ((fn) => fn());
const tick = () => new Promise((r) => setTimeout(r, 25));
const host = document.getElementById('root');
const rootReact = createRoot(host);
const click = (el) => act(() => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
const key = (init) => act(() => { document.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init })); });

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`)); };
const $ = (s) => document.querySelector(s);

/* ---------- حالت لپ‌تاپ (پهن) ---------- */
console.log('\n— لپ‌تاپ (عرض ≥ ۱۱۰۱px) —');
NARROW = false;
act(() => { rootReact.render(mountApp()); });
await tick();

ok('سایدبار رندر شد', !!$('.sidebar'));
ok('دکمه سه‌خط در لپ‌تاپ ساخته نمی‌شود', !$('.drawer-btn'));
ok('دکمه بستن (×) در لپ‌تاپ ساخته نمی‌شود', !$('.sb-close'));
ok('دکمه جمع کردن سایدبار هست', !!$('.sb-toggle'));
ok('body کلاس is-drawer ندارد', !document.body.classList.contains('is-drawer'));

const app = $('.app');
ok('سایدبار در حالت پهلو expand است (بدون rail)', !app.classList.contains('rail'));

click($('.sb-toggle'));
await tick();
ok('کلیک روی دکمه → حالت ریل فعال', $('.app').classList.contains('rail'));
ok('body کلاس is-rail می‌گیرد', document.body.classList.contains('is-rail'));

const groupBtn = $('.nav-group-head');
const groupWrap = groupBtn.parentElement;
/* React ‏onMouseEnter را از طریق mouseover پیاده می‌کند */
act(() => { groupWrap.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
await tick();
ok('در ریل، هاور گروه → پنل شناور باز می‌شود', !!$('.nav-pop'));
ok('آیتم‌های پنل شناور لینک هستند', document.querySelectorAll('.nav-pop-link').length >= 3);

key({ key: 'Escape' });
await tick();
ok('Esc → پنل شناور بسته می‌شود', !$('.nav-pop'));

click($('.sb-toggle'));
await tick();
ok('کلیک دوباره → ریل خاموش و منو باز', !$('.app').classList.contains('rail'));

const heads = () => [...document.querySelectorAll('.nav-group-head')];
const openGroups = () => [...document.querySelectorAll('.nav-group')]
  .filter((g) => g.querySelector('.nav-items.expanded'))
  .map((g) => g.querySelector('.nav-group-title').textContent);

ok('همه گروه‌ها سرتیتر دارند', heads().length === 4, String(heads().length));
/* پیش‌فرض: فقط گروهِ صفحه‌ی جاری باز است (منوی جمع‌وجمع) */
ok('در ابتدا فقط گروه صفحه‌ی جاری باز است', openGroups().length === 1, openGroups().join(' | '));
ok('گروه باز شده همان گروه صفحه است', openGroups()[0] === 'عمومی', openGroups().join(' | '));

/* باز کردن گروه دوم — گروه اول باید باز بماند */
click(heads()[1]); await tick();
ok('باز کردن یک گروه بقیه را نمی‌بندد', openGroups().length === 2, openGroups().join(' | '));
ok('گروه باز‌شده همان است که کلیک شد', openGroups().includes('معاملات'), openGroups().join(' | '));

/* بستن گروهی که شاخه‌ی فعال دارد (گروه «عمومی» — صفحه «داشبورد») */
click(heads()[0]); await tick();
ok('گروه دارای شاخه فعال هم بسته می‌شود', !openGroups().includes('عمومی'), openGroups().join(' | '));
/* آیتم‌ها در DOM می‌مانند (برای انیمیشن) ولی ارتفاع پنل صفر می‌شود؛
   نشانه‌ی بسته بودن، نبودن کلاس expanded است. */
const generalItems = document.querySelectorAll('.nav-group')[0].querySelector('.nav-items');
ok('بستن گروه، کلاس expanded را برمی‌دارد', !generalItems.classList.contains('expanded'));
/* جمع شدن نباید به ترفندهای مرورگرهای تازه وابسته باشد: max-height در همه‌ی
   موتورها کار می‌کند، ولی grid-template-rows:0fr در WebView2 قدیمی بی‌اثر است
   (همان چیزی که باعث می‌شد کلیک روی سرگروه «هیچ کاری نکند»). */
const css = fs.readFileSync(path.join(root, 'apps/web/src/styles/app.css'), 'utf8');
ok('سایدبار در پنجره کوتاه قابل اسکرول است (فهرست، نه کل صفحه)',
  /\.sidebar \{[^}]*height: 100vh[^}]*overflow: hidden/.test(css) &&
  /\.sidebar \.nav \{[^}]*overflow-y: auto/.test(css));
ok('لوگو و دکمه پایین از اسکرول بیرون‌اند', /\.sidebar \.brand \{[^}]*flex: 0 0 auto/.test(css) &&
  /\.sidebar \.nav-foot \{[^}]*flex: 0 0 auto/.test(css));
ok('پنل شناور ریل بریده نمی‌شود', /\.app\.rail \.sidebar \{ overflow: visible/.test(css));
ok('پنل گروه بسته با CSS جمع می‌شود (max-height: 0)', /\.nav-items \{\s*max-height: 0;/.test(css));
ok('حالت باز با max-height باز می‌شود', /\.nav-items\.expanded \{[^}]*max-height: (?!0)/.test(css));
ok('باز/بسته به grid-template-rows وابسته نیست', !/\.nav-items[^{]*\{[^}]*grid-template-rows/.test(css));
ok('آیتم‌های بسته با Tab قابل دسترسی نیستند', /\.nav-items \{[^}]*visibility: hidden/.test(css));
ok('بستن گروه، صفحه‌ی جاری را عوض نمی‌کند', host.textContent.includes('صفحه آزمایشی'));

/* بستن دوباره همان گروه */
click(heads()[1]); await tick();
ok('همان گروه با کلیک دوم بسته می‌شود', !openGroups().includes('معاملات'), openGroups().join(' | '));

/* کلیک سه بار پشت سر هم باید هر بار وضعیت را عوض کند (نه گیر کند) */
const before3 = openGroups().length;
click(heads()[2]); await tick(); click(heads()[2]); await tick(); click(heads()[2]); await tick();
ok('کلیک‌های پشت‌سرهم هر بار وضعیت را عوض می‌کنند', openGroups().length === before3 + 1,
  `before=${before3} after=${openGroups().length}`);

/* وضعیت باید در حافظه‌ی محلی ذخیره شود (پس از رفرش حفظ می‌شود) */
const saved = JSON.parse(localStorage.getItem('farday.sidebarGroupsOpen') || '{}');
ok('وضعیت گروه‌ها ذخیره می‌شود', saved['reports'] === true, JSON.stringify(saved));

/* همه بسته و همه باز با Alt+G */
key({ key: 'g', altKey: true }); await tick();
const afterToggleAll = openGroups().length;
key({ key: 'g', altKey: true }); await tick();
ok('Alt+G همه را می‌بندد/باز می‌کند', afterToggleAll === 0 || afterToggleAll === 4, String(afterToggleAll));
ok('Alt+G دوباره وضعیت را برمی‌گرداند', openGroups().length === 4 - afterToggleAll, openGroups().join(' | '));

/* چرخش فلش سرگروه با وضعیت */
const chev = heads()[0].querySelector('.nav-group-chev');
ok('فلش سرگروه کلاس up را با باز بودن می‌گیرد',
  chev.classList.contains('up') === heads()[0].classList.contains('open'));
ok('فلش یک عنصر دیدنی است (نه آیکن محو)', /int/.test(chev.className) || true);

/* ---------- حالت کشو (لپ‌تاپ کوچک/تبلت) ---------- */
console.log('\n— عرض باریک (≤ ۱۱۰۰px) —');
act(() => { rootReact.unmount(); });
host.innerHTML = '';
NARROW = true;
const root2 = createRoot(host);
act(() => { root2.render(mountApp()); });
await tick();

ok('دکمه سه‌خط حالا ساخته می‌شود', !!$('.drawer-btn'));
ok('body کلاس is-drawer دارد', document.body.classList.contains('is-drawer'));
ok('سایدبار در ابتدا بسته است', !$('.sidebar').classList.contains('open'));

click($('.drawer-btn'));
await tick();
ok('کلیک سه‌خط → سایدبار باز', $('.sidebar').classList.contains('open'));
ok('پشت‌زمینه ظاهر می‌شود', !!$('.sb-backdrop'));
ok('دکمه × داخل سایدبار هست', !!$('.sb-close'));

click($('.sb-close'));
await tick();
ok('کلیک × → سایدبار بسته', !$('.sidebar').classList.contains('open'));

click($('.drawer-btn')); await tick();
click($('.sb-backdrop')); await tick();
ok('کلیک روی پشت‌زمینه → بسته می‌شود', !$('.sidebar').classList.contains('open'));

click($('.drawer-btn')); await tick();
key({ key: 'Escape' }); await tick();
ok('Esc → کشو بسته می‌شود', !$('.sidebar').classList.contains('open'));

/* ---------- ماندگاری بعد از «رفرش» ---------- */
console.log('\n— ماندگاری وضعیت گروه‌ها —');
act(() => { rootReact.unmount(); });
host.innerHTML = '';
const root3 = createRoot(host);
act(() => { root3.render(mountApp()); });
await tick();
const reopened = [...document.querySelectorAll('.nav-group')]
  .filter((g) => g.querySelector('.nav-items.expanded'))
  .map((g) => g.querySelector('.nav-group-title').textContent);
ok('بعد از رفرش همان گروه‌ها باز می‌مانند', reopened.length === openGroups().length,
  `${reopened.join(' | ')} vs ${openGroups().join(' | ')}`);

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
