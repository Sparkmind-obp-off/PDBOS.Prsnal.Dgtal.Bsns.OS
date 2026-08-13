/**
 * PDBOS client core: API transport, session store, formatting, UI primitives.
 * No business data lives here — everything comes from the API.
 */

/* ------------------------------------------------------------------ *
 * API transport
 * ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request(method, path, body) {
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network unavailable. Check your connection and try again.')
  }

  let payload = null
  try {
    payload = await res.json()
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', 'The server returned an unreadable response.')
  }

  if (!res.ok || payload?.ok === false) {
    const err = payload?.error ?? {}
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? 'Request failed.', err.details)
  }
  return payload
}

/** Serialize a query object, dropping empty values. */
function qs(params = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const api = {
  get: (path, params) => request('GET', `${path}${qs(params)}`),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  del: (path) => request('DELETE', path)
}

/* ------------------------------------------------------------------ *
 * Session store
 * ------------------------------------------------------------------ */

export const store = {
  user: null,
  organization: null,
  meta: null,
  notifications: { items: [], unread: 0 },

  get authenticated() {
    return Boolean(this.user)
  },

  /** OWNER implicitly holds every permission (mirrors the server rule). */
  can(permission) {
    if (!this.user) return false
    if (this.user.roles?.includes('OWNER')) return true
    return Boolean(this.user.permissions?.includes(permission))
  },

  canAny(...permissions) {
    return permissions.some((p) => this.can(p))
  },

  get currency() {
    return this.organization?.currency || 'IDR'
  }
}

export async function loadSession() {
  const { data } = await api.get('/auth/session')
  if (data.authenticated) {
    store.user = data.user
    store.organization = data.organization
  } else {
    store.user = null
    store.organization = null
  }
  return store.authenticated
}

export async function loadMeta() {
  if (store.meta) return store.meta
  const { data } = await api.get('/meta')
  store.meta = data
  return data
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

export function fmtMoney(value, currency = store.currency) {
  const n = Number(value || 0)
  try {
    return new Intl.NumberFormat(currency === 'IDR' ? 'id-ID' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    }).format(n)
  } catch {
    return `${currency} ${n.toLocaleString()}`
  }
}

/** Compact money for KPI tiles: Rp 7,5 jt / Rp 1,2 M */
export function fmtMoneyShort(value, currency = store.currency) {
  const n = Number(value || 0)
  const abs = Math.abs(n)
  if (currency === 'IDR') {
    if (abs >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`
    if (abs >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
    if (abs >= 1_000) return `Rp ${(n / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`
    return `Rp ${n.toLocaleString('id-ID')}`
  }
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return fmtMoney(n, currency)
}

export function fmtNumber(value) {
  return Number(value || 0).toLocaleString('id-ID')
}

function parseDate(value) {
  if (!value) return null
  // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC.
  const iso = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtDate(value) {
  const d = parseDate(value)
  if (!d) return '—'
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(value) {
  const d = parseDate(value)
  if (!d) return '—'
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

export function fmtRelative(value) {
  const d = parseDate(value)
  if (!d) return '—'
  const diff = Date.now() - d.getTime()
  const mins = Math.round(diff / 60000)
  if (Math.abs(mins) < 1) return 'just now'
  if (Math.abs(mins) < 60) return mins > 0 ? `${mins}m ago` : `in ${-mins}m`
  const hours = Math.round(mins / 60)
  if (Math.abs(hours) < 24) return hours > 0 ? `${hours}h ago` : `in ${-hours}h`
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return days > 0 ? `${days}d ago` : `in ${-days}d`
  return fmtDate(value)
}

/** Days until a due date; negative means overdue. */
export function daysUntil(value) {
  const d = parseDate(value)
  if (!d) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86_400_000)
}

export function titleCase(value) {
  if (!value) return ''
  return String(value)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

export function initials(name) {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?'
}

/** Escape untrusted text before inserting into innerHTML. */
export function esc(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/* ------------------------------------------------------------------ *
 * Status colour vocabulary
 * ------------------------------------------------------------------ */

const BADGE_STYLES = {
  // Lead status
  NEW: 'bg-sky-50 text-sky-700', RESEARCHING: 'bg-indigo-50 text-indigo-700',
  QUALIFIED: 'bg-violet-50 text-violet-700', CONTACTED: 'bg-amber-50 text-amber-700',
  REPLIED: 'bg-teal-50 text-teal-700', INTERESTED: 'bg-emerald-50 text-emerald-700',
  DEMO: 'bg-cyan-50 text-cyan-700', OFFER: 'bg-blue-50 text-blue-700',
  WON: 'bg-emerald-100 text-emerald-800', LOST: 'bg-ink-100 text-ink-600',
  NURTURE: 'bg-ink-100 text-ink-600',
  // Priority
  LOW: 'bg-ink-100 text-ink-600', MEDIUM: 'bg-sky-50 text-sky-700',
  HIGH: 'bg-amber-50 text-amber-700', HOT: 'bg-rose-50 text-rose-700',
  // Generic state
  ACTIVE: 'bg-emerald-50 text-emerald-700', INACTIVE: 'bg-ink-100 text-ink-600',
  TRIAL: 'bg-amber-50 text-amber-700', LIMITED: 'bg-orange-50 text-orange-700',
  EXPIRED: 'bg-rose-50 text-rose-700',
  DRAFT: 'bg-ink-100 text-ink-600', ARCHIVED: 'bg-ink-100 text-ink-500',
  PAUSED: 'bg-amber-50 text-amber-700', CHURNED: 'bg-rose-50 text-rose-700',
  PROSPECT: 'bg-sky-50 text-sky-700',
  GOOD: 'bg-emerald-50 text-emerald-700', AT_RISK: 'bg-amber-50 text-amber-700',
  CRITICAL: 'bg-rose-50 text-rose-700',
  // Project / task
  PLANNED: 'bg-sky-50 text-sky-700', IN_PROGRESS: 'bg-brand-50 text-brand-700',
  REVIEW: 'bg-violet-50 text-violet-700', DELIVERED: 'bg-emerald-50 text-emerald-700',
  ON_HOLD: 'bg-amber-50 text-amber-700', CANCELLED: 'bg-ink-100 text-ink-500',
  TODO: 'bg-ink-100 text-ink-600', DOING: 'bg-brand-50 text-brand-700',
  BLOCKED: 'bg-rose-50 text-rose-700', DONE: 'bg-emerald-50 text-emerald-700',
  // Sales
  DISCOVERY: 'bg-sky-50 text-sky-700', QUALIFYING: 'bg-indigo-50 text-indigo-700',
  PROPOSAL: 'bg-violet-50 text-violet-700', NEGOTIATION: 'bg-amber-50 text-amber-700',
  SENT: 'bg-sky-50 text-sky-700', VIEWED: 'bg-indigo-50 text-indigo-700',
  ACCEPTED: 'bg-emerald-50 text-emerald-700', REJECTED: 'bg-rose-50 text-rose-700',
  // Money
  PARTIAL: 'bg-amber-50 text-amber-700', PAID: 'bg-emerald-50 text-emerald-700',
  OVERDUE: 'bg-rose-50 text-rose-700', VOID: 'bg-ink-100 text-ink-500',
  // Integrations
  CONNECTED: 'bg-emerald-50 text-emerald-700', DISCONNECTED: 'bg-ink-100 text-ink-600',
  ERROR: 'bg-rose-50 text-rose-700', NOT_CONFIGURED: 'bg-amber-50 text-amber-700',
  // Health
  STRONG: 'bg-emerald-50 text-emerald-700', STABLE: 'bg-sky-50 text-sky-700',
  FRAGILE: 'bg-amber-50 text-amber-700',
  // Notification / audit
  INFO: 'bg-sky-50 text-sky-700', SUCCESS: 'bg-emerald-50 text-emerald-700',
  WARNING: 'bg-amber-50 text-amber-700', REMINDER: 'bg-violet-50 text-violet-700',
  OK: 'bg-emerald-50 text-emerald-700', PENDING: 'bg-ink-100 text-ink-600'
}

export function badge(value, extraClass = '') {
  if (!value) return ''
  const key = String(value).toUpperCase()
  const style = BADGE_STYLES[key] || 'bg-ink-100 text-ink-600'
  return `<span class="badge ${style} ${extraClass}">${esc(titleCase(value))}</span>`
}

export function healthColor(score) {
  const n = Number(score || 0)
  if (n >= 75) return { bar: 'bg-emerald-500', text: 'text-emerald-600' }
  if (n >= 50) return { bar: 'bg-sky-500', text: 'text-sky-600' }
  if (n >= 25) return { bar: 'bg-amber-500', text: 'text-amber-600' }
  return { bar: 'bg-rose-500', text: 'text-rose-600' }
}

export function scoreColor(score) {
  const n = Number(score || 0)
  if (n >= 75) return 'text-rose-600'
  if (n >= 55) return 'text-amber-600'
  if (n >= 35) return 'text-sky-600'
  return 'text-ink-500'
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

const TOAST_STYLES = {
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: 'fa-circle-check' },
  error: { cls: 'border-rose-200 bg-rose-50 text-rose-800', icon: 'fa-circle-exclamation' },
  warning: { cls: 'border-amber-200 bg-amber-50 text-amber-800', icon: 'fa-triangle-exclamation' },
  info: { cls: 'border-ink-200 bg-white text-ink-800', icon: 'fa-circle-info' }
}

export function toast(message, type = 'info', timeout = 3800) {
  const host = document.getElementById('toast-host')
  if (!host) return
  const style = TOAST_STYLES[type] || TOAST_STYLES.info
  const el = document.createElement('div')
  el.className =
    `pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg animate-fade-in-up ${style.cls}`
  el.innerHTML = `
    <i class="fa-solid ${style.icon} mt-0.5 shrink-0"></i>
    <div class="flex-1">${esc(message)}</div>
    <button type="button" class="shrink-0 opacity-50 hover:opacity-100" aria-label="Dismiss">
      <i class="fa-solid fa-xmark text-xs"></i>
    </button>`
  el.querySelector('button').addEventListener('click', () => el.remove())
  host.appendChild(el)
  if (timeout) setTimeout(() => el.remove(), timeout)
}

/** Uniform error surfacing: permission and configuration errors read differently. */
export function toastError(err) {
  if (err instanceof ApiError) {
    const type = err.code === 'FORBIDDEN' || err.code === 'NOT_CONFIGURED' ? 'warning' : 'error'
    toast(err.message, type)
  } else {
    console.error('[PDBOS]', err)
    toast('Something went wrong. Please try again.', 'error')
  }
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

let modalCleanup = null

export function openModal({ title, body, footer, size = 'lg', onMount }) {
  const host = document.getElementById('modal-host')
  const panel = document.getElementById('modal-panel')
  if (!host || !panel) return

  const sizes = { sm: 'sm:max-w-sm', lg: 'sm:max-w-lg', xl: 'sm:max-w-2xl', '2xl': 'sm:max-w-4xl' }
  panel.className =
    `w-full ${sizes[size] || sizes.lg} max-h-[92vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl animate-slide-up sm:animate-fade-in-up sm:rounded-2xl`
  panel.innerHTML = `
    <header class="flex items-center justify-between gap-3 border-b border-ink-200 px-5 py-4">
      <h2 class="text-base font-semibold text-ink-900">${esc(title)}</h2>
      <button type="button" data-modal-close
        class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100" aria-label="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </header>
    <div class="max-h-[65vh] overflow-y-auto px-5 py-4 thin-scroll" data-modal-body>${body || ''}</div>
    ${footer ? `<footer class="flex items-center justify-end gap-2 border-t border-ink-200 bg-ink-50 px-5 py-3">${footer}</footer>` : ''}`

  host.classList.remove('hidden')
  document.body.style.overflow = 'hidden'

  const close = () => closeModal()
  panel.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', close))
  const backdrop = document.getElementById('modal-backdrop')
  backdrop?.addEventListener('click', close)
  const onKey = (e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)

  modalCleanup = () => {
    backdrop?.removeEventListener('click', close)
    document.removeEventListener('keydown', onKey)
  }

  // Focus the first meaningful control for keyboard and mobile users.
  const first = panel.querySelector('input:not([type=hidden]), select, textarea, button:not([data-modal-close])')
  first?.focus({ preventScroll: true })

  if (onMount) onMount(panel)
  return panel
}

export function closeModal() {
  const host = document.getElementById('modal-host')
  if (!host) return
  host.classList.add('hidden')
  document.body.style.overflow = ''
  document.getElementById('modal-panel').innerHTML = ''
  if (modalCleanup) { modalCleanup(); modalCleanup = null }
}

/** Promise-based confirmation dialog. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      size: 'sm',
      body: `<p class="text-sm text-ink-600">${esc(message)}</p>`,
      footer: `
        <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${esc(confirmLabel)}</button>`,
      onMount: (panel) => {
        panel.querySelector('[data-confirm]').addEventListener('click', () => { closeModal(); resolve(true) })
        panel.querySelectorAll('[data-modal-close]').forEach((b) =>
          b.addEventListener('click', () => resolve(false)))
      }
    })
  })
}

/* ------------------------------------------------------------------ *
 * Reusable render fragments
 * ------------------------------------------------------------------ */

export function skeletonBlock(rows = 3) {
  return `<div class="space-y-3">${Array.from({ length: rows })
    .map(() => '<div class="skeleton h-16 rounded-xl"></div>')
    .join('')}</div>`
}

export function skeletonCards(count = 4) {
  return `<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">${Array.from({ length: count })
    .map(() => '<div class="skeleton h-24 rounded-xl"></div>')
    .join('')}</div>`
}

export function emptyState({ icon = 'fa-inbox', title, message, actionLabel, actionAttr = '' }) {
  return `
    <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-ink-100 text-ink-400">
        <i class="fa-solid ${icon}"></i>
      </div>
      <h3 class="text-sm font-semibold text-ink-900">${esc(title)}</h3>
      ${message ? `<p class="mt-1 max-w-sm text-sm text-ink-500">${esc(message)}</p>` : ''}
      ${actionLabel ? `<button type="button" class="btn btn-primary mt-5" ${actionAttr}>
        <i class="fa-solid fa-plus text-xs"></i>${esc(actionLabel)}</button>` : ''}
    </div>`
}

export function errorState(err, retryAttr = '') {
  const msg = err instanceof ApiError ? err.message : 'Could not load this view.'
  const isPerm = err instanceof ApiError && err.code === 'FORBIDDEN'
  return `
    <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${isPerm ? 'bg-amber-50 text-amber-500' : 'bg-rose-50 text-rose-500'}">
        <i class="fa-solid ${isPerm ? 'fa-lock' : 'fa-triangle-exclamation'}"></i>
      </div>
      <h3 class="text-sm font-semibold text-ink-900">${isPerm ? 'No permission' : 'Something went wrong'}</h3>
      <p class="mt-1 max-w-sm text-sm text-ink-500">${esc(msg)}</p>
      ${!isPerm && retryAttr ? `<button type="button" class="btn btn-secondary mt-5" ${retryAttr}>
        <i class="fa-solid fa-rotate-right text-xs"></i>Try again</button>` : ''}
    </div>`
}

export function noPermissionState(permission) {
  return `
    <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
        <i class="fa-solid fa-lock"></i>
      </div>
      <h3 class="text-sm font-semibold text-ink-900">No permission</h3>
      <p class="mt-1 max-w-sm text-sm text-ink-500">
        Your role does not include <span class="font-mono text-xs">${esc(permission)}</span>.
        Ask an owner to grant it.
      </p>
    </div>`
}

/** Section header used by every module view. */
export function sectionHeader(title, { subtitle, actions = '' } = {}) {
  return `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-wide text-ink-500">${esc(title)}</h2>
        ${subtitle ? `<p class="mt-0.5 text-xs text-ink-400">${esc(subtitle)}</p>` : ''}
      </div>
      ${actions ? `<div class="flex items-center gap-2">${actions}</div>` : ''}
    </div>`
}

/** Server-side pagination control. */
export function paginationBar(meta, attr = 'data-page') {
  const page = Number(meta?.page || 1)
  const totalPages = Number(meta?.total_pages || 1)
  const total = Number(meta?.total || 0)
  if (totalPages <= 1) {
    return `<div class="px-4 py-3 text-xs text-ink-500">${fmtNumber(total)} record(s)</div>`
  }
  return `
    <div class="flex items-center justify-between gap-3 border-t border-ink-100 px-4 py-3">
      <span class="text-xs text-ink-500">Page ${page} of ${totalPages} · ${fmtNumber(total)} record(s)</span>
      <div class="flex items-center gap-1">
        <button type="button" class="btn btn-secondary btn-sm" ${attr}="${page - 1}" ${page <= 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-left text-[10px]"></i>Prev
        </button>
        <button type="button" class="btn btn-secondary btn-sm" ${attr}="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>
          Next<i class="fa-solid fa-chevron-right text-[10px]"></i>
        </button>
      </div>
    </div>`
}

/** Build <option> markup from a list of enum values. */
export function options(list = [], selected, placeholder) {
  const head = placeholder
    ? `<option value="">${esc(placeholder)}</option>`
    : ''
  return head + list
    .map((v) => {
      const value = typeof v === 'string' ? v : v.value
      const label = typeof v === 'string' ? titleCase(v) : v.label
      return `<option value="${esc(value)}"${String(selected) === String(value) ? ' selected' : ''}>${esc(label)}</option>`
    })
    .join('')
}

/** Collect a form's values as a plain object, omitting untouched empties. */
export function formValues(form) {
  const out = {}
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue
    if (el.type === 'checkbox') { out[el.name] = el.checked; continue }
    const v = typeof el.value === 'string' ? el.value.trim() : el.value
    if (v === '') continue
    out[el.name] = v
  }
  return out
}

/** Disable a submit button while a request is in flight. */
export function withBusy(button, label = 'Saving…') {
  if (!button) return () => {}
  const original = button.innerHTML
  button.disabled = true
  button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-xs"></i>${esc(label)}`
  return () => {
    button.disabled = false
    button.innerHTML = original
  }
}

export function debounce(fn, wait = 300) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), wait)
  }
}
