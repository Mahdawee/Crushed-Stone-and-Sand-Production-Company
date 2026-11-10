import { IconAlert, IconChevron, IconPrint } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Spinner, Table, Empty, Stat } from '../components/ui';
import { money, formatDate } from '../lib/calendar';
import { DatePicker } from '../components/DatePicker';
import '../styles/print.css';

export default function CustomerStatement() {
  const { id } = useParams();
  const { calendar } = useSession();
  const [d, setD] = useState<any>(null);

  const [range, setRange] = useState({ from: '', to: '' });
  useEffect(() => { api.get(`/customers/${id}/statement`).then(setD).catch(() => setD(false)); }, [id]);
  if (d === null) return <Spinner />;
  if (d === false) return <Empty icon={<IconAlert size={16} />} title="مشتری پیدا نشد" action={<Link className="btn" to="/customers">بازگشت</Link>} />;

  const c = d.customer;

  /* فیلتر بازه فقط روی نمایش — باقی مانده کل همان د.closing است */
  const shown = (d.rows || []).filter((r: any) => (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to));
  const shownTotals = shown.reduce((a: any, r: any) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit }), { debit: 0, credit: 0 });
  const lastInRange = shown.length ? shown[shown.length - 1].balance : d.opening;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row between wrap no-print">
        <div>
          <h1 style={{ fontSize: '1.25rem' }}>{c.name}</h1>
          <p className="small muted">کد {c.code} — {c.contactPerson || 'بدون شخص رابط'} — {c.phone}</p>
        </div>
        <div className="row wrap">
          <DatePicker compact value={range.from} onChange={(v) => setRange({ ...range, from: v })} calendar={calendar} clearable placeholder="از تاریخ" width={130} />
          <DatePicker compact value={range.to} onChange={(v) => setRange({ ...range, to: v })} calendar={calendar} clearable placeholder="تا تاریخ" width={130} />
          {range.from || range.to ? <button className="btn sm ghost" onClick={() => setRange({ from: '', to: '' })}>همه</button> : null}
          <button className="btn" onClick={() => window.print()}><IconPrint size={15} /> چاپ صورت حساب</button>
          <Link className="btn" to="/customers"><IconChevron dir="start" size={14} /> بازگشت</Link>
        </div>
      </div>

      <div className="grid c4">
        <Stat label="بدهی اولیه" value={money(d.opening)} foot="قبل از اسناد این سیستم" />
        <Stat label="مجموع بدهکاری" value={money(d.totals.debit)} foot="فروشات (نقده + قرضه)" kind="bad" />
        <Stat label="مجموع پرداخت‌ها" value={money(d.totals.credit)} foot="رسیدات" kind="ok" />
        <Stat label="باقی مانده فعلی" value={money(d.closing)} foot={d.closing > 0 ? 'بدهکار' : d.closing < 0 ? 'بستانکار' : 'تصفیه'} kind={d.closing > 0 ? 'bad' : 'ok'} />
      </div>

      <div className="card">
        <div className="card-h"><h3>کارت حساب</h3><div style={{ flex: 1 }} />
          <span className="small muted">{shown.length} سند{shown.length !== d.rows.length ? ` از ${d.rows.length}` : ''}</span></div>
        <div className="card-b tight">
          <Table head={['تاریخ', 'نوع', 'شماره سند', 'تفصیل', 'بدهکاری', 'پرداخت', 'باقی مانده']}
            foot={<tr>
              <td colSpan={4}>مجموع{range.from || range.to ? ' بازه' : ''}</td>
              <td className="num">{money(shownTotals.debit)}</td>
              <td className="num">{money(shownTotals.credit)}</td>
              <td className="num">{money(lastInRange)}</td>
            </tr>}>
            <tr style={{ background: 'var(--surface-2)' }}>
              <td colSpan={4} className="muted">بدهی اولیه</td>
              <td className="num">{money(d.opening)}</td>
              <td className="num">—</td>
              <td className="num">{money(d.opening)}</td>
            </tr>
            {shown.map((r: any) => (
              <tr key={r.id}>
                <td className="mono">{formatDate(r.date, calendar)}</td>
                <td>{r.type}</td>
                <td className="mono">{r.doc}</td>
                <td className="small">{r.detail}</td>
                <td className="num">{r.debit ? money(r.debit) : '—'}</td>
                <td className="num">{r.credit ? money(r.credit) : '—'}</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(r.balance)}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </div>
  );
}
