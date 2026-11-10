import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession, applyThemeToDocument } from '../lib/session';

type NavItem = { to: string; label: string; icon: string; managerOnly?: boolean; children?: NavItem[] };
type Group = { title: string; items: NavItem[] };

const NAV: Group[] = [
  {
    title: 'عمومی',
    items: [
      { to: '/', label: 'داشبورد', icon: '▦' },
      { to: '/company', label: 'مشخصات شرکت', icon: '🏢' },
      { to: '/employees', label: 'کارمندان', icon: '👷' },
      { to: '/attendance', label: 'حضور و غیاب', icon: '🗓' },
    ],
  },
  {
    title: 'معاملات',
    items: [
      { to: '/sales', label: 'فروشات', icon: '🚚' },
      { to: '/customers', label: 'مشتریان', icon: '👥' },
      { to: '/receipts', label: 'رسیدات', icon: '🧾' },
      { to: '/expenses', label: 'مصارف', icon: '💸' },
      { to: '/salaries', label: 'معاشات', icon: '💰' },
    ],
  },
  {
    title: 'راپورها',
    items: [
      { to: '/reports/daily', label: 'راپور روزانه', icon: '📅' },
      { to: '/reports/monthly', label: 'راپور ماهانه', icon: '📊' },
      { to: '/reports/yearly', label: 'راپور سالانه', icon: '📈' },
      { to: '/reports/detail', label: 'راپورهای تفصیلی', icon: '🔎' },
      { to: '/reports/cashbox', label: 'حرکت دخل', icon: '🏦' },
    ],
  },
  {
    title: 'مدیریت سیستم',
    items: [
      {
        to: '/settings', label: 'تنظیمات', icon: '⚙', children: [
          { to: '/settings/lookups/material', label: 'اقلام و مواد', icon: '•' },
          { to: '/settings/lookups/expense_category', label: 'انواع مصرف', icon: '•' },
          { to: '/settings/lookups/payer', label: 'پرداخت‌کنندگان', icon: '•' },
          { to: '/settings/lookups/receipt_source', label: 'منابع رسیدات', icon: '•' },
          { to: '/settings/lookups/contractor', label: 'باربری‌ها', icon: '•' },
        ],
      },
      { to: '/users', label: 'کاربران سیستم', icon: '🔐', managerOnly: true },
      { to: '/backup', label: 'پشتیبان‌گیری', icon: '💾', managerOnly: true },
      { to: '/activity', label: 'سابقه فعالیت', icon: '🕘' },
      { to: '/help', label: 'راهنما', icon: '❓' },
    ],
  },
];

const PAGE_TITLES: Record<string, { t: string; s: string }> = {
  '/': { t: 'داشبورد', s: 'خلاصه امروز و این ماه شرکت' },
  '/company': { t: 'مشخصات شرکت', s: 'شیت ثابت — فردای روشن' },
  '/employees': { t: 'کارمندان', s: 'مدیریت ۲۰ کارمند و قراردادها' },
  '/attendance': { t: 'حضور و غیاب', s: 'ورق روزانه و نمای ماهانه' },
  '/sales': { t: 'فروشات', s: 'بل فروش، متراژ، کرایه و نوع پرداخت' },
  '/customers': { t: 'مشتریان', s: 'باقی مانده بدهی و کارت حساب' },
  '/receipts': { t: 'رسیدات', s: 'دریافت پول از مشتریان' },
  '/expenses': { t: 'مصارف', s: 'افغانی و دالری — نقده / باقی' },
  '/salaries': { t: 'معاشات', s: 'ورق ماهانه معاش کارمندان' },
  '/reports/daily': { t: 'راپور روزانه', s: 'فروشات، رسیدات، مصارف و موجودی دخل' },
  '/reports/monthly': { t: 'راپور ماهانه', s: 'سود و زیان هر ماه' },
  '/reports/yearly': { t: 'راپور سالانه', s: 'خلاصه سال مالی' },
  '/reports/detail': { t: 'راپورهای تفصیلی', s: 'به مواد، مشتری، مصرف و بدهی' },
  '/reports/cashbox': { t: 'حرکت دخل', s: 'سند به سند صندوق' },
  '/settings': { t: 'تنظیمات', s: 'ظاهر، تقویم، فهرست‌ها و دیتابیس' },
  '/users': { t: 'کاربران سیستم', s: 'دسترسی مدیر و کارمند' },
  '/backup': { t: 'پشتیبان‌گیری', s: 'کاپی و بازگردانی دیتابیس' },
  '/activity': { t: 'سابقه فعالیت', s: 'چه کسی، چه وقت، چه کرد' },
  '/help': { t: 'راهنمای سیستم', s: 'کار با هر شیت و فرمول‌ها' },
};

export default function Layout() {
  const { user, logout, isManager, settings, saveSettings } = useSession();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '/settings': true });
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const title = PAGE_TITLES[loc.pathname] || { t: 'فردای روشن', s: '' };
  const dark = document.documentElement.dataset.theme === 'dark';

  const toggleTheme = async () => {
    const next = { ...settings, theme: dark ? 'light' : 'dark' };
    applyThemeToDocument(next);
    try { await saveSettings({ theme: next.theme }); } catch { /* ignore */ }
  };

  return (
    <div className={`app ${open ? 'sidebar-open' : ''}`}>
      <aside className={`sidebar no-print ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">ف</div>
          <div className="brand-txt">
            <strong>فردای روشن</strong>
            <span>تولید سنگ، کرش، جغل و ریگ</span>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-group-title">{g.title}</div>
              {g.items.filter((i) => !i.managerOnly || isManager).map((item) => (
                <div key={item.to}>
                  {(item.children?.length ?? 0) > 0 ? (
                    <>
                      <div
                        className={`nav-link ${loc.pathname.startsWith(item.to) ? 'active' : ''}`}
                        onClick={() => setExpanded((p) => ({ ...p, [item.to]: !p[item.to] }))}
                      >
                        <span className="ico">{item.icon}</span>
                        <span>{item.label}</span>
                        <span className="chev">{expanded[item.to] ? '▾' : '▸'}</span>
                      </div>
                      {expanded[item.to] ? (
                        <div className="nav-sub">
                          <NavLink to={item.to} end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <span className="ico">◎</span><span>ظاهر و سیستم</span>
                          </NavLink>
                          {item.children.map((c) => (
                            <NavLink key={c.to} to={c.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                              <span className="ico">{c.icon}</span><span>{c.label}</span>
                            </NavLink>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <span className="ico">{item.icon}</span><span>{item.label}</span>
                    </NavLink>
                  )}
                </div>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar no-print">
          <button className="btn ghost icon hamburger" onClick={() => setOpen((v) => !v)} title="منو">☰</button>
          <div className="page-title">{title.t}<small>{title.s}</small></div>
          <div className="topbar-spacer" />
          <button className="btn ghost icon" onClick={toggleTheme} title="روشن / تیره">{dark ? '☀' : '☾'}</button>
          <div className="row" style={{ gap: 10 }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '.8rem', fontWeight: 700 }}>{user?.fullName || user?.username}</div>
              <div className="small muted">{user?.role === 'manager' ? 'مدیر سیستم' : 'کارمند'}</div>
            </div>
            <div className="brand-logo" style={{ width: 34, height: 34, fontSize: 14, borderRadius: 10 }}>
              {(user?.fullName || user?.username || '?').slice(0, 1)}
            </div>
            <button className="btn sm" onClick={async () => { await logout(); nav('/login'); }}>خروج</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
