import { IconChevron, IconPrint } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { DocHeader, DocFooter } from '../components/DocHeader';
import { money, formatDate } from '../lib/calendar';
import '../styles/print.css';

/**
 * چاپ رسید و مصرف — پیشنهاد C4، دور ۴۰.
 *
 * ── چرا این صفحه ─────────────────────────────────────────────────────────
 * بل فروش و معاش از قبل دکمه‌ی چاپ داشتند، ولی رسید و مصرف نه. یعنی برای
 * دادن «رسید دریافت پول» به مشتری، کاربر باید دستی می‌نوشت — و همین جایی
 * است که عددها با سیستم نمی‌خوانند. مشتری رسید کاغذی می‌خواهد، نه اسکرین‌شات.
 *
 * ── تصمیم‌های دقیق (همه از باگ‌های واقعی `PrintSale` گرفته شده) ─────────
 *   • چاپ خودکار **فقط** با `?auto=1`؛ باز کردن/رفرش سند نباید ناگهان
 *     پنجره‌ی چاپ باز کند.
 *   • خطا با پیام روشن و دکمه‌ی بازگشت — نه «در حال آماده‌سازی…» ابدی.
 *   • `alive` در cleanup تا پاسخ دیررس روی صفحه‌ی رفته ننشیند.
 *   • یک صفحه برای دو نوع سند: هر چه دوبار نوشته شود، دیر یا زود از هم
 *     جدا می‌شود (همان اشتباهی که در `timeline` و `SOFT_TABLES` افتاد).
 */

type Kind = 'receipt' | 'expense';

const META: Record<Kind, { title: string; path: string; accent: string }> = {
  receipt: { title: 'رسید دریافت پول', path: '/receipts', accent: 'var(--ok)' },
  expense: { title: 'سند مصرف', path: '/expenses', accent: 'var(--danger)' },
};

export default function PrintDoc({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { calendar } = useSession();
  const [doc, setDoc] = useState<any>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const meta = META[kind];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    api.get(`${meta.path}/${id}`)
      .then((r) => { if (alive) setDoc(r); })
      .catch((e: any) => { if (alive) setErr(e?.message || 'سند پیدا نشد.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, meta.path]);

  const autoPrint = new URLSearchParams(window.location.search).get('auto') === '1';
  const [printed, setPrinted] = useState(false);
  useEffect(() => {
    if (!doc || printed || !autoPrint) return;
    const t = setTimeout(() => { setPrinted(true); window.print(); }, 350);
    return () => clearTimeout(t);
  }, [doc, printed, autoPrint]);

  if (err) {
    return (
      <div style={{ padding: 30, maxWidth: 520 }}>
        <h3 style={{ marginBottom: 8 }}>سند باز نشد</h3>
        <p className="small" style={{ color: 'var(--text-2)', marginBottom: 16 }}>{err}</p>
        <button className="btn" onClick={() => nav(-1)}>بازگشت</button>
      </div>
    );
  }
  if (loading || !doc) return <div style={{ padding: 30 }}>در حال آماده‌سازی…</div>;

  /* هر سند فقط ستون‌هایی را نشان می‌دهد که واقعاً دارد — نه ردیف «—» */
  const fields: [string, string][] = [];
  const push = (label: string, value: any) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') fields.push([label, String(value)]);
  };

  if (kind === 'receipt') {
    push('نام مشتری', doc.customerName);
    push('مبلغ دریافتی', `${money(doc.amount)} افغانی`);
    push('منبع دریافت', doc.sourceName);
    push('بل مربوط', doc.relatedBillNo);
    push('دریافت‌کننده', doc.receivedBy);
    push('توضیحات', doc.note);
  } else {
    push('شرح مصرف', doc.description);
    push('نوع مصرف', doc.categoryName);
    push('مبلغ (افغانی)', `${money(doc.amountAfn)} افغانی`);
    if (Number(doc.amountUsd) > 0) push('مبلغ (دالر)', `${money(doc.amountUsd)} دالر`);
    push('فروشگاه', doc.shopName);
    push('بیل خرید', doc.purchaseBillNo);
    push('پرداخت‌کننده', doc.payerName);
    push('باربری / دمترک', doc.contractorName);
    push('نوع پرداخت', doc.paymentType === 'cash' ? 'نقده' : 'باقی');
    push('توضیحات', doc.note);
  }

  const headMeta = [
    { label: 'شماره سند', value: doc.no },
    { label: 'تاریخ', value: formatDate(doc.date, calendar, true) },
  ];

  /*
   * مبلغ اصلی برای نمایش بزرگ: رسید → مبلغ دریافتی، مصرف → مبلغ افغانی.
   * با ارقام فارسی/لاتین یکسان که در `money` تعیین می‌شود.
   */
  const bigAmount = kind === 'receipt' ? Number(doc.amount) : Number(doc.amountAfn);
  const bigLabel = kind === 'receipt' ? 'مبلغ دریافتی' : 'مبلغ مصرف';

  return (
    <>
      <div className="doc-toolbar">
        <button className="btn primary" onClick={() => window.print()}><IconPrint size={15} /> چاپ / ذخیره PDF</button>
        <button className="btn" onClick={() => nav(-1)}><IconChevron dir="start" size={14} /> بازگشت</button>
      </div>
      <div className="doc-page">
        <DocHeader title={meta.title} meta={headMeta} />

        <table className="doc-table" style={{ marginTop: 10 }}>
          <tbody>
            {fields.map(([label, value]) => (
              <tr key={label}>
                <th style={{ width: 170, textAlign: 'start' }}>{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="doc-total">
          <span>{bigLabel}:</span>
          <b style={{ color: meta.accent }}>{money(bigAmount)} افغانی</b>
        </div>

        <DocFooter extra="این سند توسط سیستم محلی شرکت فردای روشن صادر شده است." />
      </div>
    </>
  );
}
