/**
 * /api — dashboard, search, notifications, settings, audit, AI, seed.
 */
import { Hono } from 'hono'
import { ok, okList, badRequest, jsonBody } from '../lib/http'
import { str, pagination } from '../lib/validate'
import { requireAuth, requirePermission } from '../middleware/auth'
import { commandCenter } from '../services/dashboard'
import { globalSearch } from '../services/search'
import { listNotifications, markRead, markAllRead } from '../services/notifications'
import { getSettings, updateOrgSettings, updateUserSettings } from '../services/settings'
import { listAudit, writeAudit } from '../services/audit'
import { runAiOperation, listAiJobs, aiProviderStatus } from '../services/ai'
import { seedDemoData, purgeDemoData, demoDataStatus } from '../services/seed'
import { AI_OPERATIONS } from '../types'
import type { AppEnv, AiOperation } from '../types'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

/* ---------------------------- DASHBOARD ---------------------------- */

app.get('/dashboard', async (c) => {
  const user = c.get('user')
  return ok(c, await commandCenter(c.env.DB, user.org_id))
})

/* ------------------------------ SEARCH ------------------------------ */

app.get('/search', async (c) => {
  const user = c.get('user')
  const q = (c.req.query('q') || '').trim()
  if (q.length < 2) return okList(c, [], { query: q, note: 'Enter at least 2 characters.' })
  const hits = await globalSearch(c.env.DB, user, q, 25)
  return okList(c, hits, { query: q, count: hits.length })
})

/* -------------------------- NOTIFICATIONS -------------------------- */

app.get('/notifications', async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, perPage, offset } = pagination(q)
  const { items, unread } = await listNotifications(c.env.DB, user.org_id, user.id, {
    unreadOnly: q.unread === 'true', limit: perPage, offset
  })
  return okList(c, items, { page, per_page: perPage, unread })
})

app.post('/notifications/:id/read', async (c) => {
  const user = c.get('user')
  await markRead(c.env.DB, user.org_id, user.id, c.req.param('id'))
  return ok(c, { read: true })
})

app.post('/notifications/read-all', async (c) => {
  const user = c.get('user')
  await markAllRead(c.env.DB, user.org_id, user.id)
  return ok(c, { read: true })
})

/* ----------------------------- SETTINGS ----------------------------- */

app.get('/settings', async (c) => {
  const user = c.get('user')
  return ok(c, await getSettings(c.env.DB, user.org_id, user.id))
})

app.patch('/settings/org', requirePermission('settings.manage'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  if (!Object.keys(body).length) throw badRequest('No settings provided.')
  await updateOrgSettings(c.env.DB, user.org_id, body)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'SETTINGS_CHANGE', entity: 'organization',
    entityId: user.org_id, metadata: { keys: Object.keys(body) }
  })
  return ok(c, await getSettings(c.env.DB, user.org_id, user.id))
})

app.patch('/settings/user', async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  if (!Object.keys(body).length) throw badRequest('No settings provided.')
  await updateUserSettings(c.env.DB, user.org_id, user.id, body)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'SETTINGS_CHANGE', entity: 'user',
    entityId: user.id, metadata: { keys: Object.keys(body) }
  })
  return ok(c, await getSettings(c.env.DB, user.org_id, user.id))
})

/* ------------------------------ AUDIT ------------------------------ */

app.get('/audit', requirePermission('audit.read'), async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, perPage, offset } = pagination(q)
  const { items, total } = await listAudit(c.env.DB, user.org_id, {
    limit: perPage, offset, action: q.action ? q.action.toUpperCase() : null
  })
  return okList(c, items, { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) })
})

/* -------------------------------- AI -------------------------------- */

app.get('/ai/status', requirePermission('ai.read'), (c) => {
  return ok(c, aiProviderStatus(c.env))
})

app.get('/ai/jobs', requirePermission('ai.read'), async (c) => {
  const user = c.get('user')
  return ok(c, await listAiJobs(c.env.DB, user.org_id, 20))
})

app.post('/ai/run', requirePermission('ai.run'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const operation = str(body, 'operation', { required: true, max: 40 })!.toLowerCase()
  if (!AI_OPERATIONS.includes(operation as AiOperation)) {
    throw badRequest(`Unknown AI operation. Allowed: ${AI_OPERATIONS.join(', ')}.`)
  }
  const input = (body.input && typeof body.input === 'object' ? body.input : {}) as Record<string, unknown>
  const result = await runAiOperation(c.env.DB, c.env, user.org_id, user.id, {
    operation: operation as AiOperation,
    input,
    entityType: str(body, 'entity_type', { max: 40 }),
    entityId: str(body, 'entity_id', { max: 60 })
  })
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'AI_RUN', entity: 'ai_job', entityId: result.job_id,
    metadata: { operation, engine: result.engine, status: result.status }
  })
  return ok(c, result)
})

/* ---------------------------- DEMO DATA ---------------------------- */

app.get('/demo-data', async (c) => {
  const user = c.get('user')
  return ok(c, await demoDataStatus(c.env.DB, user.org_id))
})

app.post('/demo-data/seed', requirePermission('settings.manage'), async (c) => {
  const user = c.get('user')
  const result = await seedDemoData(c.env.DB, user.org_id, user.id)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'demo_data',
    metadata: result as unknown as Record<string, unknown>
  })
  return ok(c, result, 201)
})

app.post('/demo-data/purge', requirePermission('settings.manage'), async (c) => {
  const user = c.get('user')
  const result = await purgeDemoData(c.env.DB, user.org_id)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'DELETE', entity: 'demo_data',
    metadata: result as unknown as Record<string, unknown>
  })
  return ok(c, result)
})

export default app
