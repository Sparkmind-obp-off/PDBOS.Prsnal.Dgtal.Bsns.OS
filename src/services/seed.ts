/**
 * Demo / seed data.
 *
 * Every row written here carries is_demo = 1 so the whole set can be purged
 * later without touching real business records. The data is generated through
 * the same service functions the API uses, so the seeded state is exactly what
 * a real user would produce — no shortcut inserts that bypass business rules.
 */
import { newId } from '../lib/id'
import { conflict } from '../lib/http'
import { createLead } from './leads'
import { createResource } from './resources'
import { createAsset } from './assets'
import { createActivity } from './activities'
import {
  createClient, createProject, createTask,
  createOpportunity, createOffer,
  createInvoice, recordPayment, createExpense
} from './crm'
import { notify } from './notifications'

/** Tables that hold demo rows, ordered so children are removed before parents. */
const DEMO_TABLES = [
  'lead_activities',
  'tasks',
  'payments',
  'invoices',
  'expenses',
  'offers',
  'deals',
  'opportunities',
  'projects',
  'clients',
  'contacts',
  'leads',
  'assets',
  'templates',
  'resources',
  'notifications'
] as const

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')
}

function daysAhead(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ *
 * Seed definitions — realistic Indonesian local-business scenarios.
 * ------------------------------------------------------------------ */

const DEMO_RESOURCES = [
  {
    name: 'Genspark', provider: 'Genspark', type: 'PLATFORM',
    capability: 'App building, AI agents, deployment',
    description: 'Primary build platform for PDBOS and client deliverables.',
    status: 'ACTIVE', cost_type: 'MONTHLY', monthly_cost: 300_000,
    usage_limit: 'Credit based'
  },
  {
    name: 'Cloudflare Pages', provider: 'Cloudflare', type: 'HOSTING',
    capability: 'Edge hosting, D1 database, custom domains',
    description: 'Hosting and database layer for every delivered site.',
    status: 'ACTIVE', cost_type: 'FREE', monthly_cost: 0,
    usage_limit: '100k requests/day on free plan'
  },
  {
    name: 'Google Places API', provider: 'Google', type: 'API',
    capability: 'Local business discovery and enrichment',
    description: 'Lead discovery source. Needs GOOGLE_PLACES_API_KEY to activate.',
    status: 'INACTIVE', cost_type: 'USAGE', monthly_cost: 0,
    usage_limit: 'Pay per request'
  },
  {
    name: 'GitHub', provider: 'GitHub', type: 'PLATFORM',
    capability: 'Source control, versioning, CI',
    description: 'Repository for all project code and asset templates.',
    status: 'ACTIVE', cost_type: 'FREE', monthly_cost: 0,
    usage_limit: 'Unlimited public repos'
  },
  {
    name: 'OpenAI API', provider: 'OpenAI', type: 'AI_MODEL',
    capability: 'Lead analysis, copy generation, outreach personalization',
    description: 'AI engine behind the AI OS. Needs OPENAI_API_KEY to activate.',
    status: 'TRIAL', cost_type: 'USAGE', monthly_cost: 0,
    usage_limit: 'Pay per token'
  },
  {
    name: 'Canva Pro', provider: 'Canva', type: 'TOOL',
    capability: 'Brand kits, social assets, proposal design',
    description: 'Visual asset production for demos and proposals.',
    status: 'ACTIVE', cost_type: 'MONTHLY', monthly_cost: 130_000,
    usage_limit: 'Unlimited'
  },
  {
    name: 'sparkmind.id domain', provider: 'Cloudflare Registrar', type: 'DOMAIN',
    capability: 'Primary business domain + demo subdomains',
    description: 'Used for the agency site and per-client demo subdomains.',
    status: 'ACTIVE', cost_type: 'YEARLY', monthly_cost: 20_000,
    usage_limit: '1 domain'
  },
  {
    name: 'WhatsApp Business', provider: 'Meta', type: 'ACCOUNT',
    capability: 'Outreach, follow-up, client communication',
    description: 'Primary outreach channel for local businesses.',
    status: 'ACTIVE', cost_type: 'FREE', monthly_cost: 0,
    usage_limit: 'Manual sending'
  }
]

const DEMO_ASSETS = [
  {
    name: 'Wedding Organizer Landing Page v2', type: 'LANDING_PAGE', niche: 'Wedding',
    description: 'High-converting one-page site with gallery, package table and WhatsApp CTA.',
    version: '2.1.0', status: 'ACTIVE', reusable: true,
    preview_url: 'https://demo.example.com/wedding-v2',
    notes: 'Best performing template. Reused for 3 clients so far.'
  },
  {
    name: 'Beauty Salon Booking Site', type: 'WEBSITE', niche: 'Beauty',
    description: 'Service list, price list, staff profiles and booking form.',
    version: '1.4.0', status: 'ACTIVE', reusable: true,
    preview_url: 'https://demo.example.com/salon'
  },
  {
    name: 'Barbershop Demo Kit', type: 'DEMO', niche: 'Barbershop',
    description: 'Pre-built demo used during first outreach to barbershops.',
    version: '1.0.0', status: 'ACTIVE', reusable: true
  },
  {
    name: 'Restaurant Digital Menu Component', type: 'COMPONENT', niche: 'Restaurant',
    description: 'Reusable menu component with categories, photos and price formatting.',
    version: '1.2.0', status: 'ACTIVE', reusable: true
  },
  {
    name: 'Cold Outreach WhatsApp Script', type: 'COPY', niche: 'Local Service',
    description: 'Three-message sequence: hook, value, soft close.',
    version: '3.0.0', status: 'ACTIVE', reusable: true
  },
  {
    name: 'Lead Research Prompt Pack', type: 'PROMPT', niche: 'General',
    description: 'Prompts for business research, gap analysis and offer framing.',
    version: '1.1.0', status: 'ACTIVE', reusable: true
  },
  {
    name: 'Standard Proposal Template', type: 'PROPOSAL', niche: 'General',
    description: 'Scope, deliverables, timeline, price and terms.',
    version: '2.0.0', status: 'ACTIVE', reusable: true
  },
  {
    name: 'Photo Studio Portfolio Site', type: 'WEBSITE', niche: 'Studio',
    description: 'Masonry portfolio with package pricing.',
    version: '0.9.0', status: 'DRAFT', reusable: true
  },
  {
    name: 'Picnic Event Pricing Sheet', type: 'PRICING', niche: 'Event',
    description: 'Tiered pricing for picnic/event setups.',
    version: '1.0.0', status: 'ARCHIVED', reusable: false
  }
]

const DEMO_LEADS = [
  {
    business_name: 'Dewi Wedding Organizer', category: 'Wedding Organizer', industry: 'Wedding',
    city: 'Bandung', address: 'Jl. Dago No. 45, Bandung',
    phone: '+62 812 1111 2222', email: null, website: null,
    social_url: 'https://instagram.com/dewiweddingorganizer',
    status: 'INTERESTED', priority: null, source_key: 'INSTAGRAM',
    notes: 'Strong Instagram following but no website. Asked for a demo after the second message.'
  },
  {
    business_name: 'Salon Cantika', category: 'Beauty Salon', industry: 'Beauty',
    city: 'Bandung', address: 'Jl. Sukajadi No. 12, Bandung',
    phone: '+62 813 3333 4444', email: 'salon.cantika@gmail.com', website: null,
    social_url: 'https://instagram.com/saloncantika',
    status: 'DEMO', priority: null, source_key: 'GOOGLE_MAPS',
    notes: 'Demo sent. Owner wants online booking and a price list page.'
  },
  {
    business_name: 'Barbershop Gentleman', category: 'Barbershop', industry: 'Barbershop',
    city: 'Jakarta', address: 'Jl. Kemang Raya No. 8, Jakarta',
    phone: '+62 815 5555 6666', email: null, website: null, social_url: null,
    status: 'CONTACTED', priority: null, source_key: 'GOOGLE_MAPS',
    notes: 'No digital presence at all. Highest opportunity gap.'
  },
  {
    business_name: 'Warung Sate Pak Budi', category: 'Restaurant', industry: 'Restaurant',
    city: 'Yogyakarta', address: 'Jl. Malioboro No. 100, Yogyakarta',
    phone: '+62 817 7777 8888', email: null, website: null, social_url: null,
    status: 'NEW', priority: null, source_key: 'GOOGLE_MAPS',
    notes: 'Very busy warung. Needs digital menu and Google Maps optimization.'
  },
  {
    business_name: 'Piknik Ceria Event', category: 'Event Organizer', industry: 'Event',
    city: 'Bandung', address: 'Jl. Setiabudi No. 200, Bandung',
    phone: '+62 819 9999 0000', email: 'piknikceria@gmail.com',
    website: 'https://piknikceria.wordpress.com',
    social_url: 'https://instagram.com/piknikceria',
    status: 'QUALIFIED', priority: null, source_key: 'REFERRAL',
    notes: 'Has an outdated WordPress site. Wants a proper booking site.'
  },
  {
    business_name: 'Studio Foto Kenangan', category: 'Photo Studio', industry: 'Studio',
    city: 'Surabaya', address: 'Jl. Darmo No. 55, Surabaya',
    phone: '+62 811 2222 3333', email: 'studiokenangan@gmail.com', website: null,
    social_url: 'https://instagram.com/studiofotokenangan',
    status: 'REPLIED', priority: null, source_key: 'INSTAGRAM',
    notes: 'Replied asking about pricing. Send the proposal template.'
  },
  {
    business_name: 'Laundry Kilat 24 Jam', category: 'Laundry', industry: 'Local Service',
    city: 'Bandung', address: 'Jl. Cihampelas No. 77, Bandung',
    phone: '+62 812 4444 5555', email: null, website: null, social_url: null,
    status: 'RESEARCHING', priority: null, source_key: 'GOOGLE_MAPS',
    notes: 'Three branches. Could need a multi-location page.'
  },
  {
    business_name: 'Katering Bu Sri', category: 'Catering', industry: 'Restaurant',
    city: 'Semarang', address: 'Jl. Pandanaran No. 33, Semarang',
    phone: '+62 813 6666 7777', email: 'katering.busri@gmail.com', website: null,
    social_url: null,
    status: 'NEW', priority: null, source_key: 'MANUAL',
    notes: 'Walk-in referral from a previous client.'
  },
  {
    business_name: 'Bengkel Motor Jaya', category: 'Auto Repair', industry: 'Local Service',
    city: 'Jakarta', address: 'Jl. Fatmawati No. 21, Jakarta',
    phone: '+62 815 8888 9999', email: null, website: null, social_url: null,
    status: 'NURTURE', priority: null, source_key: 'GOOGLE_MAPS',
    notes: 'Not ready this quarter. Follow up after Ramadan.'
  },
  {
    business_name: 'Toko Bunga Melati', category: 'Florist', industry: 'Wedding',
    city: 'Bandung', address: 'Jl. Riau No. 5, Bandung',
    phone: '+62 817 1111 3333', email: null, website: null,
    social_url: 'https://instagram.com/tokobungamelati',
    status: 'OFFER', priority: null, source_key: 'REFERRAL',
    notes: 'Offer sent: landing page + catalog. Waiting for decision.'
  },
  {
    business_name: 'Rias Pengantin Ayu', category: 'Bridal Makeup', industry: 'Wedding',
    city: 'Solo', address: 'Jl. Slamet Riyadi No. 90, Solo',
    phone: '+62 819 2222 4444', email: null, website: null,
    social_url: 'https://instagram.com/riaspengantinayu',
    status: 'CONTACTED', priority: null, source_key: 'INSTAGRAM',
    notes: 'First message sent, no reply yet. Follow up in 2 days.'
  },
  {
    business_name: 'Kopi Senja Coffee Shop', category: 'Coffee Shop', industry: 'Restaurant',
    city: 'Bandung', address: 'Jl. Braga No. 15, Bandung',
    phone: '+62 811 5555 7777', email: 'kopisenja@gmail.com', website: null,
    social_url: 'https://instagram.com/kopisenjabdg',
    status: 'LOST', priority: null, source_key: 'GOOGLE_MAPS',
    notes: 'Decided to keep using Instagram only. Revisit next year.'
  }
]

/* ------------------------------------------------------------------ */

export interface SeedResult {
  resources: number
  assets: number
  leads: number
  clients: number
  projects: number
  tasks: number
  opportunities: number
  offers: number
  invoices: number
  payments: number
  expenses: number
  activities: number
  notifications: number
}

/** True when the org already holds demo rows. */
export async function demoDataStatus(db: D1Database, orgId: string) {
  const counts: Record<string, number> = {}
  let total = 0
  for (const table of DEMO_TABLES) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE org_id = ? AND is_demo = 1`)
      .bind(orgId)
      .first<{ c: number }>()
    const c = Number(row?.c ?? 0)
    if (c > 0) counts[table] = c
    total += c
  }
  return { seeded: total > 0, total, counts }
}

/**
 * Seed the organization with a coherent business scenario:
 * resources → assets → leads (+activities) → clients → projects (+tasks)
 * → opportunities/offers → invoices/payments → expenses → notifications.
 */
export async function seedDemoData(
  db: D1Database,
  orgId: string,
  userId: string
): Promise<SeedResult> {
  const status = await demoDataStatus(db, orgId)
  if (status.seeded) {
    throw conflict('Demo data already exists. Purge it first if you want a fresh set.')
  }

  const result: SeedResult = {
    resources: 0, assets: 0, leads: 0, clients: 0, projects: 0, tasks: 0,
    opportunities: 0, offers: 0, invoices: 0, payments: 0, expenses: 0,
    activities: 0, notifications: 0
  }

  /* ---------------------------- LEAD SOURCES ---------------------------- */
  const sources: [string, string][] = [
    ['MANUAL', 'Manual Entry'],
    ['GOOGLE_MAPS', 'Google Maps'],
    ['INSTAGRAM', 'Instagram'],
    ['REFERRAL', 'Referral'],
    ['DISCOVERY', 'Discovery Engine'],
    ['IMPORT', 'Import']
  ]
  for (const [key, name] of sources) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO lead_sources (id, org_id, key, name) VALUES (?, ?, ?, ?)`
      )
      .bind(newId('src'), orgId, key, name)
      .run()
  }

  /* ------------------------------ RESOURCES ------------------------------ */
  const resourceIds: Record<string, string> = {}
  for (const r of DEMO_RESOURCES) {
    const id = await createResource(db, orgId, r as any, true)
    resourceIds[r.name] = id
    result.resources++
  }

  /* -------------------------------- ASSETS -------------------------------- */
  const assetIds: Record<string, string> = {}
  for (const a of DEMO_ASSETS) {
    const id = await createAsset(db, orgId, userId, a as any, true)
    assetIds[a.name] = id
    result.assets++
  }

  /* --------------------------------- LEADS --------------------------------- */
  const leadIds: Record<string, string> = {}
  for (const l of DEMO_LEADS) {
    const { id } = await createLead(db, orgId, userId, l as any, {
      isDemo: true,
      skipOnDuplicate: true
    })
    leadIds[l.business_name] = id
    result.leads++
  }

  /* ------------------------- LEAD ACTIVITY TIMELINE ------------------------- */
  const activities: {
    lead: string; type: string; description: string; outcome?: string; due_at?: string
  }[] = [
    {
      lead: 'Dewi Wedding Organizer', type: 'MESSAGE',
      description: 'Sent first WhatsApp outreach using the cold outreach script.',
      outcome: 'Read, no reply yet'
    },
    {
      lead: 'Dewi Wedding Organizer', type: 'MESSAGE',
      description: 'Follow-up message with a link to the wedding landing page demo.',
      outcome: 'Replied — interested'
    },
    {
      lead: 'Dewi Wedding Organizer', type: 'FOLLOW_UP',
      description: 'Call to discuss package options and timeline.',
      due_at: daysAhead(1)
    },
    {
      lead: 'Salon Cantika', type: 'CALL',
      description: 'Phone call with the owner about booking features.',
      outcome: 'Wants online booking + price list'
    },
    {
      lead: 'Salon Cantika', type: 'DEMO',
      description: 'Personalized demo site sent (Beauty Salon Booking Site template).',
      outcome: 'Demo opened 4 times'
    },
    {
      lead: 'Salon Cantika', type: 'FOLLOW_UP',
      description: 'Ask for the decision and send the proposal if positive.',
      due_at: daysAhead(0)
    },
    {
      lead: 'Barbershop Gentleman', type: 'MESSAGE',
      description: 'First outreach message sent via WhatsApp.',
      outcome: 'Delivered'
    },
    {
      lead: 'Barbershop Gentleman', type: 'FOLLOW_UP',
      description: 'Second touch — send the barbershop demo kit.',
      due_at: daysAhead(2)
    },
    {
      lead: 'Piknik Ceria Event', type: 'MEETING',
      description: 'Video call reviewing their current WordPress site problems.',
      outcome: 'Qualified — budget confirmed'
    },
    {
      lead: 'Studio Foto Kenangan', type: 'MESSAGE',
      description: 'Replied to their pricing question with package options.',
      outcome: 'Awaiting response'
    },
    {
      lead: 'Toko Bunga Melati', type: 'OFFER',
      description: 'Offer sent: landing page + product catalog, 2 week delivery.',
      outcome: 'Under review'
    },
    {
      lead: 'Toko Bunga Melati', type: 'FOLLOW_UP',
      description: 'Chase the offer decision.',
      due_at: daysAgo(1).slice(0, 10)
    },
    {
      lead: 'Rias Pengantin Ayu', type: 'MESSAGE',
      description: 'Cold outreach sent through Instagram DM.',
      outcome: 'No reply yet'
    },
    {
      lead: 'Laundry Kilat 24 Jam', type: 'NOTE',
      description: 'Researched: 3 branches, no website, active on Google Maps only.'
    },
    {
      lead: 'Kopi Senja Coffee Shop', type: 'NOTE',
      description: 'Closed as lost — owner prefers Instagram-only presence.'
    },
    {
      lead: 'Bengkel Motor Jaya', type: 'FOLLOW_UP',
      description: 'Re-engage after Ramadan with a maintenance-booking angle.',
      due_at: daysAhead(30)
    }
  ]
  for (const a of activities) {
    const entityId = leadIds[a.lead]
    if (!entityId) continue
    await createActivity(
      db, orgId, userId,
      {
        entity_type: 'LEAD',
        entity_id: entityId,
        type: a.type,
        description: a.description,
        outcome: a.outcome ?? null,
        due_at: a.due_at ?? null
      },
      true
    )
    result.activities++
  }

  /* -------------------------------- CLIENTS -------------------------------- */
  const clients = [
    {
      name: 'Griya Pengantin Sekar', industry: 'Wedding', city: 'Bandung',
      phone: '+62 812 7777 1111', email: 'griyasekar@gmail.com',
      website: 'https://griyasekar.pages.dev',
      status: 'ACTIVE', health: 'GOOD',
      notes: 'First paying client. Landing page + catalog delivered, now on retainer.'
    },
    {
      name: 'Klinik Kecantikan Aura', industry: 'Beauty', city: 'Jakarta',
      phone: '+62 813 8888 2222', email: 'info@klinikaura.id',
      website: 'https://klinikaura.pages.dev',
      status: 'ACTIVE', health: 'GOOD',
      notes: 'Booking site live. Wants a monthly content add-on.'
    },
    {
      name: 'Resto Nusantara Rasa', industry: 'Restaurant', city: 'Yogyakarta',
      phone: '+62 815 9999 3333', email: 'nusantararasa@gmail.com',
      status: 'ACTIVE', health: 'AT_RISK',
      notes: 'Digital menu project running late — client slow to send photos.'
    },
    {
      name: 'Barbershop Klasik', industry: 'Barbershop', city: 'Bandung',
      phone: '+62 817 1111 4444', email: null,
      status: 'PAUSED', health: 'AT_RISK',
      notes: 'Paused after phase 1. Revisit when their second branch opens.'
    }
  ]
  const clientIds: Record<string, string> = {}
  for (const cl of clients) {
    const id = await createClient(db, orgId, userId, cl as any, true)
    clientIds[cl.name] = id
    result.clients++
  }

  await createActivity(
    db, orgId, userId,
    {
      entity_type: 'CLIENT',
      entity_id: clientIds['Resto Nusantara Rasa'],
      type: 'CALL',
      description: 'Called about the missing menu photos blocking delivery.',
      outcome: 'Promised photos this week',
      due_at: daysAhead(1)
    },
    true
  )
  result.activities++

  /* ------------------------------- PROJECTS ------------------------------- */
  const projects = [
    {
      key: 'sekar-retainer',
      name: 'Griya Sekar — Website Retainer Q3',
      client: 'Griya Pengantin Sekar', type: 'RETAINER',
      status: 'IN_PROGRESS', progress: 60,
      start_date: daysAgo(40).slice(0, 10), due_date: daysAhead(20),
      value: 4_500_000,
      notes: 'Monthly content updates, gallery refresh and performance tuning.'
    },
    {
      key: 'aura-booking',
      name: 'Klinik Aura — Booking Site',
      client: 'Klinik Kecantikan Aura', type: 'WEBSITE',
      status: 'DELIVERED', progress: 100,
      start_date: daysAgo(70).slice(0, 10), due_date: daysAgo(30).slice(0, 10),
      value: 7_500_000,
      notes: 'Delivered and paid in full. Source of the salon booking template.'
    },
    {
      key: 'nusantara-menu',
      name: 'Nusantara Rasa — Digital Menu',
      client: 'Resto Nusantara Rasa', type: 'WEBSITE',
      status: 'IN_PROGRESS', progress: 35,
      start_date: daysAgo(25).slice(0, 10), due_date: daysAgo(3).slice(0, 10),
      value: 5_000_000,
      notes: 'Overdue — waiting on client photos.'
    },
    {
      key: 'klasik-phase1',
      name: 'Barbershop Klasik — Phase 1 Landing',
      client: 'Barbershop Klasik', type: 'LANDING_PAGE',
      status: 'ON_HOLD', progress: 80,
      start_date: daysAgo(60).slice(0, 10), due_date: daysAhead(45),
      value: 3_000_000,
      notes: 'On hold at client request.'
    }
  ]
  const projectIds: Record<string, string> = {}
  for (const p of projects) {
    const id = await createProject(
      db, orgId, userId,
      { ...p, client_id: clientIds[p.client] } as any,
      true
    )
    projectIds[p.key] = id
    result.projects++
  }

  /* --------------------------------- TASKS --------------------------------- */
  const tasks = [
    { project: 'sekar-retainer', title: 'Refresh the wedding gallery with August photos', status: 'DOING', priority: 'HIGH', due_date: daysAhead(3) },
    { project: 'sekar-retainer', title: 'Add testimonial section', status: 'TODO', priority: 'MEDIUM', due_date: daysAhead(10) },
    { project: 'sekar-retainer', title: 'Compress hero images for mobile', status: 'DONE', priority: 'MEDIUM' },
    { project: 'nusantara-menu', title: 'Collect menu photos from client', status: 'BLOCKED', priority: 'HIGH', due_date: daysAgo(2).slice(0, 10) },
    { project: 'nusantara-menu', title: 'Build the digital menu component', status: 'DOING', priority: 'HIGH', due_date: daysAhead(5) },
    { project: 'nusantara-menu', title: 'Set up the Google Business profile link', status: 'TODO', priority: 'LOW', due_date: daysAhead(12) },
    { project: 'aura-booking', title: 'Handover documentation', status: 'DONE', priority: 'MEDIUM' },
    { project: 'aura-booking', title: 'Train staff on the booking dashboard', status: 'DONE', priority: 'MEDIUM' },
    { project: 'klasik-phase1', title: 'Finalize the pricing table copy', status: 'TODO', priority: 'LOW' }
  ]
  for (const t of tasks) {
    const projectId = projectIds[t.project]
    if (!projectId) continue
    await createTask(db, orgId, { ...t, project_id: projectId } as any, true)
    result.tasks++
  }

  await createActivity(
    db, orgId, userId,
    {
      entity_type: 'PROJECT',
      entity_id: projectIds['nusantara-menu'],
      type: 'NOTE',
      description: 'Delivery blocked by missing assets. Deadline renegotiation needed.'
    },
    true
  )
  result.activities++

  /* ----------------------------- OPPORTUNITIES ----------------------------- */
  const opportunities = [
    {
      title: 'Salon Cantika — Booking Website',
      lead_id: leadIds['Salon Cantika'],
      stage: 'PROPOSAL', value: 6_500_000, probability: 60,
      expected_at: daysAhead(14),
      notes: 'Demo delivered, proposal next.'
    },
    {
      title: 'Dewi Wedding Organizer — Landing Page',
      lead_id: leadIds['Dewi Wedding Organizer'],
      stage: 'QUALIFYING', value: 5_000_000, probability: 40,
      expected_at: daysAhead(21),
      notes: 'Interested, discussing packages.'
    },
    {
      title: 'Toko Bunga Melati — Catalog Site',
      lead_id: leadIds['Toko Bunga Melati'],
      stage: 'NEGOTIATION', value: 4_000_000, probability: 70,
      expected_at: daysAhead(7),
      notes: 'Offer under review, small discount requested.'
    },
    {
      title: 'Piknik Ceria — Booking Platform',
      lead_id: leadIds['Piknik Ceria Event'],
      stage: 'DISCOVERY', value: 9_000_000, probability: 25,
      expected_at: daysAhead(45),
      notes: 'Largest potential deal in the pipeline.'
    }
  ]
  for (const o of opportunities) {
    await createOpportunity(db, orgId, userId, o as any, true)
    result.opportunities++
  }

  /* -------------------------------- OFFERS -------------------------------- */
  const offers = [
    {
      title: 'Toko Bunga Melati — Landing + Catalog',
      lead_id: leadIds['Toko Bunga Melati'],
      package: 'Starter Site + Product Catalog',
      price: 4_000_000, status: 'SENT', valid_until: daysAhead(7),
      notes: 'Includes 1 month of free content updates.'
    },
    {
      title: 'Salon Cantika — Booking Site Package',
      lead_id: leadIds['Salon Cantika'],
      package: 'Booking Site (Beauty template)',
      price: 6_500_000, status: 'DRAFT', valid_until: daysAhead(14),
      notes: 'Draft based on the beauty salon template.'
    },
    {
      title: 'Studio Foto Kenangan — Portfolio Site',
      lead_id: leadIds['Studio Foto Kenangan'],
      package: 'Portfolio Site',
      price: 4_500_000, status: 'VIEWED', valid_until: daysAhead(10),
      notes: 'Viewed twice, no reply yet.'
    }
  ]
  for (const o of offers) {
    await createOffer(db, orgId, o as any, true)
    result.offers++
  }

  /* --------------------------------- MONEY --------------------------------- */
  const auraInvoice = await createInvoice(
    db, orgId,
    {
      client_id: clientIds['Klinik Kecantikan Aura'],
      project_id: projectIds['aura-booking'],
      number: 'INV-DEMO-0001',
      amount: 7_500_000, status: 'SENT',
      issued_at: daysAgo(45).slice(0, 10), due_at: daysAgo(30).slice(0, 10),
      notes: 'Booking site — full payment.'
    },
    true
  )
  result.invoices++

  const sekarInvoice = await createInvoice(
    db, orgId,
    {
      client_id: clientIds['Griya Pengantin Sekar'],
      project_id: projectIds['sekar-retainer'],
      number: 'INV-DEMO-0002',
      amount: 4_500_000, status: 'SENT',
      issued_at: daysAgo(35).slice(0, 10), due_at: daysAgo(5).slice(0, 10),
      notes: 'Retainer Q3 — 50% upfront.'
    },
    true
  )
  result.invoices++

  const nusantaraInvoice = await createInvoice(
    db, orgId,
    {
      client_id: clientIds['Resto Nusantara Rasa'],
      project_id: projectIds['nusantara-menu'],
      number: 'INV-DEMO-0003',
      amount: 5_000_000, status: 'SENT',
      issued_at: daysAgo(20).slice(0, 10), due_at: daysAhead(10),
      notes: 'Digital menu — 50% deposit.'
    },
    true
  )
  result.invoices++

  // Aura paid in full → recordPayment flips the invoice to PAID.
  await recordPayment(
    db, orgId,
    {
      invoice_id: auraInvoice,
      client_id: clientIds['Klinik Kecantikan Aura'],
      amount: 7_500_000, method: 'BANK_TRANSFER', reference: 'TRF-AURA-001',
      paid_at: daysAgo(32)
    },
    true
  )
  result.payments++

  // Sekar paid half → invoice becomes PARTIAL, remainder stays outstanding.
  await recordPayment(
    db, orgId,
    {
      invoice_id: sekarInvoice,
      client_id: clientIds['Griya Pengantin Sekar'],
      amount: 2_250_000, method: 'BANK_TRANSFER', reference: 'TRF-SEKAR-001',
      paid_at: daysAgo(30)
    },
    true
  )
  result.payments++

  // A payment inside the current month so month-to-date revenue is non-zero.
  await recordPayment(
    db, orgId,
    {
      invoice_id: nusantaraInvoice,
      client_id: clientIds['Resto Nusantara Rasa'],
      amount: 2_500_000, method: 'QRIS', reference: 'QR-NUSA-001',
      paid_at: daysAgo(4)
    },
    true
  )
  result.payments++

  const expenses = [
    { description: 'Genspark subscription', amount: 300_000, category: 'TOOL', resource: 'Genspark', recurring: 'MONTHLY', spent_at: daysAgo(6) },
    { description: 'Canva Pro subscription', amount: 130_000, category: 'TOOL', resource: 'Canva Pro', recurring: 'MONTHLY', spent_at: daysAgo(6) },
    { description: 'Domain renewal sparkmind.id', amount: 240_000, category: 'OPS', resource: 'sparkmind.id domain', recurring: 'YEARLY', spent_at: daysAgo(50) },
    { description: 'Instagram ads test — wedding niche', amount: 500_000, category: 'MARKETING', recurring: 'NONE', spent_at: daysAgo(12) },
    { description: 'Stock photo pack for demos', amount: 150_000, category: 'OPS', recurring: 'NONE', spent_at: daysAgo(3) }
  ]
  for (const e of expenses) {
    await createExpense(
      db, orgId,
      {
        description: e.description,
        amount: e.amount,
        category: e.category,
        resource_id: e.resource ? resourceIds[e.resource] ?? null : null,
        recurring: e.recurring,
        spent_at: e.spent_at
      },
      true
    )
    result.expenses++
  }

  /* ----------------------- ASSET REVENUE ATTRIBUTION ----------------------- */
  const usages: { asset: string; entity_type: string; entity_id: string; revenue: number; notes: string }[] = [
    {
      asset: 'Beauty Salon Booking Site',
      entity_type: 'PROJECT', entity_id: projectIds['aura-booking'],
      revenue: 7_500_000, notes: 'Template reused for Klinik Aura delivery.'
    },
    {
      asset: 'Wedding Organizer Landing Page v2',
      entity_type: 'PROJECT', entity_id: projectIds['sekar-retainer'],
      revenue: 4_500_000, notes: 'Base template for the Griya Sekar retainer.'
    },
    {
      asset: 'Restaurant Digital Menu Component',
      entity_type: 'PROJECT', entity_id: projectIds['nusantara-menu'],
      revenue: 2_500_000, notes: 'Menu component reused for Nusantara Rasa.'
    },
    {
      asset: 'Cold Outreach WhatsApp Script',
      entity_type: 'LEAD', entity_id: leadIds['Barbershop Gentleman'],
      revenue: 0, notes: 'Used for the first outreach message.'
    },
    {
      asset: 'Barbershop Demo Kit',
      entity_type: 'LEAD', entity_id: leadIds['Salon Cantika'],
      revenue: 0, notes: 'Adapted into the salon demo.'
    }
  ]
  for (const u of usages) {
    const assetId = assetIds[u.asset]
    if (!assetId || !u.entity_id) continue
    await db
      .prepare(
        `INSERT INTO asset_usage (id, org_id, asset_id, entity_type, entity_id, revenue, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(newId('asu'), orgId, assetId, u.entity_type, u.entity_id, u.revenue, u.notes)
      .run()
    await db
      .prepare(
        `UPDATE assets SET usage_count = usage_count + 1,
                           revenue_attributed = revenue_attributed + ?,
                           updated_at = datetime('now')
         WHERE id = ? AND org_id = ?`
      )
      .bind(u.revenue, assetId, orgId)
      .run()
  }

  /* ----------------------------- NOTIFICATIONS ----------------------------- */
  const notifications = [
    {
      type: 'REMINDER', severity: 'HIGH',
      title: 'Follow-up due today',
      message: 'Salon Cantika is waiting for the proposal after the demo.',
      entityType: 'LEAD', entityId: leadIds['Salon Cantika']
    },
    {
      type: 'WARNING', severity: 'HIGH',
      title: 'Project past due date',
      message: 'Nusantara Rasa — Digital Menu is overdue and blocked on client assets.',
      entityType: 'PROJECT', entityId: projectIds['nusantara-menu']
    },
    {
      type: 'SUCCESS', severity: 'LOW',
      title: 'Payment received',
      message: 'Rp 2.500.000 received from Resto Nusantara Rasa.',
      entityType: 'CLIENT', entityId: clientIds['Resto Nusantara Rasa']
    },
    {
      type: 'INFO', severity: 'MEDIUM',
      title: 'Offer awaiting decision',
      message: 'Toko Bunga Melati has not responded to the offer yet.',
      entityType: 'LEAD', entityId: leadIds['Toko Bunga Melati']
    }
  ]
  for (const n of notifications) {
    await notify(db, orgId, { userId, ...n } as any, true)
    result.notifications++
  }

  return result
}

/** Remove every demo row for this organization. Real data is untouched. */
export async function purgeDemoData(db: D1Database, orgId: string) {
  const deleted: Record<string, number> = {}
  for (const table of DEMO_TABLES) {
    const res = await db
      .prepare(`DELETE FROM ${table} WHERE org_id = ? AND is_demo = 1`)
      .bind(orgId)
      .run()
    const count = Number(res.meta?.changes ?? 0)
    if (count > 0) deleted[table] = count
  }
  // asset_usage / lead_scores have no is_demo flag; they cascade with their parent
  // rows, so nothing is left behind for the deleted demo assets and leads.
  return { purged: true, deleted }
}
