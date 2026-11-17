"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientMeta } from "@/lib/request";
import { customerSchema, invoiceFormSchema, paymentSchema, parseLines, saleHeaderSchema } from "@/validators/sales";
import * as billing from "@/services/billing";

const msg = (e: z.ZodError) => `${e.issues[0].path[0] ? String(e.issues[0].path[0]) + ": " : ""}${e.issues[0].message}`;
const done = () => revalidatePath("/sales", "layout");

export async function saveSaleAction(id: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("sales:sale:write");
  const h = saleHeaderSchema.safeParse(Object.fromEntries(form));
  if (!h.success) return { error: msg(h.error) };
  const l = parseLines(form);
  if (!l.ok) return { error: l.error };
  const { version, ...head } = h.data;
  let saleId = id;
  try { saleId = await billing.saveSale(id, { ...head, lines: l.lines }, version, user, await clientMeta()); }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  done();
  if (!id) redirect(`/sales/${saleId}`);
  return { ok: "Sale saved" };
}

export async function createInvoiceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("sales:invoice:write");
  const p = invoiceFormSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  let id = "";
  try { id = (await billing.createInvoice(p.data, user, await clientMeta())).id; }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  done();
  redirect(`/sales/invoices/${id}`);
}

export async function paymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("sales:payment:write");
  const p = paymentSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  try { await billing.recordPayment(p.data, user, await clientMeta()); }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  done();
  return { ok: "Payment recorded" };
}

export async function saveCustomerAction(id: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("sales:customer:write");
  const p = customerSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  const { version, ...data } = p.data;
  const meta = await clientMeta();
  if (!id) {
    const row = await db.transaction(async (tx) => {
      const [r] = await tx.insert(customers).values(data).returning();
      await audit({ action: "create", entity: "customer", entityId: r.id, after: r, userId: user.id, userEmail: user.email, ...meta }, tx);
      return r;
    });
    done();
    redirect(`/sales/customers/${row.id}`);
  }
  if (!version) return { error: "Missing version: reload the page" };
  const err = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(customers).where(eq(customers.id, id)).for("update");
    if (!before) return "Customer not found";
    const [after] = await tx.update(customers).set({ ...data, version: sql`${customers.version} + 1` }).where(and(eq(customers.id, id), eq(customers.version, version))).returning();
    if (!after) return "This customer was changed by someone else. Reload and try again.";
    await audit({ action: "update", entity: "customer", entityId: id, before, after, userId: user.id, userEmail: user.email, ...meta }, tx);
    return null;
  });
  if (err) return { error: err };
  done();
  return { ok: "Customer saved" };
}

export async function toggleCustomerAction(form: FormData) {
  const user = await requirePermission("sales:customer:write");
  const p = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).parse(Object.fromEntries(form));
  await db.update(customers).set({ isActive: p.active === "true" }).where(eq(customers.id, p.id));
  await audit({ action: p.active === "true" ? "activate" : "deactivate", entity: "customer", entityId: p.id, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  done();
}
