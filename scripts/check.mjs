import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { mapProfile } from '../map.js'

const dash = JSON.parse(readFileSync(new URL('../fixtures/dash-williamhgates.json', import.meta.url)))
const p = mapProfile(dash, 'williamhgates')
assert.equal(p.name, 'Bill Gates')
assert.ok(p.headline?.length > 3, 'headline')
assert.ok(p.about?.includes('Gates Foundation'), 'about')
assert.ok(p.location, 'location')
assert.ok(p.images.profile?.startsWith('https://media.licdn.com'), 'profile image')
assert.ok(p.experience.length >= 2, 'experience')
assert.ok(p.experience.some((x) => x.company === 'Gates Foundation'), 'gates fdn position')
assert.ok(p.education.length >= 1, 'education')
console.log('offline mapper check passed')

if (process.env.LI_LIVE === '1') {
  const { spawn } = await import('node:child_process')
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '3999' } })
  await new Promise((r) => setTimeout(r, 800))
  try {
    const slug = process.env.LI_TEST_SLUG || 'williamhgates'
    const res = await fetch(`http://localhost:3999/profile?url=https://www.linkedin.com/in/${slug}/`)
    assert.equal(res.status, 200, `status ${res.status}`)
    const j = await res.json()
    for (const k of ['name', 'headline', 'location', 'about', 'experience', 'education', 'skills', 'certifications', 'languages', 'images'])
      assert.ok(k in j, `missing key ${k}`)
    assert.ok(j.experience.length > 0, 'experience empty')
    console.log('live api check passed')
  } finally {
    srv.kill()
  }
}
