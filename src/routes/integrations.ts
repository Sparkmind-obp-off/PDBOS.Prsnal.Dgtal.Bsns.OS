/**
 * /api/integrations — Integration Hub endpoints.
 * Only booleans and non-secret configuration are ever returned.
 */
import { Hono } from 'hono'
import { ok, jsonBody } from '../lib/http'
import { requireAuth, requirePermission } from '../middleware/auth'
import {
  listIntegrations, getIntegration, connectIntegration,
  disconnectIntegration, testIntegration, listIntegrationLogs
} from '../services/integrations'
import { writeAudit } from '../services/audit'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

app.get('/', requirePermission('integration.read'), async (c) => {
  const user = c.get('user')
  return ok(c, await listIntegrations(c.env.DB, c.env, user.org_id))
})

app.get('/:key', requirePermission('integration.read'), async (c) => {
  const user = c.get('user')
  const key = c.req.param('key')
  const [integration, logs] = await Promise.all([
    getIntegration(c.env.DB, c.env, user.org_id, key),
    listIntegrationLogs(c.env.DB, user.org_id, key, 20)
  ])
  return ok(c, { integration, logs })
})

app.post('/:key/connect', requirePermission('integration.manage'), async (c) => {
  const user = c.get('user')
  const key = c.req.param('key')
  const body = await jsonBody(c)
  // Non-secret configuration only. Secrets come from the Worker environment.
  const config = (body.config && typeof body.config === 'object' ? body.config : {}) as Record<string, unknown>
  const view = await connectIntegration(c.env.DB, c.env, user.org_id, key, config)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'integration', entityId: key,
    metadata: { action: 'connect', status: view.status }
  })
  return ok(c, view)
})

app.post('/:key/disconnect', requirePermission('integration.manage'), async (c) => {
  const user = c.get('user')
  const key = c.req.param('key')
  const view = await disconnectIntegration(c.env.DB, c.env, user.org_id, key)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'integration', entityId: key,
    metadata: { action: 'disconnect' }
  })
  return ok(c, view)
})

app.post('/:key/test', requirePermission('integration.manage'), async (c) => {
  const user = c.get('user')
  const key = c.req.param('key')
  const result = await testIntegration(c.env.DB, c.env, user.org_id, key)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'INTEGRATION_TEST', entity: 'integration',
    entityId: key, metadata: { status: result.status, ok: result.ok }
  })
  return ok(c, result)
})

export default app
