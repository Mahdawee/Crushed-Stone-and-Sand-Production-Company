import { IconAlert, IconChevron, IconPrint } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Spinner, Table, Empty, Stat } from '../components/ui';
import { money, formatDate } from '../lib/calendar';
import { DatePicker } from '../components/DatePicker';
import '../styles/print.css';
import { PrintReportHeader, PrintReportFooter } from '../components/DocHeader';

export default function CustomerStatement() {
  const { id } = useParams();
  const { calendar } = useSession();
  const [d, setD] = useState<any>(null);

  const [range, setRange] = useState({ from: '', to: '' });
  /*
   * ── باگ کارایی (شکار باگ دور ۳۰) ────────────────────────────────────────
   * کارت حساب یک مشتری قدیمی همه‌ی اسناد را در یک جدول می‌ریخت. مشتری با
   * چند هزار بل و رسید، یعنی هزاران `<tr>` در یک صفحه: باز شدن کارت حساب
   * ثانیه‌ها طول می‌کشید و اسکرول می‌پرید — همان «کندی» که کاربر گفت.
   * حالا صفحه‌بندی سمت مرورگر (۱۵۰ سطر) دارد؛ چاپ همچنان کامل است.
   */
  const [page, setPage] = useState(1);
  const [printAll, setPrintAll] = useState(false);
  const PAGE = 150;
  useEffect(() => {
    const done = () => setPrintAll(false);
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, []);
  useEffect(() => {
    if (!printAll) return;
    const raf = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(raf);
  }, [printAll]);
  /*
   * ── باگ (شکار باگ دور ۳۴): هر خطا «مشتری پیدا نشد» می‌شد ────────────────
   * این‌جا هر خطایی (قطعی شبکه، ۴۰۱ پس از انقضای نشست، ۵۰۰) به «مشتری پیدا
   * نشد» تبدیل می‌شد؛ کاربر فکر می‌کرد حساب مشتری پاک شده، در حالی که مشکل
   * جای دیگری بود. حالا پیام واقعی سرور نشان داده می‌شود و «پیدا نشد» فقط
   * برای ۴۰۴ است.
   */
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    api.get(`/customers/${id}/statement`).then(setD).catch((e: any) => {
      if (Number(e?.status) === 404) setD(false);
      else { setD(false); setErr(String(e?.message || 'حساب مشتری خوانده نشد.')); }
    });
  }, [id]);
  if (d === null) return <Spinner />;
  if (d === false) {
    return (
      <Empty icon={<IconAlert size={16} />}
        title={err || 'مشتری پیدا نشد'}
        action={<Link className="btn" to="/customers">بازگشت</Link>} />
    );
  }

  const c = d.customer;

  /* فیلتر بازه فقط روی نمایش — باقی مانده کل همان د.closing است */
  const shown = (d.rows || []).filter((r: any) => (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to));
  const shownTotals = shown.reduce((a: any, r: any) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit }), { debit: 0, credit: 0 });
  const lastInRange = shown.length ? shown[shown.length - 1].balance : d.opening;
  /*
   * «باقی مانده» هر سطر از کل گردش حساب می‌آید (نه از بازه‌ی فیلترشده)؛
   * پس صفحه‌بندی فقط برش نمایش است و عددها را دست نمی‌زند.
   */
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages);
  const visible = printAll ? shown : shown.slice((current - 1) * PAGE, current * PAGE);
  return (
    <div className="col" style={{ gap: 16 }}>
      {/* سرصفحه و پانوشت چاپ — فقط روی کاغذ دیده می‌شوند */}
      <PrintReportHeader
        title="صورت‌حساب مشتری"
        period="گردش کامل حساب"
      />
      <div className="card no-print">
        <div className="list-head">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '.95rem' }}>{c.name}</h3>
            <span className="small muted">کد {c.code} — {c.contactPerson || 'بدون شخص رابط'} — {c.phone}</span>
          </div>
          <div style={{ flex: 1 }} />
          <div className="list-actions">
            <DatePicker compact value={range.from} onChange={(v) => { setRange({ ...range, from: v }); setPage(1); }} calendar={calendar} clearable placeholder="از تاریخ" width={126} />
            <DatePicker compact value={range.to} onChange={(v) => { setRange({ ...range, to: v }); setPage(1); }} calendar={calendar} clearable placeholder="تا تاریخ" width={126} />
            {range.from || range.to ? <button className="btn sm ghost" onClick={() => { setRange({ from: '', to: '' }); setPage(1); }}>همه</button> : null}
            {/* چاپ همه‌ی سطرها: اول همه رندر می‌شوند، بعد چاپ (در افکت) */}
            <button className="btn" onClick={() => setPrintAll(true)}><IconPrint size={15} /> چاپ</button>
            <Link className="btn" to="/customers"><IconChevron dir="start" size={14} /> بازگشت</Link>
          </div>
        </div>
      </div>

      <div className="grid c4">
        <Stat label="بدهی اولیه" value={money(d.opening)} foot="قبل از اسناد این سیستم" />
        <Stat label="مجموع بدهکاری" value={money(d.totals.debit)} foot="فروشات (نقده + قرضه)" kind="bad" />
        <Stat label="مجموع پرداخت‌ها" value={money(d.totals.credit)} foot="رسیدات" kind="ok" />
        <Stat label="باقی مانده فعلی" value={money(d.closing)} foot={d.closing > 0 ? 'بدهکار' : d.closing < 0 ? 'بستانکار' : 'تصفیه'} kind={d.closing > 0 ? 'bad' : 'ok'} />
      </div>

      <div className="card">
        <div className="card-h"><h3>کارت حساب</h3><div style={{ flex: 1 }} />
          <span className="small muted">{shown.length} سند{shown.length !== d.rows.length ? ` از ${d.rows.length}` : ''}</span></div>
        <div className="card-b tight">
          <Table head={['تاریخ', 'نوع', 'شماره سند', 'تفصیل', 'بدهکاری', 'پرداخت', 'باقی مانده']}
            foot={<tr>
              <td colSpan={4}>مجموع{range.from || range.to ? ' بازه' : ''}</td>
              <td className="num">{money(shownTotals.debit)}</td>
              <td className="num">{money(shownTotals.credit)}</td>
              <td className="num">{money(lastInRange)}</td>
            </tr>}>
            <tr style={{ background: 'var(--surface-2)' }}>
              <td colSpan={4} className="muted">بدهی اولیه</td>
              <td className="num">{money(d.opening)}</td>
              <td className="num">—</td>
              <td className="num">{money(d.opening)}</td>
            </tr>
            {visible.map((r: any) => (
              <tr key={r.id}>
                <td className="mono">{formatDate(r.date, calendar)}</td>
                <td>{r.type}</td>
                <td className="mono">{r.doc}</td>
                <td className="small">{r.detail}</td>
                <td className="num">{r.debit ? money(r.debit) : '—'}</td>
                <td className="num">{r.credit ? money(r.credit) : '—'}</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(r.balance)}</td>
              </tr>
            ))}
          </Table>
          {shown.length > PAGE ? (
            <div className="list-head no-print" style={{ padding: '8px 4px' }}>
              <button className="btn sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={current === 1}>قبلی</button>
              <span className="small muted">
                ردیف {(current - 1) * PAGE + 1} تا {Math.min(current * PAGE, shown.length)} از {shown.length} — صفحه‌ی {current} از {pages}
              </span>
              <button className="btn sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={current >= pages}>بعدی</button>
              <div style={{ flex: 1 }} />
              <span className="small muted hide-sm">برای دیدن همه‌ی اسناد از «چاپ» استفاده کنید.</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* پانوشت چاپ: تاریخ چاپ + خط امضا — فقط روی کاغذ */}
      <PrintReportFooter />
    </div>
  );
}
