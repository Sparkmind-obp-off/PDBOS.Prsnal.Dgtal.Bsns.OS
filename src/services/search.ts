/**
 * Global search — real SQL queries against D1, org-scoped.
 * Permission-aware: an entity type is only queried when the user can read it.
 *
 * IMPLEMENTATION NOTE
 * -------------------
 * The first implementation merged every entity query into one big
 * `UNION ALL` compound SELECT. That fails on D1/SQLite in two ways:
 *   1. `(SELECT ...) UNION ALL (SELECT ...)` — parentheses around compound
 *      arms are a syntax error in SQLite.
 *   2. Even without parentheses, SQLite's `SQLITE_MAX_COMPOUND_SELECT`
 *      limit (D1 enforces a low ceiling) raises
 *      "too many terms in compound SELECT".
 *
 * So each entity is queried as its own prepared statement and dispatched in a
 * single `db.batch()` round-trip; ranking/merging/limiting happens in JS.
 * This is also cheaper than a UNION because each arm keeps using its own index.
 */
import type { SessionUser } from '../types'
import { hasPermission } from './rbac'

export interface SearchHit {
  entity_type: string
  id: string
  name: string
  status: string | null
  subtitle: string | null
}

interface EntityQuery {
  entity_type: string
  sql: string
  binds: unknown[]
}

export async function globalSearch(
  db: D1Database,
  user: SessionUser,
  q: string,
  limit = 20
): Promise<SearchHit[]> {
  const like = `%${q}%`
  const perEntityLimit = Math.min(Math.max(limit, 5), 50)
  const queries: EntityQuery[] = []

  if (hasPermission(user, 'lead.read')) {
    queries.push({
      entity_type: 'LEAD',
      sql: `SELECT id, business_name AS name, status,
                   COALESCE(city, category, '') AS subtitle
            FROM leads
            WHERE org_id = ? AND archived_at IS NULL
              AND (business_name LIKE ? OR city LIKE ? OR phone LIKE ? OR email LIKE ?)
            ORDER BY updated_at DESC LIMIT ?`,
      binds: [user.org_id, like, like, like, like, perEntityLimit]
    })
  }
  if (hasPermission(user, 'client.read')) {
    queries.push({
      entity_type: 'CLIENT',
      sql: `SELECT id, name, status, COALESCE(city, industry, '') AS subtitle
            FROM clients
            WHERE org_id = ? AND (name LIKE ? OR city LIKE ? OR email LIKE ?)
            ORDER BY updated_at DESC LIMIT ?`,
      binds: [user.org_id, like, like, like, perEntityLimit]
    })
  }
  if (hasPermission(user, 'project.read')) {
    queries.push({
      entity_type: 'PROJECT',
      sql: `SELECT id, name, status, COALESCE(type, '') AS subtitle
            FROM projects
            WHERE org_id = ? AND (name LIKE ? OR type LIKE ?)
            ORDER BY updated_at DESC LIMIT ?`,
      binds: [user.org_id, like, like, perEntityLimit]
    })
  }
  if (hasPermission(user, 'asset.read')) {
    queries.push({
      entity_type: 'ASSET',
      sql: `SELECT id, name, status, COALESCE(niche, type, '') AS subtitle
            FROM assets
            WHERE org_id = ? AND (name LIKE ? OR niche LIKE ? OR description LIKE ?)
            ORDER BY updated_at DESC LIMIT ?`,
      binds: [user.org_id, like, like, like, perEntityLimit]
    })
  }
  if (hasPermission(user, 'resource.read')) {
    queries.push({
      entity_type: 'RESOURCE',
      sql: `SELECT id, name, status, COALESCE(provider, type, '') AS subtitle
            FROM resources
            WHERE org_id = ? AND (name LIKE ? OR provider LIKE ? OR capability LIKE ?)
            ORDER BY updated_at DESC LIMIT ?`,
      binds: [user.org_id, like, like, like, perEntityLimit]
    })
  }
  if (hasPermission(user, 'sales.read')) {
    queries.push({
      entity_type: 'OFFER',
      sql: `SELECT id, title AS name, status, COALESCE(package, '') AS subtitle
            FROM offers
            WHERE org_id = ? AND (title LIKE ? OR package LIKE ?)
            ORDER BY updated_at DESC LIMIT ?`,
      binds: [user.org_id, like, like, perEntityLimit]
    })
    queries.push({
      entity_type: 'OPPORTUNITY',
      sql: `SELECT id, title AS name, stage AS status, '' AS subtitle
            FROM opportunities
            WHERE org_id = ? AND title LIKE ?
            ORDER BY updated_at DESC LIMIT ?`,
      binds: [user.org_id, like, perEntityLimit]
    })
  }

  if (!queries.length) return []

  const statements = queries.map((entry) => db.prepare(entry.sql).bind(...entry.binds))
  const batch = await db.batch<Omit<SearchHit, 'entity_type'>>(statements)

  const needle = q.toLowerCase()
  const hits: SearchHit[] = []
  batch.forEach((result, index) => {
    const entity_type = queries[index].entity_type
    for (const row of result.results ?? []) {
      hits.push({
        entity_type,
        id: row.id,
        name: row.name,
        status: row.status ?? null,
        subtitle: row.subtitle ?? null
      })
    }
  })

  // Rank: exact match first, then prefix match, then substring; ties by name.
  const rank = (hit: SearchHit): number => {
    const name = (hit.name ?? '').toLowerCase()
    if (name === needle) return 0
    if (name.startsWith(needle)) return 1
    if (name.includes(needle)) return 2
    return 3
  }

  return hits
    .sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? ''))
    .slice(0, limit)
}
