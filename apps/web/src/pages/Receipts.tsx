import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadCsv } from '../lib/api';
import { useSession } from '../lib/session';
import { useDebounced } from '../lib/useDebounced';
import {
  useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, Select, Pager,
  ListHead, SearchBox, FilterButton, FilterPanel, FilterChip, InlineStat,
} from '../components/ui';
import { IconDownload, IconPlus } from '../components/icons';
import { DatePicker } from '../components/DatePicker';
import { money, todayISO, formatDate } from '../lib/calendar';

type Filters = { q: string; from: string; to: string; source: string };

export default function ReceiptsPage() {
  const { calendar, isManager } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ q: '', from: '', to: '', source: '' });
  const dq = useDebounced(filters.q);
  const [customers, setCustomers] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [dateISO, setDateISO] = useState('');
  const [busy, setBusy] = useState(false);
  const [fOpen, setFOpen] = useState(false);

  const load = async (p = page) => {
    const qs = new URLSearchParams({ page: String(p), pageSize: '25' });
    if (dq) qs.set('q', dq);
    if (filters.from) qs.set('from', filters.from);
    if (filters.to) qs.set('to', filters.to);
    if (filters.source) qs.set('source', filters.source);
    setData(await api.get(`/receipts?${qs.toString()}`));
  };
  useEffect(() => { load(page).catch((e) => toast.error('بارگذاری نشد', e.message)); }, [page, dq, filters.from, filters.to, filters.source]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get('/customers').then(setCustomers).catch(() => {});
    api.get('/lookups').then((r) => setSources(r.items.receipt_source || [])).catch(() => {});
  }, []);
  useEffect(() => { if (sp.get('new') === '1') { setSp({}, { replace: true }); openNew(); } }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<Filters>) => { setPage(1); setFilters((f) => ({ ...f, ...p })); };
  const hasFilter = Boolean(filters.q || filters.from || filters.to || filters.source);

  const openNew = async () => {
    const { no } = await api.get('/receipts/next-no');
    setForm({ no, customerId: '', amount: 0, relatedBillNo: '', sourceId: '', sourceName: 'باقی داری', receivedBy: 'دخل', note: '' });
    setDateISO(todayISO());
  };

  const save = async () => {
    if (!form.customerId) { toast.warn('مشتری را انتخاب کنید.'); return; }
    if (Number(form.amount) <= 0) { toast.warn('مبلغ رسید را وارد کنید.'); return; }
    if (!dateISO) { toast.error('تاریخ', 'تاریخ را انتخاب یا وارد کنید.'); return; }
    const src = sources.find((s) => String(s.id) === String(form.sourceId));
    setBusy(true);
    try {
      const payload = { ...form, date: dateISO, sourceName: src?.name || form.sourceName };
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

  const custOf = (id: any) => customers.find((c) => String(c.id) === String(id));
  const selectedCust = form ? custOf(form.customerId) : null;

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card">
        <ListHead
          summary={<>
            <InlineStat label="رسید" value={(data?.total ?? 0).toLocaleString('en-US')} />
            <span className="sep" />
            <InlineStat label="مجموع" value={`${money(data?.sum ?? 0)} ؋`} tone="ok" />
          </>}
          actions={<>
            <button className="btn" onClick={() => downloadCsv('receipts')}><IconDownload size={15} /> اکسل</button>
            <button className="btn primary" onClick={openNew}><IconPlus size={15} /> رسید</button>
          </>}
        >
          <SearchBox value={filters.q} onChange={(v) => patch({ q: v })} placeholder="شماره، مشتری، بل…" width={300} />
          <FilterButton count={[filters.from, filters.to, filters.source].filter(Boolean).length}
            open={fOpen} onClick={() => setFOpen((v) => !v)} />
          <FilterPanel open={fOpen} onClose={() => setFOpen(false)} footer={
            <>
              <button className="btn sm primary" onClick={() => setFOpen(false)}>اعمال</button>
              <button className="btn sm ghost" onClick={() => setFilters({ q: filters.q, from: '', to: '', source: '' })}>پاک کردن</button>
            </>
          }>
            <div className="grid c2" style={{ gap: 10 }}>
              <div className="field"><label>از تاریخ</label>
                <DatePicker value={filters.from} onChange={(v) => patch({ from: v })} calendar={calendar} clearable /></div>
              <div className="field"><label>تا تاریخ</label>
                <DatePicker value={filters.to} onChange={(v) => patch({ to: v })} calendar={calendar} clearable /></div>
            </div>
            <div className="field"><label>منبع رسید</label>
              <Select value={filters.source} onChange={(v) => patch({ source: v })} placeholder="همه منابع"
                options={sources.map((x) => ({ value: x.name, label: x.name }))} /></div>
          </FilterPanel>
        </ListHead>

        {[filters.from, filters.to, filters.source].some(Boolean) ? (
          <div className="chip-row">
            {filters.from ? <FilterChip label="از" value={formatDate(filters.from, calendar)} onClear={() => patch({ from: '' })} /> : null}
            {filters.to ? <FilterChip label="تا" value={formatDate(filters.to, calendar)} onClear={() => patch({ to: '' })} /> : null}
            {filters.source ? <FilterChip label="منبع" value={filters.source} onClear={() => patch({ source: '' })} /> : null}
          </div>
        ) : null}

        <div className="card-b tight">
          {!data ? <Spinner /> : (<>
            <Table head={['شماره', 'تاریخ', 'مشتری', 'مبلغ رسید', 'بل مربوط', 'از درک', 'توسط', 'توضیحات', '']}>
              {data.rows.map((r: any) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontWeight: 700 }}>{r.no}</td>
                  <td className="mono">{r.dateDisplay}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.customerName}</div>
                    <div className="cell-sub mono">{custOf(r.customerId)?.code || ''}</div>
                  </td>
                  <td className="num" style={{ fontWeight: 700, color: 'var(--ok)' }}>{money(r.amount)}</td>
                  <td className="mono muted-cell">{r.relatedBillNo || '—'}</td>
                  <td><span className="badge info">{r.sourceName || '—'}</span></td>
                  <td className="hide-sm">{r.receivedBy || '—'}</td>
                  <td className="small muted-cell hide-md">{r.note}</td>
                  <td><div className="actions hover-actions">
                    <button className="btn sm" onClick={() => { setForm({ ...r }); setDateISO(r.date); }}>ویرایش</button>
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
        <Modal title={form.id ? `ویرایش رسید ${form.no}` : 'رسید نو'} onClose={() => setForm(null)} size="md" footer={
          <><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره رسید'}</button>
            <button className="btn" onClick={() => setForm(null)}>انصراف</button>
            <div className="spacer" />
            {selectedCust ? <span className="small muted">باقی فعلی مشتری: <b className="mono" style={{ color: 'var(--danger)' }}>{money(selectedCust.balance)}</b></span> : null}
          </>}>
          <div className="form-grid c2">
            <Field label="شماره رسید"><Text value={form.no} onChange={(v) => setForm({ ...form, no: v })} readOnly={!!form.id} /></Field>
            <Field label="تاریخ" required><DatePicker value={dateISO} onChange={setDateISO} calendar={calendar} /></Field>
            <Field label="مشتری" required span={2}>
              <Select value={form.customerId} placeholder="انتخاب مشتری…" onChange={(v) => setForm({ ...form, customerId: v })}
                options={customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name} (باقی ${money(c.balance)})` }))} />
            </Field>
            <Field label="مبلغ رسید (افغانی)" required><Num value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field>
            <Field label="شماره بل مربوط"><Text value={form.relatedBillNo} onChange={(v) => setForm({ ...form, relatedBillNo: v })} /></Field>
            <Field label="از درک" hint="«امانت» در باقی مشتری حساب نمی‌شود.">
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
