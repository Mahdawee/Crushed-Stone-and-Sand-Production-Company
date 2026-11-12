import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api';
import type { CalendarMode } from './calendar';

export type User = { id: number; username: string; fullName: string; role: 'manager' | 'employee' };
export type Settings = Record<string, string>;

type Ctx = {
  user: User | null;
  settings: Settings;
  calendar: CalendarMode;
  isManager: boolean;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  saveSettings: (patch: Settings) => Promise<void>;
  applyTheme: (s: Settings) => void;
  /** وضعیت لایسنس این دستگاه (null = هنوز خوانده نشده) */
  license: LicenseStatus | null;
  reloadLicense: () => Promise<LicenseStatus | null>;
};

/** وضعیت لایسنس — همان شکل پاسخ `GET /api/license/status` */
export type LicenseStatus = {
  ok: boolean;
  state: 'valid' | 'trial' | 'expired' | 'clock' | 'machine' | 'missing' | 'invalid';
  message: string;
  customer?: string;
  kindLabel?: string;
  startLabel?: string;
  endLabel?: string;
  daysLeft?: number | null;
  machineKey?: string;
  licenseId?: string;
};

const SessionCtx = createContext<Ctx>(null as any);
export const useSession = () => useContext(SessionCtx);

const ACCENTS: Record<string, string> = {
  teal: '#0f766e', emerald: '#059669', blue: '#2563eb', indigo: '#4f46e5',
  violet: '#7c3aed', amber: '#b45309', rose: '#e11d48', slate: '#475569',
};

/** رنگ‌های برجسته‌تر برای تم «برجسته» (روشن‌تر و اشباع‌تر، مخصوص نور شدید) */
const ACCENTS_VIVID: Record<string, string> = {
  teal: '#00807a', emerald: '#00884a', blue: '#1a5cff', indigo: '#4a3af5',
  violet: '#7b2ff2', amber: '#b85800', rose: '#e01a4f', slate: '#31506b',
};

export type ThemeMode = 'light' | 'vivid' | 'dark';

/** تم واقعیِ اعمال‌شده: auto فقط در حافظه به light/vivid/dark تبدیل می‌شود */
export function resolveTheme(mode?: string): ThemeMode {
  if (mode === 'dark') return 'dark';
  if (mode === 'vivid' || mode === 'high-contrast' || mode === 'outdoor') return 'vivid';
  if (mode === 'light') return 'light';
  /* auto / تعریف‌نشده → مطابق سیستم */
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemeToDocument(s: Settings) {
  const root = document.documentElement;
  const theme = resolveTheme(s.theme);
  const dark = theme === 'dark';
  root.dataset.theme = theme;
  root.style.colorScheme = dark ? 'dark' : 'light';

  const palette = theme === 'vivid' ? ACCENTS_VIVID : ACCENTS;
  const accent = palette[s.accent || 'teal'] || palette.teal;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-dark', theme === 'vivid' ? shade(accent, -35) : shade(accent, dark ? 22 : -18));
  root.style.setProperty('--accent-soft', shade(accent, dark ? -70 : 82));
  root.style.setProperty('--row-pad', s.density === 'compact' ? '6px 10px' : '11px 14px');
  root.style.setProperty('--radius', s.corners === 'sharp' ? '6px' : s.corners === 'soft' ? '18px' : '14px');
  root.style.setProperty('--font', s.fontFamily === 'system'
    ? "'Segoe UI', Tahoma, sans-serif"
    : "'Vazirmatn Variable', 'Vazirmatn', 'Segoe UI', Tahoma, sans-serif");
}

function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings>({ calendar: 'jalali', theme: 'light', accent: 'teal' });
  const [ready, setReady] = useState(false);
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api.get<Settings>('/settings');
      setSettings(s);
      applyThemeToDocument(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  const reloadLicense = useCallback(async () => {
    try {
      const st = await api.get<LicenseStatus>('/license/status');
      setLicense(st);
      return st;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      // theme can be restored before login for a smooth start
      const cached = localStorage.getItem('farday.settings');
      if (cached) { try { const s = JSON.parse(cached); setSettings((p) => ({ ...p, ...s })); applyThemeToDocument({ ...settings, ...s }); } catch { /* ignore */ } }
      /*
       * وضعیت لایسنس **قبل از** هر چیز دیگر خوانده می‌شود: اگر قفل باشد،
       * Shell مستقیم صفحه‌ی لایسنس را نشان می‌دهد و کاربر با صفحه‌ی سفید یا
       * خطای «وارد شوید» روبه‌رو نمی‌شود.
       */
      await reloadLicense();
      if (getToken()) {
        try {
          const me = await api.get<{ user: User }>('/auth/me');
          setUser(me.user);
          await loadSettings();
        } catch { setToken(''); }
      }
      setReady(true);
    })();
    /* سه تم روشن/برجسته/تیره — حالت «خودکار» وجود ندارد، پس شنونده‌ی
       prefers-color-scheme هم لازم نیست (کد مرده حذف شد). */
    const onUnauth = () => { setUser(null); setToken(''); };
    window.addEventListener('farday:unauthorized', onUnauth as any);
    /* هر ۴۲۳ از API = وضعیت لایسنس دوباره خوانده شود (قفل/تمدید) */
    const onLicense = (e: any) => {
      if (e?.detail) setLicense(e.detail as LicenseStatus);
      else void reloadLicense();
    };
    window.addEventListener('farday:license-required', onLicense as any);
    return () => {
      window.removeEventListener('farday:unauthorized', onUnauth as any);
      window.removeEventListener('farday:license-required', onLicense as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { username, password });
    setToken(res.token);
    setUser(res.user);
    const s = await loadSettings();
    if (s) localStorage.setItem('farday.settings', JSON.stringify(s));
  }, [loadSettings]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken('');
    setUser(null);
    /*
     * تنظیماتِ کش‌شده پاک می‌شود.
     *
     * باگ حریم خصوصی/سردرگمی: کارمند با تنظیمات مدیر (تم/تقویم/ساعت کاری)
     * وارد می‌شد و صفحه‌ی ورود با همان‌ها نمایش داده می‌شد؛ اگر کارمند بعداً
     * مدیر می‌شد، مقادیر کش‌شده‌ی قدیمی اول نشان داده می‌شدند.
     */
    localStorage.removeItem('farday.settings');
    setSettings({ calendar: 'jalali', theme: 'light', accent: 'teal' });
  }, []);

  /**
   * ذخیره تنظیمات — تم فوراً اعمال می‌شود (بدون انتظار برای سرور) و
   * اگر سرور در دسترس نبود، انتخاب کاربر در حافظه‌ی محلی می‌ماند.
   */
  const saveSettings = useCallback(async (patch: Settings) => {
    /* خوش‌بینانه: تم/تقویم فوراً اعمال شود (بدون انتظار برای سرور) */
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    applyThemeToDocument(optimistic);
    localStorage.setItem('farday.settings', JSON.stringify(optimistic));
    try {
      const next = await api.put<Settings>('/settings', patch);
      /* یک بار اعمال، نه دوبار — دوبار اعمال باعث پرش/سوسو زدن تم می‌شد */
      const merged = { ...optimistic, ...next };
      setSettings(merged);
      applyThemeToDocument(merged);
      localStorage.setItem('farday.settings', JSON.stringify(merged));
    } catch {
      /* آفلاین/خطای سرور: همان انتخاب محلی معتبر می‌ماند */
    }
  }, [settings]);

  const value = useMemo<Ctx>(() => ({
    user, settings, ready,
    calendar: (settings.calendar === 'gregorian' ? 'gregorian' : 'jalali') as CalendarMode,
    isManager: user?.role === 'manager',
    login, logout, reloadSettings: async () => { await loadSettings(); }, saveSettings,
    applyTheme: applyThemeToDocument, license, reloadLicense,
  }), [user, settings, ready, login, logout, loadSettings, saveSettings, license, reloadLicense]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
