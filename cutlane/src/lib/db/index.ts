import "server-only";
import path from "node:path";
import fs from "node:fs";
import { env, modes, requireLiveOrDemo } from "../env";
import { runMigrations, type MigrationDriver } from "./migrate-core";

type Row = Record<string, unknown>;

export interface Db extends MigrationDriver {
  kind: "pglite" | "postgres";
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.waitReady;
  const db: Db = {
    kind: "pglite",
    async query(text, params) {
      const res = await pg.query<Row>(text, params as unknown[] | undefined);
      return res.rows;
    },
    async execScriptInTransaction(sql) {
      await pg.transaction(async (tx) => {
        await tx.exec(sql);
      });
    },
  };
  // Demo database: always keep it migrated.
  await runMigrations(db, (m) => console.log(`[cutlane] (local db) ${m}`));
  return db;
}

async function createPostgres(): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.databaseUrl!, {
    max: 5,
    prepare: false, // required for Supabase's transaction pooler
    ssl: env.databaseUrl!.includes("localhost") ? false : "require",
    idle_timeout: 20,
  });
  return {
    kind: "postgres",
    async query(text, params) {
      return (await sql.unsafe(text, (params ?? []) as never[])) as unknown as Row[];
    },
    async execScriptInTransaction(script) {
      await sql.begin(async (tx) => {
        await tx.unsafe(script);
      });
    },
  };
}

const g = globalThis as unknown as { __cutlaneDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__cutlaneDb) {
    // The embedded database lives on local disk: fine for development, data loss in production.
    requireLiveOrDemo(modes.database, "The database", "DATABASE_URL");
    g.__cutlaneDb = (modes.database ? createPostgres() : createPglite()).catch((err) => {
      g.__cutlaneDb = undefined;
      throw err;
    });
  }
  return g.__cutlaneDb;
}

export async function q<T = Row>(text: string, params?: unknown[]): Promise<T[]> {
  const db = await getDb();
  return (await db.query(text, params)) as T[];
}

export async function one<T = Row>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/** Postgres array literal for text[] params (portable across both drivers). Use with `$n::text[]`. */
export function pgTextArray(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}
