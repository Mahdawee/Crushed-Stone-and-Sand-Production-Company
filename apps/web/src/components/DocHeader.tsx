import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Company letterhead used on every printed document. */
export function DocHeader({ title, meta }: { title: string; meta?: { label: string; value: string }[] }) {
  const [c, setC] = useState<any>(null);
  useEffect(() => { api.get('/company').then(setC).catch(() => {}); }, []);
  return (
    <div className="doc-head">
      <div className="doc-head-main">
        <div className="doc-logo">ف</div>
        <div>
          <div className="doc-name">{c?.name || 'فردای روشن'}</div>
          <div className="doc-sub">{c?.activityType || 'تولید مواد ساختمانی'} — {c?.address || ''}</div>
          {c?.phone ? <div className="doc-sub">تماس: {c.phone}</div> : null}
        </div>
        <div style={{ flex: 1 }} />
        <div className="doc-title">{title}</div>
      </div>
      {meta?.length ? (
        <div className="doc-meta">
          {meta.map((m) => (
            <div key={m.label}><span>{m.label}:</span> <b>{m.value}</b></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DocFooter({ extra }: { extra?: string }) {
  return (
    <div className="doc-footer">
      <div className="sign"><span>امضای مدیر مالی</span><i /></div>
      <div className="sign"><span>امضای سرپرست</span><i /></div>
      <div className="sign"><span>امضای گیرنده / مشتری</span><i /></div>
      {extra ? <div className="doc-note">{extra}</div> : null}
    </div>
  );
}

/**
 * سرصفحه‌ی چاپ برای **راپورها** (نه اسناد رسمی).
 *
 * درخواست کاربر (مورد ۶): «فرآیندهای چاپ را بازبینی کن: فقط جدول‌ها چاپ شوند
 * یا عنوان هم بگذاریم؟ چاپ کل صفحه آیا حرفه‌ای است یا باید تغییر کند؟»
 *
 * ## تصمیم — و چرا
 * چاپ «کل صفحه» (سایدبار، فیلترها، دکمه‌ها، نوار بالا) **غیرحرفه‌ای** است:
 * مشتری نهایی فایده‌ای از آن نمی‌برد و کاغذ/مرکب هدر می‌رود. چاپ «فقط جدول»
 * هم ایراد دارد: برگه‌ی بی‌نام و بی‌تاریخ در پرونده بی‌اعتبار است.
 *
 * پس طراحی این است:
 *   • چاپ ← فقط **عنوان + سرصفحه‌ی شرکت + بازه‌ی گزارش + جدول + جمع + تاریخ چاپ**
 *   • فیلترها/دکمه‌ها/سایدبار/کارت‌های آمار رنگارنگ ← `no-print`
 *   • امضای دستی برای صورت‌حساب و سند رسمی؛ برای راپور مدیریتی فقط
 *     «تهیه‌کننده / مدیر مالی» به‌صورت یک خط، نه سه کادر خالی
 *
 * این کامپوننت روی صفحه نامرئی است (`print-only`) و فقط در چاپ ظاهر می‌شود،
 * تا کاربر همان چیزی را در کاغذ ببیند که انتظار دارد و در صفحه چیدمان
 * به‌هم نریزد.
 */
export function PrintReportHeader({ title, subtitle, period, note }: {
  title: string;
  subtitle?: string;
  period?: string;
  note?: string;
}) {
  const [c, setC] = useState<any>(null);
  useEffect(() => { api.get('/company').then(setC).catch(() => {}); }, []);
  return (
    <div className="print-only print-report-head">
      <div className="prh-row">
        <div className="prh-brand">
          <div className="prh-logo">ف</div>
          <div>
            <div className="prh-name">{c?.name || 'فردای روشن'}</div>
            <div className="prh-sub">
              {c?.activityType || 'تولید مواد ساختمانی'}
              {c?.address ? ` — ${c.address}` : ''}
            </div>
            {c?.phone ? <div className="prh-sub">تماس: {c.phone}</div> : null}
          </div>
        </div>
        <div className="prh-title-box">
          <div className="prh-title">{title}</div>
          {period ? <div className="prh-period">{period}</div> : null}
        </div>
      </div>
      {subtitle ? <div className="prh-subtitle">{subtitle}</div> : null}
      {note ? <div className="prh-note">{note}</div> : null}
      <div className="prh-rule" />
    </div>
  );
}

/** پانوشت چاپ: زمان چاپ + تهیه‌کننده + امضای مدیر مالی */
export function PrintReportFooter({ by, summary }: { by?: string; summary?: string }) {
  return (
    <div className="print-only print-report-foot">
      <div className="prf-line">
        {summary ? <b>{summary}</b> : null}
      </div>
      <div className="prf-row">
        <span>تهیه‌کننده: {by || '—'}</span>
        <span>تاریخ چاپ: {new Date().toLocaleDateString('fa-IR-u-ca-persian')}</span>
        <span>امضای مدیر مالی: .................................</span>
      </div>
    </div>
  );
}
