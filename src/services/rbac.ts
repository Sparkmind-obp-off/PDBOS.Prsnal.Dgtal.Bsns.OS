/**
 * RBAC — permission catalogue and role mapping.
 * Roles/permissions live in the database; this module is the source of truth
 * used to provision them and to reason about defaults.
 */
import { newId } from '../lib/id'
import { forbidden } from '../lib/http'
import type { SessionUser } from '../types'

export const PERMISSIONS: { key: string; resource: string; action: string; description: string }[] = [
  // Leads
  { key: 'lead.create', resource: 'lead', action: 'create', description: 'Create leads' },
  { key: 'lead.read', resource: 'lead', action: 'read', description: 'View leads' },
  { key: 'lead.update', resource: 'lead', action: 'update', description: 'Update leads' },
  { key: 'lead.delete', resource: 'lead', action: 'delete', description: 'Archive/delete leads' },
  // Clients
  { key: 'client.create', resource: 'client', action: 'create', description: 'Create clients' },
  { key: 'client.read', resource: 'client', action: 'read', description: 'View clients' },
  { key: 'client.update', resource: 'client', action: 'update', description: 'Update clients' },
  { key: 'client.delete', resource: 'client', action: 'delete', description: 'Delete clients' },
  // Projects
  { key: 'project.create', resource: 'project', action: 'create', description: 'Create projects' },
  { key: 'project.read', resource: 'project', action: 'read', description: 'View projects' },
  { key: 'project.update', resource: 'project', action: 'update', description: 'Update projects' },
  { key: 'project.delete', resource: 'project', action: 'delete', description: 'Delete projects' },
  // Sales
  { key: 'sales.read', resource: 'sales', action: 'read', description: 'View pipeline, offers, deals' },
  { key: 'sales.manage', resource: 'sales', action: 'manage', description: 'Manage pipeline, offers, deals' },
  // Finance
  { key: 'finance.read', resource: 'finance', action: 'read', description: 'View money data' },
  { key: 'finance.manage', resource: 'finance', action: 'manage', description: 'Manage invoices, payments, expenses' },
  // Resources
  { key: 'resource.read', resource: 'resource', action: 'read', description: 'View resources' },
  { key: 'resource.manage', resource: 'resource', action: 'manage', description: 'Manage resources' },
  // Assets
  { key: 'asset.read', resource: 'asset', action: 'read', description: 'View assets' },
  { key: 'asset.manage', resource: 'asset', action: 'manage', description: 'Manage assets' },
  // Discovery
  { key: 'discovery.read', resource: 'discovery', action: 'read', description: 'View discovery runs' },
  { key: 'discovery.run', resource: 'discovery', action: 'run', description: 'Run discovery searches' },
  // Integrations
  { key: 'integration.read', resource: 'integration', action: 'read', description: 'View integrations' },
  { key: 'integration.manage', resource: 'integration', action: 'manage', description: 'Connect/disconnect integrations' },
  // AI
  { key: 'ai.read', resource: 'ai', action: 'read', description: 'View AI jobs' },
  { key: 'ai.run', resource: 'ai', action: 'run', description: 'Run AI operations' },
  // Analytics / activity
  { key: 'analytics.read', resource: 'analytics', action: 'read', description: 'View analytics' },
  { key: 'activity.create', resource: 'activity', action: 'create', description: 'Record activities' },
  { key: 'activity.read', resource: 'activity', action: 'read', description: 'View activities' },
  // Admin
  { key: 'settings.manage', resource: 'settings', action: 'manage', description: 'Manage settings' },
  { key: 'audit.read', resource: 'audit', action: 'read', description: 'View audit logs' },
  { key: 'user.manage', resource: 'user', action: 'manage', description: 'Manage users and roles' }
]

const ALL = PERMISSIONS.map((p) => p.key)

const READ_ONLY = ALL.filter((k) => k.endsWith('.read'))

export const ROLES: { key: string; name: string; description: string; permissions: string[] }[] = [
  {
    key: 'OWNER',
    name: 'Owner',
    description: 'Full access to everything.',
    permissions: ALL
  },
  {
    key: 'ADMIN',
    name: 'Admin',
    description: 'Full operational access except user management.',
    permissions: ALL.filter((k) => k !== 'user.manage')
  },
  {
    key: 'OPERATOR',
    name: 'Operator',
    description: 'Day-to-day operations across leads, delivery, assets and resources.',
    permissions: [
      ...READ_ONLY,
      'lead.create', 'lead.update',
      'client.create', 'client.update',
      'project.create', 'project.update',
      'asset.manage', 'resource.manage',
      'activity.create', 'discovery.run', 'ai.run'
    ]
  },
  {
    key: 'SALES',
    name: 'Sales',
    description: 'Leads, discovery, pipeline and offers.',
    permissions: [
      'lead.read', 'lead.create', 'lead.update',
      'client.read', 'project.read',
      'sales.read', 'sales.manage',
      'discovery.read', 'discovery.run',
      'asset.read', 'resource.read',
      'activity.read', 'activity.create',
      'analytics.read', 'ai.read', 'ai.run', 'integration.read'
    ]
  },
  {
    key: 'DELIVERY',
    name: 'Delivery',
    description: 'Clients, projects and tasks.',
    permissions: [
      'client.read', 'client.update',
      'project.read', 'project.create', 'project.update',
      'lead.read', 'asset.read', 'asset.manage', 'resource.read',
      'activity.read', 'activity.create', 'analytics.read', 'integration.read'
    ]
  },
  {
    key: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access.',
    permissions: READ_ONLY
  }
]

export function hasPermission(user: SessionUser | undefined, permission: string): boolean {
  if (!user) return false
  if (user.roles.includes('OWNER')) return true
  return user.permissions.includes(permission)
}

export function assertPermission(user: SessionUser | undefined, permission: string): void {
  if (!hasPermission(user, permission)) {
    throw forbidden(`Missing permission: ${permission}`)
  }
}

/**
 * Idempotently provision roles + permissions into the database.
 * Safe to call on every boot; uses INSERT OR IGNORE semantics.
 */
export async function ensureRbacSeeded(db: D1Database): Promise<void> {
  const statements: D1PreparedStatement[] = []

  for (const p of PERMISSIONS) {
    statements.push(
      db.prepare(
        `INSERT INTO permissions (id, key, resource, action, description)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET description = excluded.description`
      ).bind(newId('perm'), p.key, p.resource, p.action, p.description)
    )
  }

  for (const r of ROLES) {
    statements.push(
      db.prepare(
        `INSERT INTO roles (id, key, name, description, is_system)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET name = excluded.name, description = excluded.description`
      ).bind(newId('role'), r.key, r.name, r.description)
    )
  }

  await db.batch(statements)

  // Map role -> permissions
  const mapStatements: D1PreparedStatement[] = []
  for (const r of ROLES) {
    for (const permKey of r.permissions) {
      mapStatements.push(
        db.prepare(
          `INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
           SELECT r.id, p.id FROM roles r, permissions p WHERE r.key = ? AND p.key = ?`
        ).bind(r.key, permKey)
      )
    }
  }
  await db.batch(mapStatements)
}
