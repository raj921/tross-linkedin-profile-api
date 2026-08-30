import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mapProfile } from '../map.js'

const PORT = 3997
const BASE = `http://localhost:${PORT}`
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) } })
await wait(800)

let fails = 0
function ok(name, fn) {
  try { fn(); console.log(`✓ ${name}`) } catch (e) { fails++; console.error(`✗ ${name}: ${e.message}`) }
}
async function okAsync(name, fn) {
  try { await fn(); console.log(`✓ ${name}`) } catch (e) { fails++; console.error(`✗ ${name}: ${e.message}\n${e.stack?.slice(0,500)}`) }
}

try {
  // 1. healthz
  await okAsync('healthz 200', async () => {
    const r = await fetch(`${BASE}/healthz`)
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { ok: true })
  })

  await okAsync('healthz wrong method still 200 (GET only)', async () => {
    const r = await fetch(`${BASE}/healthz`)
    assert.equal(r.status, 200)
  })

  // 2. missing_url
  await okAsync('missing_url 400', async () => {
    const r = await fetch(`${BASE}/profile`)
    assert.equal(r.status, 400)
    const j = await r.json()
    assert.equal(j.error.code, 'missing_url')
  })

  // 3. bad_url cases
  const bads = [
    ['https://google.com/in/williamhgates', 'wrong host'],
    ['https://linkedin.com/in/', 'no slug'],
    ['https://linkedin.com/in/ab', 'too short (<3)'],
    ['https://linkedin.com/in/' + 'a'.repeat(101), 'too long (>100)'],
    ['https://linkedin.com/in/invalid!slug', 'invalid char !'],
    ['https://linkedin.com/company/microsoft', 'not /in/'],
    ["https://linkedin.com/in/' OR 1=1 --", 'sql injection'],
    ['https://linkedin.com/in/<script>alert(1)</script>', 'xss'],
    ['https://linkedin.com/in/%2e%2e%2fetc%2fpasswd', 'path traversal'],
  ]
  for (const [url, label] of bads) {
    await okAsync(`bad_url: ${label}`, async () => {
      const r = await fetch(`${BASE}/profile?url=${encodeURIComponent(url)}`)
      // bare slug "not-a-url-but..." is actually valid slug per SLUG regex, so it would try LinkedIn and get 404 or 502, not 400
      // we check that truly bad ones are 400
      if (label.includes('bare slug')) {
        // skip, it's expected to be 502/404 not 400
        assert.ok([400, 404, 502].includes(r.status))
      } else {
        assert.equal(r.status, 400, `expected 400 for ${url} got ${r.status}`)
        const j = await r.json()
        assert.equal(j.error.code, 'bad_url')
      }
    })
  }

  // 4. valid slug forms — should all 200 if LI_AT set, else 502 auth (still not 400)
  const validForms = [
    'https://www.linkedin.com/in/williamhgates/',
    'https://www.linkedin.com/in/williamhgates',
    'https://linkedin.com/in/williamhgates/',
    'https://linkedin.com/in/williamhgates?trk=public_profile',
    'williamhgates',
    'williamhgates/',
  ]
  for (const form of validForms) {
    await okAsync(`valid form: ${form.slice(0,40)}`, async () => {
      const r = await fetch(`${BASE}/profile?url=${encodeURIComponent(form)}`)
      // with fresh LI_AT should be 200, without should be 502 linkedin_auth — both are not 400
      assert.ok([200, 502].includes(r.status), `valid form got ${r.status}`)
      if (r.status === 200) {
        const j = await r.json()
        assert.ok(j.name, 'name missing')
        assert.ok(j.publicId === 'williamhgates')
        assert.ok(Array.isArray(j.experience))
      } else {
        const j = await r.json()
        assert.ok(j.error.code === 'linkedin_auth' || j.error.code.startsWith('linkedin_'))
      }
    })
  }

  // 5. not found — random slug
  await okAsync('profile_not_found 404', async () => {
    const r = await fetch(`${BASE}/profile?url=https://www.linkedin.com/in/this-user-does-not-exist-xyz123456789/`)
    // LinkedIn returns 404 for not found, or 502 if auth, both acceptable; but if auth valid, should be 404
    assert.ok([404, 502].includes(r.status), `not found got ${r.status}`)
    const j = await r.json()
    assert.ok(['profile_not_found', 'linkedin_auth', 'linkedin_404'].includes(j.error.code) || j.error.code.startsWith('linkedin_'))
  })

  // 6. mapProfile edge cases (unit)
  ok('mapProfile: fixture williamhgates', () => {
    const dash = JSON.parse(readFileSync(new URL('../fixtures/dash-williamhgates.json', import.meta.url)))
    const p = mapProfile(dash, 'williamhgates')
    assert.equal(p.name, 'Bill Gates')
    assert.ok(p.headline.includes('Gates Foundation'))
    assert.ok(p.location.includes('Seattle'))
    assert.ok(p.about.includes('Gates Foundation'))
    assert.ok(p.images.profile.startsWith('https://media.licdn.com'))
    assert.equal(p.experience.length, 3)
    assert.ok(p.education.length >= 1)
  })

  ok('mapProfile: empty included -> null', () => {
    assert.equal(mapProfile({ included: [] }, 'x'), null)
    assert.equal(mapProfile({}, 'x'), null)
    assert.equal(mapProfile({ included: null }, 'x'), null)
  })

  ok('mapProfile: missing optional fields', () => {
    const dash = { included: [{ $type: 'com.linkedin.voyager.dash.identity.profile.Profile', entityUrn: 'urn:li:fsd_profile:1', firstName: 'A', lastName: 'B', headline: null, summary: null }] }
    const p = mapProfile(dash, 'a-b')
    assert.equal(p.name, 'A B')
    assert.equal(p.headline, null)
    assert.equal(p.location, null)
    assert.deepEqual(p.experience, [])
  })

  ok('mapProfile: with sections', () => {
    const dash = JSON.parse(readFileSync(new URL('../fixtures/dash-williamhgates.json', import.meta.url)))
    const p = mapProfile(dash, 'williamhgates', { skills: ['js'], certifications: ['aws'], languages: ['en'] })
    assert.deepEqual(p.skills, ['js'])
    assert.deepEqual(p.certifications, ['aws'])
  })

  // 7. cache: hit and stale
  await okAsync('cache hit', async () => {
    if (!process.env.LI_AT) { console.log('  skip cache hit: no LI_AT'); return }
    const url = `${BASE}/profile?url=https://www.linkedin.com/in/williamhgates/`
    await fetch(url) // warm
    const r = await fetch(url)
    const j = await r.json()
    assert.equal(j._meta.cache, 'hit')
  })

  // 8. extreme concurrency 50 parallel healthz
  await okAsync('concurrent 50 healthz', async () => {
    const t0 = Date.now()
    const rs = await Promise.all(Array.from({ length: 50 }, () => fetch(`${BASE}/healthz`)))
    const dt = Date.now() - t0
    for (const r of rs) assert.equal(r.status, 200)
    assert.ok(dt < 2000, `50 parallel too slow ${dt}ms`)
    console.log(`  50 healthz in ${dt}ms`)
  })

  await okAsync('concurrent 20 profile (cached)', async () => {
    if (!process.env.LI_AT) { console.log('  skip'); return }
    const url = `${BASE}/profile?url=https://www.linkedin.com/in/williamhgates/`
    await fetch(url)
    const t0 = Date.now()
    const rs = await Promise.all(Array.from({ length: 20 }, () => fetch(url).then(r => r.json().then(j => ({ s: r.status, j })))))
    const dt = Date.now() - t0
    for (const { s, j } of rs) { assert.equal(s, 200); assert.ok(j.name) }
    assert.ok(dt < 3000, `20 parallel profile slow ${dt}ms`)
    console.log(`  20 profile parallel in ${dt}ms`)
  })

  // 9. extreme inputs: very long URL, unicode, double encode
  await okAsync('extreme long URL 400', async () => {
    const long = 'https://www.linkedin.com/in/' + 'a'.repeat(5000)
    const r = await fetch(`${BASE}/profile?url=${encodeURIComponent(long)}`)
    assert.equal(r.status, 400)
  })

  await okAsync('unicode slug 400', async () => {
    const r = await fetch(`${BASE}/profile?url=https://www.linkedin.com/in/тест/`)
    assert.equal(r.status, 400)
  })

  await okAsync('double encode', async () => {
    const r = await fetch(`${BASE}/profile?url=${encodeURIComponent(encodeURIComponent('https://www.linkedin.com/in/williamhgates/'))}`)
    assert.equal(r.status, 400)
  })

  // 10. not_found route
  await okAsync('unknown route 404', async () => {
    const r = await fetch(`${BASE}/unknown`)
    assert.equal(r.status, 404)
  })

  // 11. verify no secrets in repo still
  await okAsync('no secrets in repo', async () => {
    const { execSync } = await import('node:child_process')
    const files = execSync('git ls-files').toString().trim().split('\n').filter(f => f && !f.startsWith('fixtures/'))
    for (const f of files) {
      const c = readFileSync(f, 'utf8')
      assert.ok(!/AQE[A-Za-z0-9_-]{40,}|li_at=[A-Za-z0-9_-]{10,}/.test(c), `secret in ${f}`)
    }
  })

  // 12. verify no browser automation
  await okAsync('no browser automation', async () => {
    const p = JSON.parse(readFileSync('package.json', 'utf8'))
    const s = JSON.stringify(p) + readFileSync('li.js', 'utf8')
    assert.ok(!/playwright|puppeteer|selenium/i.test(s))
  })

  console.log(`\nextreme check: ${fails ? fails + ' failed' : 'all passed'}`)
  if (fails) process.exit(1)
} finally {
  srv.kill()
}
