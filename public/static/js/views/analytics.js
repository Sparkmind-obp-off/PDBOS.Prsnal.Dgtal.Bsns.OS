/**
 * Analytics view — pipeline funnel, cash trend, asset and source performance.
 *
 * All aggregation happens in SQL (GET /api/analytics). The charts are plain
 * SVG/CSS built from that response: no charting library, no client-side
 * recomputation of business figures.
 */
import {
  api, store, esc, fmtMoney, fmtMoneyShort, fmtNumber, titleCase,
  skeletonBlock, errorState, emptyState, noPermissionState, sectionHeader
} from '../core.js'
import { navigate } from '../router.js'

/** Funnel order — mirrors the lead lifecycle, not alphabetical order. */
const FUNNEL_ORDER = [
  'NEW', 'RESEARCHING', 'QUALIFIED', 'CONTACTED', 'REPLIED',
  'INTERESTED', 'DEMO', 'OFFER', 'WON'
]
const FUNNEL_ASIDE = ['LOST', 'NURTURE']

/** Format a "2026-03" period key as "Mar 2026". */
function periodLabel(period) {
  if (!period) return '—'
  const [y, m] = String(period).split('-')
  const idx = Number(m) - 1
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return months[idx] ? `${months[idx]} ${y}` : period
}

export async function renderAnalytics(outlet) {
  if (!store.can('analytics.read')) {
    outlet.innerHTML = noPermissionState('analytics.read')
    return
  }

  outlet.innerHTML = `<div id="an-root">${skeletonBlock(5)}</div>`
  const root = outlet.querySelector('#an-root')

  let payload
  try {
    payload = await api.get('/analytics')
  } catch (err) {
    root.innerHTML = errorState(err, 'data-retry')
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderAnalytics(outlet))
    return
  }

  const d = payload.data
  const funnelMap = Object.fromEntries(d.funnel.map((r) => [r.status, Number(r.count || 0)]))
  const totalLeads = d.funnel.reduce((s, r) => s + Number(r.count || 0), 0)

  if (!totalLeads && !d.monthly_revenue.length && !d.top_assets.length) {
    root.innerHTML = `<div class="card">${emptyState({
      icon: 'fa-chart-simple',
      title: 'Nothing to analyse yet.',
      message: 'Analytics is computed from your leads, payments and assets. Add records — or seed the demo dataset from Settings — and the trends appear here.',
      actionLabel: 'Go to Leads',
      actionAttr: 'data-goto-leads'
    })}</div>`
    root.querySelector('[data-goto-leads]')?.addEventListener('click', () => navigate('#/leads'))
    return
  }

  root.innerHTML = `
    <div class="space-y-5">
      ${renderCashSection(d)}
      ${renderFunnelSection(funnelMap, totalLeads)}
      <div class="grid gap-5 lg:grid-cols-2">
        ${renderSourceSection(d.leads_by_source)}
        ${renderAssetSection(d.top_assets)}
      </div>
    </div>`

  root.querySelectorAll('[data-nav]').forEach((el) =>
    el.addEventListener('click', () => navigate(el.dataset.nav)))
}

/* ------------------------------------------------------------------ *
 * Cash trend
 * ------------------------------------------------------------------ */

function renderCashSection(d) {
  // Union of both period lists so a month with only expenses still appears.
  const periods = [...new Set([
    ...d.monthly_revenue.map((r) => r.period),
    ...d.monthly_expenses.map((r) => r.period)
  ])].filter(Boolean).sort()

  if (!periods.length) {
    return `<section class="card card-pad">
      ${sectionHeader('Cash trend', { subtitle: 'Revenue vs expenses' })}
      <p class="py-6 text-center text-sm text-ink-500">
        No payments or expenses recorded yet.
      </p>
    </section>`
  }

  const revMap = Object.fromEntries(d.monthly_revenue.map((r) => [r.period, Number(r.amount || 0)]))
  const expMap = Object.fromEntries(d.monthly_expenses.map((r) => [r.period, Number(r.amount || 0)]))
  const rows = periods.map((p) => ({
    period: p,
    revenue: revMap[p] || 0,
    expenses: expMap[p] || 0,
    net: (revMap[p] || 0) - (expMap[p] || 0)
  }))

  const peak = Math.max(...rows.flatMap((r) => [r.revenue, r.expenses]), 1)
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const totalExpenses = rows.reduce((s, r) => s + r.expenses, 0)
  const net = totalRevenue - totalExpenses
  const margin = totalRevenue ? Math.round((net / totalRevenue) * 100) : 0

  return `
    <section class="card card-pad">
      ${sectionHeader('Cash trend', { subtitle: `Last ${rows.length} month(s) with activity` })}

      <div class="mb-5 grid grid-cols-3 gap-3">
        ${miniStat('Revenue', fmtMoneyShort(totalRevenue), 'text-emerald-600')}
        ${miniStat('Expenses', fmtMoneyShort(totalExpenses), 'text-rose-600')}
        ${miniStat('Net', fmtMoneyShort(net), net >= 0 ? 'text-emerald-600' : 'text-rose-600',
                   totalRevenue ? `${margin}% margin` : '')}
      </div>

      <!-- Paired vertical bars: revenue (left) and expenses (right) per month -->
      <div class="overflow-x-auto thin-scroll">
        <div class="flex min-w-full items-end gap-4 px-1 pb-1" style="min-height:11rem">
          ${rows.map((r) => `
            <div class="flex min-w-[3.5rem] flex-1 flex-col items-center gap-2">
              <div class="flex h-32 w-full items-end justify-center gap-1">
                <div class="w-1/3 rounded-t bg-emerald-500/85"
                  style="height:${Math.max(2, Math.round((r.revenue / peak) * 100))}%"
                  title="Revenue ${fmtMoney(r.revenue)}"></div>
                <div class="w-1/3 rounded-t bg-rose-400/85"
                  style="height:${Math.max(2, Math.round((r.expenses / peak) * 100))}%"
                  title="Expenses ${fmtMoney(r.expenses)}"></div>
              </div>
              <div class="text-center">
                <div class="text-[11px] font-medium text-ink-600">${esc(periodLabel(r.period))}</div>
                <div class="text-[11px] tabular-nums ${r.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
                  ${r.net >= 0 ? '+' : ''}${fmtMoneyShort(r.net)}
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <div class="mt-4 flex items-center gap-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-emerald-500"></span>Revenue
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm bg-rose-400"></span>Expenses
        </span>
      </div>
    </section>`
}

/* ------------------------------------------------------------------ *
 * Pipeline funnel
 * ------------------------------------------------------------------ */

function renderFunnelSection(funnelMap, totalLeads) {
  const stages = FUNNEL_ORDER.map((s) => ({ status: s, count: funnelMap[s] || 0 }))
  const aside = FUNNEL_ASIDE.map((s) => ({ status: s, count: funnelMap[s] || 0 }))
                            .filter((s) => s.count > 0)
  const peak = Math.max(...stages.map((s) => s.count), 1)
  const won = funnelMap.WON || 0
  const contacted = stages
    .filter((s) => ['CONTACTED', 'REPLIED', 'INTERESTED', 'DEMO', 'OFFER', 'WON'].includes(s.status))
    .reduce((sum, s) => sum + s.count, 0)
  const winRate = totalLeads ? Math.round((won / totalLeads) * 100) : 0

  return `
    <section class="card card-pad">
      ${sectionHeader('Pipeline funnel', {
        subtitle: `${fmtNumber(totalLeads)} active lead(s) by status`,
        actions: `<button type="button" class="btn btn-secondary btn-sm" data-nav="#/leads">
          Open Leads<i class="fa-solid fa-arrow-right text-[10px]"></i>
        </button>`
      })}

      <div class="mb-5 grid grid-cols-3 gap-3">
        ${miniStat('Reached out', fmtNumber(contacted), 'text-ink-900')}
        ${miniStat('Won', fmtNumber(won), 'text-emerald-600')}
        ${miniStat('Win rate', `${winRate}%`, winRate >= 10 ? 'text-emerald-600' : 'text-ink-900',
                   'of all leads')}
      </div>

      <div class="space-y-2">
        ${stages.map((s) => {
          const pct = Math.round((s.count / peak) * 100)
          const share = totalLeads ? Math.round((s.count / totalLeads) * 100) : 0
          const dim = s.count === 0
          return `
            <button type="button" class="group flex w-full items-center gap-3 text-left"
              data-nav="#/leads?status=${encodeURIComponent(s.status)}">
              <span class="w-24 shrink-0 text-xs ${dim ? 'text-ink-400' : 'text-ink-600'}">
                ${esc(titleCase(s.status))}
              </span>
              <span class="relative h-7 flex-1 overflow-hidden rounded-lg bg-ink-100">
                <span class="absolute inset-y-0 left-0 rounded-lg ${s.status === 'WON' ? 'bg-emerald-500' : 'bg-brand-500'} transition-all group-hover:opacity-90"
                  style="width:${Math.max(s.count ? 4 : 0, pct)}%"></span>
              </span>
              <span class="w-16 shrink-0 text-right text-xs tabular-nums ${dim ? 'text-ink-400' : 'text-ink-700'}">
                ${fmtNumber(s.count)}${share ? ` · ${share}%` : ''}
              </span>
            </button>`
        }).join('')}
      </div>

      ${aside.length ? `
        <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
          <span class="text-xs text-ink-500">Out of pipeline:</span>
          ${aside.map((s) => `
            <button type="button" class="badge bg-ink-100 text-ink-600 hover:bg-ink-200"
              data-nav="#/leads?status=${encodeURIComponent(s.status)}">
              ${esc(titleCase(s.status))} · ${fmtNumber(s.count)}
            </button>`).join('')}
        </div>` : ''}
    </section>`
}

/* ------------------------------------------------------------------ *
 * Lead sources
 * ------------------------------------------------------------------ */

function renderSourceSection(sources) {
  const rows = (sources || []).filter((s) => Number(s.count || 0) > 0)
  const total = rows.reduce((s, r) => s + Number(r.count || 0), 0)

  return `
    <section class="card card-pad">
      ${sectionHeader('Where leads come from', { subtitle: 'Active leads by source' })}
      ${!rows.length
        ? '<p class="py-6 text-center text-sm text-ink-500">No leads recorded yet.</p>'
        : `<div class="space-y-2.5">
            ${rows.map((r) => {
              const count = Number(r.count || 0)
              const pct = total ? Math.round((count / total) * 100) : 0
              return `
                <div>
                  <div class="flex items-center justify-between gap-2 text-sm">
                    <span class="text-ink-700">${esc(titleCase(r.source_key || 'Unknown'))}</span>
                    <span class="tabular-nums text-ink-600">${fmtNumber(count)} · ${pct}%</span>
                  </div>
                  <div class="mt-1 progress-track">
                    <div class="progress-fill bg-brand-500" style="width:${pct}%"></div>
                  </div>
                </div>`
            }).join('')}
          </div>
          <p class="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
            Sources with the best win rate deserve more of your time.
          </p>`}
    </section>`
}

/* ------------------------------------------------------------------ *
 * Asset performance
 * ------------------------------------------------------------------ */

function renderAssetSection(assets) {
  const rows = assets || []
  const anyRevenue = rows.some((a) => Number(a.revenue_attributed || 0) > 0)

  return `
    <section class="card card-pad">
      ${sectionHeader('Asset performance', {
        subtitle: 'Revenue attributed and reuse count',
        actions: `<button type="button" class="btn btn-secondary btn-sm" data-nav="#/assets">
          Open Assets<i class="fa-solid fa-arrow-right text-[10px]"></i>
        </button>`
      })}
      ${!rows.length
        ? '<p class="py-6 text-center text-sm text-ink-500">No assets recorded yet.</p>'
        : `<ul class="divide-y divide-ink-100">
            ${rows.map((a) => `
              <li class="flex items-center justify-between gap-3 py-2.5">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-ink-900">${esc(a.name)}</div>
                  <div class="text-xs text-ink-400">
                    ${esc(titleCase(a.type || ''))} · reused ${fmtNumber(a.usage_count)}×
                  </div>
                </div>
                <div class="shrink-0 text-right">
                  <div class="text-sm font-semibold tabular-nums ${Number(a.revenue_attributed || 0) > 0 ? 'text-emerald-600' : 'text-ink-400'}">
                    ${fmtMoneyShort(a.revenue_attributed)}
                  </div>
                </div>
              </li>`).join('')}
          </ul>
          ${!anyRevenue ? `
            <p class="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
              No revenue attributed yet. Record asset usage on a won project to see which assets actually earn.
            </p>` : ''}`}
    </section>`
}

/* -------------------------------- shared -------------------------------- */

function miniStat(label, value, valueColor = 'text-ink-900', sub = '') {
  return `
    <div class="rounded-xl border border-ink-100 bg-ink-50/60 px-3 py-2.5">
      <div class="text-xs font-medium text-ink-500">${esc(label)}</div>
      <div class="mt-0.5 text-base font-semibold tabular-nums ${valueColor} sm:text-lg">${value}</div>
      ${sub ? `<div class="text-[11px] text-ink-400">${esc(sub)}</div>` : ''}
    </div>`
}
