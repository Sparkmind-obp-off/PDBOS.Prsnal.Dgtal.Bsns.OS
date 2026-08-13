/**
 * Integration Hub views — list and detail.
 *
 * The contract enforced by this screen:
 *   UI → business service → integration adapter → external provider
 *
 * The browser never sees a credential. The server reports only
 * `configured: true|false`, so "connected" can never be faked from the client.
 */
import {
  api, store, esc, badge, fmtNumber, fmtRelative, fmtDateTime, titleCase,
  skeletonBlock, errorState, noPermissionState, sectionHeader,
  toast, toastError, withBusy, openModal, closeModal
} from '../core.js'
import { navigate } from '../router.js'

const CATEGORY_ICONS = {
  DISCOVERY: 'fa-magnifying-glass-location',
  AI: 'fa-brain',
  MESSAGING: 'fa-comments',
  PAYMENT: 'fa-credit-card',
  ANALYTICS: 'fa-chart-simple',
  STORAGE: 'fa-database'
}

function statusHint(i) {
  if (!i.configured) {
    return `Server secret <span class="font-mono text-[11px]">${esc(i.secret_ref || 'N/A')}</span> is missing.`
  }
  switch (i.status) {
    case 'CONNECTED': return 'Credential present and last test succeeded.'
    case 'ERROR': return esc(i.last_error || 'Last test failed.')
    case 'DISCONNECTED': return 'Credential present but the integration is switched off.'
    default: return 'Credential present. Run Test Connection to activate.'
  }
}

function integrationCard(i) {
  const icon = CATEGORY_ICONS[i.category] || 'fa-plug'
  return `
    <article class="card card-pad cursor-pointer transition hover:border-ink-300 hover:shadow-sm"
      data-int="${esc(i.provider_key)}" role="button" tabindex="0">
      <div class="flex items-start gap-3">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
          ${i.status === 'CONNECTED' ? 'bg-emerald-50 text-emerald-600'
            : i.status === 'ERROR' ? 'bg-rose-50 text-rose-600'
            : 'bg-ink-100 text-ink-500'}">
          <i class="fa-solid ${icon} text-sm"></i>
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <h3 class="truncate text-sm font-semibold text-ink-900">${esc(i.name)}</h3>
            ${badge(i.status)}
          </div>
          <p class="mt-1 text-xs text-ink-500">${statusHint(i)}</p>
          <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span class="badge bg-ink-100 text-ink-600">${esc(titleCase(i.category))}</span>
            ${i.capabilities.slice(0, 2).map((c) =>
              `<span class="badge bg-ink-50 text-ink-500 font-mono text-[10px]">${esc(c)}</span>`).join('')}
          </div>
          <div class="mt-2.5 flex items-center justify-between text-xs text-ink-400">
            <span>${fmtNumber(i.usage_count)} call(s)</span>
            <span>${i.last_test_at ? `Tested ${fmtRelative(i.last_test_at)}` : 'Never tested'}</span>
          </div>
        </div>
      </div>
    </article>`
}

export async function renderIntegrations(outlet) {
  if (!store.can('integration.read')) {
    outlet.innerHTML = noPermissionState('integration.read')
    return
  }

  outlet.innerHTML = skeletonBlock(4)

  let items
  try {
    const res = await api.get('/integrations')
    items = res.data
  } catch (err) {
    outlet.innerHTML = errorState(err, 'data-retry')
    outlet.querySelector('[data-retry]')?.addEventListener('click', () => renderIntegrations(outlet))
    return
  }

  const byCategory = items.reduce((acc, i) => {
    (acc[i.category] ||= []).push(i)
    return acc
  }, {})

  const connected = items.filter((i) => i.status === 'CONNECTED').length
  const pending = items.filter((i) => !i.configured).length

  outlet.innerHTML = `
    <div class="space-y-5">
      <section class="card card-pad">
        <h2 class="text-sm font-semibold text-ink-900">How integrations work here</h2>
        <p class="mt-1.5 text-sm text-ink-600">
          Business logic never talks to a provider directly. Every external call goes
          <span class="font-medium text-ink-800">UI → service → adapter → provider</span>,
          so a provider can be swapped without touching the modules that use it.
        </p>
        <p class="mt-2 text-sm text-ink-600">
          Credentials live only in the Cloudflare Worker environment. This screen can report
          <em>whether</em> a secret exists — never its value.
        </p>
        <div class="mt-4 flex flex-wrap gap-3 text-xs">
          <span class="badge bg-emerald-50 text-emerald-700">${connected} connected</span>
          <span class="badge bg-amber-50 text-amber-700">${pending} awaiting a secret</span>
          <span class="badge bg-ink-100 text-ink-600">${items.length} provider(s) registered</span>
        </div>
      </section>

      ${Object.entries(byCategory).map(([cat, list]) => `
        <section>
          ${sectionHeader(titleCase(cat), { subtitle: `${list.length} provider(s)` })}
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            ${list.map(integrationCard).join('')}
          </div>
        </section>`).join('')}
    </div>`

  outlet.querySelectorAll('[data-int]').forEach((el) => {
    const go = () => navigate(`#/integrations/${el.dataset.int}`)
    el.addEventListener('click', go)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() }
    })
  })
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

export async function renderIntegrationDetail(outlet, key) {
  if (!store.can('integration.read')) {
    outlet.innerHTML = noPermissionState('integration.read')
    return
  }
  outlet.innerHTML = skeletonBlock(3)

  const reload = () => renderIntegrationDetail(outlet, key)

  let data
  try {
    const res = await api.get(`/integrations/${key}`)
    data = res.data
  } catch (err) {
    outlet.innerHTML = errorState(err, 'data-retry')
    outlet.querySelector('[data-retry]')?.addEventListener('click', reload)
    return
  }

  const i = data.integration
  const logs = data.logs
  const manage = store.can('integration.manage')
  const icon = CATEGORY_ICONS[i.category] || 'fa-plug'
  const configEntries = Object.entries(i.config || {})

  outlet.innerHTML = `
    <div class="space-y-4">
      <button type="button" class="btn btn-ghost btn-sm -ml-2" data-back>
        <i class="fa-solid fa-arrow-left text-[10px]"></i>All integrations
      </button>

      <section class="card card-pad">
        <div class="flex flex-wrap items-start gap-4">
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl
            ${i.status === 'CONNECTED' ? 'bg-emerald-50 text-emerald-600'
              : i.status === 'ERROR' ? 'bg-rose-50 text-rose-600'
              : 'bg-ink-100 text-ink-500'}">
            <i class="fa-solid ${icon}"></i>
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg font-semibold text-ink-900">${esc(i.name)}</h2>
              ${badge(i.status)}
            </div>
            <p class="mt-1 text-sm text-ink-600">${statusHint(i)}</p>
            <div class="mt-3 flex flex-wrap gap-1.5">
              ${i.capabilities.map((c) =>
                `<span class="badge bg-ink-50 font-mono text-[10px] text-ink-600">${esc(c)}</span>`).join('')}
            </div>
          </div>
          ${manage ? `
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" class="btn btn-secondary btn-sm" data-test>
                <i class="fa-solid fa-vial text-[10px]"></i>Test connection
              </button>
              ${i.status === 'CONNECTED' || i.status === 'ERROR'
                ? `<button type="button" class="btn btn-ghost btn-sm text-rose-600" data-disconnect>
                     <i class="fa-solid fa-link-slash text-[10px]"></i>Disconnect
                   </button>`
                : `<button type="button" class="btn btn-primary btn-sm" data-connect>
                     <i class="fa-solid fa-link text-[10px]"></i>Connect
                   </button>`}
            </div>` : ''}
        </div>

        <dl class="mt-5 grid grid-cols-2 gap-4 border-t border-ink-100 pt-4 sm:grid-cols-4">
          <div><dt class="text-xs text-ink-400">Credential</dt>
            <dd class="mt-0.5 text-sm font-medium ${i.configured ? 'text-emerald-600' : 'text-amber-600'}">
              ${i.configured ? 'Present' : 'Missing'}
            </dd></div>
          <div><dt class="text-xs text-ink-400">Secret name</dt>
            <dd class="mt-0.5 truncate font-mono text-xs text-ink-700">${esc(i.secret_ref || '—')}</dd></div>
          <div><dt class="text-xs text-ink-400">Calls made</dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-ink-800">${fmtNumber(i.usage_count)}</dd></div>
          <div><dt class="text-xs text-ink-400">Last test</dt>
            <dd class="mt-0.5 text-sm font-medium text-ink-800">
              ${i.last_test_at ? fmtRelative(i.last_test_at) : 'Never'}
            </dd></div>
        </dl>

        ${i.last_error ? `
          <div class="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            <i class="fa-solid fa-circle-exclamation mr-1.5 text-xs"></i>${esc(i.last_error)}
          </div>` : ''}

        ${!i.configured && i.secret_ref ? `
          <div class="mt-4 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-500">To enable this provider</h3>
            <p class="mt-2 text-sm text-ink-600">
              Add the secret to the Cloudflare Worker environment, then run Test Connection:
            </p>
            <pre class="mt-2 overflow-x-auto rounded-lg bg-ink-900 px-3 py-2.5 text-xs text-ink-100 thin-scroll"><code>npx wrangler pages secret put ${esc(i.secret_ref)}</code></pre>
            <p class="mt-2 text-xs text-ink-400">
              For local development, put it in <span class="font-mono">.dev.vars</span> instead —
              that file is git-ignored and never shipped to the browser.
            </p>
          </div>` : ''}
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="card">
          <header class="border-b border-ink-100 px-5 py-4">
            <h3 class="text-sm font-semibold text-ink-900">Configuration</h3>
            <p class="mt-0.5 text-xs text-ink-400">Non-secret settings only.</p>
          </header>
          ${configEntries.length ? `
            <dl class="divide-y divide-ink-100">
              ${configEntries.map(([k, v]) => `
                <div class="flex items-start justify-between gap-3 px-5 py-3">
                  <dt class="font-mono text-xs text-ink-500">${esc(k)}</dt>
                  <dd class="text-right text-sm text-ink-800">${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</dd>
                </div>`).join('')}
            </dl>`
          : `<div class="px-5 py-8 text-center text-sm text-ink-500">
               No configuration stored. Defaults from the adapter are used.
             </div>`}
        </section>

        <section class="card">
          <header class="border-b border-ink-100 px-5 py-4">
            <h3 class="text-sm font-semibold text-ink-900">Recent calls</h3>
            <p class="mt-0.5 text-xs text-ink-400">Every test and provider call is logged server-side.</p>
          </header>
          ${logs.length ? `
            <ul class="divide-y divide-ink-100">
              ${logs.map((l) => `
                <li class="flex items-start gap-3 px-5 py-3">
                  ${badge(l.status)}
                  <div class="min-w-0 flex-1">
                    <div class="font-mono text-xs text-ink-700">${esc(l.operation)}</div>
                    ${l.message ? `<div class="mt-0.5 text-xs text-ink-500">${esc(l.message)}</div>` : ''}
                    <div class="mt-0.5 text-xs text-ink-400">
                      ${fmtDateTime(l.created_at)}${l.duration_ms !== null ? ` · ${l.duration_ms}ms` : ''}
                    </div>
                  </div>
                </li>`).join('')}
            </ul>`
          : '<div class="px-5 py-8 text-center text-sm text-ink-500">No calls logged yet.</div>'}
        </section>
      </div>
    </div>`

  /* ------------------------------ wiring ------------------------------ */

  outlet.querySelector('[data-back]').addEventListener('click', () => navigate('#/integrations'))

  outlet.querySelector('[data-test]')?.addEventListener('click', async (e) => {
    const restore = withBusy(e.currentTarget, 'Testing…')
    try {
      const { data: r } = await api.post(`/integrations/${key}/test`)
      toast(r.message, r.ok ? 'success' : 'warning')
      await reload()
    } catch (err) {
      restore()
      toastError(err)
    }
  })

  outlet.querySelector('[data-connect]')?.addEventListener('click', () => openConnectForm(i, reload))

  outlet.querySelector('[data-disconnect]')?.addEventListener('click', async (e) => {
    const restore = withBusy(e.currentTarget, 'Disconnecting…')
    try {
      await api.post(`/integrations/${key}/disconnect`)
      toast('Integration disconnected.', 'success')
      await reload()
    } catch (err) {
      restore()
      toastError(err)
    }
  })
}

/**
 * Connect form: collects *non-secret* configuration only.
 * The credential itself must already exist in the Worker environment — that is
 * why an unconfigured provider stays NOT_CONFIGURED after a "connect".
 */
function openConnectForm(integration, onSaved) {
  openModal({
    title: `Connect ${integration.name}`,
    body: `
      <div class="space-y-4">
        ${integration.configured
          ? `<div class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
               <i class="fa-solid fa-circle-check mr-1.5 text-xs"></i>
               The server credential is present. Connecting will mark this provider active.
             </div>`
          : `<div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
               <i class="fa-solid fa-triangle-exclamation mr-1.5 text-xs"></i>
               The secret <span class="font-mono text-xs">${esc(integration.secret_ref || '')}</span> is not set,
               so this provider will stay <strong>Not configured</strong> until you add it.
             </div>`}

        <form id="connect-form" class="space-y-4" novalidate>
          <div>
            <label class="field-label" for="cn-config">Configuration (JSON, optional)</label>
            <textarea id="cn-config" class="field-textarea font-mono text-xs" rows="5"
              placeholder='{ "default_location": "Bandung", "language": "id" }'></textarea>
            <p class="mt-1 text-xs text-ink-400">
              Non-secret settings only. Never paste an API key here — it would be stored in the database.
            </p>
          </div>
          <div id="cn-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
        </form>
      </div>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>Connect</button>`,
    onMount: (panel) => {
      const errorBox = panel.querySelector('#cn-error')
      const btn = panel.querySelector('[data-save]')
      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const raw = panel.querySelector('#cn-config').value.trim()
        let config = {}
        if (raw) {
          try {
            config = JSON.parse(raw)
          } catch {
            errorBox.textContent = 'Configuration must be valid JSON.'
            errorBox.classList.remove('hidden')
            return
          }
        }
        const restore = withBusy(btn, 'Connecting…')
        try {
          const { data } = await api.post(`/integrations/${integration.provider_key}/connect`, { config })
          toast(
            data.status === 'CONNECTED'
              ? 'Integration connected.'
              : 'Saved, but the provider still needs its server secret.',
            data.status === 'CONNECTED' ? 'success' : 'warning'
          )
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not connect.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}
