import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession, applyThemeToDocument } from '../lib/session';
import { formatDate, todayISO } from '../lib/calendar';
import {
  IconBuilding, IconCalendar, IconCash, IconChart, IconChevron, IconClose, IconCoins,
  IconContact, IconDashboard, IconDatabase, IconHelp, IconHistory, IconLock, IconLogout,
  IconMenu, IconMoon, IconPlus, IconReceipt, IconSearchDoc, IconSettings, IconSun, IconTrend,
  IconTruck, IconUsers, IconWallet,
} from './icons';

type NavItem = { to: string; label: string; icon: React.FC<{ size?: number }>; managerOnly?: boolean };
type NavGroup = { id: string; title: string; icon: React.FC<{ size?: number }>; items: NavItem[] };

/**
 * پوسته برنامه — سایدبار دو حالته، بدون حالت‌های نصفه‌نیمه.
 *
 * همیشه فقط یکی از این دو رفتار فعال است (با عرض پنجره تعیین می‌شود):
 *
 *  ① «پهلو»  (≥ ۱۱۰۱px): سایدبار همیشه دیده می‌شود؛ دکمه‌ی بالای آن با آن
 *     محتوا را جمع می‌کند (حالت ریل ۶۴px با پنل شناور گروه‌ها). دکمه‌ی سه‌خط و
 *     ضربدر «بستن» در این حالت وجود ندارند چون معنایی ندارند.
 *
 *  ② «کشو» (≤ ۱۱۰۰px): سایدبار روی محتوا می‌آید. دکمه‌ی سه‌خط در نوار بالا آن را
 *     باز/بسته می‌کند؛ ضربدر گوشه‌ی سایدبار و کلیک روی پشت‌زمینه هم می‌بندند.
 *     زیرمنوها همیشه تاشو هستند (آکاردئون).
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
/** تنها نقطه شکست رفتار سایدبار — دقیقاً همان ۱۱۰۰px در app.css */
const MQ_DRAWER = '(max-width: 1100px)';

export default function Layout() {
  const { user, logout, isManager, settings, saveSettings, calendar } = useSession();
  const loc = useLocation();
  const nav = useNavigate();
  const dark = document.documentElement.dataset.theme === 'dark';

  /** ①/② کدام رفتار؟ از خود CSS هم استفاده می‌شود (body.is-drawer) */
  const [drawer, setDrawer] = useState(() => window.matchMedia(MQ_DRAWER).matches);
  /** در حالت کشو: باز است یا نه. در حالت پهلو معنا ندارد و همیشه false است */
  const [open, setOpen] = useState(false);
  /** حالت ریل (فقط پهلو) — انتخاب کاربر */
  const [rail, setRail] = useState(() => localStorage.getItem(RAIL_KEY) === '1');
  /** گروه‌های بسته‌شده (آکاردئون) — دسته‌ی صفحه‌ی جاری همیشه باز می‌ماند */
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(CLOSED_KEY) || '{}'); } catch { return {}; }
  });
  /** پنل شناور در حالت ریل */
  const [hoverGroup, setHoverGroup] = useState('');
  const [groupTop, setGroupTop] = useState(0);
  const groupRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const title = PAGE_TITLES[loc.pathname] || { t: 'فردای روشن', s: '' };
  const activeGroup = useMemo(
    () => NAV.find((g) => g.items.some((i) => i.to === loc.pathname))?.id || '',
    [loc.pathname],
  );

  const groups = NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.managerOnly || isManager) }))
    .filter((g) => g.items.length);

  const railActive = rail && !drawer;

  /* ---- هم‌زمان‌سازی با عرض پنجره ---- */
  useEffect(() => {
    const mq = window.matchMedia(MQ_DRAWER);
    const onChange = () => {
      setDrawer(mq.matches);
      setOpen(false);            /* با عوض شدن حالت، کشو بسته شود */
      setHoverGroup('');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** کلاس روی <body> تا CSS فقط یک منبع حقیقت داشته باشد */
  useEffect(() => {
    document.body.classList.toggle('is-drawer', drawer);
    document.body.classList.toggle('is-rail', railActive);
    return () => { document.body.classList.remove('is-drawer', 'is-rail'); };
  }, [drawer, railActive]);

  useEffect(() => { localStorage.setItem(RAIL_KEY, rail ? '1' : '0'); }, [rail]);
  useEffect(() => { localStorage.setItem(CLOSED_KEY, JSON.stringify(closed)); }, [closed]);

  /* با رفتن به صفحه‌ی نو: کشو بسته، پنل ریل بسته */
  useEffect(() => { setOpen(false); setHoverGroup(''); }, [loc.pathname]);

  /* Esc: اول پنل ریل، بعد کشو (با برگشت فوکوس روی دکمه‌ی منو) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (hoverGroup) { setHoverGroup(''); return; }
      if (open) { setOpen(false); menuBtnRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hoverGroup, open]);

  /* Alt+S جمع/باز کردن سایدبار — Alt+G همه‌ی گروه‌ها (وقتی در فیلد نیستیم) */
  useEffect(() => {
    const onAlt = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); if (drawer) setOpen((v) => !v); else setRail((v) => !v); }
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
  }, [drawer, activeGroup]);

  const toggleTheme = async () => {
    const next = { ...settings, theme: dark ? 'light' : 'dark' };
    applyThemeToDocument(next);
    try { await saveSettings({ theme: next.theme }); } catch { /* ignore */ }
  };

  /** آکاردئونی: باز کردن یک گروه، بقیه را می‌بندد (منو کم‌شلوغ می‌ماند) */
  const toggleGroup = (id: string, isOpen: boolean) => {
    /* گروه صفحه‌ی جاری قابل بستن نیست تا کاربر گم نشود */
    if (id === activeGroup) return;
    if (isOpen) { setClosed({ ...closed, [id]: true }); return; }
    const next: Record<string, boolean> = {};
    NAV.forEach((g) => { next[g.id] = true; });
    next[id] = false;
    setClosed(next);
  };

  /** موقعیت پنل شناور ریل: کنار همان گروه */
  const openPanel = (id: string) => {
    const el = groupRefs.current[id];
    if (!el) return;
    const r = el.getBoundingClientRect();
    setGroupTop(Math.max(8, Math.min(r.top - 6, window.innerHeight - 300)));
    setHoverGroup(id);
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const group = groups.find((g) => g.id === hoverGroup);

  return (
    <div className={`app ${open ? 'sidebar-open' : ''} ${railActive ? 'rail' : ''} ${drawer ? 'is-drawer' : ''}`}>
      <aside className={`sidebar no-print ${open ? 'open' : ''}`} aria-label="منوی اصلی">
        <div className="brand">
          <div className="brand-logo">ف</div>
          <div className="brand-txt">
            <strong>فردای روشن</strong>
            <span>سنگ، کرش، جغل و ریگ</span>
          </div>

          {/* ① جمع کردن سایدبار — فقط در حالت پهلو */}
          <button
            className="sb-collapse" onClick={() => setRail((v) => !v)} type="button"
            title={rail ? 'باز کردن سایدبار (Alt+S)' : 'جمع کردن سایدبار (Alt+S)'}
            aria-label={rail ? 'باز کردن سایدبار' : 'جمع کردن سایدبار'}
            aria-expanded={!rail}
          >
            <IconChevron dir={rail ? 'start' : 'end'} size={15} />
          </button>

          {/* ② بستن کشو — فقط در حالت کشو */}
          <button
            className="sb-close" onClick={() => setOpen(false)} type="button"
            title="بستن منو (Esc)" aria-label="بستن منو"
          >
            <IconClose size={16} />
          </button>
        </div>

        <nav className="nav" onMouseLeave={railActive ? () => setHoverGroup('') : undefined}>
          {groups.map((g) => {
            const isActiveGroup = activeGroup === g.id;
            /* در ریل: گروه فقط با هاور/کلیک باز می‌شود؛ در حالت عادی: آکاردئون */
            const isOpen = railActive ? hoverGroup === g.id : (closed[g.id] === false || isActiveGroup);
            const GIcon = g.icon;
            return (
              <div
                key={g.id}
                className="nav-group"
                onMouseEnter={railActive ? () => openPanel(g.id) : undefined}
              >
                <button
                  type="button"
                  ref={(el) => { groupRefs.current[g.id] = el; }}
                  className={`nav-group-head ${isActiveGroup ? 'has-active' : ''}`}
                  onClick={() => (railActive ? openPanel(g.id) : toggleGroup(g.id, isOpen))}
                  title={railActive ? g.title : undefined}
                  aria-expanded={isOpen}
                >
                  <GIcon size={15} />
                  <span className="nav-group-title">{g.title}</span>
                  {railActive ? null : (
                    <IconChevron dir="down" size={13} className={`nav-group-chev ${isOpen ? 'up' : ''}`} />
                  )}
                </button>

                <div className={`nav-items ${isOpen && !railActive ? 'expanded' : ''}`}>
                  {g.items.map((item) => {
                    const IIcon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/'}
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

        {/* پنل شناور گروه در حالت ریل */}
        {railActive && group ? (
          <div
            className="nav-pop" style={{ top: groupTop }}
            onMouseLeave={() => setHoverGroup('')}
          >
            <div className="nav-pop-t">{group.title}</div>
            {group.items.map((item) => {
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

      {drawer && open ? <div className="sb-backdrop no-print" onClick={() => setOpen(false)} /> : null}

      <div className="main">
        <header className="topbar no-print">
          {/* سه‌خط: فقط در حالت کشو */}
          {drawer ? (
            <button
              type="button" ref={menuBtnRef} className="btn ghost icon drawer-btn"
              onClick={() => setOpen((v) => !v)}
              title="منو" aria-label="باز یا بسته کردن منو" aria-expanded={open}
            ><IconMenu size={18} /></button>
          ) : null}

          <div className="page-title">{title.t}<small>{title.s}</small></div>
          <div className="topbar-spacer" />

          <span className="today-chip" title="امروز">
            <span className="dot" />
            {formatDate(todayISO(), calendar, true)}
          </span>

          <button type="button" className="btn ghost icon" onClick={toggleTheme}
            title={dark ? 'حالت روشن' : 'حالت تیره'} aria-label={dark ? 'حالت روشن' : 'حالت تیره'}>
            {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>

          <div className="user-chip">
            <button
              type="button" className="avatar-btn" onClick={() => setMenuOpen((v) => !v)}
              title="حساب کاربری" aria-expanded={menuOpen}
            >
              <span className="avatar">{(user?.fullName || user?.username || '?').slice(0, 1)}</span>
              <span className="meta">
                <strong>{user?.fullName || user?.username}</strong>
                <span>{user?.role === 'manager' ? 'مدیر سیستم' : 'کارمند'}</span>
              </span>
              <IconChevron dir="down" size={12} />
            </button>
            {menuOpen ? (
              <>
                <div className="user-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="user-menu" role="menu">
                  <div className="user-menu-head">
                    <strong>{user?.fullName || user?.username}</strong>
                    <span className="small muted">{user?.role === 'manager' ? 'مدیر سیستم' : 'کارمند'}</span>
                  </div>
                  <NavLink to="/settings" className="user-menu-item" onClick={() => setMenuOpen(false)}>
                    <IconSettings size={15} /> تنظیمات
                  </NavLink>
                  <button type="button" className="user-menu-item danger"
                    onClick={async () => { setMenuOpen(false); await logout(); nav('/login'); }}>
                    <IconLogout size={15} /> خروج از حساب
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
