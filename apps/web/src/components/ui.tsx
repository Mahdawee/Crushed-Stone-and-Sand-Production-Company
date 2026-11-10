import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { IconAlert, IconCheck, IconChevron, IconClose, IconFilter, IconInfo, IconSearchDoc } from './icons';

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
export function Modal({ title, onClose, children, footer, size = '' }: {
  title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; size?: '' | 'sm' | 'md';
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* Esc: اول تقویم باز را می‌بندد، بعد فرم را */
      if (e.key === 'Escape' && !document.querySelector('.dp-pop')) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    /* فوکوس روی خود فرم می‌رود تا تایپ/تب از همان‌جا شروع شود */
    boxRef.current?.focus();
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="modal-back no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size}`} ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true">
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
export function Field({ label, children, hint, span, required }: {
  label: string; children: React.ReactNode; hint?: string; span?: 2 | 3; required?: boolean;
}) {
  return (
    <div className={`field ${span === 2 ? 'span2' : span === 3 ? 'span3' : ''}`}>
      <label>{label}{required ? <span className="req"> *</span> : null}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

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
      onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
    />
  );
}

export function Num({ value, onChange, placeholder, readOnly, className = '' }: {
  value: any; onChange?: (v: number) => void; placeholder?: string; readOnly?: boolean; className?: string;
}) {
  const [raw, setRaw] = useState(String(value ?? ''));
  useEffect(() => {
    const norm = (s: string) => String(s ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/,/g, '');
    if (Number(norm(raw)) !== Number(value ?? 0)) setRaw(value === 0 || value === '' || value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className={`input input-num ${className}`} inputMode="decimal" value={raw} readOnly={readOnly} placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
        setRaw(v);
        const n = Number(v.replace(/,/g, ''));
        onChange?.(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}

export function Select({ value, onChange, options, placeholder, disabled }: {
  value: any; onChange?: (v: any) => void;
  options: { value: any; label: string }[]; placeholder?: string; disabled?: boolean;
}) {
  return (
    <select className="input" value={value ?? ''} disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
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
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      /* کلیک روی خود دکمه فیلتر، خودش پنل را می‌بندد */
      if ((t as HTMLElement).closest?.('.tb-filter')) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open, onClose]);
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
