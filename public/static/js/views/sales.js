/**
 * Sales OS view — opportunity pipeline and offers.
 * Weighted pipeline value uses each opportunity's own probability, so the
 * number reflects the database rather than an optimistic guess.
 */
import {
  api, store, esc, badge, fmtMoney, fmtMoneyShort, fmtNumber, fmtDate, fmtRelative,
  options, formValues, openModal, closeModal,
  skeletonBlock, errorState, emptyState, noPermissionState, sectionHeader, paginationBar,
  toast, toastError, withBusy
} from '../core.js'
import { navigate, setQuery } from '../router.js'

const STAGES = ['DISCOVERY', 'QUALIFYING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

function openOpportunityForm(opp = null, onSaved) {
  const editing = Boolean(opp)
  openModal({
    title: editing ? 'Edit opportunity' : 'New opportunity',
    size: 'xl',
    body: `
      <form id="opp-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="op-title">Title *</label>
          <input id="op-title" name="title" class="field-input" required maxlength="200"
            value="${esc(opp?.title || '')}" placeholder="e.g. Salon Ayu — website package">
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="op-stage">Stage</label>
            <select id="op-stage" name="stage" class="field-select">
              ${options(store.meta.opportunity_stages, opp?.stage || 'DISCOVERY')}
            </select>
          </div>
          <div>
            <label class="field-label" for="op-value">Value</label>
            <input id="op-value" name="value" type="number" min="0" step="100000" class="field-input"
              value="${opp?.value ?? ''}" placeholder="0">
          </div>
          <div>
            <label class="field-label" for="op-prob">Probability (%)</label>
            <input id="op-prob" name="probability" type="number" min="0" max="100" class="field-input"
              value="${opp?.probability ?? ''}" placeholder="0">
          </div>
        </div>
        <div>
          <label class="field-label" for="op-exp">Expected close</label>
          <input id="op-exp" name="expected_at" type="date" class="field-input"
            value="${esc((opp?.expected_at || '').slice(0, 10))}">
        </div>
        <div>
          <label class="field-label" for="op-notes">Notes</label>
          <textarea id="op-notes" name="notes" class="field-textarea" maxlength="4000"
            >${esc(opp?.notes || '')}</textarea>
        </div>
        <div id="op-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>${editing ? 'Save changes' : 'Create'}</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#opp-form')
      const errorBox = panel.querySelector('#op-error')
      const btn = panel.querySelector('[data-save]')
      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.title) {
          errorBox.textContent = 'Title is required.'
          errorBox.classList.remove('hidden')
          return
        }
        values.stage = form.elements.stage.value
        if (values.value !== undefined) values.value = Number(values.value)
        if (values.probability !== undefined) values.probability = Number(values.probability)

        const restore = withBusy(btn)
        try {
          if (editing) await api.patch(`/opportunities/${opp.id}`, values)
          else await api.post('/opportunities', values)
          toast(editing ? 'Opportunity updated.' : 'Opportunity created.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not save the opportunity.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

function openOfferForm(offer = null, onSaved) {
  const editing = Boolean(offer)
  openModal({
    title: editing ? 'Edit offer' : 'New offer',
    size: 'xl',
    body: `
      <form id="offer-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="ofx-title">Title *</label>
          <input id="ofx-title" name="title" class="field-input" required maxlength="200"
            value="${esc(offer?.title || '')}">
        </div>
        <div>
          <label class="field-label" for="ofx-package">Package</label>
          <input id="ofx-package" name="package" class="field-input" maxlength="200"
            value="${esc(offer?.package || '')}" placeholder="e.g. Starter Site + Catalog">
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="ofx-price">Price</label>
            <input id="ofx-price" name="price" type="number" min="0" step="100000" class="field-input"
              value="${offer?.price ?? ''}" placeholder="0">
          </div>
          <div>
            <label class="field-label" for="ofx-status">Status</label>
            <select id="ofx-status" name="status" class="field-select">
              ${options(store.meta.offer_statuses, offer?.status || 'DRAFT')}
            </select>
          </div>
          <div>
            <label class="field-label" for="ofx-valid">Valid until</label>
            <input id="ofx-valid" name="valid_until" type="date" class="field-input"
              value="${esc((offer?.valid_until || '').slice(0, 10))}">
          </div>
        </div>
        <div>
          <label class="field-label" for="ofx-notes">Notes</label>
          <textarea id="ofx-notes" name="notes" class="field-textarea" maxlength="4000"
            >${esc(offer?.notes || '')}</textarea>
        </div>
        <div id="ofx-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>${editing ? 'Save changes' : 'Create'}</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#offer-form')
      const errorBox = panel.querySelector('#ofx-error')
      const btn = panel.querySelector('[data-save]')
      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.title) {
          errorBox.textContent = 'Title is required.'
          errorBox.classList.remove('hidden')
          return
        }
        values.status = form.elements.status.value
        if (values.price !== undefined) values.price = Number(values.price)

        const restore = withBusy(btn)
        try {
          if (editing) await api.patch(`/offers/${offer.id}`, values)
          else await api.post('/offers', values)
          toast(editing ? 'Offer updated.' : 'Offer created.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not save the offer.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

/* ------------------------------------------------------------------ *
 * View
 * ------------------------------------------------------------------ */

export async function renderSales(outlet, query) {
  if (!store.can('sales.read')) {
    outlet.innerHTML = noPermissionState('sales.read')
    return
  }

  const tab = query.tab === 'offers' ? 'offers' : 'pipeline'
  const stage = query.stage || ''
  const page = Number(query.page || 1)
  const manage = store.can('sales.manage')

  outlet.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <nav class="inline-flex rounded-lg border border-ink-200 bg-white p-1" aria-label="Sales sections">
          <button type="button" data-tab="pipeline"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === 'pipeline' ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'}">
            Pipeline
          </button>
          <button type="button" data-tab="offers"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === 'offers' ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'}">
            Offers
          </button>
        </nav>
        ${manage ? `
          <button type="button" class="btn btn-primary" data-add>
            <i class="fa-solid fa-plus text-xs"></i>${tab === 'offers' ? 'New offer' : 'New opportunity'}
          </button>` : ''}
      </div>

      <div id="sales-body">${skeletonBlock(4)}</div>
    </div>`

  outlet.querySelectorAll('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => setQuery({ tab: btn.dataset.tab })))

  const reload = () => renderSales(outlet, query)
  outlet.querySelector('[data-add]')?.addEventListener('click', () =>
    tab === 'offers' ? openOfferForm(null, reload) : openOpportunityForm(null, reload))

  const body = outlet.querySelector('#sales-body')

  if (tab === 'offers') {
    await renderOffers(body, page, reload, manage)
  } else {
    await renderPipeline(body, { stage, page }, reload, manage)
  }
}

/* ------------------------------- pipeline ------------------------------- */

async function renderPipeline(body, { stage, page }, reload, manage) {
  let payload
  try {
    payload = await api.get('/opportunities', {
      stage: stage || undefined,
      page,
      per_page: 50
    })
  } catch (err) {
    body.innerHTML = errorState(err, 'data-retry')
    body.querySelector('[data-retry]')?.addEventListener('click', reload)
    return
  }

  const items = payload.data
  const open = items.filter((o) => o.stage !== 'WON' && o.stage !== 'LOST')
  const totalValue = open.reduce((s, o) => s + Number(o.value || 0), 0)
  const weighted = open.reduce((s, o) => s + (Number(o.value || 0) * Number(o.probability || 0)) / 100, 0)
  const wonValue = items.filter((o) => o.stage === 'WON').reduce((s, o) => s + Number(o.value || 0), 0)

  if (!items.length) {
    body.innerHTML = `<div class="card">${
      stage
        ? emptyState({
            icon: 'fa-filter-circle-xmark',
            title: `No opportunities in ${esc(stage)}`,
            message: 'Clear the stage filter to see the whole pipeline.',
            actionLabel: 'Clear filter',
            actionAttr: 'data-clear'
          })
        : emptyState({
            icon: 'fa-chart-line',
            title: 'No opportunities yet.',
            message: 'Promote a qualified lead into an opportunity to start tracking pipeline value.',
            actionLabel: manage ? 'New Opportunity' : undefined,
            actionAttr: 'data-add-empty'
          })
    }</div>`
    body.querySelector('[data-clear]')?.addEventListener('click', () => setQuery({ tab: 'pipeline' }))
    body.querySelector('[data-add-empty]')?.addEventListener('click', () => openOpportunityForm(null, reload))
    return
  }

  const byStage = STAGES.reduce((acc, s) => {
    acc[s] = items.filter((o) => o.stage === s)
    return acc
  }, {})

  body.innerHTML = `
    <div class="space-y-4">
      <div class="grid grid-cols-3 gap-3">
        ${tile('Open pipeline', fmtMoneyShort(totalValue), `${open.length} opportunity(ies)`, 'fa-chart-line')}
        ${tile('Weighted', fmtMoneyShort(weighted), 'Value × probability', 'fa-scale-balanced')}
        ${tile('Won', fmtMoneyShort(wonValue), 'Closed successfully', 'fa-trophy')}
      </div>

      <section class="card card-pad">
        <div class="flex flex-wrap items-end gap-3">
          <div class="w-full sm:w-48">
            <label class="field-label" for="sl-stage">Stage</label>
            <select id="sl-stage" class="field-select">
              ${options(store.meta.opportunity_stages, stage, 'All stages')}
            </select>
          </div>
        </div>
      </section>

      ${STAGES.filter((s) => byStage[s].length).map((s) => `
        <section>
          ${sectionHeader(s.replace('_', ' '), {
            subtitle: `${byStage[s].length} · ${fmtMoneyShort(byStage[s].reduce((t, o) => t + Number(o.value || 0), 0))}`
          })}
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            ${byStage[s].map((o) => oppCard(o, manage)).join('')}
          </div>
        </section>`).join('')}

      <div class="card">${paginationBar(payload.meta)}</div>
    </div>`

  body.querySelector('#sl-stage').addEventListener('change', (e) =>
    setQuery({ tab: 'pipeline', stage: e.target.value || null }))

  body.querySelectorAll('[data-edit-opp]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const o = items.find((x) => x.id === btn.dataset.editOpp)
      openOpportunityForm(o, reload)
    }))

  body.querySelectorAll('[data-stage-move]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      try {
        await api.patch(`/opportunities/${sel.dataset.stageMove}`, { stage: sel.value })
        toast('Stage updated.', 'success')
        await reload()
      } catch (err) {
        toastError(err)
        await reload()
      }
    }))

  body.querySelectorAll('[data-goto-lead]').forEach((btn) =>
    btn.addEventListener('click', () => navigate(`#/leads/${btn.dataset.gotoLead}`)))

  body.querySelectorAll('[data-page]').forEach((btn) =>
    btn.addEventListener('click', () => setQuery({ tab: 'pipeline', stage: stage || null, page: btn.dataset.page })))
}

function oppCard(o, manage) {
  const prob = Number(o.probability || 0)
  return `
    <article class="card card-pad">
      <div class="flex items-start justify-between gap-2">
        <h3 class="min-w-0 flex-1 text-sm font-semibold text-ink-900">${esc(o.title)}</h3>
        ${manage ? `
          <button type="button" class="btn btn-ghost btn-sm" data-edit-opp="${esc(o.id)}" aria-label="Edit">
            <i class="fa-solid fa-pen text-[10px]"></i>
          </button>` : ''}
      </div>

      ${o.lead_id ? `
        <button type="button" class="mt-1 text-xs text-brand-700 hover:underline" data-goto-lead="${esc(o.lead_id)}">
          <i class="fa-solid fa-user-tie mr-1 text-[10px]"></i>${esc(o.lead_name || 'View lead')}
        </button>` : ''}

      <div class="mt-3 flex items-end justify-between gap-2">
        <div>
          <div class="text-lg font-semibold tabular-nums text-ink-900">${fmtMoney(o.value)}</div>
          <div class="text-xs text-ink-400">
            ${prob}% likely · ${fmtMoneyShort((Number(o.value || 0) * prob) / 100)} weighted
          </div>
        </div>
        ${badge(o.stage)}
      </div>

      <div class="mt-2.5 progress-track">
        <div class="progress-fill bg-brand-500" style="width:${Math.min(100, prob)}%"></div>
      </div>

      <div class="mt-2.5 flex items-center justify-between text-xs text-ink-400">
        <span>${o.expected_at ? `Expected ${fmtDate(o.expected_at)}` : 'No close date'}</span>
        <span>${fmtRelative(o.updated_at)}</span>
      </div>

      ${manage ? `
        <select class="field-select mt-3 text-xs" data-stage-move="${esc(o.id)}" aria-label="Move stage">
          ${options(store.meta.opportunity_stages, o.stage)}
        </select>` : ''}
    </article>`
}

/* -------------------------------- offers -------------------------------- */

async function renderOffers(body, page, reload, manage) {
  let payload
  try {
    payload = await api.get('/offers', { page, per_page: 25 })
  } catch (err) {
    body.innerHTML = errorState(err, 'data-retry')
    body.querySelector('[data-retry]')?.addEventListener('click', reload)
    return
  }

  const items = payload.data
  if (!items.length) {
    body.innerHTML = `<div class="card">${emptyState({
      icon: 'fa-file-contract',
      title: 'No offers yet.',
      message: 'Create an offer from a lead or opportunity to track what you actually proposed.',
      actionLabel: manage ? 'New Offer' : undefined,
      actionAttr: 'data-add-empty'
    })}</div>`
    body.querySelector('[data-add-empty]')?.addEventListener('click', () => openOfferForm(null, reload))
    return
  }

  const accepted = items.filter((o) => o.status === 'ACCEPTED')
  const acceptedValue = accepted.reduce((s, o) => s + Number(o.price || 0), 0)
  const sentValue = items
    .filter((o) => ['SENT', 'VIEWED'].includes(o.status))
    .reduce((s, o) => s + Number(o.price || 0), 0)

  body.innerHTML = `
    <div class="space-y-4">
      <div class="grid grid-cols-3 gap-3">
        ${tile('Offers', fmtNumber(payload.meta.total), 'All time', 'fa-file-contract')}
        ${tile('Awaiting reply', fmtMoneyShort(sentValue), 'Sent or viewed', 'fa-paper-plane')}
        ${tile('Accepted', fmtMoneyShort(acceptedValue), `${accepted.length} offer(s)`, 'fa-circle-check')}
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto thin-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Offer</th>
                <th class="hidden sm:table-cell">Package</th>
                <th class="text-right">Price</th>
                <th>Status</th>
                <th class="hidden md:table-cell">Valid until</th>
                ${manage ? '<th class="w-10"></th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${items.map((o) => `
                <tr>
                  <td>
                    <div class="font-medium text-ink-900">${esc(o.title)}</div>
                    ${o.lead_name
                      ? `<button type="button" class="mt-0.5 text-xs text-brand-700 hover:underline"
                           data-goto-lead="${esc(o.lead_id)}">${esc(o.lead_name)}</button>`
                      : ''}
                  </td>
                  <td class="hidden text-ink-600 sm:table-cell">${esc(o.package || '—')}</td>
                  <td class="text-right font-semibold tabular-nums text-ink-800">${fmtMoney(o.price)}</td>
                  <td>${badge(o.status)}</td>
                  <td class="hidden text-ink-600 md:table-cell">${o.valid_until ? fmtDate(o.valid_until) : '—'}</td>
                  ${manage ? `
                    <td>
                      <button type="button" class="btn btn-ghost btn-sm" data-edit-offer="${esc(o.id)}" aria-label="Edit">
                        <i class="fa-solid fa-pen text-[10px]"></i>
                      </button>
                    </td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${paginationBar(payload.meta)}
      </div>
    </div>`

  body.querySelectorAll('[data-edit-offer]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const o = items.find((x) => x.id === btn.dataset.editOffer)
      openOfferForm(o, reload)
    }))
  body.querySelectorAll('[data-goto-lead]').forEach((btn) =>
    btn.addEventListener('click', () => navigate(`#/leads/${btn.dataset.gotoLead}`)))
  body.querySelectorAll('[data-page]').forEach((btn) =>
    btn.addEventListener('click', () => setQuery({ tab: 'offers', page: btn.dataset.page })))
}

function tile(label, value, sub, icon) {
  return `
    <article class="card card-pad">
      <div class="flex items-start justify-between gap-2">
        <span class="text-xs font-medium text-ink-500">${esc(label)}</span>
        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
          <i class="fa-solid ${icon} text-xs"></i>
        </span>
      </div>
      <div class="mt-1.5 text-lg font-semibold tabular-nums text-ink-900 sm:text-xl">${value}</div>
      <div class="mt-0.5 text-xs text-ink-400">${esc(sub)}</div>
    </article>`
}
