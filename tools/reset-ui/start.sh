#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  اجراکننده‌ی ابزار «صفر کردن سیستم» (لینوکس/مک)
#
#  اجرا:  ./tools/reset-ui/start.sh   [--data-dir <مسیر>] [--port <شماره>]
#
#  انتخاب پورت آزاد و باز کردن مرورگر کار خودِ سرور است
#  (tools/shared/tool-server.mjs): سرور دقیقاً بعد از «listening» مرورگر را
#  باز می‌کند. این‌جا هیچ تأخیر حدسی و هیچ باز کردن دوباره‌ی مرورگر نیست
#  (باگ دور ۳۶: مرورگر قبل از آماده شدن سرور باز می‌شد و صفحه‌ی خطا
#  می‌داد، و اسکریپت دو نسخه‌ی سرور بالا می‌آورد).
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# در نسخه‌ی نصب‌شده «ریشه‌ی مخزن» وجود ندارد؛ به آن تکیه نمی‌کنیم.
cd "$here"

# ── پیدا کردن Node: اول نود همراه بسته، بعد نود سیستم ──────────────────
NODE_BIN=""
for cand in "$here/../api/node" "$here/../node" "$here/node" \
            "$HOME/.local/share/af.farday.roshan/node"; do
  if [ -x "$cand" ]; then NODE_BIN="$cand"; break; fi
done
if [ -z "$NODE_BIN" ] && command -v node >/dev/null 2>&1; then NODE_BIN="$(command -v node)"; fi

if [ -z "$NODE_BIN" ]; then
  echo
  echo "  ⛔ Node.js پیدا نشد. Node 22 یا بالاتر نصب کنید (nodejs.org)."
  echo
  exit 1
fi

exec "$NODE_BIN" "$here/server.mjs" "$@"
