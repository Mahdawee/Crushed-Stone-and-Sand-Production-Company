import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCalendar, IconChevron, IconClose } from './icons';
import {
  CalendarMode, WEEKDAYS, WEEKDAYS_FULL, addDaysISO, formatDate, fromCalendar, monthGrid,
  monthName, monthLength, months, pad2, shiftMonth, toCalendar, todayISOValue, weekdayIndex,
} from '../lib/calendar';

type Props = {
  /** مقدار به صورت ISO میلادی «YYYY-MM-DD» (همان چیزی که در دیتابیس ذخیره می‌شود) */
  value: string;
  /** برمی‌گرداند ISO میلادی یا '' وقتی کاربر پاک می‌کند */
  onChange: (iso: string) => void;
  calendar: CalendarMode;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  /** کوچک‌تر برای نوار فیلترها */
  compact?: boolean;
  id?: string;
  /** عرض فیلد */
  width?: number | string;
  title?: string;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * انتخاب تاریخ شمسی/میلادی — **فقط از تقویم** (بدون ورود دستی).
 *
 * • کل کادر یک دکمه است: کلیک در هر جای آن تقویم را باز می‌کند.
 * • تقویم: شبکه ماه (هفته از شنبه)، تغییر ماه/سال، «امروز».
 * • آیکن، متن و متن راهنما هر کدام جای خود در چیدمان flex دارند؛
 *   هیچ‌کدام با position:absolute روی دیگری نمی‌افتد و با هر عرضی
 *   (۱۱۰px تا ۳۲۰px) هم‌پوشانی ندارد.
 * • خروجی همیشه ISO میلادی است؛ نمایش همیشه با تقویم انتخابی سیستم.
 */
export function DatePicker({
  value, onChange, calendar, placeholder, clearable, disabled, compact, id, width, title,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const view0 = toCalendar(value || todayISOValue(), calendar);
  const [view, setView] = useState({ y: view0.jy, m: view0.jm });
  const [picker, setPicker] = useState<'days' | 'months' | 'years'>('days');

  /* متن نمایش‌داده‌شده همیشه از مقدار می‌آید (بدون حالت میانی/ورود دستی) */
  const text = value ? formatDate(value, calendar) : '';

  /* با باز شدن، نمای تقویم را روی مقدار فعلی بگذار */
  useEffect(() => {
    if (!open) return;
    const c = toCalendar(value || todayISOValue(), calendar);
    setView({ y: c.jy, m: c.jm });
    setPicker('days');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /* جای‌گذاری پاپ‌آور (portal → از کلیپ‌شدن داخل کارت/جدول در امان است) */
  const place = () => {
    const r = hostRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 302;
    const H = 344;
    const below = window.innerHeight - r.bottom;
    const top = below < H && r.top > H ? r.top - H - 6 : r.bottom + 6;
    const left = clamp(r.left, 8, Math.max(8, window.innerWidth - W - 8));
    setPos({ top, left, width: r.width });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (hostRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps


  /** باز کردن تقویم روی ماهِ مقدار فعلی (یا امروز) */
  const openCal = () => {
    if (disabled) return;
    const c = toCalendar(value || todayISOValue(), calendar);
    setView({ y: c.jy, m: c.jm });
    setPicker('days');
    setOpen(true);
  };

  const pickDay = (d: number) => {
    onChange(fromCalendar(view.y, view.m, d, calendar));
    setOpen(false);
  };

  const pickToday = () => {
    onChange(todayISOValue());
    setOpen(false);
  };

  const shift = (delta: number) => {
    const n = shiftMonth(view.y, view.m, delta);
    setView(n);
  };

  const selectedISO = value || '';
  const todayCal = toCalendar(todayISOValue(), calendar);
  const grid = monthGrid(view.y, view.m, calendar);
  const years = Array.from({ length: 21 }, (_, i) => view.y - 10 + i).filter((y) => y > 1200);

  return (
    <div className={`dp-host ${compact ? 'dp-compact' : ''}`} ref={hostRef} style={{ width }} title={title}>
      {/*
        کادر انتخاب تاریخ — یک دکمه‌ی کامل، نه input.
        چیدمان: [آیکن] [متن] [پاک کردن]  →  هر کدام در جریان flex،
        بنابراین آیکن و متن هرگز روی هم نمی‌افتند (نه absolute، نه padding ترفندی).
      */}
      <div className="dp-field">
        <button
          type="button" className="dp-trigger" disabled={disabled}
          onClick={() => (open ? setOpen(false) : openCal())}
          aria-haspopup="dialog" aria-expanded={open}
          title={open ? 'بستن تقویم' : 'انتخاب تاریخ'}
        >
          <span className="dp-cal" aria-hidden="true"><IconCalendar size={compact ? 15 : 16} /></span>
          <span className={`dp-value ${text ? '' : 'is-empty'}`} dir={text ? 'ltr' : 'rtl'}>
            {text || placeholder || (calendar === 'jalali' ? 'انتخاب تاریخ' : 'Select date')}
          </span>
        </button>

        {clearable && value && !disabled ? (
          <button
            type="button" className="dp-clear" title="پاک کردن" aria-label="پاک کردن تاریخ"
            onClick={() => { onChange(''); setOpen(false); }}
          ><IconClose size={11} /></button>
        ) : null}
      </div>

      {open ? createPortal(
        <div
          className="dp-pop" ref={popRef} dir="rtl" role="dialog" aria-label="تقویم"
          style={{ top: pos.top, left: pos.left, width: Math.max(302, pos.width) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={() => shift(-1)} title="ماه قبل" aria-label="ماه قبل"><IconChevron dir="start" size={15} /></button>
            <div className="dp-title">
              <button type="button" className="dp-title-btn" onClick={() => setPicker(picker === 'months' ? 'days' : 'months')}>
                {monthName(view.m, calendar)}
              </button>
              <button type="button" className="dp-title-btn" onClick={() => setPicker(picker === 'years' ? 'days' : 'years')}>
                {view.y}
              </button>
            </div>
            <button type="button" className="dp-nav" onClick={() => shift(1)} title="ماه بعد" aria-label="ماه بعد"><IconChevron dir="end" size={15} /></button>
          </div>

          {picker === 'days' ? (
            <>
              <div className="dp-week">
                {WEEKDAYS.map((w, i) => <span key={i} title={WEEKDAYS_FULL[i]}>{w}</span>)}
              </div>
              <div className="dp-grid">
                {grid.map((d, i) => {
                  if (d === null) return <span key={`e${i}`} className="dp-cell empty" />;
                  const iso = fromCalendar(view.y, view.m, d, calendar);
                  const isToday = view.y === todayCal.jy && view.m === todayCal.jm && d === todayCal.jd;
                  const isSel = iso === selectedISO;
                  const isFriday = weekdayIndex(view.y, view.m, d, calendar) === 6;
                  return (
                    <button
                      key={d} type="button"
                      className={`dp-cell ${isSel ? 'sel' : ''} ${isToday ? 'today' : ''} ${isFriday ? 'fri' : ''}`}
                      onClick={() => pickDay(d)}
                    >{d}</button>
                  );
                })}
              </div>
            </>
          ) : null}

          {picker === 'months' ? (
            <div className="dp-list">
              {months(calendar).map((n, i) => (
                <button
                  key={n} type="button"
                  className={`dp-chip ${view.m === i + 1 ? 'sel' : ''}`}
                  onClick={() => { setView({ ...view, m: i + 1 }); setPicker('days'); }}
                >{n}</button>
              ))}
            </div>
          ) : null}

          {picker === 'years' ? (
            <div className="dp-list years">
              {years.map((y) => (
                <button
                  key={y} type="button"
                  className={`dp-chip ${view.y === y ? 'sel' : ''}`}
                  onClick={() => { setView({ ...view, y }); setPicker('days'); }}
                >{y}</button>
              ))}
            </div>
          ) : null}

          <div className="dp-foot">
            <button type="button" className="btn sm" onClick={() => { onChange(addDaysISO(selectedISO || todayISOValue(), -1)); setOpen(false); }}>−۱ روز</button>
            <button type="button" className="btn sm primary" onClick={pickToday}>امروز</button>
            <button type="button" className="btn sm" onClick={() => { onChange(addDaysISO(selectedISO || todayISOValue(), 1)); setOpen(false); }}>+۱ روز</button>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>بستن</button>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

/**
 * انتخاب ماه (برای ورق معاش، حضور و غیاب، راپور ماهانه).
 * مقدار: «1405-08» شمسی یا «2026-11» میلادی — همان شکل ماه در دیتابیس.
 */
export function MonthPicker({
  value, onChange, calendar, yearsBack = 5, width,
}: {
  value: string; onChange: (v: string) => void; calendar: CalendarMode; yearsBack?: number; width?: number;
}) {
  const [y, m] = value.split('-').map(Number);
  const now = toCalendar(todayISOValue(), calendar);
  const years = Array.from({ length: yearsBack + 2 }, (_, i) => now.jy + 1 - i);
  return (
    <div className="row" style={{ gap: 6 }}>
      <select
        className="input"
        style={{ width: 108 }}
        value={m || now.jm}
        onChange={(e) => onChange(`${y || now.jy}-${pad2(Number(e.target.value))}`)}
      >
        {months(calendar).map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
      <select
        className="input"
        style={{ width: 88 }}
        value={y || now.jy}
        onChange={(e) => onChange(`${Number(e.target.value)}-${pad2(m || now.jm)}`)}
      >
        {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
      </select>
    </div>
  );
}

/** تعداد روزهای یک ماه تقویمی — برای ساخت بازه‌های سریع. */
export const monthEndDay = (y: number, m: number, mode: CalendarMode) => monthLength(y, m, mode);

/** برچسب فارسی تعداد روزهای بازه (برای خودِ صفحه). */
export const rangeLabel = (fromISO: string, toISO: string, mode: CalendarMode) =>
  `${formatDate(fromISO, mode)} → ${formatDate(toISO, mode)}`;
