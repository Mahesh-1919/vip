import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { readFileSync, existsSync } from "node:fs";
import * as schema from "./schema";

function sslOption(): postgres.Options<Record<string, postgres.PostgresType>>["ssl"] {
  switch (process.env.DB_SSL) {
    case "require":
      return "require";
    case "verify-full": {
      const ca = process.env.DB_SSL_CA;
      return {
        rejectUnauthorized: true,
        ...(ca ? { ca: existsSync(ca) ? readFileSync(ca, "utf8") : ca } : {}),
      };
    }
    default:
      return false;
  }
}

/**
 * DATA_MODE=demo (default): an embedded in-memory Postgres (PGlite) loaded with fictional demo data, so the app runs
 * with no database server. DATA_MODE=db: connect to the real PostgreSQL given by DATABASE_URL.
 */
export const DEMO_MODE = process.env.DATA_MODE !== "db";

type Client = postgres.Sql;
const g = globalThis as unknown as { __sql?: Client; __db?: PostgresJsDatabase<typeof schema>; __demoReady?: Promise<void> };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (or set DATA_MODE=demo to run on built-in demo data)");
  return postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    // Supabase pooler (transaction mode) does not support prepared statements.
    prepare: process.env.DB_PREPARE !== "false",
    ssl: sslOption(),
    idle_timeout: 20,
  });
}

async function createDemoDb() {
  const [{ PGlite }, { drizzle: pglite }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const d = pglite(new PGlite(), { schema, casing: "snake_case" });
  await migrate(d, { migrationsFolder: "./drizzle" });
  return d as unknown as PostgresJsDatabase<typeof schema>;
}

if (!g.__db) {
  if (DEMO_MODE) {
    g.__sql = { end: async () => {} } as unknown as Client;
    g.__db = await createDemoDb();
  } else {
    g.__sql = connect();
    g.__db = drizzle(g.__sql, { schema, casing: "snake_case" });
  }
}

const client = g.__sql!;
export const db = g.__db!;
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { client as sql };

/** Demo mode only: load the fictional demo data once per server process. Call from instrumentation. */
export function ensureDemoData() {
  if (!DEMO_MODE) return Promise.resolve();
  return (g.__demoReady ??= import("./seed").then((m) => m.seedDemo()));
}
