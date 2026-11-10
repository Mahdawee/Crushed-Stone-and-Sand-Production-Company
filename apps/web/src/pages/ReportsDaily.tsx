import { IconPrint } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Table, Spinner, Stat } from '../components/ui';
import { DatePicker } from '../components/DatePicker';
import { money, todayISO, toCalendar, pad2, fromCalendar } from '../lib/calendar';
import '../styles/print.css';

export default function ReportsDaily() {
  const { calendar } = useSession();
  const toast = useToast();
  const now = toCalendar(todayISO(), calendar);
  const [range, setRange] = useState({ from: fromCalendar(now.jy, now.jm, 1, calendar), to: todayISO() });
  const [d, setD] = useState<any>(null);

  const load = async () => {
    const qs = new URLSearchParams();
    if (range.from) qs.set('from', range.from);
    if (range.to) qs.set('to', range.to);
    try {
      setD(await api.get(`/reports/daily?${qs.toString()}`));
    } catch (e: any) {
      toast.error('راپور بارگذاری نشد', e.message);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card no-print"><div className="card-b"><div className="toolbar">
        <div className="field"><label>از تاریخ</label>
          <DatePicker value={range.from} onChange={(v) => setRange({ ...range, from: v })} calendar={calendar} width={140} /></div>
        <div className="field"><label>تا تاریخ</label>
          <DatePicker value={range.to} onChange={(v) => setRange({ ...range, to: v })} calendar={calendar} width={140} /></div>
        <button className="btn primary" onClick={load}>نمایش</button>
        <button className="btn" onClick={() => window.print()}><IconPrint size={15} /> چاپ</button>
        <div className="spacer" />
        <span className="small muted">موجودی دخل هر روز + مجموع دوره</span>
      </div></div></div>

      {!d ? <Spinner /> : (<>
        <div className="grid c4">
          <Stat label="فروشات نقده" value={money(d.totals.cashSales)} kind="ok" foot="پول نقد وارد شده" />
          <Stat label="فروشات قرضه" value={money(d.totals.creditSales)} kind="warn" foot="در بدهی مشتری" />
          <Stat label="رسیدات" value={money(d.totals.receipts)} foot="دریافت از مشتریان" />
          <Stat label="مجموع صادره دوره" value={money(d.totals.totalExpenses)} kind="bad" foot={`مصارف ${money(d.totals.expensesAfn)} + معاشات ${money(d.totals.salaries)}`} />
        </div>
        <div className="grid c3">
          <Stat label="داخل دخل (دوره)" value={money(d.totals.cashIn ?? 0)} kind="ok" foot="فروش نقده + رسیدات دخل" />
          <Stat label="خارج دخل (دوره)" value={money(d.totals.cashOut ?? 0)} kind="bad" foot="مصارف + معاشات نقدی" />
          {(() => {
            const acc = (d.rows || []).reduce((a: number, r: any) => a + Number(r.cashBalance), 0);
            return <Stat label="موجودی متحرک دخل" value={money(acc)} kind={acc >= 0 ? 'ok' : 'bad'} foot={`حالت ${d.mode === 'accurate' ? 'دقیق' : 'ساده'}`} />;
          })()}
        </div>

        <div className="card">
          <div className="card-h"><h3>راپور روزانه</h3><div style={{ flex: 1 }} />
            <span className="small muted">{d.rows.length} روز</span></div>
          <div className="card-b tight">
            <Table head={['تاریخ', 'فروش نقده', 'فروش قرضه', 'رسیدات', 'مصارف', 'معاشات', 'مجموع مصارف', 'موجودی دخل روز', 'متحرک دخل']}
              foot={<tr>
                <td>مجموع دوره</td>
                <td className="num">{money(d.totals.cashSales)}</td>
                <td className="num">{money(d.totals.creditSales)}</td>
                <td className="num">{money(d.totals.receipts)}</td>
                <td className="num">{money(d.totals.expensesAfn)}</td>
                <td className="num">{money(d.totals.salaries)}</td>
                <td className="num">{money(d.totals.totalExpenses)}</td>
                <td className="num">{money(d.totals.cashIn ?? 0)}</td>
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
                  <td className="num" style={{ fontWeight: 700, color: r.cashBalance >= 0 ? 'var(--ok)' : 'var(--danger)' }} title={`داخل ${money(r.cashIn)} − خارج ${money(r.cashOut)}`}>{money(r.cashBalance)}</td>
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
