; پیام‌های فارسی نصب‌کننده (NSIS)
;
; چرا این فایل لازم است:
;   NSIS زبان فارسی را با نام «Farsi» می‌شناسد و فایل زبانش
;   Contrib\Language files\Farsi.nlf است. اگر در tauri.conf.json
;   نام «Persian» بنویسیم، makensis دنبال Persian.nlf می‌گردد که
;   وجود ندارد و ساخت نصب‌کننده با خطای زیر متوقف می‌شود:
;       Can't open language file - "...\NSIS\Contrib\Language files\Persian.nlf"!
;
;   همچنین تا tauri-cli 2.12.x ترجمه فارسی پیام‌های خودِ Tauri همراه
;   ابزار نبود، پس متن‌ها را در همین فایل با customLanguageFiles می‌دهیم.
;
; نکته: Tauri این فایل را فقط با BOM بازنویسی می‌کند و جای‌نگهدارهای
;   قالب را در آن پر نمی‌کند؛ بنابراین فقط از متغیرهای استاندارد NSIS
;   مثل ${PRODUCTNAME} و ${VERSION} استفاده شده است.

LangString addOrReinstall ${LANG_FARSI} "افزودن / نصب مجدد اجزا"
LangString alreadyInstalled ${LANG_FARSI} "قبلاً نصب شده است"
LangString alreadyInstalledLong ${LANG_FARSI} "${PRODUCTNAME} ${VERSION} قبلاً نصب شده است. عملیات مورد نظر را انتخاب کنید و روی بعدی کلیک کنید."
LangString appRunning ${LANG_FARSI} "${PRODUCTNAME} در حال اجراست. لطفاً ابتدا آن را ببندید و دوباره تلاش کنید."
LangString noPermissionToCloseApp ${LANG_FARSI} "دسترسی کافی برای بستن ${PRODUCTNAME} وجود ندارد؛ لطفاً خودتان آن را ببندید و دوباره تلاش کنید."
LangString appRunningOkKill ${LANG_FARSI} "${PRODUCTNAME} در حال اجراست!$\nبرای بستن آن، «تأیید» را انتخاب کنید."
LangString chooseMaintenanceOption ${LANG_FARSI} "عملیات نگهداری مورد نظر را برای اجرا انتخاب کنید."
LangString chooseHowToInstall ${LANG_FARSI} "نحوه نصب ${PRODUCTNAME} را انتخاب کنید"
LangString createDesktop ${LANG_FARSI} "ایجاد میان‌بر روی دسکتاپ"
LangString dontUninstall ${LANG_FARSI} "حذف نکن"
LangString dontUninstallDowngrade ${LANG_FARSI} "حذف نکن (نصب نسخه قدیمی‌تر بدون حذف، غیرفعال است)"
LangString failedToKillApp ${LANG_FARSI} "بستن ${PRODUCTNAME} انجام نشد. ابتدا آن را ببندید و دوباره تلاش کنید."
LangString installingWebview2 ${LANG_FARSI} "در حال نصب WebView2 ..."
LangString newerVersionInstalled ${LANG_FARSI} "نسخه جدیدتری از ${PRODUCTNAME} قبلاً نصب شده است! نصب نسخه قدیمی‌تر توصیه نمی‌شود. اگر می‌خواهید این نسخه را نصب کنید، نسخه فعلی را حذف کنید. عملیات مورد نظر را انتخاب کنید و روی بعدی کلیک کنید."
LangString older ${LANG_FARSI} "قدیمی‌تر"
LangString olderOrUnknownVersionInstalled ${LANG_FARSI} "نسخه $R4 از ${PRODUCTNAME} روی سیستم شما نصب است. عملیات مورد نظر را انتخاب کنید و روی بعدی کلیک کنید."
LangString silentDowngrades ${LANG_FARSI} "نصب نسخه قدیمی‌تر در حالت بی‌صدا غیرفعال است؛ از رابط گرافیکی نصب استفاده کنید.$\n"
LangString unableToUninstall ${LANG_FARSI} "حذف انجام نشد!"
LangString uninstallApp ${LANG_FARSI} "حذف ${PRODUCTNAME}"
LangString uninstallBeforeInstalling ${LANG_FARSI} "حذف نسخه قبلی پیش از نصب"
LangString unknown ${LANG_FARSI} "نامعلوم"
LangString webview2AbortError ${LANG_FARSI} "نصب WebView2 ناموفق بود! برنامه بدون آن اجرا نمی‌شود. نصب‌کننده را دوباره اجرا کنید."
LangString webview2DownloadError ${LANG_FARSI} "خطا: دانلود WebView2 ناموفق بود - $0"
LangString webview2DownloadSuccess ${LANG_FARSI} "بوت‌استرپر WebView2 با موفقیت دانلود شد"
LangString webview2Downloading ${LANG_FARSI} "در حال دانلود بوت‌استرپر WebView2 ..."
LangString webview2InstallError ${LANG_FARSI} "خطا: نصب WebView2 با کد $1 ناموفق بود"
LangString webview2InstallSuccess ${LANG_FARSI} "WebView2 با موفقیت نصب شد"
LangString deleteAppData ${LANG_FARSI} "حذف داده‌های برنامه (فروشات، مصارف، معاشات)"
