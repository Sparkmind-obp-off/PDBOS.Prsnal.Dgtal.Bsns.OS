/**
 * Integration Hub service.
 *
 * UI → this service → adapter → external provider.
 * Nothing here knows how a specific provider works, and no secret value ever
 * leaves the server (only "configured: true/false" is reported).
 */
import { newId } from '../lib/id'
import { notFound } from '../lib/http'
import { listAdapters, getAdapter } from '../integrations/registry'
import type { Bindings } from '../types'
import type { IntegrationStatus } from '../integrations/types'

/** Register every known adapter as an integration_provider row. Idempotent. */
export async function ensureProvidersSeeded(db: D1Database): Promise<void> {
  const statements = listAdapters().map((a) =>
    db
      .prepare(
        `INSERT INTO integration_providers (id, key, name, category, capabilities, auth_type, secret_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           name = excluded.name,
           category = excluded.category,
           capabilities = excluded.capabilities,
           secret_ref = excluded.secret_ref`
      )
      .bind(
        newId('prv'),
        a.key,
        a.name,
        a.category,
        JSON.stringify(a.capabilities),
        a.secretRef ? 'API_KEY' : 'NONE',
        a.secretRef ?? null
      )
  )
  if (statements.length) await db.batch(statements)
}

export interface IntegrationView {
  provider_key: string
  name: string
  category: string
  capabilities: string[]
  status: IntegrationStatus
  configured: boolean          // secret present server-side (boolean only)
  secret_ref: string | null
  last_test_at: string | null
  last_error: string | null
  usage_count: number
  config: Record<string, unknown>
  integration_id: string | null
}

/** List all providers with the org's connection state merged in. */
export async function listIntegrations(
  db: D1Database,
  env: Bindings,
  orgId: string
): Promise<IntegrationView[]> {
  const rows = await db
    .prepare(
      `SELECT p.key AS provider_key, p.name, p.category, p.capabilities, p.secret_ref,
              i.id AS integration_id, i.status, i.config, i.last_test_at, i.last_error, i.usage_count
       FROM integration_providers p
       LEFT JOIN integrations i ON i.provider_key = p.key AND i.org_id = ?
       ORDER BY p.category, p.name`
    )
    .bind(orgId)
    .all<any>()

  return (rows.results ?? []).map((r) => {
    const adapter = getAdapter(r.provider_key)
    const configured = adapter ? adapter.isConfigured(env) : false
    let status: IntegrationStatus = (r.status as IntegrationStatus) || 'NOT_CONFIGURED'
    // A provider whose credential is missing can never be CONNECTED.
    if (!configured && status === 'CONNECTED') status = 'NOT_CONFIGURED'
    return {
      provider_key: r.provider_key,
      name: r.name,
      category: r.category,
      capabilities: safeJson<string[]>(r.capabilities, []),
      status,
      configured,
      secret_ref: r.secret_ref ?? null,
      last_test_at: r.last_test_at ?? null,
      last_error: r.last_error ?? null,
      usage_count: r.usage_count ?? 0,
      config: safeJson<Record<string, unknown>>(r.config, {}),
      integration_id: r.integration_id ?? null
    }
  })
}

export async function getIntegration(
  db: D1Database,
  env: Bindings,
  orgId: string,
  providerKey: string
): Promise<IntegrationView> {
  const all = await listIntegrations(db, env, orgId)
  const found = all.find((i) => i.provider_key === providerKey)
  if (!found) throw notFound('Integration provider not found.')
  return found
}

/** Create-or-update the org's integration row. */
async function upsertIntegration(
  db: D1Database,
  orgId: string,
  providerKey: string,
  patch: { status?: string; config?: Record<string, unknown>; lastError?: string | null; markTested?: boolean }
): Promise<void> {
  const existing = await db
    .prepare(`SELECT id FROM integrations WHERE org_id = ? AND provider_key = ?`)
    .bind(orgId, providerKey)
    .first<{ id: string }>()

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO integrations (id, org_id, provider_key, status, config, last_error, last_test_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId('int'),
        orgId,
        providerKey,
        patch.status ?? 'NOT_CONFIGURED',
        patch.config ? JSON.stringify(patch.config) : null,
        patch.lastError ?? null,
        patch.markTested ? new Date().toISOString() : null
      )
      .run()
    return
  }

  const sets: string[] = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  if (patch.status !== undefined) { sets.push('status = ?'); binds.push(patch.status) }
  if (patch.config !== undefined) { sets.push('config = ?'); binds.push(JSON.stringify(patch.config)) }
  if (patch.lastError !== undefined) { sets.push('last_error = ?'); binds.push(patch.lastError) }
  if (patch.markTested) { sets.push(`last_test_at = datetime('now')`) }
  await db
    .prepare(`UPDATE integrations SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, existing.id)
    .run()
}

export async function connectIntegration(
  db: D1Database,
  env: Bindings,
  orgId: string,
  providerKey: string,
  config: Record<string, unknown>
): Promise<IntegrationView> {
  const adapter = getAdapter(providerKey)
  if (!adapter) throw notFound('Integration provider not found.')
  const configured = adapter.isConfigured(env)
  await upsertIntegration(db, orgId, providerKey, {
    status: configured ? 'CONNECTED' : 'NOT_CONFIGURED',
    config,
    lastError: configured
      ? null
      : `Missing server secret${adapter.secretRef ? ` ${adapter.secretRef}` : ''}.`
  })
  return getIntegration(db, env, orgId, providerKey)
}

export async function disconnectIntegration(
  db: D1Database,
  env: Bindings,
  orgId: string,
  providerKey: string
): Promise<IntegrationView> {
  const adapter = getAdapter(providerKey)
  if (!adapter) throw notFound('Integration provider not found.')
  await upsertIntegration(db, orgId, providerKey, { status: 'DISCONNECTED', lastError: null })
  return getIntegration(db, env, orgId, providerKey)
}

export async function testIntegration(
  db: D1Database,
  env: Bindings,
  orgId: string,
  providerKey: string
) {
  const adapter = getAdapter(providerKey)
  if (!adapter) throw notFound('Integration provider not found.')

  const current = await db
    .prepare(`SELECT id, config FROM integrations WHERE org_id = ? AND provider_key = ?`)
    .bind(orgId, providerKey)
    .first<{ id: string; config: string | null }>()

  const result = await adapter.test({
    env,
    orgId,
    config: safeJson<Record<string, unknown>>(current?.config ?? null, {})
  })

  await upsertIntegration(db, orgId, providerKey, {
    status: result.status,
    lastError: result.ok ? null : result.message,
    markTested: true
  })

  await logIntegration(db, orgId, current?.id ?? null, 'test', result.ok ? 'OK' : 'ERROR', result.durationMs, result.message)

  return { ...result, provider_key: providerKey }
}

export async function logIntegration(
  db: D1Database,
  orgId: string,
  integrationId: string | null,
  operation: string,
  status: 'OK' | 'ERROR' | 'SKIPPED',
  durationMs?: number,
  message?: string
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO integration_logs (id, org_id, integration_id, operation, status, duration_ms, message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(newId('ilg'), orgId, integrationId, operation, status, durationMs ?? null, message ?? null)
      .run()
  } catch (err) {
    console.error('[PDBOS] integration log failed:', err)
  }
}

export async function listIntegrationLogs(
  db: D1Database,
  orgId: string,
  providerKey: string,
  limit = 20
) {
  const rows = await db
    .prepare(
      `SELECT l.operation, l.status, l.duration_ms, l.message, l.created_at
       FROM integration_logs l
       LEFT JOIN integrations i ON i.id = l.integration_id
       WHERE l.org_id = ? AND (i.provider_key = ? OR l.integration_id IS NULL)
       ORDER BY l.created_at DESC LIMIT ?`
    )
    .bind(orgId, providerKey, limit)
    .all()
  return rows.results ?? []
}

export async function incrementUsage(db: D1Database, orgId: string, providerKey: string): Promise<void> {
  await db
    .prepare(
      `UPDATE integrations SET usage_count = usage_count + 1, updated_at = datetime('now')
       WHERE org_id = ? AND provider_key = ?`
    )
    .bind(orgId, providerKey)
    .run()
}

export function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
