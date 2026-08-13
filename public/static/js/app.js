/**
 * PDBOS client entry point.
 *
 * Boot order:
 *   1. resolve the session (cookie → /api/auth/session)
 *   2. unauthenticated → auth screen, and nothing else is loaded
 *   3. authenticated → load metadata, build the shell chrome, start the router
 *
 * The shell is built from the route table, so navigation, permissions and
 * views cannot drift apart: a route declares its own nav entry and permission.
 */
import {
  api, store, esc, badge, titleCase, initials, fmtRelative, debounce,
  loadSession, loadMeta, toast, toastError, closeModal, emptyState
} from './core.js'
import { route, setNotFound, onBeforeEach, startRouter, navigate, currentRoute, routeTable } from './router.js'
import { renderAuth, signOut } from './auth.js'

import { renderDashboard } from './views/dashboard.js'
import { renderLeadList, renderLeadDetail, openLeadForm, openActivityForm } from './views/leads.js'
import { renderDiscovery } from './views/discovery.js'
import { renderSales } from './views/sales.js'
import { renderClientList, renderClientDetail, openClientForm } from './views/clients.js'
import { renderProjectList, renderProjectDetail, openProjectForm } from './views/projects.js'
import { renderAssetList, renderAssetDetail, openAssetForm } from './views/assets.js'
import { renderResources, openResourceForm } from './views/resources.js'
import { renderMoney } from './views/money.js'
import { renderAnalytics } from './views/analytics.js'
import { renderIntegrations, renderIntegrationDetail } from './views/integrations.js'
import { renderSettings } from './views/settings.js'

/* ------------------------------------------------------------------ *
 * Route table
 *
 * `nav` places the route in the sidebar; `bottom` places it in the mobile
 * bar. `permission` is the read permission the view needs — the shell hides
 * navigation the role cannot use, and the server enforces it regardless.
 * ------------------------------------------------------------------ */

const outlet = () => document.getElementById('view-outlet')

function defineRoutes() {
  route('/dashboard', {
    title: 'Command Center',
    subtitle: 'What matters right now',
    nav: { label: 'Command Center', icon: 'fa-gauge-high', order: 1 },
    bottom: { label: 'Home', icon: 'fa-house', order: 1 },
    render: () => renderDashboard(outlet())
  })

  route('/leads', {
    title: 'Leads',
    subtitle: 'Every business worth contacting',
    permission: 'lead.read',
    nav: { label: 'Leads', icon: 'fa-user-tie', order: 2 },
    bottom: { label: 'Leads', icon: 'fa-user-tie', order: 2 },
    render: ({ query }) => renderLeadList(outlet(), query)
  })
  route('/leads/:id', {
    title: 'Lead',
    permission: 'lead.read',
    parent: '/leads',
    render: ({ params }) => renderLeadDetail(outlet(), params.id)
  })

  route('/discovery', {
    title: 'Discovery',
    subtitle: 'Find businesses to turn into leads',
    permission: 'discovery.run',
    nav: { label: 'Discovery', icon: 'fa-magnifying-glass-location', order: 3 },
    render: () => renderDiscovery(outlet())
  })

  route('/sales', {
    title: 'Sales',
    subtitle: 'Pipeline and offers',
    permission: 'sales.read',
    nav: { label: 'Sales', icon: 'fa-chart-line', order: 4 },
    bottom: { label: 'Sales', icon: 'fa-chart-line', order: 3 },
    render: ({ query }) => renderSales(outlet(), query)
  })

  route('/clients', {
    title: 'Clients',
    subtitle: 'Who you are working for',
    permission: 'client.read',
    nav: { label: 'Clients', icon: 'fa-handshake', order: 5 },
    render: ({ query }) => renderClientList(outlet(), query)
  })
  route('/clients/:id', {
    title: 'Client',
    permission: 'client.read',
    parent: '/clients',
    render: ({ params }) => renderClientDetail(outlet(), params.id)
  })

  route('/projects', {
    title: 'Projects',
    subtitle: 'What has to be delivered',
    permission: 'project.read',
    nav: { label: 'Projects', icon: 'fa-diagram-project', order: 6 },
    bottom: { label: 'Projects', icon: 'fa-diagram-project', order: 4 },
    render: ({ query }) => renderProjectList(outlet(), query)
  })
  route('/projects/:id', {
    title: 'Project',
    permission: 'project.read',
    parent: '/projects',
    render: ({ params }) => renderProjectDetail(outlet(), params.id)
  })

  route('/assets', {
    title: 'Assets',
    subtitle: 'Reusable work that earns again',
    permission: 'asset.read',
    nav: { label: 'Assets', icon: 'fa-cubes', order: 7 },
    render: ({ query }) => renderAssetList(outlet(), query)
  })
  route('/assets/:id', {
    title: 'Asset',
    permission: 'asset.read',
    parent: '/assets',
    render: ({ params }) => renderAssetDetail(outlet(), params.id)
  })

  route('/resources', {
    title: 'Resources',
    subtitle: 'The tools, APIs and accounts you own',
    permission: 'resource.read',
    nav: { label: 'Resources', icon: 'fa-toolbox', order: 8 },
    render: ({ query }) => renderResources(outlet(), query)
  })

  route('/money', {
    title: 'Money',
    subtitle: 'Revenue, invoices and cost',
    permission: 'finance.read',
    nav: { label: 'Money', icon: 'fa-wallet', order: 9 },
    render: ({ query }) => renderMoney(outlet(), query)
  })

  route('/analytics', {
    title: 'Analytics',
    subtitle: 'What the numbers say',
    permission: 'analytics.read',
    nav: { label: 'Analytics', icon: 'fa-chart-pie', order: 10 },
    render: () => renderAnalytics(outlet())
  })

  route('/integrations', {
    title: 'Integrations',
    subtitle: 'Providers this system can talk to',
    permission: 'integration.read',
    nav: { label: 'Integrations', icon: 'fa-plug', order: 11 },
    render: () => renderIntegrations(outlet())
  })
  route('/integrations/:key', {
    title: 'Integration',
    permission: 'integration.read',
    parent: '/integrations',
    render: ({ params }) => renderIntegrationDetail(outlet(), params.key)
  })

  route('/settings', {
    title: 'Settings',
    subtitle: 'Profile, business, access and data',
    nav: { label: 'Settings', icon: 'fa-gear', order: 12 },
    render: ({ query }) => renderSettings(outlet(), query)
  })

  setNotFound((current) => {
    const el = outlet()
    if (!el) return
    el.innerHTML = `<div class="card">${emptyState({
      icon: 'fa-compass',
      title: 'Page not found',
      message: `Nothing is mapped to ${current.path}.`,
      actionLabel: 'Go to Command Center',
      actionAttr: 'data-home'
    })}</div>`
    el.querySelector('[data-home]')?.addEventListener('click', () => navigate('#/dashboard'))
    setChrome({ title: 'Not found', subtitle: '' })
  })
}

/* ------------------------------------------------------------------ *
 * Shell chrome
 * ------------------------------------------------------------------ */

function setChrome({ title, subtitle }) {
  const t = document.getElementById('page-title')
  const s = document.getElementById('page-subtitle')
  if (t) t.textContent = title || 'PDBOS'
  if (s) s.textContent = subtitle || ''
  document.title = title ? `${title} · PDBOS` : 'PDBOS — Personal Digital Business OS'
}

/** Routes the current role may open, in sidebar order. */
function visibleNavRoutes() {
  return routeTable()
    .filter((r) => r.nav && (!r.permission || store.can(r.permission)))
    .sort((a, b) => (a.nav.order || 99) - (b.nav.order || 99))
}

function navItemMarkup(r, activePath, { compact = false } = {}) {
  const active = activePath === r.pattern
  return `
    <a href="#${r.pattern}" data-nav-link="${esc(r.pattern)}"
      class="flex items-center gap-3 rounded-lg px-3 ${compact ? 'py-2' : 'py-2.5'} text-sm font-medium transition ${
        active ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'}"
      ${active ? 'aria-current="page"' : ''}>
      <i class="fa-solid ${r.nav.icon} w-4 shrink-0 text-center text-xs ${active ? '' : 'text-ink-400'}"></i>
      <span class="truncate">${esc(r.nav.label)}</span>
    </a>`
}

function buildSidebar(activePath) {
  const items = visibleNavRoutes()
  const markup = `<div class="space-y-0.5">${items.map((r) => navItemMarkup(r, activePath)).join('')}</div>`

  const sidebar = document.getElementById('sidebar-nav')
  if (sidebar) sidebar.innerHTML = markup

  const drawer = document.getElementById('drawer-nav')
  if (drawer) drawer.innerHTML = markup

  drawer?.querySelectorAll('[data-nav-link]').forEach((a) =>
    a.addEventListener('click', () => closeDrawer()))
}

/**
 * Mobile bar: the four declared bottom routes plus a "More" button that opens
 * the drawer with the full navigation.
 */
function buildBottomNav(activePath) {
  const bar = document.getElementById('bottom-nav')
  if (!bar) return

  const items = routeTable()
    .filter((r) => r.bottom && (!r.permission || store.can(r.permission)))
    .sort((a, b) => (a.bottom.order || 99) - (b.bottom.order || 99))
    .slice(0, 4)

  const cell = (icon, label, { href, active, action } = {}) => {
    const inner = `
      <i class="fa-solid ${icon} text-base ${active ? 'text-ink-900' : 'text-ink-400'}"></i>
      <span class="text-[11px] ${active ? 'font-semibold text-ink-900' : 'text-ink-500'}">${esc(label)}</span>`
    return href
      ? `<a href="${href}" class="flex flex-1 flex-col items-center justify-center gap-1 py-2.5">${inner}</a>`
      : `<button type="button" ${action} class="flex flex-1 flex-col items-center justify-center gap-1 py-2.5">${inner}</button>`
  }

  bar.innerHTML = `
    <div class="flex items-stretch">
      ${items.map((r) => cell(r.bottom.icon, r.bottom.label, {
        href: `#${r.pattern}`,
        active: activePath === r.pattern || activePath.startsWith(`${r.pattern}/`)
      })).join('')}
      ${cell('fa-ellipsis', 'More', { action: 'data-open-drawer' })}
    </div>`

  bar.querySelector('[data-open-drawer]')?.addEventListener('click', openDrawer)
}

function paintIdentity() {
  const org = store.organization?.name || 'Workspace'
  const user = store.user

  const orgEls = [document.getElementById('sidebar-org'), document.getElementById('drawer-org')]
  orgEls.forEach((el) => { if (el) el.textContent = org })

  const name = document.getElementById('sidebar-user-name')
  const role = document.getElementById('sidebar-user-role')
  const avatar = document.getElementById('sidebar-avatar')
  if (name) name.textContent = user?.name || '—'
  if (role) role.textContent = (user?.roles || []).map(titleCase).join(', ') || 'No role'
  if (avatar) avatar.textContent = initials(user?.name)
}

/* ------------------------------- drawer ------------------------------- */

function openDrawer() {
  const d = document.getElementById('mobile-drawer')
  d?.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
}

function closeDrawer() {
  const d = document.getElementById('mobile-drawer')
  d?.classList.add('hidden')
  document.body.style.overflow = ''
}

/* ------------------------------------------------------------------ *
 * Global search
 * ------------------------------------------------------------------ */

const SEARCH_ROUTES = {
  LEAD: '/leads', CLIENT: '/clients', PROJECT: '/projects',
  ASSET: '/assets', RESOURCE: '/resources', OFFER: '/sales'
}
const SEARCH_ICONS = {
  LEAD: 'fa-user-tie', CLIENT: 'fa-handshake', PROJECT: 'fa-diagram-project',
  ASSET: 'fa-cubes', RESOURCE: 'fa-toolbox', OFFER: 'fa-file-contract'
}

function searchHitMarkup(hit) {
  const base = SEARCH_ROUTES[hit.entity_type]
  // Offers have no detail route yet — send the user to the Offers tab instead.
  const target = hit.entity_type === 'OFFER' ? '/sales?tab=offers' : `${base}/${hit.id}`
  return `
    <button type="button" data-hit="${esc(target)}"
      class="flex w-full items-start gap-3 border-b border-ink-100 px-3 py-2.5 text-left last:border-0 hover:bg-ink-50">
      <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
        <i class="fa-solid ${SEARCH_ICONS[hit.entity_type] || 'fa-circle-dot'} text-xs"></i>
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-ink-900">${esc(hit.name)}</span>
        <span class="block truncate text-xs text-ink-500">
          ${esc(titleCase(hit.entity_type))}${hit.subtitle ? ` · ${esc(hit.subtitle)}` : ''}
        </span>
      </span>
      ${hit.status ? badge(hit.status) : ''}
    </button>`
}

function wireSearch(inputId, panelId) {
  const input = document.getElementById(inputId)
  const panel = document.getElementById(panelId)
  if (!input || !panel) return

  const hide = () => panel.classList.add('hidden')
  const show = (html) => {
    panel.innerHTML = html
    panel.classList.remove('hidden')
    panel.querySelectorAll('[data-hit]').forEach((btn) =>
      btn.addEventListener('click', () => {
        hide()
        input.value = ''
        navigate(`#${btn.dataset.hit}`)
      }))
  }

  const run = debounce(async (q) => {
    if (q.length < 2) { hide(); return }
    show('<div class="px-3 py-4 text-center text-xs text-ink-500">Searching…</div>')
    try {
      const { data, meta } = await api.get('/search', { q })
      if (!data.length) {
        show(`<div class="px-3 py-5 text-center text-xs text-ink-500">
          No match for “${esc(meta.query || q)}”.
        </div>`)
        return
      }
      show(data.map(searchHitMarkup).join(''))
    } catch (err) {
      show(`<div class="px-3 py-4 text-center text-xs text-rose-600">${esc(err?.message || 'Search failed.')}</div>`)
    }
  }, 280)

  input.addEventListener('input', () => run(input.value.trim()))
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(input.value.trim()) })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; hide(); input.blur() }
  })

  // Clicking outside the field and its panel dismisses the results.
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== input) hide()
  })
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

const NOTIF_ICONS = {
  INFO: 'fa-circle-info', SUCCESS: 'fa-circle-check', WARNING: 'fa-triangle-exclamation',
  ERROR: 'fa-circle-exclamation', REMINDER: 'fa-bell'
}
const NOTIF_TONES = {
  INFO: 'text-sky-500', SUCCESS: 'text-emerald-500', WARNING: 'text-amber-500',
  ERROR: 'text-rose-500', REMINDER: 'text-violet-500'
}

async function refreshNotifications() {
  try {
    const { data, meta } = await api.get('/notifications', { per_page: 25 })
    store.notifications = { items: data, unread: meta.unread || 0 }
  } catch {
    // A failed poll must never break the shell.
    return
  }
  paintNotifBadge()
  if (!document.getElementById('notif-panel').classList.contains('hidden')) paintNotifList()
}

function paintNotifBadge() {
  const badgeEl = document.getElementById('notif-badge')
  if (!badgeEl) return
  const n = store.notifications.unread
  badgeEl.textContent = n > 99 ? '99+' : String(n)
  badgeEl.classList.toggle('hidden', n === 0)
}

function paintNotifList() {
  const list = document.getElementById('notif-list')
  if (!list) return
  const items = store.notifications.items

  if (!items.length) {
    list.innerHTML = emptyState({
      icon: 'fa-bell-slash',
      title: 'Nothing to report.',
      message: 'Alerts about overdue invoices, follow-ups and system events appear here.'
    })
    return
  }

  list.innerHTML = items.map((n) => `
    <button type="button" ${n.read_at ? '' : `data-read="${esc(n.id)}"`}
      class="flex w-full items-start gap-3 border-b border-ink-100 px-4 py-3 text-left last:border-0 ${
        n.read_at ? 'bg-white' : 'bg-brand-50/40'} hover:bg-ink-50">
      <i class="fa-solid ${NOTIF_ICONS[n.type] || 'fa-circle-info'} mt-0.5 ${NOTIF_TONES[n.type] || 'text-ink-400'}"></i>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-ink-900">${esc(n.title)}</span>
        ${n.message ? `<span class="mt-0.5 block text-xs text-ink-600">${esc(n.message)}</span>` : ''}
        <span class="mt-1 block text-[11px] text-ink-400">${fmtRelative(n.created_at)}</span>
      </span>
      ${n.read_at ? '' : '<span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"></span>'}
    </button>`).join('')

  list.querySelectorAll('[data-read]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await api.post(`/notifications/${btn.dataset.read}/read`)
        await refreshNotifications()
      } catch (err) {
        toastError(err)
      }
    }))
}

function openNotifPanel() {
  document.getElementById('notif-panel')?.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
  paintNotifList()
  refreshNotifications()
}

function closeNotifPanel() {
  document.getElementById('notif-panel')?.classList.add('hidden')
  document.body.style.overflow = ''
}

/* ------------------------------------------------------------------ *
 * Quick add
 * ------------------------------------------------------------------ */

/**
 * Quick actions are filtered by permission, so the menu never offers an
 * action that would be rejected by the server.
 */
function quickActions() {
  const reloadIfOn = (path) => async () => {
    if (currentRoute().path === path) await import('./router.js').then((m) => m.resolve())
  }

  return [
    {
      label: 'Add Lead', icon: 'fa-user-tie', permission: 'lead.create',
      run: () => openLeadForm(null, reloadIfOn('/leads'))
    },
    {
      label: 'Add Client', icon: 'fa-handshake', permission: 'client.create',
      run: () => openClientForm(null, reloadIfOn('/clients'))
    },
    {
      label: 'Add Project', icon: 'fa-diagram-project', permission: 'project.create',
      run: () => openProjectForm(null, reloadIfOn('/projects'))
    },
    {
      label: 'Add Asset', icon: 'fa-cubes', permission: 'asset.manage',
      run: () => openAssetForm(null, reloadIfOn('/assets'))
    },
    {
      label: 'Add Resource', icon: 'fa-toolbox', permission: 'resource.manage',
      run: () => openResourceForm(null, reloadIfOn('/resources'))
    },
    {
      label: 'Add Expense', icon: 'fa-receipt', permission: 'finance.manage',
      run: () => navigate('#/money?tab=expenses')
    },
    {
      label: 'Add Activity', icon: 'fa-comment-dots', permission: 'activity.create',
      run: () => openQuickActivity()
    }
  ].filter((a) => store.can(a.permission))
}

/**
 * An activity must hang off a real record, so the quick action asks which
 * lead or client it belongs to instead of inventing a floating note.
 */
async function openQuickActivity() {
  const { openModal } = await import('./core.js')
  const canLeads = store.can('lead.read')
  const canClients = store.can('client.read')

  const [leads, clients] = await Promise.all([
    canLeads ? api.get('/leads', { per_page: 50 }).then((r) => r.data).catch(() => []) : [],
    canClients ? api.get('/clients', { per_page: 50 }).then((r) => r.data).catch(() => []) : []
  ])

  if (!leads.length && !clients.length) {
    toast('Add a lead or client first — an activity is always attached to a record.', 'warning')
    return
  }

  openModal({
    title: 'Log activity on…',
    size: 'lg',
    body: `
      <div class="space-y-4">
        <div>
          <label class="field-label" for="qa-target">Record</label>
          <select id="qa-target" class="field-select">
            ${leads.length ? `<optgroup label="Leads">${leads.map((l) =>
              `<option value="LEAD:${esc(l.id)}:${esc(l.business_name)}">${esc(l.business_name)}</option>`).join('')}</optgroup>` : ''}
            ${clients.length ? `<optgroup label="Clients">${clients.map((c) =>
              `<option value="CLIENT:${esc(c.id)}:${esc(c.name)}">${esc(c.name)}</option>`).join('')}</optgroup>` : ''}
          </select>
        </div>
      </div>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-next>Continue</button>`,
    onMount: (panel) => {
      panel.querySelector('[data-next]').addEventListener('click', () => {
        const [entityType, entityId, ...rest] = panel.querySelector('#qa-target').value.split(':')
        closeModal()
        openActivityForm(
          { entityType, entityId, entityName: rest.join(':') },
          async () => {
            const path = entityType === 'LEAD' ? `/leads/${entityId}` : `/clients/${entityId}`
            if (currentRoute().path === path) await import('./router.js').then((m) => m.resolve())
          }
        )
      })
    }
  })
}

function buildQuickAdd() {
  const menu = document.getElementById('quick-add-menu')
  const btn = document.getElementById('quick-add-btn')
  if (!menu || !btn) return

  const actions = quickActions()
  if (!actions.length) {
    btn.classList.add('hidden')
    return
  }

  menu.innerHTML = actions.map((a, i) => `
    <button type="button" data-qa="${i}"
      class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50">
      <i class="fa-solid ${a.icon} w-4 text-center text-xs text-ink-400"></i>${esc(a.label)}
    </button>`).join('')

  menu.querySelectorAll('[data-qa]').forEach((el) =>
    el.addEventListener('click', () => {
      menu.classList.add('hidden')
      actions[Number(el.dataset.qa)].run()
    }))

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    menu.classList.toggle('hidden')
  })
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) menu.classList.add('hidden')
  })
}

/* ------------------------------------------------------------------ *
 * Static chrome wiring (bound once)
 * ------------------------------------------------------------------ */

function wireChrome() {
  document.getElementById('mobile-menu-btn')?.addEventListener('click', openDrawer)
  document.getElementById('drawer-close')?.addEventListener('click', closeDrawer)
  document.getElementById('drawer-backdrop')?.addEventListener('click', closeDrawer)

  document.getElementById('notif-btn')?.addEventListener('click', openNotifPanel)
  document.getElementById('notif-close')?.addEventListener('click', closeNotifPanel)
  document.getElementById('notif-backdrop')?.addEventListener('click', closeNotifPanel)
  document.getElementById('notif-read-all')?.addEventListener('click', async () => {
    try {
      await api.post('/notifications/read-all')
      await refreshNotifications()
      toast('All notifications marked read.', 'success')
    } catch (err) {
      toastError(err)
    }
  })

  document.getElementById('sidebar-user')?.addEventListener('click', () => navigate('#/settings'))

  document.getElementById('mobile-search-btn')?.addEventListener('click', () => {
    const row = document.getElementById('mobile-search-row')
    row?.classList.toggle('hidden')
    if (!row?.classList.contains('hidden')) document.getElementById('global-search-mobile')?.focus()
  })

  wireSearch('global-search', 'search-results')
  wireSearch('global-search-mobile', 'search-results-mobile')

  // Keyboard: "/" focuses search, Escape closes overlays.
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
    if (e.key === '/' && !typing) {
      e.preventDefault()
      document.getElementById('global-search')?.focus()
    }
    if (e.key === 'Escape') {
      closeDrawer()
      closeNotifPanel()
      document.getElementById('quick-add-menu')?.classList.add('hidden')
    }
  })

  // Profile or business changes repaint the identity block immediately.
  window.addEventListener('pdbos:session-changed', paintIdentity)
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function showShell() {
  document.getElementById('boot-screen')?.classList.add('hidden')
  document.getElementById('auth-screen')?.classList.add('hidden')
  document.getElementById('app-shell')?.classList.remove('hidden')
}

async function startApp() {
  await loadMeta()
  showShell()

  paintIdentity()
  buildQuickAdd()
  wireChrome()

  onBeforeEach((def, current) => {
    // A route the role cannot open is never rendered; the guard redirects.
    if (def?.permission && !store.can(def.permission)) {
      toast('You do not have access to that section.', 'warning')
      navigate('#/dashboard', { replace: true })
      return
    }
    const activeNav = def?.parent || def?.pattern || current.path
    setChrome({ title: def?.title, subtitle: def?.subtitle })
    buildSidebar(activeNav)
    buildBottomNav(activeNav)
    closeDrawer()
    closeModal()
    window.scrollTo({ top: 0 })
  })

  // Default page preference decides where an empty hash lands.
  if (!window.location.hash || window.location.hash === '#/') {
    let start = 'dashboard'
    try {
      const { data } = await api.get('/settings')
      const ui = data.user?.ui_preferences
      if (ui && typeof ui === 'object' && ui.default_page) start = ui.default_page
    } catch {
      // Preference is optional — the dashboard is a safe default.
    }
    window.location.replace(`#/${start}`)
  }

  startRouter()

  await refreshNotifications()
  // Light polling keeps the badge current without a websocket server, which
  // Cloudflare Pages Functions cannot provide.
  setInterval(refreshNotifications, 60_000)
}

async function boot() {
  defineRoutes()

  let authenticated = false
  try {
    authenticated = await loadSession()
  } catch (err) {
    document.getElementById('boot-screen').innerHTML = `
      <div class="max-w-sm px-6 text-center">
        <div class="mb-3 text-rose-500"><i class="fa-solid fa-triangle-exclamation text-2xl"></i></div>
        <h1 class="text-sm font-semibold text-ink-900">PDBOS could not start</h1>
        <p class="mt-1 text-sm text-ink-500">${esc(err?.message || 'The server did not respond.')}</p>
        <button type="button" class="btn btn-primary mt-5" onclick="window.location.reload()">
          <i class="fa-solid fa-rotate-right text-xs"></i>Retry
        </button>
      </div>`
    return
  }

  if (!authenticated) {
    renderAuth(async () => {
      await loadSession()
      await startApp()
    })
    return
  }

  await startApp()
}

// Expose sign-out for the auth module's re-entry path and for debugging.
window.PDBOS = { signOut, refreshNotifications }

boot()
