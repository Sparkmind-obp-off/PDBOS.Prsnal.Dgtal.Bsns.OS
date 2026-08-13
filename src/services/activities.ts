/**
 * Activity system — polymorphic timeline for leads, clients, projects, etc.
 */
import { newId } from '../lib/id'

export interface ActivityInput {
  entity_type: string
  entity_id: string
  type: string
  description: string
  outcome?: string | null
  due_at?: string | null
}

export async function createActivity(
  db: D1Database,
  orgId: string,
  userId: string,
  input: ActivityInput,
  isDemo = false
): Promise<string> {
  const id = newId('act')
  await db
    .prepare(
      `INSERT INTO lead_activities (id, org_id, entity_type, entity_id, type, description, outcome, due_at, created_by, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.entity_type, input.entity_id, input.type, input.description,
      input.outcome ?? null, input.due_at ?? null, userId, isDemo ? 1 : 0
    )
    .run()
  return id
}

export async function listActivities(
  db: D1Database,
  orgId: string,
  opts: { entityType?: string | null; entityId?: string | null; type?: string | null; limit: number; offset: number }
) {
  const where = ['a.org_id = ?']
  const binds: unknown[] = [orgId]
  if (opts.entityType) { where.push('a.entity_type = ?'); binds.push(opts.entityType) }
  if (opts.entityId) { where.push('a.entity_id = ?'); binds.push(opts.entityId) }
  if (opts.type) { where.push('a.type = ?'); binds.push(opts.type) }

  const rows = await db
    .prepare(
      `SELECT a.*, u.name AS created_by_name
       FROM lead_activities a LEFT JOIN users u ON u.id = a.created_by
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, opts.offset)
    .all()

  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM lead_activities a WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ c: number }>()

  return { items: rows.results ?? [], total: total?.c ?? 0 }
}

/** Recent activity feed for the Command Center, with entity names resolved. */
export async function recentActivityFeed(db: D1Database, orgId: string, limit = 8) {
  const rows = await db
    .prepare(
      `SELECT a.id, a.entity_type, a.entity_id, a.type, a.description, a.created_at,
              u.name AS created_by_name,
              COALESCE(l.business_name, c.name, p.name) AS entity_name
       FROM lead_activities a
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN leads l ON a.entity_type = 'LEAD' AND l.id = a.entity_id
       LEFT JOIN clients c ON a.entity_type = 'CLIENT' AND c.id = a.entity_id
       LEFT JOIN projects p ON a.entity_type = 'PROJECT' AND p.id = a.entity_id
       WHERE a.org_id = ?
       ORDER BY a.created_at DESC, a.id DESC LIMIT ?`
    )
    .bind(orgId, limit)
    .all()
  return rows.results ?? []
}

/** Follow-ups that are due today or overdue. */
export async function dueFollowUps(db: D1Database, orgId: string, limit = 10) {
  const rows = await db
    .prepare(
      `SELECT a.id, a.entity_type, a.entity_id, a.type, a.description, a.due_at,
              COALESCE(l.business_name, c.name, p.name) AS entity_name
       FROM lead_activities a
       LEFT JOIN leads l ON a.entity_type = 'LEAD' AND l.id = a.entity_id
       LEFT JOIN clients c ON a.entity_type = 'CLIENT' AND c.id = a.entity_id
       LEFT JOIN projects p ON a.entity_type = 'PROJECT' AND p.id = a.entity_id
       WHERE a.org_id = ? AND a.due_at IS NOT NULL AND date(a.due_at) <= date('now')
       ORDER BY a.due_at ASC LIMIT ?`
    )
    .bind(orgId, limit)
    .all()
  return rows.results ?? []
}
