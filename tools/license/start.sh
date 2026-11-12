#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  اجراکننده‌ی ابزار لایسنس (لینوکس/مک) — «پنل مالک»
#
#  اجرا:  ./tools/license/start.sh   [--keys-dir <مسیر>] [--port <شماره>]
#
#  ⚠ ابزار لایسنس ابزار **فروشنده** است و در بسته‌ی نصبی مشتری نیست (دور ۳۵).
#
#  انتخاب پورت آزاد و باز کردن مرورگر کار خودِ سرور است
#  (tools/shared/tool-server.mjs). این‌جا مرورگر دوباره باز نمی‌شود.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

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
