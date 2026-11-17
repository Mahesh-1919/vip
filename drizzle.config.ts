import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: {
    url: (process.env.DIRECT_URL || process.env.DATABASE_URL)!,
    ssl: process.env.DB_SSL && process.env.DB_SSL !== "disable" ? "require" : false,
  },
  strict: true,
  verbose: true,
});
