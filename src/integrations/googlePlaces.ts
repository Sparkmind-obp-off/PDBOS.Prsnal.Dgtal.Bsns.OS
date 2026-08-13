/**
 * Google Places adapter (Places API — Text Search, New).
 *
 * Phase 0 ships the adapter but does NOT require the credential. Without
 * GOOGLE_PLACES_API_KEY in the server environment the adapter reports
 * NOT_CONFIGURED and the Discovery Engine surfaces a "not configured" state
 * instead of failing or faking results.
 *
 * The API key is read from the Worker environment (Cloudflare secret) and is
 * never returned to the browser.
 */
import type { AdapterContext, DiscoveryAdapter, DiscoveryCandidate, DiscoveryQuery, TestResult } from './types'
import type { Bindings } from '../types'

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryType',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.addressComponents'
].join(',')

function cityFrom(place: any): string | null {
  const comps = place?.addressComponents
  if (Array.isArray(comps)) {
    const city = comps.find((c: any) =>
      Array.isArray(c?.types) &&
      (c.types.includes('locality') || c.types.includes('administrative_area_level_2'))
    )
    if (city?.longText) return city.longText
  }
  return null
}

export const googlePlacesAdapter: DiscoveryAdapter = {
  key: 'google_places',
  name: 'Google Places',
  category: 'DISCOVERY',
  capabilities: ['discovery.search', 'discovery.import', 'business.enrich'],
  secretRef: 'GOOGLE_PLACES_API_KEY',

  isConfigured(env: Bindings) {
    return Boolean(env.GOOGLE_PLACES_API_KEY && env.GOOGLE_PLACES_API_KEY.length > 10)
  },

  async test(ctx: AdapterContext): Promise<TestResult> {
    const started = Date.now()
    if (!this.isConfigured(ctx.env)) {
      return {
        ok: false,
        status: 'NOT_CONFIGURED',
        message: 'GOOGLE_PLACES_API_KEY is not set on the server. Add it as a Cloudflare secret to enable this provider.',
        durationMs: Date.now() - started
      }
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': ctx.env.GOOGLE_PLACES_API_KEY!,
          'X-Goog-FieldMask': 'places.id'
        },
        body: JSON.stringify({ textQuery: 'coffee shop', maxResultCount: 1 })
      })
      const durationMs = Date.now() - started
      if (!res.ok) {
        // Provider error text may contain key hints — keep it terse.
        return {
          ok: false,
          status: 'ERROR',
          message: `Provider responded with HTTP ${res.status}.`,
          durationMs
        }
      }
      return { ok: true, status: 'CONNECTED', message: 'Connection successful.', durationMs }
    } catch (err) {
      console.error('[PDBOS] google_places test failed:', err)
      return {
        ok: false,
        status: 'ERROR',
        message: 'Could not reach the provider.',
        durationMs: Date.now() - started
      }
    }
  },

  async search(ctx: AdapterContext, q: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    if (!this.isConfigured(ctx.env)) {
      throw Object.assign(new Error('google_places not configured'), { code: 'NOT_CONFIGURED' })
    }
    const textQuery = q.location ? `${q.query} in ${q.location}` : q.query
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': ctx.env.GOOGLE_PLACES_API_KEY!,
        'X-Goog-FieldMask': FIELD_MASK
      },
      body: JSON.stringify({
        textQuery,
        maxResultCount: Math.min(20, q.limit ?? 20)
      })
    })
    if (!res.ok) {
      throw Object.assign(new Error(`Provider HTTP ${res.status}`), { code: 'PROVIDER_ERROR' })
    }
    const json = (await res.json()) as { places?: any[] }
    return (json.places ?? []).map((p) => ({
      business_name: p?.displayName?.text ?? 'Unknown business',
      category: p?.primaryType ?? null,
      address: p?.formattedAddress ?? null,
      city: cityFrom(p) ?? q.location ?? null,
      phone: p?.nationalPhoneNumber ?? null,
      website: p?.websiteUri ?? null,
      external_ref: p?.id ?? null,
      raw: p ?? {}
    }))
  }
}
