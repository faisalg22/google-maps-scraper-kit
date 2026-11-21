import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export interface ImportResult {
  items_received: number;
  companies_upserted: number;
  leads_created: number;
  skipped: number;
  emails_dropped: number;
}

/**
 * Hands a batch of Apify Google Maps items to the database function import_apify_places,
 * which applies the filtering, dedupe, 3-per-company and CASL consent rules in one transaction.
 */
export async function importPlaces(
  db: SupabaseClient,
  items: unknown[],
  scrapeRunId: string | null,
): Promise<ImportResult> {
  const total: ImportResult = { items_received: 0, companies_upserted: 0, leads_created: 0, skipped: 0, emails_dropped: 0 };
  for (let i = 0; i < items.length; i += 250) {
    const { data, error } = await db.rpc("import_apify_places", {
      items: items.slice(i, i + 250),
      p_scrape_run_id: scrapeRunId,
    });
    if (error) throw error;
    for (const k of Object.keys(total) as (keyof ImportResult)[]) total[k] += Number(data?.[k] ?? 0);
  }
  return total;
}
