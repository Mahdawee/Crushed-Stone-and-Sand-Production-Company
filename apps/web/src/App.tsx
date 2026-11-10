import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider, Spinner } from './components/ui';
import Layout from './components/Layout';
import LoginPage from './pages/Login';
import Dashboard from './pages/Dashboard';
import CompanyPage from './pages/Company';
import EmployeesPage from './pages/Employees';
import EmployeeProfile from './pages/EmployeeProfile';
import AttendancePage from './pages/Attendance';
import SalesPage from './pages/Sales';
import CustomersPage from './pages/Customers';
import CustomerStatement from './pages/CustomerStatement';
import ReceiptsPage from './pages/Receipts';
import ExpensesPage from './pages/Expenses';
import SalariesPage from './pages/Salaries';
import ReportsDaily from './pages/ReportsDaily';
import ReportsMonthly from './pages/ReportsMonthly';
import ReportsYearly from './pages/ReportsYearly';
import ReportsDetail from './pages/ReportsDetail';
import CashbookPage from './pages/Cashbook';
import SettingsPage from './pages/Settings';
import LookupsPage from './pages/Lookups';
import UsersPage from './pages/Users';
import BackupPage from './pages/Backup';
import ActivityPage from './pages/Activity';
import HelpPage from './pages/Help';
import PrintSale from './pages/PrintSale';
import PrintSalary from './pages/PrintSalary';

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
