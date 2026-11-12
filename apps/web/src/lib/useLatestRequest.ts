import { useCallback, useRef } from 'react';

/**
 * «آخرین درخواست برنده است».
 *
 * مشکل واقعی در فهرست‌های جستجو‌شدنی: کاربر تایپ می‌کند «کر», بعد «کرش».
 * اگر پاسخ «کر» (که سنگین‌تر بود، چون مانده‌ی بدهی همه را حساب می‌کند) دیرتر
 * برسد، نتیجه‌ی قدیمی روی نتیجه‌ی تازه می‌نشیند — یعنی جدول چیزی نشان می‌دهد
 * که با متن کادر جستجو نمی‌خواند و کاربر فکر می‌کند «سیستم قاطی کرده».
 *
 * این قلاب یک شمارنده‌ی نسل نگه می‌دارد و فقط نتیجه‌ی آخرین درخواست را اعمال
 * می‌کند؛ بقیه بی‌صدا دور ریخته می‌شوند.
 *
 *   const latest = useLatestRequest();
 *   const load = (p = page) => latest(() => api.get(url), setData);
 */
export function useLatestRequest() {
  const gen = useRef(0);
  return useCallback(async <T,>(fn: () => Promise<T>, apply: (v: T) => void) => {
    const mine = ++gen.current;
    try {
      const v = await fn();
      if (mine === gen.current) apply(v);
      return v;
    } catch (e) {
      /* خطای درخواست‌های کهنه نباید پیام بدهد (ممکن است فقط تایپ سریع باشد) */
      if (mine === gen.current) throw e;
      return undefined as unknown as T;
    }
  }, []);
}
