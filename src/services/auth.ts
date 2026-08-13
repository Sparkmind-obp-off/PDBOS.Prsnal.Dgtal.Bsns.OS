/**
 * Authentication: signup, signin, session lifecycle.
 * - Passwords: PBKDF2-SHA256 via Web Crypto.
 * - Sessions: random 32-byte token in an HttpOnly cookie; DB stores only its SHA-256.
 */
import { hashPassword, verifyPassword, sha256Hex } from '../lib/crypto'
import { newId, newToken } from '../lib/id'
import { badRequest, conflict, unauthorized } from '../lib/http'
import { writeAudit } from './audit'
import type { SessionUser } from '../types'

export const SESSION_COOKIE = 'pdbos_session'
export const SESSION_TTL_DAYS = 30

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org'
}

function expiryIso(days = SESSION_TTL_DAYS): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
}

export async function createSession(
  db: D1Database,
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null }
): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  const token = newToken(32)
  const sessionId = await sha256Hex(token)
  const expiresAt = expiryIso()
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(sessionId, userId, expiresAt, meta.userAgent ?? null, meta.ip ?? null)
    .run()
  return { token, sessionId, expiresAt }
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  const sessionId = await sha256Hex(token)
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run()
}

/** Resolve the session token to a full SessionUser (roles + permissions). */
export async function resolveSession(
  db: D1Database,
  token: string
): Promise<{ user: SessionUser; sessionId: string } | null> {
  const sessionId = await sha256Hex(token)
  const row = await db
    .prepare(
      `SELECT u.id, u.org_id, u.email, u.name, u.status, u.avatar_url, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .bind(sessionId)
    .first<{
      id: string
      org_id: string
      email: string
      name: string
      status: string
      avatar_url: string | null
      expires_at: string
    }>()

  if (!row) return null
  if (row.status !== 'ACTIVE') return null

  const roleRows = await db
    .prepare(
      `SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`
    )
    .bind(row.id)
    .all<{ key: string }>()
  const roles = (roleRows.results ?? []).map((r) => r.key)

  const permRows = await db
    .prepare(
      `SELECT DISTINCT p.key
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ?`
    )
    .bind(row.id)
    .all<{ key: string }>()
  const permissions = (permRows.results ?? []).map((p) => p.key)

  return {
    sessionId,
    user: {
      id: row.id,
      org_id: row.org_id,
      email: row.email,
      name: row.name,
      status: row.status,
      avatar_url: row.avatar_url,
      roles,
      permissions
    }
  }
}

export interface SignupInput {
  email: string
  password: string
  name: string
  businessName?: string | null
  currency?: string | null
  timezone?: string | null
}

/**
 * Signup creates: organization + user + OWNER role assignment + default settings
 * + a welcome notification. The first user of an organization is always OWNER.
 */
export async function signup(
  db: D1Database,
  input: SignupInput,
  meta: { ip?: string | null }
): Promise<{ userId: string; orgId: string }> {
  const existing = await db
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(input.email)
    .first<{ id: string }>()
  if (existing) throw conflict('An account with this email already exists.')

  const orgId = newId('org')
  const userId = newId('usr')
  const orgName = input.businessName?.trim() || `${input.name}'s Business`
  const baseSlug = slugify(orgName)
  const slug = `${baseSlug}-${newId().slice(-6)}`
  const passwordHash = await hashPassword(input.password)

  await db
    .prepare(
      `INSERT INTO organizations (id, name, slug, currency, timezone) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(orgId, orgName, slug, input.currency || 'IDR', input.timezone || 'Asia/Jakarta')
    .run()

  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, password_hash, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE')`
    )
    .bind(userId, orgId, input.email, input.name, passwordHash)
    .run()

  await db
    .prepare(
      `INSERT INTO user_roles (user_id, role_id, org_id)
       SELECT ?, r.id, ? FROM roles r WHERE r.key = 'OWNER'`
    )
    .bind(userId, orgId)
    .run()

  await db
    .prepare(
      `INSERT INTO notifications (id, org_id, user_id, type, severity, title, message)
       VALUES (?, ?, ?, 'SUCCESS', 'LOW', 'Welcome to PDBOS', 'Your business OS is ready. Start by adding a lead or reviewing your resources.')`
    )
    .bind(newId('ntf'), orgId, userId)
    .run()

  await writeAudit(db, {
    orgId,
    userId,
    action: 'CREATE',
    entity: 'user',
    entityId: userId,
    metadata: { via: 'signup' },
    ip: meta.ip
  })

  return { userId, orgId }
}

export async function signin(
  db: D1Database,
  email: string,
  password: string
): Promise<{ userId: string; orgId: string }> {
  const user = await db
    .prepare(`SELECT id, org_id, password_hash, status FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string; org_id: string; password_hash: string; status: string }>()

  // Same generic message for unknown email and wrong password.
  if (!user) throw unauthorized('Email or password is incorrect.')
  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) throw unauthorized('Email or password is incorrect.')
  if (user.status !== 'ACTIVE') throw unauthorized('This account is not active.')

  await db
    .prepare(`UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .bind(user.id)
    .run()

  return { userId: user.id, orgId: user.org_id }
}

export async function changePassword(
  db: D1Database,
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await db
    .prepare(`SELECT password_hash FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ password_hash: string }>()
  if (!user) throw unauthorized()
  const valid = await verifyPassword(currentPassword, user.password_hash)
  if (!valid) throw badRequest('Current password is incorrect.')
  const hash = await hashPassword(newPassword)
  await db
    .prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(hash, userId)
    .run()
  // Invalidate all other sessions for safety.
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run()
}

export async function purgeExpiredSessions(db: D1Database): Promise<void> {
  try {
    await db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run()
  } catch (err) {
    console.error('[PDBOS] session purge failed:', err)
  }
}
