import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast, Table, Spinner, Stat } from '../components/ui';

export default function BackupPage() {
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/system/backup/list').then(setD).catch((e) => toast.error('بارگذاری نشد', e.message));
  useEffect(() => { load(); }, []);

  const make = async () => {
    setBusy(true);
    try { const r = await api.post('/system/backup', {}); toast.success('پشتیبان ساخته شد', r.file); await load(); }
    catch (e: any) { toast.error('پشتیبان ساخته نشد', e.message); }
    finally { setBusy(false); }
  };

  const restore = (r: any) => toast.confirm({
    title: 'بازگردانی دیتابیس؟', confirmText: 'بازگردان',
    body: `معلومات فعلی با فایل «${r.file}» تعویض می‌شود. یک کاپی احتیاطی از وضعیت فعلی هم ساخته می‌شود. بعد از بازگردانی برنامه را ببندید و دوباره باز کنید.`,
    onConfirm: async () => {
      try { const res = await api.post('/system/restore', { file: r.file }); toast.warn('بازگردانی شد', 'برنامه را ببندید و دوباره باز کنید.'); }
      catch (e: any) { toast.error('بازگردانی نشد', e.message); }
    },
  });

  if (!d) return <Spinner />;
  const last = d.rows[0];
  const days = last ? Math.floor((Date.now() - new Date(last.createdAt).getTime()) / 86400000) : null;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="grid c3">
        <Stat label="تعداد پشتیبان‌ها" value={d.rows.length} foot="۳۰ فایل آخر نگه داشته می‌شود" icon="💾" />
        <Stat label="آخرین پشتیبان" value={last ? new Date(last.createdAt).toLocaleDateString('fa-IR') : '—'}
          foot={days === null ? 'هنوز پشتیبان ساخته نشده' : `${days} روز پیش`} kind={days !== null && days > 7 ? 'warn' : 'ok'} icon="🕘" />
        <Stat label="پوشه پشتیبان" value={<span className="small mono">{d.dir}</span>} foot="همین کمپیوتر" icon="📁" />
      </div>

      <div className="card">
        <div className="card-h"><h3>پشتیبان‌گیری و بازگردانی</h3><div style={{ flex: 1 }} />
          <button className="btn primary" onClick={make} disabled={busy}>{busy ? 'در حال ساخت…' : '💾 ساخت پشتیبان تازه'}</button></div>
        <div className="card-b tight">
          <Table head={['فایل', 'تاریخ', 'حجم', '']} empty="هنوز پشتیبانی ساخته نشده است.">
            {d.rows.map((r: any) => (
              <tr key={r.file}>
                <td className="mono small">{r.file}</td>
                <td className="mono">{new Date(r.createdAt).toLocaleString('fa-IR')}</td>
                <td className="num">{(r.size / 1024).toFixed(0)} KB</td>
                <td><button className="btn sm" onClick={() => restore(r)}>بازگردانی</button></td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      <div className="card"><div className="card-b">
        <p className="small muted" style={{ lineHeight: 2 }}>
          <b>نکته مهم:</b> هر هفته یک پشتیبان بسازید و فایل آن را روی فلش یا کمپیوتر دیگری کاپی کنید.
          برای انتقال به کمپیوتر نو: برنامه را در کمپیوتر تازه نصب کنید، همین فایل را در پوشه پشتیبان کاپی کنید و از همین صفحه بازگردانی نمایید.
          مسیر پیش‌فرض فایل دیتابیس: <span className="mono">%APPDATA%/af.farday.roshan/farday.db</span>
        </p>
      </div></div>
    </div>
  );
}
