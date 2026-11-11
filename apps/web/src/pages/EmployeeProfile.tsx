import { IconAlert, IconCheck, IconChevron, IconClock, IconCoins, IconReceipt } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Spinner, Table, Empty, Stat, Modal, Field, Text, TextArea, Num, useToast } from '../components/ui';
import { DatePicker } from '../components/DatePicker';
import { money, formatDate } from '../lib/calendar';

export default function EmployeeProfile() {
  const { id } = useParams();
  const { calendar } = useSession();
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  /* فرم ویرایش — درخواست کاربر: «در جاهای که نیاز است ویرایش اضافه شود» */
  const [form, setForm] = useState<any>(null);
  const [hire, setHire] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => api.get(`/employees/${id}`).then(setD).catch(() => setD(false));
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [id]);

  const openEdit = () => {
    setForm({ ...d.employee });
    setHire(d.employee.hireDate || '');
  };

  const save = async () => {
    if (!form.name?.trim()) { toast.warn('نام کارمند را وارد کنید.'); return; }
    setBusy(true);
    try {
      await api.put(`/employees/${form.id}`, { ...form, hireDate: hire || '' });
      toast.success('تغییرات ذخیره شد');
      setForm(null);
      await reload();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };
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
      <div className="card">
        <div className="list-head">
          <div className="brand-logo" style={{ width: 38, height: 38, fontSize: 17 }}>{e.name.slice(0, 1)}</div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '.98rem' }}>{e.name}</h3>
            <span className="small muted">کد {e.code} — {e.position} — ولد {e.fatherName}</span>
          </div>
          <div style={{ flex: 1 }} />
          <div className="list-actions">
            <button className="btn primary" onClick={openEdit}>ویرایش مشخصات</button>
            <Link className="btn" to="/employees"><IconChevron dir="start" size={14} /> بازگشت به فهرست</Link>
          </div>
        </div>
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

      {form ? (
        <Modal
          title="ویرایش مشخصات کارمند"
          onClose={() => setForm(null)}
          onEnter={save}
          size="md"
          footer={
            <>
              <button className="btn" onClick={() => setForm(null)}>انصراف</button>
              <button className="btn primary" disabled={busy} onClick={save}>{busy ? '…' : 'ذخیره'}</button>
            </>
          }
        >
          <div className="form-grid c2">
            <Field label="نام" required><Text value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></Field>
            <Field label="نام پدر"><Text value={form.fatherName} onChange={(v) => setForm({ ...form, fatherName: v })} /></Field>
            <Field label="وظیفه"><Text value={form.position} onChange={(v) => setForm({ ...form, position: v })} /></Field>
            <Field label="تاریخ استخدام">
              <DatePicker value={hire} onChange={setHire} calendar={calendar} clearable />
            </Field>
            <Field label="معاش ثابت (؋)"><Num value={form.baseSalary} onChange={(v) => setForm({ ...form, baseSalary: v })} /></Field>
            <Field label="شماره تماس"><Text value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></Field>
            <Field label="شماره تذکره"><Text value={form.nationalId} onChange={(v) => setForm({ ...form, nationalId: v })} /></Field>
            <Field label="مدت قرارداد"><Text value={form.contractPeriod} onChange={(v) => setForm({ ...form, contractPeriod: v })} /></Field>
            <Field label="آدرس" span={2}><TextArea value={form.address} onChange={(v) => setForm({ ...form, address: v })} /></Field>
            <Field label="توضیحات" span={2}><TextArea value={form.note} onChange={(v) => setForm({ ...form, note: v })} /></Field>
          </div>
        </Modal>
      ) : null}

    </div>
  );
}
