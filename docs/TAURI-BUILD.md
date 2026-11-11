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
>
> **اگر خطای `failed to run 'cargo metadata' … program not found` گرفتید:**
> یعنی Rust نصب نیست یا در PATH نیست → بخش ۲/۱ و بخش ۱۳ (عیب‌یابی سریع).
> `npm run desktop:build` خودش این حالت را تشخیص می‌دهد و راه‌حل می‌دهد.
>
> **اگر اینترنت ندارید:** یک بار `npm run desktop:prefetch` (با اینترنت) و بعد
> `npm run desktop:build --offline` → بخش ۸.
>
> **دو پیش‌نیاز جدا که هر دو لازم‌اند:** (۱) Rust برای `cargo` — بخش ۲؛
> (۲) کامپایلر C++ مایکروسافت برای `link.exe` — بخش ۳. یکی بدون دیگری کافی نیست:
> نبودِ اولی خطای `cargo metadata … program not found` (بخش ۱۳) و نبودِ دومی
> `linker link.exe not found` (بخش ۱۴) می‌دهد.

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

### ۲/۱) خطای `failed to run 'cargo metadata' … program not found`

این پیام یعنی **Tauri CLI نصب است، ولی `cargo` را پیدا نمی‌کند**. خودِ
Rust ممکن است سالم نصب شده باشد؛ فقط پنجره‌ی ترمینالِ شما مسیرش را
نمی‌شناسد (ترمینال پیش از نصب Rust باز شده بود).

سه راه، از ساده به مطمئن:

```powershell
# راه ۱ — ترمینال را ببندید و یک پنجره‌ی تازه باز کنید، بعد:
cargo --version
rustc --version

# راه ۲ — همین حالا، بدون بستن پنجره (فقط برای همین پنجره):
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
#   در PowerShell:
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# راه ۳ (مطمئن‌ترین) — اسکریپت پروژه، که PATH را خودش درست می‌کند:
npm run desktop:build
```

`npm run desktop:build` قبل از هر کامپایلی، `cargo` را در این مسیرها می‌گردد و
اگر پیدا کرد، PATH همان اجرا را اصلاح می‌کند:

| مسیر | چه زمانی |
|---|---|
| `%USERPROFILE%\.cargo\bin\cargo.exe` | نصب با rustup (معمول) |
| `%CARGO_HOME%\bin\cargo.exe` | اگر `CARGO_HOME` را دستی عوض کرده‌اید |
| `C:\Program Files\Rust stable\bin\cargo.exe` | نصب با winget/choco |
| `%LOCALAPPDATA%\Programs\Rust\bin\cargo.exe` | نصب کاربری |

اگر هیچ‌کدام نبود، یعنی Rust واقعاً نصب نیست → بخش ۲ یا فایل
`scripts/install-rust.ps1` (راست‌کلیک → Run with PowerShell).

> **نصب یک‌کلیکی:** `scripts/install-rust.ps1` را راست‌کلیک → **Run with PowerShell**.
> خودش rustup را می‌گیرد، نصب می‌کند، PATH همین پنجره را درست می‌کند و نسخه‌ها را چاپ می‌کند.

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

### آزمایش سریع (اختیاری، پیش از ساخت)

```powershell
npm test              # همه: typecheck + UI + NSIS + Tauri + API + شبیه‌سازی ۶ ماه
npm run test:scenario # فقط شبیه‌سازی: ۶ ماه کار مدیر و تطبیق همه گزارش‌ها
npm run test:tauri    # فقط بررسی قرارداد پوسته دسکتاپ (باز شدن مطمئن برنامه)
```

هر سه باید سبز باشند؛ اگر نبودند، نصب‌کننده هم همان مشکل را خواهد داشت.

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

هدف: روی کمپیوتر بدون اینترنت، فایل نصب بسازیم. سه چیز باید از قبل حاضر باشد:

| چه چیزی | چرا | چطور آماده می‌شود |
|---|---|---|
| `node_modules` | npm و Vite و Tauri CLI از اینجا اجرا می‌شوند | `npm ci` (یک بار، با اینترنت) |
| crateهای Rust | cargo در ساخت به اینترنت دست نزند | `npm run desktop:prefetch` |
| `node-v22-win-x64.zip` | تا `node.exe` داخل نصب‌کننده برود | یک بار دانلود، بعد فلش |
| `.cache/libsql/win32-x64-msvc-*.tgz` | درایور SQLite ویندوزی — بدون آن نصب‌کننده روی ویندوز صفحه‌ی سفید می‌دهد | `npm run desktop:prefetch` (خودکار) |

> **درباره‌ی `libsql` (دور ۱۶ اضافه شد):** برنامه هنوز روی لینوکس ساخته شود،
> `npm ci` فقط باینری لینوکسی را نصب می‌کند. قبلاً ساخت نصب‌کننده در این حالت
> سعی می‌کرد از `registry.npmjs.org` دانلود کند و روی کمپیوتر **آفلاین** این
> مرحله شکست می‌خورد — ولی پیام «موفق» می‌داد و نصب‌کننده روی ویندوز کار
> نمی‌کرد. حالا:
>
> * `npm run desktop:prefetch` فایل tgz را در `.cache/libsql/` ذخیره می‌کند؛
> * ساخت آفلاین آن را از همان کش نصب می‌کند (بدون شبکه)؛
> * اگر کش نبود و `--offline` داده شده بود، ساخت **متوقف** می‌شود با پیام
>   روشن — نه یک نصب‌کننده‌ی خراب.

### گام ۱ — روی کمپیوتر **با** اینترنت (یک بار)

```powershell
git pull
npm ci                        # بسته‌های JS
npm run desktop:prefetch      # = cargo fetch ؛ همه‌ی crateها را در %USERPROFILE%\.cargo ذخیره می‌کند
```

`prefetch` در پایان می‌گوید چند crate ذخیره شد و `Cargo.lock` ساخته شد یا نه.

فایل ZIP نود را هم بگیرید (نسخه باید با `node -v` جاری یکی باشد):

```
https://nodejs.org/dist/v22.22.3/node-v22.22.3-win-x64.zip
```

### گام ۲ — انتقال به کمپیوتر آفلاین

پوشه‌ی پروژه را **کامل** (شامل `node_modules` و `.cache`) کپی کنید، به‌علاوه:

| از (کمپیوتر آنلاین) | به (کمپیوتر آفلاین) |
|---|---|
| `C:\Users\<user>\.cargo` | همان مسیر |
| `C:\Users\<user>\.rustup` | همان مسیر (خودِ کامپایلر) |
| `src-tauri\target` *(اختیاری)* | همان مسیر — کامپایل‌های آماده، ساخت را چند دقیقه‌ای می‌کند |
| `node-v22.x-win-x64.zip` | مثلاً `D:\` |

> کپی `.cargo` و `.rustup` یعنی **لازم نیست Rust را روی کمپیوتر آفلاین نصب کنید**.

### گام ۳ — ساخت آفلاین

```powershell
# فقط ساخت (node.exe از قبل در بسته هست یا ZIP می‌دهید)
npm run desktop:build:offline -- "D:\node-v22.22.3-win-x64.zip"
```

یا اگر `node.exe` قبلاً داخل `src-tauri\api` هست:

```powershell
npm run desktop:build --offline
```

هر دو مسیر، `CARGO_NET_OFFLINE=true` می‌گذارند. یعنی اگر crate‌ای کم باشد،
cargo **سریع** می‌گوید کدام است — نه اینکه چند دقیقه منتظر شبکه بماند و بعد
خطای گمراه‌کننده بدهد.

### گام ۴ — بررسی

نصب‌کننده‌ی ساخته‌شده را روی همان کمپیوتر آفلاین نصب و اجرا کنید. برنامه
هیچ درخواست شبکه‌ای ندارد؛ دیتابیس و API محلی هستند (`127.0.0.1:4317`).

### اگر ساخت آفلاین شکست خورد

| پیام | معنی | راه‌حل |
|---|---|---|
| `unable to get packages from source` / `no matching package named …` | crate‌ای دانلود نشده | روی کمپیوتر آنلاین `npm run desktop:prefetch` را دوباره بزنید و `.cargo` را تازه‌سازی کنید |
| `failed to run 'cargo metadata' … program not found` | cargo در PATH نیست | بخش ۲/۱ |
| `npm error … ENOTCACHED` | بسته‌ی npm در کش نیست | `npm ci` را روی کمپیوتر آنلاین بزنید و `node_modules` را کامل کپی کنید |
| `E404` / `network` در مرحله‌ی ۲ | `node.exe` نبود و خواست دانلود کند | ZIP نود را بدهید: `npm run desktop:build:offline -- "D:\…zip"` |
| `Cargo.lock نیست` | اولین ساخت هنوز آنلاین انجام نشده | یک بار `npm run desktop:prefetch` |
| `⛔ ساخت آفلاین بدون باینری ویندوزی libSQL ممکن نیست` | کش `.cache/libsql` خالی است | روی کمپیوتر آنلاین `npm run desktop:prefetch` و بعد `.cache` را منتقل کنید |

> نکته: با `strip = true`، `lto = true` و `opt-level = "s"` در `src-tauri/Cargo.toml`،
> ساخت release کندتر از debug است. برای آزمایش سریع (بدون نصب‌کننده‌ی بهینه):
> `npm run desktop:build --debug`.

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
| `linker `link.exe` not found` + `the msvc targets depend on the msvc linker but `link.exe` was not found` | کامپوننت **C++** نصب نیست (یا VS هست ولی بدون این کامپوننت) | **حل شد:** `npm run desktop:build` اول لینکر را پیدا می‌کند، محیط کامل `vcvars64` را می‌سازد و اگر نبود راه‌حل دقیق می‌دهد → بخش ۱۴. سریع‌ترین راه: `npm run doctor` |
| `failed to run custom build command ... webkit2gtk` | بسته لینوکس کم است | دستور `apt install` گام ۳ |
| `'cargo' is not recognized` | PATH تازه نشده | ترمینال/ویندوز را ببندید و باز کنید |
| `failed to run 'cargo metadata' command to get workspace directory … program not found` | Tauri CLI نصب است ولی `cargo` در PATH نیست (Rust نیست، یا ترمینال پیش از نصب باز شده) | **حل شد:** `npm run desktop:build` مسیرهای متداول Rust را پیدا و PATH همان اجرا را اصلاح می‌کند؛ اگر Rust نبود، دستور نصب می‌دهد. راه دستی: `set PATH=%USERPROFILE%\.cargo\bin;%PATH%` و باز کردن ترمینال تازه — بخش ۲/۱. بررسی محیط: `npm run doctor` |
| `npm error could not determine executable to run` / `npx tauri` روی کمپیوتر آفلاین | `npx` بی‌`--no-install` می‌خواست بسته را از شبکه بگیرد | **حل شد:** همه‌ی اسکریپت‌ها CLI محلی را مستقیم با `node node_modules/@tauri-apps/cli/tauri.js` اجرا می‌کنند |
| `error[E0658] ... unstable` | Rust قدیمی | `rustup update stable` |
| `error[E0599]: no method named try_clone found for struct Stdio` | کد قدیمی پوسته (فایل لاگ برای stdout/stderr کاپی می‌شد، ولی `Stdio` کاپی‌شدنی نیست) | `git pull` — حالا فایل لاگ دو بار باز می‌شود. بررسی سریع: `npm run test:tauri` |
| `error[E0599]: no method named ... found` (هر روش دیگری در `src-tauri`) | نسخه‌ی کد با نسخه‌ی Tauri هم‌خوان نیست | `git pull` و سپس `npm run test:tauri` — این اسکریپت پیش از ساخت، روش‌های ناموجود را می‌گیرد |
| `API entry not found` | API build نشده | `npm run build -w @farday/api` |
| `EADDRINUSE 4317` | نسخه دیگری در حال اجراست | `taskkill /IM node.exe /F` یا بستن برنامه |
| برنامه باز نمی‌شود / بی‌صدا بسته می‌شود | خطا در راه‌اندازی سرور داخلی | فایل `%APPDATA%\af.farday.roshan\shell.log` را باز کنید — مرحله‌به‌مرحله نوشته شده کجا متوقف شد؛ جزئیات سرور در `api.log` کنارش است |
| پنجره سفید | API دیر بیدار شده | از این نسخه، پنجره فقط بعد از آماده شدن API ساخته می‌شود؛ اگر باز هم سفید بود فایل `%APPDATA%\af.farday.roshan\api.log` را ببینید |
| نصب‌شده: `node.exe not found` | بدون `package:api` ساخته شده | `npm run package:api` و سپس `npx tauri build` |
| فونت فارسی درست نیست | WebView2 قدیمی | WebView2 Runtime را تازه کنید |
| `'unzip' is not recognized` | ویندوز به‌صورت پیش‌فرض `unzip` ندارد (نسخه‌های قبل از این اصلاح) | `git pull` — حالا خود اسکریپت ZIP را باز می‌کند، بدون unzip |
| `glob pattern binaries/* path not found` | `tauri.conf.json` پوشه `binaries/` را منبع اعلام کرده بود ولی ساخته نمی‌شد | `git pull` (این پوشه حالا خودکار ساخته می‌شود و از `resources` برداشته شد) |
| پنجره سفید در نسخه نصب‌شده | API هنوز بالا نیامده / آدرس اشتباه | `git pull` — پنجره حالا بعد از آماده شدن API ساخته می‌شود و همیشه `127.0.0.1:4317` را باز می‌کند |
| `Can't open language file - "...\NSIS\Contrib\Language files\Persian.nlf"!` | در `tauri.conf.json` نام زبان `Persian` بود؛ NSIS3 زبان فارسی را **`Farsi`** می‌نامد (فایل `Farsi.nlf`) و `Persian.nlf` وجود ندارد | `git pull` — حالا `languages: ["Farsi","English"]` است و پیام‌های فارسی در `src-tauri/nsis/Farsi.nsh` تعریف شده‌اند. بررسی سریع: `npm run test:nsis` |
| `Error in macro MUI_LANGUAGEEX on macroline 13` | همان خطای بالا (نتیجه‌ی آن) | همان راه‌حل بالا |
| `error: unknown character escape: \`C\`` (یا `\`<u>{2026}\``) در `src\api_sidecar.rs` | در رشته‌ی **معمولی** Rust هر `\` یک escape است؛ مسیر ویندوزی `\\?\C:\…` داخل `"…"` باید `\\\\?\\C:\\\\…` نوشته شود (یا رشته‌ی خام `r"…"`) | **حل شد:** پیام‌های دارای مسیر ویندوزی با `concat!` + رشته‌ی خام ساخته می‌شوند. `npm run test:tauri` حالا کل رشته‌های معمولی را با قانون escape‌های Rust می‌سنجد |
| `Error: EISDIR: illegal operation on a directory, lstat 'C:'` در `api.log` (و پیام «سرویس داخلی در ۶۰ ثانیه جواب نداد») | روی ویندوز `resource_dir()`/`canonicalize` مسیر را **verbatim** می‌دهد (`\\?\C:\…`)؛ Node از چنین مسیر آرگومانی نمی‌تواند ماژول اصلی را پیدا کند و پیش از اجرای یک خط کد می‌میرد | **حل شد:** `plain_path()` پیشوند را برمی‌دارد و همه‌ی مسیرهای Node (entry، node.exe، cwd، حالت CLI) از آن می‌گذرند؛ مسیرها در `api.log` لاگ می‌شوند و مرگ زودهنگام Node سریع تشخیص داده می‌شود |
| `invalid format string: expected \`}\`, found \`t\`` در `src\main.rs` | قالب HTML صفحه‌ی خطا با `format!` ساخته می‌شد و بعداً یک بلوک `<script>` با آکولاد تکی به آن اضافه شد؛ `format!` هر `{` را جای‌نگهدار می‌بیند | **حل شد:** قالب حالا `const ERROR_PAGE` (رشته‌ی خام) + `replace("@@BODY@@")` است. `git pull` و `npm run test:tauri` — تست ساختاری جدید همین دسته خطا را قبل از build می‌گیرد |
| `warning: unused import: tauri::Manager` | ایمپورت اضافه در `window_geometry` (چون `primary_monitor` متد ذاتی `tauri::App` است) | **حل شد** (هشدار پاک شد) |
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

## ۱۲) بعد از هر `git pull` چه دستوری بزنم؟

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
| `npm run webview2:status` | چک می‌کند فایل‌های آفلاین WebView2 در کش هستند | قبل از `desktop:build --offline` |
| `npm run webview2:prepare` | یک بار با انترنت: بوت‌استرپ و نصب‌کننده‌ی آفلاین WebView2 را در کش می‌گذارد | وقتی پیام «نصب‌کننده‌ی آفلاین WebView2 در کش نیست» آمد |

### چرا `Downloading go.microsoft.com/fwlink/p/?LinkId=2124703` دیگر لازم نیست

این خط خودِ tauri-bundler بود، نه اسکریپت‌های ما. در `tauri-bundler`
تابع `download_webview2_bootstrapper` هر بار — اگر فایل نبود — بوت‌استرپ را
از سایت مایکروسافت می‌گرفت. با `offlineInstaller` فایل بزرگ‌تر (نصب‌کننده‌ی
کامل) گرفته می‌شود و bundler همان را **قبل از ساخت** لازم دارد؛ اگر در کش
باشد (`<cache>/tauri/x64/<GUID>/…`) هیچ دانلودی انجام نمی‌شود.
`npm run webview2:prepare` همان دو فایل را در همان مسیر می‌گذارد و
`build-desktop.mjs` در حالت `--offline` بدون آن‌ها با پیام روشن متوقف می‌شود.
| `npm run desktop:build` | نصب‌کننده ویندوز می‌سازد (خودش cargo را پیدا و PATH را اصلاح می‌کند) | برای توزیع به کمپیوتر شرکت |
| `npm run desktop:prefetch` | یک بار با اینترنت، crateهای Rust را ذخیره می‌کند | پیش از رفتن به کمپیوتر آفلاین |
| `npm run desktop:build --offline` | ساخت بدون اینترنت | وقتی crateها ذخیره شده‌اند |
| `npm run desktop:dev` | پنجره دسکتاپ در حالت توسعه | آزمایش پنجره بدون ساخت نصب‌کننده |
| `npm run package:api` | فقط بسته API/`src-tauri/api` را آماده می‌کند | به‌ندرت؛ داخل `desktop:build` هست |
| `npm run test:api` | ۵۳ تست رفتاری API | بعد از تغییرات بک‌اند |
| `npm run test:ui` | ۸۱ تست واقعی رابط (سایدبار، DatePicker) در DOM | بعد از تغییر ظاهر |
| `npm run test:nsis` | تنظیمات زبان نصب‌کننده را چک می‌کند (خطای `Persian.nlf`) | قبل از `desktop:build` |

> **قانون طلایی:** پس از `pull`، اگر فقط می‌خواهید ببینید → `npm run setup && npm start`.
> اگر می‌خواهید نصب‌کننده بدهید → `npm run setup && npm run desktop:build`.
> هیچ‌وقت `npx tauri build` را بدون `package:api` اجرا نکنید (نسخه‌های قبل همین را می‌گفتند؛
> حالا `desktop:build` خودش هر سه مرحله را به ترتیب انجام می‌دهد).

---

## ۱۳) عیب‌یابی سریع: خطای `cargo metadata … program not found`

این خطا **معنی مشخصی** دارد و تقریباً همیشه یکی از این سه حالت است:

| حالت | نشانه | راه‌حل |
|---|---|---|
| Rust نصب است، PATH این پنجره کهنه است | `%USERPROFILE%\.cargo\bin\cargo.exe` وجود دارد | ترمینال تازه باز کنید، یا `npm run desktop:build` (خودش PATH را درست می‌کند) |
| Rust نصب نیست | پوشه‌ی `.cargo` وجود ندارد | بخش ۲ یا `scripts/install-rust.ps1` |
| Rust در مسیر غیرمعمول نصب شده | `where cargo` چیزی پیدا نمی‌کند ولی فایل هست | مسیر پوشه‌ی `bin` آن را به PATH اضافه کنید |

### تشخیص در سه دستور

```powershell
where.exe cargo                                  # آیا در PATH هست؟
dir "%USERPROFILE%\.cargo\bin\cargo.exe"        # آیا روی دیسک هست؟
npm run doctor                                   # تشخیص کامل با پیام دری
```

`npm run doctor` حالا این حالت را جداگانه گزارش می‌کند:

```
  ✘ C:\Users\DELL\.cargo\bin\cargo.exe هست ولی «cargo» در PATH نیست — ساخت با خطای «program not found» شکست می‌خورد
     راه‌حل: ترمینال را ببندید و باز کنید؛ یا موقتاً: set PATH=%USERPROFILE%\.cargo\bin;%PATH%
```

### چرا این اتفاق می‌افتد؟

نصب‌کننده‌ی rustup مسیر `%USERPROFILE%\.cargo\bin` را به PATH **سیستم/کاربر**
اضافه می‌کند. ولی هر پنجره‌ی ترمینالی که **قبل** از نصب باز شده باشد، نسخه‌ی
قدیمی PATH را در حافظه دارد. VS Code و Windows Terminal هم اغلب پنجره‌ها را
حفظ می‌کنند. به همین دلیل «نصب کردم ولی پیدا نمی‌شود» پیش می‌آید.

### پوشه‌ی درست برای اجرای دستورها

مسیر شما `D:\…\Crushed-Stone-and-Sand-Production-Company\Crushed-Stone-and-Sand-Production-Company`
است — یعنی پوشه **دو بار** تودرتو شده. دستورها را در پوشه‌ای بزنید که
`package.json` و `src-tauri` کنار هم در آن هستند:

```powershell
cd D:\Crushed-Stone-and-Sand-Production-Company\Crushed-Stone-and-Sand-Production-Company
dir package.json, src-tauri      # باید هر دو را ببینید
npm run desktop:build
```

### اگر بعد از این هم خطا داد

متن کامل انگلیسی خطا را نگه دارید. اسکریپت‌های پروژه سه مرحله را جدا اجرا
می‌کنند، پس از روی این که کدام مرحله شکست خورده می‌توان فهمید کجاست:

```
▶ ۱/۳ ساخت API و رابط کاربری       ← اگر اینجا شکست: مشکل Node/TypeScript
▶ ۲/۳ بسته‌بندی API + node.exe      ← اگر اینجا شکست: مشکل دانلود/اینترنت (یا ZIP نود)
▶ ۳/۳ ساخت نصب‌کننده                ← اگر اینجا شکست: مشکل Rust/MSVC/NSIS
```

---

## ۱۴) خطای `linker link.exe not found` (کامپایلر C++ نیست)

این خطا **بعد از** خطای cargo می‌آید و معنی‌اش این است:

```
error: linker `link.exe` not found
  = note: the msvc targets depend on the msvc linker but `link.exe` was not found
  = note: please ensure that Visual Studio 2017 or later, or Build Tools for Visual Studio
          were installed with the Visual C++ option
  = note: VS Code is a different product, and is not sufficient
```

یعنی **Rust کار می‌کند، ولی ابزار پیوند‌دهنده‌ی مایکروسافت (link.exe) نیست.**
Rust برای ساختن فایل `.exe` به کامپایلر C++ مایکروسافت تکیه می‌کند.

### ۱۴/۰) اگر همه‌ی کامپوننت‌ها نصب است ولی باز «پیدا نشد» می‌گوید

این حالت واقعاً پیش آمد: همه‌ی این‌ها نصب بود —

- C++ Build Tools core features
- MSVC v143 - VS 2022 C++ x64/x86 build tools
- Windows 11 SDK (10.0.26100.9457)
- C++ core desktop features

و باز اسکریپت می‌گفت «لینکر C++ (link.exe): پیدا نشد».

**علت:** نسخه‌ی قدیمی‌تر اسکریپت فقط این دو مسیر را می‌گشت:

```
C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools
C:\Program Files\Microsoft Visual Studio\2022\Community
```

اگر نصب جای دیگری باشد — مثلاً نسخه‌ی جدیدتر Visual Studio که پوشه‌اش
`…\Microsoft Visual Studio\18\BuildTools` است، یا نصب روی درایو `D:` —
پیدا نمی‌شد و پیام گمراه‌کننده می‌داد. **کامپوننت شما سالم بود؛ ما بد می‌گشتیم.**

#### حالا چطور می‌گردیم (چهار لایه)

| لایه | روش | چرا |
|---|---|---|
| ۱ | `vswhere -all -products * -format json` | **همه‌ی** نصب‌ها، با نام و نسخه — نه فقط جدیدترین |
| ۲ | `vswhere -find "VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe"` | روش رسمی مایکروسافت؛ مستقل از چیدمان پوشه‌ها |
| ۳ | پیمایش `…\Microsoft Visual Studio\<هر نسخه>\<هر محصول>` | اگر vswhere نبود یا شکست خورد |
| ۴ | جست‌وجوی محدود داخل نصب برای `link.exe` / `vcvars64.bat` / `vcvarsall.bat` | اگر چیدمان کاملاً غیرمعمول باشد |

در هر نصب، **همه‌ی** نسخه‌های MSVC بررسی می‌شوند و اولین نسخه‌ای که
`bin\HostX64\x64\link.exe` دارد انتخاب می‌شود (بعضی نصب‌ها یک نسخه‌ی
ناقص هم دارند). نام پوشه‌ها هم بدون حساسیت به حرف بزرگ/کوچک خوانده
می‌شوند (`Hostx64` = `HostX64`).

> نکته‌ی مهم درباره‌ی لایه ۱: اگر Visual Studio 2026 هم داشته باشید،
> `-latest` فقط همان را می‌دهد؛ و اگر آن نسخه کامپوننت C++ نداشته باشد،
> جست‌وجو به دام می‌افتد. به همین دلیل `-all` است و **همه‌ی** نصب‌ها
> یکی‌یکی بررسی می‌شوند تا اولین نصب سالم با link.exe پیدا شود.

#### قدم‌به‌قدم برای رفع

**قدم ۱ — تشخیص دقیق (بدون تغییر در سیستم):**

```powershell
npm run find:msvc
```

پنج چیز را چاپ می‌کند: آیا `link.exe` در PATH هست، vswhere چه نصب‌هایی
می‌بیند، چه پوشه‌هایی روی دیسک هست، داخل هر نصب `link.exe` و `vcvars64.bat`
هست یا نه، و Windows SDK کجاست. در پایان **دستور دقیق** را می‌دهد.

اگر لینکر پیدا شد ولی اسکریپت ساخت آن را نمی‌شناسیند:

```powershell
set FD_MSVC_ROOT=D:\مسیر\نصب\\VC\..\..\   ← همان «ریشه‌ی نصب» که find:msvc چاپ می‌کند
npm run desktop:build
```

#### سه حالت واقعی که در دور چهاردهم دیده شد

**الف) Visual Studio 2026 (پوشه‌ی `18`):** نصب شما این‌طور است:

```
C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools
```

نسخه‌های قبلی اسکریپت فقط `2019` و `2022` را می‌گشتند و این را پیدا نمی‌کردند.
حالا هر نام عددی (`18`، `2022`، `2019`، `17` …) پیمایش می‌شود.

**ب) دو نسخه‌ی MSVC که یکی ناقص است:** در یک نصب واقعی این‌ها با هم بودند:

```
VC\Tools\MSVC\14.51.36231\bin\Hostx64\x64\link.exe   ✘ (نبود)
VC\Tools\MSVC\14.44.35207\bin\HostX64\x64\link.exe   ✔
```

اسکریپت قبلاً فقط «جدیدترین» نسخه (`14.51`) را می‌گرفت و چون `link.exe`
نداشت، کل نصب را رد می‌کرد. حالا از جدید به قدیم می‌گردد و **اولین نسخه‌ای
که واقعاً `link.exe` دارد** را برمی‌دارد. `npm run find:msvc` هم دقیقاً
می‌گوید کدام نسخه استفاده می‌شود و کدام ناقص است.

**ج) `vcvars64.bat` نیست ولی `vcvarsall.bat` هست:** در همان نصب، فایل
`vcvars64.bat` وجود نداشت ولی `vcvarsall.bat` بود. اسکریپت قبلاً فقط اولی
را می‌گشت و در نتیجه `LIB`/`INCLUDE` را دستی می‌ساخت. حالا `vcvarsall.bat`
با آرگومان `x64` اجرا می‌شود و همان محیط کامل را می‌دهد.

> نکته‌ی چهارم: پوشه‌های خودِ نصب‌کننده (`…\Installer\Assets`, `…\Shared\…`)
> دیگر به‌عنوان «نصب Visual Studio» حساب نمی‌شوند — قبلاً ۲۰ خط
> «کامپوننت MSVC نصب نشده» بی‌ربط در گزارش چاپ می‌شد.

**قدم ۲ — اگر نصب روی درایو دیگر است:**

```powershell
set FD_VS_BASE=D:\Visual Studio
npm run find:msvc
```

**قدم ۳ — اگر واقعاً کامپوننت نیست:** بخش ۱۴ پایین (راه ۱ یا ۲).

#### سه متغیر محیطی برای موارد خاص

| متغیر | کاربرد |
|---|---|
| `FD_MSVC_ROOT` | ری‌شه‌ی نصب را دستی بدهید (نصب در مسیر غیرمعمول) |
| `FD_VS_BASE` | پوشه‌ی والد نصبی که باید پیمایش شود (درایو دیگر) |
| `FD_VSWHERE` | مسیر `vswhere.exe` (اگر در محل استاندارد نیست) |

---

> ⚠ **VS Code کافی نیست** — خودِ Rust هم این را در پیام خطا می‌گوید.
> آنچه لازم است «Visual Studio **Build Tools**» یا خود Visual Studio است،
> با کامپوننت **Desktop development with C++**.

### سه حالت و راه‌حل هر کدام

| حالت | چطور تشخیص دهیم | راه‌حل |
|---|---|---|
| هیچ ابزار C++ نصب نیست | پوشه‌ی `C:\Program Files (x86)\Microsoft Visual Studio` نیست | راه ۱ پایین |
| **Visual Studio هست ولی کامپوننت C++ ندارد** (شایع‌ترین) | پوشه‌ی VS هست، ولی `VC\Tools\MSVC` یا `link.exe` نیست | راه ۲ پایین (Modify) |
| C++ نصب است ولی PATH این پنجره آن را نمی‌بیند | `npm run doctor` می‌گوید «لینکر C++: MSVC 14.x» ولی ساخت خطا داد | `npm run desktop:build` (خودش `vcvars64` را اجرا می‌کند) |
| C++ نصب است ولی **در مسیری که برنامه نمی‌گشت** | همه‌ی کامپوننت‌ها نصب است، باز «پیدا نشد» | **بخش ۱۴/۰** — `npm run find:msvc` |

### راه ۱ — نصب Build Tools (یک بار، ~۱٫۵ گیگابایت)

1. بروید به <https://visualstudio.microsoft.com/visual-cpp-build-tools/> → **Download Build Tools**
2. در نصب‌کننده، تب **Workloads** → تیک **Desktop development with C++**
3. در پنل راست مطمئن شوید این‌ها تیک دارند:
   - **MSVC v143 — VS 2022 C++ x64/x86 build tools**
   - **Windows 11 SDK** (یا Windows 10 SDK)
4. **Install** و صبر کنید (۱۰ تا ۲۰ دقیقه)

یا با winget:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

> بعد از `winget install` معمولاً باید در **Visual Studio Installer → Modify**
> تیک «Desktop development with C++» را هم بزنید؛ نصب پیش‌فرض آن را ندارد.

### راه ۲ — اگر Visual Studio قبلاً نصب است

1. منوی استارت → **Visual Studio Installer**
2. کنار نسخه‌ی نصب‌شده → **Modify**
3. تیک **Desktop development with C++** → **Modify**

> اگر Visual Studio را فقط برای کارهای C# یا وب نصب کرده‌اید، این کامپوننت را ندارید.

### بعد از نصب: هیچ کار اضافه‌ای لازم نیست

```powershell
npm run doctor          # باید ببینید: ✔ لینکر C++ (link.exe): MSVC 14.x
npm run desktop:build   # ساخت
```

**لازم نیست** ویندوز را ری‌استارت کنید و لازم نیست ترمینال را عوض کنید: اسکریپت
`npm run desktop:build` خودش `vcvars64.bat` را اجرا می‌کند و محیط کامل
(`PATH` + `LIB` + `INCLUDE`) را برای کامپایل تنظیم می‌کند.

> چرا فقط `PATH` کافی نیست؟ `link.exe` برای پیدا کردن `kernel32.lib` و بقیه‌ی
> کتابخانه‌ها به متغیرهای `LIB` و `INCLUDE` هم نیاز دارد. اضافه‌کردن دستی پوشه‌ی
> `bin` به PATH، خطای لینکر را به خطای «`LNK1104: cannot open file 'kernel32.lib'`»
> تبدیل می‌کند. راه درست همان `vcvars64` است — که اسکریپت انجام می‌دهد.

### روش جایگزین: پنجرهٔ Native Tools

از منوی استارت باز کنید:

```
x64 Native Tools Command Prompt for VS 2022
```

بعد در همان پنجره:

```powershell
cd D:\Crushed-Stone-and-Sand-Production-Company\Crushed-Stone-and-Sand-Production-Company
npm run desktop:build
```

این پنجره از قبل همه‌ی محیط C++ را تنظیم کرده است.

### اگر Visual Studio در مسیر غیرمعمول نصب شده

```powershell
set FD_MSVC_ROOT=D:\Tools\VS2022BuildTools
npm run desktop:build
```

(چند مسیر را با `;` می‌توان جدا کرد.)

### اگر بعد از همه‌ی این‌ها خطا داد

متن کامل انگلیسی خطا را نگه دارید و به این جدول نگاه کنید:

| پیام | معنی | راه‌حل |
|---|---|---|
| `link.exe not found` | همان بخش بالا | راه ۱ یا ۲ |
| `LNK1104: cannot open file 'kernel32.lib'` | `LIB` تنظیم نشده یا **Windows SDK** نصب نیست | در Visual Studio Installer کامپوننت «Windows 11 SDK» را اضافه کنید |
| `windows.h(1): fatal error C1083: Cannot open include file: 'winapifamily.h'` | `INCLUDE` پوشه‌ی **`shared`** ویندوز SDK را ندارد این فایل آنجاست | **حل شد** (دور ۱۵) — اسکریپت حالا `ucrt`+`shared`+`um`+`winrt` را می‌گذارد و محیط را قبل از ساخت خودآزمایی می‌کند → بخش ۱۵ |
| `LNK1181: cannot open input file '...lib'` | نسخه‌ی SDK با MSVC هم‌خوان نیست | هر دو را از یک نصب‌کننده نصب کنید |
| `error: could not compile ... (build script)` همراه با خطای لینکر | همان مشکل لینکر؛ خطای واقعی چند خط بالاتر است | بالای خروجی را بخوانید |
| `failed to run custom build command` برای `proc-macro2` / `quote` | این crateها build-script دارند و اولین جاهایی هستند که به لینکر می‌خورند — **نشانه‌ی مشکل لینکر است، نه مشکل crate** | راه ۱ یا ۲ |

---

## ۱۵) خطای `C1083: Cannot open include file: 'winapifamily.h'`

پیام واقعی:

```
vswhom.cpp
C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\um\windows.h(1):
  fatal error C1083: Cannot open include file: 'winapifamily.h': No such file or directory
error occurred in cc-rs: command did not execute successfully:
  "...\MSVC\14.44.35207\bin\HostX64\x64\cl.exe" ... "-c" "ext/vswhom.cpp"
```

### معنی

کامپایلر C++ **پیدا شده** و شروع به کار کرده (این پیشرفت است!)، ولی
`INCLUDE` — فهرست پوشه‌های هدر — کامل نیست.

`windows.h` در پوشه‌ی `um` است و در خط اول خودش این را دارد:

```c
#include <winapifamily.h>
```

و `winapifamily.h` در پوشه‌ی **`shared`** ویندوز SDK است. پس `INCLUDE` باید
**هر چهار** پوشه را داشته باشد، به همین ترتیب:

```
…\Windows Kits\10\Include\10.0.26100.0\ucrt      ← هدرهای C runtime
…\Windows Kits\10\Include\10.0.26100.0\shared    ← winapifamily.h  ★
…\Windows Kits\10\Include\10.0.26100.0\um        ← windows.h
…\Windows Kits\10\Include\10.0.26100.0\winrt
```

دقیقاً همین ترتیب را `vcvars64.bat` می‌سازد. اسکریپت قبلی در حالت پشتیبان
(وقتی `vcvars` کار نمی‌کرد) فقط `um` و `ucrt` را می‌گذاشت — و همین خطا
پیش می‌آمد.

### چه چیزی درست شد

1. `INCLUDE` حالا `ucrt` + **`shared`** + `um` + `winrt` را با ترتیب درست دارد
2. `LIB` حالا `ucrt` + `um` (x64) را دارد
3. `VCINSTALLDIR` به پوشه‌ی `VC` اشاره می‌کند (قبلاً `VC\Tools` بود — چند
   build script همین را می‌خوانند)
4. `WindowsSDKVersion` / `WindowsSdkDir` / `VCToolsVersion` / `Platform` هم تنظیم می‌شوند
5. **نسخه‌ی SDK عددی مرتب می‌شود:** قبلاً `10.0.19041.0` بر `10.0.26100.0`
   ترجیح داده می‌شد (مقایسه‌ی رشته‌ای) و `shared` قدیمی‌تر پیدا نمی‌شد
6. **موفقیت `vcvars` واقعاً سنجیده می‌شود:** قبلاً فقط وجود `PATH` در خروجی
   چک می‌شد — که همیشه هست. حالا `LIB` پر بودن و وجود `shared` در `INCLUDE`
   شرط است؛ اگر نبود، دلیلش چاپ و به روش پشتیبان (که حالا کامل است) سوییچ می‌شود

### دستور تشخیص: `npm run desktop:env`

قبل از ساخت، ببینید کامپایلر چه چیزی می‌گیرد:

```powershell
npm run desktop:env
```

خروجی نمونه (سالم):

```
۲) روش تنظیم محیط
  ✔ vcvarsall x64
۳) INCLUDE — هدرهای C++ و ویندوز
  ✔ …\VC\Tools\MSVC\14.44.35207\include
  ✔ …\Windows Kits\10\Include\10.0.26100.0\ucrt
  ✔ …\Windows Kits\10\Include\10.0.26100.0\shared
  ✔ …\Windows Kits\10\Include\10.0.26100.0\um
  ✔ …\Windows Kits\10\Include\10.0.26100.0\winrt
۵) خودآزمایی — فایل‌هایی که کامپایل واقعاً می‌خواهد
  ✔ windows.h
  ✔ winapifamily.h
  ✔ stdio.h
  ✔ kernel32.lib
  ✔ ucrt.lib
=== نتیجه ===
✔ محیط کامپایل کامل است.
```

### خودآزمایی خودکار در `desktop:build`

`npm run desktop:build` حالا **قبل از** شروع کامپایل، وجود `windows.h`،
`winapifamily.h` و `kernel32.lib` را می‌سنجد. اگر کم بود، همان اول می‌گوید —
نه بعد از ده دقیقه انتظار.

### اگر گفت `winapifamily.h` نیست

| حالت | راه‌حل |
|---|---|
| پوشه‌ی `shared` در SDK نیست | Visual Studio Installer → Modify → «Windows 11 SDK» را تیک بزنید (کامل نصب شود) |
| SDK روی درایو دیگر است | `set FD_SDK_ROOT=D:\Windows Kits\10` |
| چند نسخه SDK هست و قدیمی انتخاب می‌شود | دیگر نباید پیش بیاید؛ `npm run desktop:env` نسخه‌ی انتخابی را نشان می‌دهد |
| `INCLUDE` خالی است | `npm run find:msvc` — یعنی `vcvarsall.bat` پیدا نشده (بخش ۱۴/۰) |
