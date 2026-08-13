/**
 * Notification Engine — in-app notifications (Phase 0).
 * External channels (email/WhatsApp) plug in later via the Integration Hub.
 */
import { newId } from '../lib/id'

export interface NotificationInput {
  userId?: string | null
  type?: string
  severity?: string
  title: string
  message?: string | null
  entityType?: string | null
  entityId?: string | null
}

export async function notify(
  db: D1Database,
  orgId: string,
  input: NotificationInput,
  isDemo = false
): Promise<string> {
  const id = newId('ntf')
  await db
    .prepare(
      `INSERT INTO notifications (id, org_id, user_id, type, severity, title, message, entity_type, entity_id, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.userId ?? null, input.type || 'INFO', input.severity || 'LOW',
      input.title, input.message ?? null, input.entityType ?? null, input.entityId ?? null,
      isDemo ? 1 : 0
    )
    .run()
  return id
}

export async function listNotifications(
  db: D1Database,
  orgId: string,
  userId: string,
  opts: { unreadOnly?: boolean; limit: number; offset: number }
) {
  const where = ['org_id = ?', '(user_id IS NULL OR user_id = ?)']
  const binds: unknown[] = [orgId, userId]
  if (opts.unreadOnly) where.push('read_at IS NULL')

  const rows = await db
    .prepare(
      `SELECT * FROM notifications WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, opts.offset)
    .all()
  const unread = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM notifications
       WHERE org_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL`
    )
    .bind(orgId, userId)
    .first<{ c: number }>()
  return { items: rows.results ?? [], unread: unread?.c ?? 0 }
}

export async function markRead(db: D1Database, orgId: string, userId: string, id: string) {
  await db
    .prepare(
      `UPDATE notifications SET read_at = datetime('now')
       WHERE id = ? AND org_id = ? AND (user_id IS NULL OR user_id = ?)`
    )
    .bind(id, orgId, userId)
    .run()
}

export async function markAllRead(db: D1Database, orgId: string, userId: string) {
  await db
    .prepare(
      `UPDATE notifications SET read_at = datetime('now')
       WHERE org_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL`
    )
    .bind(orgId, userId)
    .run()
}
