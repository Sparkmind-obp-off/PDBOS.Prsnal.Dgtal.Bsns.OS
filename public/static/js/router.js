/**
 * Hash router.
 *
 * A route is `#/segment/segment?key=value`. The router owns three things:
 *   1. parsing the hash into { path, segments, query }
 *   2. resolving a route definition and invoking its render function
 *   3. rewriting the query string without losing the current view
 *
 * Views never read window.location directly — they receive the parsed query,
 * which keeps every list view shareable and reload-safe.
 */

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

function parseHash(raw) {
  // "#/leads/abc?status=NEW" → { path: '/leads/abc', segments: ['leads','abc'], query: {…} }
  let hash = String(raw || '').replace(/^#/, '')
  if (!hash || hash === '/') hash = '/dashboard'

  const qIndex = hash.indexOf('?')
  const path = qIndex >= 0 ? hash.slice(0, qIndex) : hash
  const search = qIndex >= 0 ? hash.slice(qIndex + 1) : ''

  const query = {}
  for (const [k, v] of new URLSearchParams(search)) query[k] = v

  const segments = path.split('/').filter(Boolean)
  return { path: `/${segments.join('/')}`, segments, query }
}

export function currentRoute() {
  return parseHash(window.location.hash)
}

/* ------------------------------------------------------------------ *
 * Route table
 * ------------------------------------------------------------------ */

const routes = []
let notFoundHandler = null
let beforeEach = null
let renderToken = 0

/**
 * Register a route.
 *
 * @param {string} pattern e.g. '/leads' or '/leads/:id'
 * @param {object} def     { title, subtitle, nav, permission, render }
 */
export function route(pattern, def) {
  const parts = pattern.split('/').filter(Boolean)
  routes.push({ pattern, parts, ...def })
}

export function setNotFound(handler) {
  notFoundHandler = handler
}

/** Runs before every render — used by the shell to sync chrome and guards. */
export function onBeforeEach(fn) {
  beforeEach = fn
}

function match(segments) {
  for (const r of routes) {
    if (r.parts.length !== segments.length) continue
    const params = {}
    let hit = true
    for (let i = 0; i < r.parts.length; i++) {
      const part = r.parts[i]
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[i])
      } else if (part !== segments[i]) {
        hit = false
        break
      }
    }
    if (hit) return { def: r, params }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

export function navigate(hash, { replace = false } = {}) {
  const target = hash.startsWith('#') ? hash : `#${hash.startsWith('/') ? '' : '/'}${hash}`
  if (window.location.hash === target) {
    // Same hash: hashchange will not fire, so render explicitly.
    resolve()
    return
  }
  if (replace) window.location.replace(target)
  else window.location.hash = target
}

/**
 * Rewrite only the query string of the current view.
 * Keys with null/undefined/'' values are removed.
 */
export function setQuery(next) {
  const { path } = currentRoute()
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(next || {})) {
    if (v === null || v === undefined || v === '') continue
    sp.set(k, String(v))
  }
  const search = sp.toString()
  navigate(`#${path}${search ? `?${search}` : ''}`)
}

/** Merge a patch into the current query, resetting pagination by default. */
export function patchQuery(patch, { resetPage = true } = {}) {
  const { query } = currentRoute()
  const merged = { ...query, ...patch }
  if (resetPage) delete merged.page
  setQuery(merged)
}

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

export async function resolve() {
  const current = currentRoute()
  const found = match(current.segments)

  // Each render gets a token; a slower earlier render is discarded when the
  // user navigates again mid-flight, so stale markup never wins.
  const token = ++renderToken
  const isStale = () => token !== renderToken

  if (beforeEach) beforeEach(found?.def ?? null, current)

  if (!found) {
    if (notFoundHandler) notFoundHandler(current)
    return
  }

  try {
    await found.def.render({
      params: found.params,
      query: current.query,
      path: current.path,
      isStale
    })
  } catch (err) {
    if (!isStale()) console.error('[PDBOS] route render failed:', err)
  }
}

export function startRouter() {
  window.addEventListener('hashchange', resolve)
  resolve()
}

/** All registered routes — the shell builds navigation from this. */
export function routeTable() {
  return routes.slice()
}
