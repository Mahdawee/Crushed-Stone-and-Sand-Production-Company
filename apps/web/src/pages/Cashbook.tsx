import { IconPrint } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Table, Spinner, Stat } from '../components/ui';
import { DatePicker } from '../components/DatePicker';
import { money, todayISO, toCalendar, fromCalendar } from '../lib/calendar';
import '../styles/print.css';

export default function CashbookPage() {
  const { calendar } = useSession();
  const toast = useToast();
  const now = toCalendar(todayISO(), calendar);
  const [range, setRange] = useState({ from: fromCalendar(now.jy, now.jm, 1, calendar), to: todayISO() });
  const [d, setD] = useState<any>(null);

  const load = async () => {
    const qs = new URLSearchParams();
    if (range.from) qs.set('from', range.from);
    if (range.to) qs.set('to', range.to);
    try { setD(await api.get(`/reports/cashbook?${qs.toString()}`)); }
    catch (e: any) { toast.error('حرکت دخل بارگذاری نشد', e.message); }
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
      </div></div></div>

      {!d ? <Spinner /> : (<>
        <div className="grid c3">
          <Stat label="کل وارده" value={money(d.totals.in)} kind="ok" />
          <Stat label="کل صادره" value={money(d.totals.out)} kind="bad" />
          <Stat label="باقی صندوق دوره" value={money(d.totals.balance)} kind={d.totals.balance >= 0 ? 'ok' : 'bad'} />
        </div>
        <div className="card"><div className="card-h"><h3>حرکت دخل</h3><div style={{ flex: 1 }} /><span className="small muted">{d.rows.length} سند</span></div>
          <div className="card-b tight">
            <Table head={['تاریخ', 'نوع', 'سند', 'طرف معامله', 'وارده', 'صادره', 'باقی']}>
              {d.rows.map((r: any, i: number) => (
                <tr key={i}>
                  <td className="mono">{r.dateDisplay}</td>
                  <td>{r.type}</td>
                  <td className="mono">{r.doc}</td>
                  <td className="small">{r.party}</td>
                  <td className="num" style={{ color: r.in ? 'var(--ok)' : 'inherit' }}>{r.in ? money(r.in) : '—'}</td>
                  <td className="num" style={{ color: r.out ? 'var(--danger)' : 'inherit' }}>{r.out ? money(r.out) : '—'}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(r.balance)}</td>
                </tr>
              ))}
            </Table>
          </div></div>
      </>)}
    </div>
  );
}
