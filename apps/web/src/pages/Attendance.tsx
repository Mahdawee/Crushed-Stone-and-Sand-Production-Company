import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Spinner, Select, Table } from '../components/ui';
import { DatePicker, MonthPicker } from '../components/DatePicker';
import { monthKey, formatDate, pad2, toCalendar, todayISO } from '../lib/calendar';

const STATUSES = [
  { value: 'present', label: 'حاضر', short: 'ح', color: 'ok' },
  { value: 'absent', label: 'غایب', short: 'غ', color: 'bad' },
  { value: 'leave', label: 'رخصت', short: 'ر', color: 'warn' },
  { value: 'sick', label: 'مریض', short: 'م', color: 'info' },
  { value: 'official_holiday', label: 'رخصتی رسمی', short: 'ع', color: 'muted' },
  { value: 'friday', label: 'جمعه', short: 'ج', color: 'muted' },
];
const NEXT: Record<string, string> = { present: 'absent', absent: 'leave', leave: 'sick', sick: 'official_holiday', official_holiday: 'friday', friday: 'present' };

export default function AttendancePage() {
  const { calendar } = useSession();
  const toast = useToast();
  const [mode, setMode] = useState<'month' | 'day'>('month');
  const [month, setMonth] = useState(monthKey(calendar));
  const [data, setData] = useState<any>(null);
  const [dayData, setDayData] = useState<any>(null);
  const [day, setDay] = useState(todayISO());
  const [dirty, setDirty] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);

  const [bulkDate, setBulkDate] = useState('');
  const [bulkStatus, setBulkStatus] = useState('present');
  const [y, m] = month.split('-').map(Number);

  const load = async () => {
    const d = await api.get(`/attendance?month=${month}`);
    setData(d);
    setDirty({});
  };
  const loadDay = async () => {
    try { setDayData(await api.get(`/attendance?date=${encodeURIComponent(day)}`)); }
    catch (e: any) { toast.error('تاریخ', e.message); }
  };

  useEffect(() => { load().catch((e) => toast.error('بارگذاری نشد', e.message)); }, [month]);
  useEffect(() => { if (mode === 'day') loadDay(); }, [mode, day]);

  const cellVal = (empId: number, dateISO: string, status: string) => {
    const key = `${empId}|${dateISO}`;
    if (dirty[key]) return dirty[key].status;
    return status || '';
  };

  const cycle = (empId: number, dateISO: string, cur: string) => {
    const next = NEXT[cur || ''] || 'present';
    setDirty((p) => ({ ...p, [`${empId}|${dateISO}`]: { employeeId: empId, date: dateISO, status: next } }));
  };

  const saveMonth = async () => {
    const items = Object.values(dirty);
    if (!items.length) { toast.info('تغییری ثبت نشده است.'); return; }
    setBusy(true);
    try {
      await api.post('/attendance/bulk', { items });
      toast.success(`${items.length} تغییر ذخیره شد`);
      await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const markAll = async () => {
    const ids = (data?.employees || []).map((e: any) => e.id);
    if (!ids.length || !bulkDate) { toast.warn('اول روز را انتخاب کنید.'); return; }
    try {
      await api.post('/attendance/mark-day', { date: bulkDate, employeeIds: ids, status: bulkStatus });
      await load();
      toast.success('ثبت گروهی انجام شد', `${ids.length} کارمند برای ${formatDate(bulkDate, calendar)} — ${STATUSES.find((s) => s.value === bulkStatus)?.label}`);
    } catch (e: any) { toast.error('ثبت گروهی انجام نشد', e.message); }
  };

  const matrix = useMemo(() => {
    if (!data) return [];
    const map: Record<string, string> = {};
    for (const r of data.rows) map[`${r.employeeId}|${r.date}`] = r.status;
    return data.employees.map((e: any) => ({
      ...e,
      days: data.days.map((d: string) => ({ date: d, status: map[`${e.id}|${d}`] || '' })),
    }));
  }, [data]);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between wrap">
        <div className="row wrap">
          <div className="pill-tabs">
            <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>نمای ماهانه</button>
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>ورق روزانه</button>
          </div>
          {mode === 'month' ? (
            <MonthPicker value={month} onChange={setMonth} calendar={calendar} yearsBack={4} />
          ) : (
            <DatePicker value={day} onChange={setDay} calendar={calendar} width={152} />
          )}
          <span className="badge info">{data?.label || ''}</span>
        </div>
        <div className="row wrap">
          {mode === 'month' ? (
            <>
              <div className="row wrap" style={{ gap: 6 }}>
                <DatePicker compact value={bulkDate} onChange={setBulkDate} calendar={calendar} width={138} placeholder="روز" />
                <Select value={bulkStatus} onChange={setBulkStatus} options={STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
                <button className="btn" onClick={markAll}>ثبت گروهی همه</button>
              </div>
              <button className="btn primary" onClick={saveMonth} disabled={busy || !Object.keys(dirty).length}>
                ذخیره تغییرات {Object.keys(dirty).length ? `(${Object.keys(dirty).length})` : ''}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {mode === 'month' ? (
        !data ? <Spinner /> : (
          <div className="card">
            <div className="card-h">
              <h3>{data.label}</h3>
              <span className="small muted">روی هر خانه کلیک کنید — ترتیب: حاضر ← غایب ← رخصت ← مریض ← رخصتی ← جمعه</span>
            </div>
            <div className="card-b tight" style={{ overflowX: 'auto' }}>
              <table className="tbl compact">
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', insetInlineStart: 0, background: 'var(--surface-2)', zIndex: 3 }}>کارمند</th>
                    {data.days.map((d: string) => {
                      const c = toCalendar(d, calendar);
                      return <th key={d} className="mono" style={{ textAlign: 'center', minWidth: 32 }}>{c.jd}</th>;
                    })}
                    <th>حاضر</th><th>غایب</th><th>رخصت</th><th>اضافه</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row: any) => {
                    const cnt = row.days.reduce((a: any, d: any) => {
                      const s = cellVal(row.id, d.date, d.status);
                      if (s === 'present') a.present++; else if (s === 'absent') a.absent++; else if (s === 'leave') a.leave++;
                      return a;
                    }, { present: 0, absent: 0, leave: 0 });
                    const ot = (data.rows || []).filter((r: any) => r.employeeId === row.id).reduce((a: number, r: any) => a + Number(r.overtime || 0), 0);
                    return (
                      <tr key={row.id}>
                        <td style={{ position: 'sticky', insetInlineStart: 0, background: 'var(--surface)', zIndex: 1, whiteSpace: 'nowrap' }}>
                          <b>{row.name}</b> <span className="small muted mono">{row.code}</span>
                        </td>
                        {row.days.map((d: any) => {
                          const s = cellVal(row.id, d.date, d.status);
                          const cfg = STATUSES.find((x) => x.value === s);
                          return (
                            <td key={d.date} style={{ padding: 2, textAlign: 'center' }}>
                              <button className={`att-cell ${s ? 'on' : ''}`}
                                style={cfg ? {
                                  background: `var(--${cfg.color}-soft)`,
                                  borderColor: `color-mix(in srgb, var(--${cfg.color}) 55%, transparent)`,
                                  color: `var(--${cfg.color})`, fontWeight: 700,
                                } : {}}
                                title={`${formatDate(d.date, calendar)} — ${cfg?.label || 'ثبت نشده'}`}
                                onClick={() => cycle(row.id, d.date, s)}>
                                {cfg?.short || '·'}
                              </button>
                            </td>
                          );
                        })}
                        <td className="num">{cnt.present}</td>
                        <td className="num">{cnt.absent}</td>
                        <td className="num">{cnt.leave}</td>
                        <td className="num">{ot}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        !dayData ? <Spinner /> : (
          <div className="card">
            <div className="card-h"><h3>ورق روزانه — {formatDate(dayData.date, calendar, true)}</h3><div style={{ flex: 1 }} />
              <span className="badge info">{dayData.employees.length} کارمند</span></div>
            <div className="card-b tight">
              <Table head={['#', 'کد', 'نام', 'وضعیت', 'ورود', 'خروج', 'اضافه کاری']}>
                {dayData.employees.map((e: any, i: number) => {
                  const row = dayData.rows.find((r: any) => r.employeeId === e.id);
                  return (
                    <tr key={e.id}>
                      <td>{i + 1}</td>
                      <td className="mono">{e.code}</td>
                      <td>{e.name}</td>
                      <td>
                        <Select value={row?.status || ''} placeholder="ثبت نشده"
                          options={STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                          onChange={async (v) => {
                            await api.post('/attendance/bulk', { items: [{ employeeId: e.id, date: dayData.date, status: v, checkIn: row?.checkIn, checkOut: row?.checkOut, overtime: row?.overtime }] });
                            await loadDay();
                          }} />
                      </td>
                      <td className="mono">{row?.checkIn || '—'}</td>
                      <td className="mono">{row?.checkOut || '—'}</td>
                      <td className="num">{row?.overtime || 0}</td>
                    </tr>
                  );
                })}
              </Table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
