"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientMeta } from "@/lib/request";
import { expenseSchema, saleLineSchema, saleSchema } from "@/validators/sales";
import * as sales from "@/services/sales/sales";
import * as containers from "@/services/inventory/containers";

const msg = (e: z.ZodError) => `${e.issues[0].path[0] ? String(e.issues[0].path[0]) + ": " : ""}${e.issues[0].message}`;
async function run(fn: () => Promise<unknown>, ok: string): Promise<ActionState> {
  try { await fn(); revalidatePath("/sales", "layout"); revalidatePath("/inventory", "layout"); return { ok }; }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
}

export async function createSaleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("sales:sale:write");
  const p = saleSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  let id = "";
  const r = await run(async () => { id = (await sales.createSale(p.data, user, await clientMeta())).id; }, "Sale created");
  if (r?.error) return r;
  redirect(`/sales/${id}`);
}

export async function addLineAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("sales:sale:write");
  const p = saleLineSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  return run(async () => sales.addLine({ ...p.data, containerItemId: null }, user, await clientMeta()), "Line added");
}

export async function removeLineAction(form: FormData) {
  const user = await requirePermission("sales:sale:write");
  try { await sales.removeLine(z.uuid().parse(form.get("id")), user, await clientMeta()); } catch (e) { if (!(e instanceof AppError)) throw e; }
  revalidatePath("/sales", "layout");
}

export async function importContainerAction(saleId: string) {
  const user = await requirePermission("sales:sale:write");
  return run(async () => { const n = await sales.importFromContainer(saleId, user, await clientMeta()); return n; }, "Container items imported");
}

export async function cancelSaleAction(saleId: string) {
  const user = await requirePermission("sales:sale:write");
  return run(async () => sales.cancelSale(saleId, user, await clientMeta()), "Sale cancelled");
}

/** Expenses are container cost lines: one record feeds landed cost, container P&L and (later) the ledger. */
export async function addExpenseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("sales:expense:write");
  const p = expenseSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  return run(async () => containers.addCost({
    containerId: p.data.containerId, type: p.data.type, description: p.data.description, payeeSupplierId: null, amount: p.data.amount, currency: p.data.currency, exchangeRate: p.data.exchangeRate,
    vat: p.data.vat, allocation: "value", inLandedCost: false, incurredOn: p.data.incurredOn,
  }, user, await clientMeta()), "Expense recorded");
}
