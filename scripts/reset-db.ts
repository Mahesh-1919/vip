/* DEV ONLY: drops the public + drizzle schemas. Then run db:migrate and db:seed. */
import postgres from "postgres";
if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset in production");
const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!);
await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
await sql.end();
console.log("Database reset.");
