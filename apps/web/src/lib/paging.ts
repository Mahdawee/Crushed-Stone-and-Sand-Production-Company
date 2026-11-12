/**
 * صفحه‌بندی فهرست‌ها — یک قاعده برای همه.
 *
 * ## باگی که این فایل رفع می‌کند
 * در فروشات، مصارف و رسیدات، بعد از **حذف** ردیف، صفحه دوباره بارگذاری
 * می‌شد ولی شماره‌ی صفحه همان می‌ماند. اگر صفحه‌ی ۳ باز بود و فقط یک ردیف
 * داشت، بعد از حذف آن ردیف:
 *   • سرور صفحه‌ی ۳ را خالی برمی‌گرداند (چون ردیفی نمانده)،
 *   • در حالی که «مجموع» می‌گفت ۵۱ سند هست،
 *   • کاربر جدول خالی می‌دید و فکر می‌کرد همه‌ی داده‌ها پاک شد.
 *
 * راه‌حل: بعد از حذف، اگر صفحه‌ی جاری از آخرین صفحه گذشته باشد، یک صفحه
 * عقب برمی‌گردیم.
 */

/** آخرین صفحه‌ی معتبر برای یک فهرست (کمترین ۱) */
export function lastPage(total: number, pageSize: number): number {
  const size = pageSize > 0 ? pageSize : 25;
  return Math.max(1, Math.ceil((Number(total) || 0) / size));
}

/**
 * صفحه‌ی درست بعد از حذف یک ردیف.
 *
 * @param page صفحه‌ی فعلی (۱-پایه)
 * @param pageSize تعداد ردیف در هر صفحه
 * @param total شماره‌ی کل ردیف‌ها **قبل از** حذف
 */
export function pageAfterRemove(page: number, pageSize: number, total: number): number {
  const after = Math.max(0, (Number(total) || 0) - 1);
  return Math.min(Math.max(1, Number(page) || 1), lastPage(after, pageSize));
}
