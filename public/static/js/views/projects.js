/**
 * Delivery OS views — project list, project detail, task board.
 * Progress and task counts are read from the database, never estimated client-side.
 */
import {
  api, store, esc, badge, fmtMoney, fmtNumber, fmtDate, fmtRelative, daysUntil,
  options, formValues, openModal, closeModal, confirmDialog,
  skeletonBlock, errorState, emptyState, noPermissionState, paginationBar,
  toast, toastError, withBusy, debounce
} from '../core.js'
import { navigate, setQuery } from '../router.js'
import { openActivityForm } from './leads.js'

/** Clients are needed for the project form's select; cached per session. */
let clientCache = null
async function loadClients() {
  if (clientCache) return clientCache
  if (!store.can('client.read')) return []
  try {
    const { data } = await api.get('/clients', { per_page: 100 })
    clientCache = data.map((c) => ({ value: c.id, label: c.name }))
  } catch {
    clientCache = []
  }
  return clientCache
}

function dueLabel(dueDate, status) {
  if (!dueDate) return '<span class="text-ink-400">No due date</span>'
  const d = daysUntil(dueDate)
  const settled = status === 'DELIVERED' || status === 'CANCELLED'
  if (settled) return `<span class="text-ink-500">${fmtDate(dueDate)}</span>`
  if (d < 0) return `<span class="font-medium text-rose-600">${Math.abs(d)}d overdue</span>`
  if (d === 0) return '<span class="font-medium text-amber-600">Due today</span>'
  if (d <= 7) return `<span class="font-medium text-amber-600">${d}d left</span>`
  return `<span class="text-ink-500">${fmtDate(dueDate)}</span>`
}

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

export async function openProjectForm(project = null, onSaved) {
  const editing = Boolean(project?.id)
  const m = store.meta
  const clients = await loadClients()

  openModal({
    title: editing ? 'Edit project' : 'New project',
    size: 'xl',
    body: `
      <form id="project-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="pr-name">Project name *</label>
          <input id="pr-name" name="name" class="field-input" required maxlength="200"
            value="${esc(project?.name || '')}" placeholder="e.g. Landing page + catalog">
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="pr-client">Client</label>
            <select id="pr-client" name="client_id" class="field-select">
              ${options(clients, project?.client_id || '', clients.length ? 'No client (internal)' : 'No clients available')}
            </select>
          </div>
          <div>
            <label class="field-label" for="pr-type">Type</label>
            <input id="pr-type" name="type" class="field-input" maxlength="120"
              value="${esc(project?.type || '')}" placeholder="e.g. Website, Branding">
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="pr-status">Status</label>
            <select id="pr-status" name="status" class="field-select">
              ${options(m.project_statuses, project?.status || 'PLANNED')}
            </select>
          </div>
          <div>
            <label class="field-label" for="pr-progress">Progress (%)</label>
            <input id="pr-progress" name="progress" type="number" min="0" max="100" class="field-input"
              value="${project?.progress ?? 0}">
          </div>
          <div>
            <label class="field-label" for="pr-value">Value</label>
            <input id="pr-value" name="value" type="number" min="0" step="100000" class="field-input"
              value="${project?.value ?? ''}" placeholder="0">
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="pr-start">Start date</label>
            <input id="pr-start" name="start_date" type="date" class="field-input"
              value="${esc((project?.start_date || '').slice(0, 10))}">
          </div>
          <div>
            <label class="field-label" for="pr-due">Due date</label>
            <input id="pr-due" name="due_date" type="date" class="field-input"
              value="${esc((project?.due_date || '').slice(0, 10))}">
          </div>
        </div>

        <div>
          <label class="field-label" for="pr-notes">Notes</label>
          <textarea id="pr-notes" name="notes" class="field-textarea" maxlength="4000"
            >${esc(project?.notes || '')}</textarea>
        </div>

        <div id="pr-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>${editing ? 'Save changes' : 'Create project'}</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#project-form')
      const errorBox = panel.querySelector('#pr-error')
      const btn = panel.querySelector('[data-save]')
      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.name) {
          errorBox.textContent = 'Project name is required.'
          errorBox.classList.remove('hidden')
          return
        }
        values.status = form.elements.status.value
        values.progress = Number(form.elements.progress.value || 0)
        if (values.value !== undefined) values.value = Number(values.value)

        const restore = withBusy(btn)
        try {
          if (editing) await api.patch(`/projects/${project.id}`, values)
          else await api.post('/projects', values)
          toast(editing ? 'Project updated.' : 'Project created.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not save the project.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

function openTaskForm(projectId, onSaved) {
  openModal({
    title: 'Add task',
    body: `
      <form id="task-form" class="space-y-4" novalidate>
        <div>
          <label class="field-label" for="tk-title">Task *</label>
          <input id="tk-title" name="title" class="field-input" required maxlength="300"
            placeholder="e.g. Draft homepage copy">
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="field-label" for="tk-status">Status</label>
            <select id="tk-status" name="status" class="field-select">
              ${options(store.meta.task_statuses, 'TODO')}
            </select>
          </div>
          <div>
            <label class="field-label" for="tk-priority">Priority</label>
            <select id="tk-priority" name="priority" class="field-select">
              ${options(store.meta.lead_priorities, 'MEDIUM')}
            </select>
          </div>
          <div>
            <label class="field-label" for="tk-due">Due date</label>
            <input id="tk-due" name="due_date" type="date" class="field-input">
          </div>
        </div>
        <div id="tk-error" class="hidden rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"></div>
      </form>`,
    footer: `
      <button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save>Add task</button>`,
    onMount: (panel) => {
      const form = panel.querySelector('#task-form')
      const errorBox = panel.querySelector('#tk-error')
      const btn = panel.querySelector('[data-save]')
      btn.addEventListener('click', async () => {
        errorBox.classList.add('hidden')
        const values = formValues(form)
        if (!values.title) {
          errorBox.textContent = 'Task title is required.'
          errorBox.classList.remove('hidden')
          return
        }
        values.status = form.elements.status.value
        values.priority = form.elements.priority.value
        const restore = withBusy(btn)
        try {
          await api.post(`/projects/${projectId}/tasks`, values)
          toast('Task added.', 'success')
          closeModal()
          if (onSaved) await onSaved()
        } catch (err) {
          restore()
          errorBox.textContent = err?.message || 'Could not add the task.'
          errorBox.classList.remove('hidden')
        }
      })
    }
  })
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

function projectCard(p) {
  const pct = Math.max(0, Math.min(100, Number(p.progress || 0)))
  const overdue = p.due_date && daysUntil(p.due_date) < 0 &&
    p.status !== 'DELIVERED' && p.status !== 'CANCELLED'
  return `
    <article class="card card-pad cursor-pointer transition hover:border-ink-300 hover:shadow-sm"
      data-project="${esc(p.id)}" role="button" tabindex="0">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="truncate text-sm font-semibold text-ink-900">${esc(p.name)}</h3>
          <p class="truncate text-xs text-ink-500">${esc(p.client_name || 'Internal project')}</p>
        </div>
        <div class="shrink-0 text-right">
          <div class="text-sm font-semibold tabular-nums text-ink-800">${fmtMoney(p.value)}</div>
        </div>
      </div>

      <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
        ${badge(p.status)}
        ${overdue ? '<span class="badge bg-rose-50 text-rose-700">Overdue</span>' : ''}
        ${p.type ? `<span class="badge bg-ink-100 text-ink-600">${esc(p.type)}</span>` : ''}
      </div>

      <div class="mt-3">
        <div class="mb-1 flex items-center justify-between text-xs">
          <span class="text-ink-400">${fmtNumber(p.task_done)}/${fmtNumber(p.task_count)} tasks</span>
          <span class="font-medium tabular-nums text-ink-600">${pct}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${overdue ? 'bg-rose-500' : pct >= 100 ? 'bg-emerald-500' : 'bg-ink-900'}"
            style="width:${pct}%"></div>
        </div>
      </div>

      <div class="mt-2.5 text-xs">${dueLabel(p.due_date, p.status)}</div>
    </article>`
}

export async function renderProjectList(outlet, query) {
  if (!store.can('project.read')) {
    outlet.innerHTML = noPermissionState('project.read')
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
            <label class="field-label" for="pr-q">Search</label>
            <input id="pr-q" class="field-input" placeholder="Project name or type…" value="${esc(filters.q)}">
          </div>
          <div class="w-full sm:w-44">
            <label class="field-label" for="pr-status-f">Status</label>
            <select id="pr-status-f" class="field-select">
              ${options(store.meta.project_statuses, filters.status, 'All statuses')}
            </select>
          </div>
          ${store.can('project.create') ? `
            <button type="button" class="btn btn-primary ml-auto" data-add>
              <i class="fa-solid fa-plus text-xs"></i>New project
            </button>` : ''}
        </div>
      </section>

      <div id="pr-list">${skeletonBlock(4)}</div>
    </div>`

  const applyFilters = (patch) => setQuery({ ...query, page: 1, ...patch })
  const qInput = outlet.querySelector('#pr-q')
  qInput.addEventListener('input', debounce(() => applyFilters({ q: qInput.value.trim() || null }), 400))
  outlet.querySelector('#pr-status-f').addEventListener('change', (e) => applyFilters({ status: e.target.value || null }))

  const reload = () => renderProjectList(outlet, query)
  outlet.querySelector('[data-add]')?.addEventListener('click', () => openProjectForm(null, reload))

  const list = outlet.querySelector('#pr-list')
  let payload
  try {
    payload = await api.get('/projects', {
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
            title: 'No projects match these filters',
            message: 'Try clearing the search or choosing another status.',
            actionLabel: 'Clear filters',
            actionAttr: 'data-clear'
          })
        : emptyState({
            icon: 'fa-diagram-project',
            title: 'No projects yet.',
            message: 'Create a project to track delivery, tasks and the revenue attached to it.',
            actionLabel: store.can('project.create') ? 'New Project' : undefined,
            actionAttr: 'data-add-empty'
          })
    }</div>`
    list.querySelector('[data-clear]')?.addEventListener('click', () => setQuery({}))
    list.querySelector('[data-add-empty]')?.addEventListener('click', () => openProjectForm(null, reload))
    return
  }

  list.innerHTML = `
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">${items.map(projectCard).join('')}</div>
    <div class="card mt-3">${paginationBar(payload.meta)}</div>`

  list.querySelectorAll('[data-project]').forEach((el) => {
    const go = () => navigate(`#/projects/${el.dataset.project}`)
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

const TASK_COLUMNS = ['TODO', 'DOING', 'BLOCKED', 'DONE']

export async function renderProjectDetail(outlet, id) {
  if (!store.can('project.read')) {
    outlet.innerHTML = noPermissionState('project.read')
    return
  }
  outlet.innerHTML = skeletonBlock(4)

  const reload = () => renderProjectDetail(outlet, id)

  let data
  try {
    const res = await api.get(`/projects/${id}`)
    data = res.data
  } catch (err) {
    outlet.innerHTML = errorState(err, 'data-retry')
    outlet.querySelector('[data-retry]')?.addEventListener('click', reload)
    return
  }

  const { project: p, tasks, activities } = data
  const pct = Math.max(0, Math.min(100, Number(p.progress || 0)))
  const canEdit = store.can('project.update')

  const grouped = TASK_COLUMNS.reduce((acc, s) => {
    acc[s] = tasks.filter((t) => t.status === s)
    return acc
  }, {})

  outlet.innerHTML = `
    <div class="space-y-4">
      <button type="button" class="btn btn-ghost btn-sm -ml-2" data-back>
        <i class="fa-solid fa-arrow-left text-[10px]"></i>All projects
      </button>

      <section class="card card-pad">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-ink-900">${esc(p.name)}</h2>
            <p class="mt-0.5 text-sm text-ink-500">
              ${p.client_id
                ? `<button type="button" class="text-brand-700 hover:underline" data-goto-client="${esc(p.client_id)}">
                     ${esc(p.client_name || 'Client')}
                   </button>`
                : 'Internal project'}
              ${p.type ? ` · ${esc(p.type)}` : ''}
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              ${badge(p.status)}
              ${p.is_demo ? '<span class="badge bg-ink-100 text-ink-500">Demo</span>' : ''}
            </div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-2">
            ${store.can('activity.create') ? `
              <button type="button" class="btn btn-secondary btn-sm" data-log>
                <i class="fa-solid fa-plus text-[10px]"></i>Log activity
              </button>` : ''}
            ${canEdit ? `
              <button type="button" class="btn btn-secondary btn-sm" data-edit>
                <i class="fa-solid fa-pen text-[10px]"></i>Edit
              </button>` : ''}
            ${store.can('project.delete') ? `
              <button type="button" class="btn btn-ghost btn-sm text-rose-600" data-del>
                <i class="fa-solid fa-trash text-[10px]"></i>Delete
              </button>` : ''}
          </div>
        </div>

        <div class="mt-5">
          <div class="mb-1.5 flex items-center justify-between text-xs">
            <span class="font-medium text-ink-600">Progress</span>
            <span class="font-semibold tabular-nums text-ink-800">${pct}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${pct >= 100 ? 'bg-emerald-500' : 'bg-ink-900'}" style="width:${pct}%"></div>
          </div>
        </div>

        <dl class="mt-5 grid grid-cols-2 gap-4 border-t border-ink-100 pt-4 sm:grid-cols-4">
          <div><dt class="text-xs text-ink-400">Value</dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-ink-800">${fmtMoney(p.value)}</dd></div>
          <div><dt class="text-xs text-ink-400">Start</dt>
            <dd class="mt-0.5 text-sm font-medium text-ink-800">${p.start_date ? fmtDate(p.start_date) : '—'}</dd></div>
          <div><dt class="text-xs text-ink-400">Due</dt>
            <dd class="mt-0.5 text-sm font-medium">${dueLabel(p.due_date, p.status)}</dd></div>
          <div><dt class="text-xs text-ink-400">Tasks done</dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-ink-800">
              ${fmtNumber(grouped.DONE.length)}/${fmtNumber(tasks.length)}
            </dd></div>
        </dl>

        ${p.notes ? `
          <div class="mt-4 rounded-lg bg-ink-50 px-4 py-3">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-500">Notes</h3>
            <p class="mt-1.5 whitespace-pre-wrap text-sm text-ink-700">${esc(p.notes)}</p>
          </div>` : ''}
      </section>

      <section class="card">
        <header class="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 class="text-sm font-semibold text-ink-900">Tasks</h3>
            <p class="mt-0.5 text-xs text-ink-400">Change a status from the dropdown on each task.</p>
          </div>
          ${canEdit ? `
            <button type="button" class="btn btn-secondary btn-sm" data-add-task>
              <i class="fa-solid fa-plus text-[10px]"></i>Add task
            </button>` : ''}
        </header>

        ${tasks.length ? `
          <div class="grid gap-4 p-5 lg:grid-cols-4">
            ${TASK_COLUMNS.map((col) => `
              <div>
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    ${esc(col.replace('_', ' '))}
                  </span>
                  <span class="text-xs tabular-nums text-ink-400">${grouped[col].length}</span>
                </div>
                <div class="space-y-2">
                  ${grouped[col].length ? grouped[col].map((t) => taskCard(t, canEdit)).join('')
                    : '<div class="rounded-lg border border-dashed border-ink-200 px-3 py-4 text-center text-xs text-ink-400">Empty</div>'}
                </div>
              </div>`).join('')}
          </div>`
        : `<div class="px-5 py-8 text-center text-sm text-ink-500">
             No tasks yet. Break the delivery into steps so progress is measurable.
           </div>`}
      </section>

      <section class="card">
        <header class="border-b border-ink-100 px-5 py-4">
          <h3 class="text-sm font-semibold text-ink-900">Activity</h3>
        </header>
        ${activities.length ? `
          <ul class="px-5 py-4">
            ${activities.map((a) => `
              <li class="timeline-item">
                <span class="timeline-dot bg-ink-300"></span>
                <div class="flex flex-wrap items-center gap-2">
                  ${badge(a.type)}
                  <span class="text-xs text-ink-400">${fmtRelative(a.created_at)}</span>
                </div>
                <p class="mt-1 text-sm text-ink-700">${esc(a.description)}</p>
              </li>`).join('')}
          </ul>`
        : '<div class="px-5 py-8 text-center text-sm text-ink-500">No activity recorded for this project.</div>'}
      </section>
    </div>`

  /* ------------------------------ wiring ------------------------------ */

  outlet.querySelector('[data-back]').addEventListener('click', () => navigate('#/projects'))
  outlet.querySelector('[data-edit]')?.addEventListener('click', () => openProjectForm(p, reload))
  outlet.querySelector('[data-add-task]')?.addEventListener('click', () => openTaskForm(p.id, reload))
  outlet.querySelector('[data-log]')?.addEventListener('click', () =>
    openActivityForm({ entityType: 'PROJECT', entityId: p.id, entityName: p.name }, reload))
  outlet.querySelector('[data-goto-client]')?.addEventListener('click', (e) =>
    navigate(`#/clients/${e.currentTarget.dataset.gotoClient}`))

  outlet.querySelectorAll('[data-task-status]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      try {
        await api.patch(`/tasks/${sel.dataset.taskStatus}`, { status: sel.value })
        toast('Task updated.', 'success')
        await reload()
      } catch (err) {
        toastError(err)
        await reload()
      }
    }))

  outlet.querySelector('[data-del]')?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Delete this project?',
      message: `${p.name} and its tasks will be removed permanently.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!yes) return
    try {
      await api.del(`/projects/${p.id}`)
      toast('Project deleted.', 'success')
      navigate('#/projects')
    } catch (err) {
      toastError(err)
    }
  })
}

function taskCard(t, canEdit) {
  const overdue = t.due_date && daysUntil(t.due_date) < 0 && t.status !== 'DONE'
  return `
    <article class="rounded-lg border border-ink-200 bg-white p-2.5">
      <p class="text-sm text-ink-800">${esc(t.title)}</p>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        ${badge(t.priority)}
        ${t.due_date
          ? `<span class="badge ${overdue ? 'bg-rose-50 text-rose-700' : 'bg-ink-100 text-ink-600'}">
               ${fmtDate(t.due_date)}
             </span>`
          : ''}
      </div>
      ${canEdit ? `
        <select class="field-select mt-2 text-xs" data-task-status="${esc(t.id)}" aria-label="Task status">
          ${options(store.meta.task_statuses, t.status)}
        </select>` : ''}
    </article>`
}
