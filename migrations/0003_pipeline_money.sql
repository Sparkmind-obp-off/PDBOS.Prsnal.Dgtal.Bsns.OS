-- PDBOS — 0003 Lead Engine, Discovery, Sales OS, Client OS, Delivery OS, Money OS

-- LEAD SOURCES --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_sources (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,      -- MANUAL / GOOGLE_MAPS / INSTAGRAM / REFERRAL / IMPORT / OTHER
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, key)
);

-- LEADS ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  category      TEXT,
  industry      TEXT,
  address       TEXT,
  city          TEXT,
  website       TEXT,
  phone         TEXT,
  email         TEXT,
  social_url    TEXT,
  source_id     TEXT REFERENCES lead_sources(id) ON DELETE SET NULL,
  source_key    TEXT NOT NULL DEFAULT 'MANUAL',
  external_ref  TEXT,            -- provider id (e.g. google place_id) for dedupe
  dedupe_key    TEXT,            -- normalized name+city
  status        TEXT NOT NULL DEFAULT 'NEW',    -- NEW/RESEARCHING/QUALIFIED/CONTACTED/REPLIED/INTERESTED/DEMO/OFFER/WON/LOST/NURTURE
  priority      TEXT NOT NULL DEFAULT 'MEDIUM', -- LOW/MEDIUM/HIGH/HOT
  score         INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT,
  archived_at   TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads(org_id, status, archived_at);
CREATE INDEX IF NOT EXISTS idx_leads_priority   ON leads(org_id, priority);
CREATE INDEX IF NOT EXISTS idx_leads_name       ON leads(org_id, business_name);
CREATE INDEX IF NOT EXISTS idx_leads_city       ON leads(org_id, city);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_dedupe ON leads(org_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS contacts (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id    TEXT REFERENCES leads(id) ON DELETE CASCADE,
  client_id  TEXT,
  name       TEXT NOT NULL,
  role       TEXT,
  phone      TEXT,
  email      TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_demo    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_lead ON contacts(lead_id);

CREATE TABLE IF NOT EXISTS lead_scores (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL DEFAULT 0,
  breakdown   TEXT,            -- JSON of factor -> points
  computed_by TEXT NOT NULL DEFAULT 'RULE',  -- RULE / AI / MANUAL
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lead_scores ON lead_scores(lead_id, created_at DESC);

-- ACTIVITIES (polymorphic timeline) ------------------------------------------
CREATE TABLE IF NOT EXISTS lead_activities (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL DEFAULT 'LEAD',  -- LEAD/CLIENT/PROJECT/OPPORTUNITY/ASSET/RESOURCE
  entity_id   TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'NOTE',  -- NOTE/CALL/MESSAGE/EMAIL/FOLLOW_UP/MEETING/DEMO/OFFER/PAYMENT/TASK/SYSTEM
  description TEXT NOT NULL,
  outcome     TEXT,
  due_at      TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activities_entity ON lead_activities(org_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_due    ON lead_activities(org_id, due_at);

-- DISCOVERY -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_runs (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  query        TEXT NOT NULL,
  location     TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING/OK/ERROR/NOT_CONFIGURED
  result_count INTEGER NOT NULL DEFAULT 0,
  imported     INTEGER NOT NULL DEFAULT 0,
  message      TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_discovery_org ON discovery_runs(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS discovery_results (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  category      TEXT,
  address       TEXT,
  city          TEXT,
  phone         TEXT,
  website       TEXT,
  external_ref  TEXT,
  raw           TEXT,        -- JSON payload from provider
  imported_lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_discovery_results ON discovery_results(run_id);

-- SALES OS ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunities (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id      TEXT REFERENCES leads(id) ON DELETE SET NULL,
  client_id    TEXT,
  title        TEXT NOT NULL,
  stage        TEXT NOT NULL DEFAULT 'DISCOVERY', -- DISCOVERY/QUALIFYING/PROPOSAL/NEGOTIATION/WON/LOST
  value        REAL NOT NULL DEFAULT 0,
  probability  INTEGER NOT NULL DEFAULT 0,
  expected_at  TEXT,
  owner_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes        TEXT,
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_opps_org ON opportunities(org_id, stage);

CREATE TABLE IF NOT EXISTS offers (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  lead_id        TEXT REFERENCES leads(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  package        TEXT,
  price          REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'IDR',
  status         TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT/SENT/VIEWED/ACCEPTED/REJECTED/EXPIRED
  valid_until    TEXT,
  asset_id       TEXT REFERENCES assets(id) ON DELETE SET NULL,
  notes          TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offers_org ON offers(org_id, status);

CREATE TABLE IF NOT EXISTS deals (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  offer_id       TEXT REFERENCES offers(id) ON DELETE SET NULL,
  client_id      TEXT,
  value          REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN/WON/LOST/CANCELLED
  closed_at      TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_org ON deals(org_id, status);

-- CLIENT OS / DELIVERY OS ---------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id     TEXT REFERENCES leads(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  industry    TEXT,
  city        TEXT,
  website     TEXT,
  phone       TEXT,
  email       TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE/PAUSED/CHURNED/PROSPECT
  health      TEXT NOT NULL DEFAULT 'GOOD',    -- GOOD/AT_RISK/CRITICAL
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes       TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(org_id, status);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(org_id, name);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
  deal_id     TEXT REFERENCES deals(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  type        TEXT,
  status      TEXT NOT NULL DEFAULT 'PLANNED', -- PLANNED/IN_PROGRESS/REVIEW/DELIVERED/ON_HOLD/CANCELLED
  progress    INTEGER NOT NULL DEFAULT 0,
  start_date  TEXT,
  due_date    TEXT,
  value       REAL NOT NULL DEFAULT 0,
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes       TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(org_id, name);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'TODO',   -- TODO/DOING/BLOCKED/DONE
  priority    TEXT NOT NULL DEFAULT 'MEDIUM',
  due_date    TEXT,
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due     ON tasks(org_id, due_date);

-- MONEY OS ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  number      TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'IDR',
  status      TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT/SENT/PARTIAL/PAID/OVERDUE/VOID
  issued_at   TEXT,
  due_at      TEXT,
  notes       TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id  TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  client_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
  amount      REAL NOT NULL DEFAULT 0,
  method      TEXT,
  paid_at     TEXT NOT NULL DEFAULT (datetime('now')),
  reference   TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(org_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS expenses (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  category    TEXT NOT NULL DEFAULT 'TOOL',  -- TOOL/API/MARKETING/OPS/OTHER
  description TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'IDR',
  spent_at    TEXT NOT NULL DEFAULT (datetime('now')),
  recurring   TEXT NOT NULL DEFAULT 'NONE',  -- NONE/MONTHLY/YEARLY
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(org_id, spent_at DESC);

-- AI OS: request log for the AI service boundary ----------------------------
CREATE TABLE IF NOT EXISTS ai_jobs (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation    TEXT NOT NULL,       -- research/summarize/analyze/score/classify/generate/personalize/recommend/plan
  provider_key TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING', -- PENDING/OK/ERROR/NOT_CONFIGURED
  input        TEXT,
  output       TEXT,
  message      TEXT,
  duration_ms  INTEGER,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_org ON ai_jobs(org_id, created_at DESC);
