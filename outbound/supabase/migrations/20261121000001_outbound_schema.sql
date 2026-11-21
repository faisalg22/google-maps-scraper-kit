-- Cyberalpha outbound system: core schema (PRD section 9 "Core tables").
-- All tables have RLS enabled with NO public policies: only the service role
-- (used by the Edge Functions) can read or write. Browsers never talk to the
-- tables directly.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------- enums
create type lead_stage as enum (
  'new',          -- scraped / imported, not yet checked
  'verified',     -- email verified, consent basis recorded
  'queued',       -- approved, waiting for a send window
  'emailed',      -- first email sent
  'replied',      -- any reply received
  'booked',       -- discovery call booked
  'held',         -- call took place
  'won',
  'lost',
  'unsubscribed',
  'bounced',
  'do_not_contact'
);

create type event_type as enum (
  'sent', 'opened', 'bounce', 'reply', 'unsubscribe', 'complaint', 'out_of_office'
);

create type reply_class as enum (
  'interested', 'not_now', 'wrong_person', 'unsubscribe', 'out_of_office', 'hostile', 'other'
);

create type consent_basis as enum (
  'conspicuous_publication',  -- CASL implied consent: address published, no "no-contact" notice, message relates to role
  'existing_business_relationship',
  'express',
  'none'
);

-- ---------------------------------------------------------------- helpers
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- settings (kill switch)
create table app_settings (
  id              boolean primary key default true check (id),  -- single row
  sending_paused  boolean not null default true,                 -- PRD 8: kill switch, starts paused
  daily_send_cap_per_mailbox int not null default 30,
  updated_at      timestamptz not null default now()
);
insert into app_settings default values;

-- ---------------------------------------------------------------- scrape runs
create table scrape_runs (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null default 'apify',
  actor           text not null,
  run_id          text unique,
  dataset_id      text,
  query           jsonb,
  items_received  int not null default 0,
  companies_upserted int not null default 0,
  leads_created   int not null default 0,
  status          text not null default 'started',
  error           text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

-- ---------------------------------------------------------------- companies
create table companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  domain          citext,
  website         text,
  phone           text,
  category        text,
  categories      text[],
  industry        text,
  employee_range  text,
  address         text,
  city            text,
  province        text,
  postal_code     text,
  country_code    text default 'CA',
  timezone        text default 'America/Toronto',
  lat             double precision,
  lng             double precision,
  rating          numeric(2,1),
  review_count    int,
  google_place_id text unique,
  google_maps_url text,
  linkedin_url    text,
  source          text not null default 'apify_google_maps',
  scrape_run_id   uuid references scrape_runs(id) on delete set null,
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index companies_domain_key on companies (domain) where domain is not null;
create index companies_city_idx on companies (city);
create trigger companies_updated_at before update on companies for each row execute function set_updated_at();

-- ---------------------------------------------------------------- leads (one contact point at a company)
create table leads (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  full_name       text,
  first_name      text,
  last_name       text,
  title           text,
  email           citext,
  email_status    text not null default 'unverified',  -- unverified | valid | risky | catch_all | invalid
  email_source_url text,                               -- where the address was published (CASL evidence)
  is_role_address boolean not null default false,      -- info@, sales@ ... (generic company inbox)
  linkedin_url    text,
  phone           text,
  stage           lead_stage not null default 'new',
  source          text not null default 'apify_google_maps',
  scraped_at      timestamptz not null default now(),
  verified_at     timestamptz,
  first_emailed_at timestamptz,
  last_emailed_at timestamptz,
  replied_at      timestamptz,
  booked_at       timestamptz,
  held_at         timestamptz,
  won_at          timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index leads_email_key on leads (email) where email is not null;
create index leads_company_idx on leads (company_id);
create index leads_stage_idx on leads (stage);
create index leads_scraped_at_idx on leads (scraped_at);
create trigger leads_updated_at before update on leads for each row execute function set_updated_at();

-- PRD 7.1: max 2 active contacts per company at once.
create or replace function enforce_max_contacts_per_company() returns trigger
language plpgsql as $$
begin
  if (select count(*) from leads
        where company_id = new.company_id
          and id <> new.id
          and stage in ('queued','emailed')) >= 2
     and new.stage in ('queued','emailed') then
    raise exception 'company % already has 2 contacts in an active sequence', new.company_id;
  end if;
  return new;
end $$;
create trigger leads_max_active before insert or update of stage on leads
  for each row execute function enforce_max_contacts_per_company();

-- ---------------------------------------------------------------- research notes
create table research_notes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  lead_id     uuid references leads(id) on delete cascade,
  summary     text not null,
  detail      text,                 -- the one verified detail used for personalisation
  source_url  text,                 -- PRD 11: cite the source of each detail
  created_by  text default 'researcher_agent',
  created_at  timestamptz not null default now()
);
create index research_notes_company_idx on research_notes (company_id);

-- ---------------------------------------------------------------- campaigns & sequences
create table campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  offer       text,
  status      text not null default 'draft',  -- draft | active | paused | done
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger campaigns_updated_at before update on campaigns for each row execute function set_updated_at();

create table sequences (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step        int  not null,              -- 1..5
  day_offset  int  not null,              -- 0, 3, 7, 14, 21
  variant     text not null default 'A',  -- A/B test
  subject     text,
  body_template text,
  approved    boolean not null default false,  -- PRD 8: new templates need human approval
  created_at  timestamptz not null default now(),
  unique (campaign_id, step, variant)
);

-- ---------------------------------------------------------------- messages
create table messages (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  campaign_id   uuid references campaigns(id) on delete set null,
  sequence_id   uuid references sequences(id) on delete set null,
  step          int,
  variant       text,
  direction     text not null default 'outbound' check (direction in ('outbound','inbound')),
  mailbox       text,
  subject       text,
  body          text,
  status        text not null default 'draft',  -- draft | compliance_failed | pending_approval | approved | scheduled | sent | failed
  compliance_notes jsonb,
  approved_by   text,
  approved_at   timestamptz,
  scheduled_for timestamptz,
  sent_at       timestamptz,
  provider_message_id text,
  reply_class   reply_class,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index messages_lead_idx on messages (lead_id);
create index messages_status_idx on messages (status);
create trigger messages_updated_at before update on messages for each row execute function set_updated_at();

-- ---------------------------------------------------------------- events
create table events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  message_id  uuid references messages(id) on delete set null,
  type        event_type not null,
  detail      jsonb,
  occurred_at timestamptz not null default now()
);
create index events_lead_idx on events (lead_id);
create index events_type_time_idx on events (type, occurred_at);

-- Keep lead stage/timestamps in sync with events.
create or replace function apply_event_to_lead() returns trigger
language plpgsql as $$
begin
  if new.type = 'sent' then
    update leads set
      first_emailed_at = coalesce(first_emailed_at, new.occurred_at),
      last_emailed_at  = new.occurred_at,
      stage = case when stage in ('new','verified','queued') then 'emailed'::lead_stage else stage end
    where id = new.lead_id;
  elsif new.type = 'reply' then
    update leads set
      replied_at = coalesce(replied_at, new.occurred_at),
      stage = case when stage in ('new','verified','queued','emailed') then 'replied'::lead_stage else stage end
    where id = new.lead_id;
  elsif new.type = 'bounce' then
    update leads set stage = 'bounced', email_status = 'invalid' where id = new.lead_id;
  elsif new.type in ('unsubscribe','complaint') then
    update leads set stage = 'unsubscribed' where id = new.lead_id;
    insert into suppression_list (email, reason)
      select email, new.type::text from leads where id = new.lead_id and email is not null
      on conflict (email) do nothing;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- meetings
create table meetings (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  scheduled_for timestamptz not null,
  booking_provider text,       -- google_calendar | cal_com | calendly | manual
  booking_ref   text,
  status        text not null default 'booked' check (status in ('booked','held','no_show','cancelled','rescheduled')),
  qualification jsonb,         -- role, company size, compliance drivers
  pre_call_brief text,
  outcome       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index meetings_lead_idx on meetings (lead_id);
create index meetings_time_idx on meetings (scheduled_for);
create trigger meetings_updated_at before update on meetings for each row execute function set_updated_at();

create or replace function apply_meeting_to_lead() returns trigger
language plpgsql as $$
begin
  if new.status = 'booked' then
    update leads set booked_at = coalesce(booked_at, new.created_at),
      stage = case when stage in ('held','won','lost') then stage else 'booked'::lead_stage end
    where id = new.lead_id;
  elsif new.status = 'held' then
    update leads set held_at = coalesce(held_at, now()),
      booked_at = coalesce(booked_at, new.created_at),
      stage = case when stage in ('won','lost') then stage else 'held'::lead_stage end
    where id = new.lead_id;
  end if;
  return new;
end $$;
create trigger meetings_to_lead after insert or update of status on meetings
  for each row execute function apply_meeting_to_lead();

-- ---------------------------------------------------------------- suppression & consent (PRD 8)
create table suppression_list (
  email       citext primary key,
  domain      citext,
  reason      text not null,          -- unsubscribe | complaint | bounce | manual | deletion_request
  created_at  timestamptz not null default now()
);

create trigger events_to_lead after insert on events
  for each row execute function apply_event_to_lead();

create table consent_log (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  basis       consent_basis not null,
  evidence_url text,
  evidence    text,
  recorded_by text not null default 'system',
  recorded_at timestamptz not null default now()
);
create index consent_log_lead_idx on consent_log (lead_id);

-- A lead may only be queued when it has a consent basis and is not suppressed.
create or replace function enforce_send_gate() returns trigger
language plpgsql as $$
begin
  if new.stage = 'queued' and (old.stage is distinct from 'queued') then
    if not exists (select 1 from consent_log c where c.lead_id = new.id and c.basis <> 'none') then
      raise exception 'lead % has no consent basis recorded (CASL)', new.id;
    end if;
    if new.email is null or exists (select 1 from suppression_list s where s.email = new.email) then
      raise exception 'lead % has no email or is on the suppression list', new.id;
    end if;
  end if;
  return new;
end $$;
create trigger leads_send_gate before update of stage on leads
  for each row execute function enforce_send_gate();

-- ---------------------------------------------------------------- reporting
create or replace view pipeline_daily as
select d::date as day,
  (select count(*) from leads l where l.scraped_at::date = d::date)        as leads_scraped,
  (select count(*) from events e where e.type = 'sent'   and e.occurred_at::date = d::date) as emails_sent,
  (select count(*) from events e where e.type = 'reply'  and e.occurred_at::date = d::date) as replies,
  (select count(*) from events e where e.type = 'bounce' and e.occurred_at::date = d::date) as bounces,
  (select count(*) from meetings m where m.created_at::date = d::date)     as calls_booked
from generate_series(current_date - 89, current_date, interval '1 day') d;

create or replace function pipeline_summary() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'leads_scraped',  (select count(*) from leads),
    'companies',      (select count(*) from companies),
    'with_email',     (select count(*) from leads where email is not null),
    'emails_sent',    (select count(*) from events where type = 'sent'),
    'leads_emailed',  (select count(*) from leads where first_emailed_at is not null),
    'replied',        (select count(*) from leads where replied_at is not null),
    'calls_booked',   (select count(*) from leads where booked_at is not null),
    'calls_held',     (select count(*) from leads where held_at is not null),
    'won',            (select count(*) from leads where won_at is not null),
    'bounces',        (select count(*) from events where type = 'bounce'),
    'complaints',     (select count(*) from events where type = 'complaint'),
    'scraped_7d',     (select count(*) from leads where scraped_at > now() - interval '7 days'),
    'sent_7d',        (select count(*) from events where type = 'sent' and occurred_at > now() - interval '7 days'),
    'booked_30d',     (select count(*) from leads where booked_at > now() - interval '30 days'),
    'sending_paused', (select sending_paused from app_settings)
  );
$$;

-- ---------------------------------------------------------------- lock everything down
alter table app_settings     enable row level security;
alter table scrape_runs      enable row level security;
alter table companies        enable row level security;
alter table leads            enable row level security;
alter table research_notes   enable row level security;
alter table campaigns        enable row level security;
alter table sequences        enable row level security;
alter table messages         enable row level security;
alter table events           enable row level security;
alter table meetings         enable row level security;
alter table suppression_list enable row level security;
alter table consent_log      enable row level security;

alter view pipeline_daily set (security_invoker = true);
revoke all on function pipeline_summary() from public, anon, authenticated;
