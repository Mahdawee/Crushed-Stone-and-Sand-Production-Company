import React, { lazy, Suspense, useState as useReactState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider, Spinner } from './components/ui';
import Layout from './components/Layout';
import LoginPage from './pages/Login';
import StartupLicense, { BOOT_LICENSE_KEY } from './pages/StartupLicense';

/**
 * کلید «برگشتن از صفحه‌ی لایسنس».
 *
 * کاربر گفت: «از صفحه لایسنس برگشت نمی‌شود به برنامه — این مشکل است و باید
 * رفع شود».
 *
 * ## ریشه‌ی باگ
 * صفحه‌ی لایسنس با یک لینک معمولی (`<a href>` به `#/license`) باز می‌شد؛ از صفحه‌ی شروع و از
 * صفحه‌ی ورود). `href` باعث **بارگذاری کامل صفحه** می‌شد؛ بعد از آن
 * `sessionStorage` همان سند قبلی نبود و مسیر هم `#/license` می‌ماند. نتیجه:
 * کاربر دوباره روی «صفحه‌ی شروع» یا صفحه‌ی لایسنس گیر می‌کرد و راه برگشتی
 * نداشت. اکنون:
 *   • `EndLicense` یک دروازه‌ی واقعی است: دکمه‌ی «بازگشت به برنامه» با
 *     `navigate(-1)` یا مسیر امن برمی‌گردد.
 *   • صفحه‌ی شروع هم دکمه‌ی «ادامه» دارد و هم Escape.
 *   • صفحه‌ی لایسنس همیشه راه برگشت دارد (مگر برنامه قفل باشد).
 */
const RETURN_KEY = 'farday.license.returnTo';

/*
 * کارایی: قبلاً **همه‌ی** صفحه‌ها (و کتابخانه‌ی نمودار recharts با ~۴۰۰KB) در
 * یک باندل بود؛ پنجره باید همه را دانلود/تجزیه می‌کرد تا صفحه‌ی ورود باز شود.
 * روی لپ‌تاپ قدیمی این یعنی چند ثانیه پنجره‌ی خالی.
 *
 * حالا هر صفحه فقط وقتی باز شود بارگذاری می‌شود (`lazy` + `Suspense`).
 *
 * ── اصلاح دور ۴۰ ────────────────────────────────────────────────────────
 * داشبورد **eager** مانده بود و چون `recharts` را import می‌کند، همان
 * ۴۱۳KB نمودار در باندل اصلی می‌نشست و روی **هر** باز شدن برنامه دانلود و
 * تجزیه می‌شد — دقیقاً همان چیزی که این تفکیک می‌خواست جلویش را بگیرد.
 * حالا داشبورد هم `lazy` است. صفحه‌ی ورود و لایسنس عمداً eager می‌مانند،
 * چون اولین چیزی هستند که کاربر باید ببیند (و هیچ‌کدام recharts ندارند).
 */
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CompanyPage = lazy(() => import('./pages/Company'));
const EmployeesPage = lazy(() => import('./pages/Employees'));
const EmployeeProfile = lazy(() => import('./pages/EmployeeProfile'));
const AttendancePage = lazy(() => import('./pages/Attendance'));
const SalesPage = lazy(() => import('./pages/Sales'));
const CustomersPage = lazy(() => import('./pages/Customers'));
const DebtsPage = lazy(() => import('./pages/Debts'));
const CustomerStatement = lazy(() => import('./pages/CustomerStatement'));
const ReceiptsPage = lazy(() => import('./pages/Receipts'));
const ExpensesPage = lazy(() => import('./pages/Expenses'));
const SalariesPage = lazy(() => import('./pages/Salaries'));
const ReportsDaily = lazy(() => import('./pages/ReportsDaily'));
const ReportsMonthly = lazy(() => import('./pages/ReportsMonthly'));
const ReportsYearly = lazy(() => import('./pages/ReportsYearly'));
const ReportsDetail = lazy(() => import('./pages/ReportsDetail'));
const CashbookPage = lazy(() => import('./pages/Cashbook'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const LookupsPage = lazy(() => import('./pages/Lookups'));
const UsersPage = lazy(() => import('./pages/Users'));
const BackupPage = lazy(() => import('./pages/Backup'));
const ActivityPage = lazy(() => import('./pages/Activity'));
const RecyclePage = lazy(() => import('./pages/Recycle'));
const HelpPage = lazy(() => import('./pages/Help'));
const PrintSale = lazy(() => import('./pages/PrintSale'));
const PrintDoc = lazy(() => import('./pages/PrintDoc'));
const PrintSalary = lazy(() => import('./pages/PrintSalary'));
const LicensePage = lazy(() => import('./pages/License'));

function Guard({ children, managerOnly }: { children: React.ReactNode; managerOnly?: boolean }) {
  const { user, ready, isManager } = useSession();
  if (!ready) return <Spinner label="آماده‌سازی سیستم…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (managerOnly && !isManager) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Shell() {
  const { ready, license } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  /* شمارنده‌ی «تأیید شروع»: بعد از کلیک «ورود به برنامه» دوباره رندر می‌شویم */
  const [, setAck] = useReactState(0);
  const [bootKey] = useReactState(() => sessionStorage.getItem(BOOT_LICENSE_KEY));

  /*
   * مسیر امن برای برگشت از صفحه‌ی لایسنس.
   *
   * اگر کاربر از «داشبورد» به لایسنس رفته، همان مسیر ذخیره می‌شود. اگر
   * صفحه‌ی لایسنس از یک لینک/صفحه‌ی شروع باز شده، مسیر پیش‌فرض «/» است —
   * نه `-1`، چون تاریخ مرورگر می‌تواند به صفحه‌ی لایسنس خودش برگردد و
   * حلقه بسازد.
   */
  const leaveLicense = () => {
    let back = sessionStorage.getItem(RETURN_KEY) || '/';
    sessionStorage.removeItem(RETURN_KEY);
    if (!back.startsWith('/') || back.startsWith('/license')) back = '/';
    navigate(back, { replace: true });
    setAck((n) => n + 1);
  };

  if (!ready) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spinner label="آماده‌سازی سیستم…" /></div>;

  /*
   * صفحه‌ی لایسنس — همیشه از همه‌ی حالت‌ها راه برگشت دارد.
   *
   * این مسیر **قبل از** هر گیت دیگری بررسی می‌شود تا وقتی کاربر روی
   * `#/license` است، هیچ گیتی او را جابه‌جا نکند و دکمه‌ی «بازگشت» هدف
   * درستی داشته باشد.
   */
  if (location.pathname === '/license') {
    return (
      <Suspense fallback={<div style={{ padding: 24 }}><Spinner label="بارگذاری…" /></div>}>
        <LicensePage
          /* اگر برنامه قفل است، راه برگشتی وجود ندارد — دکمه پنهان می‌شود */
          onBack={license?.ok ? leaveLicense : undefined}
          canContinue={Boolean(license?.ok)}
          /*
           * ── باگ (شکار باگ دور ۳۴): دکمه‌ی «راهنما» مرده بود ──────────────
           * این دکمه کاربر را به `/help` می‌برد، ولی گیتِ پایین‌تر
           * (`license && !license.ok`) هر مسیری جز `/login` و `/license` را
           * با `<Navigate to="/license">` برمی‌گرداند. یعنی وقتی کاربر
           * *بیشتر از همه* به راهنما نیاز داشت (لایسنس نامعتبر/منقضی)، دکمه
           * او را به همان صفحه برمی‌گرداند و هیچ اتفاقی نمی‌افتاد.
           * حالا راهنما داخل خود صفحه‌ی لایسنس باز و بسته می‌شود — بدون
           * جابه‌جایی مسیر، پس هیچ گیتی نمی‌تواند آن را ببلعد.
           */
          onHelp={() => {
            /* راهنمای کامل داخل همین صفحه است — به آن اسکرول و برجسته می‌کنیم */
            const el = document.getElementById('license-help');
            if (!el) return;
            try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch { /* */ }
            el.classList.add('lic-flash');
            setTimeout(() => el.classList.remove('lic-flash'), 1600);
          }}
        />
      </Suspense>
    );
  }

  /*
   * درخواست کاربر: «صفحه لایسنس باید در شروع برنامه ظاهر شود».
   *
   * ## چرا «هر بار باز شدن» و نه «فقط وقتی قفل است»
   * نسخه‌ی قبلی صفحه‌ی لایسنس را فقط در حالت نامعتبر نشان می‌داد؛ کاربرِ
   * با لایسنس سالم هیچ‌وقت نمی‌فهمید چند روز مانده تا منقضی شود. حالا در هر
   * اجرای برنامه یک **صفحه‌ی شروع** نمایش داده می‌شود: وضعیت، روزهای
   * باقی‌مانده، هشدار تمدید و دکمه‌ی «ادامه به برنامه».
   *
   * ولی هر بار رفتن به یک صفحه، این را تکرار نمی‌کند (فقط یک بار در هر
   * اجرای برنامه — `sessionStorage`).
   */
  /*
   * ⚠ باگ رفع‌شده: قبلاً این بلوک `path="*"` می‌گذاشت، پس هر مسیری را
   * می‌بلعید و کاربر تا کلیک نمی‌کرد هیچ صفحه‌ای نمی‌دید — حتی بعد از
   * فعال‌سازی، باز هم برای یک لحظه به صفحه‌ی شروع برمی‌گشت. حالا فقط وقتی
   * مسیر عادی است (نه لایسنس/ورود/چاپ) و کاربر تأیید نکرده.
   */
  const acknowledged = bootKey === '1' || sessionStorage.getItem(BOOT_LICENSE_KEY) === '1';
  const isPlainRoute = !['/login', '/license'].includes(location.pathname)
    && !location.pathname.startsWith('/print/');
  if (license && license.ok && !acknowledged && isPlainRoute) {
    const ack = () => {
      sessionStorage.setItem(BOOT_LICENSE_KEY, '1');
      setAck((n) => n + 1);
    };
    return (
      <Suspense fallback={<div style={{ padding: 24 }}><Spinner label="بارگذاری…" /></div>}>
        <StartupLicense license={license} onContinue={ack} onOpenLicense={() => {
          /* مسیر برگشت اینجا «/» است، نه صفحه‌ی شروع */
          sessionStorage.setItem(RETURN_KEY, '/');
          navigate('/license');
        }} />
      </Suspense>
    );
  }

  /*
   * قفل لایسنس — **قبل از** هر مسیر دیگری.
   *
   * فقط خانه‌ی لایسنس باز می‌ماند؛ این کار جلوی «صفحه‌ی سفید» و «چرخیدن
   * بی‌پایان اسپینر» را می‌گیرد و کاربر را مستقیم به راه‌حل می‌برد.
   * صفحه‌ی ورود هم باز است تا کاربرِ کارمند بتواند وارد شود (فقط مدیر
   * باید لایسنس را فعال کند).
   */
  if (license && !license.ok) {
    return (
      <Suspense fallback={<div style={{ padding: 24 }}><Spinner label="بارگذاری…" /></div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/license" replace />} />
        </Routes>
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<div style={{ padding: 24 }}><Spinner label="بارگذاری صفحه…" /></div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* مسیر /license بالاتر گرفته شد — دوباره تعریف نمی‌شود */}
      <Route path="/print/sale/:id" element={<PrintSale />} />
      {/* چاپ رسید و مصرف (C4) — یک مسیر برای دو نوع سند */}
      <Route path="/print/receipt/:id" element={<PrintDoc kind="receipt" />} />
      <Route path="/print/expense/:id" element={<PrintDoc kind="expense" />} />
      <Route path="/print/salary/:id" element={<PrintSalary />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Suspense fallback={<Spinner />}><Dashboard /></Suspense>} />
        <Route path="/company" element={<CompanyPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/employees/:id" element={<EmployeeProfile />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerStatement />} />
        <Route path="/debts" element={<DebtsPage />} />
        <Route path="/receipts" element={<ReceiptsPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/salaries" element={<SalariesPage />} />
        <Route path="/reports/daily" element={<ReportsDaily />} />
        <Route path="/reports/monthly" element={<ReportsMonthly />} />
        <Route path="/reports/yearly" element={<ReportsYearly />} />
        <Route path="/reports/detail" element={<ReportsDetail />} />
        <Route path="/reports/cashbox" element={<CashbookPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/lookups/:type" element={<LookupsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/backup" element={<BackupPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        {/* سطل بازیافت فقط برای مدیر — همان قاعده‌ای که API دارد */}
        <Route path="/recycle" element={<Guard managerOnly><RecyclePage /></Guard>} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </ToastProvider>
  );
}
