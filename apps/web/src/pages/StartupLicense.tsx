import React, { useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/ui';

/**
 * صفحه‌ی شروعِ لایسنس
 *
 * درخواست کاربر (مورد ۸): «صفحه لایسنس باید در شروع برنامه ظاهر شود و در
 * هدر برنامه اعلان‌ها نمایش داده شود: هشدار نزدیک شدن به تاریخ پایان لایسنس
 * و هشدار استفاده از دوره آزمایشی».
 *
 * ## چرا این صفحه، و نه یک «قفل»
 * کاربر با لایسنس سالم هم باید بداند چقدر وقت دارد. این صفحه در هر اجرای
 * برنامه یک بار می‌آید، خلاصه‌ی وضعیت را می‌گوید و با یک دکمه می‌رود کنار
 * (نه اینکه جلوی کار را بگیرد — برنامه‌ی کاری باید باز شود).
 *
 * سه حالت:
 *   • **فعال و دور از انقضا** → پیام آرام، دکمه‌ی «ورود به برنامه»
 *   • **نزدیک انقضا (≤ ۳۰ روز)** → هشدار زرد + راهنمای تمدید
 *   • **دوره آزمایشی** → هشدار آبی + شمارش روزها
 */
export const BOOT_LICENSE_KEY = 'farday.boot.licenseAck';

/** آستانه‌های هشدار — یک جا، تا صفحه و هدر یک چیز بگویند */
export const RENEW_WARN_DAYS = 30;
export const RENEW_URGENT_DAYS = 7;

export default function StartupLicense({ license, onContinue, onOpenLicense }: {
  license: any;
  onContinue: () => void;
  /** باز کردن صفحه‌ی لایسنس — با مسیر برگشت ثبت‌شده */
  onOpenLicense?: () => void;
}) {
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);

  const goRef = React.useRef<() => void>(() => {});
  goRef.current = () => {
    setLeaving(true);
    setTimeout(onContinue, 140);
  };

  /*
   * Escape = «ادامه به برنامه».
   *
   * چرا لازم است: کاربری که صفحه‌ی شروع را نمی‌خواهد نباید مجبور به پیدا
   * کردن ماوس باشد. این هم همان باگ «گیر کردن در صفحه‌ی لایسنس» را از یک
   * راه دیگر می‌بندد.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); goRef.current(); }
      if (e.key === 'Enter') { e.preventDefault(); goRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const info = useMemo(() => {
    const isTrial = license?.state === 'trial';
    const days = Number(license?.daysLeft ?? license?.trialDaysLeft ?? NaN);
    const hasDays = Number.isFinite(days);
    const urgent = hasDays && days <= RENEW_URGENT_DAYS;
    const warn = hasDays && days <= RENEW_WARN_DAYS;
    return { isTrial, days, hasDays, urgent, warn };
  }, [license]);

  const tone = info.isTrial ? 'trial' : info.urgent ? 'urgent' : info.warn ? 'warn' : 'ok';

  const go = () => {
    setLeaving(true);
    /* یک «نفس» کوتاه تا انیمیشن تمام شود، بعد ادامه */
    setTimeout(onContinue, 140);
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(license.machineKey || '');
      toast.info('کاپی شد', 'کلید دستگاه برای پشتیبانی.');
    } catch { toast.error('کاپی نشد', 'دستی از صفحه‌ی لایسنس بردارید.'); }
  };

  return (
    <div className={`boot-lic tone-${tone}${leaving ? ' leaving' : ''}`}>
      <div className="boot-lic-card">
        <div className="boot-lic-top">
          <div className="boot-lic-logo" aria-hidden="true">ف</div>
          <div>
            <h1>فردای روشن</h1>
            <p className="small muted">سیستم مدیریت تولید سنگ و معدن</p>
          </div>
        </div>

        <div className={`boot-lic-state tone-${tone}`}>
          <div className="boot-lic-state-h">
            <span className="badge">{info.isTrial ? 'دوره آزمایشی' : 'لایسنس فعال'}</span>
            {info.hasDays ? (
              <b>{info.days > 0 ? `${info.days.toLocaleString('fa-IR')} روز باقی مانده` : 'امروز آخرین روز'}</b>
            ) : (
              <b>بدون محدودیت زمانی</b>
            )}
          </div>
          <p>
            {info.isTrial
              ? 'شما در حال استفاده از دوره آزمایشی هستید. برای ادامه‌ی کار بدون وقفه، لایسنس رسمی را فعال کنید.'
              : info.urgent
                ? 'لایسنس شما به‌زودی تمام می‌شود. برای اینکه کار روزانه متوقف نشود، همین حالا تمدید کنید.'
                : info.warn
                  ? 'لایسنس شما رو به پایان است. تمدید را در فرصت مناسب انجام دهید.'
                  : 'لایسنس شما معتبر است.'}
          </p>
          <div className="boot-lic-dates">
            <span>شروع: <b>{license.startLabel || '—'}</b></span>
            <span>پایان: <b>{license.endLabel || '—'}</b></span>
          </div>
        </div>

        <div className="boot-lic-key">
          <span>کلید این دستگاه</span>
          <code dir="ltr">{license.machineKey}</code>
          <button className="btn sm" onClick={copyKey}>کاپی</button>
        </div>

        <div className="boot-lic-actions">
          <button className="btn primary lg" onClick={go}>ورود به برنامه</button>
          {(info.warn || info.isTrial) ? (
            <button className="btn" onClick={() => { sessionStorage.setItem(BOOT_LICENSE_KEY, '1'); onOpenLicense?.(); }}>
              تمدید / فعال‌سازی
            </button>
          ) : (
            <button className="btn" onClick={() => { sessionStorage.setItem(BOOT_LICENSE_KEY, '1'); onOpenLicense?.(); }}>
              جزئیات لایسنس
            </button>
          )}
        </div>

        <p className="boot-lic-foot muted" style={{ textAlign: 'center' }}>
          برای ادامه، <b>Enter</b> یا <b>Esc</b> هم کار می‌کند.
        </p>

        {info.warn || info.isTrial ? (
          <p className="boot-lic-foot">
            تمدید به اینترنت نیاز ندارد. در صفحه‌ی لایسنس، یک «درخواست تمدید» بسازید و برای پشتیبانی بفرستید.
          </p>
        ) : null}
      </div>
    </div>
  );
}
