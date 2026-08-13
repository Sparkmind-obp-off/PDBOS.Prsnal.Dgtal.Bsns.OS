/**
 * Audit log + analytics event writers.
 */
import { newId } from '../lib/id'

export interface AuditInput {
  orgId: string | null
  userId: string | null
  action: string
  entity?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown> | null
  ip?: string | null
}

export async function writeAudit(db: D1Database, input: AuditInput): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity, entity_id, metadata, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId('aud'),
        input.orgId,
        input.userId,
        input.action,
        input.entity ?? null,
        input.entityId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.ip ?? null
      )
      .run()
  } catch (err) {
    // Auditing must never break the request path.
    console.error('[PDBOS] audit write failed:', err)
  }
}

export async function writeEvent(
  db: D1Database,
  orgId: string,
  userId: string | null,
  event: string,
  entityType?: string | null,
  entityId?: string | null,
  properties?: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO analytics_events (id, org_id, user_id, event, entity_type, entity_id, properties)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId('evt'),
        orgId,
        userId,
        event,
        entityType ?? null,
        entityId ?? null,
        properties ? JSON.stringify(properties) : null
      )
      .run()
  } catch (err) {
    console.error('[PDBOS] event write failed:', err)
  }
}

export async function listAudit(
  db: D1Database,
  orgId: string,
  opts: { limit: number; offset: number; action?: string | null }
) {
  const where = ['a.org_id = ?']
  const binds: unknown[] = [orgId]
  if (opts.action) {
    where.push('a.action = ?')
    binds.push(opts.action)
  }
  const sql = `SELECT a.id, a.action, a.entity, a.entity_id, a.metadata, a.created_at,
                      u.name AS user_name, u.email AS user_email
               FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
               WHERE ${where.join(' AND ')}
               ORDER BY a.created_at DESC, a.id DESC
               LIMIT ? OFFSET ?`
  const rows = await db.prepare(sql).bind(...binds, opts.limit, opts.offset).all()
  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM audit_logs a WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ c: number }>()
  return { items: rows.results ?? [], total: total?.c ?? 0 }
}
