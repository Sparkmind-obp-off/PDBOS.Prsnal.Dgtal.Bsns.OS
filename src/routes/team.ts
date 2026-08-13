/**
 * /api/team — organization members and role assignment.
 * Every endpoint requires the `user.manage` permission (OWNER-only by default),
 * which keeps role escalation out of reach of operational roles.
 */
import { Hono } from 'hono'
import { ok, okList, jsonBody, badRequest } from '../lib/http'
import { str, email as emailField, password as passwordField, oneOf } from '../lib/validate'
import { requireAuth, requirePermission } from '../middleware/auth'
import {
  listMembers, createMember, setMemberRoles, setMemberStatus,
  resetMemberPassword, removeMember
} from '../services/team'
import { ROLES } from '../services/rbac'
import { writeAudit } from '../services/audit'
import { USER_STATUSES } from '../types'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

/** Parse and normalize a `roles` array from a JSON body. */
function rolesField(body: Record<string, unknown>, required = true): string[] {
  const raw = body.roles
  if (raw === undefined || raw === null) {
    if (required) throw badRequest('Field "roles" is required.')
    return []
  }
  if (!Array.isArray(raw)) throw badRequest('Field "roles" must be an array of role keys.')
  const roles = raw
    .map((r) => (typeof r === 'string' ? r.trim().toUpperCase() : ''))
    .filter(Boolean)
  if (required && !roles.length) throw badRequest('At least one role is required.')
  return [...new Set(roles)]
}

app.get('/', requirePermission('user.manage'), async (c) => {
  const user = c.get('user')
  const members = await listMembers(c.env.DB, user.org_id)
  return okList(c, members, {
    total: members.length,
    roles: ROLES.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      permission_count: r.permissions.length
    }))
  })
})

app.post('/', requirePermission('user.manage'), async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const input = {
    email: emailField(body, 'email', true)!,
    name: str(body, 'name', { required: true, max: 120 })!,
    password: passwordField(body, 'password'),
    roles: rolesField(body)
  }
  const created = await createMember(c.env.DB, user.org_id, input)

  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'CREATE', entity: 'user',
    entityId: created.id, metadata: { email: input.email, roles: input.roles }
  })
  return ok(c, created, 201)
})

app.patch('/:id/roles', requirePermission('user.manage'), async (c) => {
  const user = c.get('user')
  const targetId = c.req.param('id')
  const roles = rolesField(await jsonBody(c))
  const result = await setMemberRoles(c.env.DB, user.org_id, user.id, targetId, roles)

  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'PERMISSION_CHANGE', entity: 'user',
    entityId: targetId, metadata: { roles }
  })
  return ok(c, result)
})

app.patch('/:id/status', requirePermission('user.manage'), async (c) => {
  const user = c.get('user')
  const targetId = c.req.param('id')
  const body = await jsonBody(c)
  const status = oneOf(body, 'status', USER_STATUSES, { required: true })!
  const result = await setMemberStatus(c.env.DB, user.org_id, user.id, targetId, status)

  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'STATUS_CHANGE', entity: 'user',
    entityId: targetId, metadata: { status }
  })
  return ok(c, result)
})

app.post('/:id/password', requirePermission('user.manage'), async (c) => {
  const user = c.get('user')
  const targetId = c.req.param('id')
  const body = await jsonBody(c)
  const newPassword = passwordField(body, 'password')
  await resetMemberPassword(c.env.DB, user.org_id, targetId, newPassword)

  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'user',
    entityId: targetId, metadata: { password_reset: true }
  })
  return ok(c, { reset: true })
})

app.delete('/:id', requirePermission('user.manage'), async (c) => {
  const user = c.get('user')
  const targetId = c.req.param('id')
  await removeMember(c.env.DB, user.org_id, user.id, targetId)

  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'DELETE', entity: 'user', entityId: targetId
  })
  return ok(c, { removed: true })
})

export default app
