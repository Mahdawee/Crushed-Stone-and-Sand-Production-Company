import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, Table, Spinner, Stat } from '../components/ui';
import { money, todayISO, toCalendar, pad2, fromCalendar } from '../lib/calendar';
import '../styles/print.css';

export default function ReportsDaily() {
  const { calendar } = useSession();
  const toast = useToast();
  const now = toCalendar(todayISO(), calendar);
  const [range, setRange] = useState({ from: `${now.jy}/${pad2(now.jm)}/01`, to: `${now.jy}/${pad2(now.jm)}/${pad2(now.jd)}` });
  const [d, setD] = useState<any>(null);

  const load = async () => {
    const qs = new URLSearchParams();
    const toIso = (s: string) => {
      // accept "1405/08/19" or ISO
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = s.replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))).match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
      if (!m) return '';
      return fromCalendar(Number(m[1]), Number(m[2]), Number(m[3]), calendar);
    };
    const f = toIso(range.from), t = toIso(range.to);
    if (f) qs.set('from', f);
    if (t) qs.set('to', t);
    setD(await api.get(`/reports/daily?${qs.toString()}`));
  };
  useEffect(() => { load().catch((e) => toast.error('راپور بارگذاری نشد', e.message)); }, []);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card no-print"><div className="card-b"><div className="toolbar">
        <Field label="از تاریخ"><Text value={range.from} onChange={(v) => setRange({ ...range, from: v })} /></Field>
        <Field label="تا تاریخ"><Text value={range.to} onChange={(v) => setRange({ ...range, to: v })} /></Field>
        <button className="btn primary" onClick={() => load().catch((e) => toast.error('بارگذاری نشد', e.message))}>نمایش</button>
        <button className="btn" onClick={() => window.print()}>🖨 چاپ</button>
        <div className="spacer" />
        <span className="small muted">موجودی دخل هر روز + مجموع دوره</span>
      </div></div></div>

      {!d ? <Spinner /> : (<>
        <div className="grid c4">
          <Stat label="فروشات نقده" value={money(d.totals.cashSales)} kind="ok" />
          <Stat label="فروشات قرضه" value={money(d.totals.creditSales)} kind="warn" />
          <Stat label="رسیدات" value={money(d.totals.receipts)} />
          <Stat label="مجموع موجودی دخل دوره" value={money(d.totals.cashBalance)} kind={d.totals.cashBalance >= 0 ? 'ok' : 'bad'} />
        </div>

        <div className="card">
          <div className="card-h"><h3>راپور روزانه</h3><div style={{ flex: 1 }} />
            <span className="small muted">{d.rows.length} روز</span></div>
          <div className="card-b tight">
            <Table head={['تاریخ', 'فروشات نقده', 'فروشات قرضه', 'رسیدات', 'مصارف', 'معاشات', 'مجموع مصارف', 'موجودی دخل روز', 'موجودی متحرک']}
              foot={<tr>
                <td>مجموع دوره</td>
                <td className="num">{money(d.totals.cashSales)}</td>
                <td className="num">{money(d.totals.creditSales)}</td>
                <td className="num">{money(d.totals.receipts)}</td>
                <td className="num">{money(d.totals.expensesAfn)}</td>
                <td className="num">{money(d.totals.salaries)}</td>
                <td className="num">{money(d.totals.totalExpenses)}</td>
                <td className="num">{money(d.totals.cashBalance)}</td>
                <td />
              </tr>}>
              {d.rows.map((r: any) => (
                <tr key={r.date}>
                  <td className="mono">{r.dateDisplay}</td>
                  <td className="num">{money(r.cashSales)}</td>
                  <td className="num">{money(r.creditSales)}</td>
                  <td className="num">{money(r.receipts)}</td>
                  <td className="num">{money(r.expensesAfn)}{r.expensesUsd ? <span className="badge warn" style={{ marginInlineStart: 4 }}>${money(r.expensesUsd)}</span> : null}</td>
                  <td className="num">{money(r.salaries)}</td>
                  <td className="num">{money(r.totalExpenses)}</td>
                  <td className="num" style={{ fontWeight: 700, color: r.cashBalance >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{money(r.cashBalance)}</td>
                  <td className="num muted">{money(r.runningCash)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      </>)}
    </div>
  );
}
