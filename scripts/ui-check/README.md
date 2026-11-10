# scripts/ui-check — تست‌های «هوشمند بدون مرورگر»

همه‌ی این تست‌ها بدون مرورگر و بدون بسته‌ی واقعی اجرا می‌شوند تا بشود در هر
محیطی (و در CI) مطمئن شد باگ‌های قدیمی برنگشته‌اند.

| فایل | چه چیزی را می‌سنجد | اجرا |
|------|-------------------|------|
| `layout.test.mjs` | ساختار چیدمان، سایدبار، دکمه‌ها | `npm run test:ui` |
| `dom.test.mjs` | ساختار DOM کامپوننت‌ها | `npm run test:ui` |
| `sidebar.test.mjs` | گروه‌های مستقل سایدبار و تاگل‌ها | `npm run test:ui` |
| `theme.test.mjs` | سه تم، پالت رنگ، اعمال واقعی روی `<html>` | `npm run test:ui` |
| `form.test.mjs` | تایپ پیوسته در کادرها بدون پرش فوکوس | `npm run test:ui` |
| `routes.test.mjs` | ترتیب مسیرهای NestJS (ثابت قبل از پارامتری) | `npm run test:routes` |
| `api-guards.test.mjs` | تاریخ/تنظیمات/حذف کارمند: هیچ مسیر ۵۰۰ ندهد | `npm run test:guards` |
| `nsis-langs.test.mjs` | نصب‌کننده‌ی NSIS فارسی | `npm run test:nsis` |
| `tauri-src.test.mjs` | سورس Rust با API واقعی tauri v2.9.0 | `npm run test:tauri` |

## نکته‌ی `api-guards.test.mjs`

این تست پرونده‌های `.controller.ts` را می‌پیماید و هر فراخوانی `parseUserDate`
را که **بیرون از `try`** باشد نشان می‌دهد. دلیلش: `parseUserDate` یک
`Error` ساده می‌اندازد، نه `HttpException`؛ پس Nest آن را به
«۵۰۰ Internal server error» تبدیل می‌کند و کاربر پیام فارسی نمی‌بیند
(این باگ در راپور روزانه و شماره‌ی بعدی سند واقعاً رخ داده بود).
