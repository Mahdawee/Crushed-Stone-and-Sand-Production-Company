import { IconPrint } from '../components/icons';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Table, Spinner, Stat, ExportButton,
} from '../components/ui';
import { DatePicker } from '../components/DatePicker';
import { money, todayISO, toCalendar, fromCalendar, addDaysISO, formatDate } from '../lib/calendar';
import '../styles/print.css';
import { PrintReportHeader, PrintReportFooter } from '../components/DocHeader';


/* بازه‌های آماده — کمتر کلیک، کمتر تایپ */
const QUICK = [
  { key: 'today', label: 'امروز' },
  { key: 'week', label: '۷ روز' },
  { key: 'month', label: 'این ماه' },
  { key: 'year', label: 'این سال' },
] as const;

export default function CashbookPage() {
  const { calendar } = useSession();
  const toast = useToast();
  const now = toCalendar(todayISO(), calendar);
  const [range, setRange] = useState({ from: fromCalendar(now.jy, now.jm, 1, calendar), to: todayISO() });
  const [d, setD] = useState<any>(null);
  /*
   * ── باگ کارایی (شکار باگ دور ۲۹) ────────────────────────────────────────
   * «حرکت دخل» همه‌ی اسناد بازه را در **یک** جدول می‌ریخت. برای یک سال
   * کاری واقعی (چند هزار سند) این یعنی ده‌ها هزار `<tr>`: مرورگر ثانیه‌ها
   * قفل می‌شد و اسکرول می‌لرزید — دقیقاً همان «کندی برنامه» که کاربر
   * گزارش کرد. حالا صفحه‌بندی سمت مرورگر (۲۰۰ سطر) اضافه شد؛ چاپ و خروجی
   * همچنان همه‌ی اسناد را دارند.
   */
  const [page, setPage] = useState(1);
  /* هنگام چاپ، همه‌ی سطرها رندر می‌شوند (کاغذ باید کامل باشد) */
  const [printAll, setPrintAll] = useState(false);
  const PAGE = 200;
  useEffect(() => {
    const done = () => setPrintAll(false);
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, []);

  const load = async () => {
    const qs = new URLSearchParams();
    if (range.from) qs.set('from', range.from);
    if (range.to) qs.set('to', range.to);
    try { setD(await api.get(`/reports/cashbook?${qs.toString()}`)); setPage(1); }
    catch (e: any) { toast.error('حرکت دخل بارگذاری نشد', e.message); }
  };
  /*
   * باگ کاربر: کلیدهای «امروز / ۷ روز / این ماه / این سال» بازه را عوض
   * می‌کردند ولی راپور **بارگذاری نمی‌شد**؛ کاربر باید بعدش «نمایش» را
   * می‌زد و تا آن موقع اعداد بازه‌ی قبلی روی صفحه می‌ماند (گمراه‌کننده).
   * حالا تغییر بازه خودش بارگذاری می‌کند و «نمایش» برای بازخوانی دستی است.
   */
  const loadedRef = useRef('');
  useEffect(() => {
    const key = `${range.from}|${range.to}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    load();
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps


  const isQuick = (() => {
    const c = toCalendar(todayISO(), calendar);
    const first = fromCalendar(c.jy, c.jm, 1, calendar);
    const firstYear = fromCalendar(c.jy, 1, 1, calendar);
    if (range.to !== todayISO()) return '';
    if (range.from === todayISO()) return 'today';
    if (range.from === addDaysISO(todayISO(), -6)) return 'week';
    if (range.from === first) return 'month';
    if (range.from === firstYear) return 'year';
    return '';
  })();
  const applyQuick = (key: string) => {
    const c = toCalendar(todayISO(), calendar);
    const map: Record<string, string> = {
      today: todayISO(),
      week: addDaysISO(todayISO(), -6),
      month: fromCalendar(c.jy, c.jm, 1, calendar),
      year: fromCalendar(c.jy, 1, 1, calendar),
    };
    setRange({ from: map[key], to: todayISO() });
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* سرصفحه و پانوشت چاپ — فقط روی کاغذ دیده می‌شوند */}
      <PrintReportHeader
        title="حرکت دخل"
        period={range?.from ? `از ${formatDate(range.from, calendar)} تا ${formatDate(range.to, calendar)}` : ''}
      />
      <div className="card no-print">
        <div className="list-head">
          <div className="pill-tabs">
            {QUICK.map((q) => (
              <button key={q.key} className={isQuick === q.key ? 'on' : ''} onClick={() => applyQuick(q.key)}>{q.label}</button>
            ))}
          </div>
          <DatePicker compact value={range.from} onChange={(v) => setRange({ ...range, from: v })} calendar={calendar} width={132} title="از تاریخ" />
          <span className="text-3">—</span>
          <DatePicker compact value={range.to} onChange={(v) => setRange({ ...range, to: v })} calendar={calendar} width={132} title="تا تاریخ" />
          <button className="btn primary" onClick={load}>نمایش</button>
          <div style={{ flex: 1 }} />
          <div className="list-actions">
            {/* چاپ باید همه‌ی اسناد را داشته باشد — پس قبل از print همه رندر می‌شوند */}
            <button className="btn" onClick={() => { setPrintAll(true); setTimeout(() => window.print(), 60); }}>
              <IconPrint size={15} /> چاپ
            </button>
            <ExportButton type="receipts" label="خروجی" range={range} />
          </div>
        </div>
      </div>

      {!d ? <Spinner /> : (<>
        <div className="grid c3">
          <Stat label="کل وارده" value={money(d.totals.in)} kind="ok" />
          <Stat label="کل صادره" value={money(d.totals.out)} kind="bad" />
          <Stat label="باقی صندوق دوره" value={money(d.totals.balance)} kind={d.totals.balance >= 0 ? 'ok' : 'bad'} />
        </div>
        <div className="card"><div className="card-h"><h3>حرکت دخل</h3><div style={{ flex: 1 }} />
          <span className="small muted">
            {d.rows.length} سند
            {d.rows.length > PAGE ? ` — نمایش ${(page - 1) * PAGE + 1} تا ${Math.min(page * PAGE, d.rows.length)}` : ''}
          </span>
        </div>
          <div className="card-b tight">
            <Table head={['تاریخ', 'نوع', 'سند', 'طرف معامله', 'وارده', 'صادره', 'باقی']}>
              {(printAll ? d.rows : d.rows.slice((page - 1) * PAGE, page * PAGE)).map((r: any, i: number) => (
                /*
                 * سطرهای «اطلاعی» (امانت، مصرف قرضه، رسید به بانک) پولی از دخل
                 * نگرفته‌اند؛ قبلاً مثل بقیه نمایش داده می‌شدند و جمع ستون با
                 * «باقی» نمی‌خواند. حالا کم‌رنگ و با نشان «بدون اثر در دخل».
                 */
                <tr key={i} className={r.kind === 'info' ? 'row-info' : undefined}>
                  <td className="mono">{r.dateDisplay}</td>
                  <td>{r.type}{r.kind === 'info' ? <span className="badge muted">بدون اثر در دخل</span> : null}</td>
                  <td className="mono">{r.doc}</td>
                  <td className="small">{r.party}</td>
                  <td className="num" style={{ color: r.in ? 'var(--ok)' : 'inherit' }}>{r.in ? money(r.in) : '—'}</td>
                  <td className="num" style={{ color: r.out ? 'var(--danger)' : 'inherit' }}>{r.out ? money(r.out) : '—'}</td>
                  <td className="num" style={{ fontWeight: r.kind === 'info' ? 400 : 700 }}>{money(r.balance)}</td>
                </tr>
              ))}
            </Table>
            {d.rows.length > PAGE ? (
              <div className="col" style={{ gap: 6, padding: '8px 4px' }}>
                <div className="list-head" style={{ padding: 0 }}>
                  <button className="btn sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>صفحه‌ی قبل</button>
                  <span className="small muted">صفحه‌ی {page} از {Math.ceil(d.rows.length / PAGE)}</span>
                  <button className="btn sm" onClick={() => setPage((p) => Math.min(Math.ceil(d.rows.length / PAGE), p + 1))}
                    disabled={page >= Math.ceil(d.rows.length / PAGE)}>صفحه‌ی بعد</button>
                  <div style={{ flex: 1 }} />
                  <span className="small muted hide-sm">برای دیدن همه‌ی اسناد از «چاپ» یا «خروجی» استفاده کنید.</span>
                </div>
              </div>
            ) : null}
          </div></div>
      </>)}

      {/* پانوشت چاپ: تاریخ چاپ + خط امضا — فقط روی کاغذ */}
      <PrintReportFooter />
    </div>
  );
}
