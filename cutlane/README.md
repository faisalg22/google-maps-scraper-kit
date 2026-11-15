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
| Billing | Test mode: simulated checkout and Stripe events, no charges. After **Enter the demo** you land on Pricing; start the trial to unlock the app |

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

## Deploying

**Production is strict on purpose.** In a production build (`npm run build && npm start`), the server **refuses to start** if any required setting is missing, and it prints exactly which ones. Required: `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, the Whop and Stripe keys plus the webhook secret, Supabase Storage, `YOUTUBE_API_KEY`, and an https `APP_URL`. Demo sign-in, mock data, simulated billing, the local database and local file storage are all disabled. So a forgotten key can't turn into free subscriptions, an open `/admin`, or data written to a disk that disappears.

For a staging or review deploy without real keys, set `ALLOW_DEMO=true`. Never set it on the real site.

**Hosting.** The app works on Vercel or any Node host (Railway, Fly, Render, a VPS):
- **Submitting with the clip file** runs as a resumable job. Each request does one short step: create and upload the file to Whop, check processing status, then create the submission. The browser drives it, and resumes it if the tab was closed. Only the upload step is long, bounded by the clip size (max 1 GB). Its route allows up to 300 s (`maxDuration`); on Vercel use Fluid compute or Pro.
- **Daily cron:** `vercel.json` schedules `/api/cron/youtube-retention`, which refreshes or expires stored YouTube data within 30 days as the YouTube API policy requires. Set `CRON_SECRET`. On other hosts, call it daily with `Authorization: Bearer $CRON_SECRET`.
- **Migrations:** run `npm run db:migrate` against `DATABASE_URL` on every deploy that adds a migration.

**Legal pages.** `/terms` and `/privacy` are linked from the landing page, pricing (next to the trial button), Settings and the research pages. Set `LEGAL_ENTITY_NAME` and `LEGAL_CONTACT_EMAIL`. The text is a solid starting template, not legal advice: have it reviewed before launch.

## Billing (Stripe)

There is **no free plan**. A signed-in user without a plan is sent to `/pricing`.

| Plan | Price | Trial | Status |
| --- | --- | --- | --- |
| Beginner | $29/mo ($290/yr with annual flag) | 3 days, card required, one per account | Self-serve |
| Clipper | $79/mo ($790/yr) | none | **Coming soon**: waitlist only, never charged while `CLIPPER_AVAILABLE=false` |
| Custom | custom | none | "Contact sales" form → admin assigns limits + seats at `/admin` |

All prices, limits, features and V2 caps (render minutes, AI cuts) live in **`src/config/plans.ts`**.

### One entitlements helper

`src/lib/billing/entitlements.ts` maps a subscription to **access, limits and features**. It's pure and fully unit-tested, and everything uses it through `src/lib/billing/server.ts`:

- pages: `requirePageAccess("write" | "read")`
- server actions and API routes: `assertCanWrite(feature)`, `consume(metric)` / `release()`, `assertTotalLimit(metric)`
- UI: meters, banners and upgrade prompts

| Access | When | What works |
| --- | --- | --- |
| full | trialing, active, canceling (until period end) | everything in the plan |
| grace | payment failed < 3 days ago | everything, plus a red banner |
| restricted | grace over, unpaid, paused, trial payment never landed | **read-only**: library, notes, submissions; no new work |
| none | no plan, canceled, incomplete checkout | sent to pricing; data kept |

**Limits.** Usage shows amber at 80%. At 100% the action is blocked with an upgrade prompt. Nothing is ever deleted: after a downgrade, data over the new limit stays but nothing new can be added.

- **Monthly metrics** (`clips_monthly`, `submissions_monthly`, `render_minutes_monthly`, `ai_cuts_monthly`) use atomic counters keyed by the billing-period start. They reset on the billing date with no cron job, even on annual plans. Deleting a clip doesn't refund the unit. A submission unit is refunded if Whop rejects the call.
- **Totals** (saved channels, notes, accounts per platform, seats) are counted live.

### Stripe setup

1. Stripe Dashboard (test mode first) → Products: create **Beginner** with a $29/month price and **Clipper** with a $79/month price. Optionally add $290/$790 yearly prices.
2. Put the price IDs in `STRIPE_PRICE_*`, and set `STRIPE_SECRET_KEY`.
3. Webhook endpoint: `https://YOUR_DOMAIN/api/stripe/webhook` with the events
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.payment_failed`, `invoice.paid`.
   Copy the signing secret to `STRIPE_WEBHOOK_SECRET`. Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
4. Customer Portal (Settings → Billing → Customer portal): allow updating the payment method, canceling at period end, and switching between your Beginner/Clipper prices.
5. Recommended: Settings → Billing → Subscriptions → Smart Retries on, and "if all retries fail: mark the subscription as unpaid". CutLane's own 3-day grace rule applies either way.

How it works:

- **Checkout** uses `payment_method_collection: "always"`. Eligible accounts get a 3-day trial (`trial_period_days: 3`, cancel if no payment method).
- **Webhooks** are signature-verified, de-duplicated by event ID, and protected against out-of-order delivery. A late cancel event for an old subscription never overwrites a newer one. Both period-field shapes are handled (on the subscription, or on its items as in API version 2025-03-31 and later).
- **After checkout**, the success page syncs the subscription straight away instead of waiting for the webhook.

**Test mode** (no Stripe keys): checkout is simulated, and `/billing` shows buttons that simulate the trial ending, a payment failing, the grace period expiring, the card being updated, cancelling and resuming. They go through the same subscription rules the webhooks use.

### Flags and other variables

| Variable | Effect |
| --- | --- |
| `BILLING_ANNUAL_ENABLED=true` | Monthly/annual toggle on pricing (needs `STRIPE_PRICE_*_ANNUAL` when live) |
| `CLIPPER_AVAILABLE=true` | Clipper checkout + V2 features (editor, AI cuts, auto-post). Keep false until V2 ships |
| `ADMIN_WHOP_USER_IDS` | Who can open `/admin` (in demo mode the demo account can) |
| `RESEND_API_KEY`, `SALES_NOTIFY_EMAIL`, `SALES_FROM_EMAIL` | Email for "Contact sales". Leads are always saved; the email is skipped if unset |

Seats are stored and enforced in entitlements (1 on Beginner/Clipper, admin-set on Custom). A team-invite flow isn't built yet.

## Light and dark theme

There are three options: **Light**, **Dark** and **System** (the default, which follows the device's `prefers-color-scheme`). The toggle is in the sidebar header, the mobile top bar (icon-only, 40px tap targets), the public pages' headers, and **Settings → Appearance**.

**Where the choice is stored and how it applies**
- **Signed-in users:** saved in `users.theme_preference` (migration `0003_theme.sql`). The server renders it into `<html data-theme-pref>`, so every device starts in the right theme. Other tabs pick up a change through `storage` events; other devices re-read it when their tab regains focus.
- **Signed-out visitors:** saved in `localStorage` (`cl-theme`). On first sign-in, if the account has no saved theme yet, the visitor's choice is adopted. If the account already has one, the account's choice wins.
- **No flash on load:** an inline script in `<head>` (`THEME_INIT_SCRIPT` in `src/lib/theme.ts`) sets `html.dark` before first paint. It still works if the JavaScript bundles fail to load.

**Design tokens** (`src/styles/tokens.css`, the single source of truth; preview at **`/design`**)
- **Structure:** raw palette, then light semantic tokens (`:root, .light`), then dark (`.dark`), then the Tailwind v4 config. That config is the `@custom-variant dark`, the equivalent of `darkMode: "class"`, plus the `@theme inline` mapping that turns tokens into utilities. Tailwind v4 is configured in CSS, so there is no `tailwind.config.js`.
- **Layering:** `bg` < `surface` (sidebar, top bar, bottom nav) < `card` (cards, tables, modals, toasts, form fields) < `raised` (hover, chips, inset blocks, meter tracks). Nest at most 3 levels in one region. There are no gradients in app screens; `hero-glow` (violet, under 15%) is used only on the landing hero and pricing page.
- **Accent:** electric violet `#7C5CFF` (`--accent`) for the focus ring, selection, meters and the CTA glow (`btn-cta`, main calls to action only). White text on `#7C5CFF` is 4.35:1, below AA, so button fills use `--primary` `#6A49F0` (5.49:1) and hover `#5B3BDB`. Violet text uses `--primary-strong`: `#A594FF` on dark, `#5B3BDB` on light.
- **Status colors:** each one has a base hue (`--success` `#22C55E`, `--warning` `#F59E0B`, `--danger` `#EF4444`, `--info` `#38BDF8`) for dots, borders and tints; `--*-soft` (10–14%) for badge backgrounds; and `--*-fg` for AA text. The text tone is darker in light mode, and a lighter red in dark mode.
- **Video:** players and the demo player are forced-dark regions (`.dark` on a `--player-bg` letterbox), the same in both themes.
- **Logos:** light and dark variants are in `public/brand/`. The favicon adapts to the browser's own scheme.
- Theme changes animate briefly (200 ms), except under `prefers-reduced-motion`.

**Accessibility checks**
- `tests/theme-contrast.test.ts` checks `tokens.css` in both themes:
  - the exact brand hexes are kept;
  - text, including muted, is ≥4.5:1 on every background level (bg, surface, card, raised, raised-hover);
  - status and violet text is ≥4.5:1 on its tinted badge over every level;
  - button labels are ≥4.5:1;
  - focus ring, form borders and meter bars are ≥3:1.
- `scripts/contrast-audit.mjs` runs axe-core's contrast rule plus a horizontal-overflow check on every page, in light and dark, at mobile and desktop widths.
- The toggle is a WAI-ARIA radio group: arrow keys, Home and End move between options, and each option has a label.

**End-to-end tests**
```bash
rm -rf .data && npm run build && ALLOW_DEMO=true npm start   # fresh demo database
npm run test:e2e                                 # default=system, persists on reload, no flash, sign-in sync, keyboard
node scripts/contrast-audit.mjs --shots ./shots  # every page × light/dark × mobile/desktop
```
These need Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`). It's pre-installed in Claude Code cloud sessions. The sign-in sync test expects the demo account to have no saved theme yet, so run it against a fresh `.data`.

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
| `npm test` | Unit tests (billing: trial/upgrade/downgrade/cancel/payment failure, usage counters on Postgres, webhook signatures; URL validation, field normalisation, encryption) |
| `npm run lint` | Type-check |
| `npm run test:e2e` | Browser tests for the theme (needs a running server + Playwright) |
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
