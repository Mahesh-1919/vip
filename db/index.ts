import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
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

const g = globalThis as unknown as { __sql?: postgres.Sql };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    // Supabase pooler (transaction mode) does not support prepared statements.
    prepare: process.env.DB_PREPARE !== "false",
    ssl: sslOption(),
    idle_timeout: 20,
    // Return numerics as strings (we use decimal.js for money) and timestamps as Date.
  });
}

const client = (g.__sql ??= connect());

export const db = drizzle(client, { schema, casing: "snake_case" });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { client as sql };
