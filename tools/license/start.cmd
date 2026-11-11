@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  اجراکننده‌ی ابزار لایسنس (ویندوز) — «پنل مالک»
REM
REM  درخواست کاربر: «برای ابزار لایسنس یک اجراکننده بساز».
REM  روی ویندوز می‌شود روی همین فایل دوبار کلیک کرد؛ نیازی به ترمینال و
REM  تایپ دستور نیست. اول Node.js روی سیستم بررسی می‌شود، بعد سرور ابزار
REM  بالا می‌آید و مرورگر خودکار باز می‌شود.
REM ─────────────────────────────────────────────────────────────────────
chcp 65001 >nul
setlocal enableextensions
REM  ⚠ در نسخه‌ی نصب‌شده پوشه‌ی tools کنار فایل اجرایی است و «ریشه‌ی مخزن» وجود ندارد.
cd /d "%~dp0"

REM  ── باگ (شکار باگ دور ۳۴): نود همراه بسته نادیده گرفته می‌شد ─────────
REM  نسخه‌ی نصب‌شده `node.exe` خودش را دارد و کاربر «هیچ چیز اضافه» نصب
REM  نمی‌کند. ولی این‌جا اول `where node` اجرا می‌شد و اگر Node روی سیستم
REM  نبود، مستقیم می‌رفت به پیام «Node.js پیدا نشد» — پیامی که خودش می‌گفت
REM  «node.exe همراه نصب‌کننده هست». یعنی ابزار روی **همان** کمپیوتری که
REM  برنامه رویش نصب شده بود کار نمی‌کرد.
REM  حالا اول نودِ همراه بسته جست‌وجو می‌شود، بعد نودِ سیستم.
set "NODE_EXE="
if exist "%~dp0..\..\src-tauri\api\node.exe" set "NODE_EXE=%~dp0..\..\src-tauri\api\node.exe"
if exist "%~dp0..\api\node.exe" set "NODE_EXE=%~dp0..\api\node.exe"
if exist "%~dp0node.exe" set "NODE_EXE=%~dp0node.exe"
if exist "%LOCALAPPDATA%\Programs\Farday Roshan\_up_\api\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\Farday Roshan\_up_\api\node.exe"
if exist "%LOCALAPPDATA%\Programs\Farday Roshan\api\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\Farday Roshan\api\node.exe"
REM  اگر هیچ نسخه‌ی همراهی نبود، نودِ نصب‌شده روی سیستم
if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_EXE=node"
)
if not defined NODE_EXE goto no_node

set "PORT=4321"
REM  اگر آرگومان اول گزینه باشد (مثل --data-dir/--keys-dir)، پورت را از آن نمی‌گیریم
set "FIRST=%~1"
if not "%FIRST%"=="" if not "%FIRST:~0,1%"=="-" set "PORT=%FIRST%"
set "FD_LICENSE_UI_PORT=%PORT%"

echo.
echo   ابزار لایسنس فردای روشن
echo   آدرس:  http://127.0.0.1:%PORT%
echo   برای بستن: این پنجره را ببندید (یا Ctrl+C)
echo.
REM  باگ: مرورگر **قبل** از بالا آمدن سرور باز می‌شد و کاربر صفحه‌ی
REM  ERR_CONNECTION_REFUSED می‌دید (همان باگی که در ابزار «صفر کردن» رفع
REM  شد ولی این‌جا مانده بود). حالا دو ثانیه صبر می‌کند.
REM  نکته‌ی cmd: آدرس بدون فاصله است، پس داخل `start` نیازی به کوتیشن
REM  تودرتو نیست (کوتیشن تودرتو در cmd به‌راحتی می‌شکند).
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%/""
"%NODE_EXE%" "%~dp0server.mjs" %*
goto end

:no_node
echo.
echo   ⛔ Node.js روی این کمپیوتر پیدا نشد.
echo      نسخه‌ی کامل را نصب کنید یا از نصب‌کننده‌ی برنامه استفاده کنید
echo      (node.exe همراه آن هست: src-tauri\api\node.exe).
echo.
echo      دانلود Node.js:  nodejs.org  ^(نسخه 22 یا بالاتر^)
echo.
pause
exit /b 1

:end
if errorlevel 1 pause
endlocal
