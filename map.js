const en = (ml) => (ml && (ml.en_US || Object.values(ml)[0])) || null

function index(included) {
  const byUrn = new Map(), byType = new Map()
  for (const e of included || []) {
    const t = (e.$type || '').split('.').pop()
    if (e.entityUrn) byUrn.set(e.entityUrn, e)
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t).push(e)
  }
  return { byUrn, byType }
}

const date = (dr) => {
  if (!dr) return { start: null, end: null }
  const f = (d) => (d ? [d.year, d.month].filter(Boolean).join('-') : null)
  return { start: f(dr.start), end: f(dr.end) }
}

const img = (pic) => {
  const vi = pic?.displayImageReference?.vectorImage || pic?.vectorImage
  if (!vi?.rootUrl || !vi.artifacts?.length) return null
  const big = vi.artifacts.reduce((a, b) => (b.width > a.width ? b : a))
  return vi.rootUrl + big.fileIdentifyingUrlPathSegment
}

export function mapProfile(dash, slug, sections = {}) {
  const { byUrn, byType } = index(dash.included)
  const p = (byType.get('Profile') || [])[0]
  if (!p) return null

  const positions = (byType.get('Position') || []).map((x) => ({
    title: en(x.multiLocaleTitle) || x.title,
    company: en(x.multiLocaleCompanyName) || x.companyName,
    ...date(x.dateRange),
    current: !!(x.dateRange && !x.dateRange.end),
    description: x.description || null,
  }))

  const education = (byType.get('Education') || []).map((x) => ({
    school: x.schoolName || byUrn.get(x['*school'])?.name || null,
    degree: x.degreeName || null,
    field: x.fieldOfStudy || null,
    ...date(x.dateRange),
  }))

  const name = `${en(p.multiLocaleFirstName) || p.firstName || ''} ${en(p.multiLocaleLastName) || p.lastName || ''}`.trim()

  return {
    url: `https://www.linkedin.com/in/${slug}/`,
    publicId: slug,
    name,
    headline: en(p.multiLocaleHeadline) || p.headline || null,
    location: p.locationName || byUrn.get(p.geoLocation?.['*geo'])?.defaultLocalizedName || null,
    about: en(p.multiLocaleSummary) || p.summary || null,
    images: { profile: img(p.profilePicture), background: img(p.backgroundPicture) },
    experience: positions,
    education,
    skills: sections.skills || [],
    certifications: sections.certifications || [],
    languages: sections.languages || [],
    _meta: { fetchedAt: new Date().toISOString(), source: 'voyager' },
  }
}
