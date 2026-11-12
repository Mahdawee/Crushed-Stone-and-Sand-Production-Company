import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { IconAlert, IconCheck, IconChevron, IconClose, IconDownload, IconFilter, IconInfo, IconSearchDoc } from './icons';
import { downloadCsv, downloadImportTemplate, readFileAsText, runImport, type ImportReport } from '../lib/api';

/* =============================== toasts =============================== */
type ToastKind = 'ok' | 'bad' | 'warn' | 'info';
type Toast = { id: number; kind: ToastKind; title: string; body?: string };
type ToastApi = {
  push: (kind: ToastKind, title: string, body?: string) => void;
  success: (t: string, b?: string) => void;
  error: (t: string, b?: string) => void;
  warn: (t: string, b?: string) => void;
  info: (t: string, b?: string) => void;
  confirm: (opts: { title: string; body?: string; confirmText?: string; kind?: 'danger' | 'primary'; onConfirm: () => void }) => void;
};
const ToastCtx = createContext<ToastApi>(null as any);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<any>(null);
  const idRef = useRef(1);

  const push = useCallback((kind: ToastKind, title: string, body?: string) => {
    const id = idRef.current++;
    setItems((prev) => [...prev.slice(-4), { id, kind, title, body }]);
    const ttl = kind === 'bad' ? 9000 : kind === 'warn' ? 7500 : 5500;
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), ttl);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    push,
    success: (t, b) => push('ok', t, b),
    error: (t, b) => push('bad', t, b),
    warn: (t, b) => push('warn', t, b),
    info: (t, b) => push('info', t, b),
    confirm: (opts) => setAsk({ ...opts, kind: opts.kind || 'danger' }),
  }), [push]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAsk(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ico: Record<ToastKind, React.ReactNode> = {
    ok: <IconCheck size={17} />, bad: <IconAlert size={17} />, warn: <IconAlert size={17} />, info: <IconInfo size={17} />,
  };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts no-print">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}>
            <div className="t-ico">{ico[t.kind]}</div>
            <div className="t-body"><strong>{t.title}</strong>{t.body ? <span>{t.body}</span> : null}</div>
          </div>
        ))}
      </div>
      {ask ? (
        <div className="modal-back no-print" onClick={() => setAsk(null)}>
          <div className="modal sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h"><h3>{ask.title}</h3></div>
            <div className="modal-b"><p className="small" style={{ color: 'var(--text-2)' }}>{ask.body}</p></div>
            <div className="modal-f">
              <button className={`btn ${ask.kind === 'danger' ? 'danger' : 'primary'}`}
                onClick={() => { const f = ask.onConfirm; setAsk(null); f?.(); }}>
                {ask.confirmText || 'تأیید'}
              </button>
              <button className="btn" onClick={() => setAsk(null)}>انصراف</button>
            </div>
          </div>
        </div>
      ) : null}
    </ToastCtx.Provider>
  );
}

/* ================================ modal =============================== */
/**
 * فرم مودال.
 *
 * باگ جدی (گزارش کاربر: «با وارد کردن یک عدد یا حرف، فیلد دیگر تایپ نمی‌شود
 * تا دوباره کلیک کنی»):
 *   افکت زیر هم `addEventListener` را می‌ساخت و هم `boxRef.current.focus()` را
 *   صدا می‌زد، و در لیست وابستگی‌ها `onClose` بود. در همه‌ی صفحه‌ها `onClose`
 *   به‌صورت `() => setForm(null)` نوشته می‌شود — یعنی یک تابع تازه در هر رندر.
 *   پس با هر بار تایپ، state فرم عوض می‌شد → رندر → `onClose` تازه → افکت
 *   دوباره اجرا → فوکوس از کادر ورودی دزدیده می‌شد و به بدنه‌ی فرم می‌رفت.
 *   برای همین فقط بار اول می‌شد تایپ کرد.
 *
 * حل: افکت فقط یک بار (در باز شدن) اجرا می‌شود:
 *   • شنونده‌ها یک بار وصل می‌شوند و `onClose` را از ref می‌خوانند؛
 *   • فوکوس فقط در باز شدن و تنها اگر داخل فرم فوکوسی نباشد انجام می‌شود.
 */
export function Modal({ title, onClose, children, footer, size = '', onEnter }: {
  title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
  size?: '' | 'sm' | 'md';
  /** Enter داخل هر کادر متنی — معمولاً همان ذخیره کردن (اختیاری) */
  onEnter?: () => void;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  /* تازه‌ترین onClose بدون نیاز به اجرای دوباره‌ی افکت */
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const enterRef = React.useRef(onEnter);
  enterRef.current = onEnter;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* Esc: اول تقویم باز را می‌بندد، بعد فرم را */
      if (e.key === 'Escape' && !document.querySelector('.dp-pop')) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    /* فوکوس فقط اگر کاربر هنوز داخل فرم نرفته باشد (هرگز دزدیده نشود) */
    const box = boxRef.current;
    if (box && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="modal-back no-print"
      /*
       * بستن با کلیک روی پس‌زمینه — فقط اگر هم فشار دادن و هم رها کردن روی
       * پس‌زمینه باشد.
       *
       * باگ: قبلاً فقط `onMouseDown` بود. اگر کاربر داخل یک کادر متن، متن را
       * با ماوس انتخاب می‌کرد و ماوس را کمی بیرون از فرم رها می‌کرد، فشار اول
       * داخل فرم بود ولی رها کردن بیرون — و چون رویداد به پس‌زمینه می‌رسید،
       * فرم **بسته می‌شد و همه‌ی داده‌های وارد‌شده از دست می‌رفت**.
       */
      onMouseDown={(e) => { (e.currentTarget as any).__pressedBg = e.target === e.currentTarget; }}
      onClick={(e) => {
        const pressed = (e.currentTarget as any).__pressedBg;
        (e.currentTarget as any).__pressedBg = false;
        if (pressed && e.target === e.currentTarget) onClose();
      }}
    >
      <div
      className={`modal ${size}`} ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true"
      onKeyDown={(e) => {
        /* Enter در کادرهای متنی = همان دکمه‌ی اصلی فرم (اگر داده شده باشد) */
        if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
        const t = e.target as HTMLElement;
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'SELECT')) return;
        if (!enterRef.current) return;
        e.preventDefault();
        enterRef.current();
      }}
    >
        <div className="modal-h"><h3>{title}</h3><div style={{ flex: 1 }} />
          <button className="btn ghost icon" onClick={onClose} title="بستن"><IconClose size={16} /></button>
        </div>
        <div className="modal-b">{children}</div>
        {footer ? <div className="modal-f">{footer}</div> : null}
      </div>
    </div>
  );
}

/* =============================== fields =============================== */

/**
 * برچسب فیلد با نشان «اجباری».
 *
 * درخواست کاربر: «فیلدهای حیاتی که منطقاً برای محاسبه و مدیریت ضروری‌اند
 * باید اجباری باشند تا کاربر مجبور باشد داده وارد کند».
 *
 * `required` هم ستارهٔ دیداری می‌گذارد و هم `aria-required` (برای صفحه‌خوان).
 * خودِ اعتبارسنجی در `validateRequired()` انجام می‌شود که فرم‌ها پیش از
 * ذخیره صدا می‌زنند — و پیام فارسی با نام دقیق فیلد می‌دهد.
 */
export function Field({ label, children, hint, span, required, computed }: {
  label: string; children: React.ReactNode; hint?: string; span?: 2 | 3;
  required?: boolean;
  /** فیلد محاسبه‌شده — نه اجباری است نه قابل تایپ */
  computed?: boolean;
}) {
  return (
    <div className={`field ${span === 2 ? 'span2' : span === 3 ? 'span3' : ''}${computed ? ' is-computed' : ''}`}>
      <label>
        {label}
        {required ? <span className="req" title="پر کردن این فیلد لازم است"> *</span> : null}
        {computed ? <span className="auto-tag" title="این مقدار خودکار محاسبه می‌شود">خودکار</span> : null}
      </label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/**
 * نمایش یک مقدار **محاسبه‌شده** (فقط خواندنی).
 *
 * درخواست کاربر: «فیلدهایی که خودکار محاسبه می‌شود و کاربر حق ورودی ندارد
 * را از این حالت ظاهری مسخره تغییر بده به یک حالت مدرن و مفهوم رسان که
 * نشان‌دهنده محاسبه خودکار و برای کاربر غیرفعال باشد».
 *
 * طراحی:
 *   • ظاهر «کادر غیرفعال» با پس‌زمینه‌ی راه‌راه ملایم و قفل کوچک
 *   • `<output>` واقعی (نه input) → کاربر اصلاً نمی‌تواند تایپ کند
 *   • `dir=ltr` برای اعداد و فونت مونو تا ارقام هم‌تراز باشند
 *   • برچسب «خودکار» روی خود فیلد
 */
export function Computed({ value, suffix, note, big }: {
  value: React.ReactNode;
  suffix?: string;
  note?: string;
  /** بزرگ‌تر — برای «مجموع» نهایی */
  big?: boolean;
}) {
  return (
    <output
      className={`computed-box${big ? ' big' : ''}`}
      aria-live="polite"
      title={note || 'خودکار محاسبه می‌شود — نیازی به ورود نیست'}
    >
      <span className="cv">{value}</span>
      {suffix ? <span className="cs">{suffix}</span> : null}
      <span className="lock" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
    </output>
  );
}

/* ---------------- اعتبارسنجی فیلدهای اجباری ---------------- */

export type RequiredRule = {
  /** نامی که به کاربر نشان داده می‌شود */
  label: string;
  /** آیا مقدار «پر» است؟ */
  filled: boolean;
  /** اگر پر است ولی نامعتبر — مثلاً عدد صفر */
  valid?: boolean;
  /** پیام اختصاصی وقتی پر است ولی نامعتبر */
  invalidMessage?: string;
};

/**
 * بررسی فیلدهای اجباری یک فرم.
 *
 * چرا اینجا و نه در هر صفحه: قانون باید یکی باشد. هر فرم فقط فهرست قواعد
 * را می‌دهد و یک پیام **دقیق** می‌گیرد («متراژ باید بزرگ‌تر از صفر باشد»)،
 * نه یک «فیلدها را پر کنید»ی مبهم.
 *
 * خروجی: نخستین پیام خطا، یا `null` اگر همه‌چیز درست است.
 */
export function validateRequired(rules: RequiredRule[]): string | null {
  for (const r of rules) {
    if (!r.filled) return `«${r.label}» را پر کنید.`;
    if (r.valid === false) return r.invalidMessage || `«${r.label}» نامعتبر است.`;
  }
  return null;
}

/**
 * ورودی متنی.
 *
 * Enter داخل یک `Modal` = همان دکمه‌ی ذخیره (کاربر لازم نیست ماوس را بردارد)؛
 * این را خود `Modal` از طریق `onEnter` مدیریت می‌کند.
 * `onEnter` روی خودِ کادر برای حالت‌های خاص (مثل افزودن سریع در فهرست‌ها) است.
 */
export function Text({
  value, onChange, placeholder, type = 'text', readOnly, className = '', onEnter, autoFocus, dir,
}: {
  value: any; onChange?: (v: string) => void; placeholder?: string; type?: string; readOnly?: boolean;
  className?: string; onEnter?: () => void; autoFocus?: boolean; dir?: 'rtl' | 'ltr';
}) {
  return (
    <input
      className={`input ${className}`} type={type} value={value ?? ''} readOnly={readOnly} dir={dir}
      placeholder={placeholder} autoFocus={autoFocus}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => {
        /* Enter: فقط اگر خودِ کادر onEnter داشته باشد. ذخیره‌ی فرم با Enter را
           خودِ Modal مدیریت می‌کند (یک نقطه، نه چند مسیر موازی). */
        if (e.key === 'Enter' && onEnter && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) onEnter();
      }}
    />
  );
}

/**
 * ورودی عددی.
 *
 * باگ: کاربر می‌توانست «-» تایپ کند و متراژ/مبلغ منفی ثبت شود؛ API هم آن را
 * می‌پذیرفت و جمع گزارش‌ها منفی می‌شد. حالا علامت منفی و هر نویسه غیرعددی
 * همان‌جا حذف می‌شود (به‌استثنای جاهایی که صریحاً allowNegative خواسته شود).
 */
export function Num({ value, onChange, placeholder, readOnly, className = '', allowNegative = false, max }: {
  value: any; onChange?: (v: number) => void; placeholder?: string; readOnly?: boolean;
  className?: string; allowNegative?: boolean; max?: number;
}) {
  /*
   * باگ ظاهری: مقدار ۰ به‌صورت متن «0» در کادر نشان داده می‌شد، پس کاربر مجبور
   * بود اول آن را پاک کند و «0» جزء عدد بعدی می‌شد (مثلاً «01234»). حالا صفر و
   * خالی هر دو یک چیز نمایش داده می‌شوند: کادر خالی.
   */
  const isEmptyValue = (v: any) => v === 0 || v === '' || v === null || v === undefined;
  const [raw, setRaw] = useState(() => (isEmptyValue(value) ? '' : String(value)));
  useEffect(() => {
    const norm = (s: string) => String(s ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/,/g, '');
    if (isEmptyValue(value)) { if (raw !== '') setRaw(''); }
    else if (Number(norm(raw)) !== Number(value)) setRaw(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className={`input input-num ${className}`} inputMode="decimal" value={raw} readOnly={readOnly} placeholder={placeholder}
      onChange={(e) => {
        let v = e.target.value
          .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
          .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
          /*
           * ── باگ (شکار باگ دور ۳۴): «۱۲,۵» متر به ۱۲۵ متر تبدیل می‌شد ────
           * کاما کامل حذف می‌شد، پس ممیز فارسی/کاما تایپ‌شده عدد را ده برابر
           * می‌کرد (بی‌هیچ خطایی، در متراژ بل و مبلغ آن). حالا کاما یا «٫»
           * وقتی بعدش یک/دو رقم آمده **ممیز** است؛ «۱,۲۵۰» مثل قبل هزارگان
           * (حذف) می‌ماند.
           */
          .replace(/٫/g, '.')
          .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')
          .replace(/[^0-9.\-]/g, '');
        if (!allowNegative) v = v.replace(/-/g, '');
        else if (v.indexOf('-') > 0) v = v.replace(/-/g, '');
        const firstDot = v.indexOf('.');
        if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
        setRaw(v);
        let n = Number(v.replace(/,/g, ''));
        if (!Number.isFinite(n)) n = 0;
        if (max !== undefined && n > max) { n = max; setRaw(String(max)); }
        onChange?.(n);
      }}
    />
  );
}

export function Select({ value, onChange, options, placeholder, disabled }: {
  value: any; onChange?: (v: any) => void;
  options: { value: any; label: string }[]; placeholder?: string; disabled?: boolean;
}) {
  /*
   * ── باگ (شکار باگ دور ۳۱): «مقدارِ ناموجود» بی‌صدا گم می‌شد ──────────────
   *
   * اگر مقدار ذخیره‌شده در فهرست گزینه‌ها نبود — مثلاً پرداخت‌کننده‌ی یک سند
   * قدیمی که از فهرست کشویی حذف/غیرفعال شده، یا «نوع مصرف»ی که نامش عوض
   * شده — مرورگر اولین گزینه (متنِ خالی «انتخاب…») را نشان می‌داد.
   *
   * نتیجه: سند در جدول واقعاً همان مقدار قدیمی را داشت، ولی فورم می‌گفت
   * «چیزی انتخاب نشده»؛ و اگر کاربر چیز دیگری را در همان فورم عوض می‌کرد و
   * ذخیره می‌زد، مقدار قدیمی **صفر/خالی** می‌شد — بی‌هیچ پیامی.
   *
   * حالا خودِ مقدار به‌عنوان گزینه‌ی «(ناموجود در فهرست)» نشان داده می‌شود:
   * کاربر می‌بیند چه چیزی ذخیره است، و ذخیره‌ی دوباره آن را پاک نمی‌کند.
   */
  const current = value === null || value === undefined ? '' : String(value);
  const known = options.some((o) => String(o.value) === current);
  const ghost = current !== '' && !known;
  return (
    <select className={`input${ghost ? ' input-warn' : ''}`} value={current} disabled={disabled}
      title={ghost ? 'این مقدار در فهرست فعلی نیست (حذف یا تغییر نام داده شده) — با ذخیره‌ی فورم پاک نمی‌شود.' : undefined}
      onChange={(e) => onChange?.(e.target.value)}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {ghost ? <option value={current}>{current} (ناموجود در فهرست)</option> : null}
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 2 }: {
  value: any; onChange?: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return <textarea className="input" rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange?.(e.target.value)} />;
}

/* =============================== table =============================== */
export function Table({ head, children, empty, zebra = true, compact, foot }: {
  head: React.ReactNode[]; children: React.ReactNode; empty?: string; zebra?: boolean; compact?: boolean; foot?: React.ReactNode;
}) {
  const hasRows = React.Children.count(children) > 0;
  return (
    <div className="table-wrap">
      <table className={`tbl ${zebra ? 'zebra' : ''} ${compact ? 'compact' : ''}`}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
        {foot ? <tfoot>{foot}</tfoot> : null}
      </table>
      {!hasRows ? <div className="tbl-empty">{empty || 'ردیفی موجود نیست.'}</div> : null}
    </div>
  );
}

/* ============================== pager =============================== */
export function Pager({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager no-print">
      <button className="btn sm icon" disabled={page <= 1} onClick={() => onPage(1)} title="صفحه اول" aria-label="صفحه اول"><IconChevron dir="start" size={14} /><IconChevron dir="start" size={14} style={{ marginInlineStart: -9 }} /></button>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="صفحه قبل">قبلی</button>
      <span className="small">
        ردیف <b>{from.toLocaleString('en-US')}</b> تا <b>{to.toLocaleString('en-US')}</b>
        {' '}از <b>{total.toLocaleString('en-US')}</b>
        <span className="muted"> — صفحه {page} از {pages}</span>
      </span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="صفحه بعد">بعدی</button>
      <button className="btn sm icon" disabled={page >= pages} onClick={() => onPage(pages)} title="صفحه آخر" aria-label="صفحه آخر"><IconChevron dir="end" size={14} /><IconChevron dir="end" size={14} style={{ marginInlineStart: -9 }} /></button>
    </div>
  );
}

/* =============================== list head ============================ */
/**
 * نوار ابزار یک‌ردیفه و کم‌جا برای همه فهرست‌ها:
 *
 *   [جستجو] [فیلتر ▾]  · خلاصه ·        [اکسل] [＋ نو]
 *
 * فیلترها داخل یک پنل بازشو هستند تا صفحه شلوغ نشود؛ فیلترهای فعال به شکل
 * چیپ‌های قابل حذف زیر همان نوار نمایش داده می‌شوند.
 */
export function ListHead({ children, actions, summary }: {
  children?: React.ReactNode; actions?: React.ReactNode; summary?: React.ReactNode;
}) {
  return (
    <div className="list-head">
      {children}
      {summary ? <div className="list-summary">{summary}</div> : null}
      <div style={{ flex: 1 }} />
      {actions ? <div className="list-actions">{actions}</div> : null}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'جستجو…', width }: {
  value: string; onChange: (v: string) => void; placeholder?: string; width?: number;
}) {
  return (
    <div className="tb-search" style={width ? { maxWidth: width } : undefined}>
      <IconSearchDoc size={15} className="ico" />
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button className="tb-search-clear" onClick={() => onChange('')} title="پاک کردن جستجو">
          <IconClose size={12} />
        </button>
      ) : null}
    </div>
  );
}

/** دکمه باز کردن پنل فیلترها + شمارنده فیلترهای فعال */
export function FilterButton({ count, onClick, open }: { count: number; onClick: () => void; open: boolean }) {
  return (
    <button className={`btn tb-filter ${count ? 'has' : ''} ${open ? 'open' : ''}`} onClick={onClick}>
      <IconFilter size={15} />
      <span>فیلتر</span>
      {count ? <span className="tb-badge">{count}</span> : null}
    </button>
  );
}

/** پنل فیلترها (absolute داخل نوار ابزار) — با Esc یا کلیک بیرون بسته می‌شود */
export function FilterPanel({ open, children, footer, onClose }: {
  open: boolean; children: React.ReactNode; footer?: React.ReactNode; onClose?: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  /* مثل Modal: onClose در صفحه‌ها تابع تازه است، پس از ref خوانده می‌شود تا
     شنونده‌ها با هر رندر از نو ساخته/حذف نشوند (و کلیک وسط این چرخه گم نشود). */
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      /* کلیک روی خود دکمه فیلتر، خودش پنل را می‌بندد */
      if ((t as HTMLElement).closest?.('.tb-filter')) return;
      closeRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="tb-panel" ref={ref}>
      <div className="tb-panel-b">{children}</div>
      {footer ? <div className="tb-panel-f">{footer}</div> : null}
    </div>
  );
}

/** چیپ یک فیلتر فعال؛ با ✕ حذف می‌شود */
export function FilterChip({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span className="tb-chip">
      <span className="lbl">{label}:</span> {value}
      <button onClick={onClear} title="حذف فیلتر"><IconClose size={11} /></button>
    </span>
  );
}

/** آمار کوتاه داخل نوار: «۲۳ بل · ۱٬۲۳۴٬۵۶۷ افغانی» */
export function InlineStat({ label, value, tone }: { label?: string; value: React.ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <span className="tb-stat">
      {label ? <span className="muted">{label}</span> : null}
      <b style={tone ? { color: `var(--${tone === 'bad' ? 'danger' : tone})` } : undefined}>{value}</b>
    </span>
  );
}

export function SummaryBar({ children }: { children: React.ReactNode }) {
  return <div className="summary-bar">{children}</div>;
}

/** جفت کلید-مقدار کوچک برای داخل نوار خلاصه */
export function K({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'ok' | 'bad' | 'warn' | '' }) {
  return (
    <span className="k">
      <span className="muted">{label}:</span>
      <b style={tone ? { color: `var(--${tone === 'bad' ? 'danger' : tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'text'})` } : undefined}>{value}</b>
    </span>
  );
}

/* ============================== empty state ========================= */
export function Empty({ icon, title, hint, action }: { icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-ico">{icon ?? <IconSearchDoc size={26} />}</div>
      <div style={{ fontWeight: 700, color: 'var(--text-2)' }}>{title}</div>
      {hint ? <div className="small" style={{ marginTop: 4 }}>{hint}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="row" style={{ padding: 26, justifyContent: 'center', color: 'var(--text-3)' }}>
      <span className="spin" style={{
        width: 16, height: 16, border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)',
        borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite',
      }} />
      <span className="small">{label}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

export function Stat({ label, value, foot, kind = '', icon }: { label: string; value: React.ReactNode; foot?: React.ReactNode; kind?: '' | 'ok' | 'bad' | 'warn'; icon?: React.ReactNode }) {
  return (
    <div className={`card stat ${kind}`}>
      {icon ? <div className="spark">{icon}</div> : null}
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}

/* ================================================================== */
/* خروجی / ورودی اکسل — یک دکمه‌ی مشترک برای همه‌ی صفحه‌ها             */
/* ================================================================== */

/**
 * دکمه‌ی «خروجی» با منوی کوچک (اکسل / CSV) و مدیریت خطا.
 *
 * ## باگی که این کامپوننت حل می‌کند
 * در پنج صفحه دکمه‌ی «اکسل» به `/api/api/export` درخواست می‌داد (۴۰۴) و
 * خطا هم نمایش داده نمی‌شد — کاربر فکر می‌کرد «هیچ اتفاقی نمی‌افتد».
 * حالا:
 *   • آدرس درست است (در `lib/api.ts` اصلاح شد)
 *   • خطا به‌صورت toast نشان داده می‌شود، نه سکوت
 *   • هنگام دانلود، دکمه «…» می‌شود (کاربر دوباره نمی‌زند)
 */
export function ExportButton({ type, label = 'خروجی', compact, range }: {
  type: string;
  label?: string;
  /** فقط آیکن (برای نوارهای شلوغ) */
  compact?: boolean;
  /** محدوده‌ی تاریخ — تا خروجی با جدول همان بازه بخواند */
  range?: { from?: string; to?: string };
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const go = async (format: 'xls' | 'csv') => {
    setOpen(false);
    setBusy(true);
    try {
      await downloadCsv(type, format, range);
      toast.success('فایل آماده شد', format === 'xls' ? 'با اکسل باز کنید.' : 'فایل CSV با اکسل/برنامه‌های دیگر باز می‌شود.');
    } catch (e: any) {
      toast.error('خروجی گرفته نشد', e?.message || 'دوباره تلاش کنید.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-wrap" ref={boxRef}>
      <button
        type="button" className="btn" disabled={busy}
        onClick={() => setOpen((v) => !v)}
        title="خروجی گرفتن از فهرست"
        aria-haspopup="menu" aria-expanded={open}
      >
        <IconDownload size={15} /> {busy ? '…' : compact ? '' : label}
      </button>
      {open ? (
        <div className="export-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => go('xls')}>
            <b>Excel (.xls)</b>
            <span>کارپوشه با ستون‌های جدا — پیشنهادی</span>
          </button>
          <button type="button" role="menuitem" onClick={() => go('csv')}>
            <b>CSV</b>
            <span>متن ساده، برای همه‌ی برنامه‌ها</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * گفت‌وگوی «ورود از اکسل»: دانلود نمونه → انتخاب فایل → بررسی → ثبت.
 *
 * چرا دو مرحله (بررسی، بعد ثبت): کاربر باید **قبل از** نوشتن در دیتابیس
 * ببیند چند سطر سالم است، کدام سطر خطا دارد و چرا. ثبت بی‌بازبینی روی
 * داده‌ی مالی یعنی فاجعه‌ی خاموش.
 */
export function ImportDialog({ types, onDone, onClose }: {
  types: { key: string; title: string; enabled: boolean; headers: string[]; reason: string }[];
  onDone?: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const usable = types.filter((t) => t.enabled);
  const [type, setType] = React.useState(usable[0]?.key || '');
  const [file, setFile] = React.useState<File | null>(null);
  const [csvText, setCsvText] = React.useState('');
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [busy, setBusy] = React.useState(false);

  const pick = async (f: File | null) => {
    setFile(f);
    setReport(null);
    if (!f) { setCsvText(''); return; }
    try {
      const text = await readFileAsText(f);
      setCsvText(text);
    } catch (e: any) {
      toast.error('فایل خوانده نشد', e?.message);
    }
  };

  const check = async () => {
    if (!csvText.trim()) { toast.warn('اول یک فایل انتخاب کنید.'); return; }
    setBusy(true);
    try {
      setReport(await runImport(type, csvText, true));
    } catch (e: any) {
      toast.error('بررسی انجام نشد', e?.message);
    } finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const r = await runImport(type, csvText, false);
      setReport(r);
      toast.success('ثبت انجام شد', r.message);
      onDone?.();
    } catch (e: any) {
      toast.error('ثبت انجام نشد', e?.message);
    } finally { setBusy(false); }
  };

  const tpl = async () => {
    try { await downloadImportTemplate(type, 'xls'); toast.info('فایل نمونه دانلود شد', 'سطرها را پر کنید و همان فایل را برگردانید.'); }
    catch (e: any) { toast.error('نمونه دانلود نشد', e?.message); }
  };

  const cfg = types.find((t) => t.key === type);

  return (
    <Modal title="ورود از اکسل" onClose={onClose} footer={
      <>
        <button className="btn" onClick={tpl}>دانلود فایل نمونه</button>
        <div className="spacer" />
        <button className="btn" onClick={check} disabled={busy || !csvText}>{busy ? '…' : 'بررسی فایل'}</button>
        <button className="btn primary" onClick={commit}
          disabled={busy || !report || report.dryRun === false || (report.valid ?? 0) === 0}>
          ثبت در سیستم
        </button>
      </>
    }>
      <div className="col" style={{ gap: 12 }}>
        <Field label="چه چیزی وارد شود؟">
          <Select
            value={type} onChange={(v) => { setType(v); setReport(null); }}
            options={types.map((t) => ({ value: t.key, label: t.title + (t.enabled ? '' : ' — پشتیبانی نمی‌شود') }))}
          />
        </Field>

        {cfg && !cfg.enabled ? (
          <div className="small" style={{ padding: 12, borderRadius: 10, background: 'var(--warn-soft)', color: 'var(--warn)' }}>
            {cfg.reason}
          </div>
        ) : null}

        {cfg?.enabled ? (
          <>
            <div className="small muted">
              ستون‌های لازم: {cfg.headers.join(' · ')}
            </div>
            <Field label="فایل CSV">
              <input
                className="input" type="file" accept=".csv,text/csv,text/plain"
                onChange={(e) => pick(e.target.files?.[0] || null)}
              />
            </Field>
            <p className="small muted" style={{ marginTop: -6 }}>
              فایل را با اکسل به‌صورت «CSV UTF-8» ذخیره کنید. اگر فایل را با «ذخیره به‌عنوان متن» هم بسازید،
              جداکننده‌ی کاما، نقطه‌ویرگول یا tab به‌صورت خودکار تشخیص داده می‌شود.
            </p>

            {report ? (
              <div className="col" style={{ gap: 8 }}>
                <div className="small" style={{
                  padding: 10, borderRadius: 9,
                  background: (report.errors?.length ?? 0) ? 'var(--danger-soft)' : 'var(--ok-soft)',
                  color: (report.errors?.length ?? 0) ? 'var(--danger)' : 'var(--ok)',
                }}>
                  {report.message}
                </div>
                {report.errors?.length ? (
                  <div className="small">
                    <b>خطاها:</b>
                    <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                      {report.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                ) : null}
                {report.duplicates?.length ? (
                  <div className="small">
                    <b>تکراری‌ها:</b>
                    <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                      {report.duplicates.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                ) : null}
                {report.preview?.length ? (
                  <div className="small muted">
                    پیش‌نمایش: {report.preview.slice(0, 5).map((p: any) => p.name).join(' · ')}
                    {report.preview.length > 5 ? ' …' : ''}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
