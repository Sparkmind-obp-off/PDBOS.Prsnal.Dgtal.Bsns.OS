/**
 * Tiny dependency-free validation helpers.
 */
import { badRequest } from './http'

export function str(
  body: Record<string, unknown>,
  field: string,
  opts: { required?: boolean; max?: number; min?: number; default?: string | null } = {}
): string | null {
  const raw = body[field]
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) throw badRequest(`Field "${field}" is required.`)
    return opts.default === undefined ? null : opts.default
  }
  if (typeof raw !== 'string') throw badRequest(`Field "${field}" must be text.`)
  const v = raw.trim()
  if (opts.min && v.length < opts.min)
    throw badRequest(`Field "${field}" must be at least ${opts.min} characters.`)
  if (opts.max && v.length > opts.max)
    throw badRequest(`Field "${field}" must be at most ${opts.max} characters.`)
  return v
}

export function num(
  body: Record<string, unknown>,
  field: string,
  opts: { required?: boolean; min?: number; max?: number; default?: number } = {}
): number | null {
  const raw = body[field]
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) throw badRequest(`Field "${field}" is required.`)
    return opts.default === undefined ? null : opts.default
  }
  const v = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isNaN(v)) throw badRequest(`Field "${field}" must be a number.`)
  if (opts.min !== undefined && v < opts.min)
    throw badRequest(`Field "${field}" must be >= ${opts.min}.`)
  if (opts.max !== undefined && v > opts.max)
    throw badRequest(`Field "${field}" must be <= ${opts.max}.`)
  return v
}

export function bool(body: Record<string, unknown>, field: string, def = false): boolean {
  const raw = body[field]
  if (raw === undefined || raw === null || raw === '') return def
  if (typeof raw === 'boolean') return raw
  return raw === 'true' || raw === 1 || raw === '1'
}

export function oneOf<T extends readonly string[]>(
  body: Record<string, unknown>,
  field: string,
  allowed: T,
  opts: { required?: boolean; default?: T[number] } = {}
): T[number] | null {
  const v = str(body, field, { required: opts.required })
  if (v === null) return opts.default ?? null
  const upper = v.toUpperCase()
  if (!allowed.includes(upper as T[number]))
    throw badRequest(`Field "${field}" must be one of: ${allowed.join(', ')}.`)
  return upper as T[number]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function email(body: Record<string, unknown>, field = 'email', required = true): string | null {
  const v = str(body, field, { required, max: 254 })
  if (v === null) return null
  if (!EMAIL_RE.test(v)) throw badRequest('Please enter a valid email address.')
  return v.toLowerCase()
}

export function password(body: Record<string, unknown>, field = 'password'): string {
  const v = str(body, field, { required: true, min: 8, max: 200 })!
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v))
    throw badRequest('Password must contain at least one letter and one number.')
  return v
}

export function pagination(query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page || 1) || 1)
  const perPage = Math.min(100, Math.max(1, Number(query.per_page || 20) || 20))
  return { page, perPage, offset: (page - 1) * perPage }
}

/** Normalized dedupe key for lead imports. */
export function dedupeKey(name: string, city?: string | null): string {
  return `${name} ${city || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
}
