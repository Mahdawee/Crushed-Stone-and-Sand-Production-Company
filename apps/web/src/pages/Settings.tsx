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

export default function SettingsPage() {
  const { settings, saveSettings, calendar, isManager } = useSession();
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
    try { await saveSettings(s); toast.success('تنظیمات ذخیره شد'); }
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
            ⚠ تغییر تنظیمات فقط توسط مدیر سیستم ممکن است. می‌توانید مقادیر را ببینید، اما ذخیره فقط برای مدیر فعال است.
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
            <Field label="حالت نمایش">
              <Select value={s.theme} onChange={(v) => setS({ ...s, theme: v })}
                options={[{ value: 'light', label: 'روشن' }, { value: 'dark', label: 'تیره' }, { value: 'auto', label: 'خودکار (مطابق سیستم)' }]} />
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
            <Field label="ساعت کاری روزانه" hint="برای محاسبه اضافه کاری">
              <input className="input input-num" value={s.attendanceWorkHours || '8'}
                onChange={(e) => setS({ ...s, attendanceWorkHours: e.target.value })} /></Field>
            <Field label="پیشوند بل فروش" hint={`نمونه: ${s.docPrefixSale || 'S'}-1405-0001`}>
              <input className="input" value={s.docPrefixSale || 'S'} onChange={(e) => setS({ ...s, docPrefixSale: e.target.value.toUpperCase().slice(0, 3) })} /></Field>
            <Field label="پیشوند سند مصرف" hint={`نمونه: ${s.docPrefixExpense || 'E'}-1405-0001`}>
              <input className="input" value={s.docPrefixExpense || 'E'} onChange={(e) => setS({ ...s, docPrefixExpense: e.target.value.toUpperCase().slice(0, 3) })} /></Field>
            <Field label="پیشوند رسید" hint={`نمونه: ${s.docPrefixReceipt || 'R'}-1405-0001`}>
              <input className="input" value={s.docPrefixReceipt || 'R'} onChange={(e) => setS({ ...s, docPrefixReceipt: e.target.value.toUpperCase().slice(0, 3) })} /></Field>
            <Field label="پیشوند سند معاش" hint={`نمونه: ${s.docPrefixSalary || 'P'}-1405-0001`}>
              <input className="input" value={s.docPrefixSalary || 'P'} onChange={(e) => setS({ ...s, docPrefixSalary: e.target.value.toUpperCase().slice(0, 3) })} /></Field>
            <Field label="سهم اضافه کاری" hint="نرخ هر ساعت اضافه کاری نسبت به ساعت عادی">
              <input className="input input-num" value={s.overtimeRate || '1.25'}
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
              ['receipt_source', 'منابع رسیدات', 'باقی داری، امانت، بیانیه'],
              ['contractor', 'باربری‌ها / دمترک‌ها', 'مربوط در فروشات'],
            ].map(([t, title, hint]) => (
              <Link key={t} to={`/settings/lookups/${t}`} className="card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
                <div className="small muted">{hint}</div>
                <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>ویرایش فهرست →</div>
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
