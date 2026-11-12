/**
 * حل «مربوط» (شاخه‌ی مصرف) از فهرست کشویی.
 *
 * ## باگی که این فایل رفع می‌کند
 * فورم‌ها فقط `contractorId` (شناسه‌ی شاخه) می‌فرستادند و `contractorName`
 * را خود مرورگر پر می‌کرد. هر جایی که نام پر نمی‌شد (ارسال مستقیم API،
 * ورود اکسل، یا یک خطای کوچک در UI) سند با شاخه‌ی **خالی** ذخیره می‌شد:
 *   • ستون «مربوط» در فهرست و چاپ خالی می‌ماند،
 *   • راپور «مربوط (شاخه مصرف)» کرایه‌ی آن بل را در «بدون شاخه» می‌ریخت،
 *   • و چون نام ذخیره نشده بود، بعد از تغییر نام شاخه در تنظیمات هم دیگر
 *     قابل تشخیص نبود.
 *
 * حالا سرور همیشه نام را خودش از شناسه می‌خواند (و برعکس، شناسه را از نام
 * پیدا می‌کند) — یک منبع حقیقت، نه اعتماد به کلاینت.
 */
import { db } from '../db';

/** نوع فهرست کشویی شاخه‌ها — همان کلیدی که در تنظیمات «مربوط» نام دارد */
export const RELATED_LOOKUP_TYPE = 'contractor';

export type RelatedBranch = { contractorId: number | null; contractorName: string };

export async function resolveRelatedBranch(
  contractorId: unknown,
  contractorName: unknown,
): Promise<RelatedBranch> {
  const name = String(contractorName ?? '').trim();
  const idNum = contractorId === '' || contractorId === null || contractorId === undefined ? null : Number(contractorId);
  const id = idNum !== null && Number.isFinite(idNum) && idNum > 0 ? idNum : null;

  if (id) {
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT "name" FROM "LookupItem" WHERE "type"=? AND "id"=?`,
      RELATED_LOOKUP_TYPE, id,
    );
    /*
     * نامِ ذخیره‌شده برنده است: اگر کلاینت نام لحظه‌ی سند را بفرستد، سند
     * همان نام تاریخی را نگه می‌دارد (مثل customerName در بل فروش).
     */
    return { contractorId: id, contractorName: name || String(rows?.[0]?.name ?? '') };
  }

  if (name) {
    const rows: any[] = await db().$queryRawUnsafe(
      `SELECT "id" FROM "LookupItem" WHERE "type"=? AND "name"=? ORDER BY "active" DESC, "id" LIMIT 1`,
      RELATED_LOOKUP_TYPE, name,
    );
    return { contractorId: rows?.length ? Number(rows[0].id) : null, contractorName: name };
  }

  return { contractorId: null, contractorName: '' };
}
