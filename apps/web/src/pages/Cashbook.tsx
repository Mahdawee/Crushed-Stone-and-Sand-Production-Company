import { IconPrint } from '../components/icons';
import React, { useEffect, useState } from 'react';
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

  const load = async () => {
    const qs = new URLSearchParams();
    if (range.from) qs.set('from', range.from);
    if (range.to) qs.set('to', range.to);
    try { setD(await api.get(`/reports/cashbook?${qs.toString()}`)); }
    catch (e: any) { toast.error('حرکت دخل بارگذاری نشد', e.message); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps


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
            <button className="btn" onClick={() => window.print()}><IconPrint size={15} /> چاپ</button>
            <ExportButton type="receipts" label="خروجی" />
          </div>
        </div>
      </div>

      {!d ? <Spinner /> : (<>
        <div className="grid c3">
          <Stat label="کل وارده" value={money(d.totals.in)} kind="ok" />
          <Stat label="کل صادره" value={money(d.totals.out)} kind="bad" />
          <Stat label="باقی صندوق دوره" value={money(d.totals.balance)} kind={d.totals.balance >= 0 ? 'ok' : 'bad'} />
        </div>
        <div className="card"><div className="card-h"><h3>حرکت دخل</h3><div style={{ flex: 1 }} /><span className="small muted">{d.rows.length} سند</span></div>
          <div className="card-b tight">
            <Table head={['تاریخ', 'نوع', 'سند', 'طرف معامله', 'وارده', 'صادره', 'باقی']}>
              {d.rows.map((r: any, i: number) => (
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
          </div></div>
      </>)}

      {/* پانوشت چاپ: تاریخ چاپ + خط امضا — فقط روی کاغذ */}
      <PrintReportFooter />
    </div>
  );
}
