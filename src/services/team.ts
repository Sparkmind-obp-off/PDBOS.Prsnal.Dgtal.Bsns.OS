/**
 * Team OS — organization members and their role assignments.
 *
 * This is what makes RBAC operational rather than theoretical: without a way to
 * create a non-OWNER member, every role except OWNER is unreachable and the
 * permission matrix can never be exercised.
 *
 * Rules enforced here:
 *  - Members are always scoped to the caller's organization.
 *  - Roles must exist in the `roles` table (system roles are seeded at boot).
 *  - An organization must never lose its last OWNER (lock-out protection).
 *  - A user cannot remove their own OWNER role or deactivate themselves.
 */
import { newId } from '../lib/id'
import { hashPassword } from '../lib/crypto'
import { badRequest, conflict, notFound, forbidden } from '../lib/http'
import { ROLES } from './rbac'

export interface Member {
  id: string
  email: string
  name: string
  status: string
  avatar_url: string | null
  last_login_at: string | null
  created_at: string
  roles: string[]
  permission_count: number
}

/** All members of an organization, each with resolved roles + permission count. */
export async function listMembers(db: D1Database, orgId: string): Promise<Member[]> {
  const users = await db
    .prepare(
      `SELECT id, email, name, status, avatar_url, last_login_at, created_at
         FROM users
        WHERE org_id = ?
        ORDER BY created_at ASC`
    )
    .bind(orgId)
    .all<Omit<Member, 'roles' | 'permission_count'>>()

  const rows = users.results ?? []
  if (!rows.length) return []

  const roleRows = await db
    .prepare(
      `SELECT ur.user_id, r.key
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.org_id = ?`
    )
    .bind(orgId)
    .all<{ user_id: string; key: string }>()

  const byUser = new Map<string, string[]>()
  for (const row of roleRows.results ?? []) {
    const list = byUser.get(row.user_id) ?? []
    list.push(row.key)
    byUser.set(row.user_id, list)
  }

  const permCount = new Map(ROLES.map((r) => [r.key, r.permissions.length]))

  return rows.map((u) => {
    const roles = byUser.get(u.id) ?? []
    // Effective permissions = union across the member's roles.
    const union = new Set<string>()
    for (const key of roles) {
      const role = ROLES.find((r) => r.key === key)
      if (role) for (const p of role.permissions) union.add(p)
    }
    return {
      ...u,
      roles,
      permission_count: roles.includes('OWNER')
        ? (permCount.get('OWNER') ?? union.size)
        : union.size
    }
  })
}

/** Count active OWNERs in an org — used to prevent lock-out. */
async function ownerCount(db: D1Database, orgId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id
        WHERE ur.org_id = ? AND r.key = 'OWNER' AND u.status = 'ACTIVE'`
    )
    .bind(orgId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

async function assertRolesExist(db: D1Database, roleKeys: string[]): Promise<void> {
  const known = new Set(ROLES.map((r) => r.key))
  const unknown = roleKeys.filter((k) => !known.has(k))
  if (unknown.length) {
    throw badRequest(`Unknown role(s): ${unknown.join(', ')}`)
  }
}

export interface CreateMemberInput {
  email: string
  name: string
  password: string
  roles: string[]
}

/**
 * Create a member inside the caller's organization with explicit roles.
 * Phase 0 sets the initial password directly (no email delivery available);
 * the member changes it via Settings → Security after first sign-in.
 */
export async function createMember(
  db: D1Database,
  orgId: string,
  input: CreateMemberInput
): Promise<{ id: string }> {
  const roles = input.roles.length ? input.roles : ['VIEWER']
  await assertRolesExist(db, roles)

  const existing = await db
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(input.email)
    .first<{ id: string }>()
  if (existing) throw conflict('A user with this email already exists.')

  const userId = newId('usr')
  const passwordHash = await hashPassword(input.password)

  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, password_hash, status)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE')`
    )
    .bind(userId, orgId, input.email, input.name, passwordHash)
    .run()

  await db.batch(
    roles.map((key) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO user_roles (user_id, role_id, org_id)
           SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`
        )
        .bind(userId, orgId, key)
    )
  )

  return { id: userId }
}

/** Replace a member's role set wholesale. */
export async function setMemberRoles(
  db: D1Database,
  orgId: string,
  actorId: string,
  targetUserId: string,
  roles: string[]
): Promise<{ roles: string[] }> {
  if (!roles.length) throw badRequest('At least one role is required.')
  await assertRolesExist(db, roles)

  const target = await db
    .prepare(`SELECT id FROM users WHERE id = ? AND org_id = ?`)
    .bind(targetUserId, orgId)
    .first<{ id: string }>()
  if (!target) throw notFound('Member not found in this organization.')

  const targetIsOwner = await db
    .prepare(
      `SELECT 1 AS x FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ? AND ur.org_id = ? AND r.key = 'OWNER'`
    )
    .bind(targetUserId, orgId)
    .first<{ x: number }>()

  const losingOwner = Boolean(targetIsOwner) && !roles.includes('OWNER')
  if (losingOwner) {
    if (targetUserId === actorId) {
      throw forbidden('You cannot remove your own OWNER role.')
    }
    if ((await ownerCount(db, orgId)) <= 1) {
      throw badRequest('An organization must always keep at least one OWNER.')
    }
  }

  await db.prepare(`DELETE FROM user_roles WHERE user_id = ? AND org_id = ?`).bind(targetUserId, orgId).run()
  await db.batch(
    roles.map((key) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO user_roles (user_id, role_id, org_id)
           SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`
        )
        .bind(targetUserId, orgId, key)
    )
  )

  // Role change must take effect immediately — drop the member's sessions so
  // stale permissions cannot be reused.
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(targetUserId).run()

  return { roles }
}

/** Activate / deactivate a member. Deactivation also revokes live sessions. */
export async function setMemberStatus(
  db: D1Database,
  orgId: string,
  actorId: string,
  targetUserId: string,
  status: string
): Promise<{ status: string }> {
  if (targetUserId === actorId && status !== 'ACTIVE') {
    throw forbidden('You cannot deactivate your own account.')
  }

  const target = await db
    .prepare(
      `SELECT u.id,
              EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                      WHERE ur.user_id = u.id AND ur.org_id = u.org_id AND r.key = 'OWNER') AS is_owner
         FROM users u WHERE u.id = ? AND u.org_id = ?`
    )
    .bind(targetUserId, orgId)
    .first<{ id: string; is_owner: number }>()
  if (!target) throw notFound('Member not found in this organization.')

  if (target.is_owner && status !== 'ACTIVE' && (await ownerCount(db, orgId)) <= 1) {
    throw badRequest('An organization must always keep at least one active OWNER.')
  }

  await db
    .prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?`)
    .bind(status, targetUserId, orgId)
    .run()

  if (status !== 'ACTIVE') {
    await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(targetUserId).run()
  }

  return { status }
}

/** Reset a member's password (owner/admin action — no email channel in Phase 0). */
export async function resetMemberPassword(
  db: D1Database,
  orgId: string,
  targetUserId: string,
  newPassword: string
): Promise<void> {
  const target = await db
    .prepare(`SELECT id FROM users WHERE id = ? AND org_id = ?`)
    .bind(targetUserId, orgId)
    .first<{ id: string }>()
  if (!target) throw notFound('Member not found in this organization.')

  const hash = await hashPassword(newPassword)
  await db
    .prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(hash, targetUserId)
    .run()
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(targetUserId).run()
}

/** Remove a member from the organization entirely. */
export async function removeMember(
  db: D1Database,
  orgId: string,
  actorId: string,
  targetUserId: string
): Promise<void> {
  if (targetUserId === actorId) throw forbidden('You cannot remove your own account.')

  const target = await db
    .prepare(
      `SELECT u.id,
              EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                      WHERE ur.user_id = u.id AND ur.org_id = u.org_id AND r.key = 'OWNER') AS is_owner
         FROM users u WHERE u.id = ? AND u.org_id = ?`
    )
    .bind(targetUserId, orgId)
    .first<{ id: string; is_owner: number }>()
  if (!target) throw notFound('Member not found in this organization.')

  if (target.is_owner && (await ownerCount(db, orgId)) <= 1) {
    throw badRequest('An organization must always keep at least one OWNER.')
  }

  // user_roles + sessions cascade via FK ON DELETE CASCADE.
  await db.prepare(`DELETE FROM users WHERE id = ? AND org_id = ?`).bind(targetUserId, orgId).run()
}
