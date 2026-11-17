"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { departments, salaryComponents } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { toDb } from "@/lib/money";
import { clientMeta } from "@/lib/request";
import { componentSchema, departmentSchema } from "@/validators/hr";

export type State = { error?: string; ok?: boolean } | undefined;
const isUnique = (e: unknown) => (e as { cause?: { code?: string } })?.cause?.code === "23505" || (e as { code?: string })?.code === "23505";

export async function addDepartment(_: State, form: FormData): Promise<State> {
  const user = await requirePermission("hr:config:write");
  const p = departmentSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Enter a department name (2-80 characters)" };
  try {
    const [d] = await db.insert(departments).values({ name: p.data.name }).returning();
    await audit({ action: "create", entity: "department", entityId: d.id, after: d, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  } catch (e) {
    if (isUnique(e)) return { error: "That department already exists" };
    throw e;
  }
  revalidatePath("/hr/config");
  return { ok: true };
}

export async function addComponent(_: State, form: FormData): Promise<State> {
  const user = await requirePermission("hr:config:write");
  const p = componentSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  if (p.data.calc === "percent_of_basic" && Number(p.data.defaultValue) > 100) return { error: "Percent cannot exceed 100" };
  try {
    const [c] = await db.insert(salaryComponents).values({ ...p.data, defaultValue: toDb(p.data.defaultValue) }).returning();
    await audit({ action: "create", entity: "salary_component", entityId: c.id, after: c, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  } catch (e) {
    if (isUnique(e)) return { error: "A component with that code exists" };
    throw e;
  }
  revalidatePath("/hr/config");
  return { ok: true };
}

export async function toggleActive(form: FormData) {
  const user = await requirePermission("hr:config:write");
  const p = z.object({ kind: z.enum(["department", "component"]), id: z.uuid(), active: z.enum(["true", "false"]) }).parse(Object.fromEntries(form));
  const isActive = p.active === "true";
  if (p.kind === "department") await db.update(departments).set({ isActive }).where(eq(departments.id, p.id));
  else await db.update(salaryComponents).set({ isActive }).where(eq(salaryComponents.id, p.id));
  await audit({ action: isActive ? "activate" : "deactivate", entity: p.kind, entityId: p.id, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  revalidatePath("/hr/config");
}
