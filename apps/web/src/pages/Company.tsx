import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, Select } from '../components/ui';

export default function CompanyPage() {
  const toast = useToast();
  const { reloadSettings } = useSession();
  const [c, setC] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [mach, setMach] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [fiscal, setFiscal] = useState('');

  const load = async () => {
    const [company, machinery] = await Promise.all([api.get('/company'), api.get('/machinery')]);
    setC(company); setMach(machinery); setFiscal(company.fiscalYear || '');
  };
  useEffect(() => { load().catch((e) => toast.error('بارگذاری انجام نشد', e.message)); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.put('/company', { ...c, fiscalYear: fiscal });
      setC(next);
      toast.success('مشخصات شرکت ذخیره شد');
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setSaving(false); }
  };

  const saveMach = async () => {
    try {
      if (edit?.id) await api.put(`/machinery/${edit.id}`, edit);
      else await api.post('/machinery', edit);
      setEdit(null); await load(); toast.success('ماشین ذخیره شد');
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
  };

  const delMach = (m: any) => toast.confirm({
    title: 'حذف ماشین؟', body: `«${m.name}» از فهرست ماشینری حذف شود؟`, confirmText: 'حذف کن',
    onConfirm: async () => { await api.del(`/machinery/${m.id}`); await load(); toast.success('حذف شد'); },
  });

  if (!c) return <Spinner />;

  const totalMachines = mach.reduce((a, m) => a + Number(m.count || 0), 0);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card">
        <div className="card-h"><h3>شیت مشخصات شرکت (ثابت)</h3><div style={{ flex: 1 }} />
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'در حال ذخیره…' : 'ذخیره تغییرات'}</button>
        </div>
        <div className="card-b">
          <div className="form-grid">
            <Field label="نام شرکت" required><Text value={c.name} onChange={(v) => setC({ ...c, name: v })} /></Field>
            <Field label="نوع فعالیت"><Text value={c.activityType} onChange={(v) => setC({ ...c, activityType: v })} /></Field>
            <Field label="سال مالی"><Text value={fiscal} onChange={setFiscal} placeholder="۱۴۰۵ یا 2025" /></Field>
            <Field label="مدیر مالی"><Text value={c.financeManager} onChange={(v) => setC({ ...c, financeManager: v })} /></Field>
            <Field label="سرپرست"><Text value={c.supervisor} onChange={(v) => setC({ ...c, supervisor: v })} /></Field>
            <Field label="شماره تماس"><Text value={c.phone} onChange={(v) => setC({ ...c, phone: v })} /></Field>
            <Field label="آدرس" span={3}><TextArea value={c.address} onChange={(v) => setC({ ...c, address: v })} placeholder="ولایت، ولسوالی، ناحیه…" /></Field>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>انواع و تعداد ماشینری</h3>
          <span className="badge info">{mach.length} نوع / {totalMachines} عراده</span>
          <div style={{ flex: 1 }} />
          <button className="btn primary sm" onClick={() => setEdit({ name: '', model: '', plateNo: '', count: 1, status: 'active', note: '' })}>＋ ماشین نو</button>
        </div>
        <div className="card-b tight">
          <Table head={['#', 'نام ماشین', 'مودل', 'پلیت', 'تعداد', 'حالت', 'توضیحات', '']}>
            {mach.map((m, i) => (
              <tr key={m.id}>
                <td>{i + 1}</td>
                <td style={{ fontWeight: 600 }}>{m.name}</td>
                <td className="mono">{m.model}</td>
                <td className="mono">{m.plateNo}</td>
                <td className="num">{m.count}</td>
                <td><span className={`badge ${m.status === 'active' ? 'ok' : m.status === 'repair' ? 'warn' : 'muted'}`}>
                  {m.status === 'active' ? 'فعال' : m.status === 'repair' ? 'در ترمیم' : 'بیکار'}</span></td>
                <td className="small muted">{m.note}</td>
                <td><div className="actions">
                  <button className="btn sm" onClick={() => setEdit({ ...m })}>ویرایش</button>
                  <button className="btn sm danger" onClick={() => delMach(m)}>حذف</button>
                </div></td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      {edit ? (
        <Modal title={edit.id ? 'ویرایش ماشین' : 'ماشین نو'} onClose={() => setEdit(null)} size="md"
          footer={<><button className="btn primary" onClick={saveMach}>ذخیره</button><button className="btn" onClick={() => setEdit(null)}>انصراف</button></>}>
          <div className="form-grid c2">
            <Field label="نام ماشین" required><Text value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} /></Field>
            <Field label="مودل"><Text value={edit.model} onChange={(v) => setEdit({ ...edit, model: v })} /></Field>
            <Field label="پلیت"><Text value={edit.plateNo} onChange={(v) => setEdit({ ...edit, plateNo: v })} /></Field>
            <Field label="تعداد"><Num value={edit.count} onChange={(v) => setEdit({ ...edit, count: v })} /></Field>
            <Field label="حالت">
              <Select value={edit.status} onChange={(v) => setEdit({ ...edit, status: v })}
                options={[{ value: 'active', label: 'فعال' }, { value: 'repair', label: 'در ترمیم' }, { value: 'idle', label: 'بیکار' }]} />
            </Field>
            <Field label="توضیحات"><Text value={edit.note} onChange={(v) => setEdit({ ...edit, note: v })} /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
