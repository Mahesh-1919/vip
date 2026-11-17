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
  trn: z.string().trim().transform((v) => v.replace(/\s/g, "")).pipe(z.union([z.literal(""), z.string().regex(/^\d{15}$/, "TRN must be 15 digits")])).transform((v) => v || null),
  phone: opt(40),
  email: z.string().trim().toLowerCase().max(254).transform((v) => v || null).pipe(z.email().nullable()),
  bankName: opt(100),
  iban: z.string().trim().toUpperCase().transform((v) => v.replace(/\s/g, "")).pipe(z.union([z.literal(""), z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "Enter a valid IBAN")])).transform((v) => v || null),
  invoiceTerms: opt(500),
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
