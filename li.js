const BASE = 'https://www.linkedin.com/voyager/api'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

const cfg = () => ({
  liAt: process.env.LI_AT,
  csrf: process.env.JSESSIONID,
  queryId: process.env.LI_QUERY_ID, // rotates; keep out of code
  email: process.env.LI_EMAIL,
  password: process.env.LI_PASSWORD,
})

const headers = () => ({
  cookie: `li_at=${cfg().liAt}; JSESSIONID="${cfg().csrf}"`,
  'csrf-token': cfg().csrf,
  'user-agent': UA,
  accept: 'application/vnd.linkedin.normalized+json+2.1',
  'x-restli-protocol-version': '2.0.0',
  'x-li-lang': 'en_US',
  'accept-language': 'en-US,en;q=0.9',
  'x-li-track': '{"clientVersion":"1.13.166","osName":"web","timezoneOffset":0}',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  referer: 'https://www.linkedin.com/',
})

export class LiError extends Error {
  constructor(status, msg) { super(msg); this.status = status }
}

// ponytail: naive HTTP login for long-term without manual token swap — ceiling: no 2FA/captcha, single retry per request; upgrade: checkpoint handling + residential proxy if flagged
let loginInProgress = null
async function login() {
  const { email, password } = cfg()
  if (!email || !password) return false
  if (loginInProgress) return loginInProgress
  loginInProgress = (async () => {
    try {
      // 1. fetch login page for CSRF
      const pre = await fetch('https://www.linkedin.com/login', { headers: { 'user-agent': UA }, redirect: 'manual' })
      const html = await pre.text()
      const csrf = html.match(/name="loginCsrfParam" value="([^"]+)"/)?.[1] || html.match(/loginCsrfParam":"([^"]+)"/)?.[1] || ''
      const sId = pre.headers.get('set-cookie')?.match(/JSESSIONID="([^"]+)"/)?.[1] || cfg().csrf || 'ajax:0'
      // 2. attempt authenticate
      const body = new URLSearchParams({ session_key: email, session_password: password, loginCsrfParam: csrf, isJsEnabled: 'true' })
      const res = await fetch('https://www.linkedin.com/checkpoint/lg/login-submit', {
        method: 'POST',
        headers: {
          'user-agent': UA,
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `JSESSIONID="${sId}"`,
          'csrf-token': sId,
        },
        body,
        redirect: 'manual',
      })
      const setCookie = res.headers.getSetCookie?.() || res.headers.get('set-cookie') || ''
      const m = setCookie.toString().match(/li_at=([^;]+)/)
      if (m) {
        process.env.LI_AT = m[1]
        const j = setCookie.toString().match(/JSESSIONID="([^"]+)"/)
        if (j) process.env.JSESSIONID = j[1]
        return true
      }
      return false
    } catch { return false } finally { setTimeout(() => (loginInProgress = null), 5000) }
  })()
  return loginInProgress
}

async function get(url, retried = false) {
  const res = await fetch(url, { headers: headers(), redirect: 'manual', signal: AbortSignal.timeout(15000) })
  if (res.status === 302 || res.status === 401 || res.status === 403 || res.status === 999) {
    if (!retried && cfg().email && cfg().password) {
      const ok = await login()
      if (ok) return get(url, true)
    }
    throw new LiError(502, 'linkedin_auth')
  }
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
