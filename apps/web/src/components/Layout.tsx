import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession, applyThemeToDocument } from '../lib/session';
import { formatDate, todayISO } from '../lib/calendar';
import {
  IconAlert, IconBuilding, IconCalendar, IconCash, IconChart, IconChevron, IconClose, IconCoins,
  IconContact, IconDashboard, IconDatabase, IconDownload, IconHelp, IconHistory, IconLock, IconLogout,
  IconMenu, IconMoon, IconPlus, IconReceipt, IconSearchDoc, IconSettings, IconSun, IconTrend,
  IconTruck, IconUsers, IconWallet,
} from './icons';

type NavItem = { to: string; label: string; icon: React.FC<{ size?: number }>; managerOnly?: boolean };
type NavGroup = { id: string; title: string; icon: React.FC<{ size?: number }>; items: NavItem[] };

/**
 * منوی کنار: کم‌شلوغ، دسته‌بندی‌شده و قابل جمع‌شدن.
 *  • دسکتاپ: «حالت ریل» (فقط آیکن) با یک کلیک، برای جا باز کردن
 *  • موبایل: کشوی روی صفحه با پشت‌زمینه تار
 */
const NAV: NavGroup[] = [
  {
    id: 'general', title: 'عمومی', icon: IconDashboard,
    items: [
      { to: '/', label: 'داشبورد', icon: IconDashboard },
      { to: '/company', label: 'مشخصات شرکت', icon: IconBuilding },
      { to: '/employees', label: 'کارمندان', icon: IconUsers },
      { to: '/attendance', label: 'حضور و غیاب', icon: IconCalendar },
    ],
  },
  {
    id: 'trade', title: 'معاملات', icon: IconTruck,
    items: [
      { to: '/sales', label: 'فروشات', icon: IconTruck },
      { to: '/customers', label: 'مشتریان', icon: IconContact },
      { to: '/receipts', label: 'رسیدات', icon: IconReceipt },
      { to: '/expenses', label: 'مصارف', icon: IconWallet },
      { to: '/salaries', label: 'معاشات', icon: IconCoins },
    ],
  },
  {
    id: 'reports', title: 'راپورها', icon: IconChart,
    items: [
      { to: '/reports/daily', label: 'راپور روزانه', icon: IconCalendar },
      { to: '/reports/monthly', label: 'راپور ماهانه', icon: IconChart },
      { to: '/reports/yearly', label: 'راپور سالانه', icon: IconTrend },
      { to: '/reports/detail', label: 'راپورهای تفصیلی', icon: IconSearchDoc },
      { to: '/reports/cashbox', label: 'حرکت دخل', icon: IconCash },
    ],
  },
  {
    id: 'system', title: 'مدیریت سیستم', icon: IconSettings,
    items: [
      { to: '/settings', label: 'تنظیمات', icon: IconSettings },
      { to: '/users', label: 'کاربران', icon: IconLock, managerOnly: true },
      { to: '/backup', label: 'پشتیبان‌گیری', icon: IconDatabase, managerOnly: true },
      { to: '/activity', label: 'سابقه فعالیت', icon: IconHistory },
      { to: '/help', label: 'راهنما', icon: IconHelp },
    ],
  },
];

const PAGE_TITLES: Record<string, { t: string; s: string }> = {
  '/': { t: 'داشبورد', s: 'خلاصه امروز و این ماه' },
  '/company': { t: 'مشخصات شرکت', s: 'شیت ثابت — فردای روشن' },
  '/employees': { t: 'کارمندان', s: 'مدیریت کارمندان و قراردادها' },
  '/attendance': { t: 'حضور و غیاب', s: 'ورق ماهانه و روزانه' },
  '/sales': { t: 'فروشات', s: 'بل فروش، متراژ، کرایه و پرداخت' },
  '/customers': { t: 'مشتریان', s: 'باقی مانده بدهی و کارت حساب' },
  '/receipts': { t: 'رسیدات', s: 'دریافت پول از مشتریان' },
  '/expenses': { t: 'مصارف', s: 'افغانی و دالری — نقده / باقی' },
  '/salaries': { t: 'معاشات', s: 'ورق ماهانه معاش' },
  '/reports/daily': { t: 'راپور روزانه', s: 'فروش، رسید، مصرف و موجودی دخل' },
  '/reports/monthly': { t: 'راپور ماهانه', s: 'سود و زیان هر ماه' },
  '/reports/yearly': { t: 'راپور سالانه', s: 'خلاصه سال مالی' },
  '/reports/detail': { t: 'راپورهای تفصیلی', s: 'به مواد، مشتری، مصرف و بدهی' },
  '/reports/cashbox': { t: 'حرکت دخل', s: 'سند به سند صندوق' },
  '/settings': { t: 'تنظیمات', s: 'ظاهر، تقویم، فهرست‌ها و دیتابیس' },
  '/users': { t: 'کاربران سیستم', s: 'سطح دسترسی مدیر و کارمند' },
  '/backup': { t: 'پشتیبان‌گیری', s: 'کاپی، دانلود و بازگردانی' },
  '/activity': { t: 'سابقه فعالیت', s: 'چه کسی، چه وقت، چه کرد' },
  '/help': { t: 'راهنمای سیستم', s: 'کار با هر شیت و فرمول‌ها' },
};

const RAIL_KEY = 'farday.sidebarRail';
const CLOSED_KEY = 'farday.sidebarGroups';

export default function Layout() {
  const { user, logout, isManager, settings, saveSettings, calendar } = useSession();
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState(() => localStorage.getItem(RAIL_KEY) === '1');
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(CLOSED_KEY) || '{}'); } catch { return {}; }
  });
  const loc = useLocation();
  const nav = useNavigate();
  const dark = document.documentElement.dataset.theme === 'dark';

  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => { localStorage.setItem(RAIL_KEY, rail ? '1' : '0'); }, [rail]);
  useEffect(() => { localStorage.setItem(CLOSED_KEY, JSON.stringify(closed)); }, [closed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); nav('/sales?focus=search'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  const title = PAGE_TITLES[loc.pathname] || { t: 'فردای روشن', s: '' };

  /** گروهی که صفحه فعلی در آن است، همیشه باز می‌ماند */
  const activeGroup = useMemo(
    () => NAV.find((g) => g.items.some((i) => i.to === loc.pathname))?.id || '',
    [loc.pathname],
  );

  const toggleTheme = async () => {
    const next = { ...settings, theme: dark ? 'light' : 'dark' };
    applyThemeToDocument(next);
    try { await saveSettings({ theme: next.theme }); } catch { /* ignore */ }
  };

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.managerOnly || isManager) }))
    .filter((g) => g.items.length);

  /** آکاردئونی: باز کردن یک دسته بقیه را می‌بندد (منو کم‌شلوغ می‌ماند) */
  const toggleGroup = (id: string, isOpen: boolean) => {
    if (isOpen && activeGroup !== id) { setClosed({ ...closed, [id]: true }); return; }
    const next: Record<string, boolean> = {};
    NAV.forEach((g) => { next[g.id] = true; });
    next[id] = false;
    setClosed(next);
  };

  return (
    <div className={`app ${open ? 'sidebar-open' : ''} ${rail ? 'rail' : ''}`}>
      <aside className={`sidebar no-print ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">ف</div>
          <div className="brand-txt">
            <strong>فردای روشن</strong>
            <span>سنگ، کرش، جغل و ریگ</span>
          </div>
          <button className="sb-collapse" onClick={() => setRail((v) => !v)} title={rail ? 'باز کردن منو' : 'جمع کردن منو'}>
            <IconChevron dir={rail ? 'start' : 'end'} size={14} />
          </button>
          <button className="btn ghost icon sb-close" onClick={() => setOpen(false)} title="بستن">
            <IconClose size={16} />
          </button>
        </div>

        <nav className="nav">
          {groups.map((g) => {
            const isOpen = closed[g.id] === false || activeGroup === g.id;
            const GIcon = g.icon;
            return (
              <div className="nav-group" key={g.id}>
                <button
                  className={`nav-group-head ${activeGroup === g.id ? 'has-active' : ''}`}
                  onClick={() => toggleGroup(g.id, isOpen)}
                  title={rail ? g.title : undefined}
                >
                  <GIcon size={14} />
                  <span className="nav-group-title">{g.title}</span>
                  <IconChevron dir="down" size={13} className={`nav-group-chev ${isOpen ? 'up' : ''}`} />
                </button>
                <div className={`nav-items ${isOpen ? 'expanded' : ''}`}>
                  {g.items.map((item) => {
                    const IIcon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/'}
                        title={rail ? item.label : undefined}
                        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                      >
                        <span className="ico"><IIcon size={17} /></span>
                        <span className="lbl">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="nav-foot">
          <NavLink to="/sales?new=1" className="btn primary btn-block nav-new" title="ثبت بل فروش نو">
            <IconPlus size={16} /><span>بل فروش نو</span>
          </NavLink>
        </div>
      </aside>

      {open ? <div className="sb-backdrop no-print" onClick={() => setOpen(false)} /> : null}

      <div className="main">
        <header className="topbar no-print">
          <button className="btn ghost icon hamburger" onClick={() => setOpen((v) => !v)} title="منو"><IconMenu size={18} /></button>
          <div className="page-title">{title.t}<small>{title.s}</small></div>
          <div className="topbar-spacer" />
          <span className="today-chip" title="امروز">
            <span className="dot" />
            {formatDate(todayISO(), calendar, true)}
          </span>
          <button className="btn ghost icon" onClick={toggleTheme} title={dark ? 'حالت روشن' : 'حالت تیره'}>
            {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>
          <div className="user-chip">
            <div className="avatar">{(user?.fullName || user?.username || '?').slice(0, 1)}</div>
            <div className="meta">
              <strong>{user?.fullName || user?.username}</strong>
              <span>{user?.role === 'manager' ? 'مدیر سیستم' : 'کارمند'}</span>
            </div>
            <button className="btn sm ghost icon" onClick={async () => { await logout(); nav('/login'); }} title="خروج از حساب">
              <IconLogout size={16} />
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
