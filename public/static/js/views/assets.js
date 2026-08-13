/**
 * Asset OS views — list and detail.
 *
 * An asset is anything reusable the business produces: a landing page, a prompt,
 * a proposal template, a demo. Usage and attributed revenue are recorded so the
 * "reuse the asset" half of the PDBOS loop has real data behind it.
 */
import {
  api, store, esc, badge, fmtMoney, fmtNumber, fmtDate, fmtRelative, titleCase,
  options, formValues, openModal, closeModal, confirmDialog,
  skeletonBlock, errorState, emptyState, noPermissionState, paginationBar,
  toast, toastError, withBusy, debounce
} from '../core.js'
import { navigate, setQuery } from '../router.js'
import { openActivityForm } from './leads.js'

const TYPE_ICONS = {
  WEBSITE: 'fa-globe', LANDING_PAGE: 'fa-file-lines', COMPONENT: 'fa-puzzle-piece',
  PROMPT: 'fa-wand-magic-sparkles', COPY: 'fa-pen-nib', IMAGE: 'fa-image',
  VIDEO: 'fa-film', BRAND: 'fa-palette', DEMO: 'fa-laptop-code',
  WORKFLOW: 'fa-diagram-project', PROPOSAL: 'fa-file-contract',
  PRICING: 'fa-tags', CODE: 'fa-code', OTHER: 'fa-cube'
}

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

export function openAssetForm(asset = null, onSaved) {
  const editing = Boolean(asset)
  const m = store.meta

  openModal({
    title: editing ? 'Edit asset' : 'Add asset',
    size: 'xl',
    body: `
      <form id="asset-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="as-name">Name *</label>
          <input id="as-name" name="name" class="field-input" required maxlength="160"
            value="${esc(asset?.name || '')}" placeholder="e.g. Wedding Organizer Landing v2">
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="as-type">Type *</label>
            <select id="as-type" name="type" class="field-select">
              ${options(m.asset_types, asset?.type || 'LANDING_PAGE')}
            </select>
          </div>
          <div>
            <label class="field-label" for="as-status">Status</label>
            <select id="as-status" name="status" class="field-select">
              ${options(m.asset_statuses, asset?.status || 'DRAFT')}
            </select>
          </div>
          <div>
            <label class="field-label" for="as-version">Version</label>
            <input id="as-version" name="version" class="field-input" maxlength="40"
              value="${esc(asset?.version || '')}" placeholder="e.g. 1.0.0">
            ${editing ? '<p class="mt-1 text-xs text-ink-400">Changing this records a new version.</p>' : ''}
          </div>
        </div>

        <div>
          <label class="field-label" for="as-niche">Niche</label>
          <input id="as-niche" name="niche" class="field-input" maxlength="120"
            value="${esc(asset?.niche || '')}" placeholder="e.g. Wedding, Barbershop, Restaurant">
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="as-preview">Preview URL</label>
            <input id="as-preview" name="preview_url" type="url" class="field-input" maxlength="500"
              value="${esc(asset?.preview_url || '')}" placeholder="https://…">
          </div>
          <div>
            <label class="field-label" for="as-prod">Production URL</label>
            <input id="as-prod" name="production_url" type="url" class="field-input" maxlength="500"
              value="${esc(asset?.production_url || '')}" placeholder="https://…">
          </div>
        </div>

        <div>
          <label class="field-label" for="as-description">Description</label>
          <textarea id="as-description" name="description" class="field-textarea" maxlength="2000"
            >${esc(asset?.description || '')}</textarea>
        </div>

        <label class="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="reusable" class="h-4 w-4 rounded border-ink-300"
            ${asset ? (asset.reusable ? 'checked' : '') : 'checked'}>
          Reusable across clients
        </label>

        <div>
          <label class="field-label" for="as-notes">Notes</label>
          <textarea id="as-notes" name="notes" class="field-textarea" maxlength="4000"
            >${esc(asset?.notes || '')}</textarea>
        </div>

        <div id="as-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>${editing ? 'Save changes' : 'Add asset'}</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#asset-form')
      const errorBox = panel.querySelector('#as-error')
      const btn = panel.querySelector('[data-save]')

      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.name) {
          errorBox.textContent = 'Name is required.'
          errorBox.classList.remove('hidden')
          return
        }
        values.type = form.elements.type.value
        values.status = form.elements.status.value
        values.reusable = form.elements.reusable.checked

        const restore = withBusy(btn)
        try {
          if (editing) await api.patch(`/assets/${asset.id}`, values)
          else await api.post('/assets', values)
          toast(editing ? 'Asset updated.' : 'Asset added.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not save the asset.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

function openUsageForm(asset, onSaved) {
  openModal({
    title: 'Record usage',
    body: `
      <form id="usage-form" class="space-y-4" novalidate>
        <p class="text-sm text-ink-600">
          Log a reuse of <strong>${esc(asset.name)}</strong>. Attributed revenue rolls up onto the asset,
          which is how Analytics ranks your most valuable assets.
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="us-entity">Used for</label>
            <select id="us-entity" name="entity_type" class="field-select">
              ${options(store.meta.activity_entities, 'CLIENT', 'Not linked')}
            </select>
          </div>
          <div>
            <label class="field-label" for="us-revenue">Revenue attributed</label>
            <input id="us-revenue" name="revenue" type="number" min="0" step="100000" class="field-input" placeholder="0">
          </div>
        </div>
        <div>
          <label class="field-label" for="us-notes">Notes</label>
          <textarea id="us-notes" name="notes" class="field-textarea" maxlength="1000"
            placeholder="e.g. Reused for Client X onboarding site"></textarea>
        </div>
        <div id="us-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>Record</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#usage-form')
      const errorBox = panel.querySelector('#us-error')
      const btn = panel.querySelector('[data-save]')
      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (values.revenue !== undefined) values.revenue = Number(values.revenue)
        const restore = withBusy(btn)
        try {
          await api.post(`/assets/${asset.id}/usage`, values)
          toast('Usage recorded.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not record usage.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

function assetCard(a) {
  const icon = TYPE_ICONS[a.type] || TYPE_ICONS.OTHER
  return `
    <article class="card card-pad cursor-pointer transition hover:border-ink-300 hover:shadow-sm"
      data-asset="${esc(a.id)}" role="button" tabindex="0">
      <div class="flex items-start gap-3">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
          <i class="fa-solid ${icon} text-sm"></i>
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-sm font-semibold text-ink-900">${esc(a.name)}</h3>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            ${badge(a.type)}${badge(a.status)}
            ${a.reusable ? '<span class="badge bg-brand-50 text-brand-700">Reusable</span>' : ''}
            ${a.is_demo ? '<span class="badge bg-ink-100 text-ink-500">Demo</span>' : ''}
          </div>
          ${a.niche ? `<p class="mt-2 truncate text-xs text-ink-500">Niche: ${esc(a.niche)}</p>` : ''}
          <dl class="mt-3 grid grid-cols-2 gap-x-4 text-xs">
            <div class="flex justify-between gap-2">
              <dt class="text-ink-400">Used</dt>
              <dd class="font-medium tabular-nums text-ink-700">${fmtNumber(a.usage_count)}×</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-400">Revenue</dt>
              <dd class="font-medium tabular-nums text-ink-700">${fmtMoney(a.revenue_attributed)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </article>`
}

export async function renderAssetList(outlet, query) {
  if (!store.can('asset.read')) {
    outlet.innerHTML = noPermissionState('asset.read')
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
      <section class="card card-pad">
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[12rem] flex-1">
            <label class="field-label" for="as-q">Search</label>
            <input id="as-q" class="field-input" placeholder="Name, niche, description…" value="${esc(filters.q)}">
          </div>
          <div class="w-full sm:w-44">
            <label class="field-label" for="as-type-f">Type</label>
            <select id="as-type-f" class="field-select">${options(m.asset_types, filters.type, 'All types')}</select>
          </div>
          <div class="w-full sm:w-36">
            <label class="field-label" for="as-status-f">Status</label>
            <select id="as-status-f" class="field-select">${options(m.asset_statuses, filters.status, 'All statuses')}</select>
          </div>
          ${store.can('asset.manage') ? `
            <button type="button" class="btn btn-primary ml-auto" data-add>
              <i class="fa-solid fa-plus text-xs"></i>Add asset
            </button>` : ''}
        </div>
      </section>

      <div id="as-list">${skeletonBlock(4)}</div>
    </div>`

  const applyFilters = (patch) => setQuery({ ...query, page: 1, ...patch })
  const qInput = outlet.querySelector('#as-q')
  qInput.addEventListener('input', debounce(() => applyFilters({ q: qInput.value.trim() || null }), 400))
  outlet.querySelector('#as-type-f').addEventListener('change', (e) => applyFilters({ type: e.target.value || null }))
  outlet.querySelector('#as-status-f').addEventListener('change', (e) => applyFilters({ status: e.target.value || null }))

  const reload = () => renderAssetList(outlet, query)
  outlet.querySelector('[data-add]')?.addEventListener('click', () => openAssetForm(null, reload))

  const list = outlet.querySelector('#as-list')
  let payload
  try {
    payload = await api.get('/assets', {
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

  const items = payload.data
  if (!items.length) {
    const hasFilters = Boolean(filters.q || filters.type || filters.status)
    list.innerHTML = `<div class="card">${
      hasFilters
        ? emptyState({
            icon: 'fa-filter-circle-xmark',
            title: 'No assets match these filters',
            message: 'Try clearing the search or choosing another type.',
            actionLabel: 'Clear filters',
            actionAttr: 'data-clear'
          })
        : emptyState({
            icon: 'fa-cubes',
            title: 'No assets yet.',
            message: 'Every reusable page, prompt, proposal or demo you build should live here so it can earn more than once.',
            actionLabel: store.can('asset.manage') ? 'Add Asset' : undefined,
            actionAttr: 'data-add-empty'
          })
    }</div>`
    list.querySelector('[data-clear]')?.addEventListener('click', () => setQuery({}))
    list.querySelector('[data-add-empty]')?.addEventListener('click', () => openAssetForm(null, reload))
    return
  }

  list.innerHTML = `
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">${items.map(assetCard).join('')}</div>
    <div class="card mt-3">${paginationBar(payload.meta)}</div>`

  list.querySelectorAll('[data-asset]').forEach((el) => {
    const go = () => navigate(`#/assets/${el.dataset.asset}`)
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

export async function renderAssetDetail(outlet, id) {
  if (!store.can('asset.read')) {
    outlet.innerHTML = noPermissionState('asset.read')
    return
  }
  outlet.innerHTML = skeletonBlock(4)

  const reload = () => renderAssetDetail(outlet, id)

  let data
  try {
    const res = await api.get(`/assets/${id}`)
    data = res.data
  } catch (err) {
    outlet.innerHTML = errorState(err, 'data-retry')
    outlet.querySelector('[data-retry]')?.addEventListener('click', reload)
    return
  }

  const { asset: a, versions, usage, activities } = data
  const icon = TYPE_ICONS[a.type] || TYPE_ICONS.OTHER

  outlet.innerHTML = `
    <div class="space-y-4">
      <button type="button" class="btn btn-ghost btn-sm -ml-2" data-back>
        <i class="fa-solid fa-arrow-left text-[10px]"></i>All assets
      </button>

      <section class="card card-pad">
        <div class="flex flex-wrap items-start gap-4">
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-600">
            <i class="fa-solid ${icon}"></i>
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-semibold text-ink-900">${esc(a.name)}</h2>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              ${badge(a.type)}${badge(a.status)}
              ${a.reusable ? '<span class="badge bg-brand-50 text-brand-700">Reusable</span>' : ''}
              ${a.version ? `<span class="badge bg-ink-100 text-ink-600">v${esc(a.version)}</span>` : ''}
              ${a.is_demo ? '<span class="badge bg-ink-100 text-ink-500">Demo</span>' : ''}
            </div>
            ${a.description ? `<p class="mt-3 text-sm text-ink-600">${esc(a.description)}</p>` : ''}
            <div class="mt-3 flex flex-wrap gap-3 text-xs">
              ${a.preview_url ? `<a href="${esc(a.preview_url)}" target="_blank" rel="noopener noreferrer"
                class="text-brand-700 hover:underline"><i class="fa-solid fa-eye mr-1"></i>Preview</a>` : ''}
              ${a.production_url ? `<a href="${esc(a.production_url)}" target="_blank" rel="noopener noreferrer"
                class="text-brand-700 hover:underline"><i class="fa-solid fa-arrow-up-right-from-square mr-1"></i>Production</a>` : ''}
              <span class="text-ink-400">Created ${fmtDate(a.created_at)}</span>
            </div>
          </div>
          ${store.can('asset.manage') ? `
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" class="btn btn-secondary btn-sm" data-usage>
                <i class="fa-solid fa-repeat text-[10px]"></i>Record usage
              </button>
              <button type="button" class="btn btn-secondary btn-sm" data-edit>
                <i class="fa-solid fa-pen text-[10px]"></i>Edit
              </button>
              <button type="button" class="btn btn-ghost btn-sm text-rose-600" data-del>
                <i class="fa-solid fa-trash text-[10px]"></i>Delete
              </button>
            </div>` : ''}
        </div>

        <dl class="mt-5 grid grid-cols-2 gap-4 border-t border-ink-100 pt-4 sm:grid-cols-4">
          <div><dt class="text-xs text-ink-400">Niche</dt>
            <dd class="mt-0.5 text-sm font-medium text-ink-800">${esc(a.niche || '—')}</dd></div>
          <div><dt class="text-xs text-ink-400">Times used</dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-ink-800">${fmtNumber(a.usage_count)}</dd></div>
          <div><dt class="text-xs text-ink-400">Revenue attributed</dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600">${fmtMoney(a.revenue_attributed)}</dd></div>
          <div><dt class="text-xs text-ink-400">Last updated</dt>
            <dd class="mt-0.5 text-sm font-medium text-ink-800">${fmtRelative(a.updated_at)}</dd></div>
        </dl>
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="card">
          <header class="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <h3 class="text-sm font-semibold text-ink-900">Usage history</h3>
            <span class="text-xs text-ink-400">${fmtNumber(usage.length)} record(s)</span>
          </header>
          ${usage.length ? `
            <ul class="divide-y divide-ink-100">
              ${usage.map((u) => `
                <li class="flex items-start justify-between gap-3 px-5 py-3">
                  <div class="min-w-0">
                    <div class="text-sm text-ink-800">
                      ${u.entity_type ? esc(titleCase(u.entity_type)) : 'Unlinked use'}
                    </div>
                    ${u.notes ? `<div class="mt-0.5 text-xs text-ink-500">${esc(u.notes)}</div>` : ''}
                    <div class="mt-0.5 text-xs text-ink-400">${fmtRelative(u.created_at)}</div>
                  </div>
                  <div class="shrink-0 text-sm font-semibold tabular-nums text-emerald-600">
                    ${Number(u.revenue) > 0 ? fmtMoney(u.revenue) : '—'}
                  </div>
                </li>`).join('')}
            </ul>`
          : `<div class="px-5 py-8 text-center text-sm text-ink-500">
               No usage recorded yet. Record a use each time you reuse this asset.
             </div>`}
        </section>

        <section class="card">
          <header class="border-b border-ink-100 px-5 py-4">
            <h3 class="text-sm font-semibold text-ink-900">Versions</h3>
            <p class="mt-0.5 text-xs text-ink-400">Recorded automatically when the version field changes.</p>
          </header>
          ${versions.length ? `
            <ul class="divide-y divide-ink-100">
              ${versions.map((v) => `
                <li class="px-5 py-3">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm font-medium text-ink-900">v${esc(v.version)}</span>
                    <span class="text-xs text-ink-400">${fmtRelative(v.created_at)}</span>
                  </div>
                  ${v.changelog ? `<p class="mt-1 text-xs text-ink-600">${esc(v.changelog)}</p>` : ''}
                  ${v.created_by_name ? `<p class="mt-0.5 text-xs text-ink-400">by ${esc(v.created_by_name)}</p>` : ''}
                </li>`).join('')}
            </ul>`
          : '<div class="px-5 py-8 text-center text-sm text-ink-500">No version history yet.</div>'}
        </section>
      </div>

      <section class="card">
        <header class="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h3 class="text-sm font-semibold text-ink-900">Activity</h3>
          ${store.can('activity.create') ? `
            <button type="button" class="btn btn-secondary btn-sm" data-log>
              <i class="fa-solid fa-plus text-[10px]"></i>Log activity
            </button>` : ''}
        </header>
        ${activities.length ? `
          <ul class="px-5 py-4">
            ${activities.map((act) => `
              <li class="timeline-item">
                <span class="timeline-dot bg-ink-300"></span>
                <div class="flex flex-wrap items-center gap-2">
                  ${badge(act.type)}
                  <span class="text-xs text-ink-400">${fmtRelative(act.created_at)}</span>
                </div>
                <p class="mt-1 text-sm text-ink-700">${esc(act.description)}</p>
              </li>`).join('')}
          </ul>`
        : '<div class="px-5 py-8 text-center text-sm text-ink-500">No activity recorded for this asset.</div>'}
      </section>
    </div>`

  outlet.querySelector('[data-back]').addEventListener('click', () => navigate('#/assets'))
  outlet.querySelector('[data-edit]')?.addEventListener('click', () => openAssetForm(a, reload))
  outlet.querySelector('[data-usage]')?.addEventListener('click', () => openUsageForm(a, reload))
  outlet.querySelector('[data-log]')?.addEventListener('click', () =>
    openActivityForm({ entityType: 'ASSET', entityId: a.id, entityName: a.name }, reload))

  outlet.querySelector('[data-del]')?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Delete this asset?',
      message: `${a.name} and its version/usage history will be removed permanently.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!yes) return
    try {
      await api.del(`/assets/${a.id}`)
      toast('Asset deleted.', 'success')
      navigate('#/assets')
    } catch (err) {
      toastError(err)
    }
  })
}
