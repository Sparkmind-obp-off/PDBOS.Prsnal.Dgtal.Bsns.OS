# PDBOS — Personal Digital Business OS

**Codename:** SURVIVAL ENGINE
**Phase:** 0 — Foundation (complete)

## Project Overview

- **Name**: PDBOS — Personal Digital Business OS
- **Goal**: A personal digital business operating system for a solo digital business owner —
  turning resources, assets and time into leads, clients, projects, revenue and reusable assets.
- **What it is not**: not a CRM clone, not a landing page, not a static mockup. Every screen reads
  and writes a real relational database behind real authentication and role-based access control.

The business flow the architecture is built around:

```
RESOURCE → ASSET → DISCOVERY → LEAD → INTELLIGENCE → OUTREACH → DEMO → OFFER
        → CLIENT → DELIVERY → REVENUE → DATA → LEARNING → BETTER ASSET → REUSE
```

## URLs

- **Production**: _(set after Cloudflare Pages deploy)_
- **GitHub**: https://github.com/Sparkmind-obp-off/PDBOS.Prsnal.Dgtal.Bsns.OS
- **Local dev**: http://localhost:3000
- **Health check**: `GET /api/health`

## Tech Stack

- **Runtime**: Cloudflare Pages / Workers (edge)
- **Backend**: Hono 4 + TypeScript, modular routes → services → integration adapters
- **Database**: Cloudflare D1 (SQLite), 3 migration files, 43 tables
- **Frontend**: vanilla ES modules + hash router, Tailwind (CDN), Font Awesome — no build step for the client
- **Process manager (dev)**: PM2 + `wrangler pages dev`

## Architecture

```
Browser (ES modules, hash router)
  └── /api/*  ──►  Hono routes            (HTTP shape, validation, permissions)
                     └── services/        (business logic, D1 access)
                           └── integrations/  (provider adapters)
                                 └── external APIs (Google Places, OpenAI, …)
```

Key boundaries:

- **No provider is hard-coded in business logic.** Everything external goes through
  `src/integrations/registry.ts` and an adapter implementing a common contract
  (`connect`, `test`, `run`, `capabilities`).
- **AI is a service boundary, not a chatbot.** `src/services/ai.ts` exposes 9 operations
  (`research, summarize, analyze, score, classify, generate, personalize, recommend, plan`).
  Without an LLM credential they run on a deterministic **rule engine** rather than failing.
  Every run is recorded in `ai_jobs`.
- **Secrets never reach the browser.** Provider credentials live only as Cloudflare secrets
  (environment bindings). The database stores a `secret_ref` name, never a key value, and the API
  returns a `configured: true|false` boolean instead of the credential.

## Database

Migrations in `migrations/`:

| File | Contents |
|------|----------|
| `0001_core_identity.sql` | organizations, users, sessions, roles, permissions, user_roles, role_permissions, settings, audit_logs, notifications |
| `0002_resource_asset_integration.sql` | resources, resource_categories, resource_credentials, resource_usage, assets, asset_categories, asset_versions, asset_usage, templates, integration_providers, integrations, integration_logs, ai_jobs |
| `0003_pipeline_money.sql` | leads, contacts, lead_sources, lead_scores, activities, discovery_runs, discovery_results, opportunities, offers, deals, clients, projects, tasks, invoices, payments, expenses, analytics_events |

Conventions: TEXT primary keys (app-generated ULID-like ids), every business row scoped by
`org_id`, ISO-8601 UTC `created_at` / `updated_at`, `is_demo` flag on seeded rows, indexes on
frequently filtered columns, foreign keys with cascade.

## Authentication & RBAC

- Sign up / sign in / sign out, PBKDF2-SHA256 password hashes with a per-user salt.
- Sessions: HttpOnly cookie carrying a token whose **hash** is stored server-side, so JavaScript
  cannot read a usable credential.
- Protected routes: unauthenticated requests to any `/api` business endpoint return 401; the shell
  redirects to the auth screen.
- Roles: `OWNER, ADMIN, OPERATOR, SALES, DELIVERY, VIEWER` over 32 granular permissions
  (`lead.create`, `finance.manage`, `user.manage`, …). OWNER implicitly holds everything.
- Role changes and suspensions **revoke live sessions immediately**, so stale permissions cannot be reused.
- Lock-out protection: an organization always keeps at least one active OWNER.

## API Reference

Auth
```
POST   /api/auth/signup            { email, name, password, org_name }
POST   /api/auth/signin            { email, password }
POST   /api/auth/signout
GET    /api/auth/session
GET    /api/auth/permissions
PATCH  /api/auth/profile           { name?, avatar_url? }
POST   /api/auth/password          { current_password, new_password }
```

Leads / activities / discovery
```
GET    /api/leads                  ?q&status&priority&source&city&page&per_page
POST   /api/leads                  · GET|PATCH|DELETE /api/leads/:id
POST   /api/leads/:id/score
GET    /api/activities             ?entity_type&entity_id
POST   /api/activities             { entity_type, entity_id, type, description }
GET    /api/discovery/runs
POST   /api/discovery/search       { provider_key, query, city? }
POST   /api/discovery/import       { run_id, result_ids[] }
```

Pipeline / clients / delivery / money / analytics
```
GET|POST        /api/opportunities · PATCH /api/opportunities/:id
GET|POST        /api/offers        · PATCH /api/offers/:id
GET|POST        /api/clients       · GET|PATCH|DELETE /api/clients/:id
GET|POST        /api/projects      · GET|PATCH|DELETE /api/projects/:id
POST            /api/projects/:id/tasks   · PATCH /api/tasks/:id
GET             /api/money
POST            /api/invoices      · PATCH /api/invoices/:id
POST            /api/payments      · POST /api/expenses
GET             /api/analytics
```

Resources / assets / integrations
```
GET|POST  /api/resources           · GET|PATCH|DELETE /api/resources/:id
GET|POST  /api/assets              · GET|PATCH|DELETE /api/assets/:id
GET       /api/integrations        · GET /api/integrations/:key
POST      /api/integrations/:key/connect | /disconnect | /test
```

Team (requires `user.manage`)
```
GET    /api/team
POST   /api/team                   { email, name, password, roles[] }
PATCH  /api/team/:id/roles         { roles[] }
PATCH  /api/team/:id/status        { status: ACTIVE|SUSPENDED }
POST   /api/team/:id/password      { password }
DELETE /api/team/:id
```

System
```
GET    /api/health   /api/meta   /api/dashboard   /api/search?q=
GET    /api/notifications  · POST /api/notifications/:id/read  · /read-all
GET    /api/settings · PATCH /api/settings/org · PATCH /api/settings/user
GET    /api/audit                  ?action&page&per_page
GET    /api/ai/status  /api/ai/jobs  · POST /api/ai/run
GET    /api/demo-data  · POST /api/demo-data/seed  · /purge
```

## User Guide

1. **Sign up** — the first account becomes OWNER of a new organization.
2. **Seed demo data** — Settings → Demo data → *Seed demo data*. Loads a coherent Indonesian
   local-business scenario (wedding, beauty, barbershop, restaurant, studio) so the dashboard,
   pipeline and money views are immediately meaningful. Every seeded row carries `is_demo = 1`
   and can be purged without touching your own records.
3. **Command Center** — business health, revenue, pipeline, hot leads, priority actions, alerts.
4. **Leads** — add/edit/search/filter, change status, record activities, run rule-engine scoring.
5. **Discovery** — run the manual provider now; Google Places connects later without code changes.
6. **Team** — Settings → Team: add members, assign roles, suspend, reset passwords.
7. **Integrations** — connect/test providers; credentials stay server-side.

Mobile is first-class: bottom navigation, a global quick-add button, sticky primary actions,
card layouts instead of squeezed tables.

## Development

```bash
npm install
npm run build                    # required before first start
npx wrangler d1 migrations apply pdbos-production --local
pm2 start ecosystem.config.cjs   # serves on :3000
curl http://localhost:3000/api/health
pm2 logs pdbos --nostream
```

Useful scripts: `db:migrate:local`, `db:seed`, `db:reset`, `db:console:local`, `clean-port`.

## Deployment

- **Platform**: Cloudflare Pages (Workers runtime) + D1
- **Status**: local Phase 0 verified; production deploy via Cloudflare BYOK
- **Before first deploy**: create the D1 database and put its id in `wrangler.jsonc`

```bash
npx wrangler d1 create pdbos-production          # copy database_id into wrangler.jsonc
npx wrangler d1 migrations apply pdbos-production # production schema
npm run build && npx wrangler pages deploy dist --project-name pdbos
```

Optional server-side secrets (never needed for the app to run):

```bash
npx wrangler pages secret put GOOGLE_PLACES_API_KEY --project-name pdbos
npx wrangler pages secret put OPENAI_API_KEY        --project-name pdbos
npx wrangler pages secret put AI_PROVIDER_BASE_URL  --project-name pdbos  # optional override
```

## Completed in Phase 0

Application shell (desktop sidebar + mobile bottom nav + quick add) · Command Center reading real
aggregates · authentication with hashed passwords and server-side sessions · RBAC with 6 roles /
32 permissions enforced server-side · Team management · D1 schema across 3 migrations · Resource OS ·
Asset OS · Integration Hub with adapter registry, connect/disconnect/test and logs · AI service
boundary with rule-engine fallback and job log · Lead engine with search, filter, status flow and
scoring · Discovery foundation with run/result tables and import · activity timeline · in-app
notifications · database-backed settings · audit log · global search across 6 entity types ·
loading / empty / error / no-permission / not-configured states · demo data seed and purge.

## Not Yet Implemented (later phases)

Live Google Places discovery (adapter ready, credential required) · LLM-backed AI operations
(boundary ready, credential required) · Outreach and follow-up engines · Demo Factory ·
Template Factory · Reinvestment Engine · Action Engine · external notification channels
(email/WhatsApp) · two-factor authentication · CSV import/export · file attachments (R2).

## Recommended Next Steps

1. Connect Google Places and turn Discovery into live lead sourcing.
2. Add an LLM credential to move AI operations from the rule engine to generative output.
3. Build the Outreach + Follow-up engines on top of the existing activity timeline.
4. Demo Factory: generate a per-lead demo from an Asset, tracked back to revenue attribution.
5. Analytics depth: cohort/funnel conversion over time, asset ROI ranking.

---

**Last Updated**: 2026-08-13
