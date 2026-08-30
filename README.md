# LinkedIn Profile API

Reverse-engineered Voyager JSON API. `GET /profile?url=<linkedin url>` → `name/headline/location/about/experience/education/images`.

Live: `https://tross-linkedin-profile-api-jet.vercel.app`

```bash
curl -s "https://tross-linkedin-profile-api-jet.vercel.app/profile?url=https://www.linkedin.com/in/rbranson/" | jq
```

## Setup

```bash
cp .env.example .env  # set LI_AT, JSESSIONID
npm start             # :3000
npm run check         # offline
LI_LIVE=1 npm run check # live
```

## Auth

`LI_AT` + `JSESSIONID` cookies (`li.js:4`). Rotate on `502 linkedin_auth`.

## Limits

- Session decays (IP pinned) — manual rotation or `LI_EMAIL`/`LI_PASSWORD` (`li.js:31`).
- `queryId` rotates (`LI_QUERY_ID`).
- Rate limits — `1h` `Map` cache (`server.js:10`), `stale-while-revalidate` (`server.js:71`).
- Unofficial — no SLA.

Repo: `https://github.com/raj921/tross-linkedin-profile-api`
