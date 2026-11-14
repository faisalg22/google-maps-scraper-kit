/**
 * Apply SQL migrations in supabase/migrations to DATABASE_URL.
 *   npm run db:migrate
 * Without DATABASE_URL there is nothing to do: the local demo database migrates itself on start.
 */
import postgres from "postgres";
import { runMigrations } from "../src/lib/db/migrate-core";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log("DATABASE_URL is not set. The local demo database migrates itself when the app starts.");
    return;
  }
  const sql = postgres(url, { max: 1, prepare: false, ssl: url.includes("localhost") ? false : "require" });
  try {
    const applied = await runMigrations(
      {
        query: async (text, params) => (await sql.unsafe(text, (params ?? []) as never[])) as unknown as Record<string, unknown>[],
        execScriptInTransaction: async (script) => {
          await sql.begin(async (tx) => {
            await tx.unsafe(script);
          });
        },
      },
      console.log,
    );
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
