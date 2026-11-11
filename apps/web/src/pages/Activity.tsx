import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import {
  useToast, Table, Spinner, Select, ListHead, SummaryBar, K, Empty, Field, Num,
} from '../components/ui';

/**
 * سابقه فعالیت — **ادغام‌شده با سطل بازیافت**.
 *
 * درخواست کاربر: «سطل بازیافت را در بخش سابقه فعالیت ادغام کن».
 *
 * ## ایراد نسخه‌ی قبل
 * کاربر برای فهمیدن «چه چیزی حذف شد، چه کسی حذف کرد و چطور برمی‌گردد» باید
 * دو صفحه را جدا می‌دید: «سابقه فعالیت» فقط یک سطر «حذف» نشان می‌داد و
 * «سطل بازیافت» ردیف‌ها را — بدون هم‌زمان‌دیدن با بقیه‌ی رویدادها.
 *
 * ## حالا
 * سه نمای یک صفحه:
 *   • **همه رویدادها** (ستون زمانی): ثبت، ویرایش، حذف، ورود/خروج، خروجی —
 *     و روی هر حذفی که ردیفش هنوز در سطل است، دکمه‌ی «بازگرداندن».
 *   • **سطل بازیافت**: فهرست ردیف‌های هر بخش با زمان و کاربر حذف.
 *   • **داده‌ی نمونه**: نصب/حذف موقت داده‌ی نمونه (درخواست کاربر).
 */
const LABEL: Record<string, string> = {
  create: 'ثبت', update: 'ویرایش', delete: 'حذف', 'soft-delete': 'حذف (سطل بازیافت)',
  login: 'ورود', logout: 'خروج', export: 'خروجی', backup: 'پشتیبان', restore: 'بازگرداندن',
  'demo-install': 'نصب داده نمونه', 'demo-remove': 'حذف داده نمونه',
};
const ENTITY_FA: Record<string, string> = {
  Sale: 'فروشات', Receipt: 'رسیدات', Expense: 'مصارف', Salary: 'معاشات', Employee: 'کارمندان',
  Customer: 'مشتریان', User: 'کاربران', LookupItem: 'فهرست‌ها', System: 'سیستم', Attendance: 'حضور و غیاب',
  Company: 'شرکت', Machinery: 'ماشینری', Auth: 'ورود و خروج',
};
const COLORS: Record<string, string> = {
  create: 'ok', update: 'info', delete: 'bad', 'soft-delete': 'bad', login: 'muted', logout: 'muted',
  export: 'warn', backup: 'warn', restore: 'ok', 'demo-install': 'warn', 'demo-remove': 'warn',
};

type View = 'events' | 'bin' | 'demo';

export default function ActivityPage() {
  const toast = useToast();
  const [view, setView] = useState<View>('events');
  const [rows, setRows] = useState<any[] | null>(null);
  const [entity, setEntity] = useState('');
  const [bins, setBins] = useState<{ items: any[]; total: number; bins: Record<string, any[]> } | null>(null);
  const [activeBin, setActiveBin] = useState('');
  const [demo, setDemo] = useState<any>(null);
  const [months, setMonths] = useState(2);
  const [busy, setBusy] = useState('');

  const loadEvents = () => api
    .get(`/system/timeline?limit=400${entity ? `&entity=${entity}` : ''}`)
    .then(setRows)
    .catch((e) => toast.error('بارگذاری نشد', e.message));

  const loadBins = () => api.get('/recycle/bins')
    .then((r: any) => {
      setBins(r);
      setActiveBin((cur) => cur || r.items.find((i: any) => i.count > 0)?.table || r.items[0]?.table || '');
    })
    .catch((e) => toast.error('سطل بازیافت بارگذاری نشد', e.message));

  const loadDemo = () => api.get('/system/demo').then(setDemo).catch(() => setDemo({ counts: { total: 0 }, real: {} }));

  useEffect(() => { if (view === 'events') loadEvents(); }, [entity, view]);
  useEffect(() => { if (view === 'bin') loadBins(); }, [view]);
  useEffect(() => { if (view === 'demo') loadDemo(); }, [view]);

  const restore = (table: string, id: number) => toast.confirm({
    title: 'بازگرداندن ردیف',
    body: 'این ردیف به همه‌ی فهرست‌ها و گزارش‌ها برمی‌گردد. مطمئن هستید؟',
    confirmText: 'بازگردان',
    kind: 'primary',
    onConfirm: async () => {
      setBusy(`${table}:${id}`);
      try {
        await api.post(`/recycle/${encodeURIComponent(table)}/${id}/restore`, {});
        toast.success('بازگرداندی شد', 'ردیف دوباره در فهرست دیده می‌شود.');
        await Promise.all([loadEvents(), loadBins()]);
      } catch (e: any) { toast.error('بازگرداندی نشد', e.message); }
      finally { setBusy(''); }
    },
  });

  const installDemo = () => toast.confirm({
    title: 'نصب داده‌ی نمونه',
    body: demo?.real && (demo.real.sales || demo.real.employees || demo.real.customers)
      ? 'در این دیتابیس داده‌ی واقعی وجود دارد؛ داده‌ی نمونه در گزارش‌ها با آن دیده می‌شود. ادامه می‌دهید؟'
      : `برای تمرین، ${months} ماه داده‌ی نمونه ساخته می‌شود (کارمند، مشتری، فروش، رسید، مصرف، معاش و حضور). هیچ داده‌ی واقعی لمس نمی‌شود.`,
    confirmText: 'نصب کن',
    kind: 'primary',
    onConfirm: async () => {
      setBusy('demo-install');
      try {
        const r: any = await api.post('/system/demo/install', {
          months, force: true,
        });
        toast.success('داده‌ی نمونه نصب شد', r?.message);
        await loadDemo();
      } catch (e: any) { toast.error('نصب نشد', e.message); }
      finally { setBusy(''); }
    },
  });

  const removeDemo = () => toast.confirm({
    title: 'حذف داده‌ی نمونه',
    body: 'همه‌ی ردیف‌های نمونه به «سطل بازیافت» می‌روند — داده‌ی واقعی دست نمی‌خورد و بازگرداندن هم ممکن است.',
    confirmText: 'حذف کن',
    onConfirm: async () => {
      setBusy('demo-remove');
      try {
        const r: any = await api.post('/system/demo/remove', {});
        toast.success('حذف شد', r?.message);
        await loadDemo();
        await loadBins();
      } catch (e: any) { toast.error('حذف نشد', e.message); }
      finally { setBusy(''); }
    },
  });

  const binRows = useMemo(() => (bins && activeBin ? bins.bins[activeBin] || [] : []), [bins, activeBin]);
  const binMeta = useMemo(() => (bins?.items || []).find((i) => i.table === activeBin) || null, [bins, activeBin]);
  const restorableCount = useMemo(() => (rows || []).filter((r) => r.restorable).length, [rows]);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <ListHead actions={
          <SummaryBar>
            {view === 'events' ? (
              <>
                <K label="رویدادها" value={(rows || []).length} />
                <span className="sep" />
                <K label="قابل بازگرداندن" value={restorableCount} />
              </>
            ) : view === 'bin' ? (
              <>
                <K label="ردیف‌های حذف‌شده" value={bins?.total ?? 0} />
                <span className="sep" />
                <span className="muted">حذف نرم — داده پاک نمی‌شود</span>
              </>
            ) : (
              <>
                <K label="ردیف نمونه" value={demo?.counts?.total ?? 0} />
                <span className="sep" />
                <span className="muted">برای تمرین — هر زمان قابل حذف</span>
              </>
            )}
          </SummaryBar>
        }>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <h1 style={{ margin: 0, fontSize: '1rem' }}>سابقه فعالیت</h1>
            <div className="seg">
              <button className={`btn sm${view === 'events' ? ' primary' : ''}`} onClick={() => setView('events')}>همه رویدادها</button>
              <button className={`btn sm${view === 'bin' ? ' primary' : ''}`} onClick={() => setView('bin')}>سطل بازیافت</button>
              <button className={`btn sm${view === 'demo' ? ' primary' : ''}`} onClick={() => setView('demo')}>داده‌ی نمونه</button>
            </div>
          </div>
          {view === 'events' ? (
            <Select value={entity} onChange={setEntity} placeholder="همه بخش‌ها"
              options={Object.entries(ENTITY_FA).map(([x, l]) => ({ value: x, label: l }))} />
          ) : null}
        </ListHead>

        <div className="card-b tight">
          {view === 'events' ? (
            !rows ? <Spinner /> : (
              <Table head={['زمان', 'کاربر', 'عمل', 'بخش', 'تفصیل', '']} empty="سابقه‌ای موجود نیست.">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono small">{faWhen(r.createdAt)}</td>
                    <td className="mono">{r.username}</td>
                    <td><span className={`badge ${COLORS[r.action] || 'muted'}`}>{LABEL[r.action] || r.action}</span></td>
                    <td className="small">{ENTITY_FA[r.entity] || r.entityLabel || r.entity}</td>
                    <td className="small hide-sm">
                      {r.detail || (r.rowTitle ? `${r.rowTitle}` : '')}
                      {r.restorable && !r.detail ? ` — ${ENTITY_FA[r.entity] || r.entity} ${r.rowTitle}` : ''}
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      {r.restorable ? (
                        <button className="btn sm" disabled={busy === `${r.entity}:${r.entityId}`}
                          onClick={() => restore(r.entity, Number(r.entityId))}>
                          {busy === `${r.entity}:${r.entityId}` ? '…' : 'بازگرداندن'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
            )
          ) : view === 'bin' ? (
            !bins ? <Spinner /> : (
              <>
                <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 2px 10px' }}>
                  {bins.items.map((t) => (
                    <button key={t.table} type="button"
                      className={`filter-chip${activeBin === t.table ? ' on' : ''}`}
                      onClick={() => setActiveBin(t.table)}
                      disabled={t.count === 0 && activeBin !== t.table}
                      title={t.count === 0 ? 'چیزی برای بازگرداندن نیست' : `${t.count} ردیف حذف‌شده`}>
                      {t.label}
                      <span className="badge" style={{ marginInlineStart: 6 }}>{t.count}</span>
                    </button>
                  ))}
                </div>
                {binRows.length === 0 ? (
                  <Empty title="چیزی حذف نشده" hint="هر ردیفی که در بخش‌های برنامه حذف شود، به اینجا می‌آید و بدون آسیب بازگرداندنی است." />
                ) : (
                  <Table
                    head={['#', binMeta?.label === 'حضور و غیاب' ? 'تاریخ' : 'عنوان',
                      ...(binMeta?.extraCols || []).map(faCol), 'حذف توسط', 'زمان حذف', '']}
                    empty="ردیفی نیست.">
                    {binRows.map((r, i) => (
                      <tr key={r.id}>
                        <td className="mono small">{i + 1}</td>
                        <td><b>{r[binMeta?.titleCol || 'id'] ?? r.id}</b></td>
                        {(binMeta?.extraCols || []).map((c) => (
                          <td key={c} className={c === 'amount' || c === 'total' || c === 'amountAfn' ? 'mono' : ''}>
                            {c === 'amount' || c === 'total' || c === 'amountAfn'
                              ? money(r[c])
                              : (r[c] ?? '—')}
                          </td>
                        ))}
                        <td className="small">{r.deletedBy || '—'}</td>
                        <td className="small mono">{faWhen(r.deletedAt)}</td>
                        <td style={{ textAlign: 'end' }}>
                          <button className="btn sm" disabled={busy === `${activeBin}:${r.id}`}
                            onClick={() => restore(activeBin, r.id)}>
                            {busy === `${activeBin}:${r.id}` ? '…' : 'بازگرداندن'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </>
            )
          ) : (
            !demo ? <Spinner /> : (
              <div className="col" style={{ gap: 12, padding: 4 }}>
                <p className="small muted" style={{ margin: 0, lineHeight: 1.9 }}>
                  داده‌ی نمونه برای <b>تمرین و آموزش</b> است: چند ماه فروش، رسید، مصرف، معاش و حضور و غیاب ساخته می‌شود
                  تا ببینید راپورها و فرمول‌ها چطور کار می‌کنند. این داده با پرچم «نمونه» ذخیره می‌شود، پس هر زمان
                  بدانید کدام ردیف نمونه است و حذف آن هم فقط همان ردیف‌ها را برمی‌دارد (به سطل بازیافت).
                </p>
                <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <Field label="چند ماه داده" hint="۱ تا ۶ ماه">
                    <Num value={months} onChange={(v) => setMonths(Math.min(6, Math.max(1, Number(v) || 1)))} max={6} />
                  </Field>
                  <button className="btn primary" disabled={busy !== '' || demo.installed} onClick={installDemo}>
                    {busy === 'demo-install' ? 'در حال نصب…' : demo.installed ? 'داده‌ی نمونه نصب است' : 'نصب داده‌ی نمونه'}
                  </button>
                  <button className="btn danger" disabled={busy !== '' || !demo.installed} onClick={removeDemo}>
                    {busy === 'demo-remove' ? 'در حال حذف…' : 'حذف داده‌ی نمونه'}
                  </button>
                </div>
                <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
                  {Object.entries(demo.counts || {}).filter(([k]) => k !== 'total').map(([k, v]) => (
                    <span key={k} className="small">
                      {ENTITY_FA[k] || k}: <b className="mono">{Number(v).toLocaleString('fa-IR')}</b>
                    </span>
                  ))}
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  داده‌ی واقعی این دیتابیس: فروشات <b>{Number(demo.real?.sales || 0).toLocaleString('fa-IR')}</b> —
                  کارمندان <b>{Number(demo.real?.employees || 0).toLocaleString('fa-IR')}</b> —
                  مشتریان <b>{Number(demo.real?.customers || 0).toLocaleString('fa-IR')}</b>.
                  {' '}<Link to="/recycle">صفحه‌ی قبلی سطل بازیافت</Link> هنوز هست؛ هر دو یک داده را نشان می‌دهند.
                </p>
              </div>
            )
          )}
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
function money(v: any) {
  const n = Number(v) || 0;
  return n.toLocaleString('fa-IR');
}

/** تاریخ/زمان ISO → «۱۴۰۴/۰۸/۱۹ ۱۴:۳۰» */
function faWhen(iso: string) {
  if (!iso) return '—';
  const raw = String(iso);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    return d.toLocaleString('fa-IR-u-ca-persian', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return d.toLocaleString('fa-IR'); }
}
