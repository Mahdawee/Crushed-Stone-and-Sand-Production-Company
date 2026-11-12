import { IconPlus } from '../components/icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, listImportTypes } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, Select, ListHead, SearchBox, InlineStat,
  ExportButton, ImportDialog,
} from '../components/ui';
import { useDebounced } from '../lib/useDebounced';
import { useLatestRequest } from '../lib/useLatestRequest';
import { money, formatDate, todayISO } from '../lib/calendar';
import { DatePicker } from '../components/DatePicker';

const empty = {
  code: '', name: '', fatherName: '', position: '', hireDate: '', baseSalary: 0,
  phone: '', nationalId: '', address: '', contractPeriod: 'یک سال', status: 'active', note: '',
};

export default function EmployeesPage() {
  const { calendar, isManager } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<any>(null);
  const [hire, setHire] = useState('');   // ISO میلادی
  const [busy, setBusy] = useState(false);

  const latest = useLatestRequest();
  const load = () => latest(
    () => api.get(`/employees?q=${encodeURIComponent(dq)}&status=${status}`),
    (r: any) => setRows(r.rows),
  );
  const dq = useDebounced(q);
  useEffect(() => { load().catch((e) => toast.error('بارگذاری نشد', e.message)); }, [dq, status]);

  const openNew = async () => {
    /*
     * باگ (شکار باگ دور ۲۵): این `await` **بیرون از try** بود. اگر شماره‌ی
     * بعدی گرفته نمی‌شد (سرور تازه بالا آمده، شبکه‌ی محلی شلوغ، نشست منقضی)،
     * استثنا به هیچ‌جا نمی‌رسید، فورم باز نمی‌شد و کاربر هیچ پیامی نمی‌دید.
     * حالا پیام روشن می‌دهد و دکمه بی‌صدا مرده نمی‌ماند.
     */
    let no = '', code = '';
    try {
      const r = await api.get('/employees/next-code');
      no = r?.no || ''; code = r?.code || '';
    } catch {
      toast.error('فورم باز نشد', 'مشکل در گرفتن کد بعدی کارمند.');
      return;
    }

    setForm({ ...empty, code });
    setHire(todayISO());
  };
  const openEdit = (r: any) => { setForm({ ...r }); setHire(r.hireDate || ''); };

  const save = async () => {
    /*
     * باگ: `openNew` نام را خالی می‌گذاشت ولی `name` فقط با `trim()` بررسی
     * می‌شد و «کد کارمند» هیچ بررسی‌ای نداشت. اگر سرور کد را رد می‌کرد،
     * کاربر فقط «ذخیره نشد» می‌دید. حالا همان بررسی‌های سرور، پیش از ارسال،
     * با پیام روشن انجام می‌شود.
     */
    if (!form.name?.trim()) { toast.warn('نام کارمند را وارد کنید.'); return; }
    if (!String(form.code || '').trim()) { toast.warn('کد کارمند خالی است.', 'دکمه‌ی «کد بعدی» را بزنید یا کد بدهید.'); return; }
    if (Number(form.baseSalary) < 0) { toast.warn('معاش ثابت نمی‌تواند منفی باشد.'); return; }
    const hireDate = hire || '';
    setBusy(true);
    try {
      if (form.id) await api.put(`/employees/${form.id}`, { ...form, hireDate });
      else await api.post('/employees', { ...form, hireDate });
      toast.success('کارمند ذخیره شد');
      setForm(null); await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const remove = (r: any) => toast.confirm({
    title: 'حذف کارمند؟',
    body: `«${r.name}» از فهرست کنار می‌رود. داده پاک نمی‌شود — از «سطل بازیافت» قابل بازگرداندن است.\nاگر سابقه معاش دارد، سیستم اجازه نمی‌دهد.`,
    confirmText: 'حذف کن',
    onConfirm: async () => {
      try { await api.del(`/employees/${r.id}`); await load(); toast.success('حذف شد'); }
      catch (e: any) { toast.error('حذف نشد', e.message); }
    },
  });

  const totals = useMemo(() => ({
    active: (rows || []).filter((r) => r.status === 'active').length,
    inactive: (rows || []).filter((r) => r.status !== 'active').length,
    salary: (rows || []).filter((r) => r.status === 'active').reduce((a, r) => a + Number(r.baseSalary || 0), 0),
  }), [rows]);

  /* ورود از اکسل — همان الگوی مشتریان */
  const [importOpen, setImportOpen] = useState(false);
  const [importTypes, setImportTypes] = useState<any[]>([]);
  const openImport = async () => {
    try {
      if (!importTypes.length) setImportTypes((await listImportTypes()).items);
      setImportOpen(true);
    } catch (e: any) { toast.error('فهرست ورودی خوانده نشد', e.message); }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <ListHead
          summary={<>
            <InlineStat label="فعال" value={totals.active} tone="ok" />
            <span className="sep" />
            <InlineStat label="غیر فعال" value={totals.inactive} />
            <span className="sep" />
            <InlineStat label="معاش ثابت" value={`${money(totals.salary)} ؋`} />
          </>}
          actions={<>
            <ExportButton type="employees" />
            {/*
              ورود گروهی فقط برای مدیر: API هم با @ManagerOnly محافظت شده.
              دکمه‌ای که کار نمی‌کند بدتر از نبودن دکمه است.
            */}
            {isManager ? (
              <button className="btn" onClick={openImport} title="ورود گروهی از فایل اکسل/CSV">ورود از اکسل</button>
            ) : null}
            <button className="btn primary" onClick={openNew}><IconPlus size={15} /> کارمند</button>
          </>}
        >
          <SearchBox value={q} onChange={setQ} placeholder="نام، کد، وظیفه…" width={280} />
          <Select value={status} onChange={setStatus} placeholder="همه وضعیت‌ها"
            options={[{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیر فعال' }]} />
        </ListHead>
        <div className="card-b tight">
      {!rows ? <Spinner /> : (
        <Table head={['#', 'کد', 'نام', 'نام پدر', 'وظیفه', 'تاریخ استخدام', 'معاش ثابت', 'تماس', 'وضعیت', '']}>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td>{i + 1}</td>
              <td className="mono">{r.code}</td>
              <td><Link to={`/employees/${r.id}`} style={{ fontWeight: 600 }}>{r.name}</Link></td>
              <td className="muted hide-md">{r.fatherName}</td>
              <td>{r.position}</td>
              <td className="mono hide-sm">{formatDate(r.hireDate, calendar)}</td>
              <td className="num">{money(r.baseSalary)}</td>
              <td className="mono hide-sm">{r.phone}</td>
              <td><span className={`badge ${r.status === 'active' ? 'ok' : 'muted'}`}>{r.status === 'active' ? 'فعال' : 'غیر فعال'}</span></td>
              <td><div className="actions hover-actions">
                <Link className="btn sm" to={`/employees/${r.id}`}>پروفایل</Link>
                <button className="btn sm" onClick={() => openEdit(r)}>ویرایش</button>
                {isManager ? <button className="btn sm danger" onClick={() => remove(r)}>حذف</button> : null}
              </div></td>
            </tr>
          ))}
        </Table>
      )}
        </div>
      </div>

      {form ? (
        <Modal title={form.id ? 'ویرایش کارمند' : 'کارمند نو'} onClose={() => setForm(null)} onEnter={save}
          footer={<><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره'}</button>
            <button className="btn" onClick={() => setForm(null)}>انصراف</button></>}>
          <div className="form-grid">
            <Field label="کد کارمند" required><Text value={form.code} onChange={(v) => setForm({ ...form, code: v })} /></Field>
            <Field label="نام" required><Text value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></Field>
            <Field label="نام پدر"><Text value={form.fatherName} onChange={(v) => setForm({ ...form, fatherName: v })} /></Field>
            <Field label="وظیفه"><Text value={form.position} onChange={(v) => setForm({ ...form, position: v })} placeholder="راننده، کارگر، اپراتور…" /></Field>
            <Field label="تاریخ استخدام" hint={calendar === 'jalali' ? 'شمسی' : 'میلادی'}>
              <DatePicker value={hire} onChange={setHire} calendar={calendar} clearable />
            </Field>
            <Field label="معاش ثابت (افغانی)"><Num value={form.baseSalary} onChange={(v) => setForm({ ...form, baseSalary: v })} /></Field>
            <Field label="شماره تماس"><Text value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></Field>
            <Field label="شماره تذکره"><Text value={form.nationalId} onChange={(v) => setForm({ ...form, nationalId: v })} /></Field>
            <Field label="مدت قرارداد"><Text value={form.contractPeriod} onChange={(v) => setForm({ ...form, contractPeriod: v })} /></Field>
            <Field label="وضعیت">
              <Select value={form.status} onChange={(v) => setForm({ ...form, status: v })}
                options={[{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیر فعال' }]} />
            </Field>
            <Field label="آدرس" span={2}><Text value={form.address} onChange={(v) => setForm({ ...form, address: v })} /></Field>
            <Field label="توضیحات" span={3}><TextArea value={form.note} onChange={(v) => setForm({ ...form, note: v })} /></Field>
          </div>
        </Modal>
      ) : null}
      {importOpen ? (
        <ImportDialog types={importTypes} onClose={() => setImportOpen(false)} onDone={() => load()} />
      ) : null}
    </div>
  );
}
