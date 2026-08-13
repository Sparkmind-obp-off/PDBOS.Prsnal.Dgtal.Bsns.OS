/**
 * OpenAI-compatible AI provider adapter.
 *
 * Used by the AI service boundary. Phase 0 does not require the credential;
 * without OPENAI_API_KEY the AI OS reports NOT_CONFIGURED and falls back to the
 * deterministic rule engine (which is real logic, not a fake AI).
 */
import type { AdapterContext, IntegrationAdapter, TestResult } from './types'
import type { Bindings } from '../types'

function baseUrl(env: Bindings): string {
  return (env.AI_PROVIDER_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
}

export const openAiAdapter: IntegrationAdapter & {
  complete(ctx: AdapterContext, prompt: string, system?: string): Promise<string>
} = {
  key: 'openai',
  name: 'OpenAI (or compatible)',
  category: 'AI',
  capabilities: [
    'ai.research', 'ai.summarize', 'ai.analyze', 'ai.score', 'ai.classify',
    'ai.generate', 'ai.personalize', 'ai.recommend', 'ai.plan'
  ],
  secretRef: 'OPENAI_API_KEY',

  isConfigured(env: Bindings) {
    return Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.length > 10)
  },

  async test(ctx: AdapterContext): Promise<TestResult> {
    const started = Date.now()
    if (!this.isConfigured(ctx.env)) {
      return {
        ok: false,
        status: 'NOT_CONFIGURED',
        message: 'OPENAI_API_KEY is not set on the server. Add it as a Cloudflare secret to enable AI operations.',
        durationMs: Date.now() - started
      }
    }
    try {
      const res = await fetch(`${baseUrl(ctx.env)}/models`, {
        headers: { Authorization: `Bearer ${ctx.env.OPENAI_API_KEY}` }
      })
      const durationMs = Date.now() - started
      if (!res.ok) {
        return { ok: false, status: 'ERROR', message: `Provider responded with HTTP ${res.status}.`, durationMs }
      }
      return { ok: true, status: 'CONNECTED', message: 'Connection successful.', durationMs }
    } catch (err) {
      console.error('[PDBOS] openai test failed:', err)
      return {
        ok: false,
        status: 'ERROR',
        message: 'Could not reach the provider.',
        durationMs: Date.now() - started
      }
    }
  },

  async complete(ctx: AdapterContext, prompt: string, system?: string): Promise<string> {
    if (!this.isConfigured(ctx.env)) {
      throw Object.assign(new Error('openai not configured'), { code: 'NOT_CONFIGURED' })
    }
    const model = (ctx.config?.model as string) || 'gpt-4o-mini'
    const res = await fetch(`${baseUrl(ctx.env)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    })
    if (!res.ok) {
      throw Object.assign(new Error(`Provider HTTP ${res.status}`), { code: 'PROVIDER_ERROR' })
    }
    const json = (await res.json()) as any
    return json?.choices?.[0]?.message?.content ?? ''
  }
}
