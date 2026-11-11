/**
 * تست DOM صفحه‌های واقعی: هر صفحه mount می‌شود، با داده‌ی ساختگی، فورم‌ها
 * باز می‌شوند و ذخیره/حذف بررسی می‌شوند — بدون مرورگر.
 *
 *   node scripts/ui-check/pages.test.mjs
 *
 * ## چرا این تست
 * تست‌های `routes`/`dom` فقط می‌گفتند «مسیر هست» و «کامپوننت رندر می‌شود».
 * اما کاربر می‌گوید «فورم باز نمی‌شود»، «دکمه کار نمی‌کند». این تست همان
 * مسیر واقعی کاربر را می‌رود: کلیک روی دکمه‌ی ثبت → پر کردن کادرها →
 * ذخیره → نگاه‌کردن به درخواستی که به API می‌رود و پیامی که می‌آید.
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* ------------------------------------------------------------------ */
/* ۱) شبیه‌ساز API — مسیرها از روی global خوانده می‌شوند                  */
/*    ⚠ عمداً این‌جا هیچ کد شبیه‌سازی نیست؛ همه در `.mock/api.ts` است تا   */
/*    باندل و تست «همان» آرایه‌ی مسیرها را ببینند.                        */
/* ------------------------------------------------------------------ */
const calls = [];
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });
const resetRoutes = () => { routes.length = 0; calls.length = 0; };

/* ------------------------------------------------------------------ */
/* ۲) build یک ورودی آزمایشی با همه‌ی صفحه‌ها (alias برای api/session)   */
/* ------------------------------------------------------------------ */
const outDir = path.join(root, 'scripts/ui-check/.out-pages');
const mockFiles = path.join(root, 'scripts/ui-check/.mock');
fs.mkdirSync(mockFiles, { recursive: true });
fs.writeFileSync(path.join(mockFiles, 'api.ts'), `
/*
 * شبیه‌ساز API برای تست صفحه‌ها.
 * مسیرها در globalThis.__routes و تماس‌ها در globalThis.__apiCalls هستند تا
 * تستِ بیرونی و باندلِ درون‌مرورگری «همان» داده را ببینند.
 */
const hit = (method) => async (p, b) => {
  globalThis.__apiCalls.push({ method, path: p, body: b });
  for (const r of globalThis.__routes) {
    if (r.method !== method) continue;
    const m = String(p).match(r.pattern);
    if (m) return r.handler({ path: p, body: b, params: m });
  }
  return {};
};
export const calls = globalThis.__apiCalls;
export const api = { get: hit('GET'), post: hit('POST'), put: hit('PUT'), del: hit('DELETE') };
export const API_BASE = '/api';
export const getToken = () => 't';
export const setToken = () => {};
export class ApiError extends Error {}
export const listImportTypes = async () => ({ items: [{ type: 'customers', label: 'مشتریان' }] });
export const listExportTypes = async () => ({ items: [] });
export const runImport = async () => ({ ok: true, report: { inserted: 0, updated: 0, errors: [] } });
export const listRecycle = () => hit('GET')('/recycle');
export const listDeleted = (t) => hit('GET')('/recycle/' + encodeURIComponent(t));
export const restoreDeleted = (t, id) => hit('POST')('/recycle/' + encodeURIComponent(t) + '/' + id + '/restore', {});
export const downloadCsv = () => Promise.resolve();
export const downloadImportTemplate = () => Promise.resolve();
export const readFileAsText = () => Promise.resolve('');
`, 'utf8');

fs.writeFileSync(path.join(mockFiles, 'session.tsx'), `
import React from 'react';
export const useSession = () => ({
  user: { id: 1, username: 'admin', fullName: 'مدیر', role: 'manager' },
  settings: globalThis.__settings || {},
  calendar: 'jalali',
  isManager: true,
  ready: true,
  login: async () => {}, logout: async () => {}, reloadSettings: async () => {},
  saveSettings: async () => {}, applyTheme: () => {},
  license: { ok: true, state: 'valid', message: '', daysLeft: 100 },
  reloadLicense: async () => null,
});
export const applyThemeToDocument = () => {};
export const SessionProvider = ({ children }: any) => React.createElement(React.Fragment, null, children);
`, 'utf8');

/* ------------------------------------------------------------------ */
/* ۳) jsdom                                                           */
/* ------------------------------------------------------------------ */
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/', pretendToBeVisual: true,
});
global.window = dom.window;
for (const k of ['document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'Event',
  'FocusEvent', 'DocumentFragment', 'location', 'history', 'localStorage', 'getComputedStyle',
  'InputEvent', 'HTMLInputElement', 'HTMLTextAreaElement', 'CustomEvent', 'sessionStorage']) {
  Object.defineProperty(global, k, { value: dom.window[k], configurable: true, writable: true });
}
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.matchMedia = () => ({
  media: '', matches: false, addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {},
});
dom.window.matchMedia = global.matchMedia;
Object.defineProperty(globalThis, '__apiCalls', { value: calls, configurable: true, writable: true });
Object.defineProperty(globalThis, '__routes', { value: routes, configurable: true, writable: true });
global.__settings = {};

await build({
  root, configFile: false, logLevel: 'silent',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^.*\/lib\/api$/, replacement: path.join(mockFiles, 'api.ts') },
      { find: /^.*\/lib\/session$/, replacement: path.join(mockFiles, 'session.tsx') },
    ],
  },
  build: {
    outDir, emptyOutDir: true, minify: false,
    lib: { entry: path.join(root, 'scripts/ui-check/pages-entry.tsx'), formats: ['es'], fileName: () => 'bundle.mjs' },
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react-router-dom', 'recharts'] },
  },
});

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const pages = await import(path.join(outDir, 'bundle.mjs'));


const act = React.act || ((fn) => fn());
const shell = document.getElementById('root');
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
/*
 * هر صفحه با یک ریشه‌ی تازه mount می‌شود.
 * ⚠ باگ در خود تست: استفاده‌ی دوباره از یک `createRoot` بعد از unmount
 * باعث خطای React #409 می‌شد و تست را (نه برنامه را) می‌شکست.
 */
let current = null;
let rootReact = null;
/*
 * خطاهای رندر React در jsdom به‌صورت «uncaught» می‌آیند و تست را می‌شکنند.
 * آن‌ها را جمع می‌کنیم تا هر صفحه‌ای که با داده‌ی ناقص سفید می‌شود، پیام
 * روشن بدهد نه کرش بی‌توضیح.
 */
const renderErrors = [];
const origErr = console.error;
console.error = (...a) => {
  renderErrors.push(a.map((x) => (x && x.message) || String(x)).join(' '));
  origErr(...a);
};
const render = async (el) => {
  const host = document.createElement('div');
  host.className = 'page-host';
  shell.innerHTML = '';
  shell.appendChild(host);
  rootReact = createRoot(host);
  current = host;
  act(() => { rootReact.render(el); });
  await wait(150);
};
const cleanup = () => {
  try { if (rootReact) act(() => { rootReact.unmount(); }); } catch { /* */ }
  rootReact = null;
  shell.innerHTML = '';
};

const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const byText = (sel, txt) => qa(sel).find((e) => (e.textContent || '').includes(txt));
const click = (el) => act(() => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
const keyDown = (el, init) => act(() => { el.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init })); });
const type = (el, value) => act(() => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
});
const selectValue = (el, value) => act(() => {
  el.value = value;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
});

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n}${extra ? ' → ' + extra : ''}`)); };
const lastCall = (method, re) => [...calls].reverse().find((c) => c.method === method && re.test(c.path));

/**
 * هر «فرم» را با پر کردن همه‌ی inputها و زدن دکمه‌ی ذخیره اجرا می‌کند و
 * می‌گوید آیا درخواستی به API رفت و آیا خطای کنسول/کرش رخ داد.
 */
async function exerciseForm(label, openBtnText, expectPost) {
  const btn = byText('button', openBtnText);
  ok(`${label}: دکمه‌ی «${openBtnText}» هست`, Boolean(btn));
  if (!btn) return;
  const errors = [];
  const onErr = (e) => errors.push(String(e.reason?.message || e.reason || e.message));
  window.addEventListener('unhandledrejection', onErr);
  clicksBefore = calls.length;
  click(btn);
  await wait(80);
  const modal = q('.modal, .modal-card, [role="dialog"]');
  ok(`${label}: فورم باز شد`, Boolean(modal));
  if (!modal) { window.removeEventListener('unhandledrejection', onErr); return; }
  /* پر کردن همه‌ی inputهای متنی */
  for (const inp of [...modal.querySelectorAll('input')]) {
    if (inp.type === 'checkbox' || inp.readOnly || inp.disabled) continue;
    if (inp.type === 'radio') continue;
    type(inp, inp.type === 'number' || inp.inputMode === 'numeric' || inp.inputMode === 'decimal' ? '12' : 'آزمون');
  }
  for (const ta of [...modal.querySelectorAll('textarea')]) type(ta, 'توضیح آزمون');
  /* Select: اولین گزینه‌ی واقعی (نه placeholder) انتخاب می‌شود */
  for (const sel of [...modal.querySelectorAll('select')]) {
    const opt = [...sel.options].find((o) => o.value && o.value !== '0');
    if (opt) selectValue(sel, opt.value);
  }
  await wait(40);
  const save = byText('.modal button, .modal-card button, [role="dialog"] button', 'ذخیره')
    || byText('.modal button, .modal-card button, [role="dialog"] button', 'ثبت');
  ok(`${label}: دکمه‌ی ذخیره در فورم هست`, Boolean(save));
  if (save) { click(save); await wait(120); }
  const sent = expectPost
    ? calls.slice(clicksBefore).some((c) => c.method === 'POST' || c.method === 'PUT')
    : true;
  ok(`${label}: ذخیره درخواست به API فرستاد`, sent, JSON.stringify(calls.slice(clicksBefore).map((c) => c.method + ' ' + c.path)));
  ok(`${label}: هیچ خطای اجرایی رخ نداد`, errors.length === 0, errors.join(' | '));
  window.removeEventListener('unhandledrejection', onErr);
}
let clicksBefore = 0;

/* ================================================================== */
console.log('\n— صفحه‌ی مشتریان —');
resetRoutes();
route('GET', /^\/customers\/next-code$/, () => ({ code: '004' }));
route('GET', /^\/customers(\?|$)/, () => ([
  { id: 1, code: '001', name: 'شرکت آریا', phone: '0700', creditSales: 1000, receipts: 400, balance: 600 },
  { id: 2, code: '002', name: 'حاجی نور', phone: '', creditSales: 0, receipts: 0, balance: 0 },
]));
route('POST', /^\/customers$/, () => ({ ok: true, code: '004' }));
route('PUT', /^\/customers\/\d+$/, () => ({ ok: true }));
await render(React.createElement(pages.CustomersPage));
ok('فهرست مشتریان رندر شد', qa('tbody tr').length === 2, String(qa('tbody tr').length));
ok('نام مشتری دیده می‌شود', document.body.textContent.includes('شرکت آریا'));
await exerciseForm('مشتریان', 'مشتری', true);
ok('کد بعدی مشتری از سرور گرفته شد', Boolean(lastCall('GET', /^\/customers\/next-code$/)));
cleanup();

/* ================================================================== */
console.log('\n— میان‌بر «بل فروش» در داشبورد (/sales?new=1) —');
resetRoutes();
route('GET', /^\/sales/, () => ({ rows: [], total: 0, sum: 0, volumeSum: 0, freightSum: 0 }));
route('GET', /^\/sales\/next-no/, () => ({ no: 'S-1405-0010' }));
route('GET', /^\/customers/, () => ([{ id: 1, code: '001', name: 'شرکت آریا' }]));
route('GET', /^\/lookups/, () => ({ items: { material: [{ id: 1, name: 'ریگ' }], contractor: [] } }));
await render(React.createElement(pages.SalesNewPage));
await wait(200);
ok('دکمه‌ی «بل فروش» داشبورد فورم را باز می‌کند', document.body.textContent.includes('بل فروش نو'),
  document.body.textContent.slice(0, 120) + ' | calls=' + JSON.stringify(calls.map((c) => c.path)));
ok('شماره‌ی بل از سرور گرفته شد', Boolean(lastCall('GET', /^\/sales\/next-no/)));
cleanup();

/* ================================================================== */
console.log('\n— حذف با تأیید (مشتری) —');
resetRoutes();
route('GET', /^\/customers/, () => ([{ id: 7, code: '007', name: 'مشتری حذفی', creditSales: 0, receipts: 0, balance: 0 }]));
route('DELETE', /^\/customers\/7$/, () => ({ ok: true }));
await render(React.createElement(pages.CustomersPage));
const delBtn = byText('button', 'حذف');
ok('دکمه‌ی حذف در فهرست هست', Boolean(delBtn));
if (delBtn) {
  click(delBtn);
  await wait(80);
  const ask = q('.modal-back .modal');
  ok('پنجره‌ی تأیید حذف باز شد', Boolean(ask), document.body.textContent.slice(-120));
  const yes = qa('.modal-back .modal-f button')[0];
  ok('دکمه‌ی تأیید هست', Boolean(yes));
  if (yes) { click(yes); await wait(150); }
  ok('حذف، درخواست DELETE فرستاد', Boolean(lastCall('DELETE', /^\/customers\/7$/)),
    JSON.stringify(calls.map((c) => c.method + ' ' + c.path)));
  ok('پیام «حذف شد» نشان داده شد', document.body.textContent.includes('حذف شد'));
}
cleanup();

/* ================================================================== */
console.log('\n— صفحه‌ی کارمندان —');
resetRoutes();
route('GET', /^\/employees\/next-code$/, () => ({ code: '007' }));
route('GET', /^\/employees(\?|$)/, () => ({
  rows: [{ id: 3, code: '003', name: 'احمد کریمی', position: 'کارگر', baseSalary: 14000, status: 'active', hireDate: '2026-01-01' }],
}));
route('POST', /^\/employees$/, () => ({ ok: true, code: '007' }));
await render(React.createElement(pages.EmployeesPage));
ok('فهرست کارمندان رندر شد', qa('tbody tr').length === 1, String(qa('tbody tr').length));
await exerciseForm('کارمندان', 'کارمند', true);
cleanup();

/* ================================================================== */
console.log('\n— صفحه‌ی فروشات —');
resetRoutes();
route('GET', /^\/sales\/next-no$/, () => ({ no: 'S-1405-0009' }));
route('GET', /^\/sales(\?|$)/, () => ({
  rows: [{ id: 9, no: 'S-1405-0008', date: '2026-11-10', customerName: 'شرکت آریا', materialName: 'ریگ', volume: 5, unitPrice: 100, total: 500, paymentType: 'credit' }],
  total: 1, sum: 500, volumeSum: 5, freightSum: 0,
}));
route('GET', /^\/customers/, () => ([{ id: 1, code: '001', name: 'شرکت آریا' }]));
route('GET', /^\/lookups/, () => ({ items: { material: [{ id: 1, name: 'ریگ' }], contractor: [{ id: 2, name: 'شاخه الف' }] } }));
route('POST', /^\/sales$/, () => ({ ok: true, no: 'S-1405-0009' }));
await render(React.createElement(pages.SalesPage));
ok('فهرست فروشات رندر شد', qa('tbody tr').length === 1, String(qa('tbody tr').length));
await exerciseForm('فروشات', 'بل فروش', true);
cleanup();

/* ================================================================== */
console.log('\n— صفحه‌ی مصارف —');
resetRoutes();
route('GET', /^\/lookups/, () => ({ items: { expense_category: [{ id: 1, name: 'کرایه وسایط' }], payer: [{ id: 2, name: 'دخل' }], contractor: [] } }));
route('GET', /^\/expenses\/next-no$/, () => ({ no: 'E-1405-0004' }));
route('GET', /^\/expenses(\?|$)/, () => ({
  rows: [{ id: 4, no: 'E-1405-0003', date: '2026-11-10', description: 'کرایه', amountAfn: 300, paymentType: 'cash' }],
  total: 1, sum: 300,
}));
route('POST', /^\/expenses$/, () => ({ ok: true }));
await render(React.createElement(pages.ExpensesPage));
ok('فهرست مصارف رندر شد', qa('tbody tr').length === 1, String(qa('tbody tr').length));
await exerciseForm('مصارف', 'مصرف', true);
cleanup();

/* ================================================================== */
console.log('\n— صفحه‌ی رسیدات —');
resetRoutes();
route('GET', /^\/lookups/, () => ({ items: { receipt_source: [{ id: 1, name: 'بیانیه' }] } }));
route('GET', /^\/customers/, () => ([{ id: 1, code: '001', name: 'شرکت آریا' }]));
route('GET', /^\/receipts\/next-no$/, () => ({ no: 'R-1405-0002' }));
route('GET', /^\/receipts(\?|$)/, () => ({
  rows: [{ id: 2, no: 'R-1405-0001', date: '2026-11-09', customerName: 'شرکت آریا', amount: 400, sourceName: 'بیانیه' }],
  total: 1, sum: 400,
}));
route('POST', /^\/receipts$/, () => ({ ok: true }));
await render(React.createElement(pages.ReceiptsPage));
ok('فهرست رسیدات رندر شد', qa('tbody tr').length === 1, String(qa('tbody tr').length));
await exerciseForm('رسیدات', 'رسید', true);
cleanup();

/* ================================================================== */
console.log('\n— صفحه‌ی حضور و غیاب —');
resetRoutes();
route('GET', /^\/employees(\?|$)/, () => ({
  rows: [{ id: 3, code: '003', name: 'احمد کریمی', position: 'کارگر', baseSalary: 14000, status: 'active' }],
}));
route('GET', /^\/attendance(\?|$)/, () => ({
  date: '2026-11-10', days: ['2026-11-09', '2026-11-10'], rows: [],
  employees: [{ id: 3, code: '003', name: 'احمد کریمی' }], summary: {},
}));
route('POST', /^\/attendance\/bulk$/, () => ({ ok: true }));
await render(React.createElement(pages.AttendancePage));
/* صفحه عنوان را خودش چاپ نمی‌کند (عنوان در Layout است) — سلول‌ها و ابزارها نشانه‌ی رندرند */
ok('صفحه‌ی حضور رندر شد', document.body.textContent.includes('ماهانه') && document.body.textContent.includes('روزانه'));
await wait(60);
ok('سلول‌های حضور ساخته شدند', qa('button, td').length > 3);
cleanup();

/* ================================================================== */
console.log('\n— صفحه‌ی معاش —');
resetRoutes();
route('GET', /^\/salaries\/sheet/, () => ({
  mode: 'jalali', month: '1405-08', label: 'میزان ۱۴۰۵', periodStart: '2026-10-23',
  rows: [{ salaryId: null, employeeId: 3, code: '003', name: 'احمد کریمی', position: 'کارگر',
    baseSalary: 14000, bonus: 0, penalty: 0, overtimeHours: 2, absentDays: 0, deductionDays: 0,
    overtimeAmount: 100, total: 14100, payerName: '', paymentType: 'cash', payDate: '', note: '', saved: false }],
  totalPaid: 0,
}));
route('GET', /^\/salaries(\?|$)/, () => ({ rows: [], total: 0, sum: 0 }));
route('POST', /^\/salaries\/sheet$/, () => ({ ok: true, saved: 1 }));
await render(React.createElement(pages.SalariesPage));
ok('ورق معاش رندر شد', document.body.textContent.includes('احمد کریمی'));
await wait(80);
const saveSheet = byText('button', 'ذخیره');
ok('دکمه‌ی ذخیره‌ی ورق معاش هست', Boolean(saveSheet));
cleanup();

/* ================================================================== */
console.log('\n— صفحه‌ی راپور روزانه —');
resetRoutes();
route('GET', /^\/reports\/daily/, () => ({
  from: '2026-11-01', to: '2026-11-10', calendar: 'jalali',
  rows: [{ date: '2026-11-10', label: '۱۴۰۵/۰۸/۱۹', cashSales: 100, creditSales: 500, receipts: 400, expensesAfn: 300, salaries: 0, totalExpenses: 300, cashBalance: 200 }],
  totals: { cashSales: 100, creditSales: 500, receipts: 400, expensesAfn: 300, salaries: 0, totalExpenses: 300, cashBalance: 200 },
}));
await render(React.createElement(pages.ReportsDailyPage));
ok('راپور روزانه رندر شد', document.body.textContent.includes('۱۴۰۵/۰۸/۱۹') || document.body.textContent.includes('1405'));
cleanup();

/* ================================================================== */
console.log('\n— صفحه‌ی صندوق (کش‌بوک) —');
resetRoutes();
route('GET', /^\/reports\/cashbook/, () => ({
  from: '2026-11-01', to: '2026-11-10', openingBalance: 1000,
  rows: [{ date: '2026-11-10', doc: 'S-1', type: 'فروش نقده', in: 500, out: 0, balance: 1500 }],
  totals: { in: 500, out: 0 }, closingBalance: 1500,
}));
await render(React.createElement(pages.CashbookPage));
ok('صفحه‌ی صندوق رندر شد', document.body.textContent.includes('S-1'));
cleanup();

/* ================================================================== */
console.log('\n— داشبورد —');
resetRoutes();
route('GET', /^\/reports\/dashboard/, () => ({
  calendar: 'jalali',
  today: { allSales: 500, cashSales: 100, creditSales: 400, receipts: 200, expenses: 100, salaries: 0,
    volume: 5, cashBalance: 1000, cashMode: 'accurate', dateDisplay: '۱۴۰۵/۰۸/۱۹', label: 'امروز' },
  month: { label: 'میزان ۱۴۰۵', sales: 5000, volume: 40, expenses: 1000, salaries: 0, profit: 4000 },
  debtTotal: 600,
  debtors: [{ id: 1, name: 'شرکت آریا', balance: 600 }],
  counts: { employees: 1, customers: 2, salaryDoneThisMonth: 0 },
  recentSales: [{ id: 1, no: 'S-1', customerName: 'شرکت آریا', total: 500, date: '2026-11-10', dateDisplay: '۱۴۰۵/۰۸/۱۹' }],
  chart: [{ date: '2026-11-10', label: '۱۹', cash: 100, credit: 400, expenses: 100 }],
}));
await render(React.createElement(pages.DashboardPage));
ok('داشبورد رندر شد', document.body.textContent.includes('شرکت آریا') || document.body.textContent.length > 100);
cleanup();

/* ================================================================== */
console.log('\n— سطل بازیافت —');
resetRoutes();
route('GET', /^\/recycle$/, () => ({
  items: [{ table: 'Sale', label: 'بل فروش', count: 1, titleCol: 'no', extraCols: ['customerName'] }],
  total: 1,
}));
route('GET', /^\/recycle\/Sale$/, () => ({
  table: 'Sale', label: 'بل فروش', titleCol: 'no', extraCols: ['customerName'],
  rows: [{ id: 5, no: 'S-9', customerName: 'شرکت آریا', deletedAt: '2026-11-09T10:00:00Z', deletedBy: 'admin' }],
}));
route('POST', /^\/recycle\/\w+\/\d+\/restore$/, () => ({ ok: true }));
await render(React.createElement(pages.RecyclePage));
await wait(80);
ok('سطل بازیافت ردیف حذف‌شده را نشان می‌دهد', document.body.textContent.includes('S-9'));
const restoreBtn = byText('button', 'بازگرداندن');
ok('دکمه‌ی بازگرداندن هست', Boolean(restoreBtn));
if (restoreBtn) {
  click(restoreBtn);
  await wait(120);
  const confirm = qa('.modal-back .modal-f button').find((b) => (b.textContent || '').includes('بازگردان'));
  ok('تأیید بازگرداندن باز شد', Boolean(confirm));
  if (confirm) { click(confirm); await wait(160); }
  ok('درخواست بازگرداندن به API رفت', Boolean(lastCall('POST', /^\/recycle\/Sale\/5\/restore$/)),
    JSON.stringify(calls.map((c) => c.method + ' ' + c.path)));
}
cleanup();

/* ================================================================== */
console.log('\n— سابقه فعالیت: ادغام سطل بازیافت و داده‌ی نمونه —');
resetRoutes();
/*
 * یک صفحه، سه نما. کاربر گفت «سطل بازیافت را در بخش سابقه فعالیت ادغام کن»
 * و «گزینه‌ی موقت نصب و حذف داده‌های نمونه» — هر دو باید همین‌جا باشند، نه
 * در منوی جدا. این تست دقیقاً همان سه تب را کلیک می‌کند.
 */
route('GET', /^\/system\/timeline/, () => ([
  { id: 9, createdAt: '2026-11-09T10:00:00Z', username: 'admin', action: 'soft-delete', entity: 'Sale', entityId: 5, detail: '', entityLabel: 'فروشات', rowTitle: 'S-9', restorable: true },
  { id: 8, createdAt: '2026-11-09T09:00:00Z', username: 'admin', action: 'create', entity: 'Sale', entityId: 6, detail: 'ثبت بل', entityLabel: 'فروشات', rowTitle: 'S-10', restorable: false },
]));
route('GET', /^\/recycle\/bins/, () => ({
  items: [
    { table: 'Sale', label: 'بل فروش', count: 1, titleCol: 'no', extraCols: ['customerName'] },
    { table: 'Customer', label: 'مشتری', count: 0, titleCol: 'name', extraCols: [] },
  ],
  total: 1,
  bins: { Sale: [{ id: 5, no: 'S-9', customerName: 'شرکت آریا', deletedAt: '2026-11-09T10:00:00Z', deletedBy: 'admin' }], Customer: [] },
}));
route('GET', /^\/system\/demo$/, () => ({ counts: { Sale: 12, Customer: 8, total: 20 }, real: { sales: 3, employees: 2, customers: 1 }, installed: false }));
route('POST', /^\/system\/demo\/install$/, () => ({ ok: true, total: 20, message: '۲۰ ردیف نمونه نصب شد.' }));
route('POST', /^\/system\/demo\/remove$/, () => ({ ok: true, total: 20, message: 'به سطل بازیافت رفت.' }));
route('POST', /^\/recycle\/\w+\/\d+\/restore$/, () => ({ ok: true }));
await render(React.createElement(pages.ActivityPage));
await wait(120);
ok('ستون زمانی رویدادها را نشان می‌دهد', document.body.textContent.includes('S-9') || document.body.textContent.includes('ثبت بل'),
  document.body.textContent.slice(0, 160));
ok('رویداد حذف، دکمه‌ی «بازگرداندن» دارد', Boolean(byText('button', 'بازگرداندن')));
const binTab = byText('button', 'سطل بازیافت');
ok('تب «سطل بازیافت» در همان صفحه هست', Boolean(binTab));
if (binTab) {
  click(binTab); await wait(150);
  ok('ردیف حذف‌شده در تب سطل بازیافت دیده می‌شود', document.body.textContent.includes('S-9'));
  ok('درخواست سطل بازیافت به API رفت', Boolean(lastCall('GET', /^\/recycle\/bins$/)),
    JSON.stringify(calls.map((c) => c.method + ' ' + c.path)));
  const back = byText('button', 'بازگرداندن');
  if (back) {
    click(back); await wait(120);
    const yes = qa('.modal-back .modal-f button').find((b) => (b.textContent || '').includes('بازگردان'));
    ok('تأیید بازگرداندن باز شد', Boolean(yes));
    if (yes) { click(yes); await wait(180); }
    ok('بازگرداندن از داخل سابقه فعالیت درخواست فرستاد',
      Boolean(lastCall('POST', /^\/recycle\/Sale\/5\/restore$/)),
      JSON.stringify(calls.map((c) => c.method + ' ' + c.path)));
  }
}
const demoTab = byText('button', 'داده‌ی نمونه');
ok('تب «داده‌ی نمونه» در همان صفحه هست', Boolean(demoTab));
if (demoTab) {
  click(demoTab); await wait(180);
  ok('وضعیت داده‌ی نمونه از API خوانده شد', Boolean(lastCall('GET', /^\/system\/demo$/)));
  const inst = qa('button').find((b) => (b.textContent || '').includes('نصب داده‌ی نمونه'));
  ok('دکمه‌ی نصب داده‌ی نمونه هست', Boolean(inst), qa('button').map((b) => b.textContent).join('|').slice(0, 200));
  if (inst) {
    click(inst); await wait(120);
    const yes = qa('.modal-back .modal-f button').find((b) => (b.textContent || '').includes('نصب'));
    ok('تأیید نصب داده‌ی نمونه باز شد', Boolean(yes));
    if (yes) { click(yes); await wait(220); }
    const sent = lastCall('POST', /^\/system\/demo\/install$/);
    ok('درخواست نصب داده‌ی نمونه رفت', Boolean(sent), JSON.stringify(calls.map((c) => c.method + ' ' + c.path)));
    ok('تعداد ماه با درخواست فرستاده شد', Boolean(sent && Number(sent.body?.months) >= 1), JSON.stringify(sent?.body));
  }
}
cleanup();

/* ================================================================== */
console.log('\n— صفحه‌ی پروفایل کارمند —');
resetRoutes();
route('GET', /^\/employees\/3$/, () => ({
  employee: { id: 3, code: '003', name: 'احمد کریمی', position: 'کارگر', baseSalary: 14000, status: 'active' },
  deleted: false, salaries: [], attendance: [],
}));
await render(React.createElement(pages.EmployeeProfilePage));
await wait(60);
ok('پروفایل کارمند باز شد', document.body.textContent.includes('احمد کریمی'), document.body.textContent.slice(0, 80));
cleanup();

/* ================================================================== */
console.log(`\n${fail === 0 ? '✅' : '⛔'} ${pass} موفق، ${fail} ناکام\n`);
process.exit(fail === 0 ? 0 : 1);
