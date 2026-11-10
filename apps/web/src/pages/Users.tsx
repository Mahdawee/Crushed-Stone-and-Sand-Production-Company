import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, Modal, Table, Spinner, Select, ListHead, SummaryBar, K } from '../components/ui';

export default function UsersPage() {
  const { user } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/users').then(setRows).catch((e) => toast.error('بارگذاری نشد', e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!f.username?.trim()) { toast.warn('نام کاربری لازم است.'); return; }
    setBusy(true);
    try {
      if (f.id) await api.post(`/users/${f.id}`, f);
      else await api.post('/users', f);
      toast.success('کاربر ذخیره شد'); setF(null); await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const remove = (r: any) => toast.confirm({
    title: 'حذف کاربر؟', body: `کاربر «${r.username}» حذف شود؟`, confirmText: 'حذف کن',
    onConfirm: async () => {
      try { await api.del(`/users/${r.id}`); await load(); toast.success('حذف شد'); }
      catch (e: any) { toast.error('حذف نشد', e.message); }
    },
  });

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <ListHead actions={
          <button className="btn primary" onClick={() => setF({ username: '', fullName: '', password: '', role: 'employee', active: true })}>＋ کاربر نو</button>
        }>
          <SummaryBar>
            <K label="کاربران" value={(rows || []).length} />
            <span className="sep" />
            <K label="مدیر" value={(rows || []).filter((r: any) => r.role === 'manager').length} />
            <span className="sep" />
            <span className="muted">مدیر: دسترسی کامل — کارمند: ثبت و ویرایش بدون حذف</span>
          </SummaryBar>
        </ListHead>
        <div className="card-b tight">
      {!rows ? <Spinner /> : (
        <Table head={['#', 'نام کاربری', 'نام کامل', 'سطح دسترسی', 'وضعیت', 'آخرین ورود', '']}>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td>{i + 1}</td>
              <td className="mono" style={{ fontWeight: 700 }}>{r.username}{r.id === user?.id ? <span className="badge info" style={{ marginInlineStart: 6 }}>شما</span> : null}</td>
              <td>{r.fullName}</td>
              <td><span className={`badge ${r.role === 'manager' ? 'info' : 'muted'}`}>{r.role === 'manager' ? 'مدیر' : 'کارمند'}</span></td>
              <td><span className={`badge ${r.active ? 'ok' : 'bad'}`}>{r.active ? 'فعال' : 'غیر فعال'}</span></td>
              <td className="mono small hide-sm">{r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString('fa-IR') : '—'}</td>
              <td><div className="actions hover-actions">
                <button className="btn sm" onClick={() => setF({ ...r, password: '' })}>ویرایش</button>
                {r.id !== user?.id ? <button className="btn sm danger" onClick={() => remove(r)}>حذف</button> : null}
              </div></td>
            </tr>
          ))}
        </Table>
      )}
        </div>
      </div>

      {f ? (
        <Modal title={f.id ? 'ویرایش کاربر' : 'کاربر نو'} onClose={() => setF(null)} size="sm" footer={
          <><button className="btn primary" onClick={save} disabled={busy}>ذخیره</button><button className="btn" onClick={() => setF(null)}>انصراف</button></>}>
          <div className="form-grid c1">
            <Field label="نام کاربری" required><Text value={f.username} onChange={(v) => setF({ ...f, username: v })} readOnly={!!f.id} /></Field>
            <Field label="نام کامل"><Text value={f.fullName} onChange={(v) => setF({ ...f, fullName: v })} /></Field>
            <Field label={f.id ? 'رمز تازه (خالی = بدون تغییر)' : 'رمز عبور'} required={!f.id}>
              <input className="input" type="password" value={f.password || ''} onChange={(e) => setF({ ...f, password: e.target.value })} />
            </Field>
            <Field label="سطح دسترسی">
              <Select value={f.role} onChange={(v) => setF({ ...f, role: v })}
                options={[{ value: 'manager', label: 'مدیر (کامل)' }, { value: 'employee', label: 'کارمند (بدون حذف)' }]} />
            </Field>
            <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> فعال است</label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
