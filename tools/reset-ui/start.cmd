@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  اجراکننده‌ی ابزار «صفر کردن سیستم» (ویندوز)
REM
REM  روی این فایل دوبار کلیک کنید؛ نه ترمینال لازم است نه تایپ دستور.
REM
REM  ⚠ این فایل عمداً با پایان‌خط CRLF ذخیره می‌شود (`.gitattributes`).
REM  cmd.exe با فایل LF ممکن است `goto`/`:label` و بلاک‌های پرانتزی را
REM  درست نخواند؛ نتیجه‌اش «پنجره باز می‌شود و فوراً بسته می‌شود» است.
REM
REM  نکته: انتخاب پورت آزاد و باز کردن مرورگر حالا کار خودِ سرور است
REM  (tools/shared/tool-server.mjs) — سرور دقیقاً بعد از آماده شدن، مرورگر
REM  را باز می‌کند و اگر پورت اشغال باشد پورت بعدی را می‌گیرد. این‌جا هیچ
REM  تأخیر حدسی و هیچ `start` تودرتو نداریم.
REM ─────────────────────────────────────────────────────────────────────
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

REM  ── پیدا کردن Node: اول نود همراه برنامه، بعد نود سیستم ───────────────
set "NODE_EXE="
if exist "%~dp0..\..\src-tauri\api\node.exe" set "NODE_EXE=%~dp0..\..\src-tauri\api\node.exe"
if exist "%~dp0..\api\node.exe" set "NODE_EXE=%~dp0..\api\node.exe"
if exist "%~dp0..\..\api\node.exe" set "NODE_EXE=%~dp0..\..\api\node.exe"
if exist "%~dp0..\node.exe" set "NODE_EXE=%~dp0..\node.exe"
if exist "%~dp0node.exe" set "NODE_EXE=%~dp0node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\Farday Roshan\_up_\api\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\Farday Roshan\_up_\api\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\Farday Roshan\api\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\Farday Roshan\api\node.exe"
if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_EXE=node"
)
if not defined NODE_EXE goto no_node

echo.
echo   ابزار «صفر کردن سیستم» — فردای روشن
echo   صبر کنید تا مرورگر خودش باز شود...
echo   برای بستن: این پنجره را ببندید (یا Ctrl+C)
echo.

REM  سرور در همین پنجره اجرا می‌شود؛ خطاها همین‌جا دیده می‌شوند.
"%NODE_EXE%" "%~dp0server.mjs" %*
goto end

:no_node
echo.
echo   ⛔ Node.js روی این کمپیوتر پیدا نشد.
echo      نسخه‌ی کامل را نصب کنید یا از نصب‌کننده‌ی برنامه استفاده کنید
echo      (node.exe همراه آن هست).
echo.
echo      دانلود Node.js:  nodejs.org  ^(نسخه 22 یا بالاتر^)
echo.
pause
exit /b 1

:end
endlocal
