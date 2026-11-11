import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { buildNotes } from './Notifications';

/**
 * هشدار لایسنس — «آلارم» تمام‌صفحه‌ی حرفه‌ای برای نزدیک شدن پایان لایسنس و
 * استفاده از دوره‌ی آزمایشی.
 *
 * درخواست کاربر: «نزدیک شدن ختم تاریخ لایسنس یا استفاده از لایسنس آزمایشی
 * باید در چیزی شبیه alert در برنامه نشان داده شود، آن‌گونه که حرفه‌ای است.»
 *
 * ## چرا زنگ اعلان‌ها کافی نبود
 * زنگ هدر (`Notifications`) در گوشه‌ی بالا یک نشانگر کوچک است؛ کاربری که
 * روزانه کار می‌کند آن را نمی‌بیند و روزِ انقضا یک‌باره با «برنامه باز
 * نمی‌شود» روبه‌رو می‌شود. این کامپوننت همان هشدار را **در لحظه‌ی ورود** و
 * با لحن جدی نشان می‌دهد.
 *
 * ## چه زمانی نشان داده می‌شود (سه سطح)
 *   • **قرمز (بحرانی)** ≤ ۷ روز یا لایسنس نامعتبر — یک بار در هر روز
 *   • **زرد (هشدار)** ≤ ۳۰ روز — یک بار در هر ۳ روز
 *   • **آبی (آزمایشی)** — یک بار در هر روز تا وقتی لایسنس رسمی فعال شود
 *
 * ## چرا روزی یک‌بار و چرا قابل بستن
 * اگر هر بار که صفحه عوض می‌شود ظاهر شود، کاربر مثل تبلیغات نادیده‌اش
 * می‌گیرد و هشدار واقعی هم بی‌اثر می‌شود. یک «بعداً» شفاف (با تاریخِ
 * یادآوری بعدی) هم هست تا کاربر بداند چه وقتی دوباره می‌بیندش.
 *
 * ## دسترس‌پذیری (چون alert واقعی است)
 *   • `role="alertdialog"` + `aria-modal` + `aria-labelledby`
 *   • Escape ببند (اگر قابل بستن باشد)، فوکوس روی دکمه‌ی اصلی
 *   • دکمه‌ی «بعداً» می‌گوید تا کی به تعویق افتاد
 */
const SNOOZE_KEY = 'farday.license.alert.snoozed';

type Snooze = Record<string, string>;

function readSnooze(): Snooze {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}'); } catch { return {}; }
}
function writeSnooze(v: Snooze) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(v)); } catch { /* بی‌اهمیت */ }
}

/** چند روز تا یادآوری بعدی — از سطح هشدار می‌آید */
const REMIND_DAYS = { bad: 1, warn: 3, info: 1 } as const;

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

export type LicenseAlertModel = {
  show: boolean;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  body: string;
  daysLeft: number | null;
  isTrial: boolean;
  /** کلید حافظه — با تغییر عدد روز عوض می‌شود */
  key: string;
  remindDays: number;
};

/**
 * ساخت مدل هشدار از وضعیت لایسنس — **خالص**، تا تست‌پذیر باشد.
 * خروجی `null` یعنی «هیچ هشداری لازم نیست» (لایسنس سالم و دور از پایان).
 */
export function buildLicenseAlert(license: any): LicenseAlertModel | null {
  if (!license) return null;
  const st = String(license.state || '');
  const days = Number(license.daysLeft ?? license.trialDaysLeft ?? NaN);
  const has = Number.isFinite(days);

  /* لایسنس نامعتبر (منقضی/دستگاه دیگر/ساعت) — جدی‌ترین حالت */
  if (st === 'expired') {
    return {
      show: true, tone: 'bad', key: 'expired',
      title: 'لایسنس تمام شده است',
      body: license.message || 'دوره‌ی لایسنس به پایان رسیده. تا تمدید نشود، ثبت اسناد جدید ممکن نیست.',
      daysLeft: 0, isTrial: false, remindDays: REMIND_DAYS.bad,
    };
  }
  if (st === 'machine' || st === 'clock' || st === 'invalid') {
    return {
      show: true, tone: 'bad', key: `state-${st}`,
      title: st === 'machine' ? 'این لایسنس برای دستگاه دیگری است'
        : st === 'clock' ? 'ساعت سیستم درست نیست'
        : 'لایسنس معتبر نیست',
      body: license.message || 'برای ادامه، لایسنس درست را وارد کنید یا با پشتیبانی تماس بگیرید.',
      daysLeft: has ? days : null, isTrial: false, remindDays: REMIND_DAYS.bad,
    };
  }

  /* دوره‌ی آزمایشی */
  if (st === 'trial') {
    return {
      show: true, tone: 'info', key: `trial-${has ? Math.ceil(days) : 'x'}`,
      title: 'دوره‌ی آزمایشی فعال است',
      body: has
        ? `${days.toLocaleString('fa-IR')} روز از دوره‌ی آزمایشی باقی مانده است. بعد از آن برای ثبت اسناد جدید باید لایسنس رسمی فعال شود.`
        : 'شما در حال استفاده از دوره‌ی آزمایشی هستید. برای ادامه‌ی کار، لایسنس رسمی را فعال کنید.',
      daysLeft: has ? days : null, isTrial: true, remindDays: REMIND_DAYS.info,
    };
  }

  /* لایسنس معتبر ولی رو به پایان */
  if (has && days >= 0) {
    if (days <= 7) {
      return {
        show: true, tone: 'bad', key: `urgent-${Math.ceil(days)}`,
        title: days <= 1 ? 'امروز یا فردا آخرین روز لایسنس است' : `فقط ${days.toLocaleString('fa-IR')} روز تا پایان لایسنس`,
        body: 'برای اینکه ثبت فروشات و رسیدات متوقف نشود، همین امروز تمدید کنید. درخواست تمدید از صفحه‌ی «لایسنس» در چند ثانیه ساخته می‌شود.',
        daysLeft: days, isTrial: false, remindDays: REMIND_DAYS.bad,
      };
    }
    if (days <= 30) {
      return {
        show: true, tone: 'warn', key: `warn-${Math.ceil(days / 7)}`,
        title: 'لایسنس رو به پایان است',
        body: `${days.toLocaleString('fa-IR')} روز باقی مانده. تمدید را در فرصت مناسب انجام دهید تا کار روزانه متوقف نشود.`,
        daysLeft: days, isTrial: false, remindDays: REMIND_DAYS.warn,
      };
    }
  }

  return null;
}

/** آیا این هشدار در بازه‌ی «بعداً» است؟ */
export function isSnoozed(model: LicenseAlertModel | null, snooze: Snooze): boolean {
  if (!model) return true;
  const last = snooze[model.key];
  if (!last) return false;
  return daysSince(last) < model.remindDays;
}

const TONE_LABEL = { bad: 'فوری', warn: 'هشدار', info: 'اطلاع' } as const;

type Props = {
  /**
   * بستن دستی (از بیرون). عمداً این‌جا هم «بعداً» ثبت می‌شود تا هشدار
   * بلافاصله برنگردد و کاربر حس «گیر افتادن» نداشته باشد.
   */
  onClose?: () => void;
  /**
   * بازگشایی اجباری — وقتی کاربر خودش روی نشانگر نوار بالا کلیک می‌کند.
   * در این حالت «بعداً»ی قبلی نادیده گرفته می‌شود (خودش خواسته ببیند).
   */
  forceOpen?: boolean;
};

export default function LicenseAlert({ onClose, forceOpen = false }: Props = {}) {
  const { license } = useSession();
  const [snooze, setSnooze] = useState<Snooze>(readSnooze);
  const primaryRef = useRef<HTMLAnchorElement>(null);

  const model = useMemo(() => buildLicenseAlert(license), [license]);
  const visible = Boolean(model && model.show && (forceOpen || !isSnoozed(model, snooze)));

  /* Escape = «بعداً» (کاربر نباید گیر کند؛ هشدار اجباری نیست، فقط جدی است) */
  useEffect(() => {
    if (!visible || !model) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const next = { ...snooze, [model.key]: new Date().toISOString() };
        setSnooze(next); writeSnooze(next);
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    /* فوکوس روی اقدام اصلی — با صفحه‌خوان هم خوانده می‌شود */
    const t = window.setTimeout(() => primaryRef.current?.focus(), 60);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(t); };
  }, [visible, model, snooze]);

  if (!visible || !model) return null;

  const later = () => {
    const next = { ...snooze, [model.key]: new Date().toISOString() };
    setSnooze(next); writeSnooze(next);
    onClose?.();
  };

  return (
    <div className="lic-alert-back" role="presentation">
      <div
        className={`lic-alert tone-${model.tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lic-alert-title"
        aria-describedby="lic-alert-body"
      >
        <div className="lic-alert-head">
          <span className="lic-alert-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4" /><path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          </span>
          <div className="lic-alert-t">
            <span className={`badge tone-${model.tone}`}>{TONE_LABEL[model.tone]}</span>
            <h2 id="lic-alert-title">{model.title}</h2>
          </div>
          <button type="button" className="btn ghost sm" onClick={later} aria-label="بستن هشدار">✕</button>
        </div>

        <p id="lic-alert-body" className="lic-alert-body">{model.body}</p>

        <div className="lic-alert-meta">
          {model.daysLeft !== null ? (
            <span>روزهای باقی‌مانده: <b>{Math.max(0, model.daysLeft).toLocaleString('fa-IR')}</b></span>
          ) : null}
          {license?.endLabel ? <span>تاریخ پایان: <b>{license.endLabel}</b></span> : null}
          {model.isTrial ? <span className="muted">دوره‌ی آزمایشی — لایسنس رسمی فعال نشده است</span> : null}
        </div>

        <div className="lic-alert-actions">
          <Link ref={primaryRef} to="/license" className="btn primary" onClick={later}>
            {model.isTrial ? 'فعال‌سازی لایسنس' : 'تمدید لایسنس'}
          </Link>
          <button type="button" className="btn" onClick={later}>بعداً</button>
          <span className="small muted">
            یادآوری بعدی: {model.remindDays === 1 ? 'فردا' : `${model.remindDays.toLocaleString('fa-IR')} روز دیگر`}
          </span>
        </div>

        <p className="lic-alert-foot small muted">
          {buildNotes(license).length
            ? 'این هشدار در زنگ اعلان‌های بالای صفحه هم هست.'
            : 'جزئیات همیشه در صفحه‌ی «لایسنس» موجود است.'}
        </p>
      </div>
    </div>
  );
}

/**
 * متن نشانگر دائمی نوار بالا.
 *
 * چرا لازم است: بعد از «بعداً» هشدار بسته می‌شود؛ بدون یک نشانگر کوچک،
 * کاربر تا روز انقضا دوباره چیزی نمی‌بیند. این نشانگر همیشه هست (کلیک =
 * باز شدن همان هشدار).
 */
export function licenseStrip(license: any): { tone: 'bad' | 'warn' | 'info'; text: string; title: string } | null {
  const m = buildLicenseAlert(license);
  if (!m) return null;
  const d = m.daysLeft;
  const text = m.tone === 'info'
    ? (d !== null ? `آزمایشی · ${Math.max(0, d).toLocaleString('fa-IR')} روز` : 'دوره آزمایشی')
    : m.tone === 'bad'
      ? (d !== null ? `لایسنس · ${Math.max(0, d).toLocaleString('fa-IR')} روز` : 'لایسنس نامعتبر')
      : (d !== null ? `لایسنس · ${Math.max(0, d).toLocaleString('fa-IR')} روز` : 'لایسنس');
  return { tone: m.tone, text, title: `${m.title} — برای جزئیات کلیک کنید` };
}
