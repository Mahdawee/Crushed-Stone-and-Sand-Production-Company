import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useToast, Spinner, Field, Select, Num, InlineStat } from '../components/ui';

/**
 * صفحه‌ی لایسنس
 *
 * درخواست کاربر (مورد ۷): «صفحه لایسنس را حرفه‌ای بازطراحی کن — هیچ عنصر یا
 * فیلد روی هم نیفتد».
 *
 * ## چه چیزی خراب بود
 * نسخه‌ی قبلی همه‌چیز را در یک ستون بلند می‌ریخت: وضعیت، جفت‌کلید، متن
 * لایسنس، دکمه‌ها. در پنجره‌ی کوچک لپ‌تاپ، `textarea` با `flex` رشد می‌کرد و
 * روی دکمه‌ها می‌افتاد؛ برچسب‌های فارسی بلند هم می‌شکستند.
 *
 * ## طراحی جدید
 *   • چیدمان دو ستونی با `min-width: 0` روی هر ستون (علت اصلی سرریز flex)
 *   • هر کارت، ارتفاع مستقل و `overflow` مهارشده
 *   • مساحت‌های لمسی بزرگ‌تر، برچسب‌های کوتاه‌تر، فاصله‌ی منظم
 *   • گام‌های شماره‌دار: «۱ وضعیت · ۲ فعال‌سازی · ۳ تمدید» — کاربر
 *     نمی‌ماند که از کجا شروع کند
 *   • ورود از فایل و از متن، هر دو در یک جا
 */
export default function LicensePage({ onBack, canContinue, onHelp }: {
  /**
   * برگشت به برنامه.
   *
   * ⚠ باگ رفع‌شده: صفحه‌ی لایسنس راه برگشت نداشت. کاربر واردش می‌شد و
   * گیر می‌کرد — حتی وقتی لایسنسش سالم بود. حالا اگر برنامه باز است،
   * همیشه دکمه‌ی «بازگشت به برنامه» بالای صفحه هست.
   */
  onBack?: () => void;
  /** آیا برنامه باز است؟ (اگر قفل باشد، برگشتی وجود ندارد) */
  canContinue?: boolean;
  /** رفتن به راهنما — با ناوبری SPA نه href */
  onHelp?: () => void;
} = {}) {
  const toast = useToast();
  const [st, setSt] = useState<any | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [clockReset, setClockReset] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  /* تمدید */
  const [renewDays, setRenewDays] = useState('365');
  const [renewNote, setRenewNote] = useState('');
  const [reqText, setReqText] = useState('');
  const [renewBusy, setRenewBusy] = useState(false);

  const load = () =>
    api.get('/license/status').then(setSt).catch((e) => toast.error('وضعیت خوانده نشد', e.message));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const activate = async (payload: { text: string } | { filename: string; content: string }) => {
    setBusy(true);
    try {
      const path = 'content' in payload ? '/license/activate-file' : '/license/activate';
      const r = await api.post(path, { ...payload, allowClockReset: clockReset });
      toast.success('لایسنس فعال شد', r.message || '');
      setText(''); setFileName('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) {
      toast.error('فعال‌سازی نشد', e?.message || 'متن لایسنس معتبر نیست.');
    } finally { setBusy(false); }
  };

  const onPickFile = async (f: File | null) => {
    if (!f) { setFileName(''); return; }
    if (f.size > 64 * 1024) { toast.error('فایل بزرگ است', 'فایل لایسنس باید کمتر از ۶۴ کیلوبایت باشد.'); return; }
    setFileName(f.name);
    const content = await f.text();
    if (!/BEGIN FARDAY LICENSE/.test(content)) {
      toast.error('این فایل لایسنس نیست', 'فایل باید با «-----BEGIN FARDAY LICENSE-----» شروع شود.');
      return;
    }
    setText(content);            /* کاربر می‌تواند قبل از تأیید ببیند */
  };

  const makeRenewRequest = async () => {
    setRenewBusy(true);
    try {
      const r = await api.post('/license/renew-request', { days: Number(renewDays) || 365, note: renewNote });
      setReqText(r.text);
      toast.success('درخواست تمدید ساخته شد', 'فایل را ذخیره کنید و برای پشتیبانی بفرستید.');
    } catch (e: any) {
      toast.error('درخواست ساخته نشد', e?.message);
    } finally { setRenewBusy(false); }
  };

  const downloadReq = () => {
    if (!reqText) return;
    const blob = new Blob([reqText], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `renew-request-${new Date().toISOString().slice(0, 10)}.req`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const copy = async (value: string, what: string) => {
    try { await navigator.clipboard.writeText(value); toast.info('کاپی شد', what); }
    catch { toast.error('کاپی نشد', 'دستی انتخاب و کاپی کنید.'); }
  };

  const badge = useMemo(() => {
    if (!st) return null;
    const map: Record<string, { t: string; c: string }> = {
      valid: { t: 'فعال', c: 'ok' },
      trial: { t: 'دوره آزمایشی', c: 'info' },
      expired: { t: 'منقضی', c: 'bad' },
      missing: { t: 'بدون لایسنس', c: 'bad' },
      invalid: { t: 'نامعتبر', c: 'bad' },
      machine: { t: 'دستگاه دیگر', c: 'bad' },
      clock: { t: 'خطای ساعت', c: 'warn' },
    };
    return map[st.state] || { t: st.state, c: 'muted' };
  }, [st]);

  if (!st) return <div className="card"><div className="card-b"><Spinner /></div></div>;

  const daysLeft = st.daysLeft ?? st.trialDaysLeft ?? null;
  const isActive = st.ok && st.state === 'valid';

  return (
    <div className="lic-page">
      {/* ---------------- ستون ۱: وضعیت ---------------- */}
      <section className="lic-col">
        <div className="card">
          {/*
            نشانگر «قفل» — کاربر باید بداند چرا صفحه‌ی برنامه بسته است.
            بدون این، صفحه‌ی لایسنس شبیه یک بن‌بست به نظر می‌رسید.
          */}
          {!canContinue ? (
            <div className="lic-back" style={{ background: 'var(--warn-soft)', borderColor: 'color-mix(in srgb, var(--warn) 30%, transparent)' }}>
              <b style={{ fontSize: '.82rem' }}>برنامه قفل است</b>
              <span className="small muted">تا لایسنس معتبر فعال نشود، بخش‌های کاری باز نمی‌شوند.</span>
            </div>
          ) : null}
          <div className="lic-head">
            <div>
              <h1 className="lic-title">لایسنس برنامه</h1>
              <p className="lic-sub">وضعیت نسخه‌ی نصب‌شده روی این دستگاه</p>
            </div>
            {badge ? <span className={`badge ${badge.c}`}>{badge.t}</span> : null}
          </div>
          {/*
            راه برگشت — همیشه دیده می‌شود، نه پنهان در پایین صفحه.
            ⚠ همین دکمه نبود که کاربر را در صفحه‌ی لایسنس زندانی می‌کرد.
          */}
          {canContinue && onBack ? (
            <div className="lic-back">
              <button className="btn primary" onClick={onBack}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
                بازگشت به برنامه
              </button>
              <span className="small muted">لایسنس معتبر است — می‌توانید کار کنید.</span>
            </div>
          ) : null}
          <div className="card-b">
            <p className={isActive ? 'lic-msg ok' : 'lic-msg warn'}>{st.message}</p>

            <div className="lic-stats">
              <InlineStat label="نوع" value={st.kindLabel || st.kind || '—'} />
              <InlineStat label="شروع" value={st.startLabel || '—'} />
              <InlineStat label="پایان" value={st.endLabel || (st.end ? st.end : 'بدون انقضا')} />
              <InlineStat
                label="روزهای باقی‌مانده"
                value={daysLeft === null || daysLeft === undefined ? '—' : String(daysLeft)}
                tone={typeof daysLeft === 'number' && daysLeft <= 7 ? 'warn' : undefined}
              />
            </div>

            <div className="lic-key">
              <span className="lic-key-l">کلید این دستگاه</span>
              <code className="lic-key-v" dir="ltr">{st.machineKey}</code>
              <button className="btn sm" onClick={() => copy(st.machineKey, 'کلید دستگاه کاپی شد.')}>کاپی</button>
            </div>
            <p className="lic-hint">{st.machineKeyNote}</p>
          </div>
        </div>

        <div className="card">
          <div className="card-b">
            <h2 className="lic-h2">راهنمای سریع</h2>
            <ol className="lic-steps">
              <li>متن لایسنس یا فایل <code dir="ltr">.lic</code> را از فروشنده بگیرید.</li>
              <li>در همین صفحه، در بخش «فعال‌سازی»، آن را وارد یا انتخاب کنید.</li>
              <li>دکمه‌ی «فعال‌سازی» را بزنید — برنامه بلافاصله باز می‌شود.</li>
            </ol>
            <p className="lic-hint">
              تمدید: از بخش «تمدید» یک درخواست بسازید و برای پشتیبانی بفرستید؛
              لایسنس جدیدی که می‌گیرید، همین‌جا آن را وارد کنید — جایگزین قبلی می‌شود.
            </p>
            <div className="lic-links">
              {canContinue && onBack ? (
                <button className="btn sm primary" onClick={onBack}>بازگشت به برنامه</button>
              ) : null}
              {/*
                «راهنما» هم با دکمه باز می‌شود، نه href: ناوبری با href کل
                سند را دوباره بارگذاری می‌کند و وضعیت صفحه را می‌ریزد.
              */}
              {onHelp ? <button className="btn sm" onClick={onHelp}>راهنما</button> : null}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- ستون ۲: فعال‌سازی + تمدید ---------------- */}
      <section className="lic-col">
        <div className="card">
          <div className="lic-head">
            <h2 className="lic-h2">فعال‌سازی / تمدید با لایسنس جدید</h2>
          </div>
          <div className="card-b">
            <Field label="فایل لایسنس">
              <input
                ref={fileRef}
                className="input" type="file" accept=".lic,.txt,text/plain"
                onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              />
            </Field>
            {fileName ? <p className="lic-hint">فایل انتخاب‌شده: <b dir="ltr">{fileName}</b></p> : null}

            <Field label="یا متن لایسنس" hint="متن را همان‌طور که هست بچسبانید">
              <textarea
                className="input lic-textarea" dir="ltr" rows={7} value={text} spellCheck={false}
                onChange={(e) => { setText(e.target.value); setFileName(''); }}
                placeholder={'-----BEGIN FARDAY LICENSE-----\nFR-1\n…\n-----END FARDAY LICENSE-----'}
              />
            </Field>

            {st.state === 'clock' ? (
              <label className="check lic-check">
                <input type="checkbox" checked={clockReset} onChange={(e) => setClockReset(e.target.checked)} />
                <span>ساعت ویندوز را درست کرده‌ام؛ مرجع زمان را هم‌تراز کن</span>
              </label>
            ) : null}

            <div className="lic-actions">
              <button
                className="btn primary" disabled={busy || !text.trim()}
                onClick={() => activate(fileName ? { filename: fileName, content: text } : { text })}
              >
                {busy ? '…' : 'فعال‌سازی'}
              </button>
              <button className="btn" disabled={!text.trim()} onClick={() => { setText(''); setFileName(''); if (fileRef.current) fileRef.current.value = ''; }}>
                پاک کردن
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="lic-head">
            <h2 className="lic-h2">تمدید</h2>
            <span className="badge muted">بدون اینترنت</span>
          </div>
          <div className="card-b">
            <p className="lic-hint" style={{ marginTop: 0 }}>
              برنامه کلید صدور لایسنس ندارد (و نباید داشته باشد). پس تمدید در دو گام انجام می‌شود:
              یک «درخواست» می‌سازید و می‌فرستید، لایسنس تازه می‌گیرید و بالای همین صفحه وارد می‌کنید.
            </p>

            <div className="lic-row">
              <Field label="مدت تمدید (روز)">
                <Select
                  value={renewDays} onChange={setRenewDays}
                  options={[
                    { value: '30', label: '۳۰ روز' },
                    { value: '90', label: '۹۰ روز' },
                    { value: '180', label: '۶ ماه' },
                    { value: '365', label: '۱ سال' },
                    { value: '730', label: '۲ سال' },
                  ]}
                />
              </Field>
              <Field label="یادداشت (اختیاری)">
                <input className="input" value={renewNote} onChange={(e) => setRenewNote(e.target.value)} placeholder="مثلاً: نام شرکت" />
              </Field>
            </div>

            <div className="lic-actions">
              <button className="btn" disabled={renewBusy} onClick={makeRenewRequest}>
                {renewBusy ? '…' : 'ساخت درخواست تمدید'}
              </button>
              {reqText ? (
                <>
                  <button className="btn" onClick={downloadReq}>ذخیره فایل</button>
                  <button className="btn" onClick={() => copy(reqText, 'درخواست کاپی شد.')}>کاپی</button>
                </>
              ) : null}
            </div>

            {reqText ? (
              <textarea className="input lic-textarea sm" dir="ltr" readOnly rows={5} value={reqText} />
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-b lic-meta">
            <div><span>سیستم</span><b dir="ltr">{st.platform || '—'}</b></div>
            <div><span>ساعت</span><b>{st.clockOk ? 'درست' : `اختلاف ${st.clockSkewHours} ساعت`}</b></div>
            <div><span>کلید عمومی</span><b>{st.publicKeyPresent ? 'موجود' : 'غایب'}</b></div>
            <div><span>فایل داده</span><b dir="ltr" className="lic-meta-path">{st.dbFile || '—'}</b></div>
          </div>
        </div>
      </section>
    </div>
  );
}
