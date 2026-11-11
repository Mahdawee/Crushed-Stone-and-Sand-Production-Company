import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useDebounced } from '../lib/useDebounced';
import { useLatestRequest } from '../lib/useLatestRequest';
import {
  useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, Select, Pager,
  ListHead, SearchBox, FilterButton, FilterPanel, FilterChip, InlineStat,
  ExportButton,
} from '../components/ui';
import { IconPlus } from '../components/icons';
import { DatePicker } from '../components/DatePicker';
import { money, todayISO, formatDate } from '../lib/calendar';
import { pageAfterRemove } from '../lib/paging';

type Filters = { q: string; from: string; to: string; category: string; payer: string; paymentType: string };

export default function ExpensesPage() {
  const { calendar, isManager } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ q: '', from: '', to: '', category: '', payer: '', paymentType: '' });
  const dq = useDebounced(filters.q);
  const [lk, setLk] = useState<any>({ expense_category: [], payer: [], contractor: [] });
  const [form, setForm] = useState<any>(null);
  const [dateISO, setDateISO] = useState('');
  const [busy, setBusy] = useState(false);
  const [fOpen, setFOpen] = useState(false);

  const latest = useLatestRequest();
  const load = async (p = page) => {
    const qs = new URLSearchParams({ page: String(p), pageSize: '25' });
    if (dq) qs.set('q', dq);
    if (filters.from) qs.set('from', filters.from);
    if (filters.to) qs.set('to', filters.to);
    if (filters.category) qs.set('category', filters.category);
    if (filters.payer) qs.set('payer', filters.payer);
    if (filters.paymentType) qs.set('paymentType', filters.paymentType);
    /* فقط آخرین پاسخ روی جدول می‌نشیند — وگرنه پاسخ کندِ جستجوی قبلی
       می‌تواند نتیجه‌ی تازه را بازنویسی کند. */
    await latest(() => api.get(`/expenses?${qs.toString()}`), setData);
  };
  useEffect(() => { load(page).catch((e) => toast.error('بارگذاری نشد', e.message)); }, [page, dq, filters.from, filters.to, filters.category, filters.payer, filters.paymentType]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/lookups').then((r) => setLk(r.items)).catch(() => {}); }, []);
  useEffect(() => { if (sp.get('new') === '1') { setSp({}, { replace: true }); openNew(); } }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<Filters>) => { setPage(1); setFilters((f) => ({ ...f, ...p })); };
  const hasFilter = Boolean(filters.q || filters.from || filters.to || filters.category || filters.payer || filters.paymentType);

  const openNew = async () => {
    const { no } = await api.get('/expenses/next-no');
    setForm({ no, description: '', categoryId: '', purchaseBillNo: '', shopName: '', amountAfn: 0, amountUsd: 0, payerId: '', payerName: 'دخل', contractorId: '', paymentType: 'cash', note: '' });
    setDateISO(todayISO());
  };
  const openEdit = (r: any) => {
    setForm({
      ...r,
      categoryId: r.categoryId ?? (lk.expense_category || []).find((c: any) => c.name === r.categoryName)?.id ?? '',
      payerId: r.payerId ?? (lk.payer || []).find((c: any) => c.name === r.payerName)?.id ?? '',
      contractorId: r.contractorId ?? (lk.contractor || []).find((c: any) => c.name === r.contractorName)?.id ?? '',
    });
    setDateISO(r.date);
  };

  const save = async () => {
    if (!Number(form.amountAfn) && !Number(form.amountUsd)) { toast.warn('مبلغ افغانی یا دالری را وارد کنید.'); return; }
    if (!dateISO) { toast.error('تاریخ', 'تاریخ را انتخاب یا وارد کنید.'); return; }
    setBusy(true);
    try {
      const payload = {
        ...form, date: dateISO,
        categoryName: lk.expense_category?.find((x: any) => String(x.id) === String(form.categoryId))?.name || '',
        payerName: lk.payer?.find((x: any) => String(x.id) === String(form.payerId))?.name || form.payerName || '',
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
    title: 'حذف مصرف؟', body: `سند ${r.no} — ${r.description || r.categoryName} به مبلغ ${money(r.amountAfn)} افغانی از فهرست کنار می‌رود.\nداده پاک نمی‌شود — از «سطل بازیافت» قابل بازگرداندن است.`,
    confirmText: 'حذف کن',
    onConfirm: async () => {
      try {
        await api.del(`/expenses/${r.id}`);
        /* صفحه‌ی خالی بعد از حذف → یک صفحه عقب */
        const p = pageAfterRemove(page, data?.pageSize || 25, data?.total || 0);
        if (p !== page) setPage(p); else await load();
        toast.success('حذف شد');
      } catch (e: any) { toast.error('حذف نشد', e.message); }
    },
  });

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card">
        <ListHead
          summary={<>
            <InlineStat label="سند" value={(data?.total ?? 0).toLocaleString('en-US')} />
            <span className="sep" />
            <InlineStat label="افغانی" value={money(data?.sumAfn ?? 0)} tone="bad" />
            {data?.sumUsd ? <><span className="sep" /><InlineStat label="دالری" value={`$${money(data.sumUsd)}`} tone="warn" /></> : null}
          </>}
          actions={<>
            <ExportButton type="expenses" />
            <button className="btn primary" onClick={openNew}><IconPlus size={15} /> مصرف</button>
          </>}
        >
          <SearchBox value={filters.q} onChange={(v) => patch({ q: v })} placeholder="شرح، فروشگاه، بل…" width={280} />
          <FilterButton count={[filters.from, filters.to, filters.category, filters.payer, filters.paymentType].filter(Boolean).length}
            open={fOpen} onClick={() => setFOpen((v) => !v)} />
          <FilterPanel open={fOpen} onClose={() => setFOpen(false)} footer={
            <>
              <button className="btn sm primary" onClick={() => setFOpen(false)}>اعمال</button>
              <button className="btn sm ghost" onClick={() => setFilters({ q: filters.q, from: '', to: '', category: '', payer: '', paymentType: '' })}>پاک کردن</button>
            </>
          }>
            <div className="grid c2" style={{ gap: 10 }}>
              <div className="field"><label>از تاریخ</label>
                <DatePicker value={filters.from} onChange={(v) => patch({ from: v })} calendar={calendar} clearable /></div>
              <div className="field"><label>تا تاریخ</label>
                <DatePicker value={filters.to} onChange={(v) => patch({ to: v })} calendar={calendar} clearable /></div>
            </div>
            <div className="field"><label>نوع مصرف</label>
              <Select value={filters.category} onChange={(v) => patch({ category: v })} placeholder="همه انواع"
                options={(lk.expense_category || []).map((c: any) => ({ value: c.name, label: c.name }))} /></div>
            <div className="field"><label>پرداخت‌کننده</label>
              <Select value={filters.payer} onChange={(v) => patch({ payer: v })} placeholder="همه"
                options={(lk.payer || []).map((c: any) => ({ value: c.name, label: c.name }))} /></div>
            <div className="field"><label>روش پرداخت</label>
              <Select value={filters.paymentType} onChange={(v) => patch({ paymentType: v })} placeholder="همه"
                options={[{ value: 'cash', label: 'نقده' }, { value: 'credit', label: 'باقی' }]} /></div>
          </FilterPanel>
        </ListHead>

        {[filters.from, filters.to, filters.category, filters.payer, filters.paymentType].some(Boolean) ? (
          <div className="chip-row">
            {filters.from ? <FilterChip label="از" value={formatDate(filters.from, calendar)} onClear={() => patch({ from: '' })} /> : null}
            {filters.to ? <FilterChip label="تا" value={formatDate(filters.to, calendar)} onClear={() => patch({ to: '' })} /> : null}
            {filters.category ? <FilterChip label="نوع" value={filters.category} onClear={() => patch({ category: '' })} /> : null}
            {filters.payer ? <FilterChip label="پرداخت‌کننده" value={filters.payer} onClear={() => patch({ payer: '' })} /> : null}
            {filters.paymentType ? <FilterChip label="روش" value={filters.paymentType === 'cash' ? 'نقده' : 'باقی'} onClear={() => patch({ paymentType: '' })} /> : null}
          </div>
        ) : null}

        <div className="card-b tight">
          {!data ? <Spinner /> : (<>
            <Table head={['شماره', 'تاریخ', 'شرح', 'نوع', 'مربوط (شاخه مصرف)', 'فروشگاه', 'افغانی', 'دالری', 'پرداخت‌کننده', 'روش', '']}>
              {data.rows.map((r: any) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontWeight: 700 }}>{r.no}</td>
                  <td className="mono">{r.dateDisplay}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.description || '—'}</div>
                    {r.purchaseBillNo ? <div className="cell-sub mono">بل {r.purchaseBillNo}</div> : null}
                  </td>
                  <td>{r.categoryName || '—'}</td>
                  <td className="small muted-cell hide-md">{r.contractorName || '—'}</td>
                  <td className="hide-sm">{r.shopName || '—'}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(r.amountAfn)}</td>
                  <td className="num muted-cell hide-sm">{r.amountUsd ? `$${money(r.amountUsd)}` : '—'}</td>
                  <td className="hide-md">{r.payerName || '—'}</td>
                  <td><span className={`badge ${r.paymentType === 'cash' ? 'ok' : 'warn'}`}>{r.paymentType === 'cash' ? 'نقده' : 'باقی'}</span></td>
                  <td><div className="actions hover-actions">
                    <button className="btn sm" onClick={() => openEdit(r)}>ویرایش</button>
                    {isManager ? <button className="btn sm danger" onClick={() => remove(r)}>حذف</button> : null}
                  </div></td>
                </tr>
              ))}
            </Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>)}
        </div>
      </div>

      {form ? (
        <Modal title={form.id ? `ویرایش مصرف ${form.no}` : 'مصرف نو'} onClose={() => setForm(null)} onEnter={save} footer={
          <><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره مصرف'}</button>
            <button className="btn" onClick={() => setForm(null)}>انصراف</button></>}>
          <div className="form-grid">
            <Field label="شماره سند" hint={form.id ? 'قابل ویرایش — اگر تکراری باشد ذخیره نمی‌شود' : undefined}><Text value={form.no} onChange={(v) => setForm({ ...form, no: v })} /></Field>
            <Field label="تاریخ" required><DatePicker value={dateISO} onChange={setDateISO} calendar={calendar} /></Field>
            <Field label="نوع مصرف">
              <Select value={form.categoryId} placeholder="انتخاب…" onChange={(v) => setForm({ ...form, categoryId: v })}
                options={(lk.expense_category || []).map((c: any) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="شرح" span={3}><Text value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="توضیح کوتاه مصرف" /></Field>
            {/* همان مفهوم «مربوط» در فروشات — شاخه‌ی مصرف */}
            <Field label="مربوط (شاخه مصرف)" hint="باربری / دمترک / شخصی که این مصرف به آن تعلق دارد">
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
