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
cd /d "%~dp0..\.."

where node >nul 2>nul
if errorlevel 1 goto no_node

REM  اگر نود همراه نسخه‌ی نصب‌شده هست، از همان استفاده کن (بدون نیاز به نصب چیزی)
set "NODE_EXE=node"
if exist "%~dp0..\..\src-tauri\api\node.exe" set "NODE_EXE=%~dp0..\..\src-tauri\api\node.exe"
if exist "%LOCALAPPDATA%\Programs\Farday Roshan\_up_\api\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\Farday Roshan\_up_\api\node.exe"

set "PORT=4321"
if not "%~1"=="" set "PORT=%~1"
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
"%NODE_EXE%" "%~dp0server.mjs"
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
