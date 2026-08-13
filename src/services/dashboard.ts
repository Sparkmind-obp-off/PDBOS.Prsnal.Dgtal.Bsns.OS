/**
 * Command Center — every number here is computed from D1 with SQL.
 * No hardcoded KPI values.
 */
import { leadPipelineCounts } from './leads'
import { recentActivityFeed, dueFollowUps } from './activities'
import { resourceCostSummary } from './resources'

async function scalar(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ v: number }>()
  return Number(row?.v ?? 0)
}

export async function commandCenter(db: D1Database, orgId: string) {
  const [
    leadsTotal, leadsHot, leadsNew, leadsQualified,
    opportunitiesOpen, pipelineValue,
    clientsActive, projectsActive, projectsOverdue,
    revenuePaid, revenueThisMonth, outstanding, overdueInvoices,
    expensesThisMonth,
    assetsActive, assetsReusable,
    notificationsUnread
  ] = await Promise.all([
    scalar(db, `SELECT COUNT(*) v FROM leads WHERE org_id = ? AND archived_at IS NULL`, orgId),
    scalar(db, `SELECT COUNT(*) v FROM leads WHERE org_id = ? AND archived_at IS NULL AND priority = 'HOT'`, orgId),
    scalar(db, `SELECT COUNT(*) v FROM leads WHERE org_id = ? AND archived_at IS NULL AND status = 'NEW'`, orgId),
    scalar(db, `SELECT COUNT(*) v FROM leads WHERE org_id = ? AND archived_at IS NULL AND status = 'QUALIFIED'`, orgId),

    scalar(db, `SELECT COUNT(*) v FROM opportunities WHERE org_id = ? AND stage NOT IN ('WON','LOST')`, orgId),
    scalar(db, `SELECT COALESCE(SUM(value),0) v FROM opportunities WHERE org_id = ? AND stage NOT IN ('WON','LOST')`, orgId),

    scalar(db, `SELECT COUNT(*) v FROM clients WHERE org_id = ? AND status = 'ACTIVE'`, orgId),
    scalar(db, `SELECT COUNT(*) v FROM projects WHERE org_id = ? AND status IN ('PLANNED','IN_PROGRESS','REVIEW')`, orgId),
    scalar(db, `SELECT COUNT(*) v FROM projects WHERE org_id = ? AND due_date IS NOT NULL AND date(due_date) < date('now') AND status NOT IN ('DELIVERED','CANCELLED')`, orgId),

    scalar(db, `SELECT COALESCE(SUM(amount),0) v FROM payments WHERE org_id = ?`, orgId),
    scalar(db, `SELECT COALESCE(SUM(amount),0) v FROM payments WHERE org_id = ? AND strftime('%Y-%m', paid_at) = strftime('%Y-%m','now')`, orgId),
    scalar(db, `SELECT COALESCE(SUM(amount),0) v FROM invoices WHERE org_id = ? AND status IN ('SENT','PARTIAL','OVERDUE')`, orgId),
    scalar(db, `SELECT COUNT(*) v FROM invoices WHERE org_id = ? AND status IN ('SENT','PARTIAL') AND due_at IS NOT NULL AND date(due_at) < date('now')`, orgId),

    scalar(db, `SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE org_id = ? AND strftime('%Y-%m', spent_at) = strftime('%Y-%m','now')`, orgId),

    scalar(db, `SELECT COUNT(*) v FROM assets WHERE org_id = ? AND status = 'ACTIVE'`, orgId),
    scalar(db, `SELECT COUNT(*) v FROM assets WHERE org_id = ? AND reusable = 1`, orgId),

    scalar(db, `SELECT COUNT(*) v FROM notifications WHERE org_id = ? AND read_at IS NULL`, orgId)
  ])

  const [pipeline, activity, followUps, resourceCost] = await Promise.all([
    leadPipelineCounts(db, orgId),
    recentActivityFeed(db, orgId, 8),
    dueFollowUps(db, orgId, 6),
    resourceCostSummary(db, orgId)
  ])

  // Business health: weighted signal from pipeline, delivery, and cash.
  const health = computeHealth({
    leadsTotal, leadsHot, clientsActive, projectsActive,
    projectsOverdue, revenueThisMonth, outstanding,
    monthlyCost: Number(resourceCost.monthly_cost ?? 0) + expensesThisMonth
  })

  const alerts = buildAlerts({ projectsOverdue, overdueInvoices, leadsHot, leadsNew, integrationsPending: 0 })

  return {
    health,
    kpis: {
      revenue_total: revenuePaid,
      revenue_this_month: revenueThisMonth,
      pipeline_value: pipelineValue,
      opportunities_open: opportunitiesOpen,
      leads_total: leadsTotal,
      leads_hot: leadsHot,
      leads_new: leadsNew,
      leads_qualified: leadsQualified,
      clients_active: clientsActive,
      projects_active: projectsActive,
      projects_overdue: projectsOverdue,
      outstanding_payments: outstanding,
      overdue_invoices: overdueInvoices,
      expenses_this_month: expensesThisMonth,
      resource_monthly_cost: Number(resourceCost.monthly_cost ?? 0),
      assets_active: assetsActive,
      assets_reusable: assetsReusable,
      notifications_unread: notificationsUnread
    },
    pipeline,
    priority_actions: buildPriorityActions({ leadsHot, leadsNew, projectsOverdue, overdueInvoices, assetsActive }),
    today: followUps,
    recent_activity: activity,
    alerts
  }
}

function computeHealth(i: {
  leadsTotal: number; leadsHot: number; clientsActive: number; projectsActive: number
  projectsOverdue: number; revenueThisMonth: number; outstanding: number; monthlyCost: number
}) {
  let score = 0
  // Pipeline strength (30)
  score += Math.min(20, i.leadsTotal * 2)
  score += Math.min(10, i.leadsHot * 3)
  // Client base (25)
  score += Math.min(15, i.clientsActive * 5)
  score += Math.min(10, i.projectsActive * 4)
  // Cash (35)
  if (i.revenueThisMonth > 0) score += 15
  if (i.revenueThisMonth > i.monthlyCost) score += 12
  if (i.outstanding === 0) score += 8
  // Delivery discipline (10)
  score += i.projectsOverdue === 0 ? 10 : Math.max(0, 10 - i.projectsOverdue * 4)

  score = Math.max(0, Math.min(100, Math.round(score)))
  const label = score >= 75 ? 'STRONG' : score >= 50 ? 'STABLE' : score >= 25 ? 'FRAGILE' : 'CRITICAL'
  return { score, label }
}

function buildPriorityActions(i: {
  leadsHot: number; leadsNew: number; projectsOverdue: number
  overdueInvoices: number; assetsActive: number
}) {
  const actions: { label: string; detail: string; severity: string; href: string }[] = []
  if (i.overdueInvoices > 0)
    actions.push({
      label: `Chase ${i.overdueInvoices} overdue invoice(s)`,
      detail: 'Cash collection is the fastest revenue lever.',
      severity: 'HIGH', href: '#/money'
    })
  if (i.projectsOverdue > 0)
    actions.push({
      label: `${i.projectsOverdue} project(s) past due date`,
      detail: 'Update status or renegotiate the deadline.',
      severity: 'HIGH', href: '#/projects'
    })
  if (i.leadsHot > 0)
    actions.push({
      label: `Contact ${i.leadsHot} HOT lead(s)`,
      detail: 'Highest scoring leads should be contacted first.',
      severity: 'MEDIUM', href: '#/leads?priority=HOT'
    })
  if (i.leadsNew > 0)
    actions.push({
      label: `Qualify ${i.leadsNew} new lead(s)`,
      detail: 'Move NEW leads through research and qualification.',
      severity: 'MEDIUM', href: '#/leads?status=NEW'
    })
  if (i.assetsActive === 0)
    actions.push({
      label: 'Publish your first active asset',
      detail: 'Reusable assets shorten every future delivery.',
      severity: 'LOW', href: '#/assets'
    })
  return actions
}

function buildAlerts(i: {
  projectsOverdue: number; overdueInvoices: number
  leadsHot: number; leadsNew: number; integrationsPending: number
}) {
  const alerts: { type: string; message: string }[] = []
  if (i.overdueInvoices > 0)
    alerts.push({ type: 'ERROR', message: `${i.overdueInvoices} invoice(s) are overdue.` })
  if (i.projectsOverdue > 0)
    alerts.push({ type: 'WARNING', message: `${i.projectsOverdue} project(s) are behind schedule.` })
  if (i.leadsHot === 0 && i.leadsNew === 0)
    alerts.push({ type: 'INFO', message: 'Pipeline is quiet. Run discovery or add leads.' })
  return alerts
}

/** Money OS summary (also used by the Money view). */
export async function moneySummary(db: D1Database, orgId: string) {
  const [revenue, thisMonth, outstanding, expenses, expensesThisMonth] = await Promise.all([
    scalar(db, `SELECT COALESCE(SUM(amount),0) v FROM payments WHERE org_id = ?`, orgId),
    scalar(db, `SELECT COALESCE(SUM(amount),0) v FROM payments WHERE org_id = ? AND strftime('%Y-%m', paid_at) = strftime('%Y-%m','now')`, orgId),
    scalar(db, `SELECT COALESCE(SUM(amount),0) v FROM invoices WHERE org_id = ? AND status IN ('SENT','PARTIAL','OVERDUE')`, orgId),
    scalar(db, `SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE org_id = ?`, orgId),
    scalar(db, `SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE org_id = ? AND strftime('%Y-%m', spent_at) = strftime('%Y-%m','now')`, orgId)
  ])
  const invoices = await db
    .prepare(
      `SELECT i.id, i.number, i.amount, i.status, i.issued_at, i.due_at, c.name AS client_name
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.org_id = ? ORDER BY i.created_at DESC LIMIT 20`
    )
    .bind(orgId)
    .all()
  const recentExpenses = await db
    .prepare(
      `SELECT e.id, e.description, e.category, e.amount, e.spent_at, e.recurring, r.name AS resource_name
       FROM expenses e LEFT JOIN resources r ON r.id = e.resource_id
       WHERE e.org_id = ? ORDER BY e.spent_at DESC LIMIT 20`
    )
    .bind(orgId)
    .all()
  return {
    totals: {
      revenue_total: revenue,
      revenue_this_month: thisMonth,
      outstanding,
      expenses_total: expenses,
      expenses_this_month: expensesThisMonth,
      net_this_month: thisMonth - expensesThisMonth
    },
    invoices: invoices.results ?? [],
    expenses: recentExpenses.results ?? []
  }
}

/** Analytics — pipeline funnel, monthly cash, top assets. */
export async function analytics(db: D1Database, orgId: string) {
  const funnel = await db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM leads
       WHERE org_id = ? AND archived_at IS NULL GROUP BY status`
    )
    .bind(orgId)
    .all()
  const monthlyRevenue = await db
    .prepare(
      `SELECT strftime('%Y-%m', paid_at) AS period, COALESCE(SUM(amount),0) AS amount
       FROM payments WHERE org_id = ? GROUP BY period ORDER BY period DESC LIMIT 6`
    )
    .bind(orgId)
    .all()
  const monthlyExpenses = await db
    .prepare(
      `SELECT strftime('%Y-%m', spent_at) AS period, COALESCE(SUM(amount),0) AS amount
       FROM expenses WHERE org_id = ? GROUP BY period ORDER BY period DESC LIMIT 6`
    )
    .bind(orgId)
    .all()
  const topAssets = await db
    .prepare(
      `SELECT name, type, usage_count, revenue_attributed FROM assets
       WHERE org_id = ? ORDER BY revenue_attributed DESC, usage_count DESC LIMIT 5`
    )
    .bind(orgId)
    .all()
  const bySource = await db
    .prepare(
      `SELECT source_key, COUNT(*) AS count FROM leads
       WHERE org_id = ? AND archived_at IS NULL GROUP BY source_key ORDER BY count DESC`
    )
    .bind(orgId)
    .all()
  return {
    funnel: funnel.results ?? [],
    monthly_revenue: (monthlyRevenue.results ?? []).reverse(),
    monthly_expenses: (monthlyExpenses.results ?? []).reverse(),
    top_assets: topAssets.results ?? [],
    leads_by_source: bySource.results ?? []
  }
}
