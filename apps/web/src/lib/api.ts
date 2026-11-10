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

/** Download a file produced by the API (CSV export). */
export async function downloadCsv(type: string) {
  const res = await fetch(`${API_BASE}/export?type=${encodeURIComponent(type)}`, {
    headers: { 'x-auth-token': getToken() },
  });
  if (!res.ok) throw new ApiError('خروجی گرفتن انجام نشد.', res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
