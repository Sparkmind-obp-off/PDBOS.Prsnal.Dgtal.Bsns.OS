/**
 * /api/discovery — Discovery Engine endpoints.
 */
import { Hono } from 'hono'
import { ok, jsonBody } from '../lib/http'
import { str, num, badRequestIfEmptyArray } from '../lib/discoveryValidate'
import { requireAuth, requirePermission } from '../middleware/auth'
import {
  listDiscoveryProviders, runDiscovery, importDiscoveryResults,
  listDiscoveryRuns, getDiscoveryRun
} from '../services/discovery'
import { writeAudit, writeEvent } from '../services/audit'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

app.get('/providers', requirePermission('discovery.read'), (c) => {
  return ok(c, listDiscoveryProviders(c.env))
})

app.get('/runs', requirePermission('discovery.read'), async (c) => {
  const user = c.get('user')
  return ok(c, await listDiscoveryRuns(c.env.DB, user.org_id, 20))
})

app.get('/runs/:id', requirePermission('discovery.read'), async (c) => {
  const user = c.get('user')
  return ok(c, await getDiscoveryRun(c.env.DB, user.org_id, c.req.param('id')))
})

app.post('/search', requirePermission('discovery.run'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const result = await runDiscovery(c.env.DB, c.env, user.org_id, user.id, {
    provider_key: str(body, 'provider_key', { required: true, max: 60 })!,
    query: str(body, 'query', { required: true, max: 2000 })!,
    location: str(body, 'location', { max: 160 }),
    limit: num(body, 'limit', { min: 1, max: 20, default: 20 })!
  })
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'DISCOVERY_RUN', entity: 'discovery_run',
    entityId: result.run_id, metadata: { provider: result.provider_key, status: result.status }
  })
  await writeEvent(c.env.DB, user.org_id, user.id, 'discovery.searched', 'DISCOVERY', result.run_id)
  return ok(c, result)
})

app.post('/import', requirePermission('lead.create'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const ids = badRequestIfEmptyArray(body, 'result_ids')
  const result = await importDiscoveryResults(c.env.DB, user.org_id, user.id, ids)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'lead',
    metadata: { via: 'discovery_import', imported: result.imported, skipped: result.skipped }
  })
  return ok(c, result, 201)
})

export default app
