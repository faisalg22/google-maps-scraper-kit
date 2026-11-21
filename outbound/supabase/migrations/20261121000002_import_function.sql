-- import_apify_places(items, scrape_run_id)
-- Upserts items from Apify's Google Maps Scraper (compass/crawler-google-places) into
-- companies + leads in one transaction. Called by the apify-import Edge Function.
--
-- Rules:
--  * skip permanently closed places and clearly non-manufacturing categories (restaurants, rentals, ...)
--  * dedupe companies by Google place id, then by website domain
--  * keep an email only if it is on the company's own domain, or a free-mail address
--    published on the company's site (small shops); drop third-party/junk addresses
--  * at most 3 email leads per company, generic role inboxes (info@, sales@) first
--  * never re-import an address on the suppression list
--  * record a CASL consent basis (conspicuous publication) for every new lead

create or replace function import_apify_places(items jsonb, p_scrape_run_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it          jsonb;
  v_title     text;
  v_website   text;
  v_domain    text;
  v_place     text;
  v_cat       text;
  v_company   uuid;
  v_email     text;
  v_lead      uuid;
  v_have      int;
  v_role      boolean;
  n_items     int := 0;
  n_companies int := 0;
  n_leads     int := 0;
  n_skipped   int := 0;
  n_emails_dropped int := 0;
  excluded    constant text := '(restaurant|deli$|cafe|café|cheese shop|butcher|bakery|grocery|market|rental|roofing|hvac|plumb|dealer|supply store|hardware store|mining company|general contractor|consultant|real estate|hotel|bar$|pub$|winery|brewery|store$|shop$)';
  freemail    constant text := '^(gmail\.com|hotmail\.com|live\.ca|live\.com|outlook\.com|yahoo\.com|yahoo\.ca|icloud\.com|me\.com|rogers\.com|bell\.net|sympatico\.ca|shaw\.ca|telus\.net|cogeco\.ca|vianet\.ca|drytel\.net)$';
  role_re     constant text := '^(info|sales|contact|office|admin|hello|inquiries|inquiry|enquiries|support|service|orders|orderdesk|accounts|accounting|hr|careers|jobs|marketing|reception|general|mail|customerservice|custserv|customercare|quotes|estimating|purchasing|shop)$';
begin
  if jsonb_typeof(items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;

  for it in select * from jsonb_array_elements(items) loop
    n_items := n_items + 1;
    v_title := nullif(trim(it->>'title'), '');
    v_cat   := lower(coalesce(it->>'categoryName', ''));

    if v_title is null
       or coalesce((it->>'permanentlyClosed')::boolean, false)
       or (v_cat ~ excluded and v_cat !~ '(manufactur|fabricat|machin|plastic|metal|steel|weld|food products)') then
      n_skipped := n_skipped + 1;
      continue;
    end if;

    v_website := nullif(it->>'website', '');
    v_domain := lower(substring(coalesce(v_website, '') from '^[a-z]+://(?:www\.)?([^/:?#]+)'));
    if v_domain ~ '(facebook|instagram|linkedin|google|yelp|wix|godaddysites)\.' then
      v_domain := null;
    end if;
    v_place := nullif(it->>'placeId', '');

    -- find existing company
    v_company := null;
    if v_place is not null then
      select id into v_company from companies where google_place_id = v_place;
    end if;
    if v_company is null and v_domain is not null then
      select id into v_company from companies where domain = v_domain;
    end if;

    if v_company is null then
      insert into companies (name, domain, website, phone, category, categories, industry, address, city, province,
                             postal_code, country_code, lat, lng, rating, review_count, google_place_id, google_maps_url,
                             linkedin_url, source, scrape_run_id, raw)
      values (
        v_title, v_domain, v_website,
        nullif(coalesce(nullif(it->>'phone', ''), it->>'phoneUnformatted'), ''),
        nullif(it->>'categoryName', ''),
        case when jsonb_typeof(it->'categories') = 'array' then array(select jsonb_array_elements_text(it->'categories')) end,
        'manufacturing',
        nullif(it->>'address', ''), nullif(it->>'city', ''), nullif(it->>'state', ''), nullif(it->>'postalCode', ''),
        upper(coalesce(nullif(it->>'countryCode', ''), 'CA')),
        (it->'location'->>'lat')::double precision, (it->'location'->>'lng')::double precision,
        (it->>'totalScore')::numeric, (it->>'reviewsCount')::int,
        v_place, nullif(it->>'url', ''),
        (select l from jsonb_array_elements_text(coalesce(it->'linkedIns', '[]'::jsonb)) l where l ~* 'linkedin\.com/company/' limit 1),
        'apify_google_maps', p_scrape_run_id,
        jsonb_build_object('searchString', it->>'searchString')
      )
      returning id into v_company;
    else
      update companies set
        name = v_title,
        website = coalesce(v_website, website),
        phone = coalesce(nullif(it->>'phone', ''), phone),
        category = coalesce(nullif(it->>'categoryName', ''), category),
        rating = coalesce((it->>'totalScore')::numeric, rating),
        review_count = coalesce((it->>'reviewsCount')::int, review_count),
        google_place_id = coalesce(google_place_id, v_place),
        scrape_run_id = coalesce(p_scrape_run_id, scrape_run_id)
      where id = v_company;
    end if;
    n_companies := n_companies + 1;

    select count(*) into v_have from leads where company_id = v_company;

    for v_email, v_role in
      select e, split_part(e, '@', 1) ~ role_re
      from (
        select distinct lower(trim(regexp_replace(x, '^mailto:', '', 'i'))) as e
        from jsonb_array_elements_text(coalesce(it->'emails', '[]'::jsonb)) x
      ) s
      where e ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
      order by (split_part(e, '@', 1) ~ role_re) desc, e
    loop
      -- must belong to the company (or be a small-shop free-mail address) and not look like junk
      if v_email ~ '(noreply|no-reply|donotreply|nospam|example\.|@mysite\.|sentry|wixpress|\.(png|jpe?g|gif|webp|svg)$)'
         or not (
           (v_domain is not null and (split_part(v_email, '@', 2) = v_domain or split_part(v_email, '@', 2) like '%.' || v_domain))
           or split_part(v_email, '@', 2) ~ freemail
         ) then
        n_emails_dropped := n_emails_dropped + 1;
        continue;
      end if;
      exit when v_have >= 3;
      if exists (select 1 from suppression_list where email = v_email) then continue; end if;

      insert into leads (company_id, email, is_role_address, email_source_url, source, scraped_at)
      values (v_company, v_email, v_role, v_website, 'apify_google_maps', now())
      on conflict (email) where email is not null do nothing
      returning id into v_lead;

      if v_lead is not null then
        insert into consent_log (lead_id, basis, evidence_url, evidence, recorded_by)
        values (v_lead, 'conspicuous_publication', v_website,
                'Address published on the company''s own website (Apify contact enrichment). Confirm no "do not contact" notice and role relevance before sending.',
                'apify-import');
        n_leads := n_leads + 1;
        v_have := v_have + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'items_received', n_items,
    'companies_upserted', n_companies,
    'leads_created', n_leads,
    'skipped', n_skipped,
    'emails_dropped', n_emails_dropped
  );
end $$;

revoke all on function import_apify_places(jsonb, uuid) from public, anon, authenticated;
