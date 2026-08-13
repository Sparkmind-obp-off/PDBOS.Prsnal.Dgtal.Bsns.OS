/**
 * /api/resources — Resource OS endpoints.
 */
import { Hono } from 'hono'
import { ok, okList, jsonBody } from '../lib/http'
import { str, num, oneOf, pagination } from '../lib/validate'
import { requireAuth, requirePermission } from '../middleware/auth'
import {
  listResources, getResource, createResource, updateResource,
  deleteResource, resourceCostSummary
} from '../services/resources'
import { writeAudit } from '../services/audit'
import { RESOURCE_TYPES, RESOURCE_STATUSES, RESOURCE_COST_TYPES } from '../types'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

app.get('/', requirePermission('resource.read'), async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, perPage, offset } = pagination(q)
  const { items, total } = await listResources(c.env.DB, user.org_id, {
    q: q.q || null,
    type: q.type ? q.type.toUpperCase() : null,
    status: q.status ? q.status.toUpperCase() : null,
    limit: perPage,
    offset
  })
  const summary = await resourceCostSummary(c.env.DB, user.org_id)
  return okList(c, items, { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage), summary })
})

app.get('/:id', requirePermission('resource.read'), async (c) => {
  const user = c.get('user')
  return ok(c, await getResource(c.env.DB, user.org_id, c.req.param('id')))
})

function parseBody(body: Record<string, unknown>, requireName: boolean) {
  return {
    name: str(body, 'name', { required: requireName, max: 160 }) ?? undefined,
    provider: body.provider !== undefined ? str(body, 'provider', { max: 160 }) : undefined,
    type: body.type !== undefined ? oneOf(body, 'type', RESOURCE_TYPES, { required: true }) : undefined,
    description: body.description !== undefined ? str(body, 'description', { max: 2000 }) : undefined,
    capability: body.capability !== undefined ? str(body, 'capability', { max: 500 }) : undefined,
    status: body.status !== undefined ? oneOf(body, 'status', RESOURCE_STATUSES, { required: true }) : undefined,
    cost_type: body.cost_type !== undefined ? oneOf(body, 'cost_type', RESOURCE_COST_TYPES, { required: true }) : undefined,
    monthly_cost: body.monthly_cost !== undefined ? num(body, 'monthly_cost', { min: 0 }) : undefined,
    usage_limit: body.usage_limit !== undefined ? str(body, 'usage_limit', { max: 200 }) : undefined,
    notes: body.notes !== undefined ? str(body, 'notes', { max: 4000 }) : undefined
  }
}

app.post('/', requirePermission('resource.manage'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const input = parseBody(body, true) as any
  const id = await createResource(c.env.DB, user.org_id, input)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'resource', entityId: id,
    metadata: { name: input.name }
  })
  return ok(c, await getResource(c.env.DB, user.org_id, id), 201)
})

app.patch('/:id', requirePermission('resource.manage'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const patch = parseBody(body, false)
  const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const row = await updateResource(c.env.DB, user.org_id, id, cleaned as any)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'resource', entityId: id,
    metadata: { fields: Object.keys(cleaned) }
  })
  return ok(c, row)
})

app.delete('/:id', requirePermission('resource.manage'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await deleteResource(c.env.DB, user.org_id, id)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'DELETE', entity: 'resource', entityId: id
  })
  return ok(c, { deleted: true })
})

export default app
