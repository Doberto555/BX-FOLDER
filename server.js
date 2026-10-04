import 'dotenv/config'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

const PORT = Number.parseInt(process.env.PORT || '3000', 10)
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim()
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim()
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim()
const ADMIN_SESSION_SECRET = String(process.env.ADMIN_SESSION_SECRET || ADMIN_TOKEN || '').trim()
const GROUP_URL = String(process.env.GROUP_URL || '').trim()
const MAX_REGISTRATIONS = Math.min(50000, Math.max(1, Number.parseInt(process.env.MAX_REGISTRATIONS || '50000', 10)))
const CONTACT_PREFIX = String(process.env.CONTACT_PREFIX || 'BX').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'BX'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[BX FOLDER] Supabase configuration missing')
}

const supabase = createClient(SUPABASE_URL || 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY || 'missing', {
  auth: { persistSession: false, autoRefreshToken: false }
})

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }))
app.use(cors({ origin: true, credentials: false }))
app.use(express.json({ limit: '80kb' }))
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  setHeaders(res, filePath) {
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, max-age=0')
    }
  }
}))

const clean = value => String(value ?? '').trim()
const normalizeSurname = value => clean(value).replace(/\s+/g, ' ').replace(/[<>]/g, '').slice(0, 60)
const normalizePhone = value => String(value ?? '').replace(/\D/g, '').slice(0, 15)
const normalizeCountry = value => clean(value).replace(/\s+/g, ' ').replace(/[<>]/g, '').slice(0, 80)

function validGroupUrl(value = '') {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'chat.whatsapp.com'
  } catch {
    return false
  }
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '')
    .split(',')[0].trim().slice(0, 120) || 'unknown'
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''))
  const bb = Buffer.from(String(b || ''))
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb)
}

function signAdminSession(email) {
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Date.now() + 12 * 60 * 60 * 1000
  })).toString('base64url')
  const sig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyAdminSession(token) {
  try {
    if (!ADMIN_SESSION_SECRET || !token?.includes('.')) return false
    const [payload, sig] = token.split('.')
    const expected = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('base64url')
    if (!safeEqual(sig, expected)) return false
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return Number(parsed.exp) > Date.now() && (!ADMIN_EMAIL || parsed.email === ADMIN_EMAIL)
  } catch {
    return false
  }
}

function adminOnly(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-admin-token'] || '')
  if (verifyAdminSession(token) || (ADMIN_TOKEN && safeEqual(token, ADMIN_TOKEN))) return next()
  return res.status(401).json({ ok: false, error: 'Unauthorized' })
}

async function rateLimit(bucket, identity, seconds, limit) {
  const { data, error } = await supabase.rpc('bx_rate_limit_hit', {
    p_bucket: bucket,
    p_identity: identity,
    p_window_seconds: seconds,
    p_limit: limit
  })
  if (error) {
    console.warn('[rate-limit]', error.message)
    return true
  }
  return data !== false
}

async function registrationCount() {
  const { count, error } = await supabase.from('bx_registrations').select('id', { count: 'exact', head: true })
  if (error) throw error
  return Number(count || 0)
}

async function maintenanceSetting() {
  const { data, error } = await supabase.from('bx_settings').select('value').eq('key', 'maintenance').maybeSingle()
  if (error) throw error
  return {
    enabled: Boolean(data?.value?.enabled),
    message: clean(data?.value?.message || 'BX FOLDER est temporairement en maintenance.')
  }
}

async function activeGroupCount() {
  const { count, error } = await supabase.from('bx_groups').select('id', { count: 'exact', head: true }).eq('enabled', true)
  if (error) return 0
  return Number(count || 0)
}

app.post('/api/admin/login', async (req, res) => {
  const allowed = await rateLimit('admin-login', clientIp(req), 900, 8)
  if (!allowed) return res.status(429).json({ ok: false, error: 'Trop de tentatives. Réessaie plus tard.' })

  const email = clean(req.body?.email).toLowerCase()
  const password = clean(req.body?.password)
  const configured = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD && ADMIN_SESSION_SECRET)

  if (!configured) {
    if (ADMIN_TOKEN && safeEqual(password, ADMIN_TOKEN)) {
      return res.json({ ok: true, token: signAdminSession(email || 'owner@bx.local'), expiresIn: 43200 })
    }
    return res.status(503).json({ ok: false, error: 'Admin login is not configured' })
  }

  if (!safeEqual(email, ADMIN_EMAIL) || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'Email ou mot de passe incorrect.' })
  }

  res.json({ ok: true, token: signAdminSession(email), expiresIn: 43200 })
})

app.get('/api/config', async (_req, res) => {
  try {
    const [total, maintenance, groups] = await Promise.all([
      registrationCount(),
      maintenanceSetting(),
      activeGroupCount()
    ])
    res.set('Cache-Control', 'no-store')
    res.json({
      ok: true,
      name: 'BX FOLDER',
      prefix: CONTACT_PREFIX,
      total,
      max: MAX_REGISTRATIONS,
      remaining: Math.max(0, MAX_REGISTRATIONS - total),
      maintenance,
      groupConfigured: groups > 0 || validGroupUrl(GROUP_URL)
    })
  } catch {
    res.status(503).json({ ok: false, error: 'Database unavailable' })
  }
})

app.post('/api/register', async (req, res) => {
  try {
    if (!(await rateLimit('register', clientIp(req), 600, 6))) {
      return res.status(429).json({ ok: false, error: 'Trop de tentatives. Réessaie dans quelques minutes.' })
    }

    const maintenance = await maintenanceSetting()
    if (maintenance.enabled) {
      return res.status(503).json({ ok: false, error: maintenance.message, code: 'MAINTENANCE' })
    }

    const surname = normalizeSurname(req.body?.surname)
    const phone = normalizePhone(req.body?.phone)
    const sex = clean(req.body?.sex).toLowerCase()
    const country = normalizeCountry(req.body?.country)
    const consentVcf = req.body?.consentVcf === true

    if (surname.length < 2) return res.status(400).json({ ok: false, error: 'Entre un surnom valide.' })
    if (!/^\d{8,15}$/.test(phone)) return res.status(400).json({ ok: false, error: 'Entre le numéro complet avec indicatif pays.' })
    if (!['male', 'female'].includes(sex)) return res.status(400).json({ ok: false, error: 'Choisis ton sexe.' })
    if (country.length < 2) return res.status(400).json({ ok: false, error: 'Choisis ton pays.' })
    if (!consentVcf) return res.status(400).json({ ok: false, error: 'Accepte le partage VCF pour continuer.' })

    const total = await registrationCount()
    if (total >= MAX_REGISTRATIONS) {
      return res.status(409).json({ ok: false, error: 'BX FOLDER est complet.', code: 'CAPACITY_REACHED' })
    }

    const displayName = `${CONTACT_PREFIX} ${surname}`.trim()
    const { data, error } = await supabase
      .from('bx_registrations')
      .insert({ surname, display_name: displayName, phone, sex, country, consent_vcf: true })
      .select('id, display_name, phone, created_at')
      .single()

    if (error) {
      if (String(error.code) === '23505') {
        return res.status(409).json({ ok: false, error: 'Ce numéro est déjà inscrit.', code: 'ALREADY_REGISTERED' })
      }
      if (String(error.message || '').includes('BX_FOLDER_CAPACITY_REACHED')) {
        return res.status(409).json({ ok: false, error: 'BX FOLDER est complet.', code: 'CAPACITY_REACHED' })
      }
      throw error
    }

    let group = null
    const assigned = await supabase.rpc('bx_assign_group')
    if (!assigned.error && Array.isArray(assigned.data) && assigned.data[0]) {
      group = assigned.data[0]
      await supabase.from('bx_registrations').update({ group_id: group.id }).eq('id', data.id)
    } else if (validGroupUrl(GROUP_URL)) {
      group = { name: 'Groupe BX FOLDER', url: GROUP_URL }
    }

    res.status(201).json({ ok: true, registration: data, group })
  } catch (error) {
    console.error('[register]', error?.message || error)
    res.status(500).json({ ok: false, error: 'Inscription impossible. Réessaie.' })
  }
})

app.post('/api/removal-request', async (req, res) => {
  try {
    if (!(await rateLimit('removal', clientIp(req), 3600, 3))) {
      return res.status(429).json({ ok: false, error: 'Trop de demandes. Réessaie plus tard.' })
    }
    const phone = normalizePhone(req.body?.phone)
    const reason = clean(req.body?.reason).replace(/[<>]/g, '').slice(0, 300)
    if (!/^\d{8,15}$/.test(phone)) return res.status(400).json({ ok: false, error: 'Numéro invalide.' })
    const { error } = await supabase.from('bx_removal_requests').insert({ phone, reason })
    if (error) throw error
    res.status(201).json({ ok: true })
  } catch (error) {
    console.error('[removal-request]', error?.message || error)
    res.status(500).json({ ok: false, error: 'Impossible d’envoyer la demande.' })
  }
})

function maskPublicDisplayName(value = '') {
  const raw = clean(value)
  const prefix = raw.toUpperCase().startsWith(CONTACT_PREFIX.toUpperCase() + ' ')
    ? CONTACT_PREFIX + ' '
    : ''
  const base = prefix ? raw.slice(prefix.length).trim() : raw
  if (!base) return CONTACT_PREFIX
  const first = base.charAt(0).toUpperCase()
  return `${CONTACT_PREFIX} ${first}${'•'.repeat(Math.min(5, Math.max(2, base.length - 1)))}`
}

app.get('/api/members', async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(48, Math.max(12, Number.parseInt(String(req.query.limit || '24'), 10) || 24))
    const sex = ['male', 'female'].includes(clean(req.query.sex)) ? clean(req.query.sex) : ''
    const country = normalizeCountry(req.query.country)
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from('bx_registrations')
      .select('id, display_name, sex, country, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (sex) query = query.eq('sex', sex)
    if (country) query = query.eq('country', country)

    const { data, count, error } = await query
    if (error) throw error

    const rows = (data || []).map(row => ({
      id: row.id,
      display_name: maskPublicDisplayName(row.display_name),
      sex: row.sex,
      country: row.country,
      created_at: row.created_at
    }))

    res.set('Cache-Control', 'no-store')
    res.json({ ok: true, page, limit, total: Number(count || 0), rows })
  } catch (error) {
    console.error('[public members]', error?.message || error)
    res.status(500).json({ ok: false, error: 'Impossible de charger les membres.' })
  }
})

app.get('/api/admin/overview', adminOnly, async (_req, res) => {
  try {
    const [{ data: statsData, error: statsError }, { data: recent, error: recentError }, { data: groups, error: groupsError }, maintenance] = await Promise.all([
      supabase.rpc('bx_admin_stats'),
      supabase.from('bx_registrations').select('id, surname, display_name, phone, sex, country, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('bx_groups').select('id, name, url, capacity, assigned_count, enabled, priority, created_at').order('priority', { ascending: true }).order('id', { ascending: true }),
      maintenanceSetting()
    ])
    if (statsError || recentError || groupsError) throw statsError || recentError || groupsError
    const total = Number(statsData?.total || 0)

    res.set('Cache-Control', 'no-store')
    res.json({
      ok: true,
      stats: {
        total,
        male: Number(statsData?.male || 0),
        female: Number(statsData?.female || 0),
        today: Number(statsData?.today || 0),
        last7: Number(statsData?.last7 || 0),
        countries: Array.isArray(statsData?.countries) ? statsData.countries : [],
        max: MAX_REGISTRATIONS,
        remaining: Math.max(0, MAX_REGISTRATIONS - total),
        percent: Math.min(100, Number(((total / MAX_REGISTRATIONS) * 100).toFixed(2)))
      },
      prefix: CONTACT_PREFIX,
      recent: recent || [],
      groups: groups || [],
      maintenance,
      exportChunkSize: 5000,
      exportParts: Math.max(1, Math.ceil(total / 5000))
    })
  } catch (error) {
    console.error('[admin overview]', error?.message || error)
    res.status(503).json({ ok: false, error: 'Impossible de charger le dashboard.' })
  }
})

app.get('/api/admin/members', adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(100, Math.max(10, Number.parseInt(String(req.query.limit || '25'), 10) || 25))
    const q = clean(req.query.q).replace(/[,%()]/g, '').slice(0, 80)
    const sex = ['male', 'female'].includes(clean(req.query.sex)) ? clean(req.query.sex) : ''
    const country = normalizeCountry(req.query.country)
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from('bx_registrations')
      .select('id, display_name, phone, sex, country, created_at, group_id', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (q) query = query.or(`display_name.ilike.%${q}%,phone.ilike.%${q}%,country.ilike.%${q}%`)
    if (sex) query = query.eq('sex', sex)
    if (country) query = query.eq('country', country)

    const { data, count, error } = await query
    if (error) throw error
    res.json({ ok: true, page, limit, total: Number(count || 0), rows: data || [] })
  } catch (error) {
    console.error('[members]', error?.message || error)
    res.status(500).json({ ok: false, error: 'Recherche impossible.' })
  }
})

app.post('/api/admin/groups', adminOnly, async (req, res) => {
  try {
    const name = clean(req.body?.name).replace(/[<>]/g, '').slice(0, 80)
    const url = clean(req.body?.url)
    const capacity = Math.min(100000, Math.max(1, Number.parseInt(req.body?.capacity || '1024', 10)))
    const priority = Math.min(9999, Math.max(0, Number.parseInt(req.body?.priority || '100', 10)))
    if (name.length < 2 || !validGroupUrl(url)) return res.status(400).json({ ok: false, error: 'Nom ou lien WhatsApp invalide.' })
    const { data, error } = await supabase.from('bx_groups').insert({ name, url, capacity, priority, enabled: true }).select('*').single()
    if (error) throw error
    res.status(201).json({ ok: true, group: data })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || 'Impossible d’ajouter le groupe.') })
  }
})

app.patch('/api/admin/groups/:id', adminOnly, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10)
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'ID invalide.' })
    const patch = {}
    if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled
    if (req.body?.name != null) patch.name = clean(req.body.name).replace(/[<>]/g, '').slice(0, 80)
    if (req.body?.capacity != null) patch.capacity = Math.min(100000, Math.max(1, Number.parseInt(req.body.capacity, 10) || 1))
    if (req.body?.priority != null) patch.priority = Math.min(9999, Math.max(0, Number.parseInt(req.body.priority, 10) || 0))
    if (req.body?.url != null) {
      if (!validGroupUrl(req.body.url)) return res.status(400).json({ ok: false, error: 'Lien WhatsApp invalide.' })
      patch.url = clean(req.body.url)
    }
    const { data, error } = await supabase.from('bx_groups').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    res.json({ ok: true, group: data })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || 'Mise à jour impossible.') })
  }
})

app.patch('/api/admin/maintenance', adminOnly, async (req, res) => {
  try {
    const value = {
      enabled: req.body?.enabled === true,
      message: clean(req.body?.message || 'BX FOLDER est temporairement en maintenance.').replace(/[<>]/g, '').slice(0, 180)
    }
    const { error } = await supabase.from('bx_settings').upsert({ key: 'maintenance', value, updated_at: new Date().toISOString() })
    if (error) throw error
    res.json({ ok: true, maintenance: value })
  } catch {
    res.status(500).json({ ok: false, error: 'Impossible de modifier la maintenance.' })
  }
})

app.get('/api/admin/removal-requests', adminOnly, async (_req, res) => {
  const { data, error } = await supabase.from('bx_removal_requests').select('*').order('created_at', { ascending: false }).limit(100)
  if (error) return res.status(500).json({ ok: false, error: 'Impossible de charger les demandes.' })
  res.json({ ok: true, rows: data || [] })
})

app.patch('/api/admin/removal-requests/:id', adminOnly, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10)
    const status = clean(req.body?.status)
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ ok: false, error: 'Statut invalide.' })

    const { data: requestRow, error: requestError } = await supabase.from('bx_removal_requests').select('*').eq('id', id).single()
    if (requestError) throw requestError

    if (status === 'approved') {
      const { error: deleteError } = await supabase.from('bx_registrations').delete().eq('phone', requestRow.phone)
      if (deleteError) throw deleteError
    }

    const { error } = await supabase.from('bx_removal_requests').update({ status }).eq('id', id)
    if (error) throw error
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message || 'Action impossible.') })
  }
})

function escapeVCard(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
}

async function exportRows(offset, limit) {
  const rows = []
  const pageSize = 1000
  const endExclusive = offset + limit
  for (let from = offset; from < endExclusive; from += pageSize) {
    const to = Math.min(from + pageSize - 1, endExclusive - 1)
    const { data, error } = await supabase
      .from('bx_registrations')
      .select('id, display_name, phone, sex, country, created_at')
      .eq('consent_vcf', true)
      .order('id', { ascending: true })
      .range(from, to)
    if (error) throw error
    if (!data?.length) break
    rows.push(...data)
    if (data.length < (to - from + 1)) break
  }
  return rows
}

app.get('/api/admin/download-vcf', adminOnly, async (req, res) => {
  try {
    const offset = Math.max(0, Math.min(MAX_REGISTRATIONS - 1, Number.parseInt(String(req.query.offset || '0'), 10) || 0))
    const requested = Number.parseInt(String(req.query.limit || MAX_REGISTRATIONS), 10) || MAX_REGISTRATIONS
    const limit = Math.max(1, Math.min(MAX_REGISTRATIONS - offset, requested))
    const rows = await exportRows(offset, limit)
    const vcf = rows.map(row => [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${escapeVCard(row.display_name)}`,
      `N:${escapeVCard(row.display_name)};;;;`,
      `TEL;TYPE=CELL:+${row.phone}`,
      'END:VCARD'
    ].join('\r\n')).join('\r\n') + (rows.length ? '\r\n' : '')
    const date = new Date().toISOString().slice(0, 10)
    const suffix = offset === 0 && limit >= MAX_REGISTRATIONS ? '' : `-PART-${Math.floor(offset / 5000) + 1}`
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="BX-FOLDER${suffix}-${date}.vcf"`)
    res.setHeader('X-BX-VCF-Contacts', String(rows.length))
    res.setHeader('Cache-Control', 'no-store')
    res.send(vcf)
  } catch (error) {
    console.error('[vcf]', error?.message || error)
    res.status(500).json({ ok: false, error: 'Impossible de générer le VCF.' })
  }
})

app.get('/api/admin/download-csv', adminOnly, async (_req, res) => {
  try {
    const rows = await exportRows(0, MAX_REGISTRATIONS)
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [
      ['id','display_name','phone','sex','country','created_at'].join(','),
      ...rows.map(r => [r.id, r.display_name, '+' + r.phone, r.sex, r.country, r.created_at].map(esc).join(','))
    ].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="BX-FOLDER-${new Date().toISOString().slice(0,10)}.csv"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send('\ufeff' + csv)
  } catch {
    res.status(500).json({ ok: false, error: 'Impossible de générer le CSV.' })
  }
})

app.get('/health', (_req, res) => res.json({ ok: true, service: 'BX FOLDER', maxRegistrations: MAX_REGISTRATIONS }))
app.get('/members', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'public-members.html')))
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')))
app.get('/admin/members', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'members.html')))
app.get('/privacy', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')))
app.get('/terms', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')))
app.get('/remove', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'remove.html')))
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }))

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => console.log(`BX FOLDER running on http://0.0.0.0:${PORT}`))
}

export default app
