import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../lib/session';

/**
 * زنگ اعلان‌های هدر
 *
 * درخواست کاربر (مورد ۸): «در هدر برنامه اعلان‌ها نمایش داده شود؛ هشدار
 * نزدیک شدن به تاریخ پایان لایسنس و هشدار استفاده از دوره آزمایشی».
 *
 * ## چه چیزی اعلان است
 *   • **تمدید فوری** (≤ ۷ روز) — قرمز
 *   • **نزدیک انقضا** (≤ ۳۰ روز) — زرد
 *   • **دوره آزمایشی** — آبی، با تعداد روزهای باقی‌مانده
 *   • **اختلاف ساعت سیستم** — زرد (چون می‌تواند محاسبه‌ی روزهای باقی‌مانده را خراب کند)
 *
 * ## چه چیزی اعلان **نیست**
 * عمداً «حذف شد»، «ثبت شد» و مانند آن اینجا نمی‌آید: آن‌ها کارِ toast هستند.
 * اگر همه‌چیز را در زنگ بریزیم، کاربر زنگ را نادیده می‌گیرد و هشدار لایسنس
 * هم بی‌اثر می‌شود.
 *
 * ## دسترس‌پذیری
 * دکمه `aria-label` گویا دارد و تعداد اعلان‌های نخوانده را می‌گوید؛ باز شدن
 * پنل با Escape بسته می‌شود و کلیک بیرون هم می‌بندد.
 */

type Note = {
  id: string;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  body: string;
  href?: string;
  /** هر چند روز یک‌بار «خوانده» شود — کلید حافظه */
  remindEvery?: number;
};

const SEEN_KEY = 'farday.notes.seen';

function readSeen(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}
function writeSeen(v: Record<string, string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch { /* بی‌اهمیت */ }
}

/** آیا این اعلان در بازه‌ی یادآوری دیده شده است؟ */
function isSnoozed(n: Note, seen: Record<string, string>): boolean {
  if (!n.remindEvery) return false;
  const last = seen[n.id];
  if (!last) return false;
  const days = (Date.now() - new Date(last).getTime()) / 86400000;
  return days < n.remindEvery;
}

/** ساخت اعلان‌ها از وضعیت لایسنس — خالص، تا تست‌پذیر باشد */
export function buildNotes(license: any): Note[] {
  const out: Note[] = [];
  if (!license) return out;

  const days = Number(license.daysLeft ?? license.trialDaysLeft ?? NaN);
  const hasDays = Number.isFinite(days);

  if (license.state === 'clock') {
    out.push({
      id: 'clock',
      tone: 'warn',
      title: 'ساعت سیستم درست نیست',
      body: license.message || 'ساعت ویندوز عقب یا جلو است؛ روزهای باقی‌مانده‌ی لایسنس درست حساب نمی‌شود.',
      href: '/license',
      remindEvery: 1,
    });
  }

  if (license.state === 'trial') {
    out.push({
      id: `trial-${hasDays ? Math.ceil(days) : 'x'}`,
      tone: 'info',
      title: 'دوره آزمایشی فعال است',
      body: hasDays
        ? `${days.toLocaleString('fa-IR')} روز از دوره آزمایشی باقی مانده. برای ادامه‌ی کار، لایسنس را فعال کنید.`
        : 'شما در حال استفاده از دوره آزمایشی هستید.',
      href: '/license',
      remindEvery: 1,
    });
  } else if (hasDays) {
    if (days <= 7) {
      out.push({
        id: `lic-urgent-${days}`,
        tone: 'bad',
        title: 'لایسنس تا چند روز دیگر تمام می‌شود',
        /*
         * ── باگ (شکار باگ دور ۳۴): «فقط ۰ روز باقی مانده» ────────────────────
         * صفر یعنی امروز آخرین روز لایسنس است (نه اینکه تمام شده و نه
         * «۱- روز»). متن روشن می‌شود.
         */
        body: days > 0
          ? `فقط ${days.toLocaleString('fa-IR')} روز باقی مانده. تمدید را امروز انجام دهید تا کار متوقف نشود.`
          : 'امروز آخرین روز اعتبار لایسنس است. برای ادامه‌ی کار، امروز تمدید کنید.',
        href: '/license',
        remindEvery: 1,
      });
    } else if (days <= 30) {
      out.push({
        id: `lic-warn-${Math.ceil(days / 7)}`,
        tone: 'warn',
        title: 'لایسنس رو به پایان است',
        body: `${days.toLocaleString('fa-IR')} روز باقی مانده. برای تمدید، از صفحه‌ی لایسنس درخواست بسازید.`,
        href: '/license',
        remindEvery: 3,
      });
    }
  }

  if (!license.ok && license.message) {
    out.push({
      id: `lic-${license.state}`,
      tone: 'bad',
      title: 'لایسنس معتبر نیست',
      body: license.message,
      href: '/license',
    });
  }

  return out;
}

export default function Notifications() {
  const { license } = useSession();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Record<string, string>>(readSeen);
  const boxRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => buildNotes(license), [license]);
  const visible = useMemo(() => all.filter((n) => !isSnoozed(n, seen)), [all, seen]);
  const urgent = visible.filter((n) => n.tone === 'bad').length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dismiss = (n: Note) => {
    const next = { ...seen, [n.id]: new Date().toISOString() };
    setSeen(next); writeSeen(next);
  };

  /* هیچ اعلانی نیست → دکمه‌ی زنگ هم لازم نیست (شلوغی بی‌فایده) */
  if (all.length === 0) return null;

  return (
    <div className="notif-wrap" ref={boxRef}>
      <button
        type="button"
        className={`btn ghost icon notif-btn${visible.length ? ' has' : ''}${urgent ? ' urgent' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={visible.length ? `${visible.length} اعلان` : 'اعلانی نیست'}
        aria-label={visible.length ? `${visible.length} اعلان، ${urgent} مورد فوری` : 'اعلانی نیست'}
      >
        <span className="notif-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {visible.length ? (
            <span className="notif-dot" aria-hidden="true">{visible.length > 9 ? '۹+' : visible.length.toLocaleString('fa-IR')}</span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="notif-panel" role="dialog" aria-label="اعلان‌ها">
          <div className="notif-head">
            <b>اعلان‌ها</b>
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)} aria-label="بستن">✕</button>
          </div>
          {visible.length === 0 ? (
            <div className="notif-empty">اعلان جدیدی نیست.</div>
          ) : (
            <ul className="notif-list">
              {visible.map((n) => (
                <li key={n.id} className={`notif-item tone-${n.tone}`}>
                  <span className="notif-item-dot" aria-hidden="true" />
                  <div className="notif-item-b">
                    <b>{n.title}</b>
                    <p>{n.body}</p>
                    <div className="notif-item-a">
                      {n.href ? <a className="btn sm" href={`#${n.href}`} onClick={() => { setOpen(false); dismiss(n); }}>مشاهده</a> : null}
                      {n.remindEvery ? (
                        <button type="button" className="btn ghost sm" onClick={() => dismiss(n)}>بعداً</button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
