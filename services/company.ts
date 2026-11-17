import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companySettings } from "@/db/schema";

/** The single company profile row (created on first read if missing). */
export async function getCompany() {
  const [c] = await db.select().from(companySettings).where(eq(companySettings.id, 1));
  if (c) return c;
  await db.insert(companySettings).values({ id: 1 }).onConflictDoNothing();
  return (await db.select().from(companySettings).where(eq(companySettings.id, 1)))[0];
}
