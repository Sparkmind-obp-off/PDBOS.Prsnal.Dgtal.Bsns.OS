/**
 * Discovery Engine.
 *
 * Pipeline: Search → Source → Normalize → Deduplicate → Store → (Analyze/Score on import)
 *
 * The pipeline is real and fully wired. Which provider supplies the candidates
 * is decided by the adapter registry; the `manual_entry` adapter always works,
 * and `google_places` activates the moment its server secret exists.
 */
import { newId } from '../lib/id'
import { badRequest, notFound, notConfigured } from '../lib/http'
import { dedupeKey } from '../lib/validate'
import { getAdapter } from '../integrations/registry'
import { isDiscoveryAdapter } from '../integrations/types'
import { incrementUsage, logIntegration } from './integrations'
import { createLead } from './leads'
import type { Bindings } from '../types'

export function listDiscoveryProviders(env: Bindings) {
  return ['manual_entry', 'google_places']
    .map((k) => getAdapter(k))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => ({
      key: a.key,
      name: a.name,
      configured: a.isConfigured(env),
      capabilities: a.capabilities,
      secret_ref: a.secretRef ?? null
    }))
}

export async function runDiscovery(
  db: D1Database,
  env: Bindings,
  orgId: string,
  userId: string,
  input: { provider_key: string; query: string; location?: string | null; limit?: number }
) {
  const adapter = getAdapter(input.provider_key)
  if (!adapter) throw notFound('Discovery provider not found.')
  if (!isDiscoveryAdapter(adapter)) throw badRequest('This provider does not support discovery.')

  const runId = newId('dsc')
  const started = Date.now()

  if (!adapter.isConfigured(env)) {
    await db
      .prepare(
        `INSERT INTO discovery_runs (id, org_id, provider_key, query, location, status, message, created_by)
         VALUES (?, ?, ?, ?, ?, 'NOT_CONFIGURED', ?, ?)`
      )
      .bind(
        runId, orgId, input.provider_key, input.query, input.location ?? null,
        `Provider requires the server secret ${adapter.secretRef ?? ''}.`, userId
      )
      .run()
    throw notConfigured(
      `${adapter.name} is not configured. Add ${adapter.secretRef} as a Cloudflare secret to enable it.`
    )
  }

  let candidates: Awaited<ReturnType<typeof adapter.search>> = []
  let status = 'OK'
  let message = ''

  try {
    candidates = await adapter.search(
      { env, orgId, config: {} },
      { query: input.query, location: input.location, limit: input.limit ?? 20 }
    )
    message = `${candidates.length} candidate(s) found.`
  } catch (err: any) {
    status = err?.code === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'ERROR'
    message = status === 'NOT_CONFIGURED' ? 'Provider not configured.' : 'Provider request failed.'
    console.error('[PDBOS] discovery failed:', err)
  }

  await db
    .prepare(
      `INSERT INTO discovery_runs (id, org_id, provider_key, query, location, status, result_count, message, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      runId, orgId, input.provider_key, input.query, input.location ?? null,
      status, candidates.length, message, userId
    )
    .run()

  // Normalize + mark existing duplicates, then store the results.
  const stored: any[] = []
  for (const cand of candidates) {
    const key = dedupeKey(cand.business_name, cand.city)
    const dupe = await db
      .prepare(`SELECT id FROM leads WHERE org_id = ? AND dedupe_key = ?`)
      .bind(orgId, key)
      .first<{ id: string }>()
    const resultId = newId('dsr')
    await db
      .prepare(
        `INSERT INTO discovery_results (id, run_id, org_id, business_name, category, address, city, phone, website, external_ref, raw, imported_lead_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        resultId, runId, orgId, cand.business_name, cand.category, cand.address, cand.city,
        cand.phone, cand.website, cand.external_ref, JSON.stringify(cand.raw).slice(0, 4000),
        dupe?.id ?? null
      )
      .run()
    stored.push({ id: resultId, ...cand, existing_lead_id: dupe?.id ?? null })
  }

  if (input.provider_key !== 'manual_entry') {
    await incrementUsage(db, orgId, input.provider_key)
    await logIntegration(
      db, orgId, null, 'discovery.search',
      status === 'OK' ? 'OK' : 'ERROR', Date.now() - started, message
    )
  }

  return { run_id: runId, status, message, provider_key: input.provider_key, results: stored }
}

/** Import selected discovery results as leads (dedupe-aware). */
export async function importDiscoveryResults(
  db: D1Database,
  orgId: string,
  userId: string,
  resultIds: string[]
) {
  if (!resultIds.length) throw badRequest('Select at least one result to import.')
  let imported = 0
  let skipped = 0
  const leadIds: string[] = []

  for (const rid of resultIds) {
    const row = await db
      .prepare(`SELECT * FROM discovery_results WHERE id = ? AND org_id = ?`)
      .bind(rid, orgId)
      .first<any>()
    if (!row) { skipped++; continue }
    if (row.imported_lead_id) { skipped++; continue }

    const { id, duplicate } = await createLead(
      db, orgId, userId,
      {
        business_name: row.business_name,
        category: row.category,
        address: row.address,
        city: row.city,
        phone: row.phone,
        website: row.website,
        source_key: row.run_id ? 'DISCOVERY' : 'MANUAL',
        external_ref: row.external_ref,
        status: 'NEW'
      },
      { skipOnDuplicate: true }
    )
    await db
      .prepare(`UPDATE discovery_results SET imported_lead_id = ? WHERE id = ?`)
      .bind(id, rid)
      .run()
    if (duplicate) skipped++
    else { imported++; leadIds.push(id) }

    await db
      .prepare(`UPDATE discovery_runs SET imported = imported + ? WHERE id = ?`)
      .bind(duplicate ? 0 : 1, row.run_id)
      .run()
  }

  return { imported, skipped, lead_ids: leadIds }
}

export async function listDiscoveryRuns(db: D1Database, orgId: string, limit = 10) {
  const rows = await db
    .prepare(
      `SELECT r.*, u.name AS created_by_name FROM discovery_runs r
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.org_id = ? ORDER BY r.created_at DESC LIMIT ?`
    )
    .bind(orgId, limit)
    .all()
  return rows.results ?? []
}

export async function getDiscoveryRun(db: D1Database, orgId: string, runId: string) {
  const run = await db
    .prepare(`SELECT * FROM discovery_runs WHERE id = ? AND org_id = ?`)
    .bind(runId, orgId)
    .first()
  if (!run) throw notFound('Discovery run not found.')
  const results = await db
    .prepare(`SELECT * FROM discovery_results WHERE run_id = ? ORDER BY created_at ASC`)
    .bind(runId)
    .all()
  return { run, results: results.results ?? [] }
}
