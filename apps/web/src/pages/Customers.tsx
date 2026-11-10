import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadCsv } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, ListHead, SearchBox } from '../components/ui';
import { money } from '../lib/calendar';

export default function CustomersPage() {
  const { isManager } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setRows(await api.get(`/customers?q=${encodeURIComponent(q)}`));
  useEffect(() => { load().catch((e) => toast.error('بارگذاری نشد', e.message)); }, [q]);

  const openNew = async () => {
    const { code } = await api.get('/customers/next-code');
    setForm({ code, name: '', contactPerson: '', phone: '', truckPlate: '', openingBalance: 0, note: '' });
  };

  const save = async () => {
    if (!form.name?.trim()) { toast.warn('نام مشتری را وارد کنید.'); return; }
    setBusy(true);
    try {
      if (form.id) await api.put(`/customers/${form.id}`, form);
      else await api.post('/customers', form);
      toast.success('مشتری ذخیره شد');
      setForm(null); await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const remove = (r: any) => toast.confirm({
    title: 'حذف مشتری؟', body: `«${r.name}» حذف شود؟ اگر فروش یا رسید دارد حذف نمی‌شود.`, confirmText: 'حذف کن',
    onConfirm: async () => {
      try { await api.del(`/customers/${r.id}`); await load(); toast.success('حذف شد'); }
      catch (e: any) { toast.error('حذف نشد', e.message); }
    },
  });

  const totalDebt = (rows || []).reduce((a, r) => a + Math.max(0, Number(r.balance)), 0);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <ListHead actions={
          <>
            <span className="badge info">{(rows || []).length} مشتری</span>
            <span className="badge bad">مجموع بدهی: {money(totalDebt)}</span>
            <button className="btn" onClick={() => downloadCsv('customers')}>⤓ اکسل</button>
            <button className="btn primary" onClick={openNew}>＋ مشتری نو</button>
          </>
        }>
          <SearchBox value={q} onChange={setQ} placeholder="نام، کد، تماس، شخص رابط…" width={330} />
        </ListHead>
        <div className="card-b tight">
      {!rows ? <Spinner /> : (
        <Table head={['#', 'کد', 'نام مشتری / شخص رابط', 'تماس', 'پلیت', 'فروش قرضه', 'رسیدات', 'باقی مانده بدهی', '']}>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className="mono muted-cell">{i + 1}</td>
              <td className="mono">{r.code}</td>
              <td>
                <Link to={`/customers/${r.id}`} style={{ fontWeight: 600 }}>{r.name}</Link>
                <div className="cell-sub">{r.contactPerson || '—'}</div>
              </td>
              <td className="mono hide-sm">{r.phone || '—'}</td>
              <td className="mono hide-md">{r.truckPlate || '—'}</td>
              <td className="num">{money(r.creditSales)}</td>
              <td className="num hide-sm">{money(r.receipts)}</td>
              <td className="num" style={{ fontWeight: 800, color: r.balance > 0 ? 'var(--danger)' : r.balance < 0 ? 'var(--ok)' : 'inherit' }}>
                {money(r.balance)}
              </td>
              <td><div className="actions hover-actions">
                <Link className="btn sm" to={`/customers/${r.id}`}>کارت حساب</Link>
                <button className="btn sm" onClick={() => setForm({ ...r })}>ویرایش</button>
                {isManager ? <button className="btn sm danger" onClick={() => remove(r)}>حذف</button> : null}
              </div></td>
            </tr>
          ))}
        </Table>
      )}
        </div>
      </div>

      {form ? (
        <Modal title={form.id ? 'ویرایش مشتری' : 'مشتری نو'} onClose={() => setForm(null)} size="md" footer={
          <><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره'}</button>
            <button className="btn" onClick={() => setForm(null)}>انصراف</button></>}>
          <div className="form-grid c2">
            <Field label="کد مشتری" required><Text value={form.code} onChange={(v) => setForm({ ...form, code: v })} /></Field>
            <Field label="نام مشتری / شرکت" required><Text value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></Field>
            <Field label="شخص رابط"><Text value={form.contactPerson} onChange={(v) => setForm({ ...form, contactPerson: v })} /></Field>
            <Field label="شماره تماس"><Text value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></Field>
            <Field label="پلیت موتر"><Text value={form.truckPlate} onChange={(v) => setForm({ ...form, truckPlate: v })} /></Field>
            <Field label="بدهی اولیه (افغانی)" hint="باقی مانده قبلی از سیستم قدیم">
              <Num value={form.openingBalance} onChange={(v) => setForm({ ...form, openingBalance: v })} />
            </Field>
            <Field label="توضیحات" span={2}><TextArea value={form.note} onChange={(v) => setForm({ ...form, note: v })} /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
