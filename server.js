import http from 'node:http'
import { fetchProfile } from './li.js'
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
  try {
    const u = new URL(raw)
    if (!/^(www\.)?linkedin\.com$/.test(u.hostname)) return null
    const m = u.pathname.match(/^\/in\/([^/]+)/)
    return m && SLUG.test(m[1]) ? m[1] : null
  } catch {
    return SLUG.test(raw) ? raw : null // bare slug accepted
  }
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
  if (hit && Date.now() - hit.at < TTL) return send(res, 200, { ...hit.data, _meta: { ...hit.data._meta, cache: 'hit' } })

  try {
    const dash = await fetchProfile(slug)
    const profile = mapProfile(dash, slug)
    if (!profile) return err(res, 404, 'profile_not_found', `no profile data for ${slug}`)
    cache.set(slug, { at: Date.now(), data: profile })
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
