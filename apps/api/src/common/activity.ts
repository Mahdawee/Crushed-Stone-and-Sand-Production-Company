import { db } from '../db';
import { ensureSchemaAsync } from '../schema';

export async function logActivity(opts: {
  username?: string;
  action: string;
  entity?: string;
  entityId?: number | null;
  detail?: string;
}) {
  try {
    await ensureSchemaAsync();
    await db().$executeRawUnsafe(
      `INSERT INTO "ActivityLog" ("username","action","entity","entityId","detail") VALUES (?,?,?,?,?)`,
      opts.username || 'system',
      opts.action,
      opts.entity || '',
      opts.entityId ?? null,
      (opts.detail || '').slice(0, 900),
    );
  } catch {
    /* logging must never break a business operation */
  }
}
