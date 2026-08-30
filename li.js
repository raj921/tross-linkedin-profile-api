const BASE = 'https://www.linkedin.com/voyager/api'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

const cfg = () => ({
  liAt: process.env.LI_AT,
  csrf: process.env.JSESSIONID,
  queryId: process.env.LI_QUERY_ID,
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

let loginInProgress = null
async function login() {
  const { email, password } = cfg()
  if (!email || !password) return false
  if (loginInProgress) return loginInProgress
  loginInProgress = (async () => {
    try {
      const pre = await fetch('https://www.linkedin.com/login?fromSignIn=true', { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }, redirect: 'manual' })
      const html = await pre.text()
      const csrf = html.match(/name="loginCsrfParam" value="([^"]+)"/)?.[1] || html.match(/loginCsrfParam":"([^"]+)"/)?.[1] || html.match(/"loginCsrfParam":"([^"]+)"/)?.[1] || ''
      let sId = pre.headers.get('set-cookie')?.match(/JSESSIONID="([^"]+)"/)?.[1] || cfg().csrf || 'ajax:0'
      const cookies = [`JSESSIONID="${sId}"`]
      const body = new URLSearchParams({ session_key: email, session_password: password, loginCsrfParam: csrf, isJsEnabled: 'true', loginCsrfParam_2: csrf })
      let res = await fetch('https://www.linkedin.com/checkpoint/lg/login-submit', {
        method: 'POST',
        headers: {
          'user-agent': UA,
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookies.join('; '),
          'csrf-token': sId,
          referer: 'https://www.linkedin.com/login',
        },
        body,
        redirect: 'manual',
      })
      let setCookie = (res.headers.getSetCookie?.() || res.headers.get('set-cookie') || '').toString()
      let loc = res.headers.get('location')
      let tries = 0
      while ((res.status === 302 || res.status === 303) && loc && tries < 5) {
        const c = res.headers.get('set-cookie')
        if (c) cookies.push(c.split(',').map(s => s.split(';')[0].trim()).join('; '))
        if (setCookie.match(/li_at=([^;]+)/)) break
        res = await fetch(loc.startsWith('http') ? loc : `https://www.linkedin.com${loc}`, {
          headers: { 'user-agent': UA, cookie: cookies.join('; '), 'csrf-token': sId },
          redirect: 'manual',
        })
        setCookie += '; ' + (res.headers.get('set-cookie') || '')
        loc = res.headers.get('location')
        tries++
      }
      const m = setCookie.match(/li_at=([^;]+)/)
      if (m) {
        process.env.LI_AT = m[1]
        const j = setCookie.match(/JSESSIONID="([^"]+)"/)
        if (j) process.env.JSESSIONID = j[1]
        return true
      }
      return false
    } catch { return false } finally { setTimeout(() => (loginInProgress = null), 8000) }
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

const PAGERS = {
  skills: ['com.linkedin.sdui.pagers.profile.details.skills', 'ProfileSkillDetails'],
  certifications: ['com.linkedin.sdui.pagers.profile.details.certifications', 'ProfileCertificationDetails'],
  languages: ['com.linkedin.sdui.pagers.profile.details.languages', 'ProfileLanguageDetails'],
}

const BOILER = /^(Licenses & certifications|Languages|Skills|Skills:|Nothing to see for now)$|^Issued |adds? will appear here|When you add new languages|^\$L[0-9a-z]+$|^\d+ endorsements?$/

export async function fetchSections(slug, profileId) {
  const out = {}
  await Promise.all(Object.entries(PAGERS).map(async ([kind, [pager, screen]]) => {
    out[kind] = []
    try {
      const body = JSON.stringify({
        pagerId: pager,
        clientArguments: { $type: 'proto.sdui.actions.requests.RequestedArguments', requestedStateKeys: [], payload: { vanityName: slug, start: 0, count: 50, profileId }, requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' }, states: [], screenId: `com.linkedin.sdui.flagshipnav.profile.${screen}`, knownTemplateIds: [] },
        paginationRequest: { $type: 'proto.sdui.actions.requests.PaginationRequest', pagerId: pager, retryCount: 2 },
      })
      const res = await fetch(`https://www.linkedin.com/flagship-web/rsc-action/actions/pagination?sduiid=${pager}`, {
        method: 'POST',
        headers: {
          cookie: `li_at=${cfg().liAt}; JSESSIONID="${cfg().csrf}"`,
          'csrf-token': cfg().csrf,
          'content-type': 'application/json',
          'x-li-rsc-stream': 'true',
          'user-agent': UA,
        },
        body,
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return
      const txt = await res.text()
      const names = [...txt.matchAll(/"children":\["([^"\\]{2,90})"\]/g)].map((m) => m[1])
      out[kind] = [...new Set(names)].filter((n) => !BOILER.test(n))
    } catch {}
  }))
  return out
}
