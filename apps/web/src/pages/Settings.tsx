import { IconAlert, IconCheck } from '../components/icons';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast, Field, Spinner, Select, Table, Stat } from '../components/ui';

const ACCENTS = [
  { value: 'teal', label: 'فیروزه‌ای', color: '#0f766e' },
  { value: 'emerald', label: 'زمردی', color: '#059669' },
  { value: 'blue', label: 'آبی', color: '#2563eb' },
  { value: 'indigo', label: 'نیلی', color: '#4f46e5' },
  { value: 'violet', label: 'بنفش', color: '#7c3aed' },
  { value: 'amber', label: 'کهربایی', color: '#b45309' },
  { value: 'rose', label: 'سرخابی', color: '#e11d48' },
  { value: 'slate', label: 'خاکستری', color: '#475569' },
];

/** سه تم برنامه — همان مقادیر ذخیره‌شده در تنظیمات */
const THEMES = [
  { value: 'light', label: 'روشن', hint: 'روشن کلاسیک — پس‌زمینه‌ی سفید و خاکستری ملایم' },
  { value: 'vivid', label: 'برجسته', hint: 'کنتراست بالا و رنگ‌های درخشان — مناسب نور شدید و فضای باز' },
  { value: 'dark', label: 'تیره', hint: 'تیره‌ی مدرن سرمه‌ای (نه سیاه مطلق) — راحت برای چشم در شب' },
];

export default function SettingsPage() {
  const { settings, saveSettings, calendar, isManager, license } = useSession();
  const toast = useToast();
  const [s, setS] = useState<any>(settings);
  const [health, setHealth] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });

  useEffect(() => { setS(settings); }, [settings]);
  useEffect(() => {
    api.get('/system/health').then(setHealth).catch(() => {});
    api.get('/system/info').then(setInfo).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      /* کادر خالی = پیش‌فرض سرور (نه رشته‌ی خالی که محاسبات را خراب کند) */
      const clean = { ...s };
      if (String(clean.attendanceWorkHours ?? '').trim() === '') clean.attendanceWorkHours = '8';
      if (String(clean.overtimeRate ?? '').trim() === '') clean.overtimeRate = '1.25';
      await saveSettings(clean);
      toast.success('تنظیمات ذخیره شد');
    }
    catch (e: any) { toast.error('ذخیره نشد', e.message); }
    finally { setBusy(false); }
  };

  const changePw = async () => {
    try {
      await api.post('/auth/change-password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('رمز عبور تغییر کرد');
    } catch (e: any) { toast.error('تغییر رمز انجام نشد', e.message); }
  };

  const repair = async () => {
    try { setHealth(await api.post('/system/health/repair')); toast.success('ساختار دیتابیس ترمیم شد'); }
    catch (e: any) { toast.error('ترمیم انجام نشد', e.message); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      {!isManager ? (
        <div className="card"><div className="card-b">
          <p className="small" style={{ color: 'var(--warn)' }}>
            <IconAlert size={15} style={{ verticalAlign: '-2px', marginInlineEnd: 4 }} />
            تغییر تنظیمات فقط توسط مدیر سیستم ممکن است. می‌توانید مقادیر را ببینید، اما ذخیره فقط برای مدیر فعال است.
          </p>
        </div></div>
      ) : null}

      <div className="card">
        <div className="card-h"><h3>تقویم و نمایش</h3>
          <span className="small muted">تغییرات بعد از ذخیره فوراً روی همه صفحات اعمال می‌شود</span>
          <div style={{ flex: 1 }} />
          {isManager ? <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'ذخیره…' : 'ذخیره تنظیمات'}</button> : null}</div>
        <div className="card-b">
          <div className="form-grid">
            <Field label="تقویم سیستم" hint="تاریخ‌ها در دیتابیس میلادی ذخیره می‌شوند؛ فقط نمایش و راپورها عوض می‌شود.">
              <Select value={s.calendar} onChange={(v) => setS({ ...s, calendar: v })}
                options={[{ value: 'jalali', label: 'هجری شمسی' }, { value: 'gregorian', label: 'میلادی' }]} />
            </Field>
            <Field label="حالت نمایش" hint="«برجسته» برای نور شدید و فضای باز: کنتراست بالا و رنگ‌های درخشان.">
              <div className="theme-pick" role="radiogroup" aria-label="حالت نمایش">
                {THEMES.map((t) => (
                  <button
                    key={t.value} type="button" role="radio" aria-checked={s.theme === t.value}
                    className={`theme-card ${s.theme === t.value ? 'on' : ''}`}
                    onClick={() => setS({ ...s, theme: t.value })}
                    title={t.hint}
                  >
                    <span className={`theme-thumb ${t.value}`} aria-hidden="true">
                      <i className="tt-bar" /><i className="tt-side" /><i className="tt-line" /><i className="tt-line short" />
                    </span>
                    <span className="theme-name"><IconCheck size={12} /> {t.label}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="فونت">
              <Select value={s.fontFamily} onChange={(v) => setS({ ...s, fontFamily: v })}
                options={[{ value: 'vazirmatn', label: 'وزیرمتن (پیش‌فرض)' }, { value: 'system', label: 'فونت سیستم (سبک‌ترین)' }]} />
            </Field>
            <Field label="فشردگی چیدمان">
              <Select value={s.density} onChange={(v) => setS({ ...s, density: v })}
                options={[{ value: 'comfortable', label: 'راحت' }, { value: 'compact', label: 'فشرده' }]} />
            </Field>
            <Field label="شکل گوشه‌ها">
              <Select value={s.corners || 'normal'} onChange={(v) => setS({ ...s, corners: v })}
                options={[{ value: 'soft', label: 'نرم' }, { value: 'normal', label: 'معمولی' }, { value: 'sharp', label: 'تیز' }]} />
            </Field>
            <Field label="حالت موجودی دخل" hint="ساده: همه مصارف کم می‌شود. دقیق: فقط نقدی که از دخل رفته.">
              <Select value={s.cashMode} onChange={(v) => setS({ ...s, cashMode: v })}
                options={[{ value: 'simple', label: 'ساده (پیش‌فرض)' }, { value: 'accurate', label: 'دقیق' }]} />
            </Field>
            {/*
              * باگ: مقدار پیش‌فرض داخل `value` نوشته شده بود (`|| '8'`). وقتی
              * کاربر کادر را پاک می‌کرد، همان لحظه «8» برمی‌گشت و تایپ عدد نو
              * ممکن نبود. حالا پیش‌فرض فقط «جای‌نگهدار» است و کادر واقعاً خالی
              * می‌شود؛ هنگام ذخیره هم مقدار خالی به پیش‌فرض سرور می‌رسد.
              */}
            <Field label="ساعت کاری روزانه" hint="برای محاسبه اضافه کاری">
              <input className="input input-num" value={s.attendanceWorkHours ?? ''} placeholder="8"
                inputMode="decimal"
                onChange={(e) => setS({ ...s, attendanceWorkHours: e.target.value })} /></Field>
            <Field label="پیشوند بل فروش" hint={`نمونه: ${s.docPrefixSale || 'S'}-1405-0001`}>
              <input className="input" value={s.docPrefixSale ?? ''} placeholder="S"
                onChange={(e) => setS({ ...s, docPrefixSale: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} /></Field>
            <Field label="پیشوند سند مصرف" hint={`نمونه: ${s.docPrefixExpense || 'E'}-1405-0001`}>
              <input className="input" value={s.docPrefixExpense ?? ''} placeholder="E"
                onChange={(e) => setS({ ...s, docPrefixExpense: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} /></Field>
            <Field label="پیشوند رسید" hint={`نمونه: ${s.docPrefixReceipt || 'R'}-1405-0001`}>
              <input className="input" value={s.docPrefixReceipt ?? ''} placeholder="R"
                onChange={(e) => setS({ ...s, docPrefixReceipt: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} /></Field>
            <Field label="پیشوند سند معاش" hint={`نمونه: ${s.docPrefixSalary || 'P'}-1405-0001`}>
              <input className="input" value={s.docPrefixSalary ?? ''} placeholder="P"
                onChange={(e) => setS({ ...s, docPrefixSalary: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} /></Field>
            <Field label="سهم اضافه کاری" hint="نرخ هر ساعت اضافه کاری نسبت به ساعت عادی — در محاسبه ورق معاش اثر دارد">
              <input className="input input-num" value={s.overtimeRate ?? ''} placeholder="1.25"
                inputMode="decimal"
                onChange={(e) => setS({ ...s, overtimeRate: e.target.value })} /></Field>
          </div>

          <div className="section-title">رنگ اصلی</div>
          <div className="chip-list">
            {ACCENTS.map((a) => (
              <button key={a.value} className="btn" style={{
                background: a.color, color: '#fff', borderColor: a.color,
                outline: s.accent === a.value ? '3px solid color-mix(in srgb, var(--text) 30%, transparent)' : 'none',
                outlineOffset: 2,
              }} onClick={() => setS({ ...s, accent: a.value })}>{a.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>فهرست‌های کشویی</h3></div>
        <div className="card-b">
          <div className="grid c3">
            {[
              ['material', 'اقلام و مواد', 'نوع مواد شیت فروشات + واحد'],
              ['expense_category', 'انواع مصرف', 'کرایه، پیسکاری، خرید…'],
              ['payer', 'پرداخت‌کنندگان', 'دخل، احمد، بانک…'],
              ['receipt_source', 'منابع رسیدات', 'باقی داری، امانت، بیانیه، مربوط'],
              ['contractor', 'مربوط (شاخه مصرف)', 'شاخه‌ی هزینه در فروشات، مصارف و رسیدات'],
            ].map(([t, title, hint]) => (
              <Link key={t} to={`/settings/lookups/${t}`} className="card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
                <div className="small muted">{hint}</div>
                <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>ویرایش فهرست</div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid c2">
        <div className="card">
          <div className="card-h"><h3>دیتابیس و ساختار</h3><div style={{ flex: 1 }} />
            {isManager ? <button className="btn sm" onClick={repair}>بررسی و ترمیم</button> : null}</div>
          <div className="card-b">
            {!health ? <Spinner /> : (
              <>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <span>وضعیت ساختار</span>
                  <span className={`badge ${health.schemaOk ? 'ok' : 'bad'}`}>{health.schemaOk ? 'درست' : 'نیاز به ترمیم'}</span>
                </div>
                <dl className="kv">
                  <dt>فایل دیتابیس</dt><dd className="mono small" style={{ wordBreak: 'break-all' }}>{health.dbFile}</dd>
                  <dt>جداول</dt><dd>{health.tables.length}</dd>
                  <dt>کاربران</dt><dd>{health.userCount}</dd>
                  <dt>زمان پاسخ</dt><dd>{health.ms} ms</dd>
                  <dt>حجم</dt><dd>{(Number(info?.dbSize || 0) / 1024).toFixed(0)} KB</dd>
                </dl>

                {/*
                  * «بدون نصب چیز اضافه» — خودآزمایی نسخه‌ی نصب‌شده.
                  * اگر باینری ویندوزی یا node.exe همراه بسته جا افتاده باشد،
                  * همین‌جا قرمز دیده می‌شود (به‌جای اینکه کاربر بعداً با
                  * «برنامه باز نمی‌شود» روبه‌رو شود).
                  */}
                {info?.runtime ? (
                  <div style={{ marginTop: 14 }}>
                    <div className="row between" style={{ marginBottom: 8 }}>
                      <span>اجرای بدون نصب اضافی</span>
                      <span className={`badge ${info.runtime.sqlite === 'ok' && info.runtime.writableDataDir ? 'ok' : 'bad'}`}>
                        {info.runtime.sqlite === 'ok' && info.runtime.writableDataDir ? 'آماده' : 'نیاز به بررسی'}
                      </span>
                    </div>
                    <dl className="kv">
                      <dt>موتور دیتابیس</dt>
                      <dd>
                        {info.runtime.sqlite === 'ok' ? 'درست' : info.runtime.sqlite}
                        {/*
                          * «بارگذاری دستی» یعنی موتور پیدا شد ولی از مسیر
                          * معمولِ نصب نبود (بسته‌ی portable / مسیر جابه‌جا
                          * شده) — خوب است بدانید، ولی خطا نیست.
                          */}
                        {info.runtime.sqlite === 'ok' && (info.runtime.sqliteDetail || '').includes('دستی')
                          ? ' — از مسیر جانبی بارگذاری شد'
                          : ''}
                      </dd>
                      <dt>پوشه داده قابل نوشتن</dt>
                      <dd>{info.runtime.writableDataDir ? 'بله' : 'نه — دسترسی را بررسی کنید'}</dd>
                      <dt>پلتفرم</dt>
                      <dd className="mono small">{info.runtime.platform} · Node {info.node}</dd>
                      <dt>حافظه</dt>
                      <dd>{info.runtime.totalMemGb} GB</dd>
                    </dl>
                    {info.runtime.sqlite !== 'ok' ? (
                      <div className="small" style={{ color: 'var(--bad, #b91c1c)', marginTop: 8 }}>
                        <p style={{ margin: 0 }}>
                          موتور دیتابیس این نسخه پیدا نشد. یک بار برنامه را دوباره نصب کنید یا از «ابزار نجات» کمک بگیرید.
                        </p>
                        {/*
                          * قبلاً این‌جا فقط یک پیام کلی بود و کاربر نمی‌دانست
                          * چه چیزی کم است. حالا *کدام* فایل جست‌وجو شد را
                          * نشان می‌دهیم تا پشتیبانی سریع جواب بدهد.
                          */}
                        {info.runtime.sqliteChecked?.length ? (
                          <details style={{ marginTop: 6 }}>
                            <summary style={{ cursor: 'pointer' }}>جزئیات برای پشتیبانی</summary>
                            <div className="mono small" style={{ wordBreak: 'break-all', marginTop: 6 }}>
                              {(info.runtime.sqliteChecked || []).map((p) => (
                                <div key={p}>{p}</div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h3>تغییر رمز عبور من</h3></div>
          <div className="card-b">
            <div className="form-grid c1">
              <Field label="رمز فعلی"><input className="input" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
              <Field label="رمز تازه" hint="حداقل ۵ حرف"><input className="input" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
              <button className="btn primary" onClick={changePw} disabled={!pw.currentPassword || !pw.newPassword}>تغییر رمز</button>
            </div>
          </div>
        </div>
      </div>

      {/* وضعیت لایسنس — خلاصه؛ مدیریت کامل در /license */}
      <div className="card">
        <div className="card-h">
          <h3>لایسنس و قفل دستگاه</h3>
          <div style={{ flex: 1 }} />
          <Link className="btn sm" to="/license">مدیریت لایسنس</Link>
        </div>
        <div className="card-b">
          {license ? (
            <>
              <div className="row between" style={{ marginBottom: 10 }}>
                <span>وضعیت</span>
                <span className={`badge ${license.ok ? (license.state === 'trial' ? 'warn' : 'ok') : 'bad'}`}>
                  {license.ok ? (license.state === 'trial' ? 'دوره‌ی آزمایشی' : 'معتبر') : 'نیاز به لایسنس'}
                </span>
              </div>
              <dl className="kv">
                <dt>کلید دستگاه</dt>
                <dd className="mono small" dir="ltr">{license.machineKey || '—'}</dd>
                {license.customer ? <><dt>مشتری</dt><dd>{license.customer}</dd></> : null}
                {license.kindLabel ? <><dt>نوع لایسنس</dt><dd>{license.kindLabel}</dd></> : null}
                <dt>پایان اعتبار</dt>
                <dd>
                  {license.endLabel || '—'}
                  {typeof license.daysLeft === 'number' ? (
                    <span className="small muted"> ({license.daysLeft} روز مانده)</span>
                  ) : null}
                </dd>
              </dl>
              <p className="small muted" style={{ marginTop: 10, lineHeight: 2 }}>
                {license.message}
              </p>
            </>
          ) : <Spinner label="خواندن وضعیت لایسنس…" />}
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>کارکرد کاملاً محلی</h3></div>
        <div className="card-b">
          <p className="small muted" style={{ lineHeight: 2 }}>
            این سیستم هیچ درخواستی به انترنت نمی‌فرستد: فونت‌ها داخل برنامه ذخیره شده‌اند، دیتابیس روی همین کمپیوتر است
            و هیچ CDN یا سرویس بیرونی استفاده نمی‌شود. برای انتقال معلومات به کمپیوتر دیگر از بخش «پشتیبان‌گیری» استفاده کنید.
          </p>
        </div>
      </div>
    </div>
  );
}
