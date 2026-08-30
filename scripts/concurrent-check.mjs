import assert from 'node:assert'
import { spawn } from 'node:child_process'


const PORT = 3998
const BASE = `http://localhost:${PORT}`

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) } })
await wait(800)

let ok = false
try {
  const t0 = Date.now()
  const health = await Promise.all(Array.from({ length: 20 }, () => fetch(`${BASE}/healthz`).then(r => r.json().then(j => ({ s: r.status, j })))))
  const th = Date.now() - t0
  for (const { s, j } of health) {
    assert.equal(s, 200)
    assert.ok(j.ok)
  }
  console.log(`healthz 20 parallel: ${th}ms`)

  if (process.env.LI_AT) {
    const slug = process.env.LI_TEST_SLUG || 'williamhgates'
    const url = `${BASE}/profile?url=https://www.linkedin.com/in/${slug}/`
    const r1 = await fetch(url)
    assert.equal(r1.status, 200)
    const j1 = await r1.json()
    assert.ok(j1.name)

    const t1 = Date.now()
    const results = await Promise.all(Array.from({ length: 10 }, () => fetch(url).then(async r => ({ s: r.status, j: await r.json() }))))
    const tp = Date.now() - t1
    for (const { s, j } of results) {
      assert.equal(s, 200)
      assert.ok(j.name)
    }
    assert.ok(tp < 2000, `parallel profile too slow: ${tp}ms`)
    console.log(`profile 10 parallel (cached): ${tp}ms, all 200`)
    assert.ok(tp < th * 5 || th < 50, 'parallel not faster than sequential')
  } else {
    console.log('skip profile parallel: LI_AT not set')
  }

  console.log('concurrent check passed')
  ok = true
} finally {
  srv.kill()
  if (!ok) process.exit(1)
}
