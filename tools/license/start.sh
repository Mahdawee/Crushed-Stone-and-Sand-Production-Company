#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  اجراکننده‌ی ابزار لایسنس (لینوکس/مک)
#
#  درخواست کاربر: «برای ابزار لایسنس یک اجراکننده بساز».
#  همین فایل را اجرا کنید:  ./tools/license/start.sh   (یا دوبار کلیک)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
# ⚠ در نسخه‌ی نصب‌شده «ریشه‌ی مخزن» وجود ندارد؛ به آن تکیه نمی‌کنیم.
cd "$here"

PORT="${FD_LICENSE_UI_PORT:-4321}"
if [ $# -gt 0 ] && [[ "${1}" =~ ^[0-9]+$ ]]; then PORT="$1"; shift; fi
export FD_LICENSE_UI_PORT="$PORT"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  ⛔ Node.js پیدا نشد. Node 22 یا بالاتر نصب کنید (nodejs.org)."
  echo "     اگر نسخه‌ی نصب‌شده‌ی برنامه را دارید: src-tauri/api/node"
  echo
  # اگر نود همراه بسته باشد، از همان استفاده کن
  for cand in "$root/src-tauri/api/node" "$here/../api/node" "$here/node" "$HOME/.local/share/af.farday.roshan/node"; do
    if [ -x "$cand" ]; then exec "$cand" "$here/server.mjs"; fi
  done
  exit 1
fi

echo
echo "  ابزار لایسنس فردای روشن"
echo "  آدرس:  http://127.0.0.1:$PORT"
echo "  برای بستن: Ctrl+C"
echo

# باز کردن مرورگر، اگر ابزاری برای این کار هست (خطا مهم نیست)
#
# باگ: مرورگر بعد از یک ثانیه‌ی **ثابت** باز می‌شد؛ روی کمپیوتر کند سرور
# هنوز بالا نیامده بود و کاربر صفحه‌ی «اتصال برقرار نشد» می‌دید. حالا تا
# آماده شدن سرور صبر می‌کند (حداکثر ۱۵ ثانیه) و بعد مرورگر را باز می‌کند.
(
  for _ in $(seq 1 30); do
    if command -v curl >/dev/null 2>&1; then
      curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
    else
      sleep 0.5
      # بدون curl: به سرور وصل شو اگر /dev/tcp پشتیبانی شود
      (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && { exec 3<&-; break; }
    fi
    sleep 0.5
  done
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || true
  fi
) &

exec node "$here/server.mjs" "$@"
