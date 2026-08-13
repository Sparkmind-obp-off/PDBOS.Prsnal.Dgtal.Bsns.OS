/**
 * /api/leads — Lead Engine endpoints.
 */
import { Hono } from 'hono'
import { ok, okList, jsonBody } from '../lib/http'
import { str, oneOf, pagination } from '../lib/validate'
import { requireAuth, requirePermission } from '../middleware/auth'
import {
  listLeads, getLead, createLead, updateLead, archiveLead, restoreLead,
  deleteLead, rescoreLead, leadPipelineCounts, leadScoreHistory
} from '../services/leads'
import { listActivities } from '../services/activities'
import { writeAudit, writeEvent } from '../services/audit'
import { notify } from '../services/notifications'
import { LEAD_STATUSES, LEAD_PRIORITIES } from '../types'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

app.get('/', requirePermission('lead.read'), async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, perPage, offset } = pagination(q)
  const { items, total } = await listLeads(c.env.DB, user.org_id, {
    q: q.q || null,
    status: q.status ? q.status.toUpperCase() : null,
    priority: q.priority ? q.priority.toUpperCase() : null,
    city: q.city || null,
    source: q.source || null,
    includeArchived: q.include_archived === 'true',
    sort: q.sort || null,
    limit: perPage,
    offset
  })
  return okList(c, items, { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) })
})

app.get('/pipeline', requirePermission('lead.read'), async (c) => {
  const user = c.get('user')
  return ok(c, await leadPipelineCounts(c.env.DB, user.org_id))
})

app.get('/:id', requirePermission('lead.read'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const lead = await getLead(c.env.DB, user.org_id, id)
  const activities = await listActivities(c.env.DB, user.org_id, {
    entityType: 'LEAD', entityId: id, limit: 50, offset: 0
  })
  const scores = await leadScoreHistory(c.env.DB, user.org_id, id)
  return ok(c, { lead, activities: activities.items, score_history: scores })
})

app.post('/', requirePermission('lead.create'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const input = {
    business_name: str(body, 'business_name', { required: true, max: 200 })!,
    category: str(body, 'category', { max: 120 }),
    industry: str(body, 'industry', { max: 120 }),
    address: str(body, 'address', { max: 400 }),
    city: str(body, 'city', { max: 120 }),
    website: str(body, 'website', { max: 300 }),
    phone: str(body, 'phone', { max: 60 }),
    email: str(body, 'email', { max: 254 }),
    social_url: str(body, 'social_url', { max: 300 }),
    source_key: str(body, 'source_key', { max: 40 }) || 'MANUAL',
    status: oneOf(body, 'status', LEAD_STATUSES, { default: 'NEW' }),
    priority: oneOf(body, 'priority', LEAD_PRIORITIES),
    notes: str(body, 'notes', { max: 4000 })
  }
  const { id } = await createLead(c.env.DB, user.org_id, user.id, input)
  const lead = await getLead(c.env.DB, user.org_id, id)

  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'lead', entityId: id,
    metadata: { business_name: input.business_name }
  })
  await writeEvent(c.env.DB, user.org_id, user.id, 'lead.created', 'LEAD', id)
  if ((lead as any).priority === 'HOT') {
    await notify(c.env.DB, user.org_id, {
      userId: user.id, type: 'REMINDER', severity: 'HIGH',
      title: 'New HOT lead',
      message: `${input.business_name} scored ${(lead as any).score}. Contact them today.`,
      entityType: 'LEAD', entityId: id
    })
  }
  return ok(c, lead, 201)
})

app.patch('/:id', requirePermission('lead.update'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const before = (await getLead(c.env.DB, user.org_id, id)) as any

  const patch: Record<string, unknown> = {}
  const fields = ['business_name', 'category', 'industry', 'address', 'city', 'website', 'phone', 'email', 'social_url', 'notes'] as const
  for (const f of fields) if (body[f] !== undefined) patch[f] = str(body, f, { max: 4000 })
  if (body.status !== undefined) patch.status = oneOf(body, 'status', LEAD_STATUSES, { required: true })
  if (body.priority !== undefined) patch.priority = oneOf(body, 'priority', LEAD_PRIORITIES, { required: true })

  const lead = await updateLead(c.env.DB, user.org_id, id, patch)

  const statusChanged = patch.status && patch.status !== before.status
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id,
    action: statusChanged ? 'STATUS_CHANGE' : 'UPDATE',
    entity: 'lead', entityId: id,
    metadata: statusChanged ? { from: before.status, to: patch.status } : { fields: Object.keys(patch) }
  })
  await writeEvent(c.env.DB, user.org_id, user.id, statusChanged ? 'lead.status_changed' : 'lead.updated', 'LEAD', id)
  return ok(c, lead)
})

app.post('/:id/rescore', requirePermission('lead.update'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await rescoreLead(c.env.DB, user.org_id, id)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'lead', entityId: id,
    metadata: { rescored: result.score }
  })
  return ok(c, result)
})

app.post('/:id/archive', requirePermission('lead.delete'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await archiveLead(c.env.DB, user.org_id, id)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'STATUS_CHANGE', entity: 'lead', entityId: id,
    metadata: { archived: true }
  })
  return ok(c, { archived: true })
})

app.post('/:id/restore', requirePermission('lead.update'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await restoreLead(c.env.DB, user.org_id, id)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'STATUS_CHANGE', entity: 'lead', entityId: id,
    metadata: { archived: false }
  })
  return ok(c, { restored: true })
})

app.delete('/:id', requirePermission('lead.delete'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await deleteLead(c.env.DB, user.org_id, id)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'DELETE', entity: 'lead', entityId: id
  })
  return ok(c, { deleted: true })
})

export default app
