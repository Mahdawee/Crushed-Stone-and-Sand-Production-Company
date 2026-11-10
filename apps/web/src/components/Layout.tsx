import React, { useEffect, useMemo, useRef, useState } from 'react';
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

/** عرضی که سایدبار از «ثابت» به «کشو» تبدیل می‌شود — همان ۱۱۰۰px در app.css */
const MQ_DRAWER = '(max-width: 1100px)';

export default function Layout() {
  const { user, logout, isManager, settings, saveSettings, calendar } = useSession();
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState(() => localStorage.getItem(RAIL_KEY) === '1');
  /** زیر ۱۱۰۰px سایدبار «کشو» می‌شود: با دکمه منو باز و با ضربدر/کلیک بیرون بسته */
  const [drawer, setDrawer] = useState(() => window.matchMedia(MQ_DRAWER).matches);
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(CLOSED_KEY) || '{}'); } catch { return {}; }
  });
  const loc = useLocation();
  const nav = useNavigate();
  const dark = document.documentElement.dataset.theme === 'dark';

  const title = PAGE_TITLES[loc.pathname] || { t: 'فردای روشن', s: '' };

  /** گروهی که صفحه فعلی در آن است، همیشه باز می‌ماند */
  const activeGroup = useMemo(
    () => NAV.find((g) => g.items.some((i) => i.to === loc.pathname))?.id || '',
    [loc.pathname],
  );

  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => { localStorage.setItem(RAIL_KEY, rail ? '1' : '0'); }, [rail]);

  /* با تغییر اندازه پنجره، حالت کشو زنده عوض می‌شود */
  useEffect(() => {
    const mq = window.matchMedia(MQ_DRAWER);
    const onChange = () => { setDrawer(mq.matches); if (!mq.matches) setOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* Alt+S / Alt+G: جمع‌کردن سایدبار و باز/بستن گروه‌ها بدون موس */
  useEffect(() => {
    const onAlt = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); setRail((v) => !v); }
      if (k === 'g') {
        e.preventDefault();
        setClosed((prev) => {
          const allOpen = NAV.every((g) => prev[g.id] === false || g.id === activeGroup);
          const next: Record<string, boolean> = {};
          NAV.forEach((g) => { next[g.id] = allOpen; });
          return next;
        });
      }
    };
    window.addEventListener('keydown', onAlt);
    return () => window.removeEventListener('keydown', onAlt);
  }, [activeGroup]);
  useEffect(() => { localStorage.setItem(CLOSED_KEY, JSON.stringify(closed)); }, [closed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleTheme = async () => {
    const next = { ...settings, theme: dark ? 'light' : 'dark' };
    applyThemeToDocument(next);
    try { await saveSettings({ theme: next.theme }); } catch { /* ignore */ }
  };

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.managerOnly || isManager) }))
    .filter((g) => g.items.length);

  /* ریل (فقط دسکتاپ): زیرمنو در پنل شناور • در حالت عادی: زیرمنو تاشو */
  const popoverMode = rail && !drawer;

  /** آکاردئونی: باز کردن یک دسته بقیه را می‌بندد (منو کم‌شلوغ می‌ماند) */
  const toggleGroup = (id: string, isOpen: boolean) => {
    if (isOpen && activeGroup !== id) { setClosed({ ...closed, [id]: true }); return; }
    const next: Record<string, boolean> = {};
    NAV.forEach((g) => { next[g.id] = true; });
    next[id] = false;
    setClosed(next);
  };

  /* موقعیت کارت گروه‌ها در حالت ریل، تا پنل زیرمنو درست کنارش باز شود */
  const [groupTop, setGroupTop] = useState(0);
  const groupRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [hoverGroup, setHoverGroup] = useState('');

  const openPanel = (id: string) => {
    const el = groupRefs.current[id];
    if (!el) return;
    const r = el.getBoundingClientRect();
    setGroupTop(Math.max(8, Math.min(r.top, window.innerHeight - 320)));
    setHoverGroup(id);
  };

  return (
    <div className={`app ${open ? 'sidebar-open' : ''} ${rail && !drawer ? 'rail' : ''}`}>
      <aside className={`sidebar no-print ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">ف</div>
          <div className="brand-txt">
            <strong>فردای روشن</strong>
            <span>سنگ، کرش، جغل و ریگ</span>
          </div>
          <button
            className="sb-collapse" onClick={() => setRail((v) => !v)}
            title={rail ? 'باز کردن سایدبار (Alt+S)' : 'جمع کردن سایدبار (Alt+S)'}
            aria-label={rail ? 'باز کردن سایدبار' : 'جمع کردن سایدبار'}
            aria-expanded={!rail}
          >
            <IconChevron dir={rail ? 'start' : 'end'} size={14} />
          </button>
          <button className="btn ghost icon sb-close" onClick={() => setOpen(false)} title="بستن منو" aria-label="بستن منو">
            <IconClose size={16} />
          </button>
        </div>

        <nav className="nav">
          {groups.map((g) => {
            const isActiveGroup = activeGroup === g.id;
            /* در حالت ریل همه آیتم‌ها در پنل شناور دیده می‌شوند */
            const isOpen = popoverMode ? hoverGroup === g.id : (closed[g.id] === false || isActiveGroup);
            const GIcon = g.icon;
            return (
              <div
                className="nav-group" key={g.id}
                onMouseEnter={popoverMode ? () => openPanel(g.id) : undefined}
                onMouseLeave={popoverMode ? () => setHoverGroup('') : undefined}
              >
                <button
                  ref={(el) => { groupRefs.current[g.id] = el; }}
                  className={`nav-group-head ${isActiveGroup ? 'has-active' : ''}`}
                  onClick={() => (popoverMode ? openPanel(g.id) : toggleGroup(g.id, isOpen))}
                  title={popoverMode ? g.title : undefined}
                  aria-expanded={isOpen}
                >
                  <GIcon size={15} />
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
                        title={popoverMode ? undefined : item.label}
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

        {/* پنل شناور گروه در حالت ریل — بدون transform و بدون قرار گرفتن در DOM دیگر */}
        {popoverMode && hoverGroup ? (
          <div className="nav-pop" style={{ top: groupTop }} onMouseLeave={() => setHoverGroup('')}>
            <div className="nav-pop-t">{groups.find((g) => g.id === hoverGroup)?.title}</div>
            {groups.find((g) => g.id === hoverGroup)?.items.map((item) => {
              const IIcon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} end={item.to === '/'}
                  className={({ isActive }) => `nav-pop-link ${isActive ? 'active' : ''}`}>
                  <IIcon size={16} /> {item.label}
                </NavLink>
              );
            })}
          </div>
        ) : null}

        <div className="nav-foot">
          <NavLink to="/sales?new=1" className="btn primary btn-block nav-new" title="ثبت بل فروش نو">
            <IconPlus size={16} /><span>بل فروش نو</span>
          </NavLink>
        </div>
      </aside>

      {open ? <div className="sb-backdrop no-print" onClick={() => setOpen(false)} /> : null}

      <div className="main">
        <header className="topbar no-print">
          <button
            className="btn ghost icon drawer-btn" onClick={() => setOpen((v) => !v)}
            title="نمایش / پنهان کردن منو" aria-label="نمایش یا پنهان کردن منو" aria-expanded={open}
          ><IconMenu size={18} /></button>
          <span className="topbar-sep" />
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
