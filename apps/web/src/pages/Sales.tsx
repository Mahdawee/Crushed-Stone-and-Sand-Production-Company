import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, downloadCsv } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, Select, Pager } from '../components/ui';
import { money, formatDate, toInputDate, parseInputDate, num, monthName, todayISO, toCalendar } from '../lib/calendar';

export default function SalesPage() {
  const { calendar, isManager } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', from: '', to: '', paymentType: '', material: '' });
  const [lookups, setLookups] = useState<any>({ material: [], contractor: [] });
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [dateStr, setDateStr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (p = page) => {
    const qs = new URLSearchParams({ page: String(p), pageSize: '25' });
    Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v as string); });
    setData(await api.get(`/sales?${qs.toString()}`));
  };

  useEffect(() => { load(page).catch((e) => toast.error('بارگذاری نشد', e.message)); }, [page, filters]);
  useEffect(() => {
    api.get('/lookups').then((r) => setLookups(r.items)).catch(() => {});
    api.get('/customers').then(setCustomers).catch(() => {});
  }, []);

  useEffect(() => {
    if (sp.get('new') === '1') { setSp({}); openNew(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const openNew = async () => {
    const { no } = await api.get('/sales/next-no');
    setForm({
      no, customerId: '', driverName: '', truckPlate: '', destination: '', materialId: '', materialName: '',
      volume: 0, unitPrice: 0, freightPerUnit: 0, contractorId: '', contractorName: '', paymentType: 'cash', note: '',
    });
    setDateStr(toInputDate(todayISO(), calendar));
  };

  const openEdit = (r: any) => {
    setForm({ ...r });
    setDateStr(toInputDate(r.date, calendar));
  };

  const calc = useMemo(() => {
    if (!form) return { freightTotal: 0, total: 0 };
    const v = num(form.volume), p = num(form.unitPrice), f = num(form.freightPerUnit);
    const freightTotal = Math.round(v * f * 100) / 100;
    return { freightTotal, total: Math.round((v * p + freightTotal) * 100) / 100 };
  }, [form]);

  const save = async () => {
    if (!form.customerId) { toast.warn('مشتری را انتخاب کنید.'); return; }
    let date = '';
    try { date = parseInputDate(dateStr, calendar); } catch (e: any) { toast.error('تاریخ بل', e.message); return; }
    const cust = customers.find((c) => String(c.id) === String(form.customerId));
    setBusy(true);
    try {
      const payload = {
        ...form, date, customerName: cust?.name || form.customerName,
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
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-b">
          <div className="toolbar">
            <Field label="جستجو"><input className="input" style={{ width: 200 }} value={filters.q}
              onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} placeholder="بل، مشتری، دریور…" /></Field>
            <Field label="از تاریخ"><input className="input mono" style={{ width: 130 }} value={filters.from}
              onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }); }} placeholder="۱۴۰۴/۰۵/۰۱" /></Field>
            <Field label="تا تاریخ"><input className="input mono" style={{ width: 130 }} value={filters.to}
              onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }); }} placeholder="۱۴۰۴/۰۵/۳۱" /></Field>
            <Field label="مواد"><Select value={filters.material} onChange={(v) => { setPage(1); setFilters({ ...filters, material: v }); }}
              placeholder="همه" options={(lookups.material || []).map((m: any) => ({ value: m.name, label: m.name }))} /></Field>
            <Field label="پرداخت"><Select value={filters.paymentType} onChange={(v) => { setPage(1); setFilters({ ...filters, paymentType: v }); }}
              placeholder="همه" options={[{ value: 'cash', label: 'نقده' }, { value: 'credit', label: 'باقی' }]} /></Field>
            <div className="spacer" />
            <button className="btn" onClick={() => downloadCsv('sales')}>⤓ اکسل</button>
            <button className="btn primary" onClick={openNew}>＋ بل فروش نو</button>
          </div>
        </div>
      </div>

      <div className="row between wrap">
        <div className="row wrap">
          <span className="badge info">{data?.total ?? 0} بل</span>
          <span className="badge ok">مجموع: {money(data?.sum ?? 0)} افغانی</span>
        </div>
        <span className="small muted">قیمت‌ها به افغانی — کرایه به صورت جداگانه محاسبه می‌شود</span>
      </div>

      {!data ? <Spinner /> : (
        <>
          <Table head={['شماره', 'تاریخ', 'مشتری', 'دریور / پلیت', 'مقصد', 'مواد', 'متراژ', 'قیمت فی متر', 'کرایه فی متر', 'مجموع کرایه', 'مجموع', 'پرداخت', '']}>
            {data.rows.map((r: any) => (
              <tr key={r.id}>
                <td className="mono" style={{ fontWeight: 700 }}>{r.no}</td>
                <td className="mono">{r.dateDisplay}</td>
                <td>{r.customerName}</td>
                <td><div>{r.driverName}</div><div className="small muted mono">{r.truckPlate}</div></td>
                <td className="small">{r.destination}</td>
                <td>{r.materialName}</td>
                <td className="num">{money(r.volume)}</td>
                <td className="num">{money(r.unitPrice)}</td>
                <td className="num">{money(r.freightPerUnit)}</td>
                <td className="num">{money(r.freightTotal)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td>
                <td><span className={`badge ${r.paymentType === 'cash' ? 'ok' : 'warn'}`}>{r.paymentType === 'cash' ? 'نقده' : 'باقی'}</span></td>
                <td><div className="actions">
                  <Link className="btn sm" to={`/print/sale/${r.id}`}>چاپ</Link>
                  <button className="btn sm" onClick={() => openEdit(r)}>ویرایش</button>
                  {isManager ? <button className="btn sm danger" onClick={() => remove(r)}>حذف</button> : null}
                </div></td>
              </tr>
            ))}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}

      {form ? (
        <Modal title={form.id ? `ویرایش بل ${form.no}` : 'بل فروش نو'} onClose={() => setForm(null)} footer={
          <>
            <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره بل فروش'}</button>
            <button className="btn" onClick={() => setForm(null)}>انصراف</button>
            <div className="spacer" />
            <div className="row" style={{ gap: 16 }}>
              <span className="small muted">مجموع کرایه: <b className="mono">{money(calc.freightTotal)}</b></span>
              <span className="small">مجموع بل: <b className="mono" style={{ fontSize: '1.05rem', color: 'var(--accent)' }}>{money(calc.total)}</b></span>
            </div>
          </>
        }>
          <div className="form-grid">
            <Field label="شماره بل"><Text value={form.no} onChange={(v) => setForm({ ...form, no: v })} readOnly={!!form.id} /></Field>
            <Field label="تاریخ" required hint={calendar === 'jalali' ? 'شمسی' : 'میلادی'}>
              <Text value={dateStr} onChange={setDateStr} placeholder="۱۴۰۴/۰۵/۱۲" />
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
            فورمول: مجموع کرایه = متراژ × کرایه فی متر — مجموع بل = (متراژ × قیمت فی متر) + مجموع کرایه
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
