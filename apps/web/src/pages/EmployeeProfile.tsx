import { IconAlert, IconCheck, IconChevron, IconClock, IconCoins, IconReceipt } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Spinner, Table, Empty, Stat } from '../components/ui';
import { money, formatDate } from '../lib/calendar';

export default function EmployeeProfile() {
  const { id } = useParams();
  const { calendar } = useSession();
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get(`/employees/${id}`).then(setD).catch(() => setD(false)); }, [id]);
  if (d === null) return <Spinner />;
  if (d === false) return <Empty icon={<IconAlert size={16} />} title="کارمند پیدا نشد" action={<Link className="btn" to="/employees">بازگشت</Link>} />;

  const e = d.employee;
  const att = d.attendance || [];
  const sum = att.reduce((a: any, r: any) => {
    if (r.status === 'present') a.present++; else if (r.status === 'absent') a.absent++;
    else if (r.status === 'leave') a.leave++; else if (r.status === 'sick') a.sick++;
    a.overtime += Number(r.overtime) || 0; return a;
  }, { present: 0, absent: 0, leave: 0, sick: 0, overtime: 0 });
  const totalSalary = (d.salaries || []).reduce((a: number, s: any) => a + Number(s.total || 0), 0);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row between wrap">
        <div className="row" style={{ gap: 12 }}>
          <div className="brand-logo" style={{ width: 52, height: 52, fontSize: 22 }}>{e.name.slice(0, 1)}</div>
          <div>
            <h1 style={{ fontSize: '1.25rem' }}>{e.name}</h1>
            <p className="small muted">کد {e.code} — {e.position} — ولد {e.fatherName}</p>
          </div>
        </div>
        <Link className="btn" to="/employees"><IconChevron dir="start" size={14} /> بازگشت به فهرست</Link>
      </div>

      <div className="grid c4">
        <Stat label="معاش ثابت" value={money(e.baseSalary)} foot="افغانی" icon={<IconCoins size={16} />} />
        <Stat label="ایام حاضر (آخرین سوابق)" value={sum.present} foot={`غایب ${sum.absent} — رخصت ${sum.leave}`} kind="ok" icon={<IconCheck size={16} />} />
        <Stat label="اضافه کاری" value={`${money(sum.overtime)} ساعت`} foot="مجموع ثبت‌شده" icon={<IconClock size={16} />} />
        <Stat label="مجموع معاش پرداخت‌شده" value={money(totalSalary)} foot={`${(d.salaries || []).length} سند`} icon={<IconReceipt size={16} />} />
      </div>

      <div className="grid c2">
        <div className="card">
          <div className="card-h"><h3>معلومات کارمند</h3></div>
          <div className="card-b">
            <dl className="kv">
              <dt>کد کارمند</dt><dd className="mono">{e.code}</dd>
              <dt>نام پدر</dt><dd>{e.fatherName || '—'}</dd>
              <dt>وظیفه</dt><dd>{e.position || '—'}</dd>
              <dt>تاریخ استخدام</dt><dd className="mono">{formatDate(e.hireDate, calendar) || '—'}</dd>
              <dt>شماره تماس</dt><dd className="mono">{e.phone || '—'}</dd>
              <dt>شماره تذکره</dt><dd className="mono">{e.nationalId || '—'}</dd>
              <dt>مدت قرارداد</dt><dd>{e.contractPeriod || '—'}</dd>
              <dt>آدرس</dt><dd style={{ fontWeight: 400 }}>{e.address || '—'}</dd>
              <dt>وضعیت</dt><dd><span className={`badge ${e.status === 'active' ? 'ok' : 'muted'}`}>{e.status === 'active' ? 'فعال' : 'غیر فعال'}</span></dd>
              <dt>توضیحات</dt><dd className="muted">{e.note || '—'}</dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h3>سابقه معاش</h3></div>
          <div className="card-b tight">
            <Table head={['ماه', 'معاش', 'پاداش', 'جریمه', 'اضافه کاری', 'مجموع']} compact
              empty="هنوز معاشی ثبت نشده است.">
              {(d.salaries || []).map((s: any) => (
                <tr key={s.id}>
                  <td>{s.periodLabel}</td>
                  <td className="num">{money(s.baseSalary)}</td>
                  <td className="num">{money(s.bonus)}</td>
                  <td className="num">{money(s.penalty)}</td>
                  <td className="num">{money(s.overtimeAmount)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(s.total)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>حضور و غیاب اخیر</h3><div style={{ flex: 1 }} /><Link className="small" to="/attendance">رفتن به شیت حضور و غیاب</Link></div>
        <div className="card-b tight">
          <Table head={['تاریخ', 'وضعیت', 'ورود', 'خروج', 'اضافه کاری', 'توضیحات']} compact empty="سابقه‌ای موجود نیست.">
            {att.map((r: any) => (
              <tr key={r.id}>
                <td className="mono">{formatDate(r.date, calendar)}</td>
                <td><span className={`badge ${r.status === 'present' ? 'ok' : r.status === 'absent' ? 'bad' : r.status === 'friday' || r.status === 'official_holiday' ? 'muted' : 'warn'}`}>
                  {({ present: 'حاضر', absent: 'غایب', leave: 'رخصت', sick: 'مریض', official_holiday: 'رخصتی', friday: 'جمعه' } as any)[r.status] || r.status}
                </span></td>
                <td className="mono">{r.checkIn || '—'}</td>
                <td className="mono">{r.checkOut || '—'}</td>
                <td className="num">{r.overtime || 0}</td>
                <td className="small muted">{r.note}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </div>
  );
}
