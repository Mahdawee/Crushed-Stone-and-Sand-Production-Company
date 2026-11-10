# راهنمای کامل نصب Tauri و ساخت نصب‌کننده ویندوز

این راهنما برای کسی است که می‌خواهد از سورس، **فایل نصب `.exe`** بسازد.
کمپیوتر شرکت بعداً فقط همان فایل نصب را می‌خواهد — نه Rust، نه Node، نه انترنت.

> خلاصه در یک نگاه:
> `npm install` → `npm run doctor` → `npm run desktop:setup` → `npm run desktop:build`
> → فایل `src-tauri/target/release/bundle/nsis/*-setup.exe`

---

## ۰) پیش‌نیازها

| مورد | نسخه | چرا لازم است |
|---|---|---|
| Node.js | 22 LTS یا بالاتر | build کردن API و رابط |
| Rust (rustc + cargo) | 1.77 یا بالاتر | کامپایل پوسته دسکتاپ |
| Visual Studio Build Tools (ویندوز) | 2019/2022 | کامپایلر C++ برای لینک کردن |
| WebView2 Runtime | — | موتور نمایش پنجره (در ویندوز ۱۱ موجود) |
| ابزار Tauri CLI | v2 | `npm run desktop:setup` |

**حجم تقریبی:** ~۲٫۵ GB فضای دیسک (Build Tools ~۱٫۵GB + Rust ~۱GB) و ۲۰ دقیقه نصب یک‌باره.

---

## ۱) نصب Node.js

1. از <https://nodejs.org/en/download> نسخه **LTS (22.x)** ویندوز ۶۴-بیتی را دانلود کنید.
2. نصب معمولی (Next → Next → Install).
3. یک **PowerShell تازه** باز کنید و بزنید:
   ```powershell
   node -v
   npm -v
   ```
   باید `v22.x` و `10.x` ببینید.

> اگر Node قبلی نصب است و مشکلی دارد، با `winget install OpenJS.NodeJS.LTS` نسخه تازه بگیرید.

## ۲) نصب Rust

**راه الف (پیشنهادی):** <https://rustup.rs> → دکمه `rustup-init.exe` → در پنجره سیاه، کلید `1` (پیش‌فرض) و Enter.

**راه ب (winget):**
```powershell
winget install Rustlang.Rustup
```

بعد از نصب، ترمینال را ببندید و **دوباره باز کنید**:
```powershell
rustc --version
cargo --version
```

> اگر `rustc` پیدا نشد: ویندوز را Log off/on کنید تا PATH تازه شود.
> مسیر معمول: `C:\Users\<user>\.cargo\bin`

## ۳) نصب Visual Studio Build Tools (فقط ویندوز)

1. <https://visualstudio.microsoft.com/visual-cpp-build-tools/> → **Download Build Tools**
2. در نصب‌کننده: تب **Workloads** → تیک **Desktop development with C++**
3. در پنل راست مطمئن شوید این‌ها تیک دارند:
   - MSVC v143 — VS 2022 C++ x64/x86 build tools
   - Windows 10/11 SDK
4. Install (~۱٫۵GB).

> نیاز به Visual Studio کامل نیست. اگر VS 2022 Community دارید، همان هم کافی است.

**لینوکس (برای ساخت نسخه‌های deb/AppImage):**
```bash
sudo apt update && sudo apt install -y build-essential curl wget file \
  libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## ۴) آماده‌سازی پروژه

```bash
# در پوشه پروژه
npm install
npm run desktop:setup      # نصب @tauri-apps/cli
npm run doctor             # ✅ بررسی همه پیش‌نیازها با پیام دری
```

اگر `doctor` همه موارد را ✔ کرد، ادامه دهید. هر ✘ با راه‌حلش نمایش داده می‌شود.

## ۵) آزمایش پنجره دسکتاپ

```bash
npm run desktop:dev
```

چه اتفاقی می‌افتد؟
1. رابط React ساخته می‌شود،
2. API محلی (NestJS) روی `127.0.0.1:4317` استارت می‌شود،
3. پنجره Tauri باز می‌شود و همان آدرس را نشان می‌دهد.

> **اولین اجرا ۳ تا ۱۰ دقیقه** طول می‌کشد (کامپایل crateهای Rust). دفعات بعد چند ثانیه.

## ۶) ساخت نصب‌کننده

```bash
npm run desktop:build
```

این دستور:

| مرحله | کار |
|---|---|
| `build -w @farday/api` | API را به جاوااسکریپت کامپایل می‌کند |
| `build -w @farday/web` | رابط را در `apps/web/dist` می‌سازد |
| `package:api` | `apps/api/dist` + `node.exe` (نسخه پرتابل Node برای ویندوز) + رابط build شده را در `src-tauri/api/` می‌گذارد |
| `tauri build` | کامپایل Rust + ساخت نصب‌کننده |

خروجی‌ها:

```
src-tauri/target/release/bundle/nsis/Farday Roshan_0.1.0_x64-setup.exe   ← این را توزیع کنید
src-tauri/target/release/bundle/msi/Farday Roshan_0.1.0_x64_en-US.msi
src-tauri/target/release/farday-roshan.exe                               (نسخه پرتابل، با پوشه api/)
```

> `npm run package:api` برای گرفتن `node.exe` به انترنت نیاز دارد. اگر می‌خواهید
> نصب‌شده از Node نصب‌شده روی سیستم استفاده کند (نه پرتابل): `npm run package:api -- --no-node`.

## ۷) نصب‌کننده روی کمپیوتر شرکت

1. فایل `*-setup.exe` را کپی و دوبار کلیک کنید.
2. اگر اسمارت‌اسکرین پیام داد: **More info → Run anyway** (فایل امضای تجاری ندارد).
3. نصب در سطح کاربر انجام می‌شود (بدون Administrator).
4. اجرا از منوی استارت → ورود با `admin` / `admin123`.

**محل معلومات:**
```
%APPDATA%\af.farday.roshan\farday.db
%APPDATA%\af.farday.roshan\backups\
```

## ۸) ساخت بدون انترنت (Air-gapped)

مرحله کامپایل Rust در اولین بار crateها را دانلود می‌کند. برای ساخت آفلاین:

**یک بار روی کمپیوتر با انترنت:**
```bash
npm run desktop:build
```
سپس این‌ها را به همان مسیرها در کمپیوتر آفلاین کپی کنید:

| از | به |
|---|---|
| `C:\Users\<user>\.cargo\registry` | همان مسیر در کمپیوتر دوم |
| `src-tauri\target` | همان مسیر (کامپایل‌های آماده) |
| `node_modules` | همان مسیر |
| `src-tauri\api` (شامل `node.exe`) | همان مسیر |

**در کمپیوتر آفلاین:**
```bash
npx tauri build --offline
```
نصب‌کننده ساخته‌شده، هنگام نصب و اجرا **به هیچ انترنتی نیاز ندارد**.

## ۹) تغییر نسخه و نام برنامه

| چه چیزی | کجا |
|---|---|
| نسخه برنامه | `src-tauri/tauri.conf.json` → `version` و `package.json` |
| عنوان پنجره | `src-tauri/tauri.conf.json` → `app.windows[0].title` |
| نام محصول (نام فایل نصب) | `src-tauri/tauri.conf.json` → `productName` |
| شناسه (پوشه دیتابیس) | `src-tauri/tauri.conf.json` → `identifier` (⚠ تغییرش مسیر دیتابیس را عوض می‌کند) |
| آیکن | `src-tauri/icons/` (۱۶px تا ۱۰۲۴px + `icon.ico`) |
| اندازه پنجره | `app.windows[0]` → `width` / `height` / `minWidth` |

## ۱۰) خطاهای رایج

| پیام | علت | راه‌حل |
|---|---|---|
| `linker `link.exe` not found` | Build Tools نیست | گام ۳ |
| `failed to run custom build command ... webkit2gtk` | بسته لینوکس کم است | دستور `apt install` گام ۳ |
| `'cargo' is not recognized` | PATH تازه نشده | ترمینال/ویندوز را ببندید و باز کنید |
| `error[E0658] ... unstable` | Rust قدیمی | `rustup update stable` |
| `API entry not found` | API build نشده | `npm run build -w @farday/api` |
| `EADDRINUSE 4317` | نسخه دیگری در حال اجراست | `taskkill /IM node.exe /F` یا بستن برنامه |
| پنجره سفید | API دیر بیدار شده | ۱۰ ثانیه صبر؛ `%APPDATA%\af.farday.roshan` را بررسی کنید |
| نصب‌شده: `node.exe not found` | بدون `package:api` ساخته شده | `npm run package:api` و سپس `npx tauri build` |
| فونت فارسی درست نیست | WebView2 قدیمی | WebView2 Runtime را تازه کنید |

## ۱۱) بررسی سلامت نسخه نصب‌شده

- در برنامه: **تنظیمات → دیتابیس و ساختار** (مسیر فایل، تعداد جداول، دکمه ترمیم).
- از خط فرمان:
  ```powershell
  & "$env:LOCALAPPDATA\Programs\Farday Roshan\api\node.exe" `
    "$env:LOCALAPPDATA\Programs\Farday Roshan\api\cli\backup.js" --list
  ```
  (مسیر نصب ممکن است بر اساس انتخاب شما متفاوت باشد.)
