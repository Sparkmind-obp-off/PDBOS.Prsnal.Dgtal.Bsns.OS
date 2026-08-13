-- PDBOS — 0002 Resource OS, Asset OS, Template Factory, Integration Hub

-- RESOURCE OS ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resource_categories (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS resources (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id  TEXT REFERENCES resource_categories(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  provider     TEXT,
  type         TEXT NOT NULL DEFAULT 'OTHER',   -- TOOL/API/PLATFORM/ACCOUNT/AI_MODEL/SERVICE/DOMAIN/HOSTING/OTHER
  description  TEXT,
  capability   TEXT,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE/INACTIVE/TRIAL/LIMITED/EXPIRED
  cost_type    TEXT NOT NULL DEFAULT 'FREE',    -- FREE/MONTHLY/YEARLY/USAGE/ONE_TIME
  monthly_cost REAL NOT NULL DEFAULT 0,
  usage_limit  TEXT,
  notes        TEXT,
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resources_org    ON resources(org_id, status);
CREATE INDEX IF NOT EXISTS idx_resources_name   ON resources(org_id, name);

-- Credentials are metadata pointers only. Secret values live in Cloudflare
-- secrets / env, never in the database and never in the browser.
CREATE TABLE IF NOT EXISTS resource_credentials (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_id  TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  secret_ref   TEXT NOT NULL,   -- name of the Cloudflare secret / env var
  status       TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_res_cred ON resource_credentials(resource_id);

CREATE TABLE IF NOT EXISTS resource_usage (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,            -- YYYY-MM
  units       REAL NOT NULL DEFAULT 0,
  cost        REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_res_usage ON resource_usage(resource_id, period);

-- INTEGRATION HUB -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_providers (
  id            TEXT PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,   -- google_places / openai / whatsapp_cloud / ...
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,          -- DISCOVERY / AI / MESSAGING / PAYMENT / ANALYTICS / STORAGE
  capabilities  TEXT NOT NULL,          -- JSON array of capability keys
  auth_type     TEXT NOT NULL DEFAULT 'API_KEY',
  docs_url      TEXT,
  secret_ref    TEXT,                   -- expected Cloudflare secret name
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integrations (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL REFERENCES integration_providers(key) ON DELETE CASCADE,
  resource_id  TEXT REFERENCES resources(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'NOT_CONFIGURED', -- CONNECTED/DISCONNECTED/ERROR/NOT_CONFIGURED
  config       TEXT,          -- JSON, non-secret configuration only
  last_test_at TEXT,
  last_error   TEXT,
  usage_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, provider_key)
);
CREATE INDEX IF NOT EXISTS idx_integrations_org ON integrations(org_id, status);

CREATE TABLE IF NOT EXISTS integration_credentials (
  id             TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  secret_ref     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integration_logs (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id TEXT REFERENCES integrations(id) ON DELETE CASCADE,
  operation      TEXT NOT NULL,
  status         TEXT NOT NULL,     -- OK / ERROR / SKIPPED
  duration_ms    INTEGER,
  message        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_int_logs ON integration_logs(integration_id, created_at DESC);

-- ASSET OS ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_categories (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS assets (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id        TEXT REFERENCES asset_categories(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'OTHER',  -- WEBSITE/LANDING_PAGE/COMPONENT/PROMPT/COPY/IMAGE/VIDEO/BRAND/DEMO/WORKFLOW/PROPOSAL/PRICING/CODE/OTHER
  niche              TEXT,
  description        TEXT,
  version            TEXT NOT NULL DEFAULT '1.0.0',
  status             TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT/ACTIVE/ARCHIVED
  preview_url        TEXT,
  production_url     TEXT,
  reusable           INTEGER NOT NULL DEFAULT 1,
  usage_count        INTEGER NOT NULL DEFAULT 0,
  revenue_attributed REAL NOT NULL DEFAULT 0,
  notes              TEXT,
  is_demo            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_org  ON assets(org_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(org_id, type);
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(org_id, name);

CREATE TABLE IF NOT EXISTS asset_versions (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version    TEXT NOT NULL,
  changelog  TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_versions ON asset_versions(asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS asset_usage (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  entity_type TEXT,       -- LEAD / CLIENT / PROJECT / OFFER
  entity_id   TEXT,
  revenue     REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_usage ON asset_usage(asset_id, created_at DESC);

-- TEMPLATE FACTORY ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id   TEXT REFERENCES assets(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'PAGE',  -- PAGE/EMAIL/MESSAGE/PROPOSAL/PROMPT
  niche      TEXT,
  status     TEXT NOT NULL DEFAULT 'DRAFT',
  body       TEXT,
  is_demo    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_org ON templates(org_id, status);

CREATE TABLE IF NOT EXISTS template_components (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slot        TEXT,
  body        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_template_components ON template_components(template_id, sort_order);
