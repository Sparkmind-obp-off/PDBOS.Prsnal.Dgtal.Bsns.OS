/**
 * Integration boundary contracts.
 *
 * Core business logic depends ONLY on these interfaces — never on a concrete
 * provider. Adding a provider means adding an adapter, not editing services.
 */
import type { Bindings } from '../types'

export type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'NOT_CONFIGURED'

export interface AdapterContext {
  env: Bindings
  orgId: string
  config: Record<string, unknown>
}

export interface TestResult {
  ok: boolean
  status: IntegrationStatus
  message: string
  durationMs: number
}

/** Normalized business record produced by any discovery provider. */
export interface DiscoveryCandidate {
  business_name: string
  category: string | null
  address: string | null
  city: string | null
  phone: string | null
  website: string | null
  external_ref: string | null
  raw: Record<string, unknown>
}

export interface DiscoveryQuery {
  query: string
  location?: string | null
  limit?: number
}

export interface IntegrationAdapter {
  key: string
  name: string
  category: 'DISCOVERY' | 'AI' | 'MESSAGING' | 'PAYMENT' | 'ANALYTICS' | 'STORAGE'
  capabilities: string[]
  /** Name of the server-side secret this adapter needs (never exposed to the client). */
  secretRef?: string
  /** True when the required credential is present in the server environment. */
  isConfigured(env: Bindings): boolean
  /** Lightweight connectivity/credential check. Must never throw. */
  test(ctx: AdapterContext): Promise<TestResult>
}

export interface DiscoveryAdapter extends IntegrationAdapter {
  category: 'DISCOVERY'
  search(ctx: AdapterContext, q: DiscoveryQuery): Promise<DiscoveryCandidate[]>
}

export function isDiscoveryAdapter(a: IntegrationAdapter): a is DiscoveryAdapter {
  return a.category === 'DISCOVERY' && typeof (a as DiscoveryAdapter).search === 'function'
}
