import { IconPrint } from '../components/icons';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Table, Spinner, Stat, ExportButton,
} from '../components/ui';
import { DatePicker } from '../components/DatePicker';
import { money, todayISO, toCalendar, pad2, fromCalendar, addDaysISO, formatDate } from '../lib/calendar';
import '../styles/print.css';
import { PrintReportHeader, PrintReportFooter } from '../components/DocHeader';


/* بازه‌های آماده — کمتر کلیک، کمتر تایپ */
const QUICK = [
  { key: 'today', label: 'امروز' },
  { key: 'week', label: '۷ روز' },
  { key: 'month', label: 'این ماه' },
  { key: 'year', label: 'این سال' },
] as const;

export default function ReportsDaily() {
  const { calendar } = useSession();
  const toast = useToast();
  const now = toCalendar(todayISO(), calendar);
  const [range, setRange] = useState({ from: fromCalendar(now.jy, now.jm, 1, calendar), to: todayISO() });
  const [d, setD] = useState<any>(null);

  const load = async () => {
    const qs = new URLSearchParams();
    if (range.from) qs.set('from', range.from);
    if (range.to) qs.set('to', range.to);
    try {
      setD(await api.get(`/reports/daily?${qs.toString()}`));
    } catch (e: any) {
      toast.error('راپور بارگذاری نشد', e.message);
    }
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
        title="راپور روزانه"
        period={`از ${formatDate(range.from, calendar)} تا ${formatDate(range.to, calendar)}`}
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
            <ExportButton type="sales" label="خروجی" range={range} />
          </div>
        </div>
      </div>

      {!d ? <Spinner /> : (<>
        <div className="grid c4">
          <Stat label="فروشات نقده" value={money(d.totals.cashSales)} kind="ok" foot="پول نقد وارد شده" />
          <Stat label="فروشات قرضه" value={money(d.totals.creditSales)} kind="warn" foot="در بدهی مشتری" />
          <Stat label="رسیدات" value={money(d.totals.receipts)} foot="دریافت از مشتریان" />
          <Stat label="مجموع صادره دوره" value={money(d.totals.totalExpenses)} kind="bad" foot={`مصارف ${money(d.totals.expensesAfn)} + معاشات ${money(d.totals.salaries)}`} />
        </div>
        <div className="grid c3">
          <Stat label="داخل دخل (دوره)" value={money(d.totals.cashIn ?? 0)} kind="ok" foot="فروش نقده + رسیدات دخل" />
          <Stat label="خارج دخل (دوره)" value={money(d.totals.cashOut ?? 0)} kind="bad" foot="مصارف + معاشات نقدی" />
          {(() => {
            /*
             * ── باگ (شکار باگ دور ۳۲): دو عدد با یک برچسب ─────────────────
             * این کارت جمع «موجودی دخل روز» هر روز را نشان می‌داد ولی
             * «موجودی متحرک دخل» نام داشت — و «متحرک» در ستون آخر جدول
             * معنای دیگری دارد: مانده‌ی **تجمعی دخل** از اولین سند سیستم تا
             * امروز. کاربر دو عدد متفاوت با تقریباً یک نام می‌دید.
             * حالا کارت «متحرک» همان عدد ستون آخر است.
             */
            const running = Number(d.rows[0]?.runningCash ?? 0);
            return <Stat label="موجودی متحرک دخل" value={money(running)} kind={running >= 0 ? 'ok' : 'bad'} foot={`مانده‌ی تجمعی دخل تا امروز — حالت ${d.mode === 'accurate' ? 'دقیق' : 'ساده'}`} />;
          })()}
        </div>

        <div className="card">
          <div className="card-h"><h3>راپور روزانه</h3><div style={{ flex: 1 }} />
            <span className="small muted">{d.rows.length} روز</span></div>
          <div className="card-b tight">
            <Table head={['تاریخ', 'فروش نقده', 'فروش قرضه', 'رسیدات', 'مصارف', 'معاشات', 'مجموع مصارف', 'موجودی دخل روز', 'متحرک دخل']}
              foot={<tr>
                <td>مجموع دوره</td>
                <td className="num">{money(d.totals.cashSales)}</td>
                <td className="num">{money(d.totals.creditSales)}</td>
                <td className="num">{money(d.totals.receipts)}</td>
                <td className="num">{money(d.totals.expensesAfn)}</td>
                <td className="num">{money(d.totals.salaries)}</td>
                <td className="num">{money(d.totals.totalExpenses)}</td>
                {/* جمع «موجودی دخل روز» نه «داخل دخل» — با ستون بالای خودش یکی باشد */}
                <td className="num">{money(d.rows.reduce((a: number, r: any) => a + Number(r.cashBalance || 0), 0))}</td>
                <td className="num muted">{money(d.rows[0]?.runningCash ?? 0)}</td>
              </tr>}>
              {d.rows.map((r: any) => (
                <tr key={r.date}>
                  <td className="mono">{r.dateDisplay}</td>
                  <td className="num">{money(r.cashSales)}</td>
                  <td className="num">{money(r.creditSales)}</td>
                  <td className="num">{money(r.receipts)}</td>
                  <td className="num">{money(r.expensesAfn)}{r.expensesUsd ? <span className="badge warn" style={{ marginInlineStart: 4 }}>${money(r.expensesUsd)}</span> : null}</td>
                  <td className="num">{money(r.salaries)}</td>
                  <td className="num">{money(r.totalExpenses)}</td>
                  <td className="num" style={{ fontWeight: 700, color: r.cashBalance >= 0 ? 'var(--ok)' : 'var(--danger)' }} title={`داخل ${money(r.cashIn)} − خارج ${money(r.cashOut)}`}>{money(r.cashBalance)}</td>
                  <td className="num muted">{money(r.runningCash)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      </>)}

      {/* پانوشت چاپ: تاریخ چاپ + خط امضا — فقط روی کاغذ */}
      <PrintReportFooter />
    </div>
  );
}
