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
};

const SessionCtx = createContext<Ctx>(null as any);
export const useSession = () => useContext(SessionCtx);

const ACCENTS: Record<string, string> = {
  teal: '#0f766e', emerald: '#059669', blue: '#2563eb', indigo: '#4f46e5',
  violet: '#7c3aed', amber: '#b45309', rose: '#e11d48', slate: '#475569',
};

export function applyThemeToDocument(s: Settings) {
  const root = document.documentElement;
  const mode = s.theme || 'light';
  const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  const accent = ACCENTS[s.accent || 'teal'] || ACCENTS.teal;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-dark', shade(accent, -18));
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

  useEffect(() => {
    (async () => {
      // theme can be restored before login for a smooth start
      const cached = localStorage.getItem('farday.settings');
      if (cached) { try { const s = JSON.parse(cached); setSettings((p) => ({ ...p, ...s })); applyThemeToDocument({ ...settings, ...s }); } catch { /* ignore */ } }
      if (getToken()) {
        try {
          const me = await api.get<{ user: User }>('/auth/me');
          setUser(me.user);
          await loadSettings();
        } catch { setToken(''); }
      }
      setReady(true);
    })();
    const onUnauth = () => { setUser(null); setToken(''); };
    window.addEventListener('farday:unauthorized', onUnauth as any);
    return () => window.removeEventListener('farday:unauthorized', onUnauth as any);
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
  }, []);

  const saveSettings = useCallback(async (patch: Settings) => {
    const next = await api.put<Settings>('/settings', patch);
    setSettings(next);
    localStorage.setItem('farday.settings', JSON.stringify(next));
    applyThemeToDocument(next);
  }, []);

  const value = useMemo<Ctx>(() => ({
    user, settings, ready,
    calendar: (settings.calendar === 'gregorian' ? 'gregorian' : 'jalali') as CalendarMode,
    isManager: user?.role === 'manager',
    login, logout, reloadSettings: async () => { await loadSettings(); }, saveSettings,
    applyTheme: applyThemeToDocument,
  }), [user, settings, ready, login, logout, loadSettings, saveSettings]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
