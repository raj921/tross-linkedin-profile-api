const $ = (s, c = document) => c.querySelector(s)
const $$ = (s, c = document) => [...c.querySelectorAll(s)]
const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9-]{2,99}$/
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const ic = (n) => `<svg class="i"><use href="#i-${n}"/></svg>`

const out = $('#stage')
const input = $('#url')
const go = $('#go')
const cons = $('#console')
const conLog = $('#conLog')
const goLbl = $('.go-lbl', go)
const goIc = $('use', go)

let P = null, RAW = null, VIEW = 'dash', stats = { ms: 0, bytes: 0, cache: 'fresh' }
let hist = [], hi = -1, draft = '', logTimer = null, busy = false

document.documentElement.classList.add('js')

const SYM = { ok: '✓', err: '✕', dim: '›' }
function log(txt, cls = '', type = false) {
  clearTimeout(logTimer)
  conLog.className = 'con-log ' + cls
  conLog.innerHTML = '<span class="ln"><span class="p"></span><span class="t"></span><span class="caret"></span></span>'
  const p = $('.p', conLog), t = $('.t', conLog)
  p.textContent = SYM[cls] || '›'
  if (!type || REDUCED) return t.textContent = txt
  let i = 0
  ;(function step() {
    t.textContent = txt.slice(0, ++i)
    if (i < txt.length) logTimer = setTimeout(step, 5)
  })()
}
const dimLog = (txt) => log(txt, 'dim')

function parseUrl(v) {
  const t = v.trim()
  if (!t) return { err: 'missing_url' }
  try {
    const u = new URL(t)
    if (!/^(www\.)?linkedin\.com$/.test(u.hostname)) return { err: 'bad_url' }
    const m = u.pathname.match(/^\/in\/([^/]+)/)
    return m && SLUG.test(m[1]) ? { slug: m[1] } : { err: 'bad_url' }
  } catch {
    const b = t.replace(/\/+$/, '')
    return SLUG.test(b) ? { slug: b } : { err: 'bad_url' }
  }
}
const ERR_TXT = {
  missing_url: 'enter a profile url — e.g. linkedin.com/in/williamhgates',
  bad_url: 'not a linkedin.com/in/<slug> url — paste a profile link or bare slug',
}

const MSG = {
  profile_not_found: 'No such public profile — or it is invisible to the backend session. Try a profile you can open while logged out.',
  linkedin_auth: 'The upstream LinkedIn session expired. Backend needs a fresh li_at cookie, then this resolves instantly.',
  linkedin_rate_limited: 'LinkedIn is throttling this deployment. Give it a minute — the 1h cache means repeats are free.',
  network: 'Could not reach the API. Serve this page through the Node server or the Vercel URL.',
}
const msgOf = (code) => MSG[code] || ''
const PROD = /vercel\.app$/.test(location.hostname)
const isUpstream = (code, status) => /^linkedin_/.test(code) || (status >= 500 && status !== 0)

const SAMPLE = {
  url: null, publicId: 'demo',
  sample: true,
  name: 'Alex Rivera',
  headline: 'Principal Engineer · Platform Systems @ Meridian Labs — ex-NASA JPL, ex-Stripe',
  location: 'San Francisco, California, United States',
  about: 'I build distributed systems that refuse to fall over. Currently leading the platform team at Meridian Labs, where we run one of the largest event-mesh deployments on the planet — 40k services, 9 regions, and a dashboard that (mostly) behaves.\n\nBefore that I spent seven years at Stripe on the ledger and payments-infra crews, and before that I wrote flight software at NASA JPL for the Mars 2020 mission. Somewhere in between I survived YC S16 and three very opinionated on-call rotations.\n\nI care about boring technology done well: observability, typed contracts, and docs that read like code review. When the laptop closes I am usually climbing granite, roasting coffee, or losing gracefully at chess.',
  experience: [
    { title: 'Principal Engineer, Platform', company: 'Meridian Labs', start: '2021-04', end: null, current: true, description: 'Own the control plane for a 40k-service event mesh across 9 regions. Cut p99 fan-out latency 62% by replacing the gossip layer with a sharded consistent-hash ring and moved the whole fleet onto zero-downtime canary deploys.' },
    { title: 'Staff Engineer, Ledger Infrastructure', company: 'Stripe', start: '2016-06', end: '2021-03', current: false, description: 'Led the rewrite of the money-movement ledger onto a log-structured store. Shipped double-entry semantics that survived a 14x transaction spike during a shopping holiday without a single reconciliation break.' },
    { title: 'Flight Software Engineer', company: 'NASA JPL', start: '2013-01', end: '2016-05', current: false, description: 'Wrote fault-tolerant C++ for the Mars 2020 rover’s onboard sequencing engine. Learned that when your deploy target is 300 million kilometers away, you test like your life depends on it — because someone else’s does.' },
  ],
  education: [
    { school: 'Stanford University', degree: 'MS', field: 'Computer Science', start: '2011', end: '2012' },
    { school: 'University of Michigan', degree: 'BS', field: 'Aerospace Engineering', start: '2006', end: '2010' },
  ],
  skills: ['Distributed Systems', 'Kubernetes', 'Go', 'Rust', 'System Design', 'Observability', 'Site Reliability', 'Event-Driven Architecture', 'Postgres Internals', 'C++', 'Incident Command', 'Mentorship'],
  certifications: ['AWS Certified Solutions Architect — Professional', 'CKA: Certified Kubernetes Administrator', 'HashiCorp Vault Operations'],
  languages: ['English', 'Spanish', 'Japanese'],
  _meta: { fetchedAt: new Date().toISOString(), source: 'voyager', sample: true },
}

function sampleMode(reason) {
  P = SAMPLE
  RAW = JSON.stringify(SAMPLE, null, 2)
  stats.bytes = new Blob([RAW]).size
  stats.cache = 'sample'
  stats.ms = 0
  setBusy(false, '')
  icon('check')
  goFlash('done')
  cons.classList.add('ok', 'sweep')
  setTimeout(() => cons.classList.remove('sweep'), 1100)
  log(`offline sandbox — ${reason}; showing bundled sample profile`, 'ok', true)
  paint()
}

const fmtBytes = () => stats.bytes > 1024 ? (stats.bytes / 1024).toFixed(1) + ' kb' : stats.bytes + ' b'

function icon(n) { goIc.setAttribute('href', '#i-' + n) }
function setBusy(on, slug) {
  busy = on
  cons.classList.toggle('busy', on)
  go.disabled = on
  if (on) {
    goLbl.textContent = 'fetching'
    icon('retry')
    log(`resolving linkedin.com/in/${slug}`)
  } else {
    goLbl.textContent = 'resolve'
  }
}
function goFlash(cls) {
  go.classList.add(cls)
  setTimeout(() => {
    go.classList.remove(cls)
    if (!busy) icon('arrow')
  }, 1400)
}

async function resolve(raw) {
  const r = parseUrl(raw)
  if (r.err) {
    cons.classList.add('bad', 'shake')
    setTimeout(() => cons.classList.remove('shake', 'bad'), 900)
    log(ERR_TXT[r.err], 'err')
    return
  }
  cons.classList.remove('bad', 'ok')
  pushHist(r.slug)
  input.value = r.slug
  const t0 = performance.now()
  setBusy(true, r.slug)
  skeleton()
  try {
    const res = await fetch('/profile?url=' + encodeURIComponent(r.slug))
    let j = null
    try { j = await res.json() } catch { }
    stats.ms = Math.round(performance.now() - t0)
    if (!res.ok) {
      const code = j?.error?.code || `http_${res.status}`
      const hint = msgOf(code) || j?.error?.message || `upstream responded ${res.status}`
      if (!PROD && isUpstream(code, res.status)) return sampleMode('linkedin is unreachable from this sandbox')
      return fail(code, res.status, hint)
    }
    if (!j?.publicId) return fail('bad_payload', res.status, 'unexpected api response')
    P = j
    RAW = JSON.stringify(j, null, 2)
    stats.bytes = new Blob([RAW]).size
    stats.cache = j._meta?.cache || 'fresh'
    history.replaceState(null, '', '?url=' + encodeURIComponent(r.slug))
    success(r.slug)
  } catch {
    if (!PROD) return sampleMode('the api is unreachable from this sandbox')
    fail('network', 0, msgOf('network'))
  }
}

function success(slug) {
  setBusy(false, slug)
  icon('check')
  goFlash('done')
  cons.classList.add('ok', 'sweep')
  setTimeout(() => cons.classList.remove('sweep'), 1100)
  const n = P.experience?.length || 0, c = P.education?.length || 0
  log(`200 OK · ${n} roles · ${c} schools · ${P.skills?.length || 0} skills · ${fmtBytes()} · ${stats.ms} ms · cache ${stats.cache}`, 'ok', true)
  paint()
}

function fail(code, status, hint) {
  setBusy(false, '')
  icon('close')
  goFlash('derr')
  cons.classList.add('bad', 'shake')
  setTimeout(() => cons.classList.remove('shake'), 550)
  log(`${status || 'ERR'} ${code} — ${hint}`, 'err', true)
  out.innerHTML = `
  <div class="alert card rv" role="alert">
    <span class="al-ic">${ic('retry')}</span>
    <div>
      <p class="al-top"><span class="al-code mono">${esc(code)}</span><span class="al-status mono">${status || 'ERR'}</span></p>
      <p class="al-msg">${esc(hint)}</p>
      <div class="al-acts mono">
        <button type="button" class="prim" id="alRetry">${ic('retry')} retry</button>
        <button type="button" id="alReset">${ic('close')} clear</button>
      </div>
    </div>
  </div>`
  $('#alRetry').onclick = () => { if (hist.length) resolve(hist[hist.length - 1]) }
  $('#alReset').onclick = clearAll
}

function skeleton() {
  const bar = (w, i) => `<div class="sk sk-l" style="width:${i % 2 ? w : w - 14}%"></div>`
  out.innerHTML = `
  <div class="dash">
    <div class="card sk-card rv" style="--i:0">
      <div class="sk sk-banner"></div>
      <div class="sk-hd">
        <div class="sk sk-ava"></div>
        <div class="sk-col">${bar(70, 0)}${bar(55, 1)}${bar(62, 2)}</div>
      </div>
    </div>
    <div class="col-l">
      <div class="card sk-card rv" style="--i:1"><div class="sk-col" style="padding:22px 20px 26px">${bar(88, 0)}${bar(70, 1)}${bar(80, 2)}${bar(52, 3)}</div></div>
    </div>
    <div class="col-r">
      <div class="card sk-card rv" style="--i:2"><div class="sk-col" style="padding:22px 20px 26px">${bar(76, 0)}${bar(60, 1)}${bar(68, 2)}</div></div>
    </div>
  </div>`
}

function secHead(name, label, count) {
  const n = count == null ? '' : `<span class="n"><b data-cnt="${count}">${count}</b> ${count === 1 ? '' : 's'}</span>`
  return `<p class="card-h mono"><span class="ico">${ic(name)}</span>${esc(label)}${n}</p>`
}

const fmtDate = (d) => d || '—'
const yrs = (s, e) => {
  if (!s) return null
  const n = new Date().getFullYear(), y = +s.slice(0, 4), z = e ? +e.slice(0, 4) : n
  const d = z - y
  return d < 1 ? null : d
}
const range = (x) => `${fmtDate(x.start)} — ${x.current ? 'now' : fmtDate(x.end)}`

function expRow(x, i) {
  const ny = yrs(x.start, x.end)
  return `<div class="row rv" style="--i:${i}">
    <span class="node ${x.current ? 'cur' : ''}"></span>
    <div class="r-l1">
      <span class="r-title">${esc(x.title || 'Untitled role')}</span>
      ${x.current ? '<span class="badge-now">now</span>' : ''}
      ${x.company ? `<span class="r-co">${esc(x.company)}</span>` : ''}
    </div>
    <div class="r-meta">
      <span class="r-dates">${esc(range(x))}</span>
      ${ny != null ? `<span class="r-tenure">${ny} yr${ny === 1 ? '' : 's'}</span>` : ''}
    </div>
    ${x.description ? `<p class="r-desc">${esc(x.description)}</p>` : ''}
  </div>`
}

function eduRow(x, i) {
  const bits = [x.degree, x.field].filter(Boolean).join(', ')
  return `<div class="row rv" style="--i:${i}">
    <span class="node"></span>
    <div class="r-l1">
      <span class="r-title">${esc(x.school || 'Unknown school')}</span>
      ${bits ? `<span class="r-co">${esc(bits)}</span>` : ''}
    </div>
    <div class="r-meta"><span class="r-dates">${esc(range(x))}</span></div>
  </div>`
}

const chipLbl = (v) => {
  if (typeof v !== 'object' || v === null) return v
  if (v.skill && typeof v.skill === 'object') v = v.skill
  return v.name || v.title || v.text || Object.values(v).find((x) => typeof x === 'string') || ''
}

function chipSec(name, label, arr, emptyHint, i) {
  const body = arr?.length
    ? `<div class="chipset">${arr.map((v, k) => `<span class="chip rv" style="--i:${Math.min(k, 8)}">${esc(chipLbl(v))}</span>`).join('')}</div>`
    : `<p class="empty-note">${esc(emptyHint)}</p>`
  return `<article class="card rv" style="--i:${i}">${secHead(name, label, arr?.length || 0)}${body}</article>`
}

function metaOf(p) {
  const c = stats.cache
  const when = p._meta?.fetchedAt ? new Date(p._meta.fetchedAt).toLocaleTimeString() : ''
  const cacheChip = c === 'sample'
    ? '<span class="mchip warn">● bundled sample</span>'
    : c === 'stale'
      ? '<span class="mchip warn">● cache stale · revalidated</span>'
      : `<span class="mchip fresh">● cache ${c === 'fresh' ? 'miss' : 'hit'}</span>`
  return `${cacheChip}
  <span class="mchip">source <b>${p.sample ? 'bundle' : 'voyager'}</b></span>
  ${p.sample ? '' : `<span class="mchip">slug <b>${esc(p.publicId)}</b></span>`}
  ${stats.ms ? `<span class="mchip">${stats.ms} ms</span>` : ''}
  <span class="mchip">${fmtBytes()}</span>
  ${when ? `<span class="mchip">fetched ${esc(when)}</span>` : ''}`
}

const initials = (n) => (n || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase().replace(/[^A-Z0-9]/g, '') || '?'

function pcard(p) {
  const bg = p.images?.background, av = p.images?.profile, ini = initials(p.name)
  return `<article class="card pcard rv" style="--i:0">
    <div class="banner ${bg ? '' : 'plain'}">
      ${bg ? `<img src="${esc(bg)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <span class="btag mono">${p.sample ? 'sample profile' : 'public profile'}</span>
    </div>
    <div class="phead">
      <div class="ava ${av ? '' : 'init'}">
        ${av ? `<img src="${esc(av)}" alt="${esc(p.name || '')}" loading="lazy" onerror="this.outerHTML='${esc(ini)}';this.parentNode.className+=' init'">` : esc(ini)}
      </div>
      <div class="pinfo">
        <div class="pname"><h2>${esc(p.name || p.publicId || 'Unknown')}</h2></div>
        ${p.headline ? `<p class="phl">${esc(p.headline)}</p>` : ''}
        <p class="ploc mono">
          ${p.location ? `<span class="pin">${ic('pin')}</span>${esc(p.location)}` : ''}
          ${p.url ? `<a class="plink" href="${esc(p.url)}" target="_blank" rel="noopener">${ic('ext')}linkedin</a>` : '<span class="note">fictional — ui demo data</span>'}
        </p>
      </div>
      <div class="pacts">
        <button type="button" class="ib" id="aCopy" title="copy profile json" aria-label="copy profile json">${ic('copy')}</button>
        <button type="button" class="ib" id="aLink" title="copy share link" aria-label="copy share link">${ic('ext')}</button>
      </div>
    </div>
    <div class="pmeta mono">${metaOf(p)}</div>
  </article>`
}

function dashHTML(p) {
  const nExp = p.experience?.length || 0, nEdu = p.education?.length || 0
  const exp = nExp ? `<div class="rows">${p.experience.map(expRow).join('')}</div>` : '<p class="empty-note">no experience listed publicly</p>'
  const edu = nEdu ? `<div class="rows">${p.education.map(eduRow).join('')}</div>` : '<p class="empty-note">no education listed publicly</p>'
  const about = p.about
    ? `<article class="card rv" style="--i:1">${secHead('doc', 'About')}<p class="about-t">${esc(p.about)}</p></article>`
    : ''
  const colL = about + `<article class="card rv" style="--i:2">${secHead('case', 'Experience', nExp)}${exp}</article>`
  const colR = `<article class="card rv" style="--i:1">${secHead('cap', 'Education', nEdu)}${edu}</article>`
    + chipSec('zap', 'Skills', p.skills, 'no public skills — the section fails soft to []', 2)
    + chipSec('medal', 'Certifications', p.certifications, 'none public', 3)
    + chipSec('globe', 'Languages', p.languages, 'none public', 4)
  return `<div class="dash">${pcard(p)}
    <div class="col-l">${colL}</div>
    <div class="col-r">${colR}</div>
  </div>`
}

function hl(s) {
  return esc(s).replace(/(&quot;(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\])*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, q, col, b, n) => {
      if (q !== undefined) return col ? `<span class="k">${q}</span>${col}` : `<span class="s">${q}</span>`
      if (b !== undefined) return b === 'null' ? `<span class="x">${m}</span>` : `<span class="b">${m}</span>`
      return `<span class="n">${m}</span>`
    })
}
const nLines = () => RAW ? RAW.split('\n').length : 0

function paint() {
  if (!P) return
  out.innerHTML = `
  <div class="vtool rv" style="--i:0">
    <div class="seg" role="tablist" aria-label="output view">
      <span class="seg-glider" id="gl"></span>
      <button type="button" role="tab" aria-selected="${VIEW === 'dash'}" id="tabDash">${ic('card')}profile</button>
      <button type="button" role="tab" aria-selected="${VIEW === 'json'}" id="tabJson">${ic('braces')}json<span class="cnt">${nLines()}</span></button>
    </div>
    <button type="button" class="cp mono" id="cpTop">${ic('copy')}<span>copy json</span></button>
  </div>`
  if (VIEW === 'dash') out.insertAdjacentHTML('beforeend', dashHTML(P))
  else out.insertAdjacentHTML('beforeend', `<div class="codewrap rv" style="--i:1" tabindex="0"><pre class="code">${hl(RAW)}</pre></div>`)

  bindAfter()
  requestAnimationFrame(() => {
    bindTabs()
    glide()
    tickCounts()
    measureToggles()
    const r = out.getBoundingClientRect()
    if (r.bottom < 0 || r.top > innerHeight * .28) out.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' })
  })
}

function bindAfter() {
  $('#aCopy')?.addEventListener('click', () => copyTo($('#aCopy'), RAW, 'copy json'))
  $('#aLink')?.addEventListener('click', () => copyTo($('#aLink'), location.origin + '/?url=' + encodeURIComponent(P.publicId), 'copy share link'))
  $('#cpTop')?.addEventListener('click', function () { copyTo(this, RAW, 'copy json') })
  const cw = $('.codewrap')
  if (cw) cw.addEventListener('click', () => {
    if (RAW.length < 200000) selectText($('.code', cw))
  })
}
function bindTabs() {
  $$('.seg button').forEach((b) => b.addEventListener('click', () => {
    const kbd = document.activeElement === b
    VIEW = b.id === 'tabJson' ? 'json' : 'dash'
    paint()
    if (kbd) $('#tab' + (VIEW === 'json' ? 'Json' : 'Dash')).focus()
  }))
}
function glide() {
  const b = $$('.seg button')[VIEW === 'dash' ? 0 : 1]
  const gl = $('#gl')
  if (!b || !gl) return
  gl.style.width = b.offsetWidth + 'px'
  gl.style.transform = `translateX(${b.offsetLeft - 4}px)`
}
addEventListener('resize', () => { if (P) glide() })
if (document.fonts?.ready) document.fonts.ready.then(() => { if (P) glide() })

function tickCounts() {
  $$('[data-cnt]').forEach((b) => {
    const to = +b.dataset.cnt
    b.textContent = 0
    if (REDUCED || to === 0) { b.textContent = to; return }
    const t0 = performance.now(), dur = 700
    ;(function f(t) {
      const k = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - k, 3)
      b.textContent = Math.round(to * e)
      if (k < 1) requestAnimationFrame(f)
    })(t0)
  })
}

function measureToggles() {
  $$('.about-t').forEach((n) => { if (overflows(n, 4)) fold(n) })
  $$('.r-desc').forEach((n) => { if (overflows(n, 3)) fold(n) })
}
function overflows(n, lines) {
  const lh = parseFloat(getComputedStyle(n).lineHeight) || 24
  return n.scrollHeight > lh * lines + 2
}
function fold(n) {
  n.classList.add('clamp')
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'more mono'
  b.innerHTML = `read more${ic('chev')}`
  n.after(b)
  b.addEventListener('click', () => {
    n.classList.toggle('clamp')
    b.classList.toggle('open')
    if (!n.classList.contains('clamp')) b.remove()
  })
}

function selectText(node) {
  const r = document.createRange()
  r.selectNodeContents(node)
  const s = getSelection()
  s.removeAllRanges()
  s.addRange(r)
}
async function copyTo(btn, txt, revertTxt) {
  const label = btn.querySelector('span')
  const prev = label ? label.textContent : btn.title
  const flash = () => {
    btn.classList.add('copied')
    if (label) label.textContent = 'copied'
    else btn.title = 'copied'
    setTimeout(() => {
      btn.classList.remove('copied')
      if (label) label.textContent = prev
      else btn.title = revertTxt || prev
    }, 1300)
  }
  try { await navigator.clipboard.writeText(txt); flash() }
  catch {
    const ta = document.createElement('textarea')
    ta.value = txt
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.append(ta)
    ta.select()
    try { document.execCommand('copy'); flash() } catch { }
    ta.remove()
  }
}

function pushHist(slug) {
  hist = hist.filter((h) => h !== slug)
  hist.push(slug)
  hist = hist.slice(-12)
  hi = hist.length
  draft = ''
}
function clearAll() {
  P = null; RAW = null
  VIEW = 'dash'
  input.value = ''
  out.innerHTML = ''
  cons.classList.remove('ok', 'bad')
  go.disabled = false
  goLbl.textContent = 'resolve'
  icon('arrow')
  history.replaceState(null, '', location.pathname)
  dimLog('awaiting input — paste a url, type a slug, or hit an example')
}

$('#f').addEventListener('submit', (e) => { e.preventDefault(); if (!busy) resolve(input.value) })

input.addEventListener('input', () => {
  cons.classList.remove('bad')
  $('.con-title').classList.toggle('hot', !!parseUrl(input.value).slug)
})
input.addEventListener('focus', () => $('.con-title').classList.add('hot'))
input.addEventListener('blur', () => $('.con-title').classList.remove('hot'))
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (!hist.length || busy) return
    e.preventDefault()
    if (hi === hist.length) draft = input.value
    hi += e.key === 'ArrowUp' ? -1 : 1
    hi = Math.max(-1, Math.min(hi, hist.length - 1))
    input.value = hi === -1 ? draft : hist[hi]
    const l = input.value.length
    input.setSelectionRange(l, l)
  }
})

$$('.ex').forEach((b) => b.addEventListener('click', () => {
  if (busy) return
  input.value = b.dataset.u
  resolve(b.dataset.u)
}))

$('#clearBtn').addEventListener('click', clearAll)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { clearAll(); input.blur() }
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault()
    input.focus()
    input.select()
  }
})

const mast = $('.mast')
addEventListener('scroll', () => mast.classList.toggle('scrolled', scrollY > 6), { passive: true })

document.addEventListener('animationend', (e) => {
  if (e.target.classList?.contains('rv')) e.target.classList.add('run')
})

const srvEls = $$('.srv')
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((es) => es.forEach((x) => {
    if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target) }
  }), { threshold: 0.08, rootMargin: '0px 0px -6% 0px' })
  srvEls.forEach((n) => io.observe(n))
} else srvEls.forEach((n) => n.classList.add('in'))

const curlHost = $('#curlHost')
curlHost.textContent = location.origin.startsWith('http') ? location.origin : 'https://tross-linkedin-profile-api-jet.vercel.app'
$('#curlCopy').addEventListener('click', function () { copyTo(this, $('#curlText').textContent, 'copy') })

const cv = $('#fx')
const ctx = cv.getContext('2d')
let pts = [], W = 0, H = 0, lastT = 0
const dpr = () => devicePixelRatio || 1
function size() {
  W = cv.width = innerWidth * dpr()
  H = cv.height = innerHeight * dpr()
  const n = Math.min(64, Math.round(W * H / 360000))
  pts = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .16 * dpr(), vy: (Math.random() - .5) * .16 * dpr() }))
}
size()
addEventListener('resize', size)

function frame(t) {
  requestAnimationFrame(frame)
  if (REDUCED || document.hidden) return
  const dt = Math.min((t - lastT) / 16.7 || 1, 3)
  lastT = t
  ctx.clearRect(0, 0, W, H)
  const D = 150 * dpr()
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    a.x += a.vx * dt; a.y += a.vy * dt
    if (a.x < 0 || a.x > W) a.vx *= -1
    if (a.y < 0 || a.y > H) a.vy *= -1
    for (let j = i + 1; j < pts.length; j++) {
      const b = pts[j], dx = a.x - b.x, dy = a.y - b.y
      const d2 = dx * dx + dy * dy
      if (d2 < D * D) {
        ctx.strokeStyle = `rgba(122,158,255,${.14 * (1 - Math.sqrt(d2) / D)})`
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }
    ctx.fillStyle = 'rgba(150,178,255,.4)'
    ctx.beginPath()
    ctx.arc(a.x, a.y, 1.2 * dpr(), 0, 7)
    ctx.fill()
  }
}
requestAnimationFrame(frame)

$('#conTitle').textContent = location.origin.startsWith('http')
  ? location.origin.replace(/^https?:\/\//, '') + ' — profile resolver'
  : 'profile resolver'
$('#clearBtn').classList.add('on')
dimLog('awaiting input — paste a url, type a slug, or hit an example')

const q = new URLSearchParams(location.search).get('url')
if (q) {
  input.value = q
  resolve(q)
} else {
  input.focus()
}
