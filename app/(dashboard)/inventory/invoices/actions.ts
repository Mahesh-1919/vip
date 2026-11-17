"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientMeta } from "@/lib/request";
import { draftInvoiceSchema, paymentSchema } from "@/validators/sales";
import * as inv from "@/services/sales/invoicing";

const msg = (e: z.ZodError) => `${e.issues[0].path[0] ? String(e.issues[0].path[0]) + ": " : ""}${e.issues[0].message}`;
async function run(fn: () => Promise<unknown>, ok: string): Promise<ActionState> {
  try { await fn(); revalidatePath("/inventory", "layout"); revalidatePath("/sales", "layout"); return { ok }; }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
}

/** Form fields `qty:<saleLineId>` hold the quantity to bill on each line. */
export async function createDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:invoice:write");
  const p = draftInvoiceSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  const lines: { saleLineId: string; qty: string }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("qty:")) continue;
    const q = String(v).trim();
    if (q === "") continue;
    if (!/^\d{1,12}(\.\d{1,4})?$/.test(q)) return { error: "Quantities must be positive numbers" };
    lines.push({ saleLineId: k.slice(4), qty: q });
  }
  let id = "";
  const r = await run(async () => { id = (await inv.createDraft({ ...p.data, lines }, user, await clientMeta())).id; }, "Draft created");
  if (r?.error) return r;
  redirect(`/inventory/invoices/${id}`);
}

export async function issueAction(id: string): Promise<ActionState> {
  const user = await requirePermission("inventory:invoice:write");
  return run(async () => inv.issueInvoice(id, user, await clientMeta()), "Invoice issued");
}

export async function deleteDraftAction(id: string): Promise<ActionState> {
  const user = await requirePermission("inventory:invoice:write");
  const r = await run(async () => inv.deleteDraft(id, user, await clientMeta()), "Draft deleted");
  if (r?.error) return r;
  redirect("/inventory/invoices");
}

export async function paymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:payment:write");
  const p = paymentSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  return run(async () => inv.recordPayment(p.data, user, await clientMeta()), "Payment recorded");
}

export async function reversePaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:payment:write");
  const p = z.object({ id: z.uuid(), reason: z.string().trim().min(3, "Give a reason").max(200) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  return run(async () => inv.reversePayment(p.data.id, p.data.reason, user, await clientMeta()), "Payment reversed");
}
