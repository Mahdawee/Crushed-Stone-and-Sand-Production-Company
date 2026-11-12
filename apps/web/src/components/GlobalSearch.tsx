import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { money } from '../lib/calendar';
import { IconSearchDoc, IconClose } from './icons';

/**
 * جست‌وجوی سراسری — پنجره‌ی Ctrl+K (پیشنهاد C1، دور ۴۰).
 *
 * ── چرا ──────────────────────────────────────────────────────────────────
 * کاربری که «رسید ۱۰۴۲» یا «حاجی احمد» را نیمه‌کاره به یاد دارد، مجبور بود
 * اول به صفحه‌ی مربوطه برود و آن‌جا جست‌وجو کند. حالا از **هر صفحه‌ای** با
 * Ctrl+K (یا کلیک روی آیکن ذره‌بین در نوار بالا) می‌جوید و مستقیم می‌رود.
 *
 * ── تصمیم‌های دقیق ───────────────────────────────────────────────────────
 *   • ۲۵۰ms تأخیر در تایپ: تایپ «کریمی» شش درخواست نمی‌فرستد.
 *   • درخواست قبلی با AbortController لغو می‌شود؛ پاسخ دیررس نمی‌تواند
 *     نتیجه‌ی تازه‌تر را بازنویسی کند (باگ کلاسیک جست‌وجوی زنده).
 *   • کمتر از ۲ حرف فرستاده نمی‌شود — همان قاعده‌ی سرور.
 *   • پیمایش با ↑↓، انتخاب با Enter، بستن با Esc.
 *   • خطای شبکه پنجره را نمی‌بندد و «جست‌وجو ناموفق» نشان می‌دهد؛ سکوت
 *     کاربر را به این باور می‌رساند که چیزی پیدا نشد.
 */

export interface SearchHit {
  kind: 'customer' | 'sale' | 'receipt' | 'expense' | 'employee';
  id: number;
  title: string;
  subtitle: string;
  path: string;
  amount?: number;
}

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  customer: 'مشتری',
  sale: 'بل فروش',
  receipt: 'رسید',
  expense: 'مصرف',
  employee: 'کارمند',
};

export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const abortRef = useRef<AbortController | null>(null);

  /* با باز شدن: فوکوس روی ورودی، پاک شدن وضعیت قبلی */
  useEffect(() => {
    if (!open) return;
    setQ('');
    setHits([]);
    setActive(0);
    setErr('');
    /* فوکوس بعد از رندر — وگرنه در بعضی مرورگرها روی عنصر ناموجود می‌رود */
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  /* درخواست با تأخیر و لغو */
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setBusy(false);
      setErr('');
      return;
    }
    setBusy(true);
    const t = window.setTimeout(async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const res = await api.get<{ hits: SearchHit[] }>(
          `/search?q=${encodeURIComponent(term)}`,
        );
        /* اگر در این فاصله چیز دیگری تایپ شده باشد، این پاسخ کهنه است */
        if (ctl.signal.aborted) return;
        setHits(Array.isArray(res?.hits) ? res.hits : []);
        setActive(0);
        setErr('');
      } catch (e: any) {
        if (!ctl.signal.aborted) setErr(e?.message || 'جست‌وجو انجام نشد');
      } finally {
        if (!ctl.signal.aborted) setBusy(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, open]);

  const go = useCallback(
    (h: SearchHit | undefined) => {
      if (!h) return;
      onClose();
      nav(h.path);
    },
    [nav, onClose],
  );

  /* ↑↓ / Enter / Esc */
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (hits.length ? (i + 1) % hits.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      go(hits[active]);
    }
  };

  /* نتیجه‌ی انتخاب‌شده همیشه دیده شود */
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, hits]);

  /* گروه‌بندی برای خوانایی: هر نوع با عنوان خودش */
  const grouped = useMemo(() => {
    const order: SearchHit['kind'][] = ['customer', 'sale', 'receipt', 'expense', 'employee'];
    return order
      .map((k) => ({ kind: k, items: hits.filter((h) => h.kind === k) }))
      .filter((g) => g.items.length > 0);
  }, [hits]);

  if (!open) return null;

  const idxOf = (h: SearchHit) => hits.indexOf(h);

  return (
    <div className="gs-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="gs-panel"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="جست‌وجوی سراسری"
        onKeyDown={onKey}
      >
        <div className="gs-head">
          <IconSearchDoc size={18} />
          <input
            ref={inputRef}
            className="gs-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="نام مشتری، شماره سند، مبلغ، کرش، کارمند…"
            aria-label="عبارت جست‌وجو"
            autoComplete="off"
          />
          <button type="button" className="gs-close" onClick={onClose} aria-label="بستن">
            <IconClose size={16} />
          </button>
        </div>

        <div className="gs-body" ref={listRef}>
          {q.trim().length < 2 && (
            <div className="gs-hint">
              حداقل دو حرف بنویسید. مشتری، بل، رسید، مصرف و کارمند با هم جست‌وجو می‌شوند.
            </div>
          )}
          {q.trim().length >= 2 && busy && hits.length === 0 && <div className="gs-hint">در حال جست‌وجو…</div>}
          {err && <div className="gs-hint gs-err">جست‌وجو انجام نشد: {err}</div>}
          {q.trim().length >= 2 && !busy && !err && hits.length === 0 && (
            <div className="gs-hint">چیزی با «{q.trim()}» پیدا نشد.</div>
          )}

          {grouped.map((g) => (
            <div key={g.kind} className="gs-group">
              <div className="gs-group-title">{KIND_LABEL[g.kind]}</div>
              {g.items.map((h) => {
                const i = idxOf(h);
                return (
                  <button
                    type="button"
                    key={`${h.kind}-${h.id}`}
                    data-i={i}
                    className={`gs-row${i === active ? ' on' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                  >
                    <span className="gs-title">{h.title || '(بدون عنوان)'}</span>
                    <span className="gs-sub">{h.subtitle}</span>
                    {typeof h.amount === 'number' && h.amount > 0 && (
                      <span className="gs-amt">{money(h.amount)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="gs-foot">
          <span>↑↓ انتخاب</span>
          <span>Enter رفتن</span>
          <span>Esc بستن</span>
        </div>
      </div>
    </div>
  );
}
