/**
 * Uniform API envelope + safe error handling.
 * Client-facing errors never contain stack traces, SQL text, or secrets.
 */
import type { Context } from 'hono'

export class AppError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details)
export const unauthorized = (msg = 'Authentication required.') =>
  new AppError(401, 'UNAUTHORIZED', msg)
export const forbidden = (msg = 'You do not have permission to do this.') =>
  new AppError(403, 'FORBIDDEN', msg)
export const notFound = (msg = 'Resource not found.') =>
  new AppError(404, 'NOT_FOUND', msg)
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg)
export const notConfigured = (msg: string) => new AppError(424, 'NOT_CONFIGURED', msg)

/**
 * Read a JSON request body as a plain object.
 *
 * A malformed or absent body yields `{}` rather than throwing, so the field
 * validators — not the parser — produce the user-facing error message. The
 * explicit return type keeps callers indexable (`body.status`), which a bare
 * `.catch(() => ({}))` does not.
 */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const parsed = await c.req.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ ok: true, data }, status as 200)
}

export function okList<T>(c: Context, items: T[], meta: Record<string, unknown> = {}) {
  return c.json({ ok: true, data: items, meta })
}

/** Central error serializer, wired as Hono onError. */
export function serializeError(err: unknown, c: Context) {
  if (err instanceof AppError) {
    return c.json(
      { ok: false, error: { code: err.code, message: err.message, details: err.details ?? null } },
      err.status as 400
    )
  }
  // Unexpected: log server-side detail, return generic message to the client.
  const requestId = c.get('requestId') || 'n/a'
  console.error(`[PDBOS][${requestId}] unhandled error:`, err)
  return c.json(
    {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
        request_id: requestId
      }
    },
    500
  )
}
