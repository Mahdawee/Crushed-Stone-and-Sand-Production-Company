/**
 * نام‌های ثابت و نوع‌های لایسنس — نقطه‌ی واحد ایمپورت برای بقیه‌ی ماژول‌ها.
 */
import { LICENSE_KINDS, KIND_DAYS, ISSUABLE_KINDS } from './license-kinds';
import type { LicenseKind, LicensePayload } from './license-kinds';

export type { LicenseKind, LicensePayload };
export { LICENSE_KINDS, KIND_DAYS, ISSUABLE_KINDS };

export const LICENSE_BEGIN = '-----BEGIN FARDAY LICENSE-----';
export const LICENSE_END = '-----END FARDAY LICENSE-----';
export const LICENSE_FORMAT = 'FR-1';

export function licenseKindOf(kind: string) {
  return LICENSE_KINDS.find((k) => k.value === kind);
}
