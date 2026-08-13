/**
 * PDBOS — Personal Digital Business OS
 * Codename: SURVIVAL ENGINE
 *
 * Cloudflare Pages Functions entry point.
 *
 *   Request → withSession → route module → service → D1
 *
 * Route modules never touch the database directly and never talk to an external
 * provider; services own persistence and the Integration Hub owns providers.
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

import { serializeError, ok } from './lib/http'
import { newId } from './lib/id'
import { withSession } from './middleware/auth'
import { ensureBootstrapped } from './services/bootstrap'
import { ROLES, PERMISSIONS } from './services/rbac'
import {
  LEAD_STATUSES, LEAD_PRIORITIES, RESOURCE_TYPES, RESOURCE_STATUSES,
  RESOURCE_COST_TYPES, ASSET_TYPES, ASSET_STATUSES, ACTIVITY_TYPES,
  ACTIVITY_ENTITIES, NOTIFICATION_TYPES, AI_OPERATIONS, USER_STATUSES
} from './types'

import authRoutes from './routes/auth'
import leadRoutes from './routes/leads'
import activityRoutes from './routes/activities'
import resourceRoutes from './routes/resources'
import assetRoutes from './routes/assets'
import integrationRoutes from './routes/integrations'
import discoveryRoutes from './routes/discovery'
import crmRoutes from './routes/crm'
import teamRoutes from './routes/team'
import systemRoutes from './routes/system'

import { appShell } from './views/shell'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

/* ----------------------------- MIDDLEWARE ----------------------------- */

// Request id for correlating server logs with client error envelopes.
app.use('*', async (c, next) => {
  c.set('requestId', newId('req'))
  await next()
})

app.use('/api/*', cors({
  origin: (origin) => origin ?? '*',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type']
}))

// Idempotent boot provisioning (RBAC catalogue + integration providers).
app.use('/api/*', async (c, next) => {
  await ensureBootstrapped(c.env.DB)
  await next()
})

// Resolve the session cookie for every API request without rejecting.
app.use('/api/*', withSession)

app.onError(serializeError)

/* -------------------------------- HEALTH -------------------------------- */

app.get('/api/health', async (c) => {
  let database = 'unknown'
  try {
    await c.env.DB.prepare('SELECT 1').first()
    database = 'ok'
  } catch {
    database = 'error'
  }
  return ok(c, {
    service: 'PDBOS',
    codename: 'SURVIVAL ENGINE',
    phase: 'Phase 0',
    database,
    time: new Date().toISOString()
  })
})

/**
 * Enum/metadata catalogue. The client renders selects and badges from this so
 * status vocabularies never drift between server and UI.
 */
app.get('/api/meta', (c) => {
  return ok(c, {
    lead_statuses: LEAD_STATUSES,
    lead_priorities: LEAD_PRIORITIES,
    resource_types: RESOURCE_TYPES,
    resource_statuses: RESOURCE_STATUSES,
    resource_cost_types: RESOURCE_COST_TYPES,
    asset_types: ASSET_TYPES,
    asset_statuses: ASSET_STATUSES,
    activity_types: ACTIVITY_TYPES,
    activity_entities: ACTIVITY_ENTITIES,
    notification_types: NOTIFICATION_TYPES,
    ai_operations: AI_OPERATIONS,
    lead_sources: ['MANUAL', 'GOOGLE_MAPS', 'INSTAGRAM', 'REFERRAL', 'DISCOVERY', 'IMPORT', 'OTHER'],
    client_statuses: ['ACTIVE', 'PAUSED', 'CHURNED', 'PROSPECT'],
    client_health: ['GOOD', 'AT_RISK', 'CRITICAL'],
    project_statuses: ['PLANNED', 'IN_PROGRESS', 'REVIEW', 'DELIVERED', 'ON_HOLD', 'CANCELLED'],
    task_statuses: ['TODO', 'DOING', 'BLOCKED', 'DONE'],
    opportunity_stages: ['DISCOVERY', 'QUALIFYING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'],
    offer_statuses: ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
    invoice_statuses: ['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID'],
    expense_categories: ['TOOL', 'API', 'MARKETING', 'OPS', 'OTHER'],
    recurring_options: ['NONE', 'MONTHLY', 'YEARLY'],
    user_statuses: USER_STATUSES,
    roles: ROLES.map((r) => ({ key: r.key, name: r.name, description: r.description })),
    permissions: PERMISSIONS.map((p) => p.key)
  })
})

/* ------------------------------ API ROUTES ------------------------------ */

app.route('/api/auth', authRoutes)
app.route('/api/leads', leadRoutes)
app.route('/api/activities', activityRoutes)
app.route('/api/resources', resourceRoutes)
app.route('/api/assets', assetRoutes)
app.route('/api/integrations', integrationRoutes)
app.route('/api/discovery', discoveryRoutes)
app.route('/api/team', teamRoutes)
app.route('/api', crmRoutes)      // clients, projects, tasks, sales, money, analytics
app.route('/api', systemRoutes)   // dashboard, search, notifications, settings, audit, ai, demo-data

// Unknown API path — JSON, never the HTML shell.
app.all('/api/*', (c) =>
  c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Unknown API endpoint.' } }, 404)
)

/* ---------------------------- STATIC ASSETS ---------------------------- */

app.use('/static/*', serveStatic({ root: './' }))
app.get('/favicon.ico', serveStatic({ path: './static/favicon.ico' }))

/* ------------------------------ APP SHELL ------------------------------ */

// Single-page application shell. Client-side routing uses the hash, so every
// non-API path returns the same shell and the client resolves the view.
app.get('*', (c) => c.html(appShell()))

export default app
