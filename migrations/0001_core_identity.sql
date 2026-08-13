-- PDBOS — 0001 Core Identity, RBAC, Settings, Audit, Notifications
-- Conventions:
--   * TEXT primary keys (ULID-like ids generated in app layer)
--   * created_at / updated_at stored as ISO-8601 TEXT (UTC)
--   * every business row is scoped to an organization (org_id) for future multi-tenant
--   * is_demo flag marks seed data so it can be purged later

-- ORGANIZATIONS -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'IDR',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  business_type TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- USERS ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email          TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,   -- PBKDF2-SHA256, format: pbkdf2$<iter>$<salt_b64>$<hash_b64>
  status         TEXT NOT NULL DEFAULT 'ACTIVE',
  avatar_url     TEXT,
  last_login_at  TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_org    ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);

-- SESSIONS ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,      -- sha256 of the raw session token (raw token never stored)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- RBAC ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,  -- OWNER / ADMIN / OPERATOR / SALES / DELIVERY / VIEWER
  name        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id          TEXT PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,  -- e.g. lead.create
  resource    TEXT NOT NULL,         -- e.g. lead
  action      TEXT NOT NULL,         -- e.g. create
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id, org_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- SETTINGS (database-backed, per org, optionally per user) -------------------
CREATE TABLE IF NOT EXISTS settings (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL DEFAULT 'ORG',   -- ORG | USER
  key         TEXT NOT NULL,
  value       TEXT,                          -- JSON-encoded
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, scope, user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_settings_lookup ON settings(org_id, scope, key);

-- AUDIT LOGS ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  org_id      TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,   -- LOGIN/LOGOUT/CREATE/UPDATE/DELETE/STATUS_CHANGE/...
  entity      TEXT,
  entity_id   TEXT,
  metadata    TEXT,            -- JSON
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity   ON audit_logs(entity, entity_id);

-- NOTIFICATIONS -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'INFO',     -- INFO/SUCCESS/WARNING/ERROR/REMINDER
  severity     TEXT NOT NULL DEFAULT 'LOW',      -- LOW/MEDIUM/HIGH
  title        TEXT NOT NULL,
  message      TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  read_at      TEXT,
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(org_id, user_id, read_at, created_at DESC);

-- ANALYTICS EVENTS ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_events (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  event       TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  properties  TEXT,            -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_org_time ON analytics_events(org_id, created_at DESC);
