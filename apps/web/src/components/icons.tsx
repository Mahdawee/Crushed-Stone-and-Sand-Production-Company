import React from 'react';

/**
 * مجموعه آیکن‌های خطی و یکدست (بدون ایموجی).
 * همه با stroke و currentColor رسم می‌شوند تا با رنگ متن/تم هماهنگ بمانند.
 */
type P = { size?: number; className?: string; strokeWidth?: number; style?: React.CSSProperties };

const Svg = ({ size = 18, className, strokeWidth = 1.7, style, children }: P & { children: React.ReactNode }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}
    stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false"
  >{children}</svg>
);

export const IconDashboard = (p: P) => (
  <Svg {...p}><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="4.5" rx="2" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="2" /><rect x="3" y="14" width="7.5" height="7" rx="2" /></Svg>
);
export const IconBuilding = (p: P) => (
  <Svg {...p}><path d="M4 21V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v15" /><path d="M15 10h3a2 2 0 0 1 2 2v9" />
    <path d="M2 21h20" /><path d="M8 8h3M8 12h3M8 16h3" /></Svg>
);
export const IconUsers = (p: P) => (
  <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M17 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M18.5 20a5.6 5.6 0 0 0-2.4-4.5" /></Svg>
);
export const IconCalendar = (p: P) => (
  <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3 10h18" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" /></Svg>
);
export const IconTruck = (p: P) => (
  <Svg {...p}><path d="M2 7h11v10H2z" /><path d="M13 10h4l4 3.5V17h-8" />
    <circle cx="6" cy="18.5" r="1.8" /><circle cx="17" cy="18.5" r="1.8" /></Svg>
);
export const IconContact = (p: P) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10.5" r="2.2" />
    <path d="M5.5 17a3.8 3.8 0 0 1 7 0" /><path d="M15 9h3M15 13h3" /></Svg>
);
export const IconReceipt = (p: P) => (
  <Svg {...p}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></Svg>
);
export const IconWallet = (p: P) => (
  <Svg {...p}><rect x="2.5" y="6" width="19" height="13" rx="3" /><path d="M2.5 10h19" />
    <circle cx="17" cy="14.5" r="1.2" /></Svg>
);
export const IconCoins = (p: P) => (
  <Svg {...p}><ellipse cx="12" cy="6.5" rx="7" ry="3" /><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    <path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></Svg>
);
export const IconChart = (p: P) => (
  <Svg {...p}><path d="M3 3v18h18" /><rect x="6.5" y="12" width="3" height="6" rx="1" />
    <rect x="12" y="8" width="3" height="10" rx="1" /><rect x="17.5" y="5" width="3" height="13" rx="1" /></Svg>
);
export const IconTrend = (p: P) => (
  <Svg {...p}><path d="M3 17l5.5-6 4 3.5L21 6" /><path d="M15.5 6H21v5.5" /></Svg>
);
export const IconSearchDoc = (p: P) => (
  <Svg {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /><path d="M8 10.5h5M10.5 8v5" /></Svg>
);
export const IconCash = (p: P) => (
  <Svg {...p}><rect x="2.5" y="5.5" width="19" height="13" rx="3" /><circle cx="12" cy="12" r="2.6" />
    <path d="M6 9v6M18 9v6" /></Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="3.1" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" /></Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /><path d="M12 14.5v2.5" /></Svg>
);
export const IconDatabase = (p: P) => (
  <Svg {...p}><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></Svg>
);
export const IconHistory = (p: P) => (
  <Svg {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3 4v5h5" /><path d="M12 8v4.5l3 1.8" /></Svg>
);
export const IconHelp = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.6 9.2a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.2 1-1.2 1.8v.4" /><path d="M12 17.4h.01" /></Svg>
);
export const IconPlus = (p: P) => (<Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>);
export const IconDownload = (p: P) => (
  <Svg {...p}><path d="M12 3v11" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M4 19h16" /></Svg>
);
export const IconPrint = (p: P) => (
  <Svg {...p}><path d="M7 8V3.5h10V8" /><rect x="3.5" y="8" width="17" height="8" rx="2" />
    <path d="M7 16h10v4.5H7z" /></Svg>
);
export const IconEdit = (p: P) => (
  <Svg {...p}><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M13.5 6.5l4 4" /></Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v5M14 11v5" /></Svg>
);
export const IconFilter = (p: P) => (
  <Svg {...p}><path d="M3 5h18l-7 8v6l-4 2v-8z" /></Svg>
);
export const IconChevron = (p: P & { dir?: 'start' | 'end' | 'down' | 'up' }) => {
  const { dir = 'end', ...rest } = p;
  return (
    <Svg {...rest} size={rest.size ?? 14}>
      {dir === 'down' ? <path d="M6 9l6 6 6-6" />
        : dir === 'up' ? <path d="M6 15l6-6 6 6" />
        : dir === 'start' ? <path d="M15 5l-7 7 7 7" />
        : <path d="M9 5l7 7-7 7" />}
    </Svg>
  );
};
/**
 * آیکن «جمع/باز کردن سایدبار» — یک قاب با خط عمودی و فلش کوچک.
 * مدرن و مینیمال: یک مسیر پیوسته، بدون جزئیات اضافه.
 */
export const IconPanel = (p: P & { open?: boolean }) => {
  const { open, ...rest } = p;
  return (
    <Svg {...rest} size={rest.size ?? 15}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9.5 4v16" />
      {open ? <path d="M17.5 9.5 15 12l2.5 2.5" /> : <path d="M15 9.5 17.5 12 15 14.5" />}
    </Svg>
  );
};
export const IconMenu = (p: P) => (<Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>);
export const IconSun = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>
);
export const IconMoon = (p: P) => (<Svg {...p}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></Svg>
);
export const IconLogout = (p: P) => (
  <Svg {...p}><path d="M14 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H14" /><path d="M17 8.5L20.5 12 17 15.5" /><path d="M10 12h10" /></Svg>
);
export const IconClose = (p: P) => (<Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>);
export const IconCheck = (p: P) => (<Svg {...p}><path d="M4.5 12.5l5 5 10-11" /></Svg>);
export const IconAlert = (p: P) => (
  <Svg {...p}><path d="M12 3.5l9 16H3z" /><path d="M12 9.5v4.5" /><path d="M12 17.2h.01" /></Svg>
);
export const IconInfo = (p: P) => (<Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.6h.01" /></Svg>);

export const IconPackage = (p: P) => (
  <Svg {...p}><path d="M12 2.8l8.5 4.6v9.2L12 21.2 3.5 16.6V7.4z" /><path d="M3.5 7.4L12 12l8.5-4.6" /><path d="M12 12v9.2" /></Svg>
);
export const IconFolder = (p: P) => (
  <Svg {...p}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.2H18.5A2.5 2.5 0 0 1 21 9.7v7.3a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 17z" /></Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 1.9" /></Svg>
);
