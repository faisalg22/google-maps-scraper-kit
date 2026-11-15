-- 1) Submissions with an attached file run as a resumable job, one short step per request
--    (create + upload the file → wait for Whop to process it → create the submission), so no
--    single request can hit a serverless time limit.
alter table submissions add column job_state text not null default 'done'
  check (job_state in ('queued', 'uploading', 'processing', 'creating', 'done', 'failed'));
alter table submissions add column job_error text;
alter table submissions add column job_attempts integer not null default 0;
alter table submissions add column job_updated_at timestamptz not null default now();
alter table submissions add column attach_file boolean not null default false;
alter table submissions add column usage_period_start timestamptz;  -- which monthly counter to refund on failure
create index submissions_job_idx on submissions(job_state) where job_state not in ('done', 'failed');

-- 2) YouTube API policy: stored API data must be refreshed or deleted within 30 days.
alter table saved_channels add column refreshed_at timestamptz not null default now();
alter table swipe_notes add column yt_refreshed_at timestamptz not null default now();
