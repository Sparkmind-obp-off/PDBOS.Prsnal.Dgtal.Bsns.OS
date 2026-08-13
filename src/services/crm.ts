/**
 * Client OS, Delivery OS, Sales OS and Money OS data access.
 * Phase 0 provides real persistence for the entities the dashboard aggregates.
 */
import { newId } from '../lib/id'
import { notFound } from '../lib/http'

/* ----------------------------- CLIENTS ----------------------------- */

export async function listClients(
  db: D1Database,
  orgId: string,
  opts: { q?: string | null; status?: string | null; limit: number; offset: number }
) {
  const where = ['c.org_id = ?']
  const binds: unknown[] = [orgId]
  if (opts.status) { where.push('c.status = ?'); binds.push(opts.status) }
  if (opts.q) {
    where.push('(c.name LIKE ? OR c.city LIKE ? OR c.email LIKE ?)')
    const like = `%${opts.q}%`
    binds.push(like, like, like)
  }
  const rows = await db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count,
              (SELECT COALESCE(SUM(pm.amount),0) FROM payments pm WHERE pm.client_id = c.id) AS revenue
       FROM clients c WHERE ${where.join(' AND ')}
       ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, opts.offset)
    .all()
  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM clients c WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ c: number }>()
  return { items: rows.results ?? [], total: total?.c ?? 0 }
}

export async function getClient(db: D1Database, orgId: string, id: string) {
  const row = await db
    .prepare(`SELECT * FROM clients WHERE id = ? AND org_id = ?`)
    .bind(id, orgId)
    .first()
  if (!row) throw notFound('Client not found.')
  return row
}

export interface ClientInput {
  name: string
  industry?: string | null
  city?: string | null
  website?: string | null
  phone?: string | null
  email?: string | null
  status?: string | null
  health?: string | null
  lead_id?: string | null
  notes?: string | null
}

export async function createClient(
  db: D1Database,
  orgId: string,
  userId: string,
  input: ClientInput,
  isDemo = false
): Promise<string> {
  const id = newId('cli')
  await db
    .prepare(
      `INSERT INTO clients (id, org_id, lead_id, name, industry, city, website, phone, email, status, health, owner_id, notes, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.lead_id ?? null, input.name, input.industry ?? null, input.city ?? null,
      input.website ?? null, input.phone ?? null, input.email ?? null,
      input.status || 'ACTIVE', input.health || 'GOOD', userId, input.notes ?? null, isDemo ? 1 : 0
    )
    .run()
  return id
}

const CLIENT_UPDATABLE = ['name', 'industry', 'city', 'website', 'phone', 'email', 'status', 'health', 'notes'] as const

export async function updateClient(db: D1Database, orgId: string, id: string, patch: Partial<ClientInput>) {
  await getClient(db, orgId, id)
  const sets = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  for (const f of CLIENT_UPDATABLE) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); binds.push(patch[f]) }
  }
  await db.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`).bind(...binds, id, orgId).run()
  return getClient(db, orgId, id)
}

export async function deleteClient(db: D1Database, orgId: string, id: string) {
  await getClient(db, orgId, id)
  await db.prepare(`DELETE FROM clients WHERE id = ? AND org_id = ?`).bind(id, orgId).run()
}

/* ----------------------------- PROJECTS ----------------------------- */

export async function listProjects(
  db: D1Database,
  orgId: string,
  opts: { q?: string | null; status?: string | null; clientId?: string | null; limit: number; offset: number }
) {
  const where = ['p.org_id = ?']
  const binds: unknown[] = [orgId]
  if (opts.status) { where.push('p.status = ?'); binds.push(opts.status) }
  if (opts.clientId) { where.push('p.client_id = ?'); binds.push(opts.clientId) }
  if (opts.q) { where.push('(p.name LIKE ? OR p.type LIKE ?)'); binds.push(`%${opts.q}%`, `%${opts.q}%`) }

  const rows = await db
    .prepare(
      `SELECT p.*, c.name AS client_name,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'DONE') AS task_done
       FROM projects p LEFT JOIN clients c ON c.id = p.client_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.due_date IS NULL, p.due_date ASC, p.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, opts.offset)
    .all()
  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM projects p WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ c: number }>()
  return { items: rows.results ?? [], total: total?.c ?? 0 }
}

export async function getProject(db: D1Database, orgId: string, id: string) {
  const row = await db
    .prepare(
      `SELECT p.*, c.name AS client_name FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       WHERE p.id = ? AND p.org_id = ?`
    )
    .bind(id, orgId)
    .first()
  if (!row) throw notFound('Project not found.')
  return row
}

export interface ProjectInput {
  name: string
  client_id?: string | null
  type?: string | null
  status?: string | null
  progress?: number | null
  start_date?: string | null
  due_date?: string | null
  value?: number | null
  notes?: string | null
}

export async function createProject(
  db: D1Database,
  orgId: string,
  userId: string,
  input: ProjectInput,
  isDemo = false
): Promise<string> {
  const id = newId('prj')
  await db
    .prepare(
      `INSERT INTO projects (id, org_id, client_id, name, type, status, progress, start_date, due_date, value, owner_id, notes, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.client_id ?? null, input.name, input.type ?? null,
      input.status || 'PLANNED', input.progress ?? 0, input.start_date ?? null,
      input.due_date ?? null, input.value ?? 0, userId, input.notes ?? null, isDemo ? 1 : 0
    )
    .run()
  return id
}

const PROJECT_UPDATABLE = ['name', 'client_id', 'type', 'status', 'progress', 'start_date', 'due_date', 'value', 'notes'] as const

export async function updateProject(db: D1Database, orgId: string, id: string, patch: Partial<ProjectInput>) {
  await getProject(db, orgId, id)
  const sets = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  for (const f of PROJECT_UPDATABLE) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); binds.push(patch[f]) }
  }
  await db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`).bind(...binds, id, orgId).run()
  return getProject(db, orgId, id)
}

export async function deleteProject(db: D1Database, orgId: string, id: string) {
  await getProject(db, orgId, id)
  await db.prepare(`DELETE FROM projects WHERE id = ? AND org_id = ?`).bind(id, orgId).run()
}

/* ------------------------------- TASKS ------------------------------- */

export async function listTasks(db: D1Database, orgId: string, projectId: string) {
  const rows = await db
    .prepare(
      `SELECT * FROM tasks WHERE org_id = ? AND project_id = ?
       ORDER BY CASE status WHEN 'DOING' THEN 0 WHEN 'BLOCKED' THEN 1 WHEN 'TODO' THEN 2 ELSE 3 END,
                due_date IS NULL, due_date ASC`
    )
    .bind(orgId, projectId)
    .all()
  return rows.results ?? []
}

export async function createTask(
  db: D1Database,
  orgId: string,
  input: { project_id: string; title: string; status?: string | null; priority?: string | null; due_date?: string | null },
  isDemo = false
): Promise<string> {
  const id = newId('tsk')
  await db
    .prepare(
      `INSERT INTO tasks (id, org_id, project_id, title, status, priority, due_date, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, orgId, input.project_id, input.title, input.status || 'TODO', input.priority || 'MEDIUM', input.due_date ?? null, isDemo ? 1 : 0)
    .run()
  return id
}

export async function updateTask(
  db: D1Database,
  orgId: string,
  id: string,
  patch: { title?: string; status?: string; priority?: string; due_date?: string | null }
) {
  const sets = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  for (const f of ['title', 'status', 'priority', 'due_date'] as const) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); binds.push(patch[f]) }
  }
  await db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`).bind(...binds, id, orgId).run()
  const row = await db.prepare(`SELECT * FROM tasks WHERE id = ? AND org_id = ?`).bind(id, orgId).first()
  if (!row) throw notFound('Task not found.')
  return row
}

/* ------------------------------- SALES ------------------------------- */

export async function listOpportunities(
  db: D1Database,
  orgId: string,
  opts: { stage?: string | null; limit: number; offset: number }
) {
  const where = ['o.org_id = ?']
  const binds: unknown[] = [orgId]
  if (opts.stage) { where.push('o.stage = ?'); binds.push(opts.stage) }
  const rows = await db
    .prepare(
      `SELECT o.*, l.business_name AS lead_name FROM opportunities o
       LEFT JOIN leads l ON l.id = o.lead_id
       WHERE ${where.join(' AND ')}
       ORDER BY o.value DESC, o.updated_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, opts.offset)
    .all()
  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM opportunities o WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ c: number }>()
  return { items: rows.results ?? [], total: total?.c ?? 0 }
}

export async function createOpportunity(
  db: D1Database,
  orgId: string,
  userId: string,
  input: { title: string; lead_id?: string | null; stage?: string | null; value?: number | null; probability?: number | null; expected_at?: string | null; notes?: string | null },
  isDemo = false
): Promise<string> {
  const id = newId('opp')
  await db
    .prepare(
      `INSERT INTO opportunities (id, org_id, lead_id, title, stage, value, probability, expected_at, owner_id, notes, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.lead_id ?? null, input.title, input.stage || 'DISCOVERY',
      input.value ?? 0, input.probability ?? 0, input.expected_at ?? null, userId,
      input.notes ?? null, isDemo ? 1 : 0
    )
    .run()
  return id
}

export async function updateOpportunity(
  db: D1Database,
  orgId: string,
  id: string,
  patch: Record<string, unknown>
) {
  const sets = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  for (const f of ['title', 'stage', 'value', 'probability', 'expected_at', 'notes'] as const) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); binds.push(patch[f]) }
  }
  await db.prepare(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`).bind(...binds, id, orgId).run()
  const row = await db.prepare(`SELECT * FROM opportunities WHERE id = ? AND org_id = ?`).bind(id, orgId).first()
  if (!row) throw notFound('Opportunity not found.')
  return row
}

export async function listOffers(db: D1Database, orgId: string, opts: { limit: number; offset: number }) {
  const rows = await db
    .prepare(
      `SELECT o.*, l.business_name AS lead_name FROM offers o
       LEFT JOIN leads l ON l.id = o.lead_id
       WHERE o.org_id = ? ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(orgId, opts.limit, opts.offset)
    .all()
  const total = await db.prepare(`SELECT COUNT(*) AS c FROM offers WHERE org_id = ?`).bind(orgId).first<{ c: number }>()
  return { items: rows.results ?? [], total: total?.c ?? 0 }
}

export async function createOffer(
  db: D1Database,
  orgId: string,
  input: { title: string; lead_id?: string | null; opportunity_id?: string | null; package?: string | null; price?: number | null; status?: string | null; valid_until?: string | null; notes?: string | null },
  isDemo = false
): Promise<string> {
  const id = newId('off')
  await db
    .prepare(
      `INSERT INTO offers (id, org_id, opportunity_id, lead_id, title, package, price, status, valid_until, notes, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.opportunity_id ?? null, input.lead_id ?? null, input.title,
      input.package ?? null, input.price ?? 0, input.status || 'DRAFT',
      input.valid_until ?? null, input.notes ?? null, isDemo ? 1 : 0
    )
    .run()
  return id
}

export async function updateOffer(db: D1Database, orgId: string, id: string, patch: Record<string, unknown>) {
  const sets = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  for (const f of ['title', 'package', 'price', 'status', 'valid_until', 'notes'] as const) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); binds.push(patch[f]) }
  }
  await db.prepare(`UPDATE offers SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`).bind(...binds, id, orgId).run()
  const row = await db.prepare(`SELECT * FROM offers WHERE id = ? AND org_id = ?`).bind(id, orgId).first()
  if (!row) throw notFound('Offer not found.')
  return row
}

/* ------------------------------- MONEY ------------------------------- */

export async function createInvoice(
  db: D1Database,
  orgId: string,
  input: { client_id?: string | null; project_id?: string | null; number?: string | null; amount: number; status?: string | null; issued_at?: string | null; due_at?: string | null; notes?: string | null },
  isDemo = false
): Promise<string> {
  const id = newId('inv')
  const number = input.number || `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${id.slice(-4).toUpperCase()}`
  await db
    .prepare(
      `INSERT INTO invoices (id, org_id, client_id, project_id, number, amount, status, issued_at, due_at, notes, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, orgId, input.client_id ?? null, input.project_id ?? null, number, input.amount,
      input.status || 'DRAFT', input.issued_at ?? null, input.due_at ?? null,
      input.notes ?? null, isDemo ? 1 : 0
    )
    .run()
  return id
}

export async function recordPayment(
  db: D1Database,
  orgId: string,
  input: { invoice_id?: string | null; client_id?: string | null; amount: number; method?: string | null; reference?: string | null; paid_at?: string | null },
  isDemo = false
): Promise<string> {
  const id = newId('pay')
  await db
    .prepare(
      `INSERT INTO payments (id, org_id, invoice_id, client_id, amount, method, reference, paid_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`
    )
    .bind(
      id, orgId, input.invoice_id ?? null, input.client_id ?? null, input.amount,
      input.method ?? null, input.reference ?? null, input.paid_at ?? null, isDemo ? 1 : 0
    )
    .run()

  // Settle the invoice when payments cover the amount.
  if (input.invoice_id) {
    const inv = await db
      .prepare(`SELECT amount FROM invoices WHERE id = ? AND org_id = ?`)
      .bind(input.invoice_id, orgId)
      .first<{ amount: number }>()
    const paid = await db
      .prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE invoice_id = ?`)
      .bind(input.invoice_id)
      .first<{ v: number }>()
    if (inv) {
      const status = (paid?.v ?? 0) >= inv.amount ? 'PAID' : 'PARTIAL'
      await db
        .prepare(`UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?`)
        .bind(status, input.invoice_id, orgId)
        .run()
    }
  }
  return id
}

export async function createExpense(
  db: D1Database,
  orgId: string,
  input: { description: string; amount: number; category?: string | null; resource_id?: string | null; project_id?: string | null; spent_at?: string | null; recurring?: string | null },
  isDemo = false
): Promise<string> {
  const id = newId('exp')
  await db
    .prepare(
      `INSERT INTO expenses (id, org_id, resource_id, project_id, category, description, amount, spent_at, recurring, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)`
    )
    .bind(
      id, orgId, input.resource_id ?? null, input.project_id ?? null, input.category || 'TOOL',
      input.description, input.amount, input.spent_at ?? null, input.recurring || 'NONE', isDemo ? 1 : 0
    )
    .run()
  return id
}

export async function updateInvoiceStatus(db: D1Database, orgId: string, id: string, status: string) {
  await db
    .prepare(`UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?`)
    .bind(status, id, orgId)
    .run()
  const row = await db.prepare(`SELECT * FROM invoices WHERE id = ? AND org_id = ?`).bind(id, orgId).first()
  if (!row) throw notFound('Invoice not found.')
  return row
}
