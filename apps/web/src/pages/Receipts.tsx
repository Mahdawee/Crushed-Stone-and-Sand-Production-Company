import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadCsv } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, Select, Pager } from '../components/ui';
import { money, toInputDate, parseInputDate, todayISO } from '../lib/calendar';

export default function ReceiptsPage() {
  const { calendar, isManager } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', from: '', to: '', source: '' });
  const [customers, setCustomers] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [dateStr, setDateStr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (p = page) => {
    const qs = new URLSearchParams({ page: String(p), pageSize: '25' });
    Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v as string); });
    setData(await api.get(`/receipts?${qs.toString()}`));
  };
  useEffect(() => { load(page).catch((e) => toast.error('بارگذاری نشد', e.message)); }, [page, filters]);
  useEffect(() => {
    api.get('/customers').then(setCustomers).catch(() => {});
    api.get('/lookups').then((r) => setSources(r.items.receipt_source || [])).catch(() => {});
  }, []);
  useEffect(() => { if (sp.get('new') === '1') { setSp({}); openNew(); } }, [sp]);

  const openNew = async () => {
    const { no } = await api.get('/receipts/next-no');
    setForm({ no, customerId: '', amount: 0, relatedBillNo: '', sourceId: '', sourceName: 'باقی داری', receivedBy: 'دخل', note: '' });
    setDateStr(toInputDate(todayISO(), calendar));
  };

  const save = async () => {
    if (!form.customerId) { toast.warn('مشتری را انتخاب کنید.'); return; }
    if (Number(form.amount) <= 0) { toast.warn('مبلغ رسید را وارد کنید.'); return; }
    let date = '';
    try { date = parseInputDate(dateStr, calendar); } catch (e: any) { toast.error('تاریخ', e.message); return; }
    const src = sources.find((s) => String(s.id) === String(form.sourceId));
    setBusy(true);
    try {
      const payload = { ...form, date, sourceName: src?.name || form.sourceName };
      if (form.id) await api.put(`/receipts/${form.id}`, payload);
      else await api.post('/receipts', payload);
      toast.success('رسید ذخیره شد', form.no);
      setForm(null); await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const remove = (r: any) => toast.confirm({
    title: 'حذف رسید؟', body: `رسید ${r.no} به مبلغ ${money(r.amount)} حذف شود؟`, confirmText: 'حذف کن',
    onConfirm: async () => { try { await api.del(`/receipts/${r.id}`); await load(); toast.success('حذف شد'); } catch (e: any) { toast.error('حذف نشد', e.message); } },
  });

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card"><div className="card-b"><div className="toolbar">
        <Field label="جستجو"><input className="input" style={{ width: 200 }} value={filters.q} onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} placeholder="شماره، مشتری، بل…" /></Field>
        <Field label="از تاریخ"><input className="input mono" style={{ width: 130 }} value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }); }} placeholder="۱۴۰۴/۰۵/۰۱" /></Field>
        <Field label="تا تاریخ"><input className="input mono" style={{ width: 130 }} value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }); }} placeholder="۱۴۰۴/۰۵/۳۱" /></Field>
        <Field label="از درک"><Select value={filters.source} onChange={(v) => { setPage(1); setFilters({ ...filters, source: v }); }} placeholder="همه"
          options={sources.map((s) => ({ value: s.name, label: s.name }))} /></Field>
        <div className="spacer" />
        <button className="btn" onClick={() => downloadCsv('receipts')}>⤓ اکسل</button>
        <button className="btn primary" onClick={openNew}>＋ رسید نو</button>
      </div></div></div>

      <div className="row wrap">
        <span className="badge info">{data?.total ?? 0} رسید</span>
        <span className="badge ok">مجموع: {money(data?.sum ?? 0)} افغانی</span>
      </div>

      {!data ? <Spinner /> : (<>
        <Table head={['شماره', 'تاریخ', 'کد مشتری', 'نام مشتری', 'مبلغ رسید', 'بل مربوط', 'از درک', 'توسط', 'توضیحات', '']}>
          {data.rows.map((r: any) => (
            <tr key={r.id}>
              <td className="mono" style={{ fontWeight: 700 }}>{r.no}</td>
              <td className="mono">{r.dateDisplay}</td>
              <td className="mono">{customers.find((c) => c.id === r.customerId)?.code || '—'}</td>
              <td>{r.customerName}</td>
              <td className="num" style={{ fontWeight: 700, color: 'var(--ok)' }}>{money(r.amount)}</td>
              <td className="mono">{r.relatedBillNo || '—'}</td>
              <td><span className="badge info">{r.sourceName || '—'}</span></td>
              <td>{r.receivedBy}</td>
              <td className="small muted">{r.note}</td>
              <td><div className="actions">
                <button className="btn sm" onClick={() => { setForm({ ...r }); setDateStr(toInputDate(r.date, calendar)); }}>ویرایش</button>
                {isManager ? <button className="btn sm danger" onClick={() => remove(r)}>حذف</button> : null}
              </div></td>
            </tr>
          ))}
        </Table>
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
      </>)}

      {form ? (
        <Modal title={form.id ? `ویرایش رسید ${form.no}` : 'رسید نو'} onClose={() => setForm(null)} size="md" footer={
          <><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره رسید'}</button>
            <button className="btn" onClick={() => setForm(null)}>انصراف</button></>}>
          <div className="form-grid c2">
            <Field label="شماره رسید"><Text value={form.no} onChange={(v) => setForm({ ...form, no: v })} readOnly={!!form.id} /></Field>
            <Field label="تاریخ" required><Text value={dateStr} onChange={setDateStr} /></Field>
            <Field label="مشتری" required span={2}>
              <Select value={form.customerId} placeholder="انتخاب مشتری…" onChange={(v) => setForm({ ...form, customerId: v })}
                options={customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name} (باقی ${money(c.balance)})` }))} />
            </Field>
            <Field label="مبلغ رسید (افغانی)" required><Num value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field>
            <Field label="شماره بل مربوط"><Text value={form.relatedBillNo} onChange={(v) => setForm({ ...form, relatedBillNo: v })} /></Field>
            <Field label="از درک">
              <Select value={form.sourceId} onChange={(v) => setForm({ ...form, sourceId: v })} placeholder="انتخاب…"
                options={sources.map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
            <Field label="توسط"><Text value={form.receivedBy} onChange={(v) => setForm({ ...form, receivedBy: v })} placeholder="دخل، احمد…" /></Field>
            <Field label="شرح" span={2}><TextArea value={form.note} onChange={(v) => setForm({ ...form, note: v })} /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
