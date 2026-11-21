-- import_apollo_contacts(items, source)
-- Loads named contacts from an Apollo (or similar) CSV export, converted to a JSON array of
-- objects keyed by the CSV's column headers ("First Name", "Last Name", "Title", "Email",
-- "Email Status", "Company", "Website", "City", "State", "Person Linkedin Url", "# Employees",
-- "Industry", "Company Linkedin Url", "Company Phone").
--
-- Rules:
--  * company matched by website domain (or email domain), else by exact name, else created
--  * lead deduped by email; an existing lead gets its missing name/title/LinkedIn filled in
--  * suppressed addresses are skipped
--  * consent basis is recorded as 'none' with a note: a purchased/licensed contact is NOT proof
--    of CASL implied consent. The send gate keeps these leads out of a sequence until someone
--    confirms the address is conspicuously published (e.g. on the company site) and updates
--    consent_log.

create or replace function import_apollo_contacts(items jsonb, p_source text default 'apollo')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it         jsonb;
  v_email    text;
  v_first    text;
  v_last     text;
  v_title    text;
  v_company  text;
  v_website  text;
  v_domain   text;
  v_company_id uuid;
  v_lead     uuid;
  v_status   text;
  n_items int := 0; n_new int := 0; n_updated int := 0; n_skipped int := 0; n_companies_new int := 0;
begin
  if jsonb_typeof(items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;
  if p_source !~ '^[a-z_]{2,40}$' then
    raise exception 'bad source';
  end if;

  for it in select * from jsonb_array_elements(items) loop
    n_items := n_items + 1;
    v_email   := lower(trim(coalesce(it->>'Email', it->>'email', '')));
    v_first   := nullif(trim(coalesce(it->>'First Name', it->>'first_name', '')), '');
    v_last    := nullif(trim(coalesce(it->>'Last Name', it->>'last_name', '')), '');
    v_title   := nullif(trim(coalesce(it->>'Title', it->>'title', '')), '');
    v_company := nullif(trim(coalesce(it->>'Company', it->>'Company Name', it->>'company', '')), '');
    v_website := nullif(trim(coalesce(it->>'Website', it->>'website', '')), '');
    v_status  := lower(coalesce(it->>'Email Status', it->>'email_status', ''));

    if v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' or v_company is null then
      n_skipped := n_skipped + 1;
      continue;
    end if;
    if exists (select 1 from suppression_list where email = v_email) then
      n_skipped := n_skipped + 1;
      continue;
    end if;

    v_domain := lower(substring(coalesce(v_website, '') from '^(?:[a-z]+://)?(?:www\.)?([^/:?#]+)'));
    if v_domain is null or v_domain = '' then
      v_domain := split_part(v_email, '@', 2);
    end if;
    if v_domain ~ '^(gmail\.com|hotmail\.com|outlook\.com|yahoo\.(com|ca)|live\.(com|ca)|icloud\.com)$' then
      v_domain := null;
    end if;

    v_company_id := null;
    if v_domain is not null then
      select id into v_company_id from companies where domain = v_domain;
    end if;
    if v_company_id is null then
      select id into v_company_id from companies where lower(name) = lower(v_company) limit 1;
    end if;
    if v_company_id is null then
      insert into companies (name, domain, website, city, province, industry, employee_range, linkedin_url, phone, source)
      values (v_company, v_domain, v_website,
              nullif(it->>'Company City', ''), nullif(coalesce(it->>'Company State', it->>'State'), ''),
              coalesce(nullif(it->>'Industry', ''), 'manufacturing'),
              nullif(it->>'# Employees', ''), nullif(it->>'Company Linkedin Url', ''), nullif(it->>'Company Phone', ''),
              p_source)
      returning id into v_company_id;
      n_companies_new := n_companies_new + 1;
    end if;

    select id into v_lead from leads where email = v_email;
    if v_lead is not null then
      update leads set
        first_name = coalesce(first_name, v_first),
        last_name  = coalesce(last_name, v_last),
        full_name  = coalesce(full_name, nullif(concat_ws(' ', v_first, v_last), '')),
        title      = coalesce(title, v_title),
        linkedin_url = coalesce(linkedin_url, nullif(it->>'Person Linkedin Url', ''))
      where id = v_lead;
      n_updated := n_updated + 1;
      continue;
    end if;

    insert into leads (company_id, first_name, last_name, full_name, title, email, email_status,
                       linkedin_url, phone, is_role_address, source)
    values (v_company_id, v_first, v_last, nullif(concat_ws(' ', v_first, v_last), ''), v_title, v_email,
            case when v_status in ('verified', 'valid') then 'valid'
                 when v_status like '%catch%' then 'catch_all'
                 when v_status in ('unavailable', 'invalid', 'bounced') then 'invalid'
                 else 'unverified' end,
            nullif(it->>'Person Linkedin Url', ''),
            nullif(coalesce(it->>'Work Direct Phone', it->>'Mobile Phone'), ''),
            false, p_source)
    returning id into v_lead;

    insert into consent_log (lead_id, basis, evidence, recorded_by)
    values (v_lead, 'none',
            'Imported from ' || p_source || '. A licensed contact record is not proof of CASL implied consent: confirm the address is conspicuously published and the message relates to the role, then record conspicuous_publication with the evidence URL.',
            p_source || '-import');
    n_new := n_new + 1;
  end loop;

  return jsonb_build_object('items_received', n_items, 'leads_created', n_new, 'leads_updated', n_updated,
                            'companies_created', n_companies_new, 'skipped', n_skipped);
end $$;

revoke all on function import_apollo_contacts(jsonb, text) from public, anon, authenticated;
