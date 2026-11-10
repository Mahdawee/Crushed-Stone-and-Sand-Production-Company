# راهنمای کامل نصب Tauri و ساخت نصب‌کننده ویندوز

این راهنما برای کسی است که می‌خواهد از سورس، **فایل نصب `.exe`** بسازد.
کمپیوتر شرکت بعداً فقط همان فایل نصب را می‌خواهد — نه Rust، نه Node، نه انترنت.

> **خلاصه در یک نگاه (ویندوز):**
> ```powershell
> npm run setup          # نصب بسته‌ها + build (بعد از هر git pull)
> npm run doctor         # چک پیش‌نیازها
> npm run desktop:build  # ساخت نصب‌کننده
> ```
> خروجی: `src-tauri/target/release/bundle/nsis/Farday Roshan_0.1.0_x64-setup.exe`

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

```powershell
npm run setup      # = npm install (اگر لازم بود) + Prisma + build API و رابط
npm run doctor     # ✅ بررسی همه پیش‌نیازها با پیام دری
```

`@tauri-apps/cli` از قبل داخل `devDependencies` است؛ پس با `npm install` می‌آید و
`npm run desktop:setup` دیگر لازم نیست (اگر قبلاً نصب نکرده‌اید و آن را اجرا کردید، فقط دوباره نصب می‌کند).

اگر `doctor` همه موارد را ✔ کرد، ادامه دهید. هر ✘ با راه‌حلش نمایش داده می‌شود.

> ℹ اگر `npm doctor` گفت «نسخه نود/npm را ارتقا بده» — برای این پروژه **لازم نیست**.
> Node 2x از ۲۰ به بالا کافی است و نسخه‌های خیلی نو ممکن است بعضی بسته‌ها را ناسازگار کنند.
> فقط همان `npm run doctor` پروژه ملاک است.

## ۵) آزمایش پنجره دسکتاپ

```bash
npm run desktop:dev
```

چه اتفاقی می‌افتد؟
1. `npm run dev` اجرا می‌شود (API روی 4317 + Vite روی 5173)،
2. پنجره Tauri آدرس **http://localhost:5173** را باز می‌کند (همان UI با hot-reload)،
3. اگر API از قبل بالا باشد، پوسته از همان استفاده می‌کند.

> در حالت `desktop:dev` لازم نیست `npm run dev` را جدا اجرا کنید؛ خودش اجرا می‌کند.

> **اولین اجرا ۳ تا ۱۰ دقیقه** طول می‌کشد (کامپایل crateهای Rust). دفعات بعد چند ثانیه.

## ۶) ساخت نصب‌کننده

```bash
npm run desktop:build
```

این دستور (`build:desktop` → `package:api` → `tauri build`):

| مرحله | کار |
|---|---|
| `build:desktop` | API و رابط کاربری را از **کد فعلی** می‌سازد (تا نصب‌کننده نسخه کهنه نداشته باشد) |
| `package:api` | `apps/api/dist` + `node.exe` (نسخه پرتابل Node) + رابط build شده را در `src-tauri/api/` می‌گذارد |
| `tauri build` | کامپایل Rust + ساخت نصب‌کننده |

> **اگر `npm run package:api` را تنها اجرا کردید** و بعد کد UI را عوض کردید، حتماً دوباره
> `npm run desktop:build` را اجرا کنید؛ وگرنه نصب‌کننده همان UI قدیمی را نشان می‌دهد.

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
%APPDATA%\af.farday.roshan\farday.db      ← دیتابیس
%APPDATA%\af.farday.roshan\backups\       ← پشتیبان‌ها
%APPDATA%\af.farday.roshan\api.log        ← لاگ سرویس داخلی (برای عیب‌یابی)
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
| عنوان پنجره | `src-tauri/src/main.rs` → `.title(...)` (پنجره در Rust ساخته می‌شود) |
| نام محصول (نام فایل نصب) | `src-tauri/tauri.conf.json` → `productName` |
| شناسه (پوشه دیتابیس) | `src-tauri/tauri.conf.json` → `identifier` (⚠ تغییرش مسیر دیتابیس را عوض می‌کند) |
| آیکن | `src-tauri/icons/` (۱۶px تا ۱۰۲۴px + `icon.ico`) |
| اندازه پنجره | `src-tauri/src/main.rs` → `.inner_size(...)` / `.min_inner_size(...)` |

## ۱۰) خطاهای رایج

| پیام | علت | راه‌حل |
|---|---|---|
| `linker `link.exe` not found` | Build Tools نیست | گام ۳ |
| `failed to run custom build command ... webkit2gtk` | بسته لینوکس کم است | دستور `apt install` گام ۳ |
| `'cargo' is not recognized` | PATH تازه نشده | ترمینال/ویندوز را ببندید و باز کنید |
| `error[E0658] ... unstable` | Rust قدیمی | `rustup update stable` |
| `API entry not found` | API build نشده | `npm run build -w @farday/api` |
| `EADDRINUSE 4317` | نسخه دیگری در حال اجراست | `taskkill /IM node.exe /F` یا بستن برنامه |
| پنجره سفید | API دیر بیدار شده | از این نسخه، پنجره فقط بعد از آماده شدن API ساخته می‌شود؛ اگر باز هم سفید بود فایل `%APPDATA%\af.farday.roshan\api.log` را ببینید |
| نصب‌شده: `node.exe not found` | بدون `package:api` ساخته شده | `npm run package:api` و سپس `npx tauri build` |
| فونت فارسی درست نیست | WebView2 قدیمی | WebView2 Runtime را تازه کنید |
| `'unzip' is not recognized` | ویندوز به‌صورت پیش‌فرض `unzip` ندارد (نسخه‌های قبل از این اصلاح) | `git pull` — حالا خود اسکریپت ZIP را باز می‌کند، بدون unzip |
| `glob pattern binaries/* path not found` | `tauri.conf.json` پوشه `binaries/` را منبع اعلام کرده بود ولی ساخته نمی‌شد | `git pull` (این پوشه حالا خودکار ساخته می‌شود و از `resources` برداشته شد) |
| پنجره سفید در نسخه نصب‌شده | API هنوز بالا نیامده / آدرس اشتباه | `git pull` — پنجره حالا بعد از آماده شدن API ساخته می‌شود و همیشه `127.0.0.1:4317` را باز می‌کند |
| `Can't open language file - "...\NSIS\Contrib\Language files\Persian.nlf"!` | در `tauri.conf.json` نام زبان `Persian` بود؛ NSIS3 زبان فارسی را **`Farsi`** می‌نامد (فایل `Farsi.nlf`) و `Persian.nlf` وجود ندارد | `git pull` — حالا `languages: ["Farsi","English"]` است و پیام‌های فارسی در `src-tauri/nsis/Farsi.nsh` تعریف شده‌اند. بررسی سریع: `npm run test:nsis` |
| `Error in macro MUI_LANGUAGEEX on macroline 13` | همان خطای بالا (نتیجه‌ی آن) | همان راه‌حل بالا |
| `failed to bundle project: Failed to bundle app with makensis` | هر خطای makensis؛ خط واقعی چند خط بالاتر است | همان چند خط بالا را بخوانید؛ یا `npm run doctor` بخش ۸ |

## ۱۱) بررسی سلامت نسخه نصب‌شده

- در برنامه: **تنظیمات → دیتابیس و ساختار** (مسیر فایل، تعداد جداول، دکمه ترمیم).
- از خط فرمان:
  ```powershell
  & "$env:LOCALAPPDATA\Programs\Farday Roshan\api\node.exe" `
    "$env:LOCALAPPDATA\Programs\Farday Roshan\api\cli\backup.js" --list
  ```
  (مسیر نصب ممکن است بر اساس انتخاب شما متفاوت باشد.)

---

## ۱۱) بعد از هر `git pull` چه دستوری بزنم؟

### الف) فقط می‌خواهم برنامه را اجرا/ببینم
```powershell
git pull
npm run setup      # بسته‌ها + build؛ اگر چیزی عوض نشده باشد سریع رد می‌شود
npm start          # → http://127.0.0.1:4317
```
یا برای کار توسعه‌ای (hot reload): `npm run dev` → <http://localhost:5173>

### ب) می‌خواهم دوباره نصب‌کننده بسازم
```powershell
git pull
npm run setup
npm run test:nsis       # ۲ ثانیه؛ خطای زبان نصب‌کننده را قبل از build می‌گیرد
npm run desktop:build
```

> اگر ساخت نصب‌کننده با خطای **`Persian.nlf`** یا `MUI_LANGUAGEEX` شکست خورد، یعنی
> نسخه‌ی قدیمی کد را دارید: `git pull` و دوباره `npm run desktop:build`.
> (NSIS زبان فارسی را `Farsi` می‌شناسد؛ در `tauri.conf.json` هم همین نوشته شده.)

### ج) چه وقت لازم است `npm install` جداگانه بزنم؟
فقط اگر این فایل‌ها عوض شده باشند (چیزی در `package.json`):

```powershell
git pull
npm install
npm run desktop:build
```
`npm run setup` خودش این را تشخیص می‌دهد (با مقایسه زمان `package-lock.json`) و
در صورت نیاز `npm install` را اجرا می‌کند؛ پس در عمل همان `npm run setup` کافی است.

### د) دستورها به زبان ساده

| دستور | چه می‌کند | چه وقت |
|---|---|---|
| `npm run setup` | `npm install` (اگر لازم) → Prisma → build API و رابط. فقط چیزهای کهنه را می‌سازد | **بعد از هر pull** |
| `npm start` | برنامه را در یک آدرس (`127.0.0.1:4317`) اجرا می‌کند | استفاده روزمره/آزمایش |
| `npm run dev` | حالت توسعه: API + Vite با hot reload روی 5173 | کار روی ظاهر/کد |
| `npm run doctor` | چک می‌کند Node/Rust/MSVC/WebView2/Tauri آماده‌اند | وقتی ساخت خطا داد |
| `npm run desktop:build` | نصب‌کننده ویندوز می‌سازد | برای توزیع به کمپیوتر شرکت |
| `npm run desktop:dev` | پنجره دسکتاپ در حالت توسعه | آزمایش پنجره بدون ساخت نصب‌کننده |
| `npm run package:api` | فقط بسته API/`src-tauri/api` را آماده می‌کند | به‌ندرت؛ داخل `desktop:build` هست |
| `npm run test:api` | ۵۳ تست رفتاری API | بعد از تغییرات بک‌اند |
| `npm run test:ui` | ۸۱ تست واقعی رابط (سایدبار، DatePicker) در DOM | بعد از تغییر ظاهر |
| `npm run test:nsis` | تنظیمات زبان نصب‌کننده را چک می‌کند (خطای `Persian.nlf`) | قبل از `desktop:build` |

> **قانون طلایی:** پس از `pull`، اگر فقط می‌خواهید ببینید → `npm run setup && npm start`.
> اگر می‌خواهید نصب‌کننده بدهید → `npm run setup && npm run desktop:build`.
> هیچ‌وقت `npx tauri build` را بدون `package:api` اجرا نکنید (نسخه‌های قبل همین را می‌گفتند؛
> حالا `desktop:build` خودش هر سه مرحله را به ترتیب انجام می‌دهد).
