/**
 * /api/activities — activity timeline endpoints.
 */
import { Hono } from 'hono'
import { ok, okList, jsonBody } from '../lib/http'
import { str, oneOf, pagination } from '../lib/validate'
import { requireAuth, requirePermission } from '../middleware/auth'
import { createActivity, listActivities, dueFollowUps } from '../services/activities'
import { rescoreLead } from '../services/leads'
import { writeAudit, writeEvent } from '../services/audit'
import { ACTIVITY_TYPES, ACTIVITY_ENTITIES } from '../types'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

app.get('/', requirePermission('activity.read'), async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, perPage, offset } = pagination(q)
  const { items, total } = await listActivities(c.env.DB, user.org_id, {
    entityType: q.entity_type ? q.entity_type.toUpperCase() : null,
    entityId: q.entity_id || null,
    type: q.type ? q.type.toUpperCase() : null,
    limit: perPage,
    offset
  })
  return okList(c, items, { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) })
})

app.get('/due', requirePermission('activity.read'), async (c) => {
  const user = c.get('user')
  return ok(c, await dueFollowUps(c.env.DB, user.org_id, 20))
})

app.post('/', requirePermission('activity.create'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const input = {
    entity_type: oneOf(body, 'entity_type', ACTIVITY_ENTITIES, { required: true })!,
    entity_id: str(body, 'entity_id', { required: true, max: 60 })!,
    type: oneOf(body, 'type', ACTIVITY_TYPES, { default: 'NOTE' })!,
    description: str(body, 'description', { required: true, max: 4000 })!,
    outcome: str(body, 'outcome', { max: 500 }),
    due_at: str(body, 'due_at', { max: 40 })
  }
  const id = await createActivity(c.env.DB, user.org_id, user.id, input)

  // Engagement affects the lead score — recompute so the data stays truthful.
  if (input.entity_type === 'LEAD') {
    try { await rescoreLead(c.env.DB, user.org_id, input.entity_id) } catch { /* lead may be gone */ }
  }

  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'activity', entityId: id,
    metadata: { entity_type: input.entity_type, entity_id: input.entity_id, type: input.type }
  })
  await writeEvent(c.env.DB, user.org_id, user.id, 'activity.created', input.entity_type, input.entity_id)
  return ok(c, { id }, 201)
})

export default app
