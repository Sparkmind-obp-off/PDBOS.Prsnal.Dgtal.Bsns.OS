/**
 * AI OS — service boundary.
 *
 * Two execution modes, decided at runtime:
 *   RULE : deterministic scoring/analysis implemented locally (real logic).
 *   LLM  : delegated to a configured AI provider adapter (optional secret).
 *
 * Business modules call runAiOperation() and never talk to a provider directly,
 * so Lead scoring / outreach generation / insights can be upgraded later
 * without touching call sites.
 */
import { newId } from '../lib/id'
import { badRequest } from '../lib/http'
import { getAdapter } from '../integrations/registry'
import { openAiAdapter } from '../integrations/openai'
import { logIntegration, incrementUsage } from './integrations'
import type { Bindings, AiOperation } from '../types'
import { AI_OPERATIONS } from '../types'

export interface AiRequest {
  operation: AiOperation
  input: Record<string, unknown>
  entityType?: string | null
  entityId?: string | null
}

export interface AiResult {
  operation: AiOperation
  engine: 'RULE' | 'LLM'
  status: 'OK' | 'NOT_CONFIGURED' | 'ERROR'
  output: Record<string, unknown> | null
  message: string
  duration_ms: number
  job_id: string
}

export function aiProviderStatus(env: Bindings) {
  const adapter = getAdapter('openai')
  return {
    provider_key: 'openai',
    configured: adapter ? adapter.isConfigured(env) : false,
    engine: adapter && adapter.isConfigured(env) ? 'LLM' : 'RULE'
  }
}

/* ------------------------------------------------------------------ *
 * Deterministic rule engine — the always-available implementation.
 * ------------------------------------------------------------------ */

export interface LeadScoreFactors {
  website?: string | null
  phone?: string | null
  email?: string | null
  social_url?: string | null
  city?: string | null
  industry?: string | null
  category?: string | null
  status?: string | null
  activity_count?: number
}

/**
 * Lead scoring: contactability + digital gap + engagement.
 * A business with a phone but no website is the highest-value target for a
 * digital services seller, so the absence of a website ADDS points.
 */
export function scoreLead(f: LeadScoreFactors): { score: number; breakdown: Record<string, number> } {
  const b: Record<string, number> = {}

  // Contactability (max 35)
  b.phone = f.phone ? 20 : 0
  b.email = f.email ? 10 : 0
  b.social = f.social_url ? 5 : 0

  // Digital gap — the opportunity signal (max 30)
  b.no_website = f.website ? 0 : 25
  b.has_social_no_site = !f.website && f.social_url ? 5 : 0

  // Data completeness (max 15)
  b.city = f.city ? 5 : 0
  b.industry = f.industry ? 5 : 0
  b.category = f.category ? 5 : 0

  // Engagement (max 20)
  const acts = Math.min(4, f.activity_count ?? 0)
  b.engagement = acts * 3
  const hotStatuses = ['REPLIED', 'INTERESTED', 'DEMO', 'OFFER']
  b.status_momentum = hotStatuses.includes(String(f.status)) ? 8 : 0

  const score = Math.max(0, Math.min(100, Object.values(b).reduce((a, v) => a + v, 0)))
  return { score, breakdown: b }
}

export function suggestPriority(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'HOT' {
  if (score >= 75) return 'HOT'
  if (score >= 55) return 'HIGH'
  if (score >= 35) return 'MEDIUM'
  return 'LOW'
}

function ruleEngine(op: AiOperation, input: Record<string, unknown>): { output: Record<string, unknown>; message: string } {
  switch (op) {
    case 'score': {
      const r = scoreLead(input as LeadScoreFactors)
      return {
        output: { ...r, suggested_priority: suggestPriority(r.score) },
        message: 'Scored with the deterministic rule engine.'
      }
    }
    case 'classify': {
      const name = String(input.business_name ?? '').toLowerCase()
      const map: [string, string][] = [
        ['wedding', 'Wedding'], ['salon', 'Beauty'], ['beauty', 'Beauty'],
        ['barber', 'Barbershop'], ['resto', 'Restaurant'], ['cafe', 'Restaurant'],
        ['coffee', 'Restaurant'], ['picnic', 'Event'], ['event', 'Event'],
        ['studio', 'Studio'], ['photo', 'Studio'], ['laundry', 'Local Service']
      ]
      const hit = map.find(([k]) => name.includes(k))
      return {
        output: { industry: hit ? hit[1] : 'Local Service', confidence: hit ? 0.8 : 0.3 },
        message: 'Classified with keyword rules.'
      }
    }
    case 'analyze': {
      const r = scoreLead(input as LeadScoreFactors)
      const gaps: string[] = []
      if (!(input as any).website) gaps.push('No website — highest-value entry point.')
      if (!(input as any).email) gaps.push('No email captured — outreach limited to phone/social.')
      if (!(input as any).social_url) gaps.push('No social presence recorded.')
      return {
        output: { score: r.score, gaps, suggested_priority: suggestPriority(r.score) },
        message: 'Analysis produced by the rule engine.'
      }
    }
    case 'recommend':
    case 'plan': {
      const actions = [
        'Contact leads with priority HOT that have no activity in the last 3 days.',
        'Move QUALIFIED leads to CONTACTED by sending the first outreach message.',
        'Review overdue invoices in Money OS.',
        'Publish one reusable asset from a delivered project.'
      ]
      return { output: { actions }, message: 'Baseline recommendations from the rule engine.' }
    }
    default:
      return {
        output: { note: `Operation "${op}" requires an AI provider.` },
        message: 'No rule-engine implementation for this operation.'
      }
  }
}

/* ------------------------------------------------------------------ */

export async function runAiOperation(
  db: D1Database,
  env: Bindings,
  orgId: string,
  userId: string | null,
  req: AiRequest
): Promise<AiResult> {
  if (!AI_OPERATIONS.includes(req.operation)) {
    throw badRequest(`Unknown AI operation "${req.operation}".`)
  }
  const started = Date.now()
  const jobId = newId('aij')
  const llmAvailable = openAiAdapter.isConfigured(env)

  // Operations the rule engine implements natively; prefer it for determinism.
  const ruleCapable: AiOperation[] = ['score', 'classify', 'analyze', 'recommend', 'plan']
  const useRule = ruleCapable.includes(req.operation) || !llmAvailable

  let status: AiResult['status'] = 'OK'
  let engine: AiResult['engine'] = useRule ? 'RULE' : 'LLM'
  let output: Record<string, unknown> | null = null
  let message = ''

  try {
    if (useRule) {
      const r = ruleEngine(req.operation, req.input)
      output = r.output
      message = r.message
      if (!llmAvailable && !ruleCapable.includes(req.operation)) {
        status = 'NOT_CONFIGURED'
        message = 'No AI provider configured. Add OPENAI_API_KEY as a Cloudflare secret to enable this operation.'
      }
    } else {
      const text = await openAiAdapter.complete(
        { env, orgId, config: {} },
        JSON.stringify(req.input),
        `You are the PDBOS AI engine. Operation: ${req.operation}. Respond with concise JSON.`
      )
      output = { text }
      message = 'Completed by the AI provider.'
      await incrementUsage(db, orgId, 'openai')
      await logIntegration(db, orgId, null, `ai.${req.operation}`, 'OK', Date.now() - started)
    }
  } catch (err: any) {
    console.error('[PDBOS] ai operation failed:', err)
    status = err?.code === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'ERROR'
    message =
      status === 'NOT_CONFIGURED'
        ? 'No AI provider configured.'
        : 'The AI provider could not complete this request.'
    await logIntegration(db, orgId, null, `ai.${req.operation}`, 'ERROR', Date.now() - started, message)
  }

  const durationMs = Date.now() - started

  try {
    await db
      .prepare(
        `INSERT INTO ai_jobs (id, org_id, operation, provider_key, entity_type, entity_id, status, input, output, message, duration_ms, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        jobId,
        orgId,
        req.operation,
        engine === 'LLM' ? 'openai' : 'rule_engine',
        req.entityType ?? null,
        req.entityId ?? null,
        status,
        JSON.stringify(req.input).slice(0, 4000),
        output ? JSON.stringify(output).slice(0, 8000) : null,
        message,
        durationMs,
        userId
      )
      .run()
  } catch (err) {
    console.error('[PDBOS] ai_jobs insert failed:', err)
  }

  return { operation: req.operation, engine, status, output, message, duration_ms: durationMs, job_id: jobId }
}

export async function listAiJobs(db: D1Database, orgId: string, limit = 20) {
  const rows = await db
    .prepare(
      `SELECT id, operation, provider_key, entity_type, entity_id, status, message, duration_ms, created_at
       FROM ai_jobs WHERE org_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .bind(orgId, limit)
    .all()
  return rows.results ?? []
}
