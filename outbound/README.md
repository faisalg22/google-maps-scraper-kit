# Cyberalpha Outbound — backend

The database and API behind the outbound system in the PRD ("AI Outbound Sales System for Manufacturing
IT & Security Leaders"). It pulls manufacturing companies from Google Maps through **Apify**, stores them
in **Supabase (Postgres, Canada region)**, and serves the numbers the pipeline dashboard shows.

```
Apify (compass/crawler-google-places)
   │  run succeeds → webhook (x-import-secret)
   ▼
Edge Function  apify-import ──► import_apify_places()  ──► companies, leads, consent_log
Edge Function  apify-start   (starts a pull; admin or scheduled)
Edge Function  api           (summary, leads, events, meetings, kill switch — admin users only)
```

| Piece | Where |
|---|---|
| Supabase project | `cyberalpha-outbound` (`xkewgvjzpzcltrciemkf`), region `ca-central-1` |
| Schema | `supabase/migrations/` (applied in order) |
| Functions | `supabase/functions/{apify-import,apify-start,api}` |

## Database

Tables follow PRD §9: `companies`, `leads`, `research_notes`, `campaigns`, `sequences`, `messages`,
`events`, `meetings`, `suppression_list`, `consent_log`, plus `scrape_runs` and `app_settings`.

Built-in rules (enforced in the database, not just the app):

- **CASL gate** — a lead can't move to `queued` without a consent basis in `consent_log`, or if its
  address is on the suppression list.
- **Max 2 active contacts per company** (PRD §7.1).
- **Unsubscribe / complaint** events add the address to `suppression_list` permanently; a later
  import never brings it back.
- **Events drive the funnel** — inserting a `sent`, `reply`, `bounce` event or a `meetings` row
  updates the lead's stage and `first_emailed_at` / `replied_at` / `booked_at`.
- **Kill switch** — `app_settings.sending_paused` starts as `true`.
- **RLS is on for every table with no public policies.** Browsers never read tables directly;
  only the Edge Functions (service role) do, after checking the caller.

Reporting: `pipeline_summary()` (totals) and the `pipeline_daily` view (last 90 days).

### Import rules (`import_apify_places`)

- Skips permanently closed places and non-manufacturing categories (restaurants, rentals, dealers…).
- Dedupes companies by Google place id, then by website domain (branches merge into one company).
- Keeps an email only if it is on the company's own domain, or a free-mail address the company
  publishes (small shops). Third-party and junk addresses are dropped.
- At most 3 email leads per company, generic inboxes (`info@`, `sales@`) first.
- Records consent basis `conspicuous_publication` with the website as evidence.
  **Have a Canadian lawyer confirm this basis before sending (PRD §8).**

## Finish the setup (one time)

1. **Secrets** — Supabase dashboard → Edge Functions → Secrets (or `supabase secrets set`):
   - `APIFY_TOKEN` — your Apify API token (Apify → Settings → API & Integrations)
   - `IMPORT_SECRET` — any long random string (`openssl rand -hex 32`); Apify sends it back on the webhook
   - `ADMIN_EMAILS` — comma-separated emails allowed to use the API
   - `ALLOWED_ORIGIN` — optional; the dashboard's origin for CORS (defaults to `*`)
2. **Your login** — Supabase dashboard → Authentication → Users → *Add user* with an email from
   `ADMIN_EMAILS`. Turn off public sign-ups (Authentication → Providers → Email) so nobody else can
   create an account.

## Using it

Base URL: `https://xkewgvjzpzcltrciemkf.supabase.co/functions/v1`

Start a new pull (lands in the database automatically when Apify finishes):

```bash
curl -X POST "$BASE/apify-start" -H "x-import-secret: $IMPORT_SECRET" -H "Content-Type: application/json" \
  -d '{"location":"Ontario, Canada","maxPerSearch":40,"maxChargeUsd":3}'
```

Re-import an existing Apify run:

```bash
curl -X POST "$BASE/apify-import" -H "x-import-secret: $IMPORT_SECRET" -H "Content-Type: application/json" \
  -d '{"runId":"<apify run id>"}'
```

Dashboard API (needs a signed-in admin's access token as `Authorization: Bearer …`):

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/summary` | — |
| GET | `/api/daily` | — |
| GET | `/api/leads` | `?stage=&q=&limit=&offset=` |
| PATCH | `/api/leads/:id` | `{stage, notes, title, full_name}` |
| POST | `/api/events` | `{lead_id, type: sent\|reply\|bounce\|unsubscribe\|complaint\|out_of_office}` |
| POST | `/api/meetings` | `{lead_id, scheduled_for, booking_provider}` |
| PATCH | `/api/meetings/:id` | `{status: held\|no_show\|cancelled}` |
| GET/PATCH | `/api/settings` | `{sending_paused: true\|false}` |
| GET | `/api/runs` | — |

### Scheduled pulls (optional)

Enable `pg_cron` and `pg_net` in the dashboard, then (replace the secret):

```sql
select cron.schedule('weekly-apify-pull', '0 13 * * 1', $$
  select net.http_post(
    url := 'https://xkewgvjzpzcltrciemkf.supabase.co/functions/v1/apify-start',
    headers := jsonb_build_object('x-import-secret', '<IMPORT_SECRET>', 'Content-Type', 'application/json'),
    body := '{"maxPerSearch":40,"maxChargeUsd":3}'::jsonb);
$$);
```

## Deploying changes

```bash
cd outbound
supabase link --project-ref xkewgvjzpzcltrciemkf
supabase db push                       # new migrations
supabase functions deploy apify-import --no-verify-jwt
supabase functions deploy apify-start  --no-verify-jwt
supabase functions deploy api
```

`apify-import` and `apify-start` check the import secret or an admin login themselves, so they are
deployed without Supabase's JWT check (Apify's webhook can't send a Supabase JWT).

## Data handling

Lead emails and names are personal data under PIPEDA/CASL. Keep exports out of git (`*.csv` is
ignored), honour deletion requests by deleting the lead (cascades) and adding the address to
`suppression_list` with reason `deletion_request`.
