"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productPackagings, products } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { clientMeta } from "@/lib/request";
import { packagingSchema, productSchema } from "@/validators/inventory";

const dup = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505";

export async function saveProduct(id: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:product:write");
  const p = productSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: `${p.error.issues[0].path[0] ? String(p.error.issues[0].path[0]) + ": " : ""}${p.error.issues[0].message}` };
  const { version, ...data } = p.data;
  const meta = await clientMeta();
  try {
    if (!id) {
      const row = await db.transaction(async (tx) => {
        const [r] = await tx.insert(products).values(data).returning();
        await audit({ action: "create", entity: "product", entityId: r.id, after: r, userId: user.id, userEmail: user.email, ...meta }, tx);
        return r;
      });
      revalidatePath("/inventory/products");
      redirect(`/inventory/products/${row.id}`);
    }
    if (!version) return { error: "Missing version: reload the page" };
    const err = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
      if (!before) return "Product not found";
      // Tracking type cannot change once stock history exists (would corrupt lot accounting).
      if (before.tracking !== data.tracking) {
        const [{ n }] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from stock_moves where product_id = ${id}`);
        if (n > 0) return "Tracking type cannot be changed after stock has moved";
      }
      const [after] = await tx.update(products).set({ ...data, version: sql`${products.version} + 1` }).where(and(eq(products.id, id), eq(products.version, version))).returning();
      if (!after) return "This product was changed by someone else. Reload and try again.";
      await audit({ action: "update", entity: "product", entityId: id, before, after, userId: user.id, userEmail: user.email, ...meta }, tx);
      return null;
    });
    if (err) return { error: err };
  } catch (e) {
    if (dup(e)) return { error: "A product with that SKU already exists" };
    throw e;
  }
  revalidatePath("/inventory/products", "layout");
  return { ok: "Product saved" };
}

export async function addPackaging(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:product:write");
  const p = packagingSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (Number(p.data.qty) <= 0) return { error: "Quantity must be greater than zero" };
  try {
    const [r] = await db.insert(productPackagings).values(p.data).returning();
    await audit({ action: "create", entity: "packaging", entityId: r.id, after: r, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  } catch (e) { if (dup(e)) return { error: "That packaging name already exists for this product" }; throw e; }
  revalidatePath(`/inventory/products/${p.data.productId}`);
  return { ok: "Packaging added" };
}

export async function removePackaging(form: FormData) {
  const user = await requirePermission("inventory:product:write");
  const p = z.object({ id: z.uuid(), productId: z.uuid() }).parse(Object.fromEntries(form));
  await db.delete(productPackagings).where(eq(productPackagings.id, p.id));
  await audit({ action: "delete", entity: "packaging", entityId: p.id, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  revalidatePath(`/inventory/products/${p.productId}`);
}

export async function setProductActive(form: FormData) {
  const user = await requirePermission("inventory:product:write");
  const p = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).parse(Object.fromEntries(form));
  await db.update(products).set({ isActive: p.active === "true" }).where(eq(products.id, p.id));
  await audit({ action: p.active === "true" ? "activate" : "deactivate", entity: "product", entityId: p.id, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  revalidatePath("/inventory/products", "layout");
}
