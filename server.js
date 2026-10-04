import 'dotenv/config'
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
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim()
const GROUP_URL = String(process.env.GROUP_URL || 'https://chat.whatsapp.com/J2Ewhgf22Jd2RZguLvjTHR').trim()
const MAX_REGISTRATIONS = Math.min(50000, Math.max(1, Number.parseInt(process.env.MAX_REGISTRATIONS || '50000', 10)))
const CONTACT_PREFIX = String(process.env.CONTACT_PREFIX || 'BX').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'BX'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[BX FOLDER] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
}

const supabase = createClient(SUPABASE_URL || 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY || 'missing', {
  auth: { persistSession: false, autoRefreshToken: false }
})

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }))
app.use(cors({ origin: true, credentials: false }))
app.use(express.json({ limit: '80kb' }))
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '10m', etag: true }))

function normalizeSurname(value = '') {
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, '')
    .slice(0, 60)
}

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').slice(0, 15)
}

function normalizeCountry(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').replace(/[<>]/g, '').slice(0, 80)
}

function validGroupUrl(value = '') {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'chat.whatsapp.com'
  } catch {
    return false
  }
}

function adminOnly(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ ok: false, error: 'ADMIN_TOKEN is not configured' })
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-admin-token'] || '')
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized' })
  next()
}

async function registrationCount() {
  const { count, error } = await supabase
    .from('bx_registrations')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return Number(count || 0)
}

app.get('/api/config', async (_req, res) => {
  try {
    const total = await registrationCount()
    res.set('Cache-Control', 'no-store')
    res.json({
      ok: true,
      name: 'BX FOLDER',
      prefix: CONTACT_PREFIX,
      total,
      max: MAX_REGISTRATIONS,
      remaining: Math.max(0, MAX_REGISTRATIONS - total),
      groupConfigured: validGroupUrl(GROUP_URL)
    })
  } catch {
    res.status(503).json({ ok: false, error: 'Database unavailable' })
  }
})

app.post('/api/register', async (req, res) => {
  try {
    const surname = normalizeSurname(req.body?.surname)
    const phone = normalizePhone(req.body?.phone)
    const sex = String(req.body?.sex || '').trim().toLowerCase()
    const country = normalizeCountry(req.body?.country)
    const consentVcf = req.body?.consentVcf === true

    if (surname.length < 2) return res.status(400).json({ ok: false, error: 'Enter a valid surname' })
    if (!/^\d{8,15}$/.test(phone)) return res.status(400).json({ ok: false, error: 'Enter the full phone number with country code' })
    if (!['male', 'female'].includes(sex)) return res.status(400).json({ ok: false, error: 'Choose a gender' })
    if (country.length < 2) return res.status(400).json({ ok: false, error: 'Choose a country' })
    if (!consentVcf) return res.status(400).json({ ok: false, error: 'You must accept VCF contact sharing' })

    const total = await registrationCount()
    if (total >= MAX_REGISTRATIONS) {
      return res.status(409).json({ ok: false, error: 'BX FOLDER is full', code: 'CAPACITY_REACHED' })
    }

    const displayName = `${CONTACT_PREFIX} ${surname}`.trim()
    const { data, error } = await supabase
      .from('bx_registrations')
      .insert({ surname, display_name: displayName, phone, sex, country, consent_vcf: true })
      .select('id, display_name, phone, created_at')
      .single()

    if (error) {
      if (String(error.code) === '23505') {
        return res.status(409).json({ ok: false, error: 'This number is already registered', code: 'ALREADY_REGISTERED' })
      }
      if (String(error.message || '').includes('BX_FOLDER_CAPACITY_REACHED')) {
        return res.status(409).json({ ok: false, error: 'BX FOLDER is full', code: 'CAPACITY_REACHED' })
      }
      throw error
    }

    res.status(201).json({
      ok: true,
      registration: data,
      groupUrl: validGroupUrl(GROUP_URL) ? GROUP_URL : ''
    })
  } catch (error) {
    console.error('[register]', error?.message || error)
    res.status(500).json({ ok: false, error: 'Registration failed. Try again.' })
  }
})

app.get('/api/admin/overview', adminOnly, async (_req, res) => {
  try {
    const total = await registrationCount()
    const { data, error } = await supabase
      .from('bx_registrations')
      .select('id, surname, display_name, phone, sex, country, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error

    res.set('Cache-Control', 'no-store')
    res.json({
      ok: true,
      stats: {
        total,
        max: MAX_REGISTRATIONS,
        remaining: Math.max(0, MAX_REGISTRATIONS - total),
        percent: Math.min(100, Number(((total / MAX_REGISTRATIONS) * 100).toFixed(2)))
      },
      groupUrl: validGroupUrl(GROUP_URL) ? GROUP_URL : '',
      prefix: CONTACT_PREFIX,
      recent: data || [],
      exportChunkSize: 5000,
      exportParts: Math.max(1, Math.ceil(total / 5000))
    })
  } catch (error) {
    console.error('[admin overview]', error?.message || error)
    res.status(503).json({ ok: false, error: 'Could not load admin data' })
  }
})

function escapeVCard(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

app.get('/api/admin/download-vcf', adminOnly, async (req, res) => {
  try {
    const requestedOffset = Number.parseInt(String(req.query.offset || '0'), 10)
    const requestedLimit = Number.parseInt(String(req.query.limit || MAX_REGISTRATIONS), 10)
    const offset = Math.max(0, Math.min(MAX_REGISTRATIONS - 1, Number.isFinite(requestedOffset) ? requestedOffset : 0))
    const limit = Math.max(1, Math.min(MAX_REGISTRATIONS - offset, Number.isFinite(requestedLimit) ? requestedLimit : MAX_REGISTRATIONS))

    const rows = []
    const pageSize = 1000
    const endExclusive = offset + limit

    for (let from = offset; from < endExclusive; from += pageSize) {
      const to = Math.min(from + pageSize - 1, endExclusive - 1)
      const { data, error } = await supabase
        .from('bx_registrations')
        .select('id, display_name, phone')
        .eq('consent_vcf', true)
        .order('id', { ascending: true })
        .range(from, to)

      if (error) throw error
      if (!data?.length) break
      rows.push(...data)
      if (data.length < (to - from + 1)) break
    }

    const vcf = rows.map(row => [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${escapeVCard(row.display_name)}`,
      `N:${escapeVCard(row.display_name)};;;;`,
      `TEL;TYPE=CELL:+${row.phone}`,
      'END:VCARD'
    ].join('\r\n')).join('\r\n') + (rows.length ? '\r\n' : '')

    const date = new Date().toISOString().slice(0, 10)
    const suffix = offset === 0 && limit >= MAX_REGISTRATIONS
      ? ''
      : `-PART-${Math.floor(offset / 5000) + 1}`

    res.setHeader('Content-Type', 'text/vcard; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="BX-FOLDER${suffix}-${date}.vcf"`)
    res.setHeader('X-BX-VCF-Contacts', String(rows.length))
    res.setHeader('Cache-Control', 'no-store')
    res.send(vcf)
  } catch (error) {
    console.error('[vcf]', error?.message || error)
    res.status(500).json({ ok: false, error: 'Could not generate VCF file' })
  }
})

app.get('/health', (_req, res) => res.json({ ok: true, service: 'BX FOLDER', maxRegistrations: MAX_REGISTRATIONS }))

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')))

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }))

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BX FOLDER running on http://0.0.0.0:${PORT}`)
  })
}

export default app
