/**
 * Validation helpers re-exported for discovery routes, plus array validation.
 */
import { badRequest } from './http'
export { str, num, oneOf } from './validate'

export function badRequestIfEmptyArray(body: Record<string, unknown>, field: string): string[] {
  const raw = body[field]
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest(`Field "${field}" must be a non-empty array.`)
  }
  if (raw.length > 100) throw badRequest(`Field "${field}" accepts at most 100 items.`)
  return raw.map((v) => String(v))
}
