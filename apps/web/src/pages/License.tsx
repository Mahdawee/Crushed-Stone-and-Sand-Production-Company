import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useToast, Field, Spinner, InlineStat } from '../components/ui';
import { IconLock, IconCheck, IconAlert } from '../components/icons';

/**
 * صفحه‌ی لایسنس — «قفل نصب تازه».
 *
 * سه چیز را نشان می‌دهد و همین کافی است:
 *   ۱) وضعیت (آزمایشی / معتبر / منقضی / قفل دستگاه / قفل ساعت) با تاریخ شمسی
 *   ۲) کلید دستگاه با دکمه‌ی کاپی — تا مشتری برای پشتیبانی بفرستد
 *   ۳) کادر متن لایسنس — همان متنی که با ابزار لایسنس صادر شده
 *
 * چرا در صفحه‌ی جدا و بدون نیاز به ورود: اگر نصب تازه قفل باشد، کاربر نباید
 * برای دیدن راه حل اول مجبور باشد رمز مدیر را وارد کند.
 */
export default function LicensePage() {
  const toast = useToast();
  const nav = useNavigate();
  const [st, setSt] = useState<any>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [allowReset, setAllowReset] = useState(false);

  const load = useCallback(async () => {
    try {
      setSt(await api.get('/license/status'));
    } catch (e: any) {
      setError(e.message || 'وضعیت لایسنس خوانده نشد.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(st?.machineKey || '');
      toast.success('کلید دستگاه کاپی شد', 'این کلید را برای پشتیبانی بفرستید.');
    } catch {
      toast.warn('کاپی نشد', 'کلید را دستی انتخاب و کاپی کنید.');
    }
  };

  const activate = async () => {
    if (!text.trim()) { toast.warn('متن لایسنس را وارد کنید.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post('/license/activate', { text, allowClockReset: allowReset });
      toast.success('لایسنس فعال شد', 'حالا می‌توانید وارد سیستم شوید.');
      setText('');
      const next = await api.get('/license/status');
      setSt(next);
      if (next?.ok) setTimeout(() => nav('/login', { replace: true }), 700);
    } catch (e: any) {
      setError(e.message || 'فعال‌سازی انجام نشد.');
      if (e instanceof ApiError) void e.needsLicense;
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!st) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="card"><div className="card-b"><Spinner label="خواندن وضعیت لایسنس…" /></div></div>
        </div>
      </div>
    );
  }

  const tone = st.ok ? 'ok' : st.state === 'trial' ? 'warn' : 'bad';
  const badgeText: Record<string, string> = {
    valid: 'لایسنس معتبر',
    trial: 'دوره‌ی آزمایشی',
    expired: 'منقضی شده',
    clock: 'قفل ساعت',
    machine: 'قفل دستگاه',
    invalid: 'لایسنس نامعتبر',
    missing: 'بدون لایسنس',
  };

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 640 }}>
        <div className="card">
          <div className="card-b">
            <div className="row between" style={{ alignItems: 'center', marginBottom: 4 }}>
              <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                <div className="login-logo"><IconLock size={18} /></div>
                <div>
                  <h1 style={{ fontSize: '1.1rem', margin: 0 }}>لایسنس فردای روشن</h1>
                  <p className="small muted" style={{ margin: 0 }}>امضای دیجیتال Ed25519 · قفل دستگاه · قفل ساعت</p>
                </div>
              </div>
              <span className={`badge ${tone}`}>{badgeText[st.state] || st.state}</span>
            </div>

            <div className="small" style={{ margin: '14px 0', padding: 12, borderRadius: 10, background: 'var(--surface-2)' }}>
              {st.message}
            </div>

            {st.state === 'clock' ? (
              <div className="small" style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                ساعت ویندوز با آخرین اجرای برنامه بیش از {st.toleranceHours || 24} ساعت فاصله دارد.
                اگر ساعت واقعاً عوض شده (مثلاً باتری مادربرد)، ساعت را درست کنید، تیک زیر را بزنید و همان لایسنس را دوباره وارد کنید.
                <label className="row" style={{ gap: 8, marginTop: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={allowReset} onChange={(e) => setAllowReset(e.target.checked)} />
                  <span>ساعت را درست کرده‌ام — مرجع زمان هم‌تراز شود</span>
                </label>
              </div>
            ) : null}

            {/* وضعیت جزئیات */}
            {st.state !== 'trial' && st.state !== 'missing' ? (
              <div className="grid c2" style={{ marginBottom: 14 }}>
                <InlineStat label="مشتری" value={st.customer || '—'} />
                <InlineStat label="نوع" value={st.kindLabel || '—'} />
                <InlineStat label="شروع" value={st.startLabel || '—'} />
                <InlineStat
                  label="پایان"
                  value={st.endLabel || '—'}
                  tone={st.daysLeft === null || st.daysLeft === undefined ? undefined : st.daysLeft < 0 ? 'bad' : st.daysLeft <= 14 ? 'warn' : 'ok'}
                />
                {st.daysLeft !== null && st.daysLeft !== undefined ? (
                  <InlineStat label="روزهای باقي‌مانده" value={`${st.daysLeft} روز`} tone={st.daysLeft < 0 ? 'bad' : st.daysLeft <= 14 ? 'warn' : 'ok'} />
                ) : (
                  <InlineStat label="محدودیت زمانی" value="ندارد (ابد)" tone="ok" />
                )}
                <InlineStat label="صندلی (کاربر هم‌زمان)" value={st.seats ? String(st.seats) : 'بی‌نهایت'} />
                {st.licenseId ? <InlineStat label="شناسه‌ی لایسنس" value={st.licenseId} /> : null}
              </div>
            ) : null}

            {st.state === 'trial' ? (
              <div className="grid c2" style={{ marginBottom: 14 }}>
                <InlineStat label="پایان دوره‌ی آزمایشی" value={st.endLabel || '—'} />
                <InlineStat label="روزهای باقیمانده" value={`${st.trialDaysLeft ?? 0} روز`} tone={(st.trialDaysLeft ?? 0) <= 2 ? 'warn' : 'ok'} />
              </div>
            ) : null}

            {/* سنجهٔ زمان — تاریخ امروز به شمسی */}
            <div className="row between" style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', fontSize: '.78rem' }}>
              <span>سنجهٔ زمان</span>
              <span>
                <b>{st.nowLabel || '—'}</b>
                <span className="muted"> · تلورانس {st.toleranceHours || 24} ساعت</span>
              </span>
            </div>

            {/* کلید دستگاه */}
            <Field label="کلید دستگاه (این کمپیوتر)">
              <div className="row" style={{ gap: 8 }}>
                <input className="input" dir="ltr" readOnly value={st.machineKey || ''} style={{ fontFamily: 'monospace', letterSpacing: 1 }} />
                <button className="btn" type="button" onClick={copyKey}>کاپی</button>
              </div>
            </Field>
            <p className="small muted" style={{ marginTop: -4 }}>
              برای گرفتن لایسنس، این کلید را برای پشتیبانی بفرستید. هیچ اطلاعات دیگری از کمپیوتر شما لازم نیست.
            </p>

            {/* ورودی لایسنس */}
            <Field label="متن لایسنس">
              <textarea
                className="input" rows={5} dir="ltr" value={text} onChange={(e) => setText(e.target.value)}
                placeholder={'-----BEGIN FARDAY LICENSE-----\nFR-1\n…\n-----END FARDAY LICENSE-----'}
                style={{ fontFamily: 'monospace', fontSize: '.72rem' }}
              />
            </Field>

            {error ? (
              <div className="small" style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                <IconAlert size={14} /> {error}
              </div>
            ) : null}

            <button className="btn primary btn-block" disabled={busy} onClick={activate} style={{ padding: '11px', marginTop: 4 }}>
              {busy ? 'در حال بررسی…' : 'فعال‌سازی لایسنس'}
            </button>

            {st.ok && st.state !== 'trial' ? (
              <p className="small" style={{ textAlign: 'center', marginTop: 10, color: 'var(--ok)' }}>
                <IconCheck size={13} /> لایسنس فعال است
              </p>
            ) : null}

            <div className="row between" style={{ marginTop: 16, fontSize: '.72rem', color: 'var(--text-3)' }}>
              <span>{st.platform}</span>
              <div className="row" style={{ gap: 10 }}>
                {st.ok ? <Link to="/login">ورود به سیستم</Link> : null}
                <Link to="/help">راهنما</Link>
              </div>
            </div>
          </div>
        </div>
        <p className="small muted" style={{ textAlign: 'center', marginTop: 12 }}>
          سرور لایسنس لازم نیست — تأیید امضا روی همین کمپیوتر و بدون انترنت انجام می‌شود.
        </p>
      </div>
    </div>
  );
}
