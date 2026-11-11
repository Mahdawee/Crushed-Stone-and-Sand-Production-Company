/**
 * ورودی تست DOM صفحه‌ها (`pages.test.mjs`).
 *
 * صفحه‌ها همان کامپوننت‌های واقعی پروژه‌اند؛ فقط `lib/api` و `lib/session`
 * با نسخه‌ی ساختگی عوض می‌شوند تا بدون شبکه mount شوند.
 */
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '../../apps/web/src/components/ui';
import { SessionProvider } from '../../apps/web/src/lib/session';

import Customers from '../../apps/web/src/pages/Customers';
import Employees from '../../apps/web/src/pages/Employees';
import Sales from '../../apps/web/src/pages/Sales';
import Expenses from '../../apps/web/src/pages/Expenses';
import Receipts from '../../apps/web/src/pages/Receipts';
import Attendance from '../../apps/web/src/pages/Attendance';
import Salaries from '../../apps/web/src/pages/Salaries';
import ReportsDaily from '../../apps/web/src/pages/ReportsDaily';
import Cashbook from '../../apps/web/src/pages/Cashbook';
import Dashboard from '../../apps/web/src/pages/Dashboard';
import Recycle from '../../apps/web/src/pages/Recycle';
import Activity from '../../apps/web/src/pages/Activity';
import EmployeeProfile from '../../apps/web/src/pages/EmployeeProfile';

/** صفحه را داخل روتر و ToastProvider می‌گذارد — همان محیطی که کاربر می‌بیند */
function Wrap({ initial = '/', path = '*', children }: { initial?: string; path?: string; children: React.ReactNode }) {
  return React.createElement(
    ToastProvider, null,
    React.createElement(SessionProvider, null,
      React.createElement(MemoryRouter, { initialEntries: [initial] },
        React.createElement(Routes, null,
          React.createElement(Route, { path, element: children }),
        ),
      ),
    ),
  );
}

export const CustomersPage = () => React.createElement(Wrap, null, React.createElement(Customers));
/** همان صفحه‌ی فروش، ولی از راه میان‌بر داشبورد: `/sales?new=1` */
export const SalesNewPage = () =>
  React.createElement(Wrap, { initial: '/sales?new=1' }, React.createElement(Sales));
export const EmployeesPage = () => React.createElement(Wrap, null, React.createElement(Employees));
export const SalesPage = () => React.createElement(Wrap, null, React.createElement(Sales));
export const ExpensesPage = () => React.createElement(Wrap, null, React.createElement(Expenses));
export const ReceiptsPage = () => React.createElement(Wrap, null, React.createElement(Receipts));
export const AttendancePage = () => React.createElement(Wrap, null, React.createElement(Attendance));
export const SalariesPage = () => React.createElement(Wrap, null, React.createElement(Salaries));
export const ReportsDailyPage = () => React.createElement(Wrap, null, React.createElement(ReportsDaily));
export const CashbookPage = () => React.createElement(Wrap, null, React.createElement(Cashbook));
export const DashboardPage = () => React.createElement(Wrap, null, React.createElement(Dashboard));
export const RecyclePage = () => React.createElement(Wrap, null, React.createElement(Recycle));
/** صفحه‌ی «سابقه فعالیت» — شامل تب‌های سطل بازیافت و داده‌ی نمونه */
export const ActivityPage = () => React.createElement(Wrap, null, React.createElement(Activity));
export const EmployeeProfilePage = () =>
  React.createElement(Wrap, { initial: '/employees/3', path: '/employees/:id' }, React.createElement(EmployeeProfile));
