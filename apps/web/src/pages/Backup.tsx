import { IconDatabase, IconDownload } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { api, getToken, API_BASE } from '../lib/api';
import { useToast, Table, Spinner, InlineStat } from '../components/ui';

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

  const download = async (file: string) => {
    try {
      const res = await fetch(`${API_BASE}/system/backup/download?file=${encodeURIComponent(file)}`, {
        headers: { 'x-auth-token': getToken() },
      });
      if (!res.ok) throw new Error('دانلود انجام نشد.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success('فایل پشتیبان دانلود شد', file);
    } catch (e: any) { toast.error('دانلود نشد', e.message); }
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
      <div className="card">
        <div className="list-head">
          <h3 style={{ margin: 0, fontSize: '.92rem' }}>پشتیبان‌گیری</h3>
          <div className="list-summary">
            <InlineStat label="تعداد فایل" value={d.rows.length} />
            <span className="sep" />
            <InlineStat label="آخرین پشتیبان" value={last ? new Date(last.createdAt).toLocaleDateString('fa-IR') : '—'}
              tone={days !== null && days > 7 ? 'warn' : 'ok'} />
            <span className="sep" />
            <InlineStat label="پوشه" value={<span className="mono small">{d.dir}</span>} />
          </div>
          <div style={{ flex: 1 }} />
          <span className="small muted hide-sm">{days === null ? 'هنوز پشتیبان ساخته نشده' : `${days} روز پیش`} — ۳۰ فایل آخر نگه داشته می‌شود</span>
          <div className="list-actions">
            <button className="btn primary" onClick={make} disabled={busy}><IconDatabase size={15} /> {busy ? 'در حال ساخت…' : 'ساخت پشتیبان تازه'}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-b tight">
          <Table head={['فایل', 'تاریخ', 'حجم', '']} empty="هنوز پشتیبانی ساخته نشده است.">
            {d.rows.map((r: any) => (
              <tr key={r.file}>
                <td className="mono small">{r.file}</td>
                <td className="mono">{new Date(r.createdAt).toLocaleString('fa-IR')}</td>
                <td className="num">{(r.size / 1024).toFixed(0)} KB</td>
                <td><div className="actions">
                  <a className="btn sm" href={`${API_BASE}/system/backup/download?file=${encodeURIComponent(r.file)}`}
                    onClick={(e) => { e.preventDefault(); download(r.file); }}><IconDownload size={15} /> دانلود</a>
                  <button className="btn sm" onClick={() => restore(r)}>بازگردانی</button>
                </div></td>
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
