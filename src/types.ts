/**
 * PDBOS shared types & Cloudflare bindings.
 */

export interface Bindings {
  DB: D1Database
  // Optional secrets — resolved server-side only, never sent to the browser.
  GOOGLE_PLACES_API_KEY?: string
  OPENAI_API_KEY?: string
  AI_PROVIDER_BASE_URL?: string
  APP_ENV?: string
}

export interface SessionUser {
  id: string
  org_id: string
  email: string
  name: string
  status: string
  avatar_url: string | null
  roles: string[]
  permissions: string[]
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    user: SessionUser
    sessionId: string
    requestId: string
  }
}

export const LEAD_STATUSES = [
  'NEW', 'RESEARCHING', 'QUALIFIED', 'CONTACTED', 'REPLIED',
  'INTERESTED', 'DEMO', 'OFFER', 'WON', 'LOST', 'NURTURE'
] as const

export const LEAD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'HOT'] as const

export const RESOURCE_TYPES = [
  'TOOL', 'API', 'PLATFORM', 'ACCOUNT', 'AI_MODEL', 'SERVICE',
  'DOMAIN', 'HOSTING', 'OTHER'
] as const

export const RESOURCE_STATUSES = ['ACTIVE', 'INACTIVE', 'TRIAL', 'LIMITED', 'EXPIRED'] as const
export const RESOURCE_COST_TYPES = ['FREE', 'MONTHLY', 'YEARLY', 'USAGE', 'ONE_TIME'] as const

export const ASSET_TYPES = [
  'WEBSITE', 'LANDING_PAGE', 'COMPONENT', 'PROMPT', 'COPY', 'IMAGE', 'VIDEO',
  'BRAND', 'DEMO', 'WORKFLOW', 'PROPOSAL', 'PRICING', 'CODE', 'OTHER'
] as const

export const ASSET_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const

export const ACTIVITY_TYPES = [
  'NOTE', 'CALL', 'MESSAGE', 'EMAIL', 'FOLLOW_UP', 'MEETING',
  'DEMO', 'OFFER', 'PAYMENT', 'TASK', 'SYSTEM'
] as const

export const ACTIVITY_ENTITIES = [
  'LEAD', 'CLIENT', 'PROJECT', 'OPPORTUNITY', 'ASSET', 'RESOURCE'
] as const

export const NOTIFICATION_TYPES = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'REMINDER'] as const

export const AUDIT_ACTIONS = [
  'LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE',
  'INTEGRATION_TEST', 'PERMISSION_CHANGE', 'SETTINGS_CHANGE', 'AI_RUN', 'DISCOVERY_RUN'
] as const

export const ROLE_KEYS = ['OWNER', 'ADMIN', 'OPERATOR', 'SALES', 'DELIVERY', 'VIEWER'] as const
export type RoleKey = typeof ROLE_KEYS[number]

export const AI_OPERATIONS = [
  'research', 'summarize', 'analyze', 'score', 'classify',
  'generate', 'personalize', 'recommend', 'plan'
] as const
export type AiOperation = typeof AI_OPERATIONS[number]
