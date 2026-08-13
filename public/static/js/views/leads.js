/**
 * Lead Engine views: list (server-side filter/sort/pagination) and detail
 * (timeline, score breakdown, status transitions).
 */
import {
  api, store, esc, badge, fmtRelative, fmtDate, fmtNumber, titleCase, scoreColor,
  skeletonBlock, errorState, emptyState, noPermissionState, paginationBar, options,
  openModal, closeModal, confirmDialog, toast, toastError, withBusy, formValues, debounce
} from '../core.js'
import { navigate, setQuery, currentRoute } from '../router.js'

const ACTIVITY_ICONS = {
  NOTE: 'fa-note-sticky', CALL: 'fa-phone', MESSAGE: 'fa-comment-dots',
  EMAIL: 'fa-envelope', FOLLOW_UP: 'fa-clock-rotate-left', MEETING: 'fa-users',
  DEMO: 'fa-laptop-code', OFFER: 'fa-file-contract', PAYMENT: 'fa-money-bill-wave',
  TASK: 'fa-list-check', SYSTEM: 'fa-gear'
}

const SCORE_FACTOR_LABELS = {
  phone: 'Phone available',
  email: 'Email available',
  social: 'Social profile',
  no_website: 'No website (opportunity gap)',
  has_social_no_site: 'Social presence, no site',
  city: 'City recorded',
  industry: 'Industry recorded',
  category: 'Category recorded',
  engagement: 'Engagement (activities)',
  status_momentum: 'Status momentum'
}

/* ------------------------------------------------------------------ *
 * Lead form (create / edit)
 * ------------------------------------------------------------------ */

export function openLeadForm(lead = null, onSaved) {
  const meta = store.meta
  const isEdit = Boolean(lead)
  openModal({
    title: isEdit ? 'Edit lead' : 'Add lead',
    size: 'xl',
    body: `
      <form id="lead-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="lf-name">Business name *</label>
          <input id="lf-name" name="business_name" class="field-input" required maxlength="200"
            value="${esc(lead?.business_name ?? '')}" placeholder="e.g. Salon Cantika">
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="lf-category">Category</label>
            <input id="lf-category" name="category" class="field-input" maxlength="120"
              value="${esc(lead?.category ?? '')}" placeholder="e.g. Beauty Salon">
          </div>
          <div>
            <label class="field-label" for="lf-industry">Industry</label>
            <input id="lf-industry" name="industry" class="field-input" maxlength="120"
              value="${esc(lead?.industry ?? '')}" placeholder="e.g. Beauty">
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="lf-city">City</label>
            <input id="lf-city" name="city" class="field-input" maxlength="120"
              value="${esc(lead?.city ?? '')}" placeholder="e.g. Bandung">
          </div>
          <div>
            <label class="field-label" for="lf-phone">Phone</label>
            <input id="lf-phone" name="phone" class="field-input" maxlength="60"
              value="${esc(lead?.phone ?? '')}" placeholder="+62 …">
          </div>
        </div>

        <div>
          <label class="field-label" for="lf-address">Address</label>
          <input id="lf-address" name="address" class="field-input" maxlength="400"
            value="${esc(lead?.address ?? '')}" placeholder="Street, number, area">
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="lf-email">Email</label>
            <input id="lf-email" name="email" type="email" class="field-input" maxlength="254"
              value="${esc(lead?.email ?? '')}" placeholder="owner@example.com">
          </div>
          <div>
            <label class="field-label" for="lf-website">Website</label>
            <input id="lf-website" name="website" class="field-input" maxlength="300"
              value="${esc(lead?.website ?? '')}" placeholder="https://…">
            <p class="mt-1 text-xs text-ink-400">Leaving this empty raises the score — no website is the opportunity.</p>
          </div>
        </div>

        <div>
          <label class="field-label" for="lf-social">Social URL</label>
          <input id="lf-social" name="social_url" class="field-input" maxlength="300"
            value="${esc(lead?.social_url ?? '')}" placeholder="https://instagram.com/…">
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="lf-status">Status</label>
            <select id="lf-status" name="status" class="field-select">
              ${options(meta.lead_statuses, lead?.status ?? 'NEW')}
            </select>
          </div>
          <div>
            <label class="field-label" for="lf-priority">Priority</label>
            <select id="lf-priority" name="priority" class="field-select">
              <option value="">Auto (from score)</option>
              ${options(meta.lead_priorities, lead?.priority)}
            </select>
          </div>
          ${!isEdit ? `
            <div>
              <label class="field-label" for="lf-source">Source</label>
              <select id="lf-source" name="source_key" class="field-select">
                ${options(meta.lead_sources, 'MANUAL')}
              </select>
            </div>` : `
            <div>
              <label class="field-label">Source</label>
              <input class="field-input" value="${esc(titleCase(lead?.source_key ?? ''))}" disabled>
            </div>`}
        </div>

        <div>
          <label class="field-label" for="lf-notes">Notes</label>
          <textarea id="lf-notes" name="notes" class="field-textarea" maxlength="4000"
            placeholder="What you know about this business, and the angle to use.">${esc(lead?.notes ?? '')}</textarea>
        </div>

        <div id="lf-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>${isEdit ? 'Save changes' : 'Add lead'}</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#lead-form')
      const errorBox = panel.querySelector('#lf-error')
      const saveBtn = panel.querySelector('[data-save]')

      const submit = async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.business_name) {
          errorBox.textContent = 'Business name is required.'
          errorBox.classList.remove('hidden')
          return
        }
        // On edit, send explicit nulls so cleared fields actually clear.
        if (isEdit) {
          for (const field of ['category', 'industry', 'address', 'city', 'website',
            'phone', 'email', 'social_url', 'notes']) {
            if (values[field] === undefined) values[field] = ''
          }
        }
        const restore = withBusy(saveBtn)
        try {
          if (isEdit) {
            await api.patch(`/leads/${lead.id}`, values)
            toast('Lead updated.', 'success')
          } else {
            const { data } = await api.post('/leads', values)
            toast(`Lead added — score ${data.score}, priority ${titleCase(data.priority)}.`, 'success')
          }
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not save the lead.'
          errorBox.classList.remove('hidden')
        }
      }

      saveBtn.addEventListener('click', submit)
      form.addEventListener('submit', (e) => { e.preventDefault(); submit() })
    }
  })
}

/* ------------------------------------------------------------------ *
 * Activity form — shared by leads, clients and projects
 * ------------------------------------------------------------------ */

export function openActivityForm({ entityType, entityId, entityName }, onSaved) {
  openModal({
    title: 'Log activity',
    body: `
      <form id="act-form" class="space-y-4" novalidate>
        <p class="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
          ${esc(titleCase(entityType))}: <span class="font-medium text-ink-700">${esc(entityName || entityId)}</span>
        </p>
        <div>
          <label class="field-label" for="af-type">Type</label>
          <select id="af-type" name="type" class="field-select">
            ${options(store.meta.activity_types, 'NOTE')}
          </select>
        </div>
        <div>
          <label class="field-label" for="af-desc">What happened? *</label>
          <textarea id="af-desc" name="description" class="field-textarea" required maxlength="4000"
            placeholder="e.g. Sent the first WhatsApp message using the outreach script."></textarea>
        </div>
        <div>
          <label class="field-label" for="af-outcome">Outcome</label>
          <input id="af-outcome" name="outcome" class="field-input" maxlength="500"
            placeholder="e.g. Replied — interested">
        </div>
        <div>
          <label class="field-label" for="af-due">Follow-up date</label>
          <input id="af-due" name="due_at" type="date" class="field-input">
          <p class="mt-1 text-xs text-ink-400">Set a date to make this appear in Today on the Command Center.</p>
        </div>
        <div id="af-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>Log activity</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#act-form')
      const errorBox = panel.querySelector('#af-error')
      const saveBtn = panel.querySelector('[data-save]')

      const submit = async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.description) {
          errorBox.textContent = 'Please describe what happened.'
          errorBox.classList.remove('hidden')
          return
        }
        const restore = withBusy(saveBtn)
        try {
          await api.post('/activities', { ...values, entity_type: entityType, entity_id: entityId })
          toast('Activity logged.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not log the activity.'
          errorBox.classList.remove('hidden')
        }
      }
      saveBtn.addEventListener('click', submit)
      form.addEventListener('submit', (e) => { e.preventDefault(); submit() })
    }
  })
}

/* ------------------------------------------------------------------ *
 * Lead list
 * ------------------------------------------------------------------ */

function leadRow(lead) {
  const contact = [lead.phone, lead.email].filter(Boolean)[0]
  return `
    <tr class="cursor-pointer" data-lead="${esc(lead.id)}">
      <td>
        <div class="flex items-start gap-2">
          <div class="min-w-0">
            <div class="truncate font-medium text-ink-900">${esc(lead.business_name)}</div>
            <div class="truncate text-xs text-ink-400">
              ${esc(lead.category || lead.industry || '—')}${lead.city ? ` · ${esc(lead.city)}` : ''}
            </div>
          </div>
          ${lead.archived_at ? '<span class="badge bg-ink-100 text-ink-500">Archived</span>' : ''}
        </div>
      </td>
      <td class="hidden sm:table-cell">${badge(lead.status)}</td>
      <td>${badge(lead.priority)}</td>
      <td class="text-right">
        <span class="text-sm font-semibold tabular-nums ${scoreColor(lead.score)}">${lead.score}</span>
      </td>
      <td class="hidden md:table-cell">
        <div class="text-xs text-ink-600">${esc(contact || '—')}</div>
        <div class="text-xs text-ink-400">${lead.website ? 'Has website' : 'No website'}</div>
      </td>
      <td class="hidden lg:table-cell text-xs text-ink-500">${fmtNumber(lead.activity_count || 0)}</td>
      <td class="hidden lg:table-cell text-xs text-ink-400">${fmtRelative(lead.updated_at)}</td>
    </tr>`
}

function leadCard(lead) {
  const contact = [lead.phone, lead.email].filter(Boolean)[0]
  return `
    <button type="button" data-lead="${esc(lead.id)}"
      class="card w-full card-pad text-left transition active:bg-ink-50">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-ink-900">${esc(lead.business_name)}</div>
          <div class="truncate text-xs text-ink-400">
            ${esc(lead.category || lead.industry || '—')}${lead.city ? ` · ${esc(lead.city)}` : ''}
          </div>
        </div>
        <span class="shrink-0 text-right">
          <span class="block text-lg font-semibold tabular-nums ${scoreColor(lead.score)}">${lead.score}</span>
          <span class="block text-[10px] uppercase tracking-wide text-ink-400">score</span>
        </span>
      </div>
      <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
        ${badge(lead.status)}${badge(lead.priority)}
        ${!lead.website ? '<span class="badge bg-violet-50 text-violet-700">No website</span>' : ''}
        ${lead.archived_at ? '<span class="badge bg-ink-100 text-ink-500">Archived</span>' : ''}
      </div>
      ${contact ? `<div class="mt-2 truncate text-xs text-ink-500"><i class="fa-solid fa-phone mr-1 text-[10px]"></i>${esc(contact)}</div>` : ''}
    </button>`
}

export async function renderLeadList(outlet, query) {
  if (!store.can('lead.read')) {
    outlet.innerHTML = noPermissionState('lead.read')
    return
  }

  const meta = store.meta
  const filters = {
    q: query.q || '',
    status: query.status || '',
    priority: query.priority || '',
    city: query.city || '',
    sort: query.sort || 'newest',
    include_archived: query.include_archived === 'true',
    page: Number(query.page || 1)
  }

  outlet.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[12rem] flex-1">
            <label class="field-label" for="lead-q">Search</label>
            <input id="lead-q" class="field-input" placeholder="Name, city, phone, email…" value="${esc(filters.q)}">
          </div>
          <div class="w-full sm:w-40">
            <label class="field-label" for="lead-status">Status</label>
            <select id="lead-status" class="field-select">${options(meta.lead_statuses, filters.status, 'All statuses')}</select>
          </div>
          <div class="w-full sm:w-36">
            <label class="field-label" for="lead-priority">Priority</label>
            <select id="lead-priority" class="field-select">${options(meta.lead_priorities, filters.priority, 'All priorities')}</select>
          </div>
          <div class="w-full sm:w-40">
            <label class="field-label" for="lead-sort">Sort</label>
            <select id="lead-sort" class="field-select">
              ${options([
                { value: 'newest', label: 'Newest first' },
                { value: 'score', label: 'Highest score' },
                { value: 'updated', label: 'Recently updated' },
                { value: 'name', label: 'Name A–Z' },
                { value: 'oldest', label: 'Oldest first' }
              ], filters.sort)}
            </select>
          </div>
          <label class="flex items-center gap-2 pb-2 text-xs font-medium text-ink-600">
            <input id="lead-archived" type="checkbox" class="h-4 w-4 rounded border-ink-300" ${filters.include_archived ? 'checked' : ''}>
            Include archived
          </label>
          ${store.can('lead.create') ? `
            <button type="button" class="btn btn-primary ml-auto" data-add-lead>
              <i class="fa-solid fa-plus text-xs"></i>Add lead
            </button>` : ''}
        </div>
      </section>

      <div id="lead-results">${skeletonBlock(5)}</div>
    </div>`

  // Filter changes rewrite the URL query so the view is shareable and reloadable.
  const applyFilters = (patch) => setQuery({ ...query, page: 1, ...patch })

  const qInput = outlet.querySelector('#lead-q')
  qInput.addEventListener('input', debounce(() => applyFilters({ q: qInput.value.trim() || null }), 400))
  outlet.querySelector('#lead-status').addEventListener('change', (e) => applyFilters({ status: e.target.value || null }))
  outlet.querySelector('#lead-priority').addEventListener('change', (e) => applyFilters({ priority: e.target.value || null }))
  outlet.querySelector('#lead-sort').addEventListener('change', (e) => applyFilters({ sort: e.target.value }))
  outlet.querySelector('#lead-archived').addEventListener('change', (e) =>
    applyFilters({ include_archived: e.target.checked ? 'true' : null }))
  outlet.querySelector('[data-add-lead]')?.addEventListener('click', () =>
    openLeadForm(null, () => renderLeadList(outlet, query)))

  const results = outlet.querySelector('#lead-results')
  let payload
  try {
    payload = await api.get('/leads', {
      q: filters.q || undefined,
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      city: filters.city || undefined,
      sort: filters.sort,
      include_archived: filters.include_archived ? 'true' : undefined,
      page: filters.page,
      per_page: 20
    })
  } catch (err) {
    results.innerHTML = errorState(err, 'data-retry')
    results.querySelector('[data-retry]')?.addEventListener('click', () => renderLeadList(outlet, query))
    return
  }

  const items = payload.data
  const hasFilters = Boolean(filters.q || filters.status || filters.priority)

  if (!items.length) {
    results.innerHTML = `<div class="card">${
      hasFilters
        ? emptyState({
            icon: 'fa-filter-circle-xmark',
            title: 'No leads match these filters',
            message: 'Try clearing the search or choosing a different status.',
            actionLabel: 'Clear filters',
            actionAttr: 'data-clear'
          })
        : emptyState({
            icon: 'fa-user-plus',
            title: 'No leads yet.',
            message: 'Add your first lead manually, or use the Discovery Engine to find local businesses.',
            actionLabel: store.can('lead.create') ? 'Add Lead' : undefined,
            actionAttr: 'data-add-lead-empty'
          })
    }</div>`
    results.querySelector('[data-clear]')?.addEventListener('click', () => setQuery({}))
    results.querySelector('[data-add-lead-empty]')?.addEventListener('click', () =>
      openLeadForm(null, () => renderLeadList(outlet, query)))
    return
  }

  results.innerHTML = `
    <!-- Mobile: cards -->
    <div class="space-y-2 lg:hidden">
      ${items.map(leadCard).join('')}
      <div class="card">${paginationBar(payload.meta)}</div>
    </div>

    <!-- Desktop: table -->
    <div class="card hidden overflow-hidden lg:block">
      <div class="overflow-x-auto thin-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Business</th>
              <th class="hidden sm:table-cell">Status</th>
              <th>Priority</th>
              <th class="text-right">Score</th>
              <th class="hidden md:table-cell">Contact</th>
              <th class="hidden lg:table-cell">Activities</th>
              <th class="hidden lg:table-cell">Updated</th>
            </tr>
          </thead>
          <tbody>${items.map(leadRow).join('')}</tbody>
        </table>
      </div>
      ${paginationBar(payload.meta)}
    </div>`

  results.querySelectorAll('[data-lead]').forEach((el) =>
    el.addEventListener('click', () => navigate(`#/leads/${el.dataset.lead}`)))
  results.querySelectorAll('[data-page]').forEach((btn) =>
    btn.addEventListener('click', () => setQuery({ ...query, page: btn.dataset.page })))
}

/* ------------------------------------------------------------------ *
 * Lead detail
 * ------------------------------------------------------------------ */

function scoreBreakdown(history) {
  const latest = history[0]
  if (!latest) return '<p class="text-sm text-ink-500">No score computed yet.</p>'
  let breakdown = {}
  try {
    breakdown = JSON.parse(latest.breakdown || '{}')
  } catch {
    breakdown = {}
  }
  const rows = Object.entries(breakdown).filter(([, v]) => Number(v) !== 0)
  if (!rows.length) {
    return '<p class="text-sm text-ink-500">Score is zero — no positive signals recorded yet.</p>'
  }
  return `
    <ul class="space-y-1.5">
      ${rows.map(([key, value]) => `
        <li class="flex items-center justify-between gap-3 text-sm">
          <span class="text-ink-600">${esc(SCORE_FACTOR_LABELS[key] || titleCase(key))}</span>
          <span class="font-semibold tabular-nums text-emerald-600">+${value}</span>
        </li>`).join('')}
    </ul>
    <p class="mt-3 text-xs text-ink-400">
      Computed by the ${esc(titleCase(latest.computed_by))} engine · ${fmtRelative(latest.created_at)}
    </p>`
}

export async function renderLeadDetail(outlet, id) {
  if (!store.can('lead.read')) {
    outlet.innerHTML = noPermissionState('lead.read')
    return
  }
  outlet.innerHTML = skeletonBlock(4)

  let data
  try {
    const res = await api.get(`/leads/${id}`)
    data = res.data
  } catch (err) {
    outlet.innerHTML = errorState(err, 'data-retry')
    outlet.querySelector('[data-retry]')?.addEventListener('click', () => renderLeadDetail(outlet, id))
    return
  }

  const lead = data.lead
  const reload = () => renderLeadDetail(outlet, id)
  const canUpdate = store.can('lead.update')

  outlet.innerHTML = `
    <div class="space-y-4">
      <button type="button" class="btn btn-ghost btn-sm -ml-2" data-back>
        <i class="fa-solid fa-arrow-left text-xs"></i>All leads
      </button>

      <section class="card">
        <div class="flex flex-wrap items-start justify-between gap-4 p-5">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg font-semibold text-ink-900">${esc(lead.business_name)}</h2>
              ${badge(lead.status)}${badge(lead.priority)}
              ${lead.archived_at ? '<span class="badge bg-ink-100 text-ink-500">Archived</span>' : ''}
              ${lead.is_demo ? '<span class="badge bg-violet-50 text-violet-700">Demo data</span>' : ''}
            </div>
            <p class="mt-1 text-sm text-ink-500">
              ${esc(lead.category || '—')}${lead.industry ? ` · ${esc(lead.industry)}` : ''}
              ${lead.city ? ` · ${esc(lead.city)}` : ''}
            </p>
            <p class="mt-0.5 text-xs text-ink-400">
              Source ${esc(titleCase(lead.source_key))} · created ${fmtDate(lead.created_at)}
            </p>
          </div>

          <div class="flex flex-col items-end gap-2">
            <div class="text-right">
              <div class="text-3xl font-semibold tabular-nums ${scoreColor(lead.score)}">${lead.score}</div>
              <div class="text-[10px] uppercase tracking-wide text-ink-400">lead score</div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              ${store.can('activity.create') ? `
                <button type="button" class="btn btn-primary btn-sm" data-log>
                  <i class="fa-solid fa-plus text-[10px]"></i>Log activity
                </button>` : ''}
              ${canUpdate ? `
                <button type="button" class="btn btn-secondary btn-sm" data-edit>
                  <i class="fa-solid fa-pen text-[10px]"></i>Edit
                </button>
                <button type="button" class="btn btn-secondary btn-sm" data-rescore>
                  <i class="fa-solid fa-calculator text-[10px]"></i>Rescore
                </button>` : ''}
              ${store.can('lead.delete') && !lead.archived_at ? `
                <button type="button" class="btn btn-ghost btn-sm text-rose-600" data-archive>
                  <i class="fa-solid fa-box-archive text-[10px]"></i>Archive
                </button>` : ''}
              ${canUpdate && lead.archived_at ? `
                <button type="button" class="btn btn-secondary btn-sm" data-restore>
                  <i class="fa-solid fa-rotate-left text-[10px]"></i>Restore
                </button>` : ''}
            </div>
          </div>
        </div>

        ${canUpdate ? `
          <div class="border-t border-ink-100 bg-ink-50 px-5 py-3">
            <label class="field-label" for="status-select">Move status</label>
            <div class="flex flex-wrap items-center gap-2">
              <select id="status-select" class="field-select w-full sm:w-56">
                ${options(store.meta.lead_statuses, lead.status)}
              </select>
              <select id="priority-select" class="field-select w-full sm:w-44">
                ${options(store.meta.lead_priorities, lead.priority)}
              </select>
              <button type="button" class="btn btn-primary btn-sm" data-move>Apply</button>
            </div>
          </div>` : ''}
      </section>

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="space-y-4 lg:col-span-2">
          <section class="card">
            <header class="border-b border-ink-100 px-5 py-4">
              <h3 class="text-sm font-semibold text-ink-900">Activity timeline</h3>
              <p class="mt-0.5 text-xs text-ink-400">${fmtNumber(data.activities.length)} record(s)</p>
            </header>
            ${data.activities.length ? `
              <div class="px-5 py-4">
                ${data.activities.map((a) => `
                  <div class="timeline-item">
                    <span class="timeline-dot bg-brand-500"></span>
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <i class="fa-solid ${ACTIVITY_ICONS[a.type] || 'fa-circle'} text-xs text-ink-400"></i>
                          ${badge(a.type)}
                        </div>
                        <p class="mt-1 text-sm text-ink-800">${esc(a.description)}</p>
                        ${a.outcome ? `<p class="mt-0.5 text-xs text-emerald-700">→ ${esc(a.outcome)}</p>` : ''}
                        ${a.due_at ? `<p class="mt-0.5 text-xs text-amber-700">
                          <i class="fa-regular fa-clock mr-1"></i>Follow-up ${fmtDate(a.due_at)}</p>` : ''}
                      </div>
                      <div class="shrink-0 text-right">
                        <div class="text-xs text-ink-400">${fmtRelative(a.created_at)}</div>
                        ${a.created_by_name ? `<div class="text-xs text-ink-400">${esc(a.created_by_name)}</div>` : ''}
                      </div>
                    </div>
                  </div>`).join('')}
              </div>` : `
              <div class="px-5 py-10 text-center">
                <p class="text-sm text-ink-500">No activity yet.</p>
                ${store.can('activity.create')
                  ? '<button type="button" class="btn btn-primary btn-sm mt-4" data-log-empty><i class="fa-solid fa-plus text-[10px]"></i>Log the first touch</button>'
                  : ''}
              </div>`}
          </section>

          ${lead.notes ? `
            <section class="card card-pad">
              <h3 class="mb-2 text-sm font-semibold text-ink-900">Notes</h3>
              <p class="whitespace-pre-wrap text-sm text-ink-600">${esc(lead.notes)}</p>
            </section>` : ''}
        </div>

        <div class="space-y-4">
          <section class="card card-pad">
            <h3 class="mb-3 text-sm font-semibold text-ink-900">Contact</h3>
            <dl class="space-y-2.5 text-sm">
              ${[
                ['Phone', lead.phone, 'fa-phone', lead.phone ? `tel:${lead.phone}` : null],
                ['Email', lead.email, 'fa-envelope', lead.email ? `mailto:${lead.email}` : null],
                ['Website', lead.website, 'fa-globe', lead.website],
                ['Social', lead.social_url, 'fa-hashtag', lead.social_url],
                ['Address', lead.address, 'fa-location-dot', null]
              ].map(([label, value, icon, href]) => `
                <div class="flex items-start gap-2.5">
                  <i class="fa-solid ${icon} mt-0.5 w-4 shrink-0 text-center text-xs text-ink-400"></i>
                  <div class="min-w-0 flex-1">
                    <dt class="text-xs text-ink-400">${label}</dt>
                    <dd class="truncate ${value ? 'text-ink-800' : 'text-ink-400'}">
                      ${value
                        ? (href
                          ? `<a href="${esc(href)}" target="_blank" rel="noopener" class="text-brand-700 hover:underline">${esc(value)}</a>`
                          : esc(value))
                        : '—'}
                    </dd>
                  </div>
                </div>`).join('')}
            </dl>
          </section>

          <section class="card card-pad">
            <h3 class="mb-3 text-sm font-semibold text-ink-900">Score breakdown</h3>
            ${scoreBreakdown(data.score_history)}
          </section>

          ${store.can('sales.manage') ? `
            <section class="card card-pad">
              <h3 class="mb-1 text-sm font-semibold text-ink-900">Convert</h3>
              <p class="mb-3 text-xs text-ink-400">Move this lead forward in the pipeline.</p>
              <div class="space-y-2">
                <button type="button" class="btn btn-secondary btn-sm w-full" data-make-opp>
                  <i class="fa-solid fa-chart-line text-[10px]"></i>Create opportunity
                </button>
                <button type="button" class="btn btn-secondary btn-sm w-full" data-make-offer>
                  <i class="fa-solid fa-file-contract text-[10px]"></i>Create offer
                </button>
                ${store.can('client.create') ? `
                  <button type="button" class="btn btn-secondary btn-sm w-full" data-make-client>
                    <i class="fa-solid fa-handshake text-[10px]"></i>Convert to client
                  </button>` : ''}
              </div>
            </section>` : ''}
        </div>
      </div>
    </div>`

  /* --------------------------- interactions --------------------------- */

  outlet.querySelector('[data-back]').addEventListener('click', () => navigate('#/leads'))

  outlet.querySelectorAll('[data-log], [data-log-empty]').forEach((btn) =>
    btn.addEventListener('click', () =>
      openActivityForm({ entityType: 'LEAD', entityId: lead.id, entityName: lead.business_name }, reload)))

  outlet.querySelector('[data-edit]')?.addEventListener('click', () => openLeadForm(lead, reload))

  outlet.querySelector('[data-rescore]')?.addEventListener('click', async (e) => {
    const restore = withBusy(e.currentTarget, 'Scoring…')
    try {
      const { data: r } = await api.post(`/leads/${lead.id}/rescore`)
      toast(`Score is now ${r.score} (suggested priority ${titleCase(r.suggested_priority)}).`, 'success')
      await reload()
    } catch (err) {
      restore()
      toastError(err)
    }
  })

  outlet.querySelector('[data-move]')?.addEventListener('click', async (e) => {
    const status = outlet.querySelector('#status-select').value
    const priority = outlet.querySelector('#priority-select').value
    if (status === lead.status && priority === lead.priority) {
      toast('Nothing changed.', 'info')
      return
    }
    const restore = withBusy(e.currentTarget, 'Applying…')
    try {
      await api.patch(`/leads/${lead.id}`, { status, priority })
      toast('Lead updated.', 'success')
      await reload()
    } catch (err) {
      restore()
      toastError(err)
    }
  })

  outlet.querySelector('[data-archive]')?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Archive this lead?',
      message: `${lead.business_name} will be hidden from the default list but kept in the database.`,
      confirmLabel: 'Archive',
      danger: true
    })
    if (!yes) return
    try {
      await api.post(`/leads/${lead.id}/archive`)
      toast('Lead archived.', 'success')
      navigate('#/leads')
    } catch (err) {
      toastError(err)
    }
  })

  outlet.querySelector('[data-restore]')?.addEventListener('click', async () => {
    try {
      await api.post(`/leads/${lead.id}/restore`)
      toast('Lead restored.', 'success')
      await reload()
    } catch (err) {
      toastError(err)
    }
  })

  outlet.querySelector('[data-make-opp]')?.addEventListener('click', () =>
    openOpportunityFromLead(lead, reload))
  outlet.querySelector('[data-make-offer]')?.addEventListener('click', () =>
    openOfferFromLead(lead, reload))
  outlet.querySelector('[data-make-client]')?.addEventListener('click', () =>
    convertLeadToClient(lead))
}

/* ------------------------------------------------------------------ *
 * Conversion helpers (lead → opportunity / offer / client)
 * ------------------------------------------------------------------ */

function openOpportunityFromLead(lead, onSaved) {
  openModal({
    title: 'Create opportunity',
    body: `
      <form id="opp-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="of-title">Title *</label>
          <input id="of-title" name="title" class="field-input" required maxlength="200"
            value="${esc(lead.business_name)} — ">
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="of-stage">Stage</label>
            <select id="of-stage" name="stage" class="field-select">
              ${options(store.meta.opportunity_stages, 'DISCOVERY')}
            </select>
          </div>
          <div>
            <label class="field-label" for="of-value">Value</label>
            <input id="of-value" name="value" type="number" min="0" step="100000" class="field-input" placeholder="0">
          </div>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="of-prob">Probability (%)</label>
            <input id="of-prob" name="probability" type="number" min="0" max="100" class="field-input" placeholder="0">
          </div>
          <div>
            <label class="field-label" for="of-exp">Expected close</label>
            <input id="of-exp" name="expected_at" type="date" class="field-input">
          </div>
        </div>
        <div>
          <label class="field-label" for="of-notes">Notes</label>
          <textarea id="of-notes" name="notes" class="field-textarea" maxlength="4000"></textarea>
        </div>
        <div id="of-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>Create</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#opp-form')
      const errorBox = panel.querySelector('#of-error')
      const btn = panel.querySelector('[data-save]')
      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.title) {
          errorBox.textContent = 'Title is required.'
          errorBox.classList.remove('hidden')
          return
        }
        const restore = withBusy(btn)
        try {
          await api.post('/opportunities', { ...values, lead_id: lead.id })
          toast('Opportunity created.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not create the opportunity.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

function openOfferFromLead(lead, onSaved) {
  openModal({
    title: 'Create offer',
    body: `
      <form id="offer-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="ofr-title">Title *</label>
          <input id="ofr-title" name="title" class="field-input" required maxlength="200"
            value="${esc(lead.business_name)} — ">
        </div>
        <div>
          <label class="field-label" for="ofr-package">Package</label>
          <input id="ofr-package" name="package" class="field-input" maxlength="200"
            placeholder="e.g. Starter Site + Catalog">
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="ofr-price">Price</label>
            <input id="ofr-price" name="price" type="number" min="0" step="100000" class="field-input" placeholder="0">
          </div>
          <div>
            <label class="field-label" for="ofr-status">Status</label>
            <select id="ofr-status" name="status" class="field-select">
              ${options(store.meta.offer_statuses, 'DRAFT')}
            </select>
          </div>
          <div>
            <label class="field-label" for="ofr-valid">Valid until</label>
            <input id="ofr-valid" name="valid_until" type="date" class="field-input">
          </div>
        </div>
        <div>
          <label class="field-label" for="ofr-notes">Notes</label>
          <textarea id="ofr-notes" name="notes" class="field-textarea" maxlength="4000"></textarea>
        </div>
        <div id="ofr-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>Create</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#offer-form')
      const errorBox = panel.querySelector('#ofr-error')
      const btn = panel.querySelector('[data-save]')
      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.title) {
          errorBox.textContent = 'Title is required.'
          errorBox.classList.remove('hidden')
          return
        }
        const restore = withBusy(btn)
        try {
          await api.post('/offers', { ...values, lead_id: lead.id })
          toast('Offer created.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not create the offer.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

async function convertLeadToClient(lead) {
  const yes = await confirmDialog({
    title: 'Convert to client?',
    message: `A client record will be created from ${lead.business_name} and the lead will be marked WON.`,
    confirmLabel: 'Convert'
  })
  if (!yes) return
  try {
    const { data: client } = await api.post('/clients', {
      name: lead.business_name,
      industry: lead.industry || undefined,
      city: lead.city || undefined,
      website: lead.website || undefined,
      phone: lead.phone || undefined,
      email: lead.email || undefined,
      lead_id: lead.id,
      status: 'ACTIVE',
      notes: `Converted from lead. ${lead.notes || ''}`.trim()
    })
    await api.patch(`/leads/${lead.id}`, { status: 'WON' })
    toast('Client created from lead.', 'success')
    navigate(`#/clients/${client.id}`)
  } catch (err) {
    toastError(err)
  }
}
