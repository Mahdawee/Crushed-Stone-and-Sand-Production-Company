/** جایگزین lib/session فقط برای تست DOM (بدون شبکه) */
import React from 'react';
export const useSession = () => ({
  user: { id: 1, username: 'admin', fullName: 'مدیر سیستم', role: 'manager' as const },
  settings: { theme: 'light', calendar: 'jalali' },
  calendar: 'jalali' as const,
  isManager: true,
  ready: true,
  login: async () => {},
  logout: async () => {},
  reloadSettings: async () => {},
  saveSettings: async () => {},
  applyTheme: () => {},
});
export const applyThemeToDocument = () => {};
export const SessionProvider = ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children);
