/**
 * Settings — database-backed, per organization and per user.
 */
import { newId } from '../lib/id'
import { safeJson } from './integrations'

export const DEFAULT_ORG_SETTINGS: Record<string, unknown> = {
  business_name: '',
  business_type: '',
  business_email: '',
  business_phone: '',
  business_city: '',
  currency: 'IDR',
  timezone: 'Asia/Jakarta',
  default_lead_source: 'MANUAL',
  ai_preferences: { auto_score_leads: true, preferred_engine: 'AUTO' }
}

export const DEFAULT_USER_SETTINGS: Record<string, unknown> = {
  notification_preferences: { in_app: true, follow_up_reminders: true, money_alerts: true },
  ui_preferences: { density: 'comfortable', default_page: 'dashboard' }
}

export async function getSettings(
  db: D1Database,
  orgId: string,
  userId: string
): Promise<{ org: Record<string, unknown>; user: Record<string, unknown> }> {
  const rows = await db
    .prepare(
      `SELECT scope, key, value, user_id FROM settings
       WHERE org_id = ? AND (scope = 'ORG' OR (scope = 'USER' AND user_id = ?))`
    )
    .bind(orgId, userId)
    .all<{ scope: string; key: string; value: string | null; user_id: string | null }>()

  const org = { ...DEFAULT_ORG_SETTINGS }
  const user = { ...DEFAULT_USER_SETTINGS }
  for (const r of rows.results ?? []) {
    const parsed = safeJson<unknown>(r.value, r.value)
    if (r.scope === 'ORG') org[r.key] = parsed
    else user[r.key] = parsed
  }

  // Organization row is the authority for currency/timezone.
  const orgRow = await db
    .prepare(`SELECT name, currency, timezone, business_type FROM organizations WHERE id = ?`)
    .bind(orgId)
    .first<{ name: string; currency: string; timezone: string; business_type: string | null }>()
  if (orgRow) {
    org.business_name = orgRow.name
    org.currency = orgRow.currency
    org.timezone = orgRow.timezone
    org.business_type = orgRow.business_type ?? org.business_type
  }

  return { org, user }
}

export async function setSetting(
  db: D1Database,
  orgId: string,
  scope: 'ORG' | 'USER',
  userId: string | null,
  key: string,
  value: unknown
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (id, org_id, user_id, scope, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(org_id, scope, user_id, key)
       DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .bind(newId('set'), orgId, scope === 'USER' ? userId : null, scope, key, JSON.stringify(value))
    .run()
}

/** Fields stored on the organizations row rather than the settings table. */
const ORG_COLUMN_KEYS: Record<string, string> = {
  business_name: 'name',
  currency: 'currency',
  timezone: 'timezone',
  business_type: 'business_type'
}

export async function updateOrgSettings(
  db: D1Database,
  orgId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const sets: string[] = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  for (const [key, col] of Object.entries(ORG_COLUMN_KEYS)) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`)
      binds.push(patch[key])
    }
  }
  if (binds.length) {
    await db.prepare(`UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, orgId).run()
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in ORG_COLUMN_KEYS)) {
      await setSetting(db, orgId, 'ORG', null, key, value)
    }
  }
}

export async function updateUserSettings(
  db: D1Database,
  orgId: string,
  userId: string,
  patch: Record<string, unknown>
): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    await setSetting(db, orgId, 'USER', userId, key, value)
  }
}

export async function updateProfile(
  db: D1Database,
  userId: string,
  patch: { name?: string | null; avatar_url?: string | null }
): Promise<void> {
  const sets = [`updated_at = datetime('now')`]
  const binds: unknown[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); binds.push(patch.name) }
  if (patch.avatar_url !== undefined) { sets.push('avatar_url = ?'); binds.push(patch.avatar_url) }
  if (binds.length) {
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, userId).run()
  }
}
