/**
 * Asset OS — reusable business assets (sites, components, prompts, demos...).
 */
import { newId } from '../lib/id'
import { notFound } from '../lib/http'

export interface AssetInput {
  name: string
  type?: string | null
  niche?: string | null
  description?: string | null
  version?: string | null
  status?: string | null
  preview_url?: string | null
  production_url?: string | null
  reusable?: boolean
  notes?: string | null
}

export async function listAssets(
  db: D1Database,
  orgId: string,
  opts: { q?: string | null; type?: string | null; status?: string | null; limit: number; offset: number }
) {
  const where = ['a.org_id = ?']
  const binds: unknown[] = [orgId]
  if (opts.type) { where.push('a.type = ?'); binds.push(opts.type) }
  if (opts.status) { where.push('a.status = ?'); binds.push(opts.status) }
  if (opts.q) {
    where.push('(a.name LIKE ? OR a.niche LIKE ? OR a.description LIKE ?)')
    const like = `%${opts.q}%`
    binds.push(like, like, like)
  }
  const rows = await db
    .prepare(
      `SELECT a.* FROM assets a WHERE ${where.join(' AND ')}
       ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, opts.offset)
    .all()
  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM assets a WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ c: number }>()
  return { items: rows.results ?? [], total: total?.c ?? 0 }
}

export async function getAsset(db: D1Database, orgId: string, id: string) {
  const row = await db
    .prepare(`SELECT * FROM assets WHERE id = ? AND org_id = ?`)
    .bind(id, orgId)
    .first()
  if (!row) throw notFound('Asset not found.')
  return row
}

export async function createAsset(
  db: D1Database,
  orgId: string,
  userId: string,
  input: AssetInput,
  isDemo = false
): Promise<string> {
  const id = newId('ast')
  const version = input.version || '1.0.0'
  await db
    .prepare(
      `INSERT INTO assets (id, org_id, name, type, niche, description, version, status,
                           preview_url, production_url, reusable, notes, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.name, input.type || 'OTHER', input.niche ?? null,
      input.description ?? null, version, input.status || 'DRAFT',
      input.preview_url ?? null, input.production_url ?? null,
      input.reusable === false ? 0 : 1, input.notes ?? null, isDemo ? 1 : 0
    )
    .run()

  await db
    .prepare(
      `INSERT INTO asset_versions (id, asset_id, version, changelog, created_by)
       VALUES (?, ?, ?, 'Initial version', ?)`
    )
    .bind(newId('asv'), id, version, userId)
    .run()

  return id
}

const UPDATABLE = [
  'name', 'type', 'niche', 'description', 'version', 'status',
  'preview_url', 'production_url', 'notes'
] as const

export async function updateAsset(
  db: D1Database,
  orgId: string,
  id: string,
  patch: Partial<AssetInput>,
  userId?: string
) {
  const before = (await getAsset(db, orgId, id)) as any
  const sets = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  for (const f of UPDATABLE) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); binds.push(patch[f]) }
  }
  if (patch.reusable !== undefined) { sets.push('reusable = ?'); binds.push(patch.reusable ? 1 : 0) }

  await db
    .prepare(`UPDATE assets SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`)
    .bind(...binds, id, orgId)
    .run()

  // Track version history when the version string changes.
  if (patch.version && patch.version !== before.version) {
    await db
      .prepare(
        `INSERT INTO asset_versions (id, asset_id, version, changelog, created_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(newId('asv'), id, patch.version, `Updated from ${before.version}`, userId ?? null)
      .run()
  }
  return getAsset(db, orgId, id)
}

export async function deleteAsset(db: D1Database, orgId: string, id: string) {
  await getAsset(db, orgId, id)
  await db.prepare(`DELETE FROM assets WHERE id = ? AND org_id = ?`).bind(id, orgId).run()
}

export async function assetVersions(db: D1Database, orgId: string, id: string) {
  await getAsset(db, orgId, id)
  const rows = await db
    .prepare(
      `SELECT v.version, v.changelog, v.created_at, u.name AS created_by_name
       FROM asset_versions v LEFT JOIN users u ON u.id = v.created_by
       WHERE v.asset_id = ? ORDER BY v.created_at DESC LIMIT 20`
    )
    .bind(id)
    .all()
  return rows.results ?? []
}

export async function assetUsage(db: D1Database, orgId: string, id: string) {
  const rows = await db
    .prepare(
      `SELECT entity_type, entity_id, revenue, notes, created_at
       FROM asset_usage WHERE org_id = ? AND asset_id = ?
       ORDER BY created_at DESC LIMIT 20`
    )
    .bind(orgId, id)
    .all()
  return rows.results ?? []
}

/** Record a usage event and roll up counters onto the asset. */
export async function recordAssetUsage(
  db: D1Database,
  orgId: string,
  assetId: string,
  input: { entity_type?: string | null; entity_id?: string | null; revenue?: number; notes?: string | null }
) {
  await getAsset(db, orgId, assetId)
  await db
    .prepare(
      `INSERT INTO asset_usage (id, org_id, asset_id, entity_type, entity_id, revenue, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      newId('asu'), orgId, assetId, input.entity_type ?? null, input.entity_id ?? null,
      input.revenue ?? 0, input.notes ?? null
    )
    .run()
  await db
    .prepare(
      `UPDATE assets SET usage_count = usage_count + 1,
                         revenue_attributed = revenue_attributed + ?,
                         updated_at = datetime('now')
       WHERE id = ? AND org_id = ?`
    )
    .bind(input.revenue ?? 0, assetId, orgId)
    .run()
  return getAsset(db, orgId, assetId)
}
