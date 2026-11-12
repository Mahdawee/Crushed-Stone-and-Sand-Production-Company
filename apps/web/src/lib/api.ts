/**
 * Tiny API client — every request carries the session token and throws the
 * Persian error message coming from the server so the UI can show it as a toast.
 */
const TOKEN_KEY = 'farday.token';

/**
 * The desktop window and the API live on the SAME local origin
 * (http://127.0.0.1:4317): in a packaged build the NestJS process also serves
 * the built React files, and in development Vite proxies "/api".
 * Set VITE_API_URL only if you want to point the UI at another instance.
 */
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t: string) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  /** بدنه‌ی ساختاریافته‌ی خطا (اگر سرور داده باشد) */
  body?: any;
  constructor(message: string, status: number, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
  /** لایسنس لازم است؟ (کد ۴۲۳ از نگهبان لایسنس) */
  get needsLicense(): boolean {
    return this.status === 423 || this.body?.code === 'LICENSE_REQUIRED';
  }
}

async function request<T>(method: string, path: string, body?: any, opts: { raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-auth-token': getToken() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('ارتباط با سرویس داخلی برقرار نشد. برنامه را یک بار ببندید و دوباره باز کنید.', 0);
  }
  if (res.status === 401) {
    const txt = await res.text();
    let msg = 'برای ادامه وارد سیستم شوید.';
    try { msg = JSON.parse(txt).message || msg; } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('farday:unauthorized'));
    throw new ApiError(msg, 401);
  }
  if (!res.ok) {
    const txt = await res.text();
    let msg = 'خطا در انجام عملیات.';
    let j: any = null;
    try {
      j = JSON.parse(txt);
      msg = Array.isArray(j.message) ? j.message.join('، ') : j.message || msg;
    } catch { msg = txt.slice(0, 200) || msg; }
    /*
     * ۴۲۳ = «لایسنس معتبر نیست». برخلاف ۴۰۱ (نشست تمام شد) این خطا نباید
     * کاربر را از سیستم بیرون بیندازد — فقط باید صفحه‌ی لایسنس باز شود.
     */
    if (res.status === 423 || j?.code === 'LICENSE_REQUIRED') {
      window.dispatchEvent(new CustomEvent('farday:license-required', { detail: j?.license || null }));
    }
    throw new ApiError(msg, res.status, j);
  }
  if (opts.raw) return res as any;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return (await res.text()) as any;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: any) => request<T>('POST', p, b),
  put: <T = any>(p: string, b?: any) => request<T>('PUT', p, b),
  del: <T = any>(p: string) => request<T>('DELETE', p),
};

/* ================================================================== */
/* فایل‌ها: خروجی اکسل/CSV و ورودی از اکسل                            */
/* ================================================================== */

/**
 * دانلود یک فایل از API.
 *
 * ## باگ واقعی که این تابع حل می‌کند
 * نسخه‌ی قبلی `fetch(`${API_BASE}/export?...`)` صدا می‌زد، ولی `API_BASE`
 * خودش `/api` است → آدرس می‌شد `/api/api/export` و همیشه ۴۰۴ برمی‌گشت.
 * برای همین دکمه‌ی «اکسل» در پنج صفحه هیچ کاری نمی‌کرد (خطا هم بی‌صدا رد
 * می‌شد چون `catch` نداشت).
 */
async function downloadFile(path: string, filename: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { 'x-auth-token': getToken() } });
  } catch {
    throw new ApiError('ارتباط با سرویس داخلی برقرار نشد.', 0);
  }
  if (!res.ok) {
    let msg = 'خروجی گرفتن انجام نشد.';
    try {
      const j = await res.json();
      msg = j.message || msg;
    } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  /*
   * نام فایل را از Content-Disposition می‌خوانیم (سرور نام فارسی هم
   * می‌فرستد). اگر نبود، نام پیش‌فرض.
   */
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  const finalName = m ? decodeURIComponent(m[1]) : filename;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type ExportFormat = 'csv' | 'xls';

/**
 * خروجی گرفتن.
 * @param type employees | customers | sales | receipts | expenses | salaries | attendance
 * @param format `xls` = کارپوشه‌ی اکسل (پیشنهادی) · `csv` = ساده
 */
export async function downloadCsv(
  type: string,
  format: ExportFormat = 'xls',
  /*
   * محدوده‌ی تاریخ (اختیاری). باگ: خروجی از «راپور تفصیلی» همه‌ی سال‌ها را
   * می‌داد، نه بازه‌ای که روی صفحه انتخاب شده بود — جمع ستون‌ها با جدول
   * نمی‌خواند.
   */
  range?: { from?: string; to?: string },
): Promise<void> {
  const ext = format === 'xls' ? 'xls' : 'csv';
  const qs = new URLSearchParams({ type, format });
  if (range?.from) qs.set('from', range.from);
  if (range?.to) qs.set('to', range.to);
  await downloadFile(`${API_BASE}/export?${qs.toString()}`, `${type}-${new Date().toISOString().slice(0, 10)}.${ext}`);
}

/** دانلود «فایل نمونه» برای ورود از اکسل */
export async function downloadImportTemplate(type: string, format: ExportFormat = 'xls'): Promise<void> {
  const ext = format === 'xls' ? 'xls' : 'csv';
  await downloadFile(
    `${API_BASE}/import/template?type=${encodeURIComponent(type)}&format=${format}`,
    `template-${type}.${ext}`,
  );
}

/** انواع ورودی/خروجی — برای منوها */
export type ImportType = {
  key: string; title: string; enabled: boolean;
  headers: string[]; sample: string[]; hints?: string[]; reason: string;
};
export const listImportTypes = () => request<{ items: ImportType[] }>('GET', '/import/types');
export const listExportTypes = () =>
  request<{ items: { key: string; title: string; headers: string[] }[]; formats: { key: string; title: string }[] }>('GET', '/export/types');

/** بررسی فایل (dryRun) یا ثبت واقعی */
export type ImportReport = {
  dryRun: boolean;
  total?: number;
  valid?: number;
  inserted?: number;
  errors: string[];
  warnings: string[];
  duplicates: string[];
  skipped?: string[];
  preview?: any[];
  message: string;
};
export const runImport = (type: string, csv: string, dryRun: boolean) =>
  request<ImportReport>('POST', `/import/${encodeURIComponent(type)}?x=1`, { csv, dryRun });

/** خواندن فایل متنی که کاربر انتخاب کرده (CSV/متنی) */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('فایل خوانده نشد.'));
    r.onload = () => resolve(String(r.result || ''));
    r.readAsText(file, 'utf-8');
  });
}

/* ================================================================== */
/* سطل بازیافت                                                        */
/* ================================================================== */

export type RecycleTable = { table: string; label: string; count: number; titleCol: string; extraCols: string[] };
export const listRecycle = () => request<{ items: RecycleTable[]; total: number }>('GET', '/recycle');
export const listDeleted = (table: string, page = 1, pageSize = 100) =>
  request<{ table: string; label: string; titleCol: string; extraCols: string[]; rows: any[]; total?: number; page?: number; pageSize?: number }>(
    'GET', `/recycle/${encodeURIComponent(table)}?page=${page}&limit=${pageSize}`,
  );
export const restoreDeleted = (table: string, id: number) =>
  request<{ ok: boolean; message: string }>('POST', `/recycle/${encodeURIComponent(table)}/${id}/restore`, {});
