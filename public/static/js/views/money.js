/**
 * Money OS view — invoices, payments, expenses.
 *
 * Every figure on this page comes from GET /api/money, which aggregates in
 * SQL. The client never sums a partial page and calls it revenue.
 */
import {
  api, store, esc, badge, fmtMoney, fmtMoneyShort, fmtNumber, fmtDate, daysUntil,
  options, formValues, openModal, closeModal,
  skeletonBlock, errorState, emptyState, noPermissionState, sectionHeader,
  toast, toastError, withBusy
} from '../core.js'
import { setQuery } from '../router.js'

/** Today as YYYY-MM-DD, used as the default date on money forms. */
function today() {
  return new Date().toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ *
 * Reference loaders
 * ------------------------------------------------------------------ */

/**
 * Clients and projects are needed as <select> sources on the invoice form.
 * A missing permission is not fatal — the selects simply stay empty and the
 * invoice is recorded without a link.
 */
async function loadRefs() {
  const [clients, projects, resources] = await Promise.all([
    store.can('client.read')
      ? api.get('/clients', { per_page: 100 }).then((r) => r.data).catch(() => [])
      : Promise.resolve([]),
    store.can('project.read')
      ? api.get('/projects', { per_page: 100 }).then((r) => r.data).catch(() => [])
      : Promise.resolve([]),
    store.can('resource.read')
      ? api.get('/resources', { per_page: 100 }).then((r) => r.data).catch(() => [])
      : Promise.resolve([])
  ])
  return { clients, projects, resources }
}

function refOptions(list, selected, placeholder) {
  return options(list.map((r) => ({ value: r.id, label: r.name })), selected, placeholder)
}

/* ------------------------------------------------------------------ *
 * Invoice form
 * ------------------------------------------------------------------ */

async function openInvoiceForm(onSaved) {
  const { clients, projects } = await loadRefs()

  openModal({
    title: 'New invoice',
    size: 'xl',
    body: `
      <form id="inv-form" class="space-y-4" novalidate>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="inv-client">Client</label>
            <select id="inv-client" name="client_id" class="field-select">
              ${refOptions(clients, '', clients.length ? 'No client' : 'No clients available')}
            </select>
          </div>
          <div>
            <label class="field-label" for="inv-project">Project</label>
            <select id="inv-project" name="project_id" class="field-select">
              ${refOptions(projects, '', projects.length ? 'No project' : 'No projects available')}
            </select>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="inv-number">Invoice number</label>
            <input id="inv-number" name="number" class="field-input" maxlength="60"
              placeholder="Auto-generated when empty">
          </div>
          <div>
            <label class="field-label" for="inv-amount">Amount *</label>
            <input id="inv-amount" name="amount" type="number" min="0" step="50000" class="field-input"
              required placeholder="0">
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="inv-status">Status</label>
            <select id="inv-status" name="status" class="field-select">
              ${options(store.meta.invoice_statuses, 'SENT')}
            </select>
          </div>
          <div>
            <label class="field-label" for="inv-issued">Issued</label>
            <input id="inv-issued" name="issued_at" type="date" class="field-input" value="${today()}">
          </div>
          <div>
            <label class="field-label" for="inv-due">Due</label>
            <input id="inv-due" name="due_at" type="date" class="field-input">
          </div>
        </div>

        <div>
          <label class="field-label" for="inv-notes">Notes</label>
          <textarea id="inv-notes" name="notes" class="field-textarea" maxlength="2000"
            placeholder="What this invoice covers"></textarea>
        </div>

        <div id="inv-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>Create invoice</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#inv-form')
      const errorBox = panel.querySelector('#inv-error')
      const btn = panel.querySelector('[data-save]')

      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        const amount = Number(values.amount)
        if (!values.amount || !Number.isFinite(amount) || amount <= 0) {
          errorBox.textContent = 'Enter an amount greater than zero.'
          errorBox.classList.remove('hidden')
          return
        }
        values.amount = amount
        values.status = form.elements.status.value

        const restore = withBusy(btn, 'Creating…')
        try {
          await api.post('/invoices', values)
          toast('Invoice created.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not create the invoice.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

/* ------------------------------------------------------------------ *
 * Payment form
 * ------------------------------------------------------------------ */

/**
 * Recording a payment against an invoice is the common case, so the amount
 * defaults to the invoice total and the client is inherited from it.
 */
function openPaymentForm(invoice, onSaved) {
  openModal({
    title: invoice ? `Record payment — ${invoice.number || 'invoice'}` : 'Record payment',
    size: 'lg',
    body: `
      <form id="pay-form" class="space-y-4" novalidate>
        ${invoice ? `
          <div class="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5 text-sm">
            <div class="flex items-center justify-between gap-2">
              <span class="text-ink-500">Invoice</span>
              <span class="font-medium text-ink-900">${esc(invoice.number || invoice.id)}</span>
            </div>
            <div class="mt-1 flex items-center justify-between gap-2">
              <span class="text-ink-500">Amount due</span>
              <span class="font-semibold tabular-nums text-ink-900">${fmtMoney(invoice.amount)}</span>
            </div>
            ${invoice.client_name ? `
              <div class="mt-1 flex items-center justify-between gap-2">
                <span class="text-ink-500">Client</span>
                <span class="text-ink-700">${esc(invoice.client_name)}</span>
              </div>` : ''}
          </div>` : ''}

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="pay-amount">Amount received *</label>
            <input id="pay-amount" name="amount" type="number" min="0" step="50000" class="field-input"
              required value="${invoice?.amount ?? ''}" placeholder="0">
          </div>
          <div>
            <label class="field-label" for="pay-date">Paid on</label>
            <input id="pay-date" name="paid_at" type="date" class="field-input" value="${today()}">
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="pay-method">Method</label>
            <input id="pay-method" name="method" class="field-input" maxlength="60"
              placeholder="Transfer, QRIS, cash…">
          </div>
          <div>
            <label class="field-label" for="pay-ref">Reference</label>
            <input id="pay-ref" name="reference" class="field-input" maxlength="120"
              placeholder="Transaction id">
          </div>
        </div>

        <p class="text-xs text-ink-400">
          Recording the full amount marks the invoice paid; a smaller amount marks it partial.
        </p>

        <div id="pay-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>Record payment</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#pay-form')
      const errorBox = panel.querySelector('#pay-error')
      const btn = panel.querySelector('[data-save]')

      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        const amount = Number(values.amount)
        if (!values.amount || !Number.isFinite(amount) || amount <= 0) {
          errorBox.textContent = 'Enter an amount greater than zero.'
          errorBox.classList.remove('hidden')
          return
        }
        values.amount = amount
        if (invoice) {
          values.invoice_id = invoice.id
          if (invoice.client_id) values.client_id = invoice.client_id
        }

        const restore = withBusy(btn, 'Recording…')
        try {
          await api.post('/payments', values)
          toast('Payment recorded.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not record the payment.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

/* ------------------------------------------------------------------ *
 * Expense form
 * ------------------------------------------------------------------ */

async function openExpenseForm(onSaved) {
  const { projects, resources } = await loadRefs()

  openModal({
    title: 'New expense',
    size: 'xl',
    body: `
      <form id="exp-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="exp-desc">Description *</label>
          <input id="exp-desc" name="description" class="field-input" required maxlength="300"
            placeholder="e.g. Cloudflare Workers paid plan">
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="exp-amount">Amount *</label>
            <input id="exp-amount" name="amount" type="number" min="0" step="10000" class="field-input"
              required placeholder="0">
          </div>
          <div>
            <label class="field-label" for="exp-cat">Category</label>
            <select id="exp-cat" name="category" class="field-select">
              ${options(store.meta.expense_categories, 'TOOL')}
            </select>
          </div>
          <div>
            <label class="field-label" for="exp-date">Spent on</label>
            <input id="exp-date" name="spent_at" type="date" class="field-input" value="${today()}">
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="exp-resource">Resource</label>
            <select id="exp-resource" name="resource_id" class="field-select">
              ${refOptions(resources, '', resources.length ? 'Not linked' : 'No resources available')}
            </select>
          </div>
          <div>
            <label class="field-label" for="exp-project">Project</label>
            <select id="exp-project" name="project_id" class="field-select">
              ${refOptions(projects, '', projects.length ? 'Not linked' : 'No projects available')}
            </select>
          </div>
          <div>
            <label class="field-label" for="exp-recurring">Recurring</label>
            <select id="exp-recurring" name="recurring" class="field-select">
              ${options(store.meta.recurring_options, 'NONE')}
            </select>
          </div>
        </div>

        <p class="text-xs text-ink-400">
          Linking an expense to a resource keeps the true monthly cost of your tool stack visible.
        </p>

        <div id="exp-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>Add expense</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#exp-form')
      const errorBox = panel.querySelector('#exp-error')
      const btn = panel.querySelector('[data-save]')

      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.description) {
          errorBox.textContent = 'Description is required.'
          errorBox.classList.remove('hidden')
          return
        }
        const amount = Number(values.amount)
        if (!values.amount || !Number.isFinite(amount) || amount <= 0) {
          errorBox.textContent = 'Enter an amount greater than zero.'
          errorBox.classList.remove('hidden')
          return
        }
        values.amount = amount
        values.category = form.elements.category.value
        values.recurring = form.elements.recurring.value

        const restore = withBusy(btn, 'Saving…')
        try {
          await api.post('/expenses', values)
          toast('Expense added.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not add the expense.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

/* ------------------------------------------------------------------ *
 * View
 * ------------------------------------------------------------------ */

export async function renderMoney(outlet, query) {
  if (!store.can('finance.read')) {
    outlet.innerHTML = noPermissionState('finance.read')
    return
  }

  const tab = query.tab === 'expenses' ? 'expenses' : 'invoices'
  const manage = store.can('finance.manage')

  outlet.innerHTML = `<div id="money-root">${skeletonBlock(5)}</div>`
  const root = outlet.querySelector('#money-root')

  let payload
  try {
    payload = await api.get('/money')
  } catch (err) {
    root.innerHTML = errorState(err, 'data-retry')
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderMoney(outlet, query))
    return
  }

  const t = payload.data.totals
  const invoices = payload.data.invoices
  const expenses = payload.data.expenses
  const reload = () => renderMoney(outlet, query)

  const net = Number(t.net_this_month || 0)
  const overdue = invoices.filter((i) => i.status === 'OVERDUE')

  root.innerHTML = `
    <div class="space-y-4">

      <!-- Totals -->
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        ${kpi('Revenue this month', fmtMoneyShort(t.revenue_this_month),
              `${fmtMoneyShort(t.revenue_total)} all time`, 'fa-arrow-trend-up', 'text-emerald-600')}
        ${kpi('Outstanding', fmtMoneyShort(t.outstanding),
              'Sent, partial or overdue', 'fa-file-invoice-dollar',
              Number(t.outstanding) > 0 ? 'text-amber-600' : 'text-ink-400')}
        ${kpi('Expenses this month', fmtMoneyShort(t.expenses_this_month),
              `${fmtMoneyShort(t.expenses_total)} all time`, 'fa-receipt', 'text-rose-600')}
        ${kpi('Net this month', fmtMoneyShort(net),
              net >= 0 ? 'Revenue exceeds cost' : 'Spending exceeds revenue', 'fa-scale-balanced',
              net >= 0 ? 'text-emerald-600' : 'text-rose-600')}
      </div>

      ${overdue.length ? `
        <div class="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <i class="fa-solid fa-triangle-exclamation mt-0.5 text-rose-500"></i>
          <div class="flex-1 text-sm text-rose-800">
            <span class="font-semibold">${fmtNumber(overdue.length)} invoice(s) overdue</span>
            — ${fmtMoney(overdue.reduce((s, i) => s + Number(i.amount || 0), 0))} waiting to be collected.
          </div>
        </div>` : ''}

      <!-- Tabs + actions -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <nav class="inline-flex rounded-lg border border-ink-200 bg-white p-1" aria-label="Money sections">
          <button type="button" data-tab="invoices"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === 'invoices' ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'}">
            Invoices
          </button>
          <button type="button" data-tab="expenses"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === 'expenses' ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'}">
            Expenses
          </button>
        </nav>
        ${manage ? `
          <div class="flex items-center gap-2">
            ${tab === 'invoices' ? `
              <button type="button" class="btn btn-secondary" data-add-payment>
                <i class="fa-solid fa-hand-holding-dollar text-xs"></i>Payment
              </button>
              <button type="button" class="btn btn-primary" data-add-invoice>
                <i class="fa-solid fa-plus text-xs"></i>Invoice
              </button>` : `
              <button type="button" class="btn btn-primary" data-add-expense>
                <i class="fa-solid fa-plus text-xs"></i>Expense
              </button>`}
          </div>` : ''}
      </div>

      <div id="money-body"></div>
    </div>`

  root.querySelectorAll('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => setQuery({ tab: btn.dataset.tab })))

  root.querySelector('[data-add-invoice]')?.addEventListener('click', () => openInvoiceForm(reload))
  root.querySelector('[data-add-payment]')?.addEventListener('click', () => openPaymentForm(null, reload))
  root.querySelector('[data-add-expense]')?.addEventListener('click', () => openExpenseForm(reload))

  const body = root.querySelector('#money-body')
  if (tab === 'expenses') renderExpenses(body, expenses, { manage, reload })
  else renderInvoices(body, invoices, { manage, reload })
}

/* ------------------------------- invoices ------------------------------- */

function renderInvoices(body, invoices, { manage, reload }) {
  if (!invoices.length) {
    body.innerHTML = `<div class="card">${emptyState({
      icon: 'fa-file-invoice-dollar',
      title: 'No invoices yet.',
      message: 'Issue an invoice when a deal is agreed, so outstanding money is never only in your head.',
      actionLabel: manage ? 'Add Invoice' : undefined,
      actionAttr: 'data-add-empty'
    })}</div>`
    body.querySelector('[data-add-empty]')?.addEventListener('click', () => openInvoiceForm(reload))
    return
  }

  body.innerHTML = `
    <div class="card overflow-hidden">
      <div class="overflow-x-auto thin-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th class="hidden sm:table-cell">Client</th>
              <th class="text-right">Amount</th>
              <th>Status</th>
              <th class="hidden md:table-cell">Due</th>
              ${manage ? '<th class="w-24"></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${invoices.map((i) => invoiceRow(i, manage)).join('')}
          </tbody>
        </table>
      </div>
      <div class="px-4 py-3 text-xs text-ink-500">
        Showing the ${fmtNumber(invoices.length)} most recent invoice(s).
      </div>
    </div>`

  body.querySelectorAll('[data-pay]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const inv = invoices.find((x) => x.id === btn.dataset.pay)
      openPaymentForm(inv, reload)
    }))

  body.querySelectorAll('[data-inv-status]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      try {
        await api.patch(`/invoices/${sel.dataset.invStatus}`, { status: sel.value })
        toast('Invoice status updated.', 'success')
        await reload()
      } catch (err) {
        toastError(err)
        await reload()
      }
    }))
}

function invoiceRow(i, manage) {
  const due = daysUntil(i.due_at)
  const unpaid = !['PAID', 'VOID'].includes(i.status)
  let dueLabel = '—'
  if (i.due_at) {
    if (due === null) dueLabel = fmtDate(i.due_at)
    else if (due < 0 && unpaid) dueLabel = `<span class="text-rose-600">${-due}d overdue</span>`
    else if (due === 0 && unpaid) dueLabel = '<span class="text-amber-600">Due today</span>'
    else dueLabel = fmtDate(i.due_at)
  }

  return `
    <tr>
      <td>
        <div class="font-medium text-ink-900">${esc(i.number || i.id)}</div>
        <div class="text-xs text-ink-400">
          ${i.issued_at ? `Issued ${fmtDate(i.issued_at)}` : 'Not issued'}
        </div>
      </td>
      <td class="hidden text-ink-600 sm:table-cell">${esc(i.client_name || '—')}</td>
      <td class="text-right font-semibold tabular-nums text-ink-800">${fmtMoney(i.amount)}</td>
      <td>${badge(i.status)}</td>
      <td class="hidden text-ink-600 md:table-cell">${dueLabel}</td>
      ${manage ? `
        <td>
          <div class="flex items-center gap-1">
            ${unpaid ? `
              <button type="button" class="btn btn-ghost btn-sm" data-pay="${esc(i.id)}" title="Record payment">
                <i class="fa-solid fa-hand-holding-dollar text-[10px]"></i>
              </button>` : ''}
            <select class="field-select !w-auto !py-1 text-xs" data-inv-status="${esc(i.id)}"
              aria-label="Invoice status">
              ${options(store.meta.invoice_statuses, i.status)}
            </select>
          </div>
        </td>` : ''}
    </tr>`
}

/* ------------------------------- expenses ------------------------------- */

function renderExpenses(body, expenses, { manage, reload }) {
  if (!expenses.length) {
    body.innerHTML = `<div class="card">${emptyState({
      icon: 'fa-receipt',
      title: 'No expenses recorded.',
      message: 'Log tool and API costs so profit reflects reality, not just incoming payments.',
      actionLabel: manage ? 'Add Expense' : undefined,
      actionAttr: 'data-add-empty'
    })}</div>`
    body.querySelector('[data-add-empty]')?.addEventListener('click', () => openExpenseForm(reload))
    return
  }

  // Category breakdown of the records on screen — labelled as such, so it is
  // never mistaken for the all-time total shown in the KPI row.
  const byCategory = expenses.reduce((acc, e) => {
    const key = e.category || 'OTHER'
    acc[key] = (acc[key] || 0) + Number(e.amount || 0)
    return acc
  }, {})
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1])
  const shown = categories.reduce((s, [, v]) => s + v, 0)
  const recurring = expenses.filter((e) => e.recurring && e.recurring !== 'NONE')
  const monthlyCommitted = recurring
    .filter((e) => e.recurring === 'MONTHLY')
    .reduce((s, e) => s + Number(e.amount || 0), 0)

  body.innerHTML = `
    <div class="space-y-4">
      <section class="card card-pad">
        ${sectionHeader('Cost mix', { subtitle: `Across the ${fmtNumber(expenses.length)} most recent expense(s)` })}
        <div class="space-y-2.5">
          ${categories.map(([cat, amount]) => {
            const pct = shown ? Math.round((amount / shown) * 100) : 0
            return `
              <div>
                <div class="flex items-center justify-between gap-2 text-sm">
                  <span class="text-ink-700">${esc(cat.replace(/_/g, ' '))}</span>
                  <span class="tabular-nums text-ink-600">${fmtMoneyShort(amount)} · ${pct}%</span>
                </div>
                <div class="mt-1 progress-track">
                  <div class="progress-fill bg-ink-400" style="width:${pct}%"></div>
                </div>
              </div>`
          }).join('')}
        </div>
        ${monthlyCommitted > 0 ? `
          <p class="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
            <i class="fa-solid fa-rotate mr-1"></i>
            ${fmtMoneyShort(monthlyCommitted)} of this repeats every month
            (${fmtNumber(recurring.filter((e) => e.recurring === 'MONTHLY').length)} recurring item(s)).
          </p>` : ''}
      </section>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto thin-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Expense</th>
                <th class="hidden sm:table-cell">Category</th>
                <th class="hidden md:table-cell">Linked resource</th>
                <th class="text-right">Amount</th>
                <th class="hidden sm:table-cell">Date</th>
              </tr>
            </thead>
            <tbody>
              ${expenses.map((e) => `
                <tr>
                  <td>
                    <div class="font-medium text-ink-900">${esc(e.description)}</div>
                    ${e.recurring && e.recurring !== 'NONE'
                      ? `<div class="text-xs text-ink-400">
                           <i class="fa-solid fa-rotate mr-1 text-[10px]"></i>${esc(e.recurring.toLowerCase())}
                         </div>`
                      : ''}
                  </td>
                  <td class="hidden sm:table-cell">${badge(e.category || 'OTHER')}</td>
                  <td class="hidden text-ink-600 md:table-cell">${esc(e.resource_name || '—')}</td>
                  <td class="text-right font-semibold tabular-nums text-ink-800">${fmtMoney(e.amount)}</td>
                  <td class="hidden text-ink-600 sm:table-cell">${e.spent_at ? fmtDate(e.spent_at) : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="px-4 py-3 text-xs text-ink-500">
          Showing the ${fmtNumber(expenses.length)} most recent expense(s).
        </div>
      </div>
    </div>`
}

/* -------------------------------- shared -------------------------------- */

function kpi(label, value, sub, icon, valueColor = 'text-ink-900') {
  return `
    <article class="card card-pad">
      <div class="flex items-start justify-between gap-2">
        <span class="text-xs font-medium text-ink-500">${esc(label)}</span>
        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
          <i class="fa-solid ${icon} text-xs"></i>
        </span>
      </div>
      <div class="mt-2 text-xl font-semibold tabular-nums ${valueColor} sm:text-2xl">${value}</div>
      <div class="mt-1 text-xs text-ink-400">${esc(sub)}</div>
    </article>`
}
