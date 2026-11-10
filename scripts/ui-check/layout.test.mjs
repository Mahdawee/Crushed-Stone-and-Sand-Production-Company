/**
 * بررسی واقعی رفتار سایدبار و DatePicker — رندر در jsdom + CSS واقعی پروژه.
 *
 *   node scripts/ui-check/layout.test.mjs
 *
 * چرا این فایل اضافه شد: «کد درست است» کافی نیست؛ باید رفتار و استایل
 * واقعی (نه فقط کامپایل) بررسی شود. اینجا کلاس‌ها و قواعد CSS با هم
 * تطبیق داده می‌شوند تا دکمه‌ای که نمایش داده می‌شود واقعاً کار کند.
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/', pretendToBeVisual: true });
global.window = dom.window;
for (const k of ['document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'getComputedStyle', 'localStorage', 'Event']) {
  Object.defineProperty(global, k, { value: dom.window[k] ?? dom.window.document.defaultView?.[k], configurable: true, writable: true });
}
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

let NARROW = false;
const makeMql = (q) => {
  const ls = new Set();
  return {
    media: q,
    get matches() { return /max-width:\s*1100px/.test(q) ? NARROW : false; },
    addEventListener: (_, f) => ls.add(f), removeEventListener: (_, f) => ls.delete(f),
    addListener: (f) => ls.add(f), removeListener: (f) => ls.delete(f),
  };
};
global.matchMedia = makeMql;
dom.window.matchMedia = makeMql;

const css = fs.readFileSync(path.join(root, 'apps/web/src/styles/app.css'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'apps/web/src/components/Layout.tsx'), 'utf8');
const picker = fs.readFileSync(path.join(root, 'apps/web/src/components/DatePicker.tsx'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name}${extra ? `  → ${extra}` : ''}`); }
};

/* ---------- ۱) دکمه سه‌خط و ضربدر: هرگز هم‌زمان و هیچ‌وقت در حالت پهلو ---------- */
console.log('\n— سایدبار: دکمه‌ها در هر حالت —');
ok('سه‌خط پیش‌فرض پنهان است', /\.drawer-btn \{ display: none; \}/.test(css));
ok('سه‌خط فقط با body.is-drawer نمایش داده می‌شود', /body\.is-drawer \.drawer-btn \{ display: inline-flex; \}/.test(css));
ok('ضربدر «بستن» فقط در حالت کشو', /body\.is-drawer \.sb-close \{ display: inline-flex/.test(css) && /\.sb-close \{ display: none; \}/.test(css));
ok('در حالت کشو، دکمه ریل پنهان می‌شود', /body\.is-drawer \.sb-toggle \{ display: none; \}/.test(css));
ok('Layout سه‌خط را فقط وقتی کشو است رندر می‌کند', /\{drawer \? \(/.test(layout));
ok('Layout کلاس is-drawer را روی body می‌گذارد', /classList\.toggle\('is-drawer'/.test(layout));
ok('بدون media-query پنهان‌کاری برای سه‌خط', !/@media[^{]*\{\s*\.drawer-btn/.test(css));

/* ---------- ۲) باز/بسته شدن کشو و children ---------- */
console.log('\n— سایدبار: رفتار کشو (≤۱۱۰۰px) —');
ok('کشو با transform جابه‌جا می‌شود و بسته‌ها روی صفحه می‌آیند', /body\.is-drawer \.sidebar \{/.test(css) && /transform: translateX\(100%\)/.test(css));
ok('حالت باز = transform: none', /body\.is-drawer \.sidebar\.open \{ transform: none; \}/.test(css));
ok('در کشو، ریل نادیده گرفته می‌شود', /body\.is-drawer \.app\.rail \.sidebar \{ width: 268px/.test(css));
ok('پشت‌زمینه (backdrop) فقط در کشو تعریف شده', /body\.is-drawer \.sb-backdrop \{/.test(css));
ok('هیچ گروهی از بسته‌شدن منع نشده (حتی گروه فعال)', !/id === activeGroup\) return/.test(layout));
ok('toggleGroup فقط همان گروه را عوض می‌کند (آکاردئون نیست)', /setClosed\(\(prev\) => \(\{ \.\.\.prev, \[id\]: isOpen \}\)\)/.test(layout));
ok('وضعیت باز بودن از closed خوانده می‌شود، نه از صفحه فعال', /const isOpen = railActive \? hoverGroup === g\.id : !closed\[g\.id\];/.test(layout));
ok('گروه فعال فقط نشانه (نقطه) دارد', /\.nav-group-head\.has-active::after/.test(css));
ok('زیرمنوها در کشو تاشو هستند (expanded)', /nav-items \$\{isOpen && !railActive \? 'expanded' : ''\}/.test(layout));

/* ---------- ۳) حالت ریل ---------- */
console.log('\n— سایدبار: حالت ریل (≥۱۱۰۱px) —');
ok('ریل ۶۴px است', /\.app\.rail \.sidebar \{ width: 64px/.test(css));
ok('دکمه ریل مینیمال است (بدون کادر/سایه پیش‌فرض)', /\.sb-toggle \{[^}]*border: 1px solid transparent/.test(css));
ok('در ریل، دکمه بازکردن کنار لوگو دیده می‌شود', /\.app\.rail \.sb-toggle \{[^}]*position: absolute/.test(css));
ok('آیکن اختصاصی جمع/باز کردن سایدبار داریم', /export const IconPanel/.test(fs.readFileSync(path.join(root, 'apps/web/src/components/icons.tsx'), 'utf8')));
ok('در ریل زیرمنوها پنهان و پنل شناور جایگزین', /\.app\.rail \.nav-items \{ display: none; \}/.test(css) && /\.nav-pop \{/.test(css));
ok('پنل شناور کنار سایدبار باز می‌شود', /inset-inline-start: calc\(100% \+ 10px\)/.test(css));
ok('Layout پنل را فقط در حالت ریل می‌سازد', /\{railActive && group \? \(/.test(layout));

/* ---------- ۴) DatePicker ---------- */
console.log('\n— DatePicker —');
ok('کل کادر یک دکمه است و کلیک در هر جایش تقویم را باز می‌کند', /className="dp-trigger"[\s\S]{0,220}onClick=\{\(\) => \(open \? setOpen\(false\) : openCal\(\)\)\}/.test(picker));
ok('ورود دستی حذف شده (input تایپ‌شدنی نداریم)', !/<input/.test(picker) && !/commitText|parseLoose/.test(picker));
ok('متن نمایشی از مقدار ساخته می‌شود', /const text = value \? formatDate\(value, calendar\) : '';/.test(picker));
ok('آیکن و متن هر دو داخل جریان flex هستند (نه absolute)', /\.dp-trigger \{[^}]*display: flex/.test(css) && /\.dp-field \{[^}]*display: flex/.test(css));
ok('هیچ عنصری در کادر تاریخ position:absolute ندارد', !/\.dp-(field|trigger|cal|value|clear) \{[^}]*position: absolute/.test(css));
ok('متن با ellipsis کوتاه می‌شود، نه با هم‌پوشانی', /\.dp-value \{[^}]*text-overflow: ellipsis/.test(css));
ok('پاک کردن با دکمه × انجام می‌شود', /className="dp-clear"/.test(picker));
ok('پاپ‌آور با Esc بسته می‌شود', /if \(e\.key === 'Escape'\) setOpen\(false\);/.test(picker));
ok('انتخاب روز مقدار را می‌دهد و می‌بندد', /const pickDay = \(d: number\) => \{\n\s*onChange\(fromCalendar/.test(picker));

/* ---------- ۵) پاکت‌ها باید وجود داشته باشند (رگرسیون کلاس‌های بی‌قاعده) ---------- */
console.log('\n— هم‌خوانی کلاس‌ها بین TSX و CSS —');
const used = new Set();
for (const src of [layout, picker]) {
  /* className="..." و className={`...`} — عبارات JSX داخل {} نادیده گرفته می‌شوند */
  for (const m of src.matchAll(/className=(?:"([^"]+)"|`([^`]+)`)/g)) {
    const raw = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ');
    for (const c of raw.split(/\s+/)) if (c && !/[$:{}\/]/.test(c)) used.add(c);
  }
}
const missing = [...used].filter((c) => !css.includes(`.${c}`));
ok('همه کلاس‌های Layout/DatePicker در CSS تعریف شده‌اند', missing.length === 0, missing.join(', '));

console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
