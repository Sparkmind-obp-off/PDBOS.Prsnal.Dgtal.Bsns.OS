/**
 * Manual discovery adapter.
 *
 * The only discovery source that is always available: the operator types the
 * business details in and the same normalize → dedupe → store pipeline is used.
 * This keeps the Discovery Engine genuinely functional in Phase 0 without
 * pretending an external provider is connected.
 */
import type { AdapterContext, DiscoveryAdapter, DiscoveryCandidate, DiscoveryQuery, TestResult } from './types'
import type { Bindings } from '../types'

export const manualDiscoveryAdapter: DiscoveryAdapter = {
  key: 'manual_entry',
  name: 'Manual Entry',
  category: 'DISCOVERY',
  capabilities: ['discovery.search', 'discovery.import'],

  isConfigured(_env: Bindings) {
    return true
  },

  async test(_ctx: AdapterContext): Promise<TestResult> {
    return {
      ok: true,
      status: 'CONNECTED',
      message: 'Manual entry is always available.',
      durationMs: 0
    }
  },

  /**
   * Manual "search" does not call any provider. The operator's typed lines are
   * passed through the query as newline-separated entries:
   *   Business Name | Category | City | Phone | Website
   */
  async search(_ctx: AdapterContext, q: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const lines = q.query
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, q.limit ?? 50)

    return lines.map((line) => {
      const [name, category, city, phone, website] = line.split('|').map((p) => p?.trim() || '')
      return {
        business_name: name || line,
        category: category || null,
        address: null,
        city: city || q.location || null,
        phone: phone || null,
        website: website || null,
        external_ref: null,
        raw: { source: 'manual_entry', line }
      }
    })
  }
}
