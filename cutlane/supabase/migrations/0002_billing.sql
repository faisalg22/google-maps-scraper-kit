-- CutLane billing: workspaces, subscriptions, usage counters, plan-limited resources,
-- sales leads and the Clipper waitlist. Never deletes user data.

-- ── Workspaces (the billing unit; one per user for now) ─────────────────────
create table workspaces (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  owner_user_id       uuid not null references users(id) on delete cascade,
  stripe_customer_id  text unique,
  custom_limits       jsonb not null default '{}'::jsonb,  -- admin overrides for the Custom plan
  seats               integer check (seats is null or seats >= 1), -- admin override; null = plan default
  trial_consumed_at   timestamptz,
  created_at          timestamptz not null default now()
);

create table workspace_members (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'member')),
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id),
  unique (user_id)                          -- a user belongs to one workspace
);

-- One trial per account (user), checked before Checkout offers a trial.
alter table users add column trial_consumed_at timestamptz;

-- Backfill: every existing user gets a personal workspace.
insert into workspaces (name, owner_user_id)
  select coalesce(u.name, u.username, 'My workspace'), u.id from users u;
insert into workspace_members (workspace_id, user_id, role)
  select w.id, w.owner_user_id, 'owner' from workspaces w;

-- ── Subscription (one current row per workspace) ────────────────────────────
create table subscriptions (
  workspace_id            uuid primary key references workspaces(id) on delete cascade,
  plan                    text not null check (plan in ('beginner', 'clipper', 'custom')),
  status                  text not null,      -- Stripe status: trialing, active, past_due, unpaid, canceled, incomplete, incomplete_expired, paused
  source                  text not null check (source in ('stripe', 'mock', 'manual')),
  billing_interval        text not null default 'month' check (billing_interval in ('month', 'year')),
  stripe_subscription_id  text unique,
  stripe_price_id         text,
  trial_start             timestamptz,
  trial_end               timestamptz,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  billing_anchor          timestamptz not null, -- monthly usage counters reset on this day of month
  cancel_at_period_end    boolean not null default false,
  canceled_at             timestamptz,
  past_due_since          timestamptz,          -- first failed payment; 3-day grace starts here
  last_event_at           timestamptz,          -- newest Stripe event applied (ignore older ones)
  updated_at              timestamptz not null default now()
);

-- Webhook idempotency.
create table stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

-- ── Usage ──────────────────────────────────────────────────────────────────
-- Monthly counters keyed by the billing period start, so they reset on the billing date
-- without any cron job. Deleting a clip does not give the unit back.
create table usage_counters (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  metric        text not null,
  period_start  timestamptz not null,
  count         integer not null default 0 check (count >= 0),
  primary key (workspace_id, metric, period_start)
);

-- ── Plan-limited resources ─────────────────────────────────────────────────
create table saved_channels (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  channel_id    text not null,
  title         text not null,
  thumbnail     text,
  subscribers   bigint not null default 0,
  created_at    timestamptz not null default now(),
  unique (workspace_id, channel_id)
);

-- Social accounts the workspace posts from (handles in V1; official connect + auto-post in V2).
create table social_accounts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  platform      post_platform not null,
  handle        text not null check (char_length(handle) between 1 and 60),
  profile_url   text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, platform, handle)
);

-- ── Sales + waitlist ───────────────────────────────────────────────────────
create table sales_leads (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  email            text not null,
  team_size        text not null,
  accounts_needed  text not null,
  message          text,
  user_id          uuid references users(id) on delete set null,
  ip_hash          text,
  email_status     text not null default 'pending',   -- sent | skipped | failed
  created_at       timestamptz not null default now()
);
create index sales_leads_ip_idx on sales_leads(ip_hash, created_at desc);

create table waitlist (
  id          uuid primary key default gen_random_uuid(),
  plan        text not null,
  email       text not null,
  user_id     uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (plan, email)
);

alter table workspaces         enable row level security;
alter table workspace_members  enable row level security;
alter table subscriptions      enable row level security;
alter table stripe_events      enable row level security;
alter table usage_counters     enable row level security;
alter table saved_channels     enable row level security;
alter table social_accounts    enable row level security;
alter table sales_leads        enable row level security;
alter table waitlist           enable row level security;
