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
  /* وضعیت بروزرسانی — درخواست مالک: «همه بتوانند بروزرسانی را درست بگیرند» */
  const [upg, setUpg] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });

  useEffect(() => { setS(settings); }, [settings]);

  /*
   * ── بررسی سلامت (پیشنهاد D2، دور ۴۰) ─────────────────────────────────
   * یک تابع مستقل، چون دکمه‌ی «بررسی دوباره» هم لازم است: اگر کاربر فضای
   * دیسک را آزاد کرد، باید بتواند بدون بستن برنامه نتیجه را ببیند.
   *
   * `checking` وضعیت دکمه است — بدون آن، کاربر فکر می‌کند کلیکش کار نکرده.
   */
  const [checking, setChecking] = useState(false);
  const loadInfo = React.useCallback(async () => {
    setChecking(true);
    try {
      const [h, i, u] = await Promise.all([
        api.get('/system/health').catch(() => null),
        api.get('/system/info').catch(() => null),
        api.get('/system/upgrade/status').catch(() => null),
      ]);
      /* فقط نتیجه‌ی موفق جای قبلی را می‌گیرد؛ یک خطای لحظه‌ای نباید
         اطلاعات سالم روی صفحه را پاک کند */
      if (h) setHealth(h);
      if (i) setInfo(i);
      if (u) setUpg(u);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void loadInfo(); }, [loadInfo]);

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
            {/*
              * باگ (شکار باگ دور ۳۲): نرخ دالر در API بود ولی در هیچ صفحه‌ای
              * کادر نداشت و در هیچ محاسبه‌ای هم اثر نداشت. حالا هر دو:
              * نرخ، و کلید «در سود/زیان حساب شود» (پیش‌فرض خاموش تا عددهای
              * فعلی هیچ شرکتی بی‌خبر عوض نشود).
              */}
            <Field label="نرخ دالر (افغانی)" hint="برای تبدیل مصارف دالری — فقط وقتی کلید زیر روشن باشد">
              <input className="input input-num" value={s.usdRate ?? ''} placeholder="0"
                inputMode="decimal"
                onChange={(e) => setS({ ...s, usdRate: e.target.value })} /></Field>
            <Field label="دالری در سود و زیان" hint="روشن: مصارف دالری با نرخ بالا به افغانی تبدیل و در مجموع مصارف/سود حساب می‌شود">
              <Select value={s.usdInProfit ?? '0'} onChange={(v) => setS({ ...s, usdInProfit: v })}
                options={[
                  { value: '0', label: 'خاموش (پیش‌فرض) — دالری جدا می‌ماند' },
                  { value: '1', label: 'روشن — با نرخ دالر تبدیل شود' },
                ]} /></Field>
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

      {/*
        * ── پنل «بروزرسانی» ─────────────────────────────────────────────
        * برنامه بین چند شرکت توزیع شده. مدیر باید بدون تماس با پشتیبانی
        * ببیند: نسخه‌ی برنامه چیست، ساختار دیتابیس هم‌تراز است یا نه، و
        * آخرین بروزرسانی‌ها پشتیبان گرفته‌اند یا نه. اگر کاپی داده از یک
        * نسخه‌ی **جدیدتر** آمده باشد، این پنل صریح می‌گوید.
        */}
      {isManager && upg ? (
        <div className="card">
          <div className="card-h"><h3>بروزرسانی و سازگاری داده</h3><div style={{ flex: 1 }} />
            <span className={`badge ${upg.dbNewer || upg.dbBehind ? 'warn' : 'ok'}`}>
              {upg.dbNewer ? 'داده از این نسخه جدیدتر است' : upg.dbBehind ? 'ساختار عقب مانده' : 'هم‌تراز'}
            </span>
          </div>
          <div className="card-b">
            <dl className="kv">
              <dt>نسخه‌ی برنامه</dt><dd className="mono">{upg.appVersion}</dd>
              <dt>ساختار دیتابیس</dt><dd className="mono">{upg.dbShape} از {upg.expectedShape}</dd>
              <dt>پشتیبان‌های بروزرسانی</dt><dd>{upg.backups?.length ? upg.backups.join(' · ') : '—'}</dd>
            </dl>
            {upg.dbNewer ? (
              <p className="small" style={{ marginTop: 10 }}>
                این دیتابیس با نسخه‌ی جدیدتری از برنامه ساخته شده. برنامه را بروزرسانی کنید؛
                نوشتن با نسخه‌ی قدیمی ممکن است داده را ناسازگار کند.
              </p>
            ) : upg.dbBehind ? (
              <p className="small" style={{ marginTop: 10 }}>
                ساختار دیتابیس از این نسخه عقب است. یک بار برنامه را ببندید و باز کنید تا بروزرسانی انجام شود؛
                اگر همین‌جا ماند، از پوشه‌ی backups آخرین فایل <span className="mono">pre-upgrade</span> را با
                «ابزار نجات» بازگردانید.
              </p>
            ) : null}
            {upg.history?.length ? (
              <div style={{ marginTop: 12 }}>
                <div className="small muted" style={{ marginBottom: 6 }}>تاریخچه‌ی بروزرسانی این دیتابیس</div>
                <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
                  {upg.history.slice(0, 5).map((h: string, i: number) => (
                    <li key={i} className="mono" style={{ wordBreak: 'break-all' }}>{h}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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
                  {/*
                    ── باگ (شکار باگ دور ۳۴): «۰ روز مانده» یعنی امروز آخرین روز ──
                    `daysLeft` شماره‌ی روزها را می‌دهد؛ صفر یعنی لایسنس **تا پایان
                    امروز** معتبر است، نه اینکه منقضی شده. نوشتن «۰ روز مانده»
                    کاربر را وادار می‌کرد فکر کند وقت تمام شده.
                  */}
                  {typeof license.daysLeft === 'number' ? (
                    <span className="small muted">
                      {' '}({license.daysLeft > 0
                        ? `${license.daysLeft} روز مانده`
                        : license.daysLeft === 0 ? 'امروز آخرین روز' : 'منقضی شده'})
                    </span>
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

      {/*
        ── «درباره و بررسی سلامت» (پیشنهاد D2، دور ۴۰) ─────────────────────
        کاربری که تازه نصب کرده، هیچ راهی نداشت بفهمد «همه‌چیز درست است یا نه»
        بدون اینکه تنظیمات را باز کند و بداند کدام ردیف مهم است. این کارت
        همه‌ی بررسی‌ها را به یک جمله‌ی روشن تبدیل می‌کند: سالم است یا نه، و اگر
        نه، چه کاری کند.
      */}
      <AboutCard info={info} onRefresh={loadInfo} />

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

/**
 * کارت «درباره و بررسی سلامت» — پیشنهاد D2، دور ۴۰.
 *
 * ── چرا این کارت ─────────────────────────────────────────────────────────
 * برنامه‌ی نصب‌شده ابزار `doctor` ندارد (آن ابزار پیش‌نیازهای **ساخت** را
 * می‌سنجد: Rust، MSVC — روی کمپیوتر مشتری وجود ندارند و نباید هم باشند).
 * چیزی که مشتری لازم دارد این است: «آیا برنامه سالم است؟ اگر نه، چه کنم؟»
 *
 * ── تصمیم‌ها ─────────────────────────────────────────────────────────────
 * • هیچ‌وقت «سالم» نمی‌گوید مگر همه‌ی بررسی‌ها واقعاً آمده باشند. نبودِ
 *   پاسخ = «نامعلوم»، نه «سالم» — همان اشتباهی که در `verify-bundle` هم
 *   عمداً مرتکب نمی‌شویم.
 * • مشکل‌ها **اول** می‌آیند. کاربر دنبال مشکل می‌گردد، نه دنبال تأیید.
 * • هر مشکل یک جمله‌ی «چه کار کنم» دارد، نه یک پیام فنی.
 */
function AboutCard({ info, onRefresh }: { info: any; onRefresh: () => Promise<void> | void }) {
  const [busy, setBusy] = React.useState(false);
  const rt = info?.runtime;

  const checks: { label: string; ok: boolean | null; detail: string; fix?: string }[] = [
    {
      label: 'فایل دیتابیس',
      ok: info ? Boolean(info.dbFile) : null,
      detail: info?.dbFile || 'در حال خواندن…',
    },
    {
      label: 'موتور دیتابیس (SQLite)',
      ok: rt ? rt.sqlite === 'ok' : null,
      detail: rt ? (rt.sqlite === 'ok' ? 'درست' : String(rt.sqlite)) : 'در حال خواندن…',
      fix: 'برنامه را دوباره باز کنید؛ اگر تکرار شد، فایل نصبی را دوباره نصب کنید.',
    },
    {
      label: 'اجازه‌ی نوشتن در پوشه‌ی داده',
      ok: rt ? Boolean(rt.writableDataDir) : null,
      detail: rt ? (rt.writableDataDir ? 'دارد' : 'ندارد') : 'در حال خواندن…',
      fix: 'آنتی‌ویروس یا دسترسی پوشه را بررسی کنید، یا برنامه را به‌عنوان مدیر یک بار باز کنید.',
    },
    {
      label: 'نسخه‌ی برنامه و ساختار داده',
      ok: info ? true : null,
      detail: info ? `${info.version || '—'} · ساختار ${info.schemaVersion ?? '—'}` : 'در حال خواندن…',
    },
  ];

  const unknown = checks.filter((c) => c.ok === null).length;
  const bad = checks.filter((c) => c.ok === false);
  const allOk = unknown === 0 && bad.length === 0;

  const tone = bad.length > 0 ? 'bad' : allOk ? 'ok' : 'warn';
  const headline =
    bad.length > 0
      ? `${bad.length} مورد نیاز به بررسی دارد`
      : unknown > 0
        ? 'در حال بررسی…'
        : 'همه‌چیز سالم است';

  const recheck = async () => {
    setBusy(true);
    try { await onRefresh(); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="card-h">
        <h3>درباره و بررسی سلامت</h3>
        <div style={{ flex: 1 }} />
        <span className={`badge ${tone}`}>{headline}</span>
        <button type="button" className="btn sm" onClick={recheck} disabled={busy}>
          {busy ? 'در حال بررسی…' : 'بررسی دوباره'}
        </button>
      </div>
      <div className="card-b">
        <dl className="kv" style={{ marginBottom: 12 }}>
          <dt>نسخه‌ی برنامه</dt><dd className="mono small" dir="ltr">{info?.version || '—'}</dd>
          <dt>ساختار داده</dt><dd className="mono small" dir="ltr">{info?.schemaVersion ?? '—'}</dd>
          <dt>پوشه‌ی داده</dt><dd className="mono small" dir="ltr" style={{ wordBreak: 'break-all' }}>{info?.dataDir || '—'}</dd>
          <dt>حجم دیتابیس</dt><dd>{info?.dbSize ? `${(Number(info.dbSize) / 1024).toFixed(0)} KB` : '—'}</dd>
        </dl>

        <Table head={['بررسی', 'نتیجه', 'توضیح']}>
          {checks.map((c) => (
            <tr key={c.label}>
              <td>{c.label}</td>
              <td>
                <span className={`badge ${c.ok === null ? 'warn' : c.ok ? 'ok' : 'bad'}`}>
                  {c.ok === null ? 'نامعلوم' : c.ok ? 'درست' : 'مشکل'}
                </span>
              </td>
              <td className="small">
                <div className="mono" dir="auto" style={{ wordBreak: 'break-all' }}>{c.detail}</div>
                {/* «چه کار کنم» فقط برای موردی که واقعاً مشکل دارد */}
                {c.ok === false && c.fix ? <div className="muted" style={{ marginTop: 4 }}>{c.fix}</div> : null}
              </td>
            </tr>
          ))}
        </Table>

        {/*
          «نامعلوم» عمداً از «درست» جدا است. اگر پاسخ سرور نیامده باشد،
          نوشتن «سالم» یعنی به کاربر دروغ گفتن — و همان چیزی است که باعث
          می‌شود کاربر بعداً بگوید «برنامه گفت سالم بود ولی کار نمی‌کرد».
        */}
        {unknown > 0 ? (
          <p className="small muted" style={{ marginTop: 10, lineHeight: 2 }}>
            {unknown} مورد هنوز پاسخ نداده است. اگر بعد از چند ثانیه هم «نامعلوم» ماند،
            برنامه را یک بار ببندید و دوباره باز کنید.
          </p>
        ) : null}
      </div>
    </div>
  );
}
