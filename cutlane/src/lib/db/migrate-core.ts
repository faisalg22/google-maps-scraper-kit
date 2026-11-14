import fs from "node:fs";
import path from "node:path";

/** Minimal driver surface shared by PGlite and postgres.js. No server-only import: used by scripts/migrate.ts too. */
export interface MigrationDriver {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Run a multi-statement script atomically. */
  execScriptInTransaction(sql: string): Promise<void>;
}

export function migrationsDir(): string {
  return path.join(process.cwd(), "supabase", "migrations");
}

export function listMigrations(dir = migrationsDir()): { name: string; sql: string }[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
}

export async function runMigrations(driver: MigrationDriver, log: (m: string) => void = () => {}): Promise<string[]> {
  await driver.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await driver.query("select name from schema_migrations")).map((r) => String(r.name)));
  const applied: string[] = [];
  for (const m of listMigrations()) {
    if (done.has(m.name)) continue;
    log(`applying migration ${m.name}`);
    const escaped = m.name.replace(/'/g, "''");
    await driver.execScriptInTransaction(
      `${m.sql}\n;insert into schema_migrations (name) values ('${escaped}');`,
    );
    applied.push(m.name);
  }
  return applied;
}

export async function pendingMigrations(driver: MigrationDriver): Promise<string[]> {
  const exists = await driver.query("select to_regclass('public.schema_migrations') as t");
  const done = exists[0]?.t
    ? new Set((await driver.query("select name from schema_migrations")).map((r) => String(r.name)))
    : new Set<string>();
  return listMigrations()
    .map((m) => m.name)
    .filter((n) => !done.has(n));
}
