import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast, Table, Spinner } from '../components/ui';
import { money } from '../lib/calendar';

export default function ReportsYearly() {
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/reports/yearly').then(setD).catch((e) => toast.error('بارگذاری نشد', e.message)); }, []);
  if (!d) return <Spinner />;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between no-print">
        <span className="small muted">خلاصه هر سال مالی — افغانی</span>
        <button className="btn" onClick={() => window.print()}>🖨 چاپ</button>
      </div>
      <div className="card">
        <div className="card-h"><h3>راپور سالانه</h3></div>
        <div className="card-b tight">
          <Table head={['سال مالی', 'کل فروشات', 'کل مصارف', 'کل معاشات', 'مجموع مصارف', 'کل رسیدات', 'سود', 'زیان', 'توضیحات']}>
            {d.rows.map((r: any) => (
              <tr key={r.year}>
                <td style={{ fontWeight: 700 }}>{r.year}</td>
                <td className="num">{money(r.sales)}</td>
                <td className="num">{money(r.expenses)}{r.expensesUsd ? <span className="badge warn" style={{ marginInlineStart: 4 }}>${money(r.expensesUsd)}</span> : null}</td>
                <td className="num">{money(r.salaries)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(r.totalExpenses)}</td>
                <td className="num">{money(r.receipts)}</td>
                <td className="num" style={{ color: 'var(--ok)', fontWeight: 700 }}>{r.profit ? money(r.profit) : '—'}</td>
                <td className="num" style={{ color: 'var(--danger)' }}>{r.loss ? money(r.loss) : '—'}</td>
                <td className="small muted">—</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </div>
  );
}
