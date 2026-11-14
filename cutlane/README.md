# CutLane (cutlane.io)

One web app for video editors who clip for **Whop Content Rewards** campaigns:

**Browse campaigns → pick one → research YouTube hooks → import finished clips → post (manual in V1) → capture post links → submit to Whop → track approved / rejected.**

Stack: Next.js 15 (App Router) + TypeScript, Tailwind CSS v4, Postgres (Supabase). All Whop and YouTube calls run on the server. Tokens and client secrets never reach the browser: there are no `NEXT_PUBLIC_` variables.

---

## Quick start (demo mode, no credentials)

```bash
cd cutlane
npm install
npm run dev          # http://localhost:3000
```

Click **Enter the demo**. With no variables set, every integration runs in **demo mode**:

| Integration | Demo behaviour |
| --- | --- |
| Whop | Labelled mock campaigns (`[DEMO]`), demo sign-in, simulated submissions with **Simulate review** (approve/reject) buttons |
| YouTube | Mock channels and videos with a simulated player, so hook notes still work |
| Database | Embedded Postgres ([PGlite](https://pglite.dev)) in `./.data/pglite`, migrated automatically on start |
| Storage | Uploaded clips go to `./.data/uploads` |

A yellow banner shows while anything is mocked. **/status** (sidebar → Integrations status) lists what is live and what is mocked.

Each integration switches to its **real API on its own** as soon as its variables are present. No code changes are needed.

## Going live

1. Copy the template: `cp .env.example .env.local`
2. Generate the encryption key: `npm run keygen` → `TOKEN_ENCRYPTION_KEY`.
3. **Whop** ([Developer Dashboard](https://whop.com/dashboard/developer)): create an app, add the redirect URI `https://YOUR_DOMAIN/api/auth/whop/callback` (exact match), and copy `WHOP_CLIENT_ID` (`app_…`) and `WHOP_CLIENT_SECRET`. Select the scopes that allow reading bounties and creating bounty submissions and files, and list them in `WHOP_OAUTH_SCOPES`. (Which scopes these are is still an open question, see below.)
4. **YouTube**: Google Cloud → enable *YouTube Data API v3* → API key → `YOUTUBE_API_KEY`. Restrict the key to that API.
5. **Supabase**: create a project and set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, plus `DATABASE_URL` (Project Settings → Database → *Transaction pooler* connection string). Then run:
   ```bash
   npm run db:migrate
   ```
   The private `clips` bucket is created on the first upload (or create it yourself; the name is set by `SUPABASE_CLIPS_BUCKET`).
6. Set `APP_URL` to your https URL, then `npm run build && npm start` (or deploy to Vercel or similar).

> `DATABASE_URL` is one variable beyond the list in the brief. Supabase's JS client can't run raw SQL migrations or transactions, so the server talks to Postgres directly. The same SQL runs on the demo PGlite database and on Supabase.
>
> `SUPABASE_ANON_KEY` is accepted but unused in V1, because everything goes through the server. Row Level Security is **enabled with no policies** on every table, so the anon key can't read anything.

## The first real Whop call

On the first live `GET /bounties` (and on the first submission), CutLane:

- prints the raw JSON to the server log, and
- saves it in `api_samples`, shown on **/status → Campaign fields check** next to the list of every key the API returned.

### Campaign card fields

| Field | Source | Shown when |
| --- | --- | --- |
| Title, type, requirements, reward per accepted clip, budget, spots left, brand + logo, countries, status | `title`, `business_goal_type`, `description`, `gross_reward_amount`, `budget_amount`, `spots_remaining`, `hosting_account`, `allowed_country_codes`, `status` | Confirmed in Whop's docs |
| Net reward after fee, accepted deliverables, currency | `net_reward_amount`, `accepted_deliverable_types`, `currency` | Also documented on `GET /bounties` |
| Available content link | URLs found in `description` | When the description contains a link |
| Reward per 1,000 views, min/max payout, flat fee bonus, platforms, brand category | **Not in Whop's docs** | **Hidden for live data** until you confirm the key in the raw sample and add it to `UNVERIFIED_FIELD_PATHS` in `src/lib/whop/campaigns-core.ts` |

Nothing is guessed: a field appears only when the API actually returns it. Demo campaigns include every field, so the full card can be reviewed.

## How it works

```
src/
  app/
    page.tsx                     Landing + sign in
    (app)/campaigns              List (filters: search, type, country, min reward, status, platform*) + detail
    (app)/research               Channel search → channel's long videos → video + hook notes
    (app)/swipe                  Swipe file (search notes, tags, videos)
    (app)/clips                  Library, import (/clips/new), clip page (post → submit → track)
    (app)/submissions            Status list, sync with Whop
    (app)/status                 Integration modes, migrations, raw Whop samples
    actions.ts                   All mutations (server actions, zod-validated, user-scoped)
    api/auth/whop/start|callback OAuth 2.1 + PKCE
    api/uploads/local            Demo-only signed PUT target for uploads
    api/clips/[id]/file          Owner-only playback (signed Supabase URL in live mode)
  lib/
    env.ts                       Config + per-integration demo/live detection
    crypto(-core).ts             AES-256-GCM token encryption, HKDF sub-keys, HMAC
    db/                          PGlite or postgres.js behind one interface; migration runner
    whop/                        oauth, client (refresh with rotation lock), campaigns, submissions + files
    youtube/                     Data API client with Postgres cache + daily quota counter
    posting/                     Per-platform URL validation, checklists, public link check
    mock/                        Demo campaigns, channels and videos
supabase/migrations/0001_init.sql
docs/V2-DESIGN.md
```

### Security

- **Whop sign-in**: authorization code flow with PKCE (S256), `state` checked in constant time, and the verifier held in an encrypted, httpOnly, 10-minute cookie scoped to `/api/auth/whop`. The code exchange and the client secret stay on the server.
- **Tokens**: access and refresh tokens are encrypted with AES-256-GCM (key derived from `TOKEN_ENCRYPTION_KEY` with HKDF). Refresh tokens rotate, with one refresh in flight per user. Logout revokes the refresh token on Whop.
- **Sessions**: random 256-bit token in an httpOnly `SameSite=Lax` cookie. Only its SHA-256 is stored.
- **Server actions**: Next.js checks the request origin. Every query is scoped to the signed-in user.
- **Uploads**: the browser PUTs straight to a one-time signed URL (Supabase) or an HMAC-signed, expiring local URL. Keys are `userId/uuid.mp4`, checked server-side; MP4 only, 1 GB max.
- **Link checks**: only allow-listed platform hosts are requested, and redirects are re-checked hop by hop (no SSRF). Page bodies are never downloaded.
- **YouTube**: metadata API plus the official embedded player (`youtube-nocookie.com`). No downloading or scraping. The API key appears in no URL or error message the browser can see.

### Whop endpoints used

Base `https://api.whop.com/api/v1`, `Authorization: Bearer <user token>`, `Api-Version-Date: $WHOP_API_VERSION_DATE`.

| Step | Call |
| --- | --- |
| Campaigns | `GET /bounties?status=open&business_goal_type=&country=&query=&first=30&after=` · `GET /bounties/{id}` |
| File upload | `POST /files` → `PUT upload_url` (server-to-server, with `upload_headers`) → poll `GET /files/{id}` until `upload_status = ready` |
| Submit | `POST /bounty_submissions` `{ bounty_id, deliverable: { urls[≤10], file_ids, caption } }` with an `Idempotency-Key` |
| Status | `GET /bounty_submissions` → `submitted` (pending), `approved`, `denied` (rejected) |
| OAuth | `https://api.whop.com/oauth/authorize`, `/token`, `/userinfo`, `/revoke` |

### Submission rules enforced

A clip can be submitted only when it is linked to an **open** campaign, its footage rights are confirmed, it has no active or approved submission, and **at least one post link is saved and loads publicly**. When a platform blocks the automatic check (HTTP 403/429 or a login wall, common on Instagram and TikTok), the editor must tick *"I opened this link logged-out and it loads"*. The clip file is attached only if the campaign accepts `media`.

### YouTube quota

`search.list` costs 100 units; `channels`, `playlistItems` and `videos` cost 1 unit each. One channel search costs about 101 units and opening a channel about 2. Results are cached in `yt_cache` (searches 24 h, uploads 6 h), units are counted per day in `yt_quota`, and new calls stop at 95% of the 10,000-unit default quota. Cached results keep working after that.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (URL validation, field normalisation, encryption, durations) |
| `npm run lint` | Type-check |
| `npm run db:migrate` | Apply `supabase/migrations/*.sql` to `DATABASE_URL` |
| `npm run keygen` | Print a new 32-byte base64 key |

## Open questions (carried over from the spec)

- Do per-1,000-views Content Rewards campaigns appear in `GET /bounties`, or only flat-fee bounties? The first live call will show it on /status.
- Which OAuth scopes allow reading bounties and creating submissions and files? Set them in `WHOP_OAUTH_SCOPES`.
- Do the "to verify" fields exist in the API? Map them in `UNVERIFIED_FIELD_PATHS` if they do.
- Whop's web URL for a single bounty isn't documented, so "Open on Whop" links to the brand's storefront (`whop.com/{route}`).
- Large files: the Whop upload uses single-part PUT (fine up to 5 GB). Multipart upload isn't implemented.

## V2

V2 is designed but not built: an embedded editor SDK with AI clip cutting (4/6/8/10/20 s) and captions, and auto-posting through Ayrshare or Metricool. See [docs/V2-DESIGN.md](docs/V2-DESIGN.md). The schema already has `clips.origin = 'editor'` and `post_links.source = 'auto'`.
