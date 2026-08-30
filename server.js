import http from 'node:http'
import { fetchProfile, fetchSection } from './li.js'
import { mapProfile } from './map.js'

const PORT = process.env.PORT || 3000
const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9-]{2,99}$/

// ponytail: in-memory cache, dies with the process. Ceiling: per-instance only,
// no sharing across replicas. Upgrade path: Redis if we ever run >1 instance.
const cache = new Map()
const TTL = 60 * 60 * 1000

const send = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj, null, 2))
}

const err = (res, status, code, message) => send(res, status, { error: { code, message } })

function slugFrom(raw) {
  const trimmed = raw.trim()
  try {
    const u = new URL(trimmed)
    if (!/^(www\.)?linkedin\.com$/.test(u.hostname)) return null
    const m = u.pathname.match(/^\/in\/([^/]+)/)
    return m && SLUG.test(m[1]) ? m[1] : null
  } catch {
    const bare = trimmed.replace(/\/+$/, '')
    return SLUG.test(bare) ? bare : null
  }
}

function profileUrnFrom(dash) {
  const p = (dash.included || []).find((e) => (e.$type || '').endsWith('.Profile'))
  return p?.entityUrn || null
}

async function fetchAndMap(slug) {
  const dash = await fetchProfile(slug)
  const urn = profileUrnFrom(dash)
  // ponytail: parallel section fetch — 3 calls concurrent, Ceiling: 4 concurrent Voyager hits (1+3) may 429 under burst; upgrade: semaphore/queue at 2
  const [skills, certs, langs] = urn && process.env.LI_QUERY_ID
    ? await Promise.all([fetchSection(urn, 'skills'), fetchSection(urn, 'certifications'), fetchSection(urn, 'languages')])
    : [[], [], []]
  const sections = {
    skills: Array.isArray(skills) ? skills : skills?.data || [],
    certifications: Array.isArray(certs) ? certs : certs?.data || [],
    languages: Array.isArray(langs) ? langs : langs?.data || [],
  }
  return mapProfile(dash, slug, sections)
}

async function refresh(slug) {
  const p = await fetchAndMap(slug)
  if (p) cache.set(slug, { at: Date.now(), data: p })
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')

  if (u.pathname === '/healthz') return send(res, 200, { ok: true })

  if (u.pathname !== '/profile') return err(res, 404, 'not_found', 'GET /profile?url=<linkedin profile url>')

  const raw = u.searchParams.get('url')
  if (!raw) return err(res, 400, 'missing_url', 'pass ?url=https://www.linkedin.com/in/<slug>/')
  const slug = slugFrom(raw)
  if (!slug) return err(res, 400, 'bad_url', 'expected a linkedin.com/in/<slug> profile url')

  const hit = cache.get(slug)
  const now = Date.now()
  if (hit && now - hit.at < TTL) return send(res, 200, { ...hit.data, _meta: { ...hit.data._meta, cache: 'hit' } })
  // ponytail: stale-while-revalidate — serve stale instantly, refresh in background. Ceiling: single background refresh per slug; upgrade: coalesce with promise cache
  if (hit && now - hit.at < TTL * 2) {
    send(res, 200, { ...hit.data, _meta: { ...hit.data._meta, cache: 'stale' } })
    refresh(slug).catch(() => {})
    return
  }

  try {
    const profile = await fetchAndMap(slug)
    if (!profile) return err(res, 404, 'profile_not_found', `no profile data for ${slug}`)
    cache.set(slug, { at: now, data: profile })
    send(res, 200, profile)
  } catch (e) {
    const code = e.message || 'upstream_error'
    const msgs = {
      linkedin_auth: 'linkedin session expired — rotate LI_AT',
      profile_not_found: 'profile not found or not visible to this account',
      linkedin_rate_limited: 'linkedin is rate limiting — retry shortly',
    }
    err(res, e.status || 502, code, msgs[code] || `linkedin upstream failed: ${code}`)
  }
})

server.listen(PORT, () => console.log(`listening on :${PORT}`))
