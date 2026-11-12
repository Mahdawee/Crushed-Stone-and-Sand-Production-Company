/**
 * CSV — نوشتن و **خواندن**.
 *
 * چرا این ماژول:
 *   ۱) خروجی فعلی «اکسل» در واقع CSV بود؛ ولی بدون BOM و با جداکننده‌ی
 *      کاما، روی ویندوزِ فارسی/اکسل عربی‌پسند همه‌ی ستون‌ها در یک ستون
 *      می‌ریخت. ما BOM + `sep=,` می‌گذاریم که اکسل قطعاً درست باز کند.
 *   ۲) ورودی از اکسل وجود نداشت. یک CSV ساده که اکسل می‌سازد (با BOM،
 *      ; یا , یا tab، نقل‌قول‌های تودرتو، خطوط خالی) باید درست خوانده شود.
 *
 * ⚠ عمداً از هیچ کتابخانه‌ی بیرونی استفاده نمی‌شود: بسته باید آفلاین و
 * سبک بماند و «CSV» با ۶۰ خط کد کامل قابل پیاده‌سازی است.
 */

/* ------------------------------------------------------------------ */
/* نوشتن                                                              */
/* ------------------------------------------------------------------ */

/** یک خانه را برای CSV امن می‌کند (کاما، نقل‌قول، خط نو). */
function cell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  /*
   * اگر مقدار با = یا + یا - یا @ شروع شود، اکسل آن را «فرمول» می‌بیند.
   * نام مشتری که با «-» شروع شود می‌تواند فرمول اجرا کند (CSV injection).
   * با یک آپاستروف بدون‌اثر بی‌خطر می‌شود.
   */
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export type CsvOptions = {
  /** جداکننده — پیش‌فرض `,` (اکسل انگلیسی). برای اکسل فارسی `;` هم رایج است */
  delimiter?: ',' | ';' | '\t';
  /** افزودن `sep=,` در خط اول تا اکسل جداکننده را قطعی تشخیص دهد */
  sepLine?: boolean;
};

/**
 * ساخت متن CSV با BOM.
 *
 * BOM (`\uFEFF`) برای اکسل **حیاتی** است: بدون آن، اکسل فایل را با کدپیج
 * سیستم (مثلاً Windows-1256) می‌خواند و «فردای روشن» می‌شود «ÙØ±Ø¯Ø§Û…».
 */
export function toCsv(headers: string[], rows: unknown[][], opts: CsvOptions = {}): string {
  const d = opts.delimiter || ',';
  const esc = d === ',' ? cell : (v: unknown) => {
    const s = cell(v);
    /* با جداکننده‌ی دیگر، خانه‌هایی که همان نویسه را دارند هم باید نقل‌قول شوند */
    return /[",\n\r]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  if (opts.sepLine) lines.push(`sep=${d}`);
  lines.push(headers.map(esc).join(d));
  for (const r of rows) lines.push(r.map(esc).join(d));
  return '\uFEFF' + lines.join('\r\n');
}

/* ------------------------------------------------------------------ */
/* خواندن                                                             */
/* ------------------------------------------------------------------ */

export type ParseResult = {
  /** سطرها — هر سطر آرایه‌ای از خانه‌ها (همه رشته، trim شده) */
  rows: string[][];
  /** نویسه‌ی جداکننده‌ای که تشخیص داده شد */
  delimiter: string;
  /** خطاهای ساختاری (اگر تعداد ستون‌ها ناهمخوان بود) */
  warnings: string[];
};

/**
 * تشخیص جداکننده از خط اول.
 *
 * چرا لازم است: کاربر فایل را با اکسل فارسی ذخیره می‌کند و اکسل در
 * منطقه‌های با «,» به‌عنوان اعشار، از `;` استفاده می‌کند. فایل‌های
 * tab-delimited هم از «ذخیره به‌عنوان متن» می‌آیند.
 */
export function guessDelimiter(text: string): string {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) || '';
  /* خط `sep=;` که اکسل می‌نویسد */
  const sep = first.match(/^sep=(.)/i);
  if (sep) return sep[1];
  const counts: Record<string, number> = {
    ',': (first.match(/,/g) || []).length,
    ';': (first.match(/;/g) || []).length,
    '\t': (first.match(/\t/g) || []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/**
 * خواندن CSV — با پشتیبانی از نقل‌قول، خط نو داخل خانه، BOM و `sep=`.
 *
 * این پیاده‌سازی «حالت‌محور» است (نه regex) تا خانه‌هایی مثل
 * `"تهران، خیابان ""اول"""` درست خوانده شوند.
 */
export function parseCsv(input: string): ParseResult {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = guessDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  /* خط اول اگر `sep=X` بود، داده نیست */
  const lines = text.split(/\r?\n/);
  if (/^sep=./i.test(lines[0] || '')) {
    lines.shift();
  }
  const body = lines.join('\n');

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    pushField();
    /* خطوط کاملاً خالی را نادیده بگیر (اکسل آخر فایل خالی می‌گذارد) */
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  while (i < body.length) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { pushField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { pushRow(); i++; continue; }
    field += ch; i++;
  }
  /* آخرین خط */
  if (field !== '' || row.length) pushRow();

  const warnings: string[] = [];
  const width = rows[0]?.length || 0;
  rows.forEach((r, idx) => {
    if (r.length !== width) {
      warnings.push(`سطر ${idx + 1}: ${r.length} ستون دارد، انتظار ${width} بود`);
    }
  });

  return { rows: rows.map((r) => r.map((c) => c.trim())), delimiter, warnings };
}

/* ------------------------------------------------------------------ */
/* تبدیل اعداد فارسی/عربی → انگلیسی                                   */
/* ------------------------------------------------------------------ */

/**
 * «۱٬۲۵۰٫۵» → 1250.5 · «1,250.5» → 1250.5
 *
 * چرا لازم است: کاربر در اکسل ممکن است عدد را فارسی تایپ کند، یا اکسل با
 * جداکننده‌ی هزارگان ذخیره کند. بدون این، `Number()` مقدار NaN می‌دهد و
 * import با پیام مبهم «عدد نامعتبر» شکست می‌خورد.
 */
export function normalizeNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  /* ارقام فارسی/عربی */
  s = s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  /* جداکننده‌ی هزارگان فارسی/عربی */
  s = s.replace(/[٬،]/g, '');
  /* ممیز فارسی */
  s = s.replace(/٫/g, '.');
  /* فاصله و نویسه‌های کنترلی */
  s = s.replace(/[\s\u200c\u200f\u200e]/g, '');
  /*
   * اگر هم `,` و هم `.` دارد، آخرین‌شان اعشار است (1,250.50 یا 1.250,50).
   * اگر فقط `,` دارد و بعدش ۳ رقم آمده، جداکننده‌ی هزارگان است.
   */
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
