/**
 * Session + permission middleware.
 */
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE, resolveSession } from '../services/auth'
import { assertPermission } from '../services/rbac'
import { unauthorized } from '../lib/http'
import type { AppEnv } from '../types'

/** Populates c.var.user when a valid session cookie exists. Does not reject. */
export const withSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    try {
      const resolved = await resolveSession(c.env.DB, token)
      if (resolved) {
        c.set('user', resolved.user)
        c.set('sessionId', resolved.sessionId)
      }
    } catch (err) {
      console.error('[PDBOS] session resolve failed:', err)
    }
  }
  await next()
}

/** Rejects the request when there is no authenticated user. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) throw unauthorized()
  await next()
}

/** Rejects the request when the user lacks the permission. */
export function requirePermission(permission: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user')
    if (!user) throw unauthorized()
    assertPermission(user, permission)
    await next()
  }
}
