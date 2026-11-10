import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, Table, Spinner, Stat } from '../components/ui';
import { money, todayISO, toCalendar, pad2, fromCalendar } from '../lib/calendar';

export default function CashbookPage() {
  const { calendar } = useSession();
  const toast = useToast();
  const now = toCalendar(todayISO(), calendar);
  const [range, setRange] = useState({ from: `${now.jy}/${pad2(now.jm)}/01`, to: `${now.jy}/${pad2(now.jm)}/${pad2(now.jd)}` });
  const [d, setD] = useState<any>(null);

  const load = async () => {
    const toIso = (s: string) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = s.replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))).match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
      if (!m) return '';
      return fromCalendar(Number(m[1]), Number(m[2]), Number(m[3]), calendar);
    };
    const qs = new URLSearchParams();
    const f = toIso(range.from), t = toIso(range.to);
    if (f) qs.set('from', f); if (t) qs.set('to', t);
    setD(await api.get(`/reports/cashbook?${qs.toString()}`));
  };
  useEffect(() => { load().catch((e) => toast.error('بارگذاری نشد', e.message)); }, []);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card no-print"><div className="card-b"><div className="toolbar">
        <Field label="از تاریخ"><Text value={range.from} onChange={(v) => setRange({ ...range, from: v })} /></Field>
        <Field label="تا تاریخ"><Text value={range.to} onChange={(v) => setRange({ ...range, to: v })} /></Field>
        <button className="btn primary" onClick={() => load().catch((e) => toast.error(e.message))}>نمایش</button>
        <button className="btn" onClick={() => window.print()}>🖨 چاپ</button>
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
