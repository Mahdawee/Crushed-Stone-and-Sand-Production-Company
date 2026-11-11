import { IconAlert, IconChart, IconCheck, IconPrint, IconWallet } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Table, Spinner, Stat, ExportButton,
} from '../components/ui';
import { money, todayISO, toCalendar } from '../lib/calendar';
import '../styles/print.css';
import { PrintReportHeader, PrintReportFooter } from '../components/DocHeader';

export default function ReportsMonthly() {
  const { calendar } = useSession();
  const toast = useToast();
  const [year, setYear] = useState(toCalendar(todayISO(), calendar).jy);
  const [d, setD] = useState<any>(null);

  const load = () => api.get(`/reports/monthly?year=${year}`).then(setD).catch((e) => toast.error('بارگذاری نشد', e.message));
  useEffect(() => { load(); }, [year]);

  const years = Array.from({ length: 6 }, (_, i) => toCalendar(todayISO(), calendar).jy - i);

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* سرصفحه و پانوشت چاپ — فقط روی کاغذ دیده می‌شوند */}
      <PrintReportHeader
        title="راپور ماهانه"
        period={`سال ${year}`}
      />
      <div className="card no-print">
        <div className="list-head">
          <div className="pill-tabs">
            {years.map((y) => (
              <button key={y} className={year === y ? 'on' : ''} onClick={() => setYear(y)}>{y}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <span className="small muted">سود = کل فروشات − (کل مصارف + کل معاشات)</span>
          <div className="list-actions">
            <button className="btn" onClick={() => window.print()}><IconPrint size={15} /> چاپ</button>
            <ExportButton type="sales" label="خروجی" />
          </div>
        </div>
      </div>

      {!d ? <Spinner /> : (<>
        <div className="grid c4">
          <Stat label="کل فروشات سال" value={money(d.totals.totalSales)} icon={<IconChart size={16} />} />
          <Stat label="کل مصارف + معاشات" value={money(d.totals.totalExpenses)} kind="bad" icon={<IconWallet size={16} />} />
          <Stat label="سود کل" value={money(d.totals.profit)} kind="ok" icon={<IconCheck size={16} />} />
          <Stat label="زیان کل" value={money(d.totals.loss)} kind={d.totals.loss > 0 ? 'bad' : ''} icon={<IconAlert size={16} />} />
        </div>

        <div className="card">
          <div className="card-h"><h3>راپور ماهانه سال {year}</h3><div style={{ flex: 1 }} />
            <span className="badge info">{d.calendar === 'jalali' ? 'شمسی' : 'میلادی'}</span></div>
          <div className="card-b tight">
            <Table head={['ماه', 'فروشات نقده', 'فروشات قرضه', 'کل رسیدات', 'کل مصارف', 'کل معاشات', 'مجموع مصارف', 'سود خالص', 'زیان', 'متراژ']}
              foot={<tr>
                <td>مجموع سال</td>
                <td className="num">{money(d.totals.cashSales)}</td>
                <td className="num">{money(d.totals.creditSales)}</td>
                <td className="num">{money(d.totals.receipts)}</td>
                <td className="num">{money(d.totals.expenses)}</td>
                <td className="num">{money(d.totals.salaries)}</td>
                <td className="num">{money(d.totals.totalExpenses)}</td>
                <td className="num" style={{ color: 'var(--ok)' }}>{money(d.totals.profit)}</td>
                <td className="num" style={{ color: 'var(--danger)' }}>{money(d.totals.loss)}</td>
                <td className="num">{money(d.totals.volume)}</td>
              </tr>}>
              {d.rows.map((r: any) => (
                <tr key={r.month}>
                  <td style={{ fontWeight: 600 }}>{r.label}</td>
                  <td className="num">{money(r.cashSales)}</td>
                  <td className="num">{money(r.creditSales)}</td>
                  <td className="num">{money(r.receipts)}</td>
                  <td className="num">{money(r.expenses)}</td>
                  <td className="num">{money(r.salaries)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(r.totalExpenses)}</td>
                  <td className="num" style={{ color: r.profit ? 'var(--ok)' : 'inherit', fontWeight: 700 }}>{r.profit ? money(r.profit) : '—'}</td>
                  <td className="num" style={{ color: r.loss ? 'var(--danger)' : 'inherit' }}>{r.loss ? money(r.loss) : '—'}</td>
                  <td className="num">{money(r.volume)}</td>
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
