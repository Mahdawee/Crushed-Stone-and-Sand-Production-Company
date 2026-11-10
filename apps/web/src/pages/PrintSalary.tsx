import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { DocHeader, DocFooter } from '../components/DocHeader';
import { money } from '../lib/calendar';
import '../styles/print.css';

export default function PrintSalary() {
  const { id } = useParams();
  const [s, setS] = useState<any>(null);
  useEffect(() => { api.get(`/salaries/${id}`).then(setS).catch(() => {}); }, [id]);
  useEffect(() => { if (s) setTimeout(() => window.print(), 350); }, [s]);
  if (!s) return <div style={{ padding: 30 }}>در حال آماده‌سازی…</div>;

  return (
    <>
      <div className="doc-toolbar">
        <button className="btn primary" onClick={() => window.print()}>🖨 چاپ</button>
        <button className="btn" onClick={() => window.close()}>بستن</button>
      </div>
      <div className="doc-page">
        <DocHeader title="رسید معاش" meta={[{ label: 'شماره رسید', value: s.no }, { label: 'ماه/سال', value: s.periodLabel }]} />

        <table className="doc-table">
          <tbody>
            <tr><th style={{ width: 190 }}>نام کارمند</th><td>{s.employeeName}</td></tr>
            <tr><th>معاش ثابت</th><td className="num">{money(s.baseSalary)}</td></tr>
            <tr><th>پاداش</th><td className="num">{money(s.bonus)}</td></tr>
            <tr><th>اضافه کاری</th><td className="num">{money(s.overtimeAmount)}</td></tr>
            <tr><th>جریمه</th><td className="num">{money(s.penalty)}</td></tr>
            <tr><th>مجموع پرداخت</th><td className="num"><b style={{ fontSize: '1.05rem' }}>{money(s.total)} افغانی</b></td></tr>
            <tr><th>پرداخت‌کننده</th><td>{s.payerName || '—'}</td></tr>
            <tr><th>نوع پرداخت</th><td>{s.paymentType === 'cash' ? 'نقد' : 'حواله'}</td></tr>
            <tr><th>تاریخ پرداخت</th><td>{s.payDateDisplay || '—'}</td></tr>
          </tbody>
        </table>

        <DocFooter extra={s.note || 'معاش فوق به طور مکمل دریافت گردید.'} />
      </div>
    </>
  );
}
