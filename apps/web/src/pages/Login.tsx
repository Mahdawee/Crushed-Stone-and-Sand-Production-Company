import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Text, Field } from '../components/ui';

export default function LoginPage() {
  const { login, user } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    if (user) nav('/', { replace: true });
  }, [user, nav]);

  useEffect(() => {
    api.get('/health').then((h) => { setHealth(h); setNeedsSetup(!!h.needsSetup); }).catch(() => setHealth(null));
  }, []);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!username || !password) { toast.warn('نام کاربری و رمز را وارد کنید.'); return; }
    setBusy(true);
    try {
      await login(username.trim(), password);
      nav('/', { replace: true });
    } catch (err: any) {
      toast.error('ورود انجام نشد', err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="card">
          <div className="card-b">
            <div className="login-logo">ف</div>
            <h1 style={{ fontSize: '1.3rem' }}>شرکت تولیدی فردای روشن</h1>
            <p className="small muted" style={{ marginBottom: 20 }}>سیستم مدیریت سنگ، کرش، جغل و ریگ — کاملاً محلی و آفلاین</p>

            <form onSubmit={submit} className="col" style={{ gap: 12 }}>
              <Field label="نام کاربری" required>
                <Text value={username} onChange={setUsername} placeholder="admin" autoFocus />
              </Field>
              <Field label="رمز عبور" required>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </Field>
              <button className="btn primary btn-block" type="submit" disabled={busy} style={{ marginTop: 6, padding: '11px' }}>
                {busy ? 'در حال ورود…' : 'ورود به سیستم'}
              </button>
            </form>

            {needsSetup ? (
              <div className="small" style={{ marginTop: 16, padding: 12, background: 'var(--info-soft)', borderRadius: 10, color: 'var(--info)' }}>
                اولین اجرا: کاربر پیش‌فرض <b>admin</b> با رمز <b>admin123</b> ساخته شده است. بعد از ورود رمز را تغییر دهید.
              </div>
            ) : (
              <div className="small muted" style={{ marginTop: 16, textAlign: 'center' }}>
                کاربر پیش‌فرض: <b>admin</b> — رمز پیش‌فرض: <b>admin123</b>
              </div>
            )}

            <div className="row between" style={{ marginTop: 18, fontSize: '.72rem', color: 'var(--text-3)' }}>
              <span>نسخه {health?.version || '0.1.0'}</span>
              <span className={`badge ${health ? 'ok' : 'bad'}`}>{health ? 'سرویس محلی فعال' : 'سرویس در دسترس نیست'}</span>
            </div>
          </div>
        </div>
        <p className="small muted" style={{ textAlign: 'center', marginTop: 14 }}>
          بدون نیاز به انترنت — معلومات روی همین کمپیوتر ذخیره می‌شود.
        </p>
      </div>
    </div>
  );
}
