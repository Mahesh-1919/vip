"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { companySettings } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { clientMeta } from "@/lib/request";
import { getCompany } from "@/services/company";

const opt = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const schema = z.object({
  name: z.string().trim().min(2, "Company name is required").max(150),
  address: z.string().trim().min(2, "Address is required").max(300),
  phone: opt(40),
  email: z.string().trim().toLowerCase().max(254).transform((v) => v || null).pipe(z.email().nullable()),
});

export async function saveCompany(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("admin:settings:write");
  const p = schema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const before = await getCompany();
  await db.update(companySettings).set(p.data).where(eq(companySettings.id, 1));
  await audit({ action: "update", entity: "company_settings", entityId: "1", before, after: p.data, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  revalidatePath("/", "layout");
  return { ok: "Company profile saved" };
}
