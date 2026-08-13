/**
 * Settings view — profile, business, preferences, security, roles,
 * AI service status, demo data and the audit log.
 *
 * Every panel reads and writes real database-backed settings; nothing here is
 * a decorative switch. Panels the role cannot access are not rendered at all.
 */
import {
  api, store, esc, badge, fmtNumber, fmtDateTime, fmtRelative, titleCase, initials,
  options, formValues, confirmDialog,
  skeletonBlock, errorState, emptyState, sectionHeader,
  toast, toastError, withBusy, loadSession
} from '../core.js'
import { navigate, setQuery } from '../router.js'
import { signOut } from '../auth.js'

const CURRENCIES = ['IDR', 'USD', 'SGD', 'MYR', 'EUR', 'AUD']
const TIMEZONES = [
  'Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore',
  'Asia/Kuala_Lumpur', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'UTC'
]

const TABS = [
  { key: 'profile', label: 'Profile', icon: 'fa-user' },
  { key: 'business', label: 'Business', icon: 'fa-building' },
  { key: 'preferences', label: 'Preferences', icon: 'fa-sliders' },
  { key: 'security', label: 'Security', icon: 'fa-shield-halved' },
  { key: 'access', label: 'Roles & access', icon: 'fa-users-gear' },
  { key: 'ai', label: 'AI', icon: 'fa-wand-magic-sparkles' },
  { key: 'data', label: 'Demo data', icon: 'fa-database' },
  { key: 'audit', label: 'Audit log', icon: 'fa-clipboard-list' }
]

/** Read a nested object setting defensively — defaults may be absent. */
function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export async function renderSettings(outlet, query) {
  const tab = TABS.some((t) => t.key === query.tab) ? query.tab : 'profile'

  outlet.innerHTML = `
    <div class="space-y-4">
      <!-- Tab rail: horizontally scrollable on mobile, no wrapping jumble -->
      <nav class="-mx-4 overflow-x-auto px-4 thin-scroll sm:mx-0 sm:px-0" aria-label="Settings sections">
        <div class="inline-flex gap-1 rounded-lg border border-ink-200 bg-white p-1">
          ${TABS.map((t) => `
            <button type="button" data-tab="${t.key}"
              class="flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                t.key === tab ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'}">
              <i class="fa-solid ${t.icon} text-xs"></i>${t.label}
            </button>`).join('')}
        </div>
      </nav>

      <div id="settings-body">${skeletonBlock(3)}</div>
    </div>`

  outlet.querySelectorAll('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => setQuery({ tab: btn.dataset.tab })))

  const body = outlet.querySelector('#settings-body')
  const reload = () => renderSettings(outlet, query)

  try {
    switch (tab) {
      case 'business': await renderBusiness(body, reload); break
      case 'preferences': await renderPreferences(body, reload); break
      case 'security': renderSecurity(body); break
      case 'access': await renderAccess(body); break
      case 'ai': await renderAi(body, reload); break
      case 'data': await renderDemoData(body, reload); break
      case 'audit': await renderAudit(body, query); break
      default: renderProfile(body, reload)
    }
  } catch (err) {
    body.innerHTML = errorState(err, 'data-retry')
    body.querySelector('[data-retry]')?.addEventListener('click', reload)
  }
}

/* ------------------------------------------------------------------ *
 * Profile
 * ------------------------------------------------------------------ */

function renderProfile(body, reload) {
  const u = store.user

  body.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        <div class="mb-5 flex items-center gap-4">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold text-white">
            ${esc(initials(u.name))}
          </div>
          <div class="min-w-0">
            <div class="truncate text-base font-semibold text-ink-900">${esc(u.name)}</div>
            <div class="truncate text-sm text-ink-500">${esc(u.email)}</div>
            <div class="mt-1.5 flex flex-wrap gap-1">
              ${(u.roles || []).map((r) => badge(r)).join('')}
            </div>
          </div>
        </div>

        <form id="profile-form" class="space-y-4" novalidate>
          <div>
            <label class="field-label" for="pf-name">Full name *</label>
            <input id="pf-name" name="name" class="field-input" required maxlength="120"
              value="${esc(u.name || '')}">
          </div>
          <div>
            <label class="field-label" for="pf-email">Email</label>
            <input id="pf-email" class="field-input bg-ink-50" value="${esc(u.email || '')}" disabled>
            <p class="mt-1 text-xs text-ink-400">
              The sign-in email cannot be changed in Phase 0.
            </p>
          </div>
          <div>
            <label class="field-label" for="pf-avatar">Avatar URL</label>
            <input id="pf-avatar" name="avatar_url" type="url" class="field-input" maxlength="500"
              value="${esc(u.avatar_url || '')}" placeholder="https://…">
          </div>
          <div id="pf-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
          <div class="flex justify-end">
            <button type="button" class="btn btn-primary" data-save>Save profile</button>
          </div>
        </form>
      </section>

      <section class="card card-pad">
        ${sectionHeader('Session', { subtitle: 'This device' })}
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-ink-600">
            Signing out ends this session on the server, not only in the browser.
          </p>
          <button type="button" class="btn btn-secondary" data-signout>
            <i class="fa-solid fa-arrow-right-from-bracket text-xs"></i>Sign out
          </button>
        </div>
      </section>
    </div>`

  const form = body.querySelector('#profile-form')
  const errorBox = body.querySelector('#pf-error')
  const btn = body.querySelector('[data-save]')

  btn.addEventListener('click', async () => {
    errorBox.classList.add('hidden')
    const values = formValues(form)
    if (!values.name) {
      errorBox.textContent = 'Name is required.'
      errorBox.classList.remove('hidden')
      return
    }
    const restore = withBusy(btn)
    try {
      await api.patch('/auth/profile', {
        name: values.name,
        avatar_url: values.avatar_url ?? ''
      })
      await loadSession()
      toast('Profile updated.', 'success')
      window.dispatchEvent(new CustomEvent('pdbos:session-changed'))
      await reload()
    } catch (err) {
      restore()
      errorBox.textContent = err?.message || 'Could not save the profile.'
      errorBox.classList.remove('hidden')
    }
  })

  body.querySelector('[data-signout]').addEventListener('click', () => signOut())
}

/* ------------------------------------------------------------------ *
 * Business information
 * ------------------------------------------------------------------ */

async function renderBusiness(body, reload) {
  const { data } = await api.get('/settings')
  const org = data.org
  const manage = store.can('settings.manage')

  body.innerHTML = `
    <section class="card card-pad">
      ${sectionHeader('Business information', {
        subtitle: 'Used across invoices, offers and money formatting'
      })}

      <form id="biz-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="bz-name">Business name *</label>
          <input id="bz-name" name="business_name" class="field-input" required maxlength="160"
            value="${esc(org.business_name || '')}" ${manage ? '' : 'disabled'}>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="bz-type">Business type</label>
            <input id="bz-type" name="business_type" class="field-input" maxlength="120"
              value="${esc(org.business_type || '')}" placeholder="e.g. Digital agency (solo)"
              ${manage ? '' : 'disabled'}>
          </div>
          <div>
            <label class="field-label" for="bz-city">City</label>
            <input id="bz-city" name="business_city" class="field-input" maxlength="120"
              value="${esc(org.business_city || '')}" ${manage ? '' : 'disabled'}>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="bz-email">Business email</label>
            <input id="bz-email" name="business_email" type="email" class="field-input" maxlength="200"
              value="${esc(org.business_email || '')}" ${manage ? '' : 'disabled'}>
          </div>
          <div>
            <label class="field-label" for="bz-phone">Business phone</label>
            <input id="bz-phone" name="business_phone" class="field-input" maxlength="60"
              value="${esc(org.business_phone || '')}" ${manage ? '' : 'disabled'}>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="bz-currency">Currency</label>
            <select id="bz-currency" name="currency" class="field-select" ${manage ? '' : 'disabled'}>
              ${options(CURRENCIES, org.currency || 'IDR')}
            </select>
            <p class="mt-1 text-xs text-ink-400">Applies to every money figure in the app.</p>
          </div>
          <div>
            <label class="field-label" for="bz-tz">Timezone</label>
            <select id="bz-tz" name="timezone" class="field-select" ${manage ? '' : 'disabled'}>
              ${options(TIMEZONES, org.timezone || 'Asia/Jakarta')}
            </select>
          </div>
        </div>

        <div>
          <label class="field-label" for="bz-source">Default lead source</label>
          <select id="bz-source" name="default_lead_source" class="field-select" ${manage ? '' : 'disabled'}>
            ${options(store.meta.lead_sources, org.default_lead_source || 'MANUAL')}
          </select>
        </div>

        <div id="bz-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>

        ${manage ? `
          <div class="flex justify-end">
            <button type="button" class="btn btn-primary" data-save>Save business info</button>
          </div>` : `
          <p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <i class="fa-solid fa-lock mr-1.5"></i>
            Your role cannot change business settings (<span class="font-mono text-xs">settings.manage</span>).
          </p>`}
      </form>
    </section>`

  if (!manage) return

  const form = body.querySelector('#biz-form')
  const errorBox = body.querySelector('#bz-error')
  const btn = body.querySelector('[data-save]')

  btn.addEventListener('click', async () => {
    errorBox.classList.add('hidden')
    const values = formValues(form)
    if (!values.business_name) {
      errorBox.textContent = 'Business name is required.'
      errorBox.classList.remove('hidden')
      return
    }
    values.currency = form.elements.currency.value
    values.timezone = form.elements.timezone.value
    values.default_lead_source = form.elements.default_lead_source.value
    // Send cleared text fields explicitly so blanking a value persists.
    for (const key of ['business_type', 'business_city', 'business_email', 'business_phone']) {
      if (values[key] === undefined) values[key] = ''
    }

    const restore = withBusy(btn)
    try {
      await api.patch('/settings/org', values)
      await loadSession()
      toast('Business information saved.', 'success')
      window.dispatchEvent(new CustomEvent('pdbos:session-changed'))
      await reload()
    } catch (err) {
      restore()
      errorBox.textContent = err?.message || 'Could not save business information.'
      errorBox.classList.remove('hidden')
    }
  })
}

/* ------------------------------------------------------------------ *
 * Preferences (per user)
 * ------------------------------------------------------------------ */

async function renderPreferences(body, reload) {
  const { data } = await api.get('/settings')
  const notif = obj(data.user.notification_preferences)
  const ui = obj(data.user.ui_preferences)

  const toggles = [
    { key: 'in_app', label: 'In-app notifications', hint: 'Alerts in the notification panel.' },
    { key: 'follow_up_reminders', label: 'Follow-up reminders', hint: 'Reminders for leads waiting on a reply.' },
    { key: 'money_alerts', label: 'Money alerts', hint: 'Overdue invoices and unusual costs.' }
  ]

  body.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        ${sectionHeader('Notification preferences', { subtitle: 'Applies to your account only' })}
        <div class="divide-y divide-ink-100">
          ${toggles.map((t) => `
            <label class="flex cursor-pointer items-center justify-between gap-4 py-3">
              <span class="min-w-0">
                <span class="block text-sm font-medium text-ink-900">${esc(t.label)}</span>
                <span class="block text-xs text-ink-500">${esc(t.hint)}</span>
              </span>
              <input type="checkbox" name="${t.key}" class="h-5 w-5 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
                ${notif[t.key] === false ? '' : 'checked'}>
            </label>`).join('')}
        </div>
        <p class="mt-3 text-xs text-ink-400">
          External channels (email, WhatsApp) are not implemented in Phase 0 — they connect through the Integration Hub later.
        </p>
      </section>

      <section class="card card-pad">
        ${sectionHeader('Interface', { subtitle: 'How the app opens for you' })}
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="pr-density">Density</label>
            <select id="pr-density" class="field-select">
              ${options(['comfortable', 'compact'], ui.density || 'comfortable')}
            </select>
          </div>
          <div>
            <label class="field-label" for="pr-page">Default page</label>
            <select id="pr-page" class="field-select">
              ${options(
                ['dashboard', 'leads', 'sales', 'projects', 'money'],
                ui.default_page || 'dashboard'
              )}
            </select>
          </div>
        </div>
      </section>

      <div class="flex justify-end">
        <button type="button" class="btn btn-primary" data-save>Save preferences</button>
      </div>
    </div>`

  const btn = body.querySelector('[data-save]')
  btn.addEventListener('click', async () => {
    const notification_preferences = {}
    for (const t of toggles) {
      notification_preferences[t.key] = body.querySelector(`input[name="${t.key}"]`).checked
    }
    const ui_preferences = {
      density: body.querySelector('#pr-density').value,
      default_page: body.querySelector('#pr-page').value
    }
    const restore = withBusy(btn)
    try {
      await api.patch('/settings/user', { notification_preferences, ui_preferences })
      toast('Preferences saved.', 'success')
      await reload()
    } catch (err) {
      restore()
      toastError(err)
    }
  })
}

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

function renderSecurity(body) {
  body.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        ${sectionHeader('Change password', { subtitle: 'You will be signed out afterwards' })}
        <form id="pw-form" class="space-y-4" novalidate>
          <div>
            <label class="field-label" for="pw-current">Current password *</label>
            <input id="pw-current" name="current_password" type="password" class="field-input"
              required autocomplete="current-password">
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="field-label" for="pw-new">New password *</label>
              <input id="pw-new" name="new_password" type="password" class="field-input"
                required minlength="8" autocomplete="new-password">
            </div>
            <div>
              <label class="field-label" for="pw-confirm">Confirm new password *</label>
              <input id="pw-confirm" name="confirm" type="password" class="field-input"
                required minlength="8" autocomplete="new-password">
            </div>
          </div>
          <p class="text-xs text-ink-400">Minimum 8 characters.</p>
          <div id="pw-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
          <div class="flex justify-end">
            <button type="button" class="btn btn-primary" data-save>Change password</button>
          </div>
        </form>
      </section>

      <section class="card card-pad">
        ${sectionHeader('How your account is protected')}
        <ul class="space-y-2.5 text-sm text-ink-600">
          <li class="flex gap-2.5">
            <i class="fa-solid fa-circle-check mt-0.5 text-emerald-500"></i>
            Passwords are stored as PBKDF2-SHA256 hashes with a per-user salt — never in plain text.
          </li>
          <li class="flex gap-2.5">
            <i class="fa-solid fa-circle-check mt-0.5 text-emerald-500"></i>
            Sessions use an HttpOnly cookie holding a hashed server-side token, so JavaScript cannot read it.
          </li>
          <li class="flex gap-2.5">
            <i class="fa-solid fa-circle-check mt-0.5 text-emerald-500"></i>
            Provider credentials are encrypted at rest and never returned to the browser.
          </li>
          <li class="flex gap-2.5">
            <i class="fa-solid fa-circle-info mt-0.5 text-ink-400"></i>
            Two-factor authentication is not implemented in Phase 0.
          </li>
        </ul>
      </section>
    </div>`

  const form = body.querySelector('#pw-form')
  const errorBox = body.querySelector('#pw-error')
  const btn = body.querySelector('[data-save]')

  btn.addEventListener('click', async () => {
    errorBox.classList.add('hidden')
    const values = formValues(form)
    if (!values.current_password || !values.new_password) {
      errorBox.textContent = 'Fill in both the current and the new password.'
      errorBox.classList.remove('hidden')
      return
    }
    if (values.new_password.length < 8) {
      errorBox.textContent = 'The new password must be at least 8 characters.'
      errorBox.classList.remove('hidden')
      return
    }
    if (values.new_password !== values.confirm) {
      errorBox.textContent = 'The new password and its confirmation do not match.'
      errorBox.classList.remove('hidden')
      return
    }

    const restore = withBusy(btn, 'Changing…')
    try {
      await api.post('/auth/password', {
        current_password: values.current_password,
        new_password: values.new_password
      })
      toast('Password changed. Please sign in again.', 'success')
      setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      restore()
      errorBox.textContent = err?.message || 'Could not change the password.'
      errorBox.classList.remove('hidden')
    }
  })
}

/* ------------------------------------------------------------------ *
 * Roles & access
 * ------------------------------------------------------------------ */

async function renderAccess(body) {
  const { data } = await api.get('/auth/permissions')
  const roles = store.meta.roles || []
  const allPermissions = store.meta.permissions || []
  const mine = new Set(data.permissions || [])
  const isOwner = (data.roles || []).includes('OWNER')

  // Group permissions by resource prefix so the matrix reads as modules.
  const groups = allPermissions.reduce((acc, key) => {
    const [resource] = key.split('.')
    ;(acc[resource] = acc[resource] || []).push(key)
    return acc
  }, {})

  body.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        ${sectionHeader('Your access', { subtitle: 'Roles assigned to this account' })}
        <div class="flex flex-wrap gap-1.5">
          ${(data.roles || []).map((r) => badge(r)).join('') || '<span class="text-sm text-ink-500">No roles assigned.</span>'}
        </div>
        ${isOwner ? `
          <p class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <i class="fa-solid fa-crown mr-1.5"></i>
            As OWNER you implicitly hold every permission, including ones added in future phases.
          </p>` : ''}
      </section>

      <section class="card card-pad">
        ${sectionHeader('Permission matrix', {
          subtitle: `${fmtNumber(allPermissions.length)} permission(s) across ${fmtNumber(Object.keys(groups).length)} module(s)`
        })}
        <div class="space-y-4">
          ${Object.entries(groups).map(([resource, keys]) => `
            <div>
              <div class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                ${esc(titleCase(resource))}
              </div>
              <div class="flex flex-wrap gap-1.5">
                ${keys.map((k) => {
                  const held = isOwner || mine.has(k)
                  return `<span class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] ${
                    held ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-ink-200 bg-ink-50 text-ink-400'}">
                    <i class="fa-solid ${held ? 'fa-check' : 'fa-minus'} text-[9px]"></i>${esc(k)}
                  </span>`
                }).join('')}
              </div>
            </div>`).join('')}
        </div>
      </section>

      <section class="card card-pad">
        ${sectionHeader('Roles in this system', { subtitle: 'Defined at bootstrap, extensible later' })}
        <ul class="divide-y divide-ink-100">
          ${roles.map((r) => `
            <li class="flex items-start justify-between gap-3 py-2.5">
              <div class="min-w-0">
                <div class="text-sm font-medium text-ink-900">${esc(r.name)}</div>
                <div class="text-xs text-ink-500">${esc(r.description || '')}</div>
              </div>
              ${(data.roles || []).includes(r.key)
                ? '<span class="badge bg-brand-50 text-brand-700">You</span>'
                : ''}
            </li>`).join('')}
        </ul>
        <p class="mt-3 text-xs text-ink-400">
          Inviting teammates and assigning their roles from the UI arrives in a later phase; the
          <span class="font-mono">user_roles</span> and <span class="font-mono">role_permissions</span>
          tables already support it.
        </p>
      </section>
    </div>`
}

/* ------------------------------------------------------------------ *
 * AI service boundary
 * ------------------------------------------------------------------ */

async function renderAi(body, reload) {
  if (!store.can('ai.read')) {
    body.innerHTML = `<div class="card">${emptyState({
      icon: 'fa-lock',
      title: 'No permission',
      message: 'Your role does not include ai.read.'
    })}</div>`
    return
  }

  const [statusRes, jobsRes] = await Promise.all([
    api.get('/ai/status'),
    api.get('/ai/jobs')
  ])
  const status = statusRes.data
  const jobs = jobsRes.data
  const canRun = store.can('ai.run')

  body.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        ${sectionHeader('AI service', { subtitle: 'One boundary, two interchangeable engines' })}

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold text-emerald-900">Rule engine</span>
              ${badge('ACTIVE')}
            </div>
            <p class="mt-1.5 text-xs text-emerald-800">
              Deterministic scoring and classification. Always available, no external calls, no cost.
            </p>
          </div>
          <div class="rounded-xl border ${status.configured ? 'border-emerald-200 bg-emerald-50' : 'border-ink-200 bg-ink-50'} px-4 py-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold ${status.configured ? 'text-emerald-900' : 'text-ink-800'}">
                LLM provider
              </span>
              ${badge(status.configured ? 'CONNECTED' : 'NOT_CONFIGURED')}
            </div>
            <p class="mt-1.5 text-xs ${status.configured ? 'text-emerald-800' : 'text-ink-600'}">
              ${status.configured
                ? 'Credentials are present server-side; generative operations use the provider.'
                : 'Connect the provider in the Integration Hub to enable generative operations.'}
            </p>
          </div>
        </div>

        <div class="mt-4 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5">
          <div class="text-xs text-ink-600">
            Active engine for new jobs:
            <span class="ml-1 font-mono font-semibold text-ink-900">${esc(status.engine)}</span>
          </div>
        </div>

        <div class="mt-4">
          <div class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Operations</div>
          <div class="flex flex-wrap gap-1.5">
            ${(store.meta.ai_operations || []).map((op) =>
              `<span class="badge bg-ink-100 text-ink-600 font-mono">${esc(op)}</span>`).join('')}
          </div>
          <p class="mt-2 text-xs text-ink-400">
            Operations without an LLM fall back to the rule engine rather than failing, and every run
            is logged to <span class="font-mono">ai_jobs</span>.
          </p>
        </div>

        ${canRun ? `
          <div class="mt-4 flex flex-wrap items-end gap-2 border-t border-ink-100 pt-4">
            <div class="w-full sm:w-48">
              <label class="field-label" for="ai-op">Test an operation</label>
              <select id="ai-op" class="field-select">
                ${options(store.meta.ai_operations || [], 'score')}
              </select>
            </div>
            <button type="button" class="btn btn-secondary" data-run>
              <i class="fa-solid fa-play text-xs"></i>Run test
            </button>
          </div>
          <div id="ai-result" class="mt-3 hidden overflow-x-auto rounded-lg border border-ink-200 bg-ink-950 p-3">
            <pre class="text-xs leading-relaxed text-ink-100"></pre>
          </div>` : ''}
      </section>

      <section class="card card-pad">
        ${sectionHeader('Recent AI jobs', { subtitle: 'Every run is recorded' })}
        ${!jobs.length
          ? '<p class="py-6 text-center text-sm text-ink-500">No AI jobs yet.</p>'
          : `<ul class="divide-y divide-ink-100">
              ${jobs.map((j) => `
                <li class="flex items-start justify-between gap-3 py-2.5">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-ink-900">
                      <span class="font-mono">${esc(j.operation)}</span>
                      ${j.entity_type ? `<span class="ml-1.5 text-xs text-ink-400">on ${esc(j.entity_type)}</span>` : ''}
                    </div>
                    <div class="truncate text-xs text-ink-500">${esc(j.message || '')}</div>
                    <div class="mt-0.5 text-[11px] text-ink-400">
                      ${esc(j.provider_key || 'rule')} · ${fmtRelative(j.created_at)}
                      ${j.duration_ms ? ` · ${fmtNumber(j.duration_ms)}ms` : ''}
                    </div>
                  </div>
                  ${badge(j.status)}
                </li>`).join('')}
            </ul>`}
      </section>
    </div>`

  if (!canRun) return

  const runBtn = body.querySelector('[data-run]')
  runBtn.addEventListener('click', async () => {
    const operation = body.querySelector('#ai-op').value
    const box = body.querySelector('#ai-result')
    const pre = box.querySelector('pre')
    const restore = withBusy(runBtn, 'Running…')
    try {
      // A representative lead payload so the rule engine has something to score.
      const { data } = await api.post('/ai/run', {
        operation,
        input: {
          business_name: 'Salon Ayu',
          category: 'Beauty',
          industry: 'Beauty & Wellness',
          city: 'Bandung',
          phone: '+628123456789',
          website: '',
          social_url: 'https://instagram.com/salonayu',
          status: 'RESEARCHING',
          activity_count: 2
        }
      })
      pre.textContent = JSON.stringify(data, null, 2)
      box.classList.remove('hidden')
      toast(`Ran ${operation} on the ${data.engine} engine.`, 'success')
      restore()
      await reload()
    } catch (err) {
      restore()
      toastError(err)
    }
  })
}

/* ------------------------------------------------------------------ *
 * Demo data
 * ------------------------------------------------------------------ */

async function renderDemoData(body, reload) {
  const { data } = await api.get('/demo-data')
  const manage = store.can('settings.manage')
  const rows = Object.entries(data.counts || {})

  body.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        ${sectionHeader('Demo dataset', {
          subtitle: 'A coherent business scenario for exploring the system'
        })}

        <div class="rounded-xl border ${data.seeded ? 'border-amber-200 bg-amber-50' : 'border-ink-200 bg-ink-50'} px-4 py-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold ${data.seeded ? 'text-amber-900' : 'text-ink-800'}">
                ${data.seeded ? 'Demo data is loaded' : 'No demo data loaded'}
              </div>
              <div class="text-xs ${data.seeded ? 'text-amber-800' : 'text-ink-500'}">
                ${data.seeded
                  ? `${fmtNumber(data.total)} record(s) flagged as demo across ${fmtNumber(rows.length)} table(s).`
                  : 'Seed it to see the dashboard, pipeline and money views populated.'}
              </div>
            </div>
            ${badge(data.seeded ? 'ACTIVE' : 'INACTIVE')}
          </div>
        </div>

        ${rows.length ? `
          <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            ${rows.map(([table, count]) => `
              <div class="rounded-lg border border-ink-100 bg-white px-3 py-2">
                <div class="font-mono text-[11px] text-ink-500">${esc(table)}</div>
                <div class="text-sm font-semibold tabular-nums text-ink-900">${fmtNumber(count)}</div>
              </div>`).join('')}
          </div>` : ''}

        <p class="mt-4 text-xs text-ink-500">
          Every seeded row carries <span class="font-mono">is_demo = 1</span>, so purging removes
          exactly the demo records and never touches data you entered yourself.
        </p>

        ${manage ? `
          <div class="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4">
            <button type="button" class="btn btn-primary" data-seed ${data.seeded ? 'disabled' : ''}>
              <i class="fa-solid fa-seedling text-xs"></i>${data.seeded ? 'Already seeded' : 'Seed demo data'}
            </button>
            <button type="button" class="btn btn-danger" data-purge ${data.seeded ? '' : 'disabled'}>
              <i class="fa-solid fa-trash text-xs"></i>Purge demo data
            </button>
          </div>` : `
          <p class="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <i class="fa-solid fa-lock mr-1.5"></i>
            Managing demo data requires <span class="font-mono text-xs">settings.manage</span>.
          </p>`}
      </section>
    </div>`

  if (!manage) return

  body.querySelector('[data-seed]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    const restore = withBusy(btn, 'Seeding…')
    try {
      const { data: result } = await api.post('/demo-data/seed')
      toast(`Seeded ${fmtNumber(result.total ?? 0)} demo record(s).`, 'success')
      await reload()
    } catch (err) {
      restore()
      toastError(err)
    }
  })

  body.querySelector('[data-purge]')?.addEventListener('click', async (e) => {
    const confirmed = await confirmDialog({
      title: 'Purge demo data?',
      message: 'Every record flagged as demo will be deleted. Records you created yourself are kept.',
      confirmLabel: 'Purge',
      danger: true
    })
    if (!confirmed) return
    const btn = e.currentTarget
    const restore = withBusy(btn, 'Purging…')
    try {
      const { data: result } = await api.post('/demo-data/purge')
      toast(`Removed ${fmtNumber(result.total ?? 0)} demo record(s).`, 'success')
      await reload()
    } catch (err) {
      restore()
      toastError(err)
    }
  })
}

/* ------------------------------------------------------------------ *
 * Audit log
 * ------------------------------------------------------------------ */

const AUDIT_ACTIONS = [
  'LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE',
  'INTEGRATION_TEST', 'PERMISSION_CHANGE', 'SETTINGS_CHANGE', 'AI_RUN'
]

const AUDIT_ICONS = {
  LOGIN: 'fa-arrow-right-to-bracket', LOGOUT: 'fa-arrow-right-from-bracket',
  CREATE: 'fa-plus', UPDATE: 'fa-pen', DELETE: 'fa-trash',
  STATUS_CHANGE: 'fa-arrows-rotate', INTEGRATION_TEST: 'fa-plug-circle-check',
  PERMISSION_CHANGE: 'fa-user-shield', SETTINGS_CHANGE: 'fa-gear', AI_RUN: 'fa-wand-magic-sparkles'
}

async function renderAudit(body, query) {
  if (!store.can('audit.read')) {
    body.innerHTML = `<div class="card">${emptyState({
      icon: 'fa-lock',
      title: 'No permission',
      message: 'Your role does not include audit.read.'
    })}</div>`
    return
  }

  const action = query.action || ''
  const page = Number(query.page || 1)
  const payload = await api.get('/audit', { action: action || undefined, page, per_page: 25 })
  const items = payload.data

  body.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        <div class="flex flex-wrap items-end gap-3">
          <div class="w-full sm:w-56">
            <label class="field-label" for="au-action">Action</label>
            <select id="au-action" class="field-select">
              ${options(AUDIT_ACTIONS, action, 'All actions')}
            </select>
          </div>
        </div>
      </section>

      <div class="card overflow-hidden">
        ${!items.length
          ? emptyState({
              icon: 'fa-clipboard-list',
              title: action ? `No ${esc(titleCase(action))} entries` : 'No audit entries yet.',
              message: 'Sign-ins, record changes and integration tests are recorded here automatically.'
            })
          : `<ul class="divide-y divide-ink-100">
              ${items.map((a) => auditRow(a)).join('')}
            </ul>
            <div class="flex items-center justify-between gap-3 border-t border-ink-100 px-4 py-3">
              <span class="text-xs text-ink-500">
                Page ${page} of ${fmtNumber(payload.meta.total_pages || 1)} · ${fmtNumber(payload.meta.total || 0)} entry(ies)
              </span>
              <div class="flex items-center gap-1">
                <button type="button" class="btn btn-secondary btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>
                  <i class="fa-solid fa-chevron-left text-[10px]"></i>Prev
                </button>
                <button type="button" class="btn btn-secondary btn-sm" data-page="${page + 1}"
                  ${page >= (payload.meta.total_pages || 1) ? 'disabled' : ''}>
                  Next<i class="fa-solid fa-chevron-right text-[10px]"></i>
                </button>
              </div>
            </div>`}
      </div>
    </div>`

  body.querySelector('#au-action').addEventListener('change', (e) =>
    setQuery({ tab: 'audit', action: e.target.value || null }))

  body.querySelectorAll('[data-page]').forEach((btn) =>
    btn.addEventListener('click', () =>
      setQuery({ tab: 'audit', action: action || null, page: btn.dataset.page })))
}

function auditRow(a) {
  let meta = ''
  if (a.metadata) {
    try {
      const parsed = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata
      const pairs = Object.entries(parsed || {})
        .slice(0, 3)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      meta = pairs.join(' · ')
    } catch {
      meta = ''
    }
  }

  return `
    <li class="flex items-start gap-3 px-4 py-3">
      <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
        <i class="fa-solid ${AUDIT_ICONS[a.action] || 'fa-circle-dot'} text-xs"></i>
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-sm font-medium text-ink-900">${esc(titleCase(a.action))}</span>
          <span class="font-mono text-xs text-ink-500">${esc(a.entity || '')}</span>
          ${a.entity_id ? `<span class="font-mono text-[11px] text-ink-400">${esc(a.entity_id)}</span>` : ''}
        </div>
        ${meta ? `<div class="mt-0.5 truncate font-mono text-[11px] text-ink-400">${esc(meta)}</div>` : ''}
        <div class="mt-0.5 text-xs text-ink-500">
          ${esc(a.user_name || a.user_email || 'System')} · ${fmtDateTime(a.created_at)}
        </div>
      </div>
    </li>`
}
