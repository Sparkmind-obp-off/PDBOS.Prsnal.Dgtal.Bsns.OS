/**
 * Command Center.
 * Every value rendered here comes from GET /api/dashboard, which computes it
 * with SQL against D1. Nothing on this screen is a hardcoded figure.
 */
import {
  api, store, fmtMoneyShort, fmtMoney, fmtNumber, fmtRelative, fmtDate, daysUntil,
  badge, esc, healthColor, skeletonCards, skeletonBlock, errorState, sectionHeader
} from '../core.js'
import { navigate } from '../router.js'

const ACTIVITY_ICONS = {
  NOTE: 'fa-note-sticky', CALL: 'fa-phone', MESSAGE: 'fa-comment-dots',
  EMAIL: 'fa-envelope', FOLLOW_UP: 'fa-clock-rotate-left', MEETING: 'fa-users',
  DEMO: 'fa-laptop-code', OFFER: 'fa-file-contract', PAYMENT: 'fa-money-bill-wave',
  TASK: 'fa-list-check', SYSTEM: 'fa-gear'
}

const PIPELINE_ORDER = [
  'NEW', 'RESEARCHING', 'QUALIFIED', 'CONTACTED', 'REPLIED',
  'INTERESTED', 'DEMO', 'OFFER', 'WON', 'LOST', 'NURTURE'
]

function kpiTile({ label, value, sub, icon, tone = 'ink', href }) {
  const tones = {
    ink: 'bg-ink-100 text-ink-600',
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600'
  }
  const clickable = href ? `role="button" tabindex="0" data-nav="${esc(href)}"` : ''
  return `
    <article class="card card-pad ${href ? 'cursor-pointer transition hover:border-ink-300 hover:shadow-sm' : ''}" ${clickable}>
      <div class="flex items-start justify-between gap-2">
        <span class="text-xs font-medium text-ink-500">${esc(label)}</span>
        <span class="flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}">
          <i class="fa-solid ${icon} text-xs"></i>
        </span>
      </div>
      <div class="mt-2 text-xl font-semibold tabular-nums text-ink-900 sm:text-2xl">${value}</div>
      ${sub ? `<div class="mt-1 text-xs text-ink-400">${sub}</div>` : ''}
    </article>`
}

function healthCard(health, kpis) {
  const color = healthColor(health.score)
  return `
    <section class="card overflow-hidden">
      <div class="flex flex-wrap items-center gap-5 p-5">
        <div class="relative flex h-20 w-20 shrink-0 items-center justify-center">
          <svg viewBox="0 0 36 36" class="h-20 w-20 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e2e8f0" stroke-width="3"></circle>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" stroke-width="3"
              stroke-linecap="round" class="${color.text}"
              stroke-dasharray="${(health.score / 100) * 97.4} 97.4"></circle>
          </svg>
          <span class="absolute text-lg font-semibold tabular-nums text-ink-900">${health.score}</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-ink-900">Business Health</h2>
            ${badge(health.label)}
          </div>
          <p class="mt-1 text-xs text-ink-500">
            Weighted from pipeline strength, client base, cash position and delivery discipline.
          </p>
          <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <div><dt class="text-ink-400">Revenue MTD</dt>
              <dd class="font-semibold tabular-nums text-ink-800">${fmtMoneyShort(kpis.revenue_this_month)}</dd></div>
            <div><dt class="text-ink-400">Expenses MTD</dt>
              <dd class="font-semibold tabular-nums text-ink-800">${fmtMoneyShort(kpis.expenses_this_month)}</dd></div>
            <div><dt class="text-ink-400">Pipeline</dt>
              <dd class="font-semibold tabular-nums text-ink-800">${fmtMoneyShort(kpis.pipeline_value)}</dd></div>
            <div><dt class="text-ink-400">Outstanding</dt>
              <dd class="font-semibold tabular-nums text-ink-800">${fmtMoneyShort(kpis.outstanding_payments)}</dd></div>
          </dl>
        </div>
      </div>
    </section>`
}

function pipelineCard(pipeline) {
  const counts = new Map(pipeline.map((p) => [p.status, Number(p.count)]))
  const max = Math.max(1, ...counts.values())
  const rows = PIPELINE_ORDER.filter((s) => counts.get(s))
  if (!rows.length) {
    return `
      <section class="card">
        ${cardHeader('Lead Pipeline', 'Live counts per status')}
        <div class="px-5 pb-6 pt-2 text-sm text-ink-500">
          No leads yet. Add a lead or run discovery to build the pipeline.
        </div>
      </section>`
  }
  return `
    <section class="card">
      ${cardHeader('Lead Pipeline', 'Live counts per status')}
      <div class="space-y-2 px-5 pb-5 pt-1">
        ${rows.map((status) => {
          const count = counts.get(status)
          return `
            <button type="button" data-nav="#/leads?status=${status}"
              class="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-ink-50">
              <span class="w-24 shrink-0 text-xs font-medium text-ink-600">${esc(status.replace(/_/g, ' '))}</span>
              <span class="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                <span class="block h-full rounded-full bg-ink-900" style="width:${(count / max) * 100}%"></span>
              </span>
              <span class="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-800">${count}</span>
            </button>`
        }).join('')}
      </div>
    </section>`
}

function cardHeader(title, subtitle, action = '') {
  return `
    <header class="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
      <div>
        <h2 class="text-sm font-semibold text-ink-900">${esc(title)}</h2>
        ${subtitle ? `<p class="mt-0.5 text-xs text-ink-400">${esc(subtitle)}</p>` : ''}
      </div>
      ${action}
    </header>`
}

function priorityActionsCard(actions) {
  return `
    <section class="card">
      ${cardHeader('Priority Actions', 'Derived from your current data')}
      ${actions.length ? `
        <ul class="divide-y divide-ink-100">
          ${actions.map((a) => {
            const tone = a.severity === 'HIGH'
              ? 'bg-rose-50 text-rose-600'
              : a.severity === 'MEDIUM' ? 'bg-amber-50 text-amber-600' : 'bg-ink-100 text-ink-500'
            return `
              <li>
                <button type="button" data-nav="${esc(a.href)}"
                  class="flex w-full items-start gap-3 px-5 py-3 text-left transition hover:bg-ink-50">
                  <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tone}">
                    <i class="fa-solid fa-bolt text-[10px]"></i>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-medium text-ink-900">${esc(a.label)}</span>
                    <span class="block text-xs text-ink-500">${esc(a.detail)}</span>
                  </span>
                  <i class="fa-solid fa-chevron-right mt-1 text-[10px] text-ink-300"></i>
                </button>
              </li>`
          }).join('')}
        </ul>` : `
        <div class="px-5 py-8 text-center">
          <i class="fa-solid fa-circle-check mb-2 text-lg text-emerald-500"></i>
          <p class="text-sm text-ink-500">Nothing urgent. Good time to run discovery.</p>
        </div>`}
    </section>`
}

function todayCard(items) {
  return `
    <section class="card">
      ${cardHeader('Today', 'Follow-ups due today or overdue')}
      ${items.length ? `
        <ul class="divide-y divide-ink-100">
          ${items.map((f) => {
            const d = daysUntil(f.due_at)
            const overdue = d !== null && d < 0
            return `
              <li class="flex items-start gap-3 px-5 py-3">
                <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${overdue ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600'}">
                  <i class="fa-solid ${ACTIVITY_ICONS[f.type] || 'fa-clock'} text-[10px]"></i>
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm text-ink-800">${esc(f.description)}</p>
                  <p class="mt-0.5 text-xs text-ink-400">
                    ${f.entity_name ? `${esc(f.entity_name)} · ` : ''}${overdue ? `<span class="font-medium text-rose-600">${Math.abs(d)}d overdue</span>` : 'due today'}
                  </p>
                </div>
              </li>`
          }).join('')}
        </ul>` : `
        <div class="px-5 py-8 text-center text-sm text-ink-500">No follow-ups due today.</div>`}
    </section>`
}

function activityCard(items) {
  return `
    <section class="card">
      ${cardHeader('Recent Activity', 'Latest recorded touches')}
      ${items.length ? `
        <div class="px-5 py-4">
          ${items.map((a) => `
            <div class="timeline-item">
              <span class="timeline-dot bg-brand-500"></span>
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm text-ink-800">${esc(a.description)}</p>
                  <p class="mt-0.5 text-xs text-ink-400">
                    ${badge(a.type)}
                    ${a.entity_name ? `<span class="ml-1">${esc(a.entity_name)}</span>` : ''}
                    ${a.created_by_name ? `<span class="ml-1">· ${esc(a.created_by_name)}</span>` : ''}
                  </p>
                </div>
                <span class="shrink-0 text-xs text-ink-400">${fmtRelative(a.created_at)}</span>
              </div>
            </div>`).join('')}
        </div>` : `
        <div class="px-5 py-8 text-center text-sm text-ink-500">
          No activity recorded yet. Log a call or message on a lead.
        </div>`}
    </section>`
}

function alertsCard(alerts) {
  if (!alerts.length) return ''
  const tones = {
    ERROR: 'border-rose-200 bg-rose-50 text-rose-800',
    WARNING: 'border-amber-200 bg-amber-50 text-amber-800',
    INFO: 'border-ink-200 bg-white text-ink-700'
  }
  const icons = { ERROR: 'fa-circle-exclamation', WARNING: 'fa-triangle-exclamation', INFO: 'fa-circle-info' }
  return `
    <div class="space-y-2">
      ${alerts.map((a) => `
        <div class="flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm ${tones[a.type] || tones.INFO}">
          <i class="fa-solid ${icons[a.type] || icons.INFO} text-xs"></i>
          <span>${esc(a.message)}</span>
        </div>`).join('')}
    </div>`
}

export async function renderDashboard(outlet) {
  outlet.innerHTML = `
    <div class="space-y-4">
      <div class="skeleton h-32 rounded-xl"></div>
      ${skeletonCards(8)}
      ${skeletonBlock(2)}
    </div>`

  let data
  try {
    const res = await api.get('/dashboard')
    data = res.data
  } catch (err) {
    outlet.innerHTML = errorState(err, 'data-retry')
    outlet.querySelector('[data-retry]')?.addEventListener('click', () => renderDashboard(outlet))
    return
  }

  const k = data.kpis
  const money = store.can('finance.read')

  outlet.innerHTML = `
    <div class="space-y-5">
      ${alertsCard(data.alerts)}
      ${healthCard(data.health, k)}

      <section>
        ${sectionHeader('Key numbers', { subtitle: 'Computed live from your database' })}
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          ${money ? kpiTile({
            label: 'Revenue (all time)', value: fmtMoneyShort(k.revenue_total),
            sub: `${fmtMoneyShort(k.revenue_this_month)} this month`,
            icon: 'fa-sack-dollar', tone: 'emerald', href: '#/money'
          }) : ''}
          ${money ? kpiTile({
            label: 'Outstanding', value: fmtMoneyShort(k.outstanding_payments),
            sub: k.overdue_invoices > 0 ? `${k.overdue_invoices} overdue invoice(s)` : 'No overdue invoices',
            icon: 'fa-file-invoice-dollar', tone: k.overdue_invoices > 0 ? 'rose' : 'ink', href: '#/money'
          }) : ''}
          ${store.can('sales.read') ? kpiTile({
            label: 'Pipeline value', value: fmtMoneyShort(k.pipeline_value),
            sub: `${fmtNumber(k.opportunities_open)} open opportunity(ies)`,
            icon: 'fa-chart-line', tone: 'brand', href: '#/sales'
          }) : ''}
          ${store.can('lead.read') ? kpiTile({
            label: 'Hot leads', value: fmtNumber(k.leads_hot),
            sub: `${fmtNumber(k.leads_total)} total · ${fmtNumber(k.leads_new)} new`,
            icon: 'fa-fire', tone: k.leads_hot > 0 ? 'rose' : 'ink', href: '#/leads?priority=HOT'
          }) : ''}
          ${store.can('client.read') ? kpiTile({
            label: 'Active clients', value: fmtNumber(k.clients_active),
            sub: 'Currently engaged', icon: 'fa-handshake', tone: 'ink', href: '#/clients'
          }) : ''}
          ${store.can('project.read') ? kpiTile({
            label: 'Active projects', value: fmtNumber(k.projects_active),
            sub: k.projects_overdue > 0 ? `${k.projects_overdue} past due` : 'All on schedule',
            icon: 'fa-diagram-project', tone: k.projects_overdue > 0 ? 'amber' : 'ink', href: '#/projects'
          }) : ''}
          ${store.can('asset.read') ? kpiTile({
            label: 'Active assets', value: fmtNumber(k.assets_active),
            sub: `${fmtNumber(k.assets_reusable)} reusable`,
            icon: 'fa-cubes', tone: 'ink', href: '#/assets'
          }) : ''}
          ${store.can('resource.read') ? kpiTile({
            label: 'Monthly tool cost', value: fmtMoneyShort(k.resource_monthly_cost),
            sub: 'From active resources', icon: 'fa-toolbox', tone: 'ink', href: '#/resources'
          }) : ''}
        </div>
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        ${priorityActionsCard(data.priority_actions)}
        ${store.can('lead.read') ? pipelineCard(data.pipeline) : ''}
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        ${todayCard(data.today)}
        ${activityCard(data.recent_activity)}
      </div>
    </div>`

  outlet.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.nav))
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(el.dataset.nav) }
    })
  })
}
