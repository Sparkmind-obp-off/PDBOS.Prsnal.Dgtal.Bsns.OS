/**
 * Lead Engine — data access + business rules.
 * All queries are org-scoped and paginated server-side.
 */
import { newId } from '../lib/id'
import { notFound, conflict } from '../lib/http'
import { dedupeKey } from '../lib/validate'
import { scoreLead, suggestPriority } from './ai'

export interface LeadInput {
  business_name: string
  category?: string | null
  industry?: string | null
  address?: string | null
  city?: string | null
  website?: string | null
  phone?: string | null
  email?: string | null
  social_url?: string | null
  source_key?: string | null
  external_ref?: string | null
  status?: string | null
  priority?: string | null
  notes?: string | null
}

export interface LeadListQuery {
  q?: string | null
  status?: string | null
  priority?: string | null
  city?: string | null
  source?: string | null
  includeArchived?: boolean
  sort?: string | null
  limit: number
  offset: number
}

export async function listLeads(db: D1Database, orgId: string, q: LeadListQuery) {
  const where: string[] = ['l.org_id = ?']
  const binds: unknown[] = [orgId]

  if (!q.includeArchived) where.push('l.archived_at IS NULL')
  if (q.status) { where.push('l.status = ?'); binds.push(q.status) }
  if (q.priority) { where.push('l.priority = ?'); binds.push(q.priority) }
  if (q.city) { where.push('l.city = ?'); binds.push(q.city) }
  if (q.source) { where.push('l.source_key = ?'); binds.push(q.source) }
  if (q.q) {
    where.push('(l.business_name LIKE ? OR l.city LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.category LIKE ?)')
    const like = `%${q.q}%`
    binds.push(like, like, like, like, like)
  }

  const sortMap: Record<string, string> = {
    newest: 'l.created_at DESC',
    oldest: 'l.created_at ASC',
    score: 'l.score DESC',
    name: 'l.business_name ASC',
    updated: 'l.updated_at DESC'
  }
  const orderBy = sortMap[q.sort || 'newest'] || sortMap.newest

  const sql = `SELECT l.*, (SELECT COUNT(*) FROM lead_activities a
                            WHERE a.entity_type = 'LEAD' AND a.entity_id = l.id) AS activity_count
               FROM leads l WHERE ${where.join(' AND ')}
               ORDER BY ${orderBy}, l.id DESC LIMIT ? OFFSET ?`

  const rows = await db.prepare(sql).bind(...binds, q.limit, q.offset).all()
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM leads l WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ c: number }>()

  return { items: rows.results ?? [], total: totalRow?.c ?? 0 }
}

export async function getLead(db: D1Database, orgId: string, id: string) {
  const lead = await db
    .prepare(`SELECT * FROM leads WHERE id = ? AND org_id = ?`)
    .bind(id, orgId)
    .first()
  if (!lead) throw notFound('Lead not found.')
  return lead
}

export async function createLead(
  db: D1Database,
  orgId: string,
  userId: string,
  input: LeadInput,
  opts: { isDemo?: boolean; skipOnDuplicate?: boolean } = {}
): Promise<{ id: string; duplicate: boolean }> {
  const key = dedupeKey(input.business_name, input.city)
  const existing = await db
    .prepare(`SELECT id FROM leads WHERE org_id = ? AND dedupe_key = ?`)
    .bind(orgId, key)
    .first<{ id: string }>()

  if (existing) {
    if (opts.skipOnDuplicate) return { id: existing.id, duplicate: true }
    throw conflict('A lead with this business name and city already exists.')
  }

  const id = newId('led')
  const scored = scoreLead({
    website: input.website, phone: input.phone, email: input.email,
    social_url: input.social_url, city: input.city,
    industry: input.industry, category: input.category,
    status: input.status ?? 'NEW', activity_count: 0
  })
  const priority = input.priority || suggestPriority(scored.score)

  await db
    .prepare(
      `INSERT INTO leads (id, org_id, business_name, category, industry, address, city, website,
                          phone, email, social_url, source_key, external_ref, dedupe_key,
                          status, priority, score, owner_id, notes, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.business_name, input.category ?? null, input.industry ?? null,
      input.address ?? null, input.city ?? null, input.website ?? null, input.phone ?? null,
      input.email ?? null, input.social_url ?? null, input.source_key || 'MANUAL',
      input.external_ref ?? null, key, input.status || 'NEW', priority, scored.score,
      userId, input.notes ?? null, opts.isDemo ? 1 : 0
    )
    .run()

  await db
    .prepare(
      `INSERT INTO lead_scores (id, org_id, lead_id, score, breakdown, computed_by)
       VALUES (?, ?, ?, ?, ?, 'RULE')`
    )
    .bind(newId('lsc'), orgId, id, scored.score, JSON.stringify(scored.breakdown))
    .run()

  return { id, duplicate: false }
}

const UPDATABLE = [
  'business_name', 'category', 'industry', 'address', 'city', 'website',
  'phone', 'email', 'social_url', 'status', 'priority', 'notes'
] as const

export async function updateLead(
  db: D1Database,
  orgId: string,
  id: string,
  patch: Partial<LeadInput>
) {
  await getLead(db, orgId, id)
  const sets: string[] = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  for (const field of UPDATABLE) {
    if (patch[field] !== undefined) {
      sets.push(`${field} = ?`)
      binds.push(patch[field])
    }
  }
  if (patch.business_name !== undefined || patch.city !== undefined) {
    const cur = await getLead(db, orgId, id) as any
    sets.push('dedupe_key = ?')
    binds.push(dedupeKey(patch.business_name ?? cur.business_name, patch.city ?? cur.city))
  }
  await db
    .prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`)
    .bind(...binds, id, orgId)
    .run()
  return getLead(db, orgId, id)
}

/** Recompute the rule-based score from current lead data + activity count. */
export async function rescoreLead(db: D1Database, orgId: string, id: string) {
  const lead = (await getLead(db, orgId, id)) as any
  const actRow = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM lead_activities WHERE org_id = ? AND entity_type = 'LEAD' AND entity_id = ?`
    )
    .bind(orgId, id)
    .first<{ c: number }>()

  const scored = scoreLead({
    website: lead.website, phone: lead.phone, email: lead.email,
    social_url: lead.social_url, city: lead.city, industry: lead.industry,
    category: lead.category, status: lead.status, activity_count: actRow?.c ?? 0
  })

  await db
    .prepare(`UPDATE leads SET score = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?`)
    .bind(scored.score, id, orgId)
    .run()
  await db
    .prepare(
      `INSERT INTO lead_scores (id, org_id, lead_id, score, breakdown, computed_by)
       VALUES (?, ?, ?, ?, ?, 'RULE')`
    )
    .bind(newId('lsc'), orgId, id, scored.score, JSON.stringify(scored.breakdown))
    .run()

  return { score: scored.score, breakdown: scored.breakdown, suggested_priority: suggestPriority(scored.score) }
}

export async function archiveLead(db: D1Database, orgId: string, id: string) {
  await getLead(db, orgId, id)
  await db
    .prepare(`UPDATE leads SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND org_id = ?`)
    .bind(id, orgId)
    .run()
}

export async function restoreLead(db: D1Database, orgId: string, id: string) {
  await db
    .prepare(`UPDATE leads SET archived_at = NULL, updated_at = datetime('now') WHERE id = ? AND org_id = ?`)
    .bind(id, orgId)
    .run()
}

export async function deleteLead(db: D1Database, orgId: string, id: string) {
  await getLead(db, orgId, id)
  await db.prepare(`DELETE FROM leads WHERE id = ? AND org_id = ?`).bind(id, orgId).run()
}

export async function leadPipelineCounts(db: D1Database, orgId: string) {
  const rows = await db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM leads
       WHERE org_id = ? AND archived_at IS NULL GROUP BY status`
    )
    .bind(orgId)
    .all<{ status: string; count: number }>()
  return rows.results ?? []
}

export async function leadScoreHistory(db: D1Database, orgId: string, leadId: string) {
  const rows = await db
    .prepare(
      `SELECT score, breakdown, computed_by, created_at FROM lead_scores
       WHERE org_id = ? AND lead_id = ? ORDER BY created_at DESC LIMIT 10`
    )
    .bind(orgId, leadId)
    .all()
  return rows.results ?? []
}
