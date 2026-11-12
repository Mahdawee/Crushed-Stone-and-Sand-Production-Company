# راهنمای توسعه

## نیازمندی‌ها

| ابزار | نسخه |
|---|---|
| Node.js | 22 یا بالاتر |
| npm | 10+ |
| Rust + Cargo | فقط برای پنجره دسکتاپ (`rustup.rs`) |
| ویندوز | WebView2 Runtime (در ویندوز ۱۰/۱۱ موجود است) |

## راه‌اندازی

```bash
npm install
npm run dev          # API :4317  +  وب :5173
npm run seed:demo    # اطلاعات نمونه
```

در VS Code: `Ctrl+Shift+P` → **Tasks: Run Task** → «شروع کامل (API + وب)».

## اسکریپت‌ها

| دستور | کار |
|---|---|
| `npm run dev` | API + وب با هم |
| `npm run dev:api` | فقط API (`nest start --watch`) |
| `npm run dev:web` | فقط رابط (`vite`) |
| `npm run build` | build هر دو |
| `npm run typecheck` | بررسی تایپ‌های TS |
| `npm run seed:demo` | build API + اطلاعات نمونه |
| `npm run desktop:dev` | پنجره Tauri در حالت توسعه |
| `npm run package:api` | آماده‌سازی API در `src-tauri/api` |
| `npm run desktop:build` | ساخت نصب‌کننده |

## افزودن یک شیت تازه

۱. مدل را در `apps/api/prisma/schema.prisma` اضافه کنید.
۲. جدول + ایندکس را در `apps/api/src/schema.ts` (آرایه `TABLES` / `INDEXES`) اضافه کنید
   (تا در نصب‌های قدیمی هم خودکار ساخته شود).
۳. یک کنترولر در `apps/api/src/modules/` بسازید و در `app.module.ts` ثبت کنید.
۴. صفحه در `apps/web/src/pages/` + یک مسیر در `App.tsx` + یک آیتم در `NAV` داخل `Layout.tsx`.

> نکته: برای تاریخ‌ها همیشه از `parseUserDate` (ورودی) و `formatDate` (نمایش) استفاده کنید —
> آن‌ها تقویم شمسی/میلادی را خودکار مدیریت می‌کنند.

## نکات کلیدی کد

- **امنیت:** از دکوریتورهای `@ManagerOnly()` برای عملیات حساس استفاده کنید.
- **شماره سند:** همیشه `nextDocNo(prefix, calendar, dateISO)` — تضمین بدون تکرار.
- **لاگ:** `logActivity({ action, entity, entityId, detail })` بعد از هر تغییر.
- **پول:** همه مبالغ `Float` به افغانی (به جز `amountUsd` که جدا می‌ماند).
- **دیتابیس:** کلاینت Prisma در `apps/api/src/generated/prisma` تولید شده؛ بعد از تغییر schema:
  `cd apps/api && npx prisma generate` (آفلاین: `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate`).
