import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast, InlineStat, SearchBox, Spinner, Table } from '../components/ui';
import { money } from '../lib/calendar';
import { IconCoins, IconContact, IconSearchDoc } from '../components/icons';

/**
 * بدهی‌ها و یادآوری — پیشنهاد C5، دور ۴۰.
 *
 * ── چرا این صفحه ─────────────────────────────────────────────────────────
 * داشبورد ۶ بدهکار بزرگ را نشان می‌داد، ولی برای **پیگیری** کافی نبود:
 *   • نمی‌شد فهمید بدهی از کِی مانده (بدهی یک‌هفته‌ای و شش‌ماهه یکی نیست)
 *   • برای فرستادن پیام، مغازه‌دار باید عدد را دستی از جای دیگر برمی‌داشت
 *     — و همان‌جا عدد اشتباه می‌شد
 *   • مدیر نمی‌دانست «چقدر از پول‌های ما بیش از سه ماه است گیر است»
 *
 * ── تصمیم‌های طراحی ─────────────────────────────────────────────────────
 *   • عددها **همه** از سرور می‌آیند (`/api/debts`). رابط هیچ جمعی نمی‌زند؛
 *     اگر بزند، دیر یا زود با کارت حساب و راپور تفصیلی اختلاف پیدا می‌کند —
 *     همان باگ «سه صفحه، سه عدد» (دور ۳۲).
 *   • متن یادآوری هم از سرور می‌آید (`/debts/:id/reminder`)، نه از رابط.
 *   • استفاده از `navigator.clipboard` با **پلن ب**: روی نصب‌های قدیمی
 *     ویندوز/مرورگر بی‌اجازه، کلیپ‌بورد کار نمی‌کند؛ در آن حالت متن را
 *     انتخاب‌شده در یک کادر نشان می‌دهیم تا کاربر خودش Ctrl+C بزند. اگر
 *     فقط به clipboard تکیه می‌کردیم، دکمه «کاپی» بی‌صدا هیچ نمی‌کرد.
 *   • پیوند واتساپ فقط شماره‌ی مشتریِ ثبت‌شده را باز می‌کند؛ اگر شماره
 *     نباشد دکمه **غیرفعال** است، نه اینکه پیام بی‌مقصد باز شود.
 */

type Row = {
  id: number; code: string; name: string; phone: string;
  balance: number; oldestDate: string; days: number;
  bucket: '0-30' | '31-60' | '61-90' | '90+';
  overdue: boolean; fromOpening: boolean;
};

const BUCKETS: { key: Row['bucket']; label: string; tone: string }[] = [
  { key: '0-30', label: 'تا ۳۰ روز', tone: 'ok' },
  { key: '31-60', label: '۳۱ تا ۶۰ روز', tone: 'warn' },
  { key: '61-90', label: '۶۱ تا ۹۰ روز', tone: 'warn' },
  { key: '90+', label: 'بیش از ۹۰ روز', tone: 'bad' },
];

export default function DebtsPage() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'' | Row['bucket'] | 'overdue'>('');
  const [busy, setBusy] = useState(false);
  const [reminder, setReminder] = useState<{ id: number; text: string; phone: string; ok: boolean; message?: string } | null>(null);

  /*
   * `alive` مثل بقیه‌ی صفحه‌ها: اگر کاربر پیش از رسیدن پاسخ صفحه را عوض
   * کند، `setState` روی کامپوننتِ رفته اجرا نمی‌شود (الگوی PrintSale).
   */
  useEffect(() => {
    let alive = true;
    setErr('');
    api.get('/debts')
      .then((r: any) => { if (alive) setData(r); })
      .catch((e: any) => { if (alive) setErr(e?.message || 'فهرست بدهی‌ها خوانده نشد.'); });
    return () => { alive = false; };
  }, []);

  const rows: Row[] = data?.rows || [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (only === 'overdue' && !r.overdue) return false;
      if (only && only !== 'overdue' && r.bucket !== only) return false;
      if (!needle) return true;
      return r.name.toLowerCase().includes(needle)
        || r.code.toLowerCase().includes(needle)
        || r.phone.includes(needle);
    });
  }, [rows, q, only]);

  const shownTotal = shown.reduce((a, r) => a + r.balance, 0);

  const openReminder = async (r: Row) => {
    setBusy(true);
    setReminder(null);
    try {
      const res: any = await api.get(`/debts/${r.id}/reminder`);
      setReminder({ id: r.id, text: res.text || '', phone: res.phoneDigits || r.phone, ok: !!res.ok, message: res.message });
    } catch (e: any) {
      toast.error('متن یادآوری ساخته نشد', e?.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('متن کاپی شد.');
    } catch {
      /*
       * پلن ب: کلیپ‌بورد در دسترس نیست (مرورگر قدیمی، صفحه‌ی http، یا
       * نبود اجازه). متن در کادر باز و قابل انتخاب است، پس فقط راهنمایی
       * می‌کنیم — هرگز نمی‌گوییم «کاپی شد» وقتی نشده.
       */
      toast.warn('کاپی خودکار ممکن نشد — متن را انتخاب و Ctrl+C بزنید.');
    }
  };

  if (err) {
    return (
      <div className="card">
        <p className="muted">{err}</p>
        <button className="btn" onClick={() => location.reload()}>تلاش دوباره</button>
      </div>
    );
  }
  if (!data) return <Spinner />;

  const overdueCount = Number(data.overdueCount) || 0;

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* ── خلاصه ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="list-summary" style={{ flexWrap: 'wrap' }}>
          <InlineStat label="مجموع بدهی" value={`${money(data.total)} ؋`} tone="bad" />
          <InlineStat label="بدهکاران" value={data.count} />
          <InlineStat
            label={`بیش از ${data.overdueAfter} روز`}
            value={overdueCount}
            tone={overdueCount ? 'warn' : undefined}
          />
          <span style={{ flex: 1 }} />
          <Link className="btn sm" to="/reports/detail">راپور تفصیلی</Link>
        </div>

        {/*
         * تقسیم بر «عمر» — این تنها عددی است که به تصمیم کمک می‌کند:
         *   «۱۰۰٬۰۰۰ بدهی داریم» بی‌فایده است اگر ۹۰٬۰۰۰ آن همین ماه
         *   باشد؛ و خطرناک است اگر ۹۰٬۰۰۰ آن سال گذشته باشد.
         */}
        <div className="chip-row" style={{ marginTop: 12 }}>
          {BUCKETS.map((b) => {
            const sum = Number(data.buckets?.[b.key] || 0);
            const active = only === b.key;
            return (
              <button
                key={b.key}
                className={`btn sm ${active ? 'primary' : ''}`}
                onClick={() => setOnly(active ? '' : b.key)}
                title={active ? 'برداشتن فلتر' : `فقط ${b.label}`}
                aria-pressed={active}
              >
                {b.label}
                <span className={`badge ${b.tone}`} style={{ marginInlineStart: 6 }}>{money(sum)}</span>
              </button>
            );
          })}
          {overdueCount > 0 ? (
            <button
              className={`btn sm ${only === 'overdue' ? 'primary' : ''}`}
              onClick={() => setOnly(only === 'overdue' ? '' : 'overdue')}
              aria-pressed={only === 'overdue'}
            >
              فقط نیاز به پیگیری
              <span className="badge warn" style={{ marginInlineStart: 6 }}>{overdueCount}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* ── فهرست ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="list-head">
          <SearchBox value={q} onChange={setQ} placeholder="جستجوی نام، کد یا شماره…" width={280} />
          <div className="list-summary">
            <InlineStat
              label={q.trim() || only ? 'نمایش‌داده‌شده' : 'همه'}
              value={`${shown.length} نفر — ${money(shownTotal)} ؋`}
            />
          </div>
          <div style={{ flex: 1 }} />
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-ico"><IconCoins /></div>
            <p>هیچ مشتری‌ای بدهکار نیست.</p>
          </div>
        ) : (
          <Table
            compact
            empty="با این جستجو یا فلتر ردیفی پیدا نشد."
            head={['کد', 'مشتری', 'شماره', 'بدهی (؋)', 'قدیمی‌ترین بل', 'عمر', '']}
          >
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="muted">{r.code}</td>
                <td><Link to={`/customers/${r.id}/statement`}>{r.name}</Link></td>
                <td className="muted" dir="ltr">{r.phone || '—'}</td>
                <td className="num"><b>{money(r.balance)}</b></td>
                <td className="muted">
                  {/*
                   * «مانده‌ی قبلی» تاریخ ندارد. نوشتن «امروز» یا یک تاریخ
                   * حدسی، دروغ است — پس صادقانه برچسب می‌خورد.
                   */}
                  {r.fromOpening
                    ? <span title="از حساب قبلی مشتری، بدون سند فروش">مانده‌ی قبلی</span>
                    : (r.oldestDate || '—')}
                </td>
                <td>
                  {r.fromOpening
                    ? <span className="badge muted">نامعلوم</span>
                    : (
                      <span className={`badge ${r.days > 90 ? 'bad' : r.days > 30 ? 'warn' : 'ok'}`}>
                        {r.days} روز
                      </span>
                    )}
                </td>
                <td className="actions">
                  <button className="btn sm" onClick={() => openReminder(r)} disabled={busy}>
                    یادآوری
                  </button>
                  <Link className="btn sm" to={`/customers/${r.id}/statement`}>
                    <IconSearchDoc /> کارت حساب
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* ── متن یادآوری ────────────────────────────────────────────────── */}
      {reminder ? (
        <div className="card">
          <div className="list-head">
            <b>متن یادآوری</b>
            <div style={{ flex: 1 }} />
            <div className="list-actions">
              <button className="btn sm" onClick={() => setReminder(null)}>بستن</button>
            </div>
          </div>
          {!reminder.ok ? (
            <p className="muted">{reminder.message || 'یادآوری لازم نیست.'}</p>
          ) : (
            <>
              <textarea className="input" readOnly rows={6} value={reminder.text} dir="rtl" />
              <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                <button className="btn primary sm" onClick={() => copy(reminder.text)}>
                  کاپی متن
                </button>
                {reminder.phone ? (
                  <a
                    className="btn sm"
                    href={`https://wa.me/${reminder.phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(reminder.text)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ارسال در واتساپ
                  </a>
                ) : (
                  <button className="btn sm" disabled title="شماره‌ی این مشتری ثبت نشده">
                    ارسال در واتساپ
                  </button>
                )}
                <Link className="btn sm" to={`/customers/${reminder.id}/statement`}>
                  <IconContact /> کارت حساب
                </Link>
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: '.78rem' }}>
                عدد این متن همان عدد کارت حساب است؛ می‌توانید پیش از فرستادن ویرایش کنید.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
