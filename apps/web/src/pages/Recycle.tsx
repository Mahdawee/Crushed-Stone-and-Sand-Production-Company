import React, { useEffect, useState } from 'react';
import {
  useToast, Table, Spinner, ListHead, SummaryBar, K, Empty, Pager,
} from '../components/ui';
import { listRecycle, listDeleted, restoreDeleted, type RecycleTable } from '../lib/api';

/**
 * سطل بازیافت
 *
 * درخواست کاربر: «حذف‌ها نرم باشند یعنی فقط از ظاهر حذف می‌شوند ولی از
 * سابقه فعالیت‌ها قابل بازیابی بدون آسیب».
 *
 * این صفحه «ظاهر» دوم داده است: هر چیزی که حذف شده، با تاریخ و کاربر حذف،
 * اینجاست و با یک کلیک برمی‌گردد — بدون دست‌زدن به پشتیبان.
 */
export default function RecyclePage() {
  const toast = useToast();
  const [tables, setTables] = useState<RecycleTable[] | null>(null);
  const [active, setActive] = useState<string>('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<{ titleCol: string; extraCols: string[]; label: string } | null>(null);
  const [busy, setBusy] = useState(0);
  /*
   * صفحه‌بندی سمت سرور (شکار باگ دور ۳۲): قبلاً تا ۱۰۰۰ ردیف یک‌جا می‌آمد.
   * حالا هر صفحه ۱۰۰ ردیف، و «جمع کل» از سرور می‌آید.
   */
  const [page, setPage] = useState(1);
  const [binTotal, setBinTotal] = useState(0);
  const pageSize = 100;

  const loadSummary = () =>
    listRecycle()
      .then((r) => {
        setTables(r.items);
        /* اگر جدول فعال خالی شد، اولین جدولِ دارای داده را نشان بده */
        setActive((cur) => cur || (r.items.find((i) => i.count > 0)?.table ?? r.items[0]?.table ?? ''));
      })
      .catch((e) => toast.error('بارگذاری نشد', e.message));

  useEffect(() => { loadSummary(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!active) return;
    setRows(null);
    listDeleted(active, page, pageSize)
      .then((r) => {
        setRows(r.rows);
        setBinTotal(Number(r.total ?? r.rows.length) || 0);
        setMeta({ titleCol: r.titleCol, extraCols: r.extraCols, label: r.label });
      })
      .catch((e) => toast.error('بارگذاری نشد', e.message));
  }, [active, page]); // eslint-disable-line react-hooks/exhaustive-deps
  /* با عوض شدن جدولِ فعال، به صفحه‌ی اول برگرد (وگرنه صفحه‌ی ۳ یک جدول
     با ۵ ردیف، «خالی» دیده می‌شود). */
  useEffect(() => { setPage(1); }, [active]);

  const doRestore = (id: number) => toast.confirm({
    title: 'بازگرداندن ردیف',
    body: 'این ردیف به همه‌ی فهرست‌ها و گزارش‌ها برمی‌گردد. مطمئن هستید؟',
    confirmText: 'بازگردان',
    kind: 'primary',
    onConfirm: async () => {
      setBusy(id);
      try {
        await restoreDeleted(active, id);
        toast.success('بازگردانی شد', 'ردیف دوباره در فهرست دیده می‌شود.');
        setRows((r) => (r || []).filter((x) => x.id !== id));
        loadSummary();
      } catch (e: any) {
        toast.error('بازگردانی نشد', e?.message);
      } finally { setBusy(0); }
    },
  });

  const total = (tables || []).reduce((a, t) => a + t.count, 0);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <ListHead actions={
          <SummaryBar>
            <K label="ردیف‌های حذف‌شده" value={total} />
            <span className="sep" />
            <span className="muted">حذف نرم — داده پاک نمی‌شود</span>
          </SummaryBar>
        }>
          <h1 style={{ margin: 0, fontSize: '1rem' }}>سطل بازیافت</h1>
        </ListHead>
        <div className="card-b tight">
          {!tables ? <Spinner /> : (
            <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 2px 10px' }}>
              {tables.map((t) => (
                <button
                  key={t.table}
                  type="button"
                  className={`filter-chip${active === t.table ? ' on' : ''}`}
                  onClick={() => setActive(t.table)}
                  disabled={t.count === 0 && active !== t.table}
                  title={t.count === 0 ? 'چیزی برای بازیابی نیست' : `${t.count} ردیف حذف‌شده`}
                >
                  {t.label}
                  <span className="badge" style={{ marginInlineStart: 6 }}>{t.count}</span>
                </button>
              ))}
            </div>
          )}

          {!rows ? <Spinner /> : rows.length === 0 ? (
            <Empty
              title="چیزی حذف نشده"
              hint="هر ردیفی که در بخش‌ها حذف شود، به اینجا می‌آید و می‌توانید بدون آسیب بازگردانید."
            />
          ) : (
            <Table
              head={['#', meta?.label === 'حضور و غیاب' ? 'تاریخ' : 'عنوان', ...(meta?.extraCols || []).map(faCol), 'حذف توسط', 'زمان حذف', '']}
              empty="ردیفی نیست."
            >
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="mono small">{(page - 1) * pageSize + i + 1}</td>
                  <td><b>{r[meta?.titleCol || 'id'] ?? r.id}</b></td>
                  {(meta?.extraCols || []).map((c) => (
                    <td key={c} className={c === 'amount' || c === 'total' || c === 'amountAfn' ? 'mono' : ''}>
                      {c === 'amount' || c === 'total' || c === 'amountAfn'
                        ? Number(r[c] || 0).toLocaleString('fa-IR')
                        : (r[c] ?? '—')}
                    </td>
                  ))}
                  <td className="small">{r.deletedBy || '—'}</td>
                  <td className="small mono">{faWhen(r.deletedAt)}</td>
                  <td style={{ textAlign: 'end' }}>
                    <button className="btn sm" disabled={busy === r.id} onClick={() => doRestore(r.id)}>
                      {busy === r.id ? '…' : 'بازگرداندن'}
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {rows && rows.length > 0 && binTotal > pageSize ? (
            <>
              <Pager page={page} pageSize={pageSize} total={binTotal} onPage={setPage} />
              <p className="small muted" style={{ margin: 0 }}>
                {`${binTotal.toLocaleString('fa-IR')} ردیف حذف‌شده در این بخش — صفحه‌ی ${page.toLocaleString('fa-IR')}`}
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-b">
          <p className="small muted" style={{ margin: 0, lineHeight: 1.9 }}>
            <b>حذف در این برنامه یعنی چه؟</b> ردیف از همه‌ی فهرست‌ها و گزارش‌ها پنهان می‌شود ولی
            از دیتابیس پاک نمی‌شود؛ به همین دلیل بازگرداندنش هیچ محاسبه‌ی دیگری را خراب نمی‌کند.
            زمان و نام کسی که حذف کرده هم ثبت می‌شود.
          </p>
        </div>
      </div>
    </div>
  );
}

const FA_COLS: Record<string, string> = {
  customerName: 'مشتری', employeeName: 'کارمند', description: 'شرح', code: 'کد',
  position: 'وظیفه', phone: 'تلفن', amount: 'مبلغ', amountAfn: 'مبلغ (؋)', total: 'مجموع',
};
function faCol(c: string) { return FA_COLS[c] || c; }

/** تاریخ/زمان ISO → «۱۴۰۴/۰۸/۱۹ ۱۴:۳۰» */
function faWhen(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString('fa-IR-u-ca-persian', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return d.toLocaleString('fa-IR'); }
}
