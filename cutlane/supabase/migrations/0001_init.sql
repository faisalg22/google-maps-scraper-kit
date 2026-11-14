-- CutLane V1 schema.
-- Runs unchanged on Supabase Postgres (npm run db:migrate, or `supabase db push`)
-- and on the local embedded Postgres used in demo mode.
--
-- All access goes through the Next.js server using a privileged connection.
-- Row Level Security is enabled with NO policies, so the Supabase anon key
-- (and any browser) can read or write nothing directly.


-- ── Users & auth ────────────────────────────────────────────────────────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  whop_user_id  text not null unique,          -- "user_xxx" (OIDC sub)
  username      text,
  name          text,
  avatar_url    text,
  email         text,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Whop OAuth tokens, encrypted with AES-256-GCM (TOKEN_ENCRYPTION_KEY).
create table oauth_tokens (
  user_id            uuid primary key references users(id) on delete cascade,
  provider           text not null default 'whop',
  access_token_enc   text not null,
  refresh_token_enc  text,
  scope              text,
  expires_at         timestamptz not null,
  updated_at         timestamptz not null default now()
);

-- Sessions: the cookie holds a random token; only its SHA-256 is stored.
create table sessions (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index sessions_user_idx on sessions(user_id);

-- ── Whop API observability ──────────────────────────────────────────────────
-- First raw response per endpoint, kept so unconfirmed campaign fields can be
-- checked against what the API really returns (see /status).
create table api_samples (
  endpoint    text primary key,
  payload     jsonb not null,
  captured_at timestamptz not null default now()
);

-- ── YouTube research ────────────────────────────────────────────────────────
create table yt_cache (
  cache_key   text primary key,
  payload     jsonb not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index yt_cache_expires_idx on yt_cache(expires_at);

create table yt_quota (
  day    date primary key,
  units  integer not null default 0
);

-- Hook-notes swipe file: one row per timestamped note.
create table swipe_notes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  video_id           text not null,
  video_title        text not null,
  channel_id         text,
  channel_title      text,
  timestamp_seconds  integer not null check (timestamp_seconds >= 0),
  note               text not null check (char_length(note) between 1 and 2000),
  tags               text[] not null default '{}',
  created_at         timestamptz not null default now()
);
create index swipe_notes_user_idx on swipe_notes(user_id, created_at desc);
create index swipe_notes_video_idx on swipe_notes(user_id, video_id);

-- ── Clips, posts, submissions ───────────────────────────────────────────────
create type clip_status as enum ('draft', 'ready', 'posted', 'submitted', 'approved', 'rejected');
create type clip_origin as enum ('import', 'editor');          -- 'editor' reserved for V2
create type post_platform as enum ('instagram', 'tiktok', 'youtube_shorts');
create type link_check as enum ('unchecked', 'ok', 'blocked', 'failed');
create type post_source as enum ('manual', 'auto');            -- 'auto' reserved for V2

create table clips (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 200),
  campaign_id     text,                 -- Whop bounty id (bnty_...) or demo id
  campaign_title  text,
  storage_key     text not null,        -- path in local store or Supabase bucket
  file_name       text not null,
  mime_type       text not null default 'video/mp4',
  size_bytes      bigint not null check (size_bytes > 0),
  status          clip_status not null default 'ready',
  origin          clip_origin not null default 'import',
  rights_confirmed boolean not null default false, -- footage from campaign source / creator permission
  whop_file_id    text,                 -- set once uploaded to Whop Files
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index clips_user_idx on clips(user_id, created_at desc);

create table post_links (
  id               uuid primary key default gen_random_uuid(),
  clip_id          uuid not null references clips(id) on delete cascade,
  platform         post_platform not null,
  url              text,
  checklist        jsonb not null default '{}'::jsonb,   -- { stepId: true }
  source           post_source not null default 'manual',
  check_status     link_check not null default 'unchecked',
  check_http_status integer,
  check_message    text,
  checked_at       timestamptz,
  manual_confirmed boolean not null default false,       -- editor opened it logged-out
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (clip_id, platform)
);

create table submissions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  clip_id             uuid references clips(id) on delete set null,
  bounty_id           text not null,
  whop_submission_id  text unique,
  status              text not null default 'submitted',  -- in_progress | submitted | approved | denied
  denial_reason       text,
  caption             text,
  urls                text[] not null default '{}',
  file_ids            text[] not null default '{}',
  idempotency_key     text not null unique,
  is_demo             boolean not null default false,
  raw                 jsonb,
  submitted_at        timestamptz not null default now(),
  resolved_at         timestamptz,
  updated_at          timestamptz not null default now()
);
create index submissions_user_idx on submissions(user_id, submitted_at desc);

-- ── Lock everything down for direct (anon/authenticated) access ─────────────
alter table users         enable row level security;
alter table oauth_tokens  enable row level security;
alter table sessions      enable row level security;
alter table api_samples   enable row level security;
alter table yt_cache      enable row level security;
alter table yt_quota      enable row level security;
alter table swipe_notes   enable row level security;
alter table clips         enable row level security;
alter table post_links    enable row level security;
alter table submissions   enable row level security;
