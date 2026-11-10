import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, downloadCsv } from '../lib/api';
import { useSession } from '../lib/session';
import { useDebounced } from '../lib/useDebounced';
import {
  useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, Select, Pager,
  ListHead, SearchBox, FilterButton, FilterPanel, FilterChip, InlineStat,
} from '../components/ui';
import { IconDownload, IconPlus } from '../components/icons';
import { DatePicker } from '../components/DatePicker';
import { money, num, todayISO, formatDate, addDaysISO } from '../lib/calendar';

type Filters = { q: string; from: string; to: string; paymentType: string; material: string };

export default function SalesPage() {
  const { calendar, isManager } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ q: '', from: '', to: '', paymentType: '', material: '' });
  const dq = useDebounced(filters.q);
  const [lookups, setLookups] = useState<any>({ material: [], contractor: [] });
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [dateISO, setDateISO] = useState('');
  const [busy, setBusy] = useState(false);
  const [fOpen, setFOpen] = useState(false);

  const load = async (p = page) => {
    const qs = new URLSearchParams({ page: String(p), pageSize: '25' });
    if (dq) qs.set('q', dq);
    if (filters.from) qs.set('from', filters.from);
    if (filters.to) qs.set('to', filters.to);
    if (filters.paymentType) qs.set('paymentType', filters.paymentType);
    if (filters.material) qs.set('material', filters.material);
    setData(await api.get(`/sales?${qs.toString()}`));
  };
  useEffect(() => { load(page).catch((e) => toast.error('بارگذاری نشد', e.message)); }, [page, dq, filters.from, filters.to, filters.paymentType, filters.material]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get('/lookups').then((r) => setLookups(r.items)).catch(() => {});
    api.get('/customers').then(setCustomers).catch(() => {});
  }, []);
  useEffect(() => {
    if (sp.get('new') === '1') { setSp({}, { replace: true }); openNew(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const patch = (p: Partial<Filters>) => { setPage(1); setFilters((f) => ({ ...f, ...p })); };
  const hasFilter = Boolean(filters.q || filters.from || filters.to || filters.paymentType || filters.material);

  const openNew = async () => {
    const { no } = await api.get('/sales/next-no');
    setForm({
      no, customerId: '', driverName: '', truckPlate: '', destination: '', materialId: '', materialName: '',
      volume: 0, unitPrice: 0, freightPerUnit: 0, contractorId: '', contractorName: '', paymentType: 'cash', note: '',
    });
    setDateISO(todayISO());
  };

  const openEdit = (r: any) => { setForm({ ...r }); setDateISO(r.date); };

  const calc = useMemo(() => {
    if (!form) return { freightTotal: 0, total: 0 };
    const v = num(form.volume), p = num(form.unitPrice), f = num(form.freightPerUnit);
    const freightTotal = Math.round(v * f * 100) / 100;
    return { freightTotal, total: Math.round((v * p + freightTotal) * 100) / 100 };
  }, [form]);

  const save = async () => {
    if (!form.customerId) { toast.warn('مشتری را انتخاب کنید.'); return; }
    if (!dateISO) { toast.error('تاریخ بل', 'تاریخ را انتخاب یا وارد کنید.'); return; }
    const cust = customers.find((c) => String(c.id) === String(form.customerId));
    setBusy(true);
    try {
      const payload = {
        ...form, date: dateISO, customerName: cust?.name || form.customerName,
        materialName: form.materialId ? (lookups.material.find((m: any) => String(m.id) === String(form.materialId))?.name || form.materialName) : form.materialName,
        contractorName: form.contractorId ? (lookups.contractor.find((m: any) => String(m.id) === String(form.contractorId))?.name || '') : '',
      };
      if (form.id) await api.put(`/sales/${form.id}`, payload);
      else await api.post('/sales', payload);
      toast.success('بل فروش ذخیره شد', form.no);
      setForm(null); await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const remove = (r: any) => toast.confirm({
    title: 'حذف بل فروش؟', body: `بل ${r.no} برای «${r.customerName}» به مبلغ ${money(r.total)} افغانی حذف شود؟`,
    confirmText: 'حذف کن',
    onConfirm: async () => {
      try { await api.del(`/sales/${r.id}`); await load(); toast.success('حذف شد'); }
      catch (e: any) { toast.error('حذف نشد', e.message); }
    },
  });

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card">
        <ListHead
          summary={<>
            <InlineStat label="بل" value={(data?.total ?? 0).toLocaleString('en-US')} />
            <span className="sep" />
            <InlineStat label="مجموع" value={`${money(data?.sum ?? 0)} ؋`} />
            {data?.volumeSum ? <><span className="sep" /><InlineStat label="متراژ" value={`${money(data.volumeSum)} م³`} /></> : null}
          </>}
          actions={<>
            <button className="btn" onClick={() => downloadCsv('sales')} title="خروجی اکسل"><IconDownload size={15} /> اکسل</button>
            <button className="btn primary" onClick={openNew}><IconPlus size={15} /> بل فروش</button>
          </>}
        >
          <SearchBox value={filters.q} onChange={(v) => patch({ q: v })} placeholder="بل، مشتری، دریور، پلیت…" width={320} />
          <FilterButton count={[filters.from, filters.to, filters.material, filters.paymentType].filter(Boolean).length}
            open={fOpen} onClick={() => setFOpen((v) => !v)} />
          <FilterPanel open={fOpen} onClose={() => setFOpen(false)} footer={
            <>
              <button className="btn sm primary" onClick={() => setFOpen(false)}>اعمال</button>
              <button className="btn sm ghost" onClick={() => setFilters({ q: filters.q, from: '', to: '', paymentType: '', material: '' })}>پاک کردن</button>
            </>
          }>
            <div className="grid c2" style={{ gap: 10 }}>
              <div className="field"><label>از تاریخ</label>
                <DatePicker value={filters.from} onChange={(v) => patch({ from: v })} calendar={calendar} clearable /></div>
              <div className="field"><label>تا تاریخ</label>
                <DatePicker value={filters.to} onChange={(v) => patch({ to: v })} calendar={calendar} clearable /></div>
            </div>
            <div className="field"><label>نوع مواد</label>
              <Select value={filters.material} onChange={(v) => patch({ material: v })} placeholder="همه مواد"
                options={(lookups.material || []).map((m: any) => ({ value: m.name, label: m.name }))} /></div>
            <div className="field"><label>نوع پرداخت</label>
              <Select value={filters.paymentType} onChange={(v) => patch({ paymentType: v })} placeholder="همه"
                options={[{ value: 'cash', label: 'نقده' }, { value: 'credit', label: 'باقی' }]} /></div>
          </FilterPanel>
        </ListHead>

        {[filters.from || filters.to || filters.material || filters.paymentType].some(Boolean) ? (
          <div className="chip-row">
            {filters.from ? <FilterChip label="از" value={formatDate(filters.from, calendar)} onClear={() => patch({ from: '' })} /> : null}
            {filters.to ? <FilterChip label="تا" value={formatDate(filters.to, calendar)} onClear={() => patch({ to: '' })} /> : null}
            {filters.material ? <FilterChip label="مواد" value={filters.material} onClear={() => patch({ material: '' })} /> : null}
            {filters.paymentType ? <FilterChip label="پرداخت" value={filters.paymentType === 'cash' ? 'نقده' : 'باقی'} onClear={() => patch({ paymentType: '' })} /> : null}
          </div>
        ) : null}

        <div className="card-b tight">
          {!data ? <Spinner /> : (
            <>
              <Table head={['شماره', 'تاریخ', 'مشتری', 'دریور / پلیت', 'مواد', 'متراژ', 'فی متر', 'کرایه', 'مجموع', 'پرداخت', '']}>
                {data.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontWeight: 700 }}>{r.no}</td>
                    <td className="mono">{r.dateDisplay}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.customerName}</div>
                      {r.destination ? <div className="cell-sub">{r.destination}</div> : null}
                    </td>
                    <td>
                      <div>{r.driverName || '—'}</div>
                      <div className="cell-sub mono">{r.truckPlate}</div>
                    </td>
                    <td>{r.materialName || '—'}</td>
                    <td className="num">{money(r.volume)}</td>
                    <td className="num muted-cell hide-sm">{money(r.unitPrice)}</td>
                    <td className="num muted-cell hide-md">{r.freightPerUnit ? money(r.freightPerUnit) : '—'}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td>
                    <td><span className={`badge ${r.paymentType === 'cash' ? 'ok' : 'warn'}`}>{r.paymentType === 'cash' ? 'نقده' : 'باقی'}</span></td>
                    <td>
                      <div className="actions hover-actions">
                        <Link className="btn sm icon" to={`/print/sale/${r.id}`} title="چاپ بل">چاپ</Link>
                        <button className="btn sm" onClick={() => openEdit(r)}>ویرایش</button>
                        {isManager ? <button className="btn sm danger" onClick={() => remove(r)}>حذف</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
              <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )}
        </div>
      </div>

      {form ? (
        <Modal title={form.id ? `ویرایش بل ${form.no}` : 'بل فروش نو'} onClose={() => setForm(null)} footer={
          <>
            <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره بل فروش'}</button>
            <button className="btn" onClick={() => setForm(null)}>انصراف</button>
            <div className="spacer" />
            <div className="row" style={{ gap: 16 }}>
              <span className="small muted">کرایه: <b className="mono">{money(calc.freightTotal)}</b></span>
              <span className="small">مجموع بل: <b className="mono" style={{ fontSize: '1.05rem', color: 'var(--accent)' }}>{money(calc.total)}</b></span>
            </div>
          </>
        }>
          <div className="form-grid">
            <Field label="شماره بل"><Text value={form.no} onChange={(v) => setForm({ ...form, no: v })} readOnly={!!form.id} /></Field>
            <Field label="تاریخ" required hint={calendar === 'jalali' ? 'شمسی' : 'میلادی'}>
              <DatePicker value={dateISO} onChange={setDateISO} calendar={calendar} />
            </Field>
            <Field label="مشتری" required>
              <Select value={form.customerId} placeholder="انتخاب مشتری…" onChange={(v) => {
                const c = customers.find((x) => String(x.id) === String(v));
                setForm({ ...form, customerId: v, truckPlate: c?.truckPlate || form.truckPlate });
              }} options={customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
            </Field>
            <Field label="نام دریور"><Text value={form.driverName} onChange={(v) => setForm({ ...form, driverName: v })} /></Field>
            <Field label="پلیت موتر"><Text value={form.truckPlate} onChange={(v) => setForm({ ...form, truckPlate: v })} /></Field>
            <Field label="مقصد"><Text value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} placeholder="پروژه، ولسوالی، ناحیه…" /></Field>
            <Field label="نوع مواد">
              <Select value={form.materialId} placeholder="انتخاب مواد…" onChange={(v) => setForm({ ...form, materialId: v })}
                options={(lookups.material || []).map((m: any) => ({ value: m.id, label: m.name }))} />
            </Field>
            <Field label="متراژ (متر مکعب)" required><Num value={form.volume} onChange={(v) => setForm({ ...form, volume: v })} /></Field>
            <Field label="قیمت فی متر (افغانی)"><Num value={form.unitPrice} onChange={(v) => setForm({ ...form, unitPrice: v })} /></Field>
            <Field label="کرایه فی متر"><Num value={form.freightPerUnit} onChange={(v) => setForm({ ...form, freightPerUnit: v })} /></Field>
            <Field label="مجموع کرایه (خودکار)"><div className="computed">{money(calc.freightTotal)}</div></Field>
            <Field label="مجموع قیمت و کرایه (خودکار)"><div className="computed">{money(calc.total)}</div></Field>
            <Field label="مربوط (باربری / دمترک)">
              <Select value={form.contractorId} placeholder="بدون / شخصی شرکت"
                onChange={(v) => setForm({ ...form, contractorId: v })}
                options={(lookups.contractor || []).map((c: any) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="نوع پرداخت">
              <Select value={form.paymentType} onChange={(v) => setForm({ ...form, paymentType: v })}
                options={[{ value: 'cash', label: 'نقده' }, { value: 'credit', label: 'باقی' }]} />
            </Field>
            <Field label="توضیحات" span={3}><TextArea value={form.note} onChange={(v) => setForm({ ...form, note: v })} /></Field>
          </div>
          <div className="small muted" style={{ marginTop: 12, padding: 10, background: 'var(--surface-2)', borderRadius: 9 }}>
            مجموع کرایه = متراژ × کرایه فی متر — مجموع بل = (متراژ × قیمت فی متر) + مجموع کرایه
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
