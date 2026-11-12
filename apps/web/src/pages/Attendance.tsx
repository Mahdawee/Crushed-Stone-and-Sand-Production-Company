import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Spinner, Select, Table, Num } from '../components/ui';
import { DatePicker, MonthPicker } from '../components/DatePicker';
import { monthKey, formatDate, pad2, toCalendar, todayISO, weekdayIndex, WEEKDAYS } from '../lib/calendar';


const STATUSES = [
  { value: 'present', label: 'حاضر', short: 'ح', color: 'ok' },
  { value: 'absent', label: 'غایب', short: 'غ', color: 'bad' },
  { value: 'leave', label: 'رخصت', short: 'ر', color: 'warn' },
  { value: 'sick', label: 'مریض', short: 'م', color: 'info' },
  { value: 'official_holiday', label: 'رخصتی رسمی', short: 'ع', color: 'muted' },
  { value: 'friday', label: 'جمعه', short: 'ج', color: 'muted' },
];
/*
 * چرخه‌ی کلیک روی هر خانه: … → جمعه → **پاک (ثبت‌نشده)** → حاضر.
 *
 * باگ: قبلاً چرخه برگشتی به حالت «ثبت‌نشده» نداشت، پس اگر اشتباهی روی یک روز
 * کلیک می‌شد راهی برای پاک کردنش نبود. حالا با یک کلیک اضافه پاک می‌شود و در
 * ورق روزانه هم دکمه‌ی «پاک کردن» هست.
 */
const NEXT: Record<string, string> = {
  present: 'absent', absent: 'leave', leave: 'sick', sick: 'official_holiday',
  official_holiday: 'friday', friday: '',
};
const CLEARED = '__cleared__';

/**
 * ساعت ورود/خروج — متن آزاد با قالب «۰۸:۳۰».
 *
 * عمداً یک <input> ساده است (نه کامپوننت داخل بدنه‌ی صفحه) تا با هر رندر
 * دوباره ساخته نشود و فوکوس کاربر نپرد.
 */
function TimeText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [raw, setRaw] = React.useState(value);
  React.useEffect(() => { setRaw(value); }, [value]);
  return (
    <input
      className="input mono" style={{ width: 78, textAlign: 'center' }} placeholder="۰۸:۳۰"
      dir="ltr" value={raw}
      onChange={(e) => {
        let v = e.target.value
          .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
          .replace(/[^0-9:]/g, '');
        if (v.length === 2 && !v.includes(':') && raw.length < v.length) v += ':';
        setRaw(v.slice(0, 5));
      }}
      onBlur={() => onChange(raw.slice(0, 5))}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onChange(raw.slice(0, 5)); } }}
    />
  );
}

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
    if (dirty[key]) return dirty[key].status === CLEARED ? '' : dirty[key].status;
    return status || '';
  };

  const cycle = (empId: number, dateISO: string, cur: string) => {
    const next = NEXT[cur || ''] ?? 'present';
    setDirty((p) => ({ ...p, [`${empId}|${dateISO}`]: { employeeId: empId, date: dateISO, status: next } }));
  };

  const saveMonth = async () => {
    const items = Object.values(dirty).map((it: any) => (
      it.status === CLEARED ? { ...it, status: '', remove: true } : it
    ));
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

  /** ذخیره‌ی یک سطر ورق روزانه (بدون رفرش کل جدول تا فوکوس نپرد) */
  const saveDayCell = async (employeeId: number, patch: any) => {
    if (!dayData) return;
    try {
      await api.post('/attendance/bulk', {
        items: [{ employeeId, date: dayData.date, ...patch }],
      });
      setDayData((prev: any) => prev ? {
        ...prev,
        rows: prev.rows.some((r: any) => r.employeeId === employeeId)
          ? prev.rows.map((r: any) => (r.employeeId === employeeId ? { ...r, ...patch } : r))
          : [...prev.rows, { employeeId, date: prev.date, ...patch }],
      } : prev);
    } catch (e: any) { toast.error('ثبت نشد', e.message); }
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
      <div className="card">
        <div className="list-head">
          <div className="pill-tabs">
            <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>ماهانه</button>
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>روزانه</button>
          </div>
          {mode === 'month'
            ? <MonthPicker value={month} onChange={setMonth} calendar={calendar} yearsBack={4} />
            : <DatePicker value={day} onChange={setDay} calendar={calendar} width={150} />}
          <span className="badge muted">{data?.label || ''}</span>
          <div style={{ flex: 1 }} />
          <div className="list-actions">
            {mode === 'month' ? (
              <>
                <DatePicker compact value={bulkDate} onChange={setBulkDate} calendar={calendar} width={132} placeholder="روز" />
                <Select value={bulkStatus} onChange={setBulkStatus} options={STATUSES.map((x) => ({ value: x.value, label: x.label }))} />
                <button className="btn" onClick={markAll}>ثبت گروهی</button>
                <button className="btn primary" onClick={saveMonth} disabled={busy || !Object.keys(dirty).length}>
                  ذخیره{Object.keys(dirty).length ? ` (${Object.keys(dirty).length})` : ''}
                </button>
              </>
            ) : null}
          </div>
        </div>
        {mode === 'month' ? (
          <div className="att-legend">
            {STATUSES.map((x) => (
              <span key={x.value} className="att-key">
                <i style={{ background: `var(--${x.color}-soft)`, color: `var(--${x.color})` }}>{x.short}</i>{x.label}
              </span>
            ))}
            <span className="muted">— روی هر خانه کلیک کنید تا وضعیت عوض شود؛ کلیک آخر پاک می‌کند</span>
          </div>
        ) : null}
        <div className="card-b tight">
      {mode === 'month' ? (
        !data ? <Spinner /> : (
          <div style={{ overflowX: 'auto' }}>
              <table className="tbl compact">
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', insetInlineStart: 0, background: 'var(--surface-2)', zIndex: 3 }}>کارمند</th>
                    {data.days.map((d: string) => {
                      const c = toCalendar(d, calendar);
                      const wd = weekdayIndex(c.jy, c.jm, c.jd, calendar);
                      const isToday = d === todayISO();
                      const isFri = wd === 6;
                      return (
                        <th key={d} className="att-th" title={`${formatDate(d, calendar, true)} — ${WEEKDAYS[wd]}`}
                          style={{
                            textAlign: 'center', minWidth: 34,
                            background: isToday ? 'var(--accent-soft)' : isFri ? 'var(--surface-3)' : undefined,
                          }}>
                          <span className="mono" style={{ display: 'block', fontSize: '.76rem', color: isToday ? 'var(--accent-dark)' : undefined }}>{c.jd}</span>
                          <span style={{ display: 'block', fontSize: '.6rem', opacity: .55, fontWeight: 400 }}>{WEEKDAYS[wd]}</span>
                        </th>
                      );
                    })}
                    <th style={{ textAlign: 'center' }}>حاضر</th>
                    <th style={{ textAlign: 'center' }}>غایب</th>
                    <th style={{ textAlign: 'center' }} className="hide-sm">رخصت</th>
                    <th style={{ textAlign: 'center' }} className="hide-sm">اضافه</th>
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
                        <td className="num" style={{ textAlign: 'center', color: 'var(--ok)' }}>{cnt.present}</td>
                        <td className="num" style={{ textAlign: 'center', color: cnt.absent ? 'var(--danger)' : 'var(--text-3)' }}>{cnt.absent}</td>
                        <td className="num hide-sm" style={{ textAlign: 'center' }}>{cnt.leave}</td>
                        <td className="num hide-sm" style={{ textAlign: 'center' }}>{ot}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          </div>
        )
      ) : (
        !dayData ? <Spinner /> : (
          <>
            <div className="att-legend"><b>ورق روزانه — {formatDate(dayData.date, calendar, true)}</b>
              <span className="badge info">{dayData.employees.length} کارمند</span></div>
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
                      {/* روزانه: ساعت ورود/خروج و اضافه‌کاری قابل ویرایش‌اند و
                          چون اضافه‌کاری ماه از همین‌جا جمع می‌شود، باید واردشدنی باشد. */}
                      <td><TimeText value={row?.checkIn || ''} onChange={(v) => saveDayCell(e.id, { checkIn: v, checkOut: row?.checkOut, overtime: row?.overtime, status: row?.status || 'present' })} /></td>
                      <td><TimeText value={row?.checkOut || ''} onChange={(v) => saveDayCell(e.id, { checkIn: row?.checkIn, checkOut: v, overtime: row?.overtime, status: row?.status || 'present' })} /></td>
                      <td style={{ width: 96 }}><Num value={row?.overtime ?? 0} onChange={(v) => saveDayCell(e.id, { checkIn: row?.checkIn, checkOut: row?.checkOut, overtime: v, status: row?.status || 'present' })} /></td>
                    </tr>
                  );
                })}
              </Table>
          </>
        )
      )}
        </div>
      </div>
    </div>
  );
}
