import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadCsv } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, Select, Pager } from '../components/ui';
import { money, toInputDate, parseInputDate, todayISO } from '../lib/calendar';

export default function ExpensesPage() {
  const { calendar, isManager } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', from: '', to: '', category: '', payer: '', paymentType: '' });
  const [lk, setLk] = useState<any>({ expense_category: [], payer: [], contractor: [] });
  const [form, setForm] = useState<any>(null);
  const [dateStr, setDateStr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (p = page) => {
    const qs = new URLSearchParams({ page: String(p), pageSize: '25' });
    Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v as string); });
    setData(await api.get(`/expenses?${qs.toString()}`));
  };
  useEffect(() => { load(page).catch((e) => toast.error('بارگذاری نشد', e.message)); }, [page, filters]);
  useEffect(() => { api.get('/lookups').then((r) => setLk(r.items)).catch(() => {}); }, []);
  useEffect(() => { if (sp.get('new') === '1') { setSp({}); openNew(); } }, [sp]);

  const openNew = async () => {
    const { no } = await api.get('/expenses/next-no');
    setForm({ no, description: '', categoryId: '', purchaseBillNo: '', shopName: '', amountAfn: 0, amountUsd: 0, payerId: '', payerName: 'دخل', contractorId: '', paymentType: 'cash', note: '' });
    setDateStr(toInputDate(todayISO(), calendar));
  };

  const save = async () => {
    if (!Number(form.amountAfn) && !Number(form.amountUsd)) { toast.warn('مبلغ افغانی یا دالری را وارد کنید.'); return; }
    let date = '';
    try { date = parseInputDate(dateStr, calendar); } catch (e: any) { toast.error('تاریخ', e.message); return; }
    setBusy(true);
    try {
      const payload = {
        ...form, date,
        categoryName: lk.expense_category?.find((x: any) => String(x.id) === String(form.categoryId))?.name || '',
        payerName: lk.payer?.find((x: any) => String(x.id) === String(form.payerId))?.name || form.payerName,
        contractorName: lk.contractor?.find((x: any) => String(x.id) === String(form.contractorId))?.name || '',
      };
      if (form.id) await api.put(`/expenses/${form.id}`, payload);
      else await api.post('/expenses', payload);
      toast.success('مصرف ذخیره شد', form.no);
      setForm(null); await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const remove = (r: any) => toast.confirm({
    title: 'حذف مصرف؟', body: `سند ${r.no} — ${r.description || r.categoryName} به مبلغ ${money(r.amountAfn)} افغانی حذف شود؟`,
    confirmText: 'حذف کن',
    onConfirm: async () => { try { await api.del(`/expenses/${r.id}`); await load(); toast.success('حذف شد'); } catch (e: any) { toast.error('حذف نشد', e.message); } },
  });

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card"><div className="card-b"><div className="toolbar">
        <Field label="جستجو"><input className="input" style={{ width: 190 }} value={filters.q} onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} placeholder="شرح، فروشگاه، بل…" /></Field>
        <Field label="از تاریخ"><input className="input mono" style={{ width: 130 }} value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }); }} placeholder="۱۴۰۴/۰۵/۰۱" /></Field>
        <Field label="تا تاریخ"><input className="input mono" style={{ width: 130 }} value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }); }} placeholder="۱۴۰۴/۰۵/۳۱" /></Field>
        <Field label="نوع مصرف"><Select value={filters.category} onChange={(v) => { setPage(1); setFilters({ ...filters, category: v }); }} placeholder="همه"
          options={(lk.expense_category || []).map((c: any) => ({ value: c.name, label: c.name }))} /></Field>
        <Field label="پرداخت‌کننده"><Select value={filters.payer} onChange={(v) => { setPage(1); setFilters({ ...filters, payer: v }); }} placeholder="همه"
          options={(lk.payer || []).map((c: any) => ({ value: c.name, label: c.name }))} /></Field>
        <Field label="روش پرداخت"><Select value={filters.paymentType} onChange={(v) => { setPage(1); setFilters({ ...filters, paymentType: v }); }} placeholder="همه"
          options={[{ value: 'cash', label: 'نقده' }, { value: 'credit', label: 'باقی' }]} /></Field>
        <div className="spacer" />
        <button className="btn" onClick={() => downloadCsv('expenses')}>⤓ اکسل</button>
        <button className="btn primary" onClick={openNew}>＋ مصرف نو</button>
      </div></div></div>

      <div className="row wrap">
        <span className="badge info">{data?.total ?? 0} سند</span>
        <span className="badge bad">مجموع افغانی: {money(data?.sumAfn ?? 0)}</span>
        <span className="badge warn">مجموع دالری: ${money(data?.sumUsd ?? 0)}</span>
        <span className="small muted">مبلغ دالری به افغانی تبدیل نمی‌شود و در سود/زیان حساب نمی‌شود.</span>
      </div>

      {!data ? <Spinner /> : (<>
        <Table head={['شماره', 'تاریخ', 'شرح', 'نوع مصرف', 'مربوط', 'نمبر بل', 'فروشگاه', 'افغانی', 'دالری', 'پرداخت‌کننده', 'روش', '']}>
          {data.rows.map((r: any) => (
            <tr key={r.id}>
              <td className="mono" style={{ fontWeight: 700 }}>{r.no}</td>
              <td className="mono">{r.dateDisplay}</td>
              <td>{r.description}</td>
              <td>{r.categoryName}</td>
              <td className="small muted">{r.contractorName}</td>
              <td className="mono small">{r.purchaseBillNo}</td>
              <td>{r.shopName}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(r.amountAfn)}</td>
              <td className="num">{r.amountUsd ? `$${money(r.amountUsd)}` : '—'}</td>
              <td>{r.payerName}</td>
              <td><span className={`badge ${r.paymentType === 'cash' ? 'ok' : 'warn'}`}>{r.paymentType === 'cash' ? 'نقده' : 'باقی'}</span></td>
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
        <Modal title={form.id ? `ویرایش مصرف ${form.no}` : 'مصرف نو'} onClose={() => setForm(null)} footer={
          <><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره مصرف'}</button>
            <button className="btn" onClick={() => setForm(null)}>انصراف</button></>}>
          <div className="form-grid">
            <Field label="شماره سند"><Text value={form.no} onChange={(v) => setForm({ ...form, no: v })} readOnly={!!form.id} /></Field>
            <Field label="تاریخ" required><Text value={dateStr} onChange={setDateStr} /></Field>
            <Field label="نوع مصرف">
              <Select value={form.categoryId} placeholder="انتخاب…" onChange={(v) => setForm({ ...form, categoryId: v })}
                options={(lk.expense_category || []).map((c: any) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="شرح" span={3}><Text value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="توضیح کوتاه مصرف" /></Field>
            <Field label="مربوط (باربری / شخص)">
              <Select value={form.contractorId} placeholder="بدون" onChange={(v) => setForm({ ...form, contractorId: v })}
                options={(lk.contractor || []).map((c: any) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="نمبر بل خرید"><Text value={form.purchaseBillNo} onChange={(v) => setForm({ ...form, purchaseBillNo: v })} /></Field>
            <Field label="نام فروشگاه / از دوکان"><Text value={form.shopName} onChange={(v) => setForm({ ...form, shopName: v })} /></Field>
            <Field label="مبلغ افغانی"><Num value={form.amountAfn} onChange={(v) => setForm({ ...form, amountAfn: v })} /></Field>
            <Field label="مبلغ دالری"><Num value={form.amountUsd} onChange={(v) => setForm({ ...form, amountUsd: v })} /></Field>
            <Field label="پرداخت‌کننده">
              <Select value={form.payerId} placeholder="انتخاب…" onChange={(v) => setForm({ ...form, payerId: v })}
                options={(lk.payer || []).map((c: any) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="روش پرداخت">
              <Select value={form.paymentType} onChange={(v) => setForm({ ...form, paymentType: v })}
                options={[{ value: 'cash', label: 'نقده' }, { value: 'credit', label: 'باقی' }]} />
            </Field>
            <Field label="توضیحات" span={2}><TextArea value={form.note} onChange={(v) => setForm({ ...form, note: v })} /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
