/**
 * Boot-time provisioning.
 *
 * Cloudflare Workers have no startup hook, so this runs lazily on the first
 * request of an isolate and is guarded by an in-isolate promise so concurrent
 * requests do not duplicate work. All statements are idempotent.
 */
import { ensureRbacSeeded } from './rbac'
import { ensureProvidersSeeded } from './integrations'
import { purgeExpiredSessions } from './auth'

let bootPromise: Promise<void> | null = null

async function runBoot(db: D1Database): Promise<void> {
  await ensureRbacSeeded(db)
  await ensureProvidersSeeded(db)
  await purgeExpiredSessions(db)
}

export function ensureBootstrapped(db: D1Database): Promise<void> {
  if (!bootPromise) {
    bootPromise = runBoot(db).catch((err) => {
      // Reset so a later request can retry (e.g. transient D1 error).
      bootPromise = null
      throw err
    })
  }
  return bootPromise
}
