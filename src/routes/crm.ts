/**
 * /api — Clients, Projects, Tasks, Sales (opportunities/offers), Money.
 */
import { Hono } from 'hono'
import { ok, okList, jsonBody } from '../lib/http'
import { str, num, pagination } from '../lib/validate'
import { requireAuth, requirePermission } from '../middleware/auth'
import {
  listClients, getClient, createClient, updateClient, deleteClient,
  listProjects, getProject, createProject, updateProject, deleteProject,
  listTasks, createTask, updateTask,
  listOpportunities, createOpportunity, updateOpportunity,
  listOffers, createOffer, updateOffer,
  createInvoice, recordPayment, createExpense, updateInvoiceStatus
} from '../services/crm'
import { listActivities } from '../services/activities'
import { moneySummary, analytics } from '../services/dashboard'
import { writeAudit } from '../services/audit'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

/* ----------------------------- CLIENTS ----------------------------- */

app.get('/clients', requirePermission('client.read'), async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, perPage, offset } = pagination(q)
  const { items, total } = await listClients(c.env.DB, user.org_id, {
    q: q.q || null, status: q.status ? q.status.toUpperCase() : null, limit: perPage, offset
  })
  return okList(c, items, { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) })
})

app.get('/clients/:id', requirePermission('client.read'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const client = await getClient(c.env.DB, user.org_id, id)
  const [projects, activities] = await Promise.all([
    listProjects(c.env.DB, user.org_id, { clientId: id, limit: 50, offset: 0 }),
    listActivities(c.env.DB, user.org_id, { entityType: 'CLIENT', entityId: id, limit: 50, offset: 0 })
  ])
  return ok(c, { client, projects: projects.items, activities: activities.items })
})

app.post('/clients', requirePermission('client.create'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const id = await createClient(c.env.DB, user.org_id, user.id, {
    name: str(body, 'name', { required: true, max: 200 })!,
    industry: str(body, 'industry', { max: 120 }),
    city: str(body, 'city', { max: 120 }),
    website: str(body, 'website', { max: 300 }),
    phone: str(body, 'phone', { max: 60 }),
    email: str(body, 'email', { max: 254 }),
    status: str(body, 'status', { max: 20 }),
    health: str(body, 'health', { max: 20 }),
    lead_id: str(body, 'lead_id', { max: 60 }),
    notes: str(body, 'notes', { max: 4000 })
  })
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'client', entityId: id
  })
  return ok(c, await getClient(c.env.DB, user.org_id, id), 201)
})

app.patch('/clients/:id', requirePermission('client.update'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const patch: Record<string, unknown> = {}
  for (const f of ['name', 'industry', 'city', 'website', 'phone', 'email', 'status', 'health', 'notes'] as const) {
    if (body[f] !== undefined) patch[f] = str(body, f, { max: 4000 })
  }
  const row = await updateClient(c.env.DB, user.org_id, id, patch)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'client', entityId: id,
    metadata: { fields: Object.keys(patch) }
  })
  return ok(c, row)
})

app.delete('/clients/:id', requirePermission('client.delete'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await deleteClient(c.env.DB, user.org_id, id)
  await writeAudit(c.env.DB, { orgId: user.org_id, userId: user.id, action: 'DELETE', entity: 'client', entityId: id })
  return ok(c, { deleted: true })
})

/* ----------------------------- PROJECTS ----------------------------- */

app.get('/projects', requirePermission('project.read'), async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, perPage, offset } = pagination(q)
  const { items, total } = await listProjects(c.env.DB, user.org_id, {
    q: q.q || null,
    status: q.status ? q.status.toUpperCase() : null,
    clientId: q.client_id || null,
    limit: perPage,
    offset
  })
  return okList(c, items, { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) })
})

app.get('/projects/:id', requirePermission('project.read'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const project = await getProject(c.env.DB, user.org_id, id)
  const [tasks, activities] = await Promise.all([
    listTasks(c.env.DB, user.org_id, id),
    listActivities(c.env.DB, user.org_id, { entityType: 'PROJECT', entityId: id, limit: 50, offset: 0 })
  ])
  return ok(c, { project, tasks, activities: activities.items })
})

app.post('/projects', requirePermission('project.create'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const id = await createProject(c.env.DB, user.org_id, user.id, {
    name: str(body, 'name', { required: true, max: 200 })!,
    client_id: str(body, 'client_id', { max: 60 }),
    type: str(body, 'type', { max: 120 }),
    status: str(body, 'status', { max: 20 }),
    progress: num(body, 'progress', { min: 0, max: 100 }),
    start_date: str(body, 'start_date', { max: 40 }),
    due_date: str(body, 'due_date', { max: 40 }),
    value: num(body, 'value', { min: 0 }),
    notes: str(body, 'notes', { max: 4000 })
  })
  await writeAudit(c.env.DB, { orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'project', entityId: id })
  return ok(c, await getProject(c.env.DB, user.org_id, id), 201)
})

app.patch('/projects/:id', requirePermission('project.update'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const patch: Record<string, unknown> = {}
  for (const f of ['name', 'client_id', 'type', 'status', 'start_date', 'due_date', 'notes'] as const) {
    if (body[f] !== undefined) patch[f] = str(body, f, { max: 4000 })
  }
  if (body.progress !== undefined) patch.progress = num(body, 'progress', { min: 0, max: 100 })
  if (body.value !== undefined) patch.value = num(body, 'value', { min: 0 })
  const row = await updateProject(c.env.DB, user.org_id, id, patch)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'project', entityId: id,
    metadata: { fields: Object.keys(patch) }
  })
  return ok(c, row)
})

app.delete('/projects/:id', requirePermission('project.delete'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await deleteProject(c.env.DB, user.org_id, id)
  await writeAudit(c.env.DB, { orgId: user.org_id, userId: user.id, action: 'DELETE', entity: 'project', entityId: id })
  return ok(c, { deleted: true })
})

app.post('/projects/:id/tasks', requirePermission('project.update'), async (c) => {
  const user = c.get('user')
  const projectId = c.req.param('id')
  const body = await jsonBody(c)
  const id = await createTask(c.env.DB, user.org_id, {
    project_id: projectId,
    title: str(body, 'title', { required: true, max: 300 })!,
    status: str(body, 'status', { max: 20 }),
    priority: str(body, 'priority', { max: 20 }),
    due_date: str(body, 'due_date', { max: 40 })
  })
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'task', entityId: id,
    metadata: { project_id: projectId }
  })
  return ok(c, { id }, 201)
})

app.patch('/tasks/:id', requirePermission('project.update'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const patch: Record<string, any> = {}
  for (const f of ['title', 'status', 'priority', 'due_date'] as const) {
    if (body[f] !== undefined) patch[f] = str(body, f, { max: 300 })
  }
  const row = await updateTask(c.env.DB, user.org_id, id, patch)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'task', entityId: id,
    metadata: { fields: Object.keys(patch) }
  })
  return ok(c, row)
})

/* ------------------------------- SALES ------------------------------- */

app.get('/opportunities', requirePermission('sales.read'), async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const { page, perPage, offset } = pagination(q)
  const { items, total } = await listOpportunities(c.env.DB, user.org_id, {
    stage: q.stage ? q.stage.toUpperCase() : null, limit: perPage, offset
  })
  return okList(c, items, { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) })
})

app.post('/opportunities', requirePermission('sales.manage'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const id = await createOpportunity(c.env.DB, user.org_id, user.id, {
    title: str(body, 'title', { required: true, max: 200 })!,
    lead_id: str(body, 'lead_id', { max: 60 }),
    stage: str(body, 'stage', { max: 20 }),
    value: num(body, 'value', { min: 0 }),
    probability: num(body, 'probability', { min: 0, max: 100 }),
    expected_at: str(body, 'expected_at', { max: 40 }),
    notes: str(body, 'notes', { max: 4000 })
  })
  await writeAudit(c.env.DB, { orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'opportunity', entityId: id })
  return ok(c, { id }, 201)
})

app.patch('/opportunities/:id', requirePermission('sales.manage'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const patch: Record<string, unknown> = {}
  for (const f of ['title', 'stage', 'expected_at', 'notes'] as const) {
    if (body[f] !== undefined) patch[f] = str(body, f, { max: 4000 })
  }
  if (body.value !== undefined) patch.value = num(body, 'value', { min: 0 })
  if (body.probability !== undefined) patch.probability = num(body, 'probability', { min: 0, max: 100 })
  const row = await updateOpportunity(c.env.DB, user.org_id, id, patch)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'STATUS_CHANGE', entity: 'opportunity', entityId: id,
    metadata: { fields: Object.keys(patch) }
  })
  return ok(c, row)
})

app.get('/offers', requirePermission('sales.read'), async (c) => {
  const user = c.get('user')
  const { page, perPage, offset } = pagination(c.req.query())
  const { items, total } = await listOffers(c.env.DB, user.org_id, { limit: perPage, offset })
  return okList(c, items, { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) })
})

app.post('/offers', requirePermission('sales.manage'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const id = await createOffer(c.env.DB, user.org_id, {
    title: str(body, 'title', { required: true, max: 200 })!,
    lead_id: str(body, 'lead_id', { max: 60 }),
    opportunity_id: str(body, 'opportunity_id', { max: 60 }),
    package: str(body, 'package', { max: 200 }),
    price: num(body, 'price', { min: 0 }),
    status: str(body, 'status', { max: 20 }),
    valid_until: str(body, 'valid_until', { max: 40 }),
    notes: str(body, 'notes', { max: 4000 })
  })
  await writeAudit(c.env.DB, { orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'offer', entityId: id })
  return ok(c, { id }, 201)
})

app.patch('/offers/:id', requirePermission('sales.manage'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const patch: Record<string, unknown> = {}
  for (const f of ['title', 'package', 'status', 'valid_until', 'notes'] as const) {
    if (body[f] !== undefined) patch[f] = str(body, f, { max: 4000 })
  }
  if (body.price !== undefined) patch.price = num(body, 'price', { min: 0 })
  const row = await updateOffer(c.env.DB, user.org_id, id, patch)
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'STATUS_CHANGE', entity: 'offer', entityId: id,
    metadata: { fields: Object.keys(patch) }
  })
  return ok(c, row)
})

/* ------------------------------- MONEY ------------------------------- */

app.get('/money', requirePermission('finance.read'), async (c) => {
  const user = c.get('user')
  return ok(c, await moneySummary(c.env.DB, user.org_id))
})

app.post('/invoices', requirePermission('finance.manage'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const id = await createInvoice(c.env.DB, user.org_id, {
    client_id: str(body, 'client_id', { max: 60 }),
    project_id: str(body, 'project_id', { max: 60 }),
    number: str(body, 'number', { max: 60 }),
    amount: num(body, 'amount', { required: true, min: 0 })!,
    status: str(body, 'status', { max: 20 }),
    issued_at: str(body, 'issued_at', { max: 40 }),
    due_at: str(body, 'due_at', { max: 40 }),
    notes: str(body, 'notes', { max: 2000 })
  })
  await writeAudit(c.env.DB, { orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'invoice', entityId: id })
  return ok(c, { id }, 201)
})

app.patch('/invoices/:id', requirePermission('finance.manage'), async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await jsonBody(c)
  const status = str(body, 'status', { required: true, max: 20 })!
  const row = await updateInvoiceStatus(c.env.DB, user.org_id, id, status.toUpperCase())
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'STATUS_CHANGE', entity: 'invoice', entityId: id,
    metadata: { status }
  })
  return ok(c, row)
})

app.post('/payments', requirePermission('finance.manage'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const id = await recordPayment(c.env.DB, user.org_id, {
    invoice_id: str(body, 'invoice_id', { max: 60 }),
    client_id: str(body, 'client_id', { max: 60 }),
    amount: num(body, 'amount', { required: true, min: 0 })!,
    method: str(body, 'method', { max: 60 }),
    reference: str(body, 'reference', { max: 120 }),
    paid_at: str(body, 'paid_at', { max: 40 })
  })
  await writeAudit(c.env.DB, { orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'payment', entityId: id })
  return ok(c, { id }, 201)
})

app.post('/expenses', requirePermission('finance.manage'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const id = await createExpense(c.env.DB, user.org_id, {
    description: str(body, 'description', { required: true, max: 300 })!,
    amount: num(body, 'amount', { required: true, min: 0 })!,
    category: str(body, 'category', { max: 40 }),
    resource_id: str(body, 'resource_id', { max: 60 }),
    project_id: str(body, 'project_id', { max: 60 }),
    spent_at: str(body, 'spent_at', { max: 40 }),
    recurring: str(body, 'recurring', { max: 20 })
  })
  await writeAudit(c.env.DB, { orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'expense', entityId: id })
  return ok(c, { id }, 201)
})

/* ----------------------------- ANALYTICS ----------------------------- */

app.get('/analytics', requirePermission('analytics.read'), async (c) => {
  const user = c.get('user')
  return ok(c, await analytics(c.env.DB, user.org_id))
})

export default app
