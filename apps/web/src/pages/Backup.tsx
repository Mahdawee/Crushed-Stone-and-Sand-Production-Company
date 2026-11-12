import { IconDatabase, IconDownload, IconFolder } from '../components/icons';
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

  /**
   * ── باز کردن پوشه (C2) ─────────────────────────────────────────────────
   * پوشه روی همان ماشینی است که سرور اجرا می‌شود، پس سرور Explorer را باز
   * می‌کند. مسیر از کلاینت فرستاده **نمی‌شود** — فقط کلید (`data`/`backups`).
   *
   * اگر سیستم فایل‌منیجر نداشته باشد (نسخه‌ی سروری، بدون محیط گرافیکی)
   * سرور `ok:false` با پیام برمی‌گرداند و ما مسیر را نشان می‌دهیم تا کاربر
   * دستی برود — هرگز ادعا نمی‌کنیم «باز شد» وقتی نشده.
   */
  const openFolder = async (key: 'data' | 'backups' | 'logs') => {
    try {
      const r: any = await api.post(`/system/open-folder/${key}`, {});
      if (r.ok) { toast.success('پوشه باز شد', r.path); return; }
      toast.warn(r.via === 'none' ? 'باز کردن خودکار ممکن نشد' : 'فایل‌منیجر پاسخ نداد', r.message || r.path);
    } catch (e: any) {
      toast.error('پوشه باز نشد', e.message);
    }
  };

  /**
   * ── فشرده‌ی پشتیبان (C2) ───────────────────────────────────────────────
   * برای «بفرست به حسابدار» یک فایل بهتر از ده فایل است. نام فایل از
   * هدر `Content-Disposition` خوانده می‌شود تا همان نامی باشد که سرور
   * ساخت — نه یک نام حدسی در رابط.
   */
  const bundle = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/system/backup/bundle`, {
        headers: { 'x-auth-token': getToken() },
      });
      if (!res.ok) throw new Error('ساخت فایل فشرده انجام نشد.');
      const disp = res.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(disp);
      const name = m ? m[1] : 'farday-bundle.zip';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success('فایل فشرده دانلود شد', `${name} — ${(blob.size / 1024).toFixed(0)} KB`);
    } catch (e: any) {
      toast.error('فشرده‌سازی نشد', e.message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * ── باگ (شکار باگ دور ۲۸) ──────────────────────────────────────────────
   * فهرست، فایل‌های خراب را «سالم» نشان می‌داد و دکمه‌ی «بازگردانی» برایشان
   * فعال بود. یک کلیک روی فایل خراب، دیتابیس سالم را نابود می‌کرد و از آن
   * لحظه هیچ صفحه‌ای باز نمی‌شد (تجربه‌ی `SQLITE_NOTADB`). حالا فایل خراب
   * با برچسب قرمز نشان داده می‌شود و دکمه‌اش غیرفعال است؛ سرور هم مستقل
   * از این صفحه فایل را بررسی می‌کند (دفاع دو‌لایه).
   */
  const restore = (r: any) => {
    if (r.healthy === false) {
      toast.error('این فایل سالم نیست', 'بازگردانی انجام نشد. فایل خراب است یا دیتابیس این برنامه نیست.');
      return;
    }
    return toast.confirm({
    title: 'بازگردانی دیتابیس؟', confirmText: 'بازگردان',
    /*
     * پیام قبلی می‌گفت «برنامه را ببندید و دوباره باز کنید» — از وقتی اتصال
     * دیتابیس پس از بازگردانی دوباره باز می‌شود این کار لازم نیست و همان پیام
     * کاربر را بی‌دلیل مجبور به ری‌استارت می‌کرد. حالا صفحه بعد از بازگردانی
     * تازه‌سازی می‌شود و فهرست پشتیبان‌ها (که خودش هم در دیتابیس تغییر کرده)
     * دوباره خوانده می‌شود.
     */
    body: `معلومات فعلی با فایل «${r.file}» تعویض می‌شود. یک کاپی احتیاطی از وضعیت فعلی هم ساخته می‌شود. تطبیق داده‌ها خودکار انجام می‌شود؛ نیازی به بستن برنامه نیست.`,
    onConfirm: async () => {
      try {
        await api.post('/system/restore', { file: r.file });
        toast.success('بازگردانی شد', 'داده‌ها با فایل پشتیبان تعویض شدند.');
        setD(null);
        await load();
      } catch (e: any) { toast.error('بازگردانی نشد', e.message); }
    },
  });
  };

  if (!d) return <Spinner />;
  /*
   * «آخرین پشتیبان» باید آخرین پشتیبانِ **سالم** باشد. قبلاً هر فایلی — حتی
   * یک کاپی خراب — این شمارنده را تازه می‌کرد و کاربر فکر می‌کرد پشتیبان
   * سالم دارد، در حالی که فایل قابل بازگردانی نبود (شکار باگ دور ۲۸).
   */
  const healthyRows = d.rows.filter((r: any) => r.healthy !== false);
  const brokenCount = d.rows.length - healthyRows.length;
  const last = healthyRows[0];
  const days = last ? Math.floor((Date.now() - new Date(last.createdAt).getTime()) / 86400000) : null;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="list-head">
          <h3 style={{ margin: 0, fontSize: '.92rem' }}>پشتیبان‌گیری</h3>
          <div className="list-summary">
            <InlineStat label="تعداد فایل" value={d.rows.length}
              tone={brokenCount ? 'warn' : 'ok'} />
            <span className="sep" />
            <InlineStat label="آخرین پشتیبان" value={last ? new Date(last.createdAt).toLocaleDateString('fa-IR') : '—'}
              tone={days !== null && days > 7 ? 'warn' : 'ok'} />
            <span className="sep" />
            <InlineStat label="پوشه" value={<span className="mono small">{d.dir}</span>} />
          </div>
          <div style={{ flex: 1 }} />
          <span className="small muted hide-sm">
            {brokenCount
              ? <b style={{ color: 'var(--danger)' }}>{brokenCount} فایل خراب — قابل بازگردانی نیست</b>
              : null}
            {brokenCount ? ' — ' : ''}
            {days === null ? 'هنوز پشتیبان سالمی ساخته نشده' : `${days} روز پیش`} — ۳۰ فایل آخر نگه داشته می‌شود
          </span>
          <div className="list-actions">
            {/* فشرده: همه‌ی پشتیبان‌ها + دیتابیس زنده + راهنما، در یک فایل */}
            <button className="btn" onClick={bundle} disabled={busy} title="دانلود همه‌ی پشتیبان‌ها در یک فایل ZIP">
              <IconDownload size={15} /> دانلود همه (ZIP)
            </button>
            <button className="btn" onClick={() => openFolder('backups')} title="باز کردن پوشه‌ی پشتیبان‌ها در ویندوز">
              <IconFolder size={15} /> باز کردن پوشه
            </button>
            <button className="btn primary" onClick={make} disabled={busy}><IconDatabase size={15} /> {busy ? 'در حال ساخت…' : 'ساخت پشتیبان تازه'}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-b tight">
          <Table head={['فایل', 'تاریخ', 'حجم', 'وضعیت', '']} empty="هنوز پشتیبانی ساخته نشده است.">
            {d.rows.map((r: any) => (
              <tr key={r.file}>
                <td className="mono small">{r.file}</td>
                <td className="mono">{new Date(r.createdAt).toLocaleString('fa-IR')}</td>
                <td className="num">{(r.size / 1024).toFixed(0)} KB</td>
                <td>
                  {r.healthy === false
                    ? <span className="badge bad" title="این فایل قابل بازگردانی نیست؛ فایل خراب است یا دیتابیس این برنامه نیست.">خراب</span>
                    : <span className="badge ok">سالم</span>}
                </td>
                <td><div className="actions">
                  <a className="btn sm" href={`${API_BASE}/system/backup/download?file=${encodeURIComponent(r.file)}`}
                    onClick={(e) => { e.preventDefault(); download(r.file); }}><IconDownload size={15} /> دانلود</a>
                  <button className="btn sm" onClick={() => restore(r)} disabled={r.healthy === false}
                    title={r.healthy === false ? 'فایل خراب است — بازگردانی مسدود شد' : 'بازگردانی از این پشتیبان'}>بازگردانی</button>
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
