import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadCsv } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, Num, Table, Spinner, Select, Stat, Modal } from '../components/ui';
import { money, monthName, months, monthKey, pad2, toCalendar, toInputDate, parseInputDate, todayISO } from '../lib/calendar';

export default function SalariesPage() {
  const { calendar } = useSession();
  const toast = useToast();
  const [month, setMonth] = useState(monthKey(calendar));
  const [sheet, setSheet] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [payDate, setPayDate] = useState(toInputDate(todayISO(), calendar));
  const [payers, setPayers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any>(null);
  const [tab, setTab] = useState<'sheet' | 'history'>('sheet');
  const [y, m] = month.split('-').map(Number);

  const load = async () => {
    const s = await api.get(`/salaries/sheet?month=${month}`);
    setSheet(s); setRows(s.rows);
    if (s.rows[0]?.payDate) setPayDate(toInputDate(s.rows[0].payDate, calendar));
  };
  useEffect(() => { load().catch((e) => toast.error('بارگذاری نشد', e.message)); }, [month]);
  useEffect(() => { api.get('/lookups').then((r) => setPayers(r.items.payer || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (tab === 'history') api.get(`/salaries?month=${month}&pageSize=200`).then(setHistory).catch(() => {});
  }, [tab, month]);

  const edit = (i: number, patch: any) => {
    setRows((prev) => prev.map((r, idx) => {
      if (idx !== i) return r;
      const next = { ...r, ...patch };
      next.total = Math.round((Number(next.baseSalary) + Number(next.bonus) + Number(next.overtimeAmount) - Number(next.penalty)) * 100) / 100;
      return next;
    }));
  };

  const save = async () => {
    let pd = '';
    try { pd = parseInputDate(payDate, calendar); } catch (e: any) { toast.error('تاریخ پرداخت', e.message); return; }
    setBusy(true);
    try {
      const res = await api.post('/salaries/sheet', { month, payDate: pd, rows });
      toast.success(`معاش ${res.label} ذخیره شد`, `${res.saved} کارمند — تاریخ پرداخت ${payDate}`);
      await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const total = rows.reduce((a, r) => a + Number(r.total || 0), 0);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between wrap">
        <div className="row wrap">
          <div className="pill-tabs">
            <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>ورق معاش</button>
            <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>سابقه اسناد</button>
          </div>
          <Select value={m} onChange={(v) => setMonth(`${y}-${pad2(Number(v))}`)} options={months(calendar).map((n, i) => ({ value: i + 1, label: n }))} />
          <Select value={y} onChange={(v) => setMonth(`${v}-${pad2(m)}`)}
            options={[0, 1, 2].map((k) => { const yy = toCalendar(todayISO(), calendar).jy - k; return { value: yy, label: String(yy) }; })} />
          <span className="badge info">{sheet?.label || ''}</span>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => downloadCsv('salaries')}>⤓ اکسل</button>
          {tab === 'sheet' ? (
            <>
              <div className="field" style={{ minWidth: 150 }}>
                <label style={{ fontSize: '.72rem' }}>تاریخ پرداخت</label>
                <Text value={payDate} onChange={setPayDate} />
              </div>
              <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره ورق معاش'}</button>
            </>
          ) : null}
        </div>
      </div>

      {tab === 'sheet' ? (
        !sheet ? <Spinner /> : (
          <>
            <div className="grid c4">
              <Stat label="کارمندان فعال" value={rows.length} icon="👷" />
              <Stat label="مجموع معاش ثابت" value={money(rows.reduce((a, r) => a + Number(r.baseSalary || 0), 0))} icon="💰" />
              <Stat label="اضافه کاری (ساعت)" value={rows.reduce((a, r) => a + Number(r.overtimeHours || 0), 0)} icon="⏱" />
              <Stat label="مجموع پرداخت این ماه" value={money(total)} kind="ok" icon="✅" />
            </div>

            <div className="card">
              <div className="card-h"><h3>ورق معاش — {sheet.label}</h3><div style={{ flex: 1 }} />
                <span className="small muted">اضافه کاری از شیت حضور و غیاب خودکار محاسبه می‌شود</span></div>
              <div className="card-b tight">
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl compact">
                    <thead><tr>
                      <th>#</th><th>کد</th><th>نام</th><th>معاش ثابت</th><th>پاداش</th><th>جریمه</th>
                      <th>ساعت اضافه</th><th>مبلغ اضافه کاری</th><th>مجموع پرداخت</th><th>پرداخت‌کننده</th><th>نوع</th><th>سند</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.employeeId}>
                          <td>{i + 1}</td>
                          <td className="mono">{r.code}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{r.name}</td>
                          <td style={{ width: 110 }}><Num value={r.baseSalary} onChange={(v) => edit(i, { baseSalary: v })} /></td>
                          <td style={{ width: 100 }}><Num value={r.bonus} onChange={(v) => edit(i, { bonus: v })} /></td>
                          <td style={{ width: 100 }}><Num value={r.penalty} onChange={(v) => edit(i, { penalty: v })} /></td>
                          <td className="num">{r.overtimeHours}{r.absentDays ? <span className="badge bad" style={{ marginInlineStart: 6 }}>غ {r.absentDays}</span> : null}</td>
                          <td style={{ width: 110 }}><Num value={r.overtimeAmount} onChange={(v) => edit(i, { overtimeAmount: v })} /></td>
                          <td className="num" style={{ fontWeight: 800 }}>{money(r.total)}</td>
                          <td style={{ width: 130 }}>
                            <Select value={r.payerName} placeholder="—" onChange={(v) => {
                              const p = payers.find((x) => x.name === v);
                              edit(i, { payerName: v, payerId: p?.id });
                            }} options={payers.map((p) => ({ value: p.name, label: p.name }))} />
                          </td>
                          <td style={{ width: 90 }}>
                            <Select value={r.paymentType} onChange={(v) => edit(i, { paymentType: v })}
                              options={[{ value: 'cash', label: 'نقد' }, { value: 'hawala', label: 'حواله' }]} />
                          </td>
                          <td>{r.saved ? <span className="badge ok">ثبت شده</span> : <span className="badge muted">جدید</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr>
                      <td colSpan={8}>مجموع</td>
                      <td className="num">{money(total)}</td>
                      <td colSpan={3} />
                    </tr></tfoot>
                  </table>
                </div>
              </div>
            </div>
          </>
        )
      ) : (
        !history ? <Spinner /> : (
          <div className="card">
            <div className="card-h"><h3>اسناد معاش ثبت‌شده</h3><div style={{ flex: 1 }} /><span className="badge info">{history.total} سند</span></div>
            <div className="card-b tight">
              <Table head={['شماره سند', 'ماه/سال', 'کارمند', 'معاش', 'پاداش', 'جریمه', 'اضافه', 'مجموع', 'پرداخت‌کننده', 'نوع', 'تاریخ پرداخت', '']}>
                {history.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="mono">{r.no}</td>
                    <td>{r.periodLabel}</td>
                    <td>{r.employeeName}</td>
                    <td className="num">{money(r.baseSalary)}</td>
                    <td className="num">{money(r.bonus)}</td>
                    <td className="num">{money(r.penalty)}</td>
                    <td className="num">{money(r.overtimeAmount)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td>
                    <td>{r.payerName}</td>
                    <td><span className="badge info">{r.paymentType === 'cash' ? 'نقد' : 'حواله'}</span></td>
                    <td className="mono">{r.payDateDisplay}</td>
                    <td><Link className="btn sm" to={`/print/salary/${r.id}`}>رسید</Link></td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
