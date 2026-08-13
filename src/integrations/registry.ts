/**
 * Adapter registry — the single place where concrete providers are registered.
 * Business services resolve adapters through here by key.
 */
import type { IntegrationAdapter } from './types'
import { manualDiscoveryAdapter } from './manual'
import { googlePlacesAdapter } from './googlePlaces'
import { openAiAdapter } from './openai'

export const ADAPTERS: Record<string, IntegrationAdapter> = {
  [manualDiscoveryAdapter.key]: manualDiscoveryAdapter,
  [googlePlacesAdapter.key]: googlePlacesAdapter,
  [openAiAdapter.key]: openAiAdapter
}

export function getAdapter(key: string): IntegrationAdapter | null {
  return ADAPTERS[key] ?? null
}

export function listAdapters(): IntegrationAdapter[] {
  return Object.values(ADAPTERS)
}
