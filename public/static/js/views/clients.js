/**
 * Client OS views — list and detail.
 * A client is the record a WON lead becomes; projects and revenue hang off it.
 */
import {
  api, store, esc, badge, fmtMoney, fmtNumber, fmtDate, fmtRelative,
  options, formValues, openModal, closeModal, confirmDialog,
  skeletonBlock, errorState, emptyState, noPermissionState, paginationBar,
  toast, toastError, withBusy, debounce, initials
} from '../core.js'
import { navigate, setQuery } from '../router.js'
import { openActivityForm } from './leads.js'
import { openProjectForm } from './projects.js'

/* ------------------------------------------------------------------ *
 * Form
 * ------------------------------------------------------------------ */

export function openClientForm(client = null, onSaved) {
  const editing = Boolean(client)
  const m = store.meta

  openModal({
    title: editing ? 'Edit client' : 'Add client',
    size: 'xl',
    body: `
      <form id="client-form" class="space-y-4" novalidate>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="cl-name">Business name *</label>
            <input id="cl-name" name="name" class="field-input" required maxlength="200"
              value="${esc(client?.name || '')}">
          </div>
          <div>
            <label class="field-label" for="cl-industry">Industry</label>
            <input id="cl-industry" name="industry" class="field-input" maxlength="120"
              value="${esc(client?.industry || '')}" placeholder="e.g. Wedding, Beauty">
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="cl-status">Status</label>
            <select id="cl-status" name="status" class="field-select">
              ${options(m.client_statuses, client?.status || 'ACTIVE')}
            </select>
          </div>
          <div>
            <label class="field-label" for="cl-health">Health</label>
            <select id="cl-health" name="health" class="field-select">
              ${options(m.client_health, client?.health || 'GOOD')}
            </select>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="cl-city">City</label>
            <input id="cl-city" name="city" class="field-input" maxlength="120" value="${esc(client?.city || '')}">
          </div>
          <div>
            <label class="field-label" for="cl-website">Website</label>
            <input id="cl-website" name="website" class="field-input" maxlength="300"
              value="${esc(client?.website || '')}" placeholder="https://…">
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="cl-phone">Phone</label>
            <input id="cl-phone" name="phone" type="tel" class="field-input" maxlength="60"
              value="${esc(client?.phone || '')}">
          </div>
          <div>
            <label class="field-label" for="cl-email">Email</label>
            <input id="cl-email" name="email" type="email" class="field-input" maxlength="254"
              value="${esc(client?.email || '')}">
          </div>
        </div>

        <div>
          <label class="field-label" for="cl-notes">Notes</label>
          <textarea id="cl-notes" name="notes" class="field-textarea" maxlength="4000"
            >${esc(client?.notes || '')}</textarea>
        </div>

        <div id="cl-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>${editing ? 'Save changes' : 'Add client'}</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#client-form')
      const errorBox = panel.querySelector('#cl-error')
      const btn = panel.querySelector('[data-save]')
      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.name) {
          errorBox.textContent = 'Business name is required.'
          errorBox.classList.remove('hidden')
          return
        }
        values.status = form.elements.status.value
        values.health = form.elements.health.value

        const restore = withBusy(btn)
        try {
          if (editing) await api.patch(`/clients/${client.id}`, values)
          else await api.post('/clients', values)
          toast(editing ? 'Client updated.' : 'Client added.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not save the client.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

function clientCard(c) {
  return `
    <article class="card card-pad cursor-pointer transition hover:border-ink-300 hover:shadow-sm"
      data-client="${esc(c.id)}" role="button" tabindex="0">
      <div class="flex items-start gap-3">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
          ${esc(initials(c.name))}
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-sm font-semibold text-ink-900">${esc(c.name)}</h3>
          <p class="truncate text-xs text-ink-500">
            ${esc(c.industry || '—')}${c.city ? ` · ${esc(c.city)}` : ''}
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            ${badge(c.status)}${badge(c.health)}
            ${c.is_demo ? '<span class="badge bg-ink-100 text-ink-500">Demo</span>' : ''}
          </div>
          <dl class="mt-3 grid grid-cols-2 gap-x-4 text-xs">
            <div class="flex justify-between gap-2">
              <dt class="text-ink-400">Projects</dt>
              <dd class="font-medium tabular-nums text-ink-700">${fmtNumber(c.project_count)}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-400">Revenue</dt>
              <dd class="font-medium tabular-nums text-emerald-600">${fmtMoney(c.revenue)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </article>`
}

export async function renderClientList(outlet, query) {
  if (!store.can('client.read')) {
    outlet.innerHTML = noPermissionState('client.read')
    return
  }

  const filters = {
    q: query.q || '',
    status: query.status || '',
    page: Number(query.page || 1)
  }

  outlet.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[12rem] flex-1">
            <label class="field-label" for="cl-q">Search</label>
            <input id="cl-q" class="field-input" placeholder="Name, city, email…" value="${esc(filters.q)}">
          </div>
          <div class="w-full sm:w-40">
            <label class="field-label" for="cl-status-f">Status</label>
            <select id="cl-status-f" class="field-select">
              ${options(store.meta.client_statuses, filters.status, 'All statuses')}
            </select>
          </div>
          ${store.can('client.create') ? `
            <button type="button" class="btn btn-primary ml-auto" data-add>
              <i class="fa-solid fa-plus text-xs"></i>Add client
            </button>` : ''}
        </div>
      </section>

      <div id="cl-list">${skeletonBlock(4)}</div>
    </div>`

  const applyFilters = (patch) => setQuery({ ...query, page: 1, ...patch })
  const qInput = outlet.querySelector('#cl-q')
  qInput.addEventListener('input', debounce(() => applyFilters({ q: qInput.value.trim() || null }), 400))
  outlet.querySelector('#cl-status-f').addEventListener('change', (e) => applyFilters({ status: e.target.value || null }))

  const reload = () => renderClientList(outlet, query)
  outlet.querySelector('[data-add]')?.addEventListener('click', () => openClientForm(null, reload))

  const list = outlet.querySelector('#cl-list')
  let payload
  try {
    payload = await api.get('/clients', {
      q: filters.q || undefined,
      status: filters.status || undefined,
      page: filters.page,
      per_page: 24
    })
  } catch (err) {
    list.innerHTML = errorState(err, 'data-retry')
    list.querySelector('[data-retry]')?.addEventListener('click', reload)
    return
  }

  const items = payload.data
  if (!items.length) {
    const hasFilters = Boolean(filters.q || filters.status)
    list.innerHTML = `<div class="card">${
      hasFilters
        ? emptyState({
            icon: 'fa-filter-circle-xmark',
            title: 'No clients match these filters',
            message: 'Try clearing the search or choosing another status.',
            actionLabel: 'Clear filters',
            actionAttr: 'data-clear'
          })
        : emptyState({
            icon: 'fa-handshake',
            title: 'No clients yet.',
            message: 'Convert a WON lead into a client, or add one directly.',
            actionLabel: store.can('client.create') ? 'Add Client' : undefined,
            actionAttr: 'data-add-empty'
          })
    }</div>`
    list.querySelector('[data-clear]')?.addEventListener('click', () => setQuery({}))
    list.querySelector('[data-add-empty]')?.addEventListener('click', () => openClientForm(null, reload))
    return
  }

  list.innerHTML = `
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">${items.map(clientCard).join('')}</div>
    <div class="card mt-3">${paginationBar(payload.meta)}</div>`

  list.querySelectorAll('[data-client]').forEach((el) => {
    const go = () => navigate(`#/clients/${el.dataset.client}`)
    el.addEventListener('click', go)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() }
    })
  })
  list.querySelectorAll('[data-page]').forEach((btn) =>
    btn.addEventListener('click', () => setQuery({ ...query, page: btn.dataset.page })))
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

export async function renderClientDetail(outlet, id) {
  if (!store.can('client.read')) {
    outlet.innerHTML = noPermissionState('client.read')
    return
  }
  outlet.innerHTML = skeletonBlock(4)

  const reload = () => renderClientDetail(outlet, id)

  let data
  try {
    const res = await api.get(`/clients/${id}`)
    data = res.data
  } catch (err) {
    outlet.innerHTML = errorState(err, 'data-retry')
    outlet.querySelector('[data-retry]')?.addEventListener('click', reload)
    return
  }

  const { client: c, projects, activities } = data

  outlet.innerHTML = `
    <div class="space-y-4">
      <button type="button" class="btn btn-ghost btn-sm -ml-2" data-back>
        <i class="fa-solid fa-arrow-left text-[10px]"></i>All clients
      </button>

      <section class="card card-pad">
        <div class="flex flex-wrap items-start gap-4">
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-semibold text-white">
            ${esc(initials(c.name))}
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-semibold text-ink-900">${esc(c.name)}</h2>
            <p class="mt-0.5 text-sm text-ink-500">
              ${esc(c.industry || '—')}${c.city ? ` · ${esc(c.city)}` : ''}
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              ${badge(c.status)}${badge(c.health)}
              ${c.lead_id ? '<span class="badge bg-brand-50 text-brand-700">From lead</span>' : ''}
              ${c.is_demo ? '<span class="badge bg-ink-100 text-ink-500">Demo</span>' : ''}
            </div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-2">
            ${store.can('activity.create') ? `
              <button type="button" class="btn btn-secondary btn-sm" data-log>
                <i class="fa-solid fa-plus text-[10px]"></i>Log activity
              </button>` : ''}
            ${store.can('client.update') ? `
              <button type="button" class="btn btn-secondary btn-sm" data-edit>
                <i class="fa-solid fa-pen text-[10px]"></i>Edit
              </button>` : ''}
            ${store.can('client.delete') ? `
              <button type="button" class="btn btn-ghost btn-sm text-rose-600" data-del>
                <i class="fa-solid fa-trash text-[10px]"></i>Delete
              </button>` : ''}
          </div>
        </div>

        <dl class="mt-5 grid grid-cols-2 gap-4 border-t border-ink-100 pt-4 sm:grid-cols-4">
          <div><dt class="text-xs text-ink-400">Phone</dt>
            <dd class="mt-0.5 truncate text-sm font-medium text-ink-800">
              ${c.phone ? `<a href="tel:${esc(c.phone)}" class="text-brand-700 hover:underline">${esc(c.phone)}</a>` : '—'}
            </dd></div>
          <div><dt class="text-xs text-ink-400">Email</dt>
            <dd class="mt-0.5 truncate text-sm font-medium text-ink-800">
              ${c.email ? `<a href="mailto:${esc(c.email)}" class="text-brand-700 hover:underline">${esc(c.email)}</a>` : '—'}
            </dd></div>
          <div><dt class="text-xs text-ink-400">Website</dt>
            <dd class="mt-0.5 truncate text-sm font-medium text-ink-800">
              ${c.website
                ? `<a href="${esc(c.website)}" target="_blank" rel="noopener noreferrer"
                     class="text-brand-700 hover:underline">Visit</a>`
                : '—'}
            </dd></div>
          <div><dt class="text-xs text-ink-400">Client since</dt>
            <dd class="mt-0.5 text-sm font-medium text-ink-800">${fmtDate(c.created_at)}</dd></div>
        </dl>

        ${c.notes ? `
          <div class="mt-4 rounded-lg bg-ink-50 px-4 py-3">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-500">Notes</h3>
            <p class="mt-1.5 whitespace-pre-wrap text-sm text-ink-700">${esc(c.notes)}</p>
          </div>` : ''}
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="card">
          <header class="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <h3 class="text-sm font-semibold text-ink-900">Projects</h3>
            ${store.can('project.create') ? `
              <button type="button" class="btn btn-secondary btn-sm" data-add-project>
                <i class="fa-solid fa-plus text-[10px]"></i>New project
              </button>` : ''}
          </header>
          ${projects.length ? `
            <ul class="divide-y divide-ink-100">
              ${projects.map((p) => `
                <li class="flex cursor-pointer items-start justify-between gap-3 px-5 py-3 transition hover:bg-ink-50"
                  data-project="${esc(p.id)}" role="button" tabindex="0">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-ink-900">${esc(p.name)}</div>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5">
                      ${badge(p.status)}
                      <span class="text-xs text-ink-400">${fmtNumber(p.task_done)}/${fmtNumber(p.task_count)} tasks</span>
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <div class="text-sm font-semibold tabular-nums text-ink-800">${fmtMoney(p.value)}</div>
                    <div class="mt-0.5 text-xs text-ink-400">${p.due_date ? fmtDate(p.due_date) : 'No due date'}</div>
                  </div>
                </li>`).join('')}
            </ul>`
          : '<div class="px-5 py-8 text-center text-sm text-ink-500">No projects for this client yet.</div>'}
        </section>

        <section class="card">
          <header class="border-b border-ink-100 px-5 py-4">
            <h3 class="text-sm font-semibold text-ink-900">Activity timeline</h3>
          </header>
          ${activities.length ? `
            <ul class="px-5 py-4">
              ${activities.map((a) => `
                <li class="timeline-item">
                  <span class="timeline-dot bg-ink-300"></span>
                  <div class="flex flex-wrap items-center gap-2">
                    ${badge(a.type)}
                    <span class="text-xs text-ink-400">${fmtRelative(a.created_at)}</span>
                    ${a.created_by_name ? `<span class="text-xs text-ink-400">· ${esc(a.created_by_name)}</span>` : ''}
                  </div>
                  <p class="mt-1 text-sm text-ink-700">${esc(a.description)}</p>
                  ${a.outcome ? `<p class="mt-0.5 text-xs text-ink-500">Outcome: ${esc(a.outcome)}</p>` : ''}
                </li>`).join('')}
            </ul>`
          : '<div class="px-5 py-8 text-center text-sm text-ink-500">No activity recorded yet.</div>'}
        </section>
      </div>
    </div>`

  outlet.querySelector('[data-back]').addEventListener('click', () => navigate('#/clients'))
  outlet.querySelector('[data-edit]')?.addEventListener('click', () => openClientForm(c, reload))
  outlet.querySelector('[data-log]')?.addEventListener('click', () =>
    openActivityForm({ entityType: 'CLIENT', entityId: c.id, entityName: c.name }, reload))
  outlet.querySelector('[data-add-project]')?.addEventListener('click', () =>
    openProjectForm({ client_id: c.id }, reload))

  outlet.querySelectorAll('[data-project]').forEach((el) => {
    const go = () => navigate(`#/projects/${el.dataset.project}`)
    el.addEventListener('click', go)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() }
    })
  })

  outlet.querySelector('[data-del]')?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Delete this client?',
      message: `${c.name} will be removed. Projects linked to this client keep their records but lose the link.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!yes) return
    try {
      await api.del(`/clients/${c.id}`)
      toast('Client deleted.', 'success')
      navigate('#/clients')
    } catch (err) {
      toastError(err)
    }
  })
}
