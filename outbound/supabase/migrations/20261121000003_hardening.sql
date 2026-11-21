-- Security advisor follow-ups: pin search_path on every function, and make sure the
-- browser-facing roles can't read the reporting view or call internal functions.
alter function public.set_updated_at() set search_path = public;
alter function public.enforce_max_contacts_per_company() set search_path = public;
alter function public.apply_event_to_lead() set search_path = public;
alter function public.apply_meeting_to_lead() set search_path = public;
alter function public.enforce_send_gate() set search_path = public;
alter function public.pipeline_summary() set search_path = public;

revoke all on public.pipeline_daily from anon, authenticated;
revoke execute on function public.import_apify_places(jsonb, uuid) from anon, authenticated;
revoke execute on function public.pipeline_summary() from anon, authenticated;
