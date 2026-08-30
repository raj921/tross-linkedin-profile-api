# LinkedIn Profile API

Reverse-engineered LinkedIn (Voyager) API behind a tiny hosted HTTP service. Give it a public LinkedIn profile URL, get back structured JSON: name, headline, location, about, experience, education, skills, certifications, languages, and profile images when available.

No browser automation anywhere — the service calls LinkedIn's own internal endpoints directly, the same ones LinkedIn's frontend uses.

## Live API

**Base URL:** `https://tross-linkedin-profile-api-jet.vercel.app`

### `GET /profile?url=<linkedin-profile-url>`

```bash
curl "https://tross-linkedin-profile-api-jet.vercel.app/profile?url=https://www.linkedin.com/in/williamhgates/"
```

Accepts a full profile URL (`https://www.linkedin.com/in/<slug>/`) or a bare slug (`<slug>`).

**200 response:**

```json
{
  "url": "https://www.linkedin.com/in/williamhgates/",
  "publicId": "williamhgates",
  "name": "Bill Gates",
  "headline": "...",
  "location": "Seattle, Washington, United States",
  "about": "...",
  "images": { "profile": "https://media.licdn.com/...", "background": null },
  "experience": [
    { "title": "Co-chair", "company": "Gates Foundation", "start": "2000", "end": null, "current": true, "description": null }
  ],
  "education": [
    { "school": "Lakeside School", "degree": null, "field": null, "start": null, "end": null }
  ],
  "skills": [],
  "certifications": [],
  "languages": [],
  "_meta": { "fetchedAt": "...", "source": "voyager", "cache": "hit" }
}
```

**Errors** — JSON envelope `{ "error": { "code", "message" } }`:

| Status | Code | Meaning |
|---|---|---|
| 400 | `missing_url` / `bad_url` | no `url` param, or not a linkedin.com/in/ profile URL |
| 404 | `profile_not_found` | profile doesn't exist or isn't visible to the backend account |
| 502 | `linkedin_auth` | LinkedIn session cookie expired/flagged — rotate `LI_AT` |
| 503 | `linkedin_rate_limited` | LinkedIn is throttling; retry shortly |

### `GET /healthz`

Liveness probe. Returns `{ "ok": true }`.

## Setup

Requires Node 20+. No dependencies — stdlib `http` + `fetch` only.

```bash
cp .env.example .env   # fill in values
npm start              # listens on $PORT (default 3000)
npm run check          # offline mapper test; LI_LIVE=1 npm run check adds a live API test
```

### Environment variables

| Var | What |
|---|---|
| `LI_AT` | `li_at` session cookie from a logged-in linkedin.com session (browser devtools → Application → Cookies) |
| `JSESSIONID` | `JSESSIONID` cookie value, without surrounding quotes |
| `LI_QUERY_ID` | graphql queryId for profile sections (skills/certs/languages). LinkedIn rotates these; capture from a logged-in profile page's network tab |
| `PORT` | default 3000 |

## Approach

1. **Reverse engineering.** Watched what LinkedIn's own frontend calls, then replicated the requests as plain HTTP. Two endpoint families:
   - `GET /voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=<slug>&decorationId=...FullProfileWithEntities-93` — one call returns a normalized JSON graph (`included` array) with the profile, all positions, position groups, education, companies, schools, geo, and industry entities.
   - `GET /voyager/api/graphql?variables=(profileUrn:...,sectionType:<skills|certifications|languages>)&queryId=...` — per-section data LinkedIn lazy-loads on the profile page.
2. **Auth.** A personal `li_at` session cookie + matching `JSESSIONID` (sent as `csrf-token` header) — the same credentials the browser uses, sent from the server. No login flow, no password stored.
3. **Normalization.** The Voyager response is a graph of `urn:li:fsd_*` entities with `multiLocale*` fields and image `artifacts`; `map.js` flattens it into the response schema above (English locale, largest image artifact, resolved references).
4. **Ops.** 15s upstream timeout, explicit error mapping (401/403/999 → auth, 404 → not found, 429 → rate limit), 1h in-memory per-slug cache to avoid hammering LinkedIn.

## Known limitations

- **Session cookie decay.** `li_at` sessions expire and can be invalidated early — LinkedIn pins sessions to IP/client fingerprint, so using the same cookie from a different IP can kill it. Rotation is manual (swap env var, restart). Upgrade path if flagging recurs in production: a residential proxy near the account's home IP.
- **Decoration/queryId churn.** The `FullProfileWithEntities-N` decoration id and the graphql `queryId` are LinkedIn-internal and rotate over time. Both are config, not code — `LI_QUERY_ID` is an env var; the decoration id is one constant in `li.js`.
- **Visibility ceiling.** The API sees what the backend LinkedIn account sees. Profiles with restricted visibility return less data or 404.
- **Rate limits.** LinkedIn throttles aggressively. The 1h cache absorbs repeat lookups; sustained bulk scraping would need request pacing and is out of scope.
- **Sections are best-effort.** If the graphql section call fails, skills/certifications/languages degrade to `[]` rather than failing the whole request — core profile data always ships.
- **Unofficial API.** No SLA from LinkedIn; endpoints can change without notice. That is the nature of the exercise.
