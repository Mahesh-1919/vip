"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productCategories, uoms, warehouses } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { clientMeta } from "@/lib/request";
import { uomSchema, warehouseSchema } from "@/validators/inventory";

const dup = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505";
async function log(u: { id: string; email: string }, action: string, entity: string, entityId: string, after?: unknown) {
  await audit({ action, entity, entityId, after, userId: u.id, userEmail: u.email, ...(await clientMeta()) });
}
const done = () => revalidatePath("/inventory", "layout");

export async function addWarehouse(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:product:write");
  const p = warehouseSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  try { const [w] = await db.insert(warehouses).values(p.data).returning(); await log(user, "create", "warehouse", w.id, w); }
  catch (e) { if (dup(e)) return { error: "A warehouse with that code exists" }; throw e; }
  done(); return { ok: "Warehouse added" };
}

export async function setDefaultWarehouse(form: FormData) {
  const user = await requirePermission("inventory:product:write");
  const id = z.uuid().parse(form.get("id"));
  await db.transaction(async (tx) => { await tx.update(warehouses).set({ isDefault: false }); await tx.update(warehouses).set({ isDefault: true, isActive: true }).where(eq(warehouses.id, id)); });
  await log(user, "set_default", "warehouse", id); done();
}

export async function toggleWarehouse(form: FormData) {
  const user = await requirePermission("inventory:product:write");
  const p = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).parse(Object.fromEntries(form));
  await db.update(warehouses).set({ isActive: p.active === "true" }).where(eq(warehouses.id, p.id));
  await log(user, p.active === "true" ? "activate" : "deactivate", "warehouse", p.id); done();
}

export async function addCategory(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:product:write");
  const p = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Enter a category name" };
  try { const [c] = await db.insert(productCategories).values(p.data).returning(); await log(user, "create", "product_category", c.id, c); }
  catch (e) { if (dup(e)) return { error: "That category exists" }; throw e; }
  done(); return { ok: "Category added" };
}

export async function addUom(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:product:write");
  const p = uomSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  try { const [u] = await db.insert(uoms).values({ ...p.data, allowDecimal: form.get("allowDecimal") === "on" }).returning(); await log(user, "create", "uom", u.id, u); }
  catch (e) { if (dup(e)) return { error: "A unit with that code exists" }; throw e; }
  done(); return { ok: "Unit added" };
}
