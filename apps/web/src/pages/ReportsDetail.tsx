import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast, Field, Text, Table, Spinner, Stat } from '../components/ui';
import { money, todayISO, toCalendar, pad2, fromCalendar } from '../lib/calendar';
import { useSession } from '../lib/session';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import '../styles/print.css';

const TABS = [
  { key: 'material', label: 'فروشات به نوع مواد' },
  { key: 'customer', label: 'فروشات به مشتری' },
  { key: 'category', label: 'مصارف به نوع' },
  { key: 'payer', label: 'مصارف به پرداخت‌کننده' },
  { key: 'contractor', label: 'کرایه به باربری' },
  { key: 'debtors', label: 'باقی مانده بدهی' },
  { key: 'salary', label: 'خلاصه معاشات' },
];

export default function ReportsDetail() {
  const { calendar } = useSession();
  const toast = useToast();
  const now = toCalendar(todayISO(), calendar);
  const [range, setRange] = useState({ from: `${now.jy}/01/01`, to: `${now.jy}/${pad2(now.jm)}/${pad2(now.jd)}` });
  const [tab, setTab] = useState('material');
  const [d, setD] = useState<any>(null);

  const load = async () => {
    const qs = new URLSearchParams();
    const toIso = (s: string) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = s.replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))).match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
      if (!m) return '';
      return fromCalendar(Number(m[1]), Number(m[2]), Number(m[3]), calendar);
    };
    const f = toIso(range.from), t = toIso(range.to);
    if (f) qs.set('from', f); if (t) qs.set('to', t);
    setD(await api.get(`/reports/breakdown?${qs.toString()}`));
  };
  useEffect(() => { load().catch((e) => toast.error('بارگذاری نشد', e.message)); }, []);

  const sum = (arr: any[], key: string) => (arr || []).reduce((a, r) => a + Number(r[key] || 0), 0);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card no-print"><div className="card-b"><div className="toolbar">
        <Field label="از تاریخ"><Text value={range.from} onChange={(v) => setRange({ ...range, from: v })} /></Field>
        <Field label="تا تاریخ"><Text value={range.to} onChange={(v) => setRange({ ...range, to: v })} /></Field>
        <button className="btn primary" onClick={() => load().catch((e) => toast.error(e.message))}>نمایش</button>
        <button className="btn" onClick={() => window.print()}>🖨 چاپ</button>
      </div></div></div>

      <div className="pill-tabs" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      {!d ? <Spinner /> : (
        <div className="col" style={{ gap: 14 }}>
          {tab === 'material' && (
            <>
              <div className="grid c3">
                <Stat label="مجموع فروش اقلام" value={money(sum(d.byMaterial, 'total'))} />
                <Stat label="مجموع متراژ" value={`${money(sum(d.byMaterial, 'volume'))} م³`} />
                <Stat label="مجموع کرایه" value={money(sum(d.byMaterial, 'freight'))} kind="warn" />
              </div>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="card"><div className="card-h"><h3>فروش به نوع مواد</h3></div><div className="card-b" style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.byMaterial} layout="vertical" margin={{ right: 20, left: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
                      <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: 'var(--text-2)' }} />
                      <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} formatter={(v: any) => money(v)} />
                      <Bar dataKey="total" fill="var(--accent)" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div></div>
                <div className="card"><div className="card-h"><h3>تفصیل</h3></div><div className="card-b tight">
                  <Table head={['مواد', 'اسناد', 'متراژ', 'کرایه', 'مجموع']} compact>
                    {d.byMaterial.map((r: any, i: number) => (
                      <tr key={i}><td>{r.name || '—'}</td><td className="num">{r.docs}</td><td className="num">{money(r.volume)}</td><td className="num">{money(r.freight)}</td><td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td></tr>
                    ))}
                  </Table>
                </div></div>
              </div>
            </>
          )}
          {tab === 'customer' && (
            <div className="card"><div className="card-h"><h3>فروشات به مشتری</h3></div><div className="card-b tight">
              <Table head={["مشتری", "اسناد", "متراژ", "مجموع فروش", "از آن قرضه", ""]}>
                {d.byCustomer.map((r: any, i: number) => (
                  <tr key={i}><td>{r.name}</td><td className="num">{r.docs}</td><td className="num">{money(r.volume)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td>
                    <td className="num" style={{ color: 'var(--danger)' }}>{money(r.credit)}</td><td /></tr>
                ))}
              </Table>
            </div></div>
          )}
          {tab === 'category' && (
            <div className="card"><div className="card-h"><h3>مصارف به نوع</h3><div style={{ flex: 1 }} /><span className="badge bad">{money(sum(d.byCategory, 'afn'))} افغانی</span></div>
              <div className="card-b tight">
                <Table head={['نوع مصرف', 'اسناد', 'افغانی', 'دالری']}>
                  {d.byCategory.map((r: any, i: number) => (
                    <tr key={i}><td>{r.name || '—'}</td><td className="num">{r.docs}</td><td className="num" style={{ fontWeight: 700 }}>{money(r.afn)}</td><td className="num">{r.usd ? `$${money(r.usd)}` : '—'}</td></tr>
                  ))}
                </Table>
              </div></div>
          )}
          {tab === 'payer' && (
            <div className="card"><div className="card-h"><h3>مصارف به پرداخت‌کننده</h3></div><div className="card-b tight">
              <Table head={['پرداخت‌کننده', 'اسناد', 'مبلغ افغانی']}>
                {d.byPayer.map((r: any, i: number) => (
                  <tr key={i}><td>{r.name || '—'}</td><td className="num">{r.docs}</td><td className="num" style={{ fontWeight: 700 }}>{money(r.afn)}</td></tr>
                ))}
              </Table>
            </div></div>
          )}
          {tab === 'contractor' && (
            <div className="card"><div className="card-h"><h3>کرایه پرداختی به باربری‌ها / دمترک‌ها</h3></div><div className="card-b tight">
              <Table head={['باربری / مربوط', 'اسناد', 'مجموع کرایه']}>
                {d.byContractor.map((r: any, i: number) => (
                  <tr key={i}><td>{r.name}</td><td className="num">{r.docs}</td><td className="num" style={{ fontWeight: 700 }}>{money(r.freight)}</td></tr>
                ))}
              </Table>
            </div></div>
          )}
          {tab === 'debtors' && (
            <div className="card">
              <div className="card-h"><h3>باقی مانده بدهی مشتریان</h3><div style={{ flex: 1 }} />
                <span className="badge bad">مجموع: {money(d.debtTotal)}</span></div>
              <div className="card-b tight">
                <Table head={['کد', 'مشتری', 'تماس', 'باقی مانده']}>
                  {d.debtors.map((r: any, i: number) => (
                    <tr key={i}><td className="mono">{r.code}</td><td>{r.name}</td><td className="mono">{r.phone}</td>
                      <td className="num" style={{ fontWeight: 800, color: r.balance > 0 ? 'var(--danger)' : 'var(--ok)' }}>{money(r.balance)}</td></tr>
                  ))}
                </Table>
              </div>
            </div>
          )}
          {tab === 'salary' && (
            <div className="card"><div className="card-h"><h3>خلاصه معاشات به ماه</h3></div><div className="card-b tight">
              <Table head={['ماه', 'تعداد کارمند', 'مجموع پرداخت']}>
                {(d.salarySummary || []).map((r: any, i: number) => (
                  <tr key={i}><td>{r.name}</td><td className="num">{r.employees}</td><td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td></tr>
                ))}
              </Table>
            </div></div>
          )}
        </div>
      )}
    </div>
  );
}
