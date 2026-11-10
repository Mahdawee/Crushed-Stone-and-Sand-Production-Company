import { IconAlert, IconCash, IconChart, IconCheck, IconCoins, IconContact, IconPackage, IconPlus, IconTruck, IconWallet } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Stat, Spinner, Table, Empty } from '../components/ui';
import { money, formatDate, todayISO } from '../lib/calendar';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend,
} from 'recharts';

export default function Dashboard() {
  const { calendar } = useSession();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/reports/dashboard').then(setD).catch((e) => setErr(e.message));
  }, []);

  if (err) return <Empty icon={<IconAlert size={16} />} title="داشبورد بارگذاری نشد" hint={err} />;
  if (!d) return <Spinner />;

  const t = d.today;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card no-print">
        <div className="list-head">
          <IconCash size={17} />
          <span className="small muted hide-sm">{t.label} — وضعیت لحظه‌ای شرکت</span>
          <div style={{ flex: 1 }} />
          <div className="list-actions">
          <Link to="/sales?new=1" className="btn primary"><IconPlus size={15} /> بل فروش</Link>
          <Link to="/receipts?new=1" className="btn"><IconPlus size={15} /> رسید</Link>
          <Link to="/expenses?new=1" className="btn"><IconPlus size={15} /> مصرف</Link>
          </div>
        </div>
      </div>

      <div className="grid c4">
        <Stat label="موجودی دخل امروز" value={money(t.cashBalance)} foot={`${t.cashMode === 'accurate' ? 'حالت دقیق' : 'حالت ساده'} — ${t.dateDisplay}`}
          kind={t.cashBalance >= 0 ? 'ok' : 'bad'} icon={<IconCash size={16} />} />
        <Stat label="فروشات امروز" value={money(t.allSales)} foot={`نقده ${money(t.cashSales)} / قرضه ${money(t.creditSales)}`} icon={<IconTruck size={16} />} />
        <Stat label="متراژ امروز" value={`${money(t.volume)} م³`} foot={`${money(t.receipts)} افغانی رسید`} icon={<IconPackage size={16} />} />
        <Stat label="مجموع بدهی مشتریان" value={money(d.debtTotal)} foot={`${d.debtors.length}+ مشتری باقی دار`} kind="warn" icon={<IconContact size={16} />} />
      </div>

      <div className="grid c4">
        <Stat label={`فروشات ${d.month.label}`} value={money(d.month.sales)} foot={`${money(d.month.volume)} متر مکعب`} icon={<IconChart size={16} />} />
        <Stat label="مصارف این ماه" value={money(d.month.expenses)} foot="افغانی" kind="bad" icon={<IconWallet size={16} />} />
        <Stat label="معاشات این ماه" value={money(d.month.salaries)} foot={`${d.counts.salaryDoneThisMonth} سند پرداخت`} icon={<IconCoins size={16} />} />
        <Stat label="سود ناخالص این ماه" value={money(d.month.profit)} foot="فروشات − (مصارف + معاشات)"
          kind={d.month.profit >= 0 ? 'ok' : 'bad'} icon={<IconCheck size={16} />} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <div className="card">
          <div className="card-h"><h3>روند ۱۴ روز اخیر</h3><div style={{ flex: 1 }} /><span className="small muted">افغانی</span></div>
          <div className="card-b" style={{ height: 290 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.chart} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, direction: 'rtl' }}
                  formatter={(v: any, n: any) => [money(v), n === 'cash' ? 'فروش نقده' : n === 'credit' ? 'فروش قرضه' : 'مصارف']}
                />
                <Legend formatter={(v) => (v === 'cash' ? 'نقده' : v === 'credit' ? 'قرضه' : 'مصارف')} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="cash" stroke="var(--accent)" fill="url(#gCash)" strokeWidth={2} />
                <Area type="monotone" dataKey="credit" stroke="var(--warn)" fillOpacity={0.08} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h3>بدهی مشتریان</h3><div style={{ flex: 1 }} /><Link to="/reports/detail" className="small">همه</Link></div>
          <div className="card-b tight">
            {d.debtors.length === 0 ? <Empty icon={<IconCheck size={16} />} title="هیچ بدهی باقی نیست" /> : (
              <div className="col" style={{ gap: 2 }}>
                {d.debtors.map((c: any) => (
                  <Link key={c.id} to={`/customers/${c.id}`} className="row between"
                    style={{ padding: '9px 10px', borderRadius: 9, color: 'inherit' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '.86rem' }}>{c.name}</div>
                      <div className="small muted">{c.code}</div>
                    </div>
                    <div className="mono" style={{ fontWeight: 700, color: 'var(--danger)' }}>{money(c.balance)}</div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.35fr 1fr' }}>
        <div className="card">
          <div className="card-h"><h3>آخرین فروشات</h3><div style={{ flex: 1 }} /><Link to="/sales" className="small">همه فروشات</Link></div>
          <div className="card-b tight">
            <Table head={['شماره', 'تاریخ', 'مشتری', 'مواد', 'متراژ', 'مجموع']} compact>
              {d.recentSales.map((s: any) => (
                <tr key={s.no}>
                  <td className="mono">{s.no}</td>
                  <td className="mono">{s.dateDisplay}</td>
                  <td>{s.customerName}</td>
                  <td>{s.materialName}</td>
                  <td className="num">{money(s.volume)}</td>
                  <td className="num">{money(s.total)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h3>وضعیت امروز</h3></div>
          <div className="card-b">
            <div className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="small muted">فروش نقده</span><b className="mono">{money(t.cashSales)}</b>
            </div>
            <div className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="small muted">فروش قرضه</span><b className="mono">{money(t.creditSales)}</b>
            </div>
            <div className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="small muted">رسیدات</span><b className="mono">{money(t.receipts)}</b>
            </div>
            <div className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="small muted">مصارف</span><b className="mono">{money(t.expensesAfn)}</b>
              {t.expensesUsd ? <span className="badge warn">${money(t.expensesUsd)}</span> : null}
            </div>
            <div className="row between" style={{ padding: '8px 0' }}>
              <span className="small muted">معاشات پرداخت‌شده</span><b className="mono">{money(t.salaries)}</b>
            </div>
            <div className="divider" />
            <div className="row between">
              <span style={{ fontWeight: 700 }}>موجودی دخل</span>
              <span className="mono" style={{ fontWeight: 800, fontSize: '1.1rem', color: t.cashBalance >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                {money(t.cashBalance)}
              </span>
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>
              کارمندان فعال: <b>{d.counts.employees}</b> — مشتریان: <b>{d.counts.customers}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
