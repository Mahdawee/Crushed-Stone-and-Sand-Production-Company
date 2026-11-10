import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { DocHeader, DocFooter } from '../components/DocHeader';
import { money, formatDate } from '../lib/calendar';
import '../styles/print.css';

export default function PrintSale() {
  const { id } = useParams();
  const nav = useNavigate();
  const { calendar } = useSession();
  const [s, setS] = useState<any>(null);
  useEffect(() => { api.get(`/sales/${id}`).then(setS).catch(() => {}); }, [id]);
  const [printed, setPrinted] = useState(false);
  useEffect(() => {
    /* در پنجره دسکتاپ چاپ خودکار مزاحم است — فقط در حالت مرورگر یک بار چاپ می‌شود */
    if (!s || printed) return;
    const t = setTimeout(() => { window.print(); setPrinted(true); }, 400);
    return () => clearTimeout(t);
  }, [s, printed]);
  if (!s) return <div style={{ padding: 30 }}>در حال آماده‌سازی…</div>;

  const rows = [
    ['شماره بل', s.no],
    ['تاریخ', formatDate(s.date, calendar, true)],
    ['نام مشتری', s.customerName],
    ['نام دریور', s.driverName || '—'],
    ['پلیت موتر', s.truckPlate || '—'],
    ['مقصد', s.destination || '—'],
    ['مربوط', s.contractorName || 'شخصی شرکت'],
    ['نوع پرداخت', s.paymentType === 'cash' ? 'نقده' : 'باقی'],
  ];

  return (
    <>
      <div className="doc-toolbar">
        <button className="btn primary" onClick={() => window.print()}>🖨 چاپ / ذخیره PDF</button>
        <button className="btn" onClick={() => nav(-1)}>← بازگشت</button>
      </div>
      <div className="doc-page">
        <DocHeader title="بل فروش" meta={rows.slice(0, 2).map(([label, value]) => ({ label, value }))} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 24px', fontSize: '.84rem', marginBottom: 14 }}>
          {rows.slice(2).map(([label, value]) => (
            <div key={label}><span style={{ color: '#666' }}>{label}: </span><b>{value}</b></div>
          ))}
        </div>

        <table className="doc-table">
          <thead>
            <tr>
              <th>نوع مواد</th><th>متراژ (م³)</th><th>قیمت فی متر</th><th>مبلغ مواد</th>
              <th>کرایه فی متر</th><th>مجموع کرایه</th><th>مجموع</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{s.materialName || '—'}</td>
              <td className="num">{money(s.volume)}</td>
              <td className="num">{money(s.unitPrice)}</td>
              <td className="num">{money(Number(s.volume) * Number(s.unitPrice))}</td>
              <td className="num">{money(s.freightPerUnit)}</td>
              <td className="num">{money(s.freightTotal)}</td>
              <td className="num"><b>{money(s.total)}</b></td>
            </tr>
          </tbody>
        </table>

        <div className="doc-total">
          <span>مجموع قابل پرداخت:</span>
          <b>{money(s.total)} افغانی</b>
        </div>

        {s.note ? <div style={{ marginTop: 12, fontSize: '.82rem' }}>توضیحات: {s.note}</div> : null}
        <DocFooter extra="این بل توسط سیستم محلی شرکت فردای روشن صادر شده است." />
      </div>
    </>
  );
}
