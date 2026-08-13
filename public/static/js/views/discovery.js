/**
 * Discovery Engine view.
 *
 * The pipeline behind this screen is real:
 *   Search → Source → Normalize → Deduplicate → Store → Import (as leads)
 *
 * Which provider supplies candidates is decided server-side by the adapter
 * registry. `manual_entry` always works; `google_places` becomes selectable the
 * moment its server secret exists. Nothing here fakes a provider connection.
 */
import {
  api, store, esc, badge, fmtRelative, fmtNumber, titleCase,
  skeletonBlock, errorState, emptyState, noPermissionState, sectionHeader,
  toast, toastError, withBusy
} from '../core.js'
import { navigate } from '../router.js'

function providerCard(p, selectedKey) {
  const selected = p.key === selectedKey
  return `
    <button type="button" data-provider="${esc(p.key)}"
      class="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition
        ${selected ? 'border-ink-900 bg-ink-50' : 'border-ink-200 hover:border-ink-300'}"
      ${p.configured ? '' : 'data-unconfigured'}>
      <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
        ${p.configured ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}">
        <i class="fa-solid ${p.key === 'manual_entry' ? 'fa-keyboard' : 'fa-map-location-dot'} text-xs"></i>
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium text-ink-900">${esc(p.name)}</span>
          ${p.configured
            ? '<span class="badge bg-emerald-50 text-emerald-700">Ready</span>'
            : '<span class="badge bg-amber-50 text-amber-700">Not configured</span>'}
        </span>
        <span class="mt-1 block text-xs text-ink-500">
          ${p.configured
            ? esc(p.capabilities.join(' · '))
            : `Requires server secret <span class="font-mono text-[11px]">${esc(p.secret_ref || 'N/A')}</span>`}
        </span>
      </span>
      ${selected ? '<i class="fa-solid fa-circle-check mt-1 text-xs text-ink-900"></i>' : ''}
    </button>`
}

function resultRow(r) {
  const imported = Boolean(r.existing_lead_id)
  return `
    <tr data-result-row="${esc(r.id)}" class="${imported ? 'opacity-60' : ''}">
      <td class="w-10">
        <input type="checkbox" class="h-4 w-4 rounded border-ink-300" data-result="${esc(r.id)}"
          ${imported ? 'disabled' : ''} aria-label="Select ${esc(r.business_name)}">
      </td>
      <td>
        <div class="font-medium text-ink-900">${esc(r.business_name)}</div>
        <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
          ${r.category ? `<span class="badge bg-ink-100 text-ink-600">${esc(r.category)}</span>` : ''}
          ${!r.website ? '<span class="badge bg-violet-50 text-violet-700">No website</span>' : ''}
          ${imported ? '<span class="badge bg-ink-100 text-ink-500">Already a lead</span>' : ''}
        </div>
      </td>
      <td class="hidden text-ink-600 sm:table-cell">${esc(r.city || '—')}</td>
      <td class="hidden text-ink-600 md:table-cell">${esc(r.phone || '—')}</td>
      <td class="hidden md:table-cell">
        ${r.website
          ? `<a href="${esc(r.website)}" target="_blank" rel="noopener noreferrer"
               class="text-brand-700 hover:underline">Visit</a>`
          : '<span class="text-ink-400">—</span>'}
      </td>
    </tr>`
}

function runsCard(runs) {
  if (!runs.length) {
    return `
      <section class="card">
        <header class="border-b border-ink-100 px-5 py-4">
          <h2 class="text-sm font-semibold text-ink-900">Recent runs</h2>
        </header>
        <div class="px-5 py-6 text-sm text-ink-500">No discovery runs yet.</div>
      </section>`
  }
  return `
    <section class="card">
      <header class="border-b border-ink-100 px-5 py-4">
        <h2 class="text-sm font-semibold text-ink-900">Recent runs</h2>
        <p class="mt-0.5 text-xs text-ink-400">Every search is stored, including failures.</p>
      </header>
      <ul class="divide-y divide-ink-100">
        ${runs.map((r) => `
          <li class="flex items-start gap-3 px-5 py-3">
            <span class="mt-0.5">${badge(r.status === 'OK' ? 'SUCCESS' : r.status)}</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm text-ink-800">${esc(r.query)}</div>
              <div class="mt-0.5 text-xs text-ink-400">
                ${esc(titleCase(r.provider_key))}
                ${r.location ? ` · ${esc(r.location)}` : ''}
                · ${fmtNumber(r.result_count)} found
                · ${fmtNumber(r.imported)} imported
                · ${fmtRelative(r.created_at)}
              </div>
            </div>
          </li>`).join('')}
      </ul>
    </section>`
}

export async function renderDiscovery(outlet) {
  if (!store.can('discovery.read')) {
    outlet.innerHTML = noPermissionState('discovery.read')
    return
  }

  outlet.innerHTML = skeletonBlock(3)

  let providers = []
  let runs = []
  try {
    const [pRes, rRes] = await Promise.all([
      api.get('/discovery/providers'),
      api.get('/discovery/runs')
    ])
    providers = pRes.data
    runs = rRes.data
  } catch (err) {
    outlet.innerHTML = errorState(err, 'data-retry')
    outlet.querySelector('[data-retry]')?.addEventListener('click', () => renderDiscovery(outlet))
    return
  }

  // Prefer a configured provider so the form is usable on first paint.
  let selected = (providers.find((p) => p.configured) || providers[0])?.key || 'manual_entry'
  const canRun = store.can('discovery.run')

  const draw = () => {
    const provider = providers.find((p) => p.key === selected)
    const isManual = selected === 'manual_entry'

    outlet.innerHTML = `
      <div class="space-y-4">
        <section class="card card-pad">
          <div class="mb-4">
            <h2 class="text-sm font-semibold text-ink-900">Find businesses</h2>
            <p class="mt-0.5 text-xs text-ink-500">
              Results are normalized and de-duplicated against your existing leads before import.
            </p>
          </div>

          ${sectionHeader('Source')}
          <div class="grid gap-2 sm:grid-cols-2">
            ${providers.map((p) => providerCard(p, selected)).join('')}
          </div>

          <form id="discovery-form" class="mt-5 space-y-4" novalidate>
            <div>
              <label class="field-label" for="dsc-query">
                ${isManual ? 'Businesses (one per line)' : 'Search query'} *
              </label>
              ${isManual ? `
                <textarea id="dsc-query" name="query" class="field-textarea font-mono text-xs"
                  rows="6" maxlength="2000"
                  placeholder="Salon Ayu | Beauty | Bandung | 08123456789
Barbershop Pak Dedi | Barbershop | Bandung | 08987654321
Katering Bu Sri | Restaurant | Bandung"></textarea>
                <p class="mt-1 text-xs text-ink-400">
                  Format: <span class="font-mono">Name | Category | City | Phone | Website</span> —
                  only the name is required.
                </p>`
              : `
                <input id="dsc-query" name="query" class="field-input" maxlength="2000"
                  placeholder="e.g. wedding organizer, barbershop, catering">`}
            </div>

            <div class="grid gap-4 sm:grid-cols-3">
              <div class="sm:col-span-2">
                <label class="field-label" for="dsc-location">Location</label>
                <input id="dsc-location" name="location" class="field-input" maxlength="160"
                  placeholder="e.g. Bandung, Jawa Barat">
              </div>
              <div>
                <label class="field-label" for="dsc-limit">Max results</label>
                <input id="dsc-limit" name="limit" type="number" min="1" max="20" value="20" class="field-input">
              </div>
            </div>

            ${provider && !provider.configured ? `
              <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <i class="fa-solid fa-triangle-exclamation mr-1.5 text-xs"></i>
                <strong>${esc(provider.name)}</strong> needs the server secret
                <span class="font-mono text-xs">${esc(provider.secret_ref || '')}</span>.
                Add it as a Cloudflare secret, then run Test Connection in
                <button type="button" class="font-semibold underline" data-goto-integrations>Integrations</button>.
              </div>` : ''}

            <div id="dsc-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>

            <div class="flex flex-wrap items-center gap-2">
              <button type="submit" class="btn btn-primary" ${canRun && provider?.configured ? '' : 'disabled'}>
                <i class="fa-solid fa-magnifying-glass-location text-xs"></i>Run discovery
              </button>
              ${!canRun ? '<span class="text-xs text-ink-400">Your role cannot run discovery.</span>' : ''}
            </div>
          </form>
        </section>

        <section id="dsc-results"></section>

        ${runsCard(runs)}
      </div>`

    /* ------------------------------ wiring ------------------------------ */

    outlet.querySelectorAll('[data-provider]').forEach((btn) =>
      btn.addEventListener('click', () => {
        selected = btn.dataset.provider
        draw()
      }))

    outlet.querySelector('[data-goto-integrations]')?.addEventListener('click', () =>
      navigate('#/integrations'))

    outlet.querySelector('#discovery-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const errorBox = outlet.querySelector('#dsc-error')
      errorBox.classList.add('hidden')

      const query = outlet.querySelector('#dsc-query').value.trim()
      const location = outlet.querySelector('#dsc-location').value.trim()
      const limit = Number(outlet.querySelector('#dsc-limit').value || 20)

      if (!query) {
        errorBox.textContent = isManual
          ? 'Enter at least one business line.'
          : 'Enter a search query.'
        errorBox.classList.remove('hidden')
        return
      }

      const submit = e.target.querySelector('button[type=submit]')
      const restore = withBusy(submit, 'Searching…')
      const resultsHost = outlet.querySelector('#dsc-results')
      resultsHost.innerHTML = `<div class="card">${skeletonBlock(3)}</div>`

      try {
        const { data } = await api.post('/discovery/search', {
          provider_key: selected,
          query,
          location: location || undefined,
          limit: Math.min(20, Math.max(1, limit))
        })
        restore()
        renderResults(resultsHost, data, async () => {
          const { data: fresh } = await api.get('/discovery/runs')
          runs = fresh
          draw()
        })
      } catch (err) {
        restore()
        resultsHost.innerHTML = ''
        errorBox.textContent = err?.message || 'Discovery failed.'
        errorBox.classList.remove('hidden')
      }
    })
  }

  draw()
}

/* ------------------------------------------------------------------ *
 * Results + import
 * ------------------------------------------------------------------ */

function renderResults(host, run, onImported) {
  if (!run.results.length) {
    host.innerHTML = `<div class="card">${emptyState({
      icon: 'fa-magnifying-glass',
      title: 'No candidates found',
      message: run.message || 'Try a broader query or a different location.'
    })}</div>`
    return
  }

  const importable = run.results.filter((r) => !r.existing_lead_id).length

  host.innerHTML = `
    <div class="card overflow-hidden">
      <header class="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 class="text-sm font-semibold text-ink-900">
            ${fmtNumber(run.results.length)} candidate(s)
          </h2>
          <p class="mt-0.5 text-xs text-ink-400">
            ${esc(run.message || '')}
            ${importable < run.results.length
              ? ` · ${run.results.length - importable} already in your pipeline`
              : ''}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-secondary btn-sm" data-select-all>Select all</button>
          <button type="button" class="btn btn-primary btn-sm" data-import disabled>
            <i class="fa-solid fa-file-import text-[10px]"></i>Import <span data-count>0</span>
          </button>
        </div>
      </header>

      <div class="overflow-x-auto thin-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th class="w-10"></th>
              <th>Business</th>
              <th class="hidden sm:table-cell">City</th>
              <th class="hidden md:table-cell">Phone</th>
              <th class="hidden md:table-cell">Website</th>
            </tr>
          </thead>
          <tbody>${run.results.map(resultRow).join('')}</tbody>
        </table>
      </div>
    </div>`

  const boxes = Array.from(host.querySelectorAll('[data-result]:not([disabled])'))
  const importBtn = host.querySelector('[data-import]')
  const countEl = host.querySelector('[data-count]')

  const sync = () => {
    const n = boxes.filter((b) => b.checked).length
    countEl.textContent = String(n)
    importBtn.disabled = n === 0 || !store.can('lead.create')
  }

  boxes.forEach((b) => b.addEventListener('change', sync))

  host.querySelector('[data-select-all]').addEventListener('click', () => {
    const allChecked = boxes.every((b) => b.checked)
    boxes.forEach((b) => { b.checked = !allChecked })
    sync()
  })

  importBtn.addEventListener('click', async (e) => {
    const ids = boxes.filter((b) => b.checked).map((b) => b.dataset.result)
    if (!ids.length) return
    const restore = withBusy(e.currentTarget, 'Importing…')
    try {
      const { data } = await api.post('/discovery/import', { result_ids: ids })
      toast(
        `${data.imported} lead(s) imported${data.skipped ? `, ${data.skipped} skipped as duplicates` : ''}.`,
        'success'
      )
      if (onImported) await onImported()
    } catch (err) {
      restore()
      toastError(err)
    }
  })

  sync()
}
