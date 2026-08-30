const BASE = 'https://www.linkedin.com/voyager/api'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const cfg = () => ({
  liAt: process.env.LI_AT,
  csrf: process.env.JSESSIONID,
  queryId: process.env.LI_QUERY_ID, // rotates; keep out of code
})

const headers = () => ({
  cookie: `li_at=${cfg().liAt}; JSESSIONID="${cfg().csrf}"`,
  'csrf-token': cfg().csrf,
  'user-agent': UA,
  accept: 'application/vnd.linkedin.normalized+json+2.1',
  'x-restli-protocol-version': '2.0.0',
  'x-li-lang': 'en_US',
})

export class LiError extends Error {
  constructor(status, msg) { super(msg); this.status = status }
}

async function get(url) {
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(15000) })
  if (res.status === 401 || res.status === 403 || res.status === 999)
    throw new LiError(502, 'linkedin_auth') // cookie expired/flagged
  if (res.status === 404) throw new LiError(404, 'profile_not_found')
  if (res.status === 429) throw new LiError(503, 'linkedin_rate_limited')
  if (!res.ok) throw new LiError(502, `linkedin_${res.status}`)
  return res.json()
}

export async function fetchProfile(slug) {
  const deco = 'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93'
  const q = `q=memberIdentity&memberIdentity=${encodeURIComponent(slug)}&decorationId=${deco}`
  return get(`${BASE}/identity/dash/profiles?${q}`)
}

// Skills/certifications/languages ride the graphql profile-components endpoint.
// ponytail: section fetch failures degrade to [] instead of failing the request —
// core profile data is the must-ship, sections are best-effort.
export async function fetchSection(profileUrn, sectionType) {
  if (!cfg().queryId) return []
  const vars = encodeURIComponent(`(profileUrn:${profileUrn},sectionType:${sectionType},locale:en_US)`)
  try {
    return await get(`${BASE}/graphql?variables=${vars}&queryId=${cfg().queryId}`)
  } catch {
    return null
  }
}
