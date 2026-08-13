/**
 * /api/assets — Asset OS endpoints.
 */
import { Hono } from 'hono'
import { ok, okList, jsonBody } from '../lib/http'
import { str, num, bool, oneOf, pagination } from '../lib/validate'
import { requireAuth, requirePermission } from '../middleware/auth'
import {
  listAssets, getAsset, createAsset, updateAsset, deleteAsset,
  assetVersions, assetUsage, recordAssetUsage
} from '../services/assets'
import { listActivities } from '../services/activities'
import { writeAudit } from '../services/audit'
import { ASSET_TYPES, ASSET_STATUSES } from '../types'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

app.get('/', requirePermission('asset.read'), async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, perPage, offset } = pagination(q)
  const { items, total } = await listAssets(c.env.DB, user.org_id, {
    q: q.q || null,
    type: q.type ? q.type.toUpperCase() : null,
    status: q.status ? q.status.toUpperCase() : null,
    limit: perPage,
    offset
  })
  return okList(c, items, { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) })
})

app.get('/:id', requirePermission('asset.read'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const asset = await getAsset(c.env.DB, user.org_id, id)
  const [versions, usage, activities] = await Promise.all([
    assetVersions(c.env.DB, user.org_id, id),
    assetUsage(c.env.DB, user.org_id, id),
    listActivities(c.env.DB, user.org_id, { entityType: 'ASSET', entityId: id, limit: 20, offset: 0 })
  ])
  return ok(c, { asset, versions, usage, activities: activities.items })
})

function parseBody(body: Record<string, unknown>, requireName: boolean) {
  return {
    name: str(body, 'name', { required: requireName, max: 160 }) ?? undefined,
    type: body.type !== undefined ? oneOf(body, 'type', ASSET_TYPES, { required: true }) : undefined,
    niche: body.niche !== undefined ? str(body, 'niche', { max: 120 }) : undefined,
    description: body.description !== undefined ? str(body, 'description', { max: 2000 }) : undefined,
    version: body.version !== undefined ? str(body, 'version', { max: 40 }) : undefined,
    status: body.status !== undefined ? oneOf(body, 'status', ASSET_STATUSES, { required: true }) : undefined,
    preview_url: body.preview_url !== undefined ? str(body, 'preview_url', { max: 500 }) : undefined,
    production_url: body.production_url !== undefined ? str(body, 'production_url', { max: 500 }) : undefined,
    reusable: body.reusable !== undefined ? bool(body, 'reusable', true) : undefined,
    notes: body.notes !== undefined ? str(body, 'notes', { max: 4000 }) : undefined
  }
}

app.post('/', requirePermission('asset.manage'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const input = parseBody(body, true) as any
  const id = await createAsset(c.env.DB, user.org_id, user.id, input)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'asset', entityId: id,
    metadata: { name: input.name, type: input.type }
  })
  return ok(c, await getAsset(c.env.DB, user.org_id, id), 201)
})

app.patch('/:id', requirePermission('asset.manage'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const patch = parseBody(body, false)
  const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const row = await updateAsset(c.env.DB, user.org_id, id, cleaned as any, user.id)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'asset', entityId: id,
    metadata: { fields: Object.keys(cleaned) }
  })
  return ok(c, row)
})

app.post('/:id/usage', requirePermission('asset.manage'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const row = await recordAssetUsage(c.env.DB, user.org_id, id, {
    entity_type: str(body, 'entity_type', { max: 40 }),
    entity_id: str(body, 'entity_id', { max: 60 }),
    revenue: num(body, 'revenue', { min: 0, default: 0 })!,
    notes: str(body, 'notes', { max: 1000 })
  })
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'asset', entityId: id,
    metadata: { usage_recorded: true }
  })
  return ok(c, row, 201)
})

app.delete('/:id', requirePermission('asset.manage'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await deleteAsset(c.env.DB, user.org_id, id)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'DELETE', entity: 'asset', entityId: id
  })
  return ok(c, { deleted: true })
})

export default app
