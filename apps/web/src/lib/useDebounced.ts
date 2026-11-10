import { useEffect, useState } from 'react';

/** مقدار تایپ‌شده را با تأخیر برمی‌گرداند تا با هر حرف یک درخواست به سرور نرود. */
export function useDebounced<T>(value: T, ms = 320): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
