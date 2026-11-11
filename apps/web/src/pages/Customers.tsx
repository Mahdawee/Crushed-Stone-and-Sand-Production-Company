import { IconPlus } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, listImportTypes } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Text, TextArea, Num, Modal, Table, Spinner, ListHead, SearchBox, InlineStat, ImportDialog,
  ExportButton, Pager,
} from '../components/ui';
import { money } from '../lib/calendar';
import { useDebounced } from '../lib/useDebounced';
import { useLatestRequest } from '../lib/useLatestRequest';

export default function CustomersPage() {
  const { isManager } = useSession();
  const toast = useToast();
  /*
   * ── صفحه‌بندی سمت سرور (شکار باگ دور ۳۲) ────────────────────────────────
   * قبلاً **همه‌ی** مشتریان با **همه‌ی** ستون‌ها یک‌جا می‌آمد (با ۵۰۰ مشتری
   * ۱۳۶ کیلوبایت) و با هر حرف جستجو دوباره دانلود می‌شد. حالا هر صفحه
   * ۲۵ ردیف است؛ `debtTotal` را سرور روی کل نتیجه حساب می‌کند تا عدد
   * «مجموع بدهی» با صفحه‌بندی گمراه‌کننده نشود.
   */
  const [rows, setRows] = useState<any[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [debtTotal, setDebtTotal] = useState(0);
  const pageSize = 25;
  const [q, setQ] = useState('');
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  /*
   * جستجو با تأخیر (debounce).
   *
   * باگ: با هر حرف یک درخواست می‌رفت و پاسخ‌ها بی‌ترتیب برمی‌گشتند؛ در فهرست
   * مشتریان — که هر ردیفش مانده‌ی بدهی را هم حساب می‌کند — تایپ کند و پریدنی
   * می‌شد و نتیجه‌ی آخر ممکن بود نتیجه‌ی حرف‌های قبلی باشد.
   */
  const dq = useDebounced(q);
  const latest = useLatestRequest();
  /* فقط نتیجه‌ی آخرین جستجو روی جدول می‌نشیند (پاسخ‌های کهنه دور ریخته می‌شوند) */
  const load = () => latest(
    () => api.get(`/customers?q=${encodeURIComponent(dq)}&page=${page}&pageSize=${pageSize}`),
    (r: any) => {
      /* پاسخ صفحه‌بندی‌شده شیء است ({rows,total,…})؛ آرایه هم پذیرفته می‌شود
         تا اگر روزی سرور یا نسخه‌ی قدیمی آرایه داد، صفحه نشکند. */
      if (Array.isArray(r)) {
        setRows(r); setTotal(r.length);
        setDebtTotal(r.reduce((a: number, x: any) => a + Math.max(0, Number(x.balance) || 0), 0));
      } else {
        setRows(r.rows || []); setTotal(Number(r.total) || 0); setDebtTotal(Number(r.debtTotal) || 0);
      }
    },
  );
  useEffect(() => { load().catch((e) => toast.error('بارگذاری نشد', e.message)); }, [dq, page]); // eslint-disable-line react-hooks/exhaustive-deps
  /* با تغییر جستجو به صفحه‌ی اول برگرد — وگرنه نتیجه‌ی کوتاه «خالی» دیده
     می‌شود و کاربر فکر می‌کند مشتری‌ای نیست. */
  useEffect(() => { setPage(1); }, [dq]);

  const openNew = async () => {
    /*
     * باگ (شکار باگ دور ۲۵): این `await` **بیرون از try** بود. اگر شماره‌ی
     * بعدی گرفته نمی‌شد (سرور تازه بالا آمده، شبکه‌ی محلی شلوغ، نشست منقضی)،
     * استثنا به هیچ‌جا نمی‌رسید، فورم باز نمی‌شد و کاربر هیچ پیامی نمی‌دید.
     * حالا پیام روشن می‌دهد و دکمه بی‌صدا مرده نمی‌ماند.
     */
    let no = '', code = '';
    try {
      const r = await api.get('/customers/next-code');
      no = r?.no || ''; code = r?.code || '';
    } catch {
      toast.error('فورم باز نشد', 'مشکل در گرفتن کد بعدی مشتری.');
      return;
    }

    setForm({ code, name: '', contactPerson: '', phone: '', truckPlate: '', openingBalance: 0, note: '' });
  };

  const save = async () => {
    if (!form.name?.trim()) { toast.warn('نام مشتری را وارد کنید.'); return; }
    setBusy(true);
    try {
      if (form.id) await api.put(`/customers/${form.id}`, form);
      else await api.post('/customers', form);
      toast.success('مشتری ذخیره شد');
      setForm(null); await load();
    } catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const remove = (r: any) => toast.confirm({
    title: 'حذف مشتری؟',
    body: `«${r.name}» از فهرست کنار می‌رود. داده پاک نمی‌شود — از «سطل بازیافت» قابل بازگرداندن است.\nاگر فروش یا رسید ثبت‌شده داشته باشد، سیستم اجازه نمی‌دهد.`,
    confirmText: 'حذف کن',
    onConfirm: async () => {
      try { await api.del(`/customers/${r.id}`); await load(); toast.success('حذف شد'); }
      catch (e: any) { toast.error('حذف نشد', e.message); }
    },
  });

  /*
   * ── باگ (شکار باگ دور ۳۰): عدد گمراه‌کننده ──────────────────────────────
   * «مجموع بدهی» روی همان ردیف‌هایی جمع می‌شد که در جدول بود؛ یعنی وقتی
   * کاربر نام یک مشتری را جستجو می‌کرد، بالای صفحه «مجموع بدهی» فقط بدهی
   * همان یک نفر را نشان می‌داد — بی‌آنکه چیزی بگوید. مدیر ممکن بود آن را با
   * کل بدهی شرکت اشتباه بگیرد. حالا معلوم است که عدد مربوط به نتیجه‌ی
   * جستجو است.
   */
  /* از سرور می‌آید و روی **کل** نتیجه‌ی فیلتر حساب شده، نه صفحه‌ی جاری */
  const totalDebt = debtTotal;

  /*
   * ورود از اکسل — درخواست کاربر (مورد ۵): «ورود از اکسل هم باید کار کند و
   * برای کاربر یک نمونه‌ی CSV بدهید».
   * انواع ورودی‌ها از سرور خوانده می‌شود (نه لیست سخت‌کدشده در UI) تا
   * قانون «چه چیزی مجاز است» فقط یک جا باشد.
   */
  const [importOpen, setImportOpen] = useState(false);
  const [importTypes, setImportTypes] = useState<any[]>([]);
  const openImport = async () => {
    try {
      if (!importTypes.length) {
        const r = await listImportTypes();
        setImportTypes(r.items);
      }
      setImportOpen(true);
    } catch (e: any) { toast.error('فهرست ورودی خوانده نشد', e.message); }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <ListHead
          summary={<>
            <InlineStat label={dq.trim() ? 'مشتری (نتیجه‌ی جستجو)' : 'مشتری'} value={total} />
            <span className="sep" />
            <InlineStat
              label={dq.trim() ? 'مجموع بدهی (نتیجه‌ی جستجو)' : 'مجموع بدهی'}
              value={`${money(totalDebt)} ؋`}
              tone="bad"
            />
          </>}
          actions={<>
            <ExportButton type="customers" />
            {/*
              ورود گروهی فقط برای مدیر: API هم با @ManagerOnly محافظت شده.
              دکمه‌ای که کار نمی‌کند بدتر از نبودن دکمه است.
            */}
            {isManager ? (
              <button className="btn" onClick={openImport} title="ورود گروهی از فایل اکسل/CSV">ورود از اکسل</button>
            ) : null}
            <button className="btn primary" onClick={openNew}><IconPlus size={15} /> مشتری</button>
          </>}
        >
          <SearchBox value={q} onChange={setQ} placeholder="نام، کد، تماس، شخص رابط…" width={330} />
        </ListHead>
        <div className="card-b tight">
      {!rows ? <Spinner /> : (
        <Table head={['#', 'کد', 'نام مشتری / شخص رابط', 'تماس', 'پلیت', 'فروش قرضه', 'رسیدات', 'باقی مانده بدهی', '']}
          foot={rows.length ? (
            <tr>
              <td colSpan={5} className="small muted">جمع صفحه</td>
              <td className="num">{money(rows.reduce((a, r) => a + (Number(r.creditSales) || 0), 0))}</td>
              <td className="num hide-sm">{money(rows.reduce((a, r) => a + (Number(r.receipts) || 0), 0))}</td>
              <td className="num">{money(rows.reduce((a, r) => a + (Number(r.balance) || 0), 0))}</td>
              <td />
            </tr>
          ) : null}>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className="mono muted-cell">{(page - 1) * pageSize + i + 1}</td>
              <td className="mono">{r.code}</td>
              <td>
                <Link to={`/customers/${r.id}`} style={{ fontWeight: 600 }}>{r.name}</Link>
                <div className="cell-sub">{r.contactPerson || '—'}</div>
              </td>
              <td className="mono hide-sm">{r.phone || '—'}</td>
              <td className="mono hide-md">{r.truckPlate || '—'}</td>
              <td className="num">{money(r.creditSales)}</td>
              <td className="num hide-sm">{money(r.receipts)}</td>
              <td className="num" style={{ fontWeight: 800, color: r.balance > 0 ? 'var(--danger)' : r.balance < 0 ? 'var(--ok)' : 'inherit' }}>
                {money(r.balance)}
              </td>
              <td><div className="actions hover-actions">
                <Link className="btn sm" to={`/customers/${r.id}`}>کارت حساب</Link>
                <button className="btn sm" onClick={() => setForm({ ...r })}>ویرایش</button>
                {isManager ? <button className="btn sm danger" onClick={() => remove(r)}>حذف</button> : null}
              </div></td>
            </tr>
          ))}
        </Table>
      )}
      {rows && total > pageSize ? (
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      ) : null}
        </div>
      </div>

      {form ? (
        <Modal title={form.id ? 'ویرایش مشتری' : 'مشتری نو'} onClose={() => setForm(null)} onEnter={save} size="md" footer={
          <><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره'}</button>
            <button className="btn" onClick={() => setForm(null)}>انصراف</button></>}>
          <div className="form-grid c2">
            <Field label="کد مشتری" required><Text value={form.code} onChange={(v) => setForm({ ...form, code: v })} /></Field>
            <Field label="نام مشتری / شرکت" required><Text value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></Field>
            <Field label="شخص رابط"><Text value={form.contactPerson} onChange={(v) => setForm({ ...form, contactPerson: v })} /></Field>
            <Field label="شماره تماس"><Text value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></Field>
            <Field label="پلیت موتر"><Text value={form.truckPlate} onChange={(v) => setForm({ ...form, truckPlate: v })} /></Field>
            <Field label="بدهی اولیه (افغانی)" hint="باقی مانده قبلی از سیستم قدیم">
              <Num value={form.openingBalance} onChange={(v) => setForm({ ...form, openingBalance: v })} />
            </Field>
            <Field label="توضیحات" span={2}><TextArea value={form.note} onChange={(v) => setForm({ ...form, note: v })} /></Field>
          </div>
        </Modal>
      ) : null}
      {importOpen ? (
        <ImportDialog
          types={importTypes}
          onClose={() => setImportOpen(false)}
          onDone={load}
        />
      ) : null}
    </div>
  );
}
