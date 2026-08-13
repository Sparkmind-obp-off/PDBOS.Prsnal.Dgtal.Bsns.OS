/**
 * /api/auth — signup, signin, signout, session, profile, password.
 */
import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { ok, unauthorized, jsonBody } from '../lib/http'
import { email, password as pwd, str } from '../lib/validate'
import {
  SESSION_COOKIE, SESSION_TTL_DAYS, signup, signin,
  createSession, destroySession, changePassword
} from '../services/auth'
import { writeAudit } from '../services/audit'
import { requireAuth } from '../middleware/auth'
import { updateProfile } from '../services/settings'
import type { AppEnv } from '../types'

const app = new Hono<AppEnv>()

function clientIp(c: any): string | null {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null
}

function issueCookie(c: any, token: string) {
  const isHttps = new URL(c.req.url).protocol === 'https:'
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400
  })
}

app.post('/signup', async (c) => {
  const body = await jsonBody(c)
  const mail = email(body)!
  const password = pwd(body)
  const name = str(body, 'name', { required: true, max: 120 })!
  const businessName = str(body, 'business_name', { max: 160 })
  const currency = str(body, 'currency', { max: 8 })
  const timezone = str(body, 'timezone', { max: 64 })

  const { userId, orgId } = await signup(
    c.env.DB,
    { email: mail, password, name, businessName, currency, timezone },
    { ip: clientIp(c) }
  )
  const { token } = await createSession(c.env.DB, userId, {
    userAgent: c.req.header('user-agent') ?? null,
    ip: clientIp(c)
  })
  issueCookie(c, token)
  await writeAudit(c.env.DB, {
    orgId, userId, action: 'LOGIN', entity: 'session', entityId: userId,
    metadata: { via: 'signup' }, ip: clientIp(c)
  })
  return ok(c, { user_id: userId, org_id: orgId }, 201)
})

app.post('/signin', async (c) => {
  const body = await jsonBody(c)
  const mail = email(body)!
  const password = str(body, 'password', { required: true })!
  const { userId, orgId } = await signin(c.env.DB, mail, password)
  const { token } = await createSession(c.env.DB, userId, {
    userAgent: c.req.header('user-agent') ?? null,
    ip: clientIp(c)
  })
  issueCookie(c, token)
  await writeAudit(c.env.DB, {
    orgId, userId, action: 'LOGIN', entity: 'session', entityId: userId, ip: clientIp(c)
  })
  return ok(c, { user_id: userId, org_id: orgId })
})

app.post('/signout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  const user = c.get('user')
  if (token) await destroySession(c.env.DB, token)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  if (user) {
    await writeAudit(c.env.DB, {
      orgId: user.org_id, userId: user.id, action: 'LOGOUT', entity: 'session', ip: clientIp(c)
    })
  }
  return ok(c, { signed_out: true })
})

/** Current session — the client bootstraps its permission-aware UI from this. */
app.get('/session', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ ok: true, data: { authenticated: false } })
  const org = await c.env.DB
    .prepare(`SELECT id, name, currency, timezone FROM organizations WHERE id = ?`)
    .bind(user.org_id)
    .first()
  return ok(c, { authenticated: true, user, organization: org })
})

app.patch('/profile', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const name = str(body, 'name', { max: 120 })
  const avatar = str(body, 'avatar_url', { max: 500 })
  await updateProfile(c.env.DB, user.id, {
    ...(name !== null ? { name } : {}),
    ...(avatar !== null ? { avatar_url: avatar } : {})
  })
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'UPDATE', entity: 'user', entityId: user.id,
    metadata: { fields: Object.keys(body) }
  })
  return ok(c, { updated: true })
})

app.post('/password', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await jsonBody(c)
  const current = str(body, 'current_password', { required: true })!
  const next = pwd(body, 'new_password')
  await changePassword(c.env.DB, user.id, current, next)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  await writeAudit(c.env.DB, {
    orgId: user.org_id, userId: user.id, action: 'SETTINGS_CHANGE', entity: 'user',
    entityId: user.id, metadata: { field: 'password' }
  })
  return ok(c, { changed: true, reauth_required: true })
})

app.get('/permissions', requireAuth, async (c) => {
  const user = c.get('user')
  if (!user) throw unauthorized()
  return ok(c, { roles: user.roles, permissions: user.permissions })
})

export default app
