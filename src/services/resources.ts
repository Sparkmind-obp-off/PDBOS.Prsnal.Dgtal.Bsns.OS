/**
 * Resource OS — tools, APIs, platforms, accounts, AI models the business owns.
 */
import { newId } from '../lib/id'
import { notFound } from '../lib/http'

export interface ResourceInput {
  name: string
  provider?: string | null
  type?: string | null
  description?: string | null
  capability?: string | null
  status?: string | null
  cost_type?: string | null
  monthly_cost?: number | null
  usage_limit?: string | null
  notes?: string | null
}

export async function listResources(
  db: D1Database,
  orgId: string,
  opts: { q?: string | null; type?: string | null; status?: string | null; limit: number; offset: number }
) {
  const where = ['r.org_id = ?']
  const binds: unknown[] = [orgId]
  if (opts.type) { where.push('r.type = ?'); binds.push(opts.type) }
  if (opts.status) { where.push('r.status = ?'); binds.push(opts.status) }
  if (opts.q) {
    where.push('(r.name LIKE ? OR r.provider LIKE ? OR r.capability LIKE ?)')
    const like = `%${opts.q}%`
    binds.push(like, like, like)
  }
  const rows = await db
    .prepare(
      `SELECT r.* FROM resources r WHERE ${where.join(' AND ')}
       ORDER BY r.status ASC, r.name ASC LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, opts.offset)
    .all()
  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM resources r WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ c: number }>()
  return { items: rows.results ?? [], total: total?.c ?? 0 }
}

export async function getResource(db: D1Database, orgId: string, id: string) {
  const row = await db
    .prepare(`SELECT * FROM resources WHERE id = ? AND org_id = ?`)
    .bind(id, orgId)
    .first()
  if (!row) throw notFound('Resource not found.')
  return row
}

export async function createResource(
  db: D1Database,
  orgId: string,
  input: ResourceInput,
  isDemo = false
): Promise<string> {
  const id = newId('res')
  await db
    .prepare(
      `INSERT INTO resources (id, org_id, name, provider, type, description, capability, status,
                              cost_type, monthly_cost, usage_limit, notes, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.name, input.provider ?? null, input.type || 'OTHER',
      input.description ?? null, input.capability ?? null, input.status || 'ACTIVE',
      input.cost_type || 'FREE', input.monthly_cost ?? 0, input.usage_limit ?? null,
      input.notes ?? null, isDemo ? 1 : 0
    )
    .run()
  return id
}

const UPDATABLE = [
  'name', 'provider', 'type', 'description', 'capability', 'status',
  'cost_type', 'monthly_cost', 'usage_limit', 'notes'
] as const

export async function updateResource(
  db: D1Database,
  orgId: string,
  id: string,
  patch: Partial<ResourceInput>
) {
  await getResource(db, orgId, id)
  const sets = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  for (const f of UPDATABLE) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); binds.push(patch[f]) }
  }
  await db
    .prepare(`UPDATE resources SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`)
    .bind(...binds, id, orgId)
    .run()
  return getResource(db, orgId, id)
}

export async function deleteResource(db: D1Database, orgId: string, id: string) {
  await getResource(db, orgId, id)
  await db.prepare(`DELETE FROM resources WHERE id = ? AND org_id = ?`).bind(id, orgId).run()
}

export async function resourceCostSummary(db: D1Database, orgId: string) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
              COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN monthly_cost ELSE 0 END), 0) AS monthly_cost
       FROM resources WHERE org_id = ?`
    )
    .bind(orgId)
    .first<{ total: number; active: number; monthly_cost: number }>()
  return row ?? { total: 0, active: 0, monthly_cost: 0 }
}
