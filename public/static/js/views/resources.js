/**
 * Resource OS view — the tools, APIs, platforms and accounts the business owns.
 *
 * A resource is a *record*, not a live connection. Recording "Google Places API"
 * here does not connect anything; connecting happens in the Integration Hub.
 * That separation is deliberate and surfaced in the UI.
 */
import {
  api, store, esc, badge, fmtMoney, fmtMoneyShort, fmtNumber, fmtRelative, titleCase,
  options, formValues, openModal, closeModal, confirmDialog,
  skeletonBlock, errorState, emptyState, noPermissionState, paginationBar,
  toast, toastError, withBusy, debounce
} from '../core.js'
import { setQuery } from '../router.js'

const TYPE_ICONS = {
  TOOL: 'fa-screwdriver-wrench', API: 'fa-plug', PLATFORM: 'fa-layer-group',
  ACCOUNT: 'fa-id-badge', AI_MODEL: 'fa-brain', SERVICE: 'fa-gears',
  DOMAIN: 'fa-globe', HOSTING: 'fa-server', OTHER: 'fa-box'
}

/* ------------------------------------------------------------------ *
 * Form
 * ------------------------------------------------------------------ */

export function openResourceForm(resource = null, onSaved) {
  const editing = Boolean(resource)
  const m = store.meta

  openModal({
    title: editing ? 'Edit resource' : 'Add resource',
    size: 'xl',
    body: `
      <form id="resource-form" class="space-y-4" novalidate>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="rs-name">Name *</label>
            <input id="rs-name" name="name" class="field-input" required maxlength="160"
              value="${esc(resource?.name || '')}" placeholder="e.g. Cloudflare">
          </div>
          <div>
            <label class="field-label" for="rs-provider">Provider</label>
            <input id="rs-provider" name="provider" class="field-input" maxlength="160"
              value="${esc(resource?.provider || '')}" placeholder="e.g. Cloudflare Inc.">
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="rs-type">Type *</label>
            <select id="rs-type" name="type" class="field-select">
              ${options(m.resource_types, resource?.type || 'TOOL')}
            </select>
          </div>
          <div>
            <label class="field-label" for="rs-status">Status</label>
            <select id="rs-status" name="status" class="field-select">
              ${options(m.resource_statuses, resource?.status || 'ACTIVE')}
            </select>
          </div>
          <div>
            <label class="field-label" for="rs-cost-type">Cost type</label>
            <select id="rs-cost-type" name="cost_type" class="field-select">
              ${options(m.resource_cost_types, resource?.cost_type || 'FREE')}
            </select>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="rs-cost">Monthly cost</label>
            <input id="rs-cost" name="monthly_cost" type="number" min="0" step="1000" class="field-input"
              value="${resource?.monthly_cost ?? ''}" placeholder="0">
            <p class="mt-1 text-xs text-ink-400">Counted in the dashboard only when status is Active.</p>
          </div>
          <div>
            <label class="field-label" for="rs-limit">Usage limit</label>
            <input id="rs-limit" name="usage_limit" class="field-input" maxlength="200"
              value="${esc(resource?.usage_limit || '')}" placeholder="e.g. 100k req/month">
          </div>
        </div>

        <div>
          <label class="field-label" for="rs-capability">Capability</label>
          <input id="rs-capability" name="capability" class="field-input" maxlength="500"
            value="${esc(resource?.capability || '')}"
            placeholder="What can this do for the business?">
        </div>

        <div>
          <label class="field-label" for="rs-description">Description</label>
          <textarea id="rs-description" name="description" class="field-textarea" maxlength="2000"
            >${esc(resource?.description || '')}</textarea>
        </div>

        <div>
          <label class="field-label" for="rs-notes">Notes</label>
          <textarea id="rs-notes" name="notes" class="field-textarea" maxlength="4000"
            >${esc(resource?.notes || '')}</textarea>
        </div>

        <div id="rs-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>${editing ? 'Save changes' : 'Add resource'}</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#resource-form')
      const errorBox = panel.querySelector('#rs-error')
      const btn = panel.querySelector('[data-save]')

      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.name) {
          errorBox.textContent = 'Name is required.'
          errorBox.classList.remove('hidden')
          return
        }
        // Selects always report a value, so send them explicitly on edit too.
        values.type = form.elements.type.value
        values.status = form.elements.status.value
        values.cost_type = form.elements.cost_type.value
        if (values.monthly_cost !== undefined) values.monthly_cost = Number(values.monthly_cost)

        const restore = withBusy(btn)
        try {
          if (editing) await api.patch(`/resources/${resource.id}`, values)
          else await api.post('/resources', values)
          toast(editing ? 'Resource updated.' : 'Resource added.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not save the resource.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

function resourceCard(r) {
  const icon = TYPE_ICONS[r.type] || TYPE_ICONS.OTHER
  return `
    <article class="card card-pad">
      <div class="flex items-start gap-3">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
          <i class="fa-solid ${icon} text-sm"></i>
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-semibold text-ink-900">${esc(r.name)}</h3>
              ${r.provider ? `<p class="truncate text-xs text-ink-500">${esc(r.provider)}</p>` : ''}
            </div>
            ${store.can('resource.manage') ? `
              <div class="flex shrink-0 items-center gap-1">
                <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(r.id)}" aria-label="Edit">
                  <i class="fa-solid fa-pen text-[10px]"></i>
                </button>
                <button type="button" class="btn btn-ghost btn-sm text-rose-600" data-del="${esc(r.id)}" aria-label="Delete">
                  <i class="fa-solid fa-trash text-[10px]"></i>
                </button>
              </div>` : ''}
          </div>

          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            ${badge(r.type)}${badge(r.status)}
            ${r.is_demo ? '<span class="badge bg-ink-100 text-ink-500">Demo</span>' : ''}
          </div>

          ${r.capability ? `<p class="mt-2 line-clamp-2 text-xs text-ink-600">${esc(r.capability)}</p>` : ''}

          <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div class="flex justify-between gap-2">
              <dt class="text-ink-400">Cost</dt>
              <dd class="font-medium tabular-nums text-ink-700">
                ${Number(r.monthly_cost) > 0 ? `${fmtMoney(r.monthly_cost)}/mo` : titleCase(r.cost_type || 'FREE')}
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-400">Limit</dt>
              <dd class="truncate font-medium text-ink-700">${esc(r.usage_limit || '—')}</dd>
            </div>
          </dl>
        </div>
      </div>
    </article>`
}

export async function renderResources(outlet, query) {
  if (!store.can('resource.read')) {
    outlet.innerHTML = noPermissionState('resource.read')
    return
  }

  const m = store.meta
  const filters = {
    q: query.q || '',
    type: query.type || '',
    status: query.status || '',
    page: Number(query.page || 1)
  }

  outlet.innerHTML = `
    <div class="space-y-4">
      <div id="rs-summary" class="grid grid-cols-3 gap-3"></div>

      <section class="card card-pad">
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[12rem] flex-1">
            <label class="field-label" for="rs-q">Search</label>
            <input id="rs-q" class="field-input" placeholder="Name, provider, capability…" value="${esc(filters.q)}">
          </div>
          <div class="w-full sm:w-40">
            <label class="field-label" for="rs-type-f">Type</label>
            <select id="rs-type-f" class="field-select">${options(m.resource_types, filters.type, 'All types')}</select>
          </div>
          <div class="w-full sm:w-40">
            <label class="field-label" for="rs-status-f">Status</label>
            <select id="rs-status-f" class="field-select">${options(m.resource_statuses, filters.status, 'All statuses')}</select>
          </div>
          ${store.can('resource.manage') ? `
            <button type="button" class="btn btn-primary ml-auto" data-add>
              <i class="fa-solid fa-plus text-xs"></i>Add resource
            </button>` : ''}
        </div>
      </section>

      <div id="rs-list">${skeletonBlock(4)}</div>
    </div>`

  const applyFilters = (patch) => setQuery({ ...query, page: 1, ...patch })

  const qInput = outlet.querySelector('#rs-q')
  qInput.addEventListener('input', debounce(() => applyFilters({ q: qInput.value.trim() || null }), 400))
  outlet.querySelector('#rs-type-f').addEventListener('change', (e) => applyFilters({ type: e.target.value || null }))
  outlet.querySelector('#rs-status-f').addEventListener('change', (e) => applyFilters({ status: e.target.value || null }))

  const reload = () => renderResources(outlet, query)
  outlet.querySelector('[data-add]')?.addEventListener('click', () => openResourceForm(null, reload))

  const list = outlet.querySelector('#rs-list')
  let payload
  try {
    payload = await api.get('/resources', {
      q: filters.q || undefined,
      type: filters.type || undefined,
      status: filters.status || undefined,
      page: filters.page,
      per_page: 24
    })
  } catch (err) {
    list.innerHTML = errorState(err, 'data-retry')
    list.querySelector('[data-retry]')?.addEventListener('click', reload)
    return
  }

  // Cost summary comes from the same endpoint (SQL aggregate, not a client sum).
  const s = payload.meta.summary || { total: 0, active: 0, monthly_cost: 0 }
  outlet.querySelector('#rs-summary').innerHTML = `
    ${summaryTile('Total resources', fmtNumber(s.total), 'fa-toolbox')}
    ${summaryTile('Active', fmtNumber(s.active), 'fa-circle-check')}
    ${summaryTile('Monthly cost', fmtMoneyShort(s.monthly_cost), 'fa-money-bill-wave')}`

  const items = payload.data
  if (!items.length) {
    const hasFilters = Boolean(filters.q || filters.type || filters.status)
    list.innerHTML = `<div class="card">${
      hasFilters
        ? emptyState({
            icon: 'fa-filter-circle-xmark',
            title: 'No resources match these filters',
            message: 'Try clearing the search or choosing another type.',
            actionLabel: 'Clear filters',
            actionAttr: 'data-clear'
          })
        : emptyState({
            icon: 'fa-toolbox',
            title: 'No resources yet.',
            message: 'Record the tools, APIs and accounts you already own so the business knows its capability and cost.',
            actionLabel: store.can('resource.manage') ? 'Add Resource' : undefined,
            actionAttr: 'data-add-empty'
          })
    }</div>`
    list.querySelector('[data-clear]')?.addEventListener('click', () => setQuery({}))
    list.querySelector('[data-add-empty]')?.addEventListener('click', () => openResourceForm(null, reload))
    return
  }

  list.innerHTML = `
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      ${items.map(resourceCard).join('')}
    </div>
    <div class="card mt-3">${paginationBar(payload.meta)}</div>`

  list.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const r = items.find((x) => x.id === btn.dataset.edit)
      openResourceForm(r, reload)
    }))

  list.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const r = items.find((x) => x.id === btn.dataset.del)
      const yes = await confirmDialog({
        title: 'Delete this resource?',
        message: `${r.name} will be removed permanently. Expenses linked to it are kept.`,
        confirmLabel: 'Delete',
        danger: true
      })
      if (!yes) return
      try {
        await api.del(`/resources/${r.id}`)
        toast('Resource deleted.', 'success')
        await reload()
      } catch (err) {
        toastError(err)
      }
    }))

  list.querySelectorAll('[data-page]').forEach((btn) =>
    btn.addEventListener('click', () => setQuery({ ...query, page: btn.dataset.page })))
}

function summaryTile(label, value, icon) {
  return `
    <article class="card card-pad">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-medium text-ink-500">${esc(label)}</span>
        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
          <i class="fa-solid ${icon} text-xs"></i>
        </span>
      </div>
      <div class="mt-1.5 text-lg font-semibold tabular-nums text-ink-900 sm:text-xl">${value}</div>
    </article>`
}
