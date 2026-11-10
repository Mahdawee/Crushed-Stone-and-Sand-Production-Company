# نصب یک‌باره‌ی Rust برای ساخت نسخه دسکتاپ «فردای روشن»
#
#   روش اجرا: روی همین فایل راست‌کلیک → «Run with PowerShell»
#   یا در PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\install-rust.ps1
#
# چه می‌کند؟
#   ۱) بررسی می‌کند Rust از قبل نصب است یا نه (اگر بله، هیچ کاری نمی‌کند)
#   ۲) rustup-init.exe را از https://rustup.rs دانلود می‌کند
#   ۳) با تنظیمات پیش‌فرض نصب می‌کند (msvc + stable)
#   ۴) PATH جاری را همان‌جا اصلاح می‌کند تا نیازی به بستن پنجره نباشد
#   ۵) نسخه‌ها را چاپ می‌کند
#
# چرا لازم است؟ خطای
#   failed to run 'cargo metadata' command to get workspace directory:
#     program not found
# یعنی cargo نصب نیست، یا نصب است و در PATH نیست.

$ErrorActionPreference = 'Stop'

function Write-Step($t) { Write-Host "`n>>> $t" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Warn2($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }

Write-Host "=== نصب Rust برای ساخت نصب‌کننده فردای روشن ===" -ForegroundColor White

# --- ۱) آیا از قبل نصب است؟ -------------------------------------------------
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
$cargoExe = Join-Path $cargoBin 'cargo.exe'

if (Test-Path $cargoExe) {
    Write-Ok "Rust از قبل نصب است: $cargoExe"
    # PATH این پنجره را اصلاح می‌کنیم (منشأ خطای program not found)
    if (-not ($env:PATH -split ';' | Where-Object { $_ -eq $cargoBin })) {
        $env:PATH = "$cargoBin;$env:PATH"
        Write-Warn2 "مسیر cargoBin به PATH همین پنجره اضافه شد."
    }
    & $cargoExe --version
    Write-Host "`nحالا می‌توانید بسازید:  npm run desktop:build" -ForegroundColor Green
    exit 0
}

# --- ۲) دانلود rustup-init ---------------------------------------------------
$tmp = Join-Path $env:TEMP 'rustup-init.exe'
Write-Step "دانلود rustup-init.exe (حدود ۸ مگابایت)…"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' `
        -OutFile $tmp -UseBasicParsing
} catch {
    Write-Host "`n[خطا] دانلود ناموفق بود: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "راه جایگزین: به https://rustup.rs بروید و rustup-init.exe را دستی بگیرید." -ForegroundColor Yellow
    exit 1
}
Write-Ok "دانلود شد: $tmp"

# --- ۳) نصب ------------------------------------------------------------------
Write-Step "نصب Rust (چند دقیقه — چیزی از شما پرسیده می‌شود: Enter بزنید)…"
Write-Host "  (اگر خطای «MSVC not found» داد، اول Visual Studio Build Tools + 'Desktop development with C++' را نصب کنید)" -ForegroundColor DarkGray
& $tmp -y --default-toolchain stable --profile minimal
$code = $LASTEXITCODE

if ($code -ne 0) {
    Write-Host "`n[خطا] نصب با کد $code تمام شد." -ForegroundColor Red
    Write-Host "راه جایگزین:  winget install --id Rustlang.Rustup -e" -ForegroundColor Yellow
    exit $code
}

# --- ۴) PATH همین پنجره ------------------------------------------------------
$env:PATH = "$cargoBin;$env:PATH"
Write-Ok "PATH به‌روز شد."

# --- ۵) بررسی نهایی ----------------------------------------------------------
Write-Step "بررسی نصب"
& (Join-Path $cargoBin 'rustc.exe') --version
& $cargoExe --version

Write-Host "`n=== تمام شد ===" -ForegroundColor Green
Write-Host "مرحله بعد:" -ForegroundColor White
Write-Host "  npm run doctor          (بررسی کامل پیش‌نیازها)" -ForegroundColor Gray
Write-Host "  npm run desktop:build   (ساخت نصب‌کننده)" -ForegroundColor Gray
Write-Host "`nنکته: اگر پنجره‌ی ترمینال دیگری باز است، آن را ببندید و دوباره باز کنید." -ForegroundColor DarkGray
