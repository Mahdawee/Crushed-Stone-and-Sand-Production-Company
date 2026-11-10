import React, { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider, Spinner } from './components/ui';
import Layout from './components/Layout';
import LoginPage from './pages/Login';
import Dashboard from './pages/Dashboard';

/*
 * کارایی: قبلاً **همه‌ی** صفحه‌ها (و کتابخانه‌ی نمودار recharts با ~۴۰۰KB) در
 * یک باندل بود؛ پنجره باید همه را دانلود/تجزیه می‌کرد تا صفحه‌ی ورود باز شود.
 * روی لپ‌تاپ قدیمی این یعنی چند ثانیه پنجره‌ی خالی.
 *
 * حالا هر صفحه فقط وقتی باز شود بارگذاری می‌شود (`lazy` + `Suspense`). داشبورد
 * و ورود در باندل اصلی می‌مانند تا اولین صفحه فوری بیاید.
 */
const CompanyPage = lazy(() => import('./pages/Company'));
const EmployeesPage = lazy(() => import('./pages/Employees'));
const EmployeeProfile = lazy(() => import('./pages/EmployeeProfile'));
const AttendancePage = lazy(() => import('./pages/Attendance'));
const SalesPage = lazy(() => import('./pages/Sales'));
const CustomersPage = lazy(() => import('./pages/Customers'));
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
const HelpPage = lazy(() => import('./pages/Help'));
const PrintSale = lazy(() => import('./pages/PrintSale'));
const PrintSalary = lazy(() => import('./pages/PrintSalary'));

function Guard({ children, managerOnly }: { children: React.ReactNode; managerOnly?: boolean }) {
  const { user, ready, isManager } = useSession();
  if (!ready) return <Spinner label="آماده‌سازی سیستم…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (managerOnly && !isManager) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Shell() {
  const { ready } = useSession();
  if (!ready) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spinner label="آماده‌سازی سیستم…" /></div>;
  return (
    <Suspense fallback={<div style={{ padding: 24 }}><Spinner label="بارگذاری صفحه…" /></div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/print/sale/:id" element={<PrintSale />} />
      <Route path="/print/salary/:id" element={<PrintSalary />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="/company" element={<CompanyPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/employees/:id" element={<EmployeeProfile />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerStatement />} />
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
