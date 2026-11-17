"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientMeta } from "@/lib/request";
import { containerSchema, costSchema, itemSchema } from "@/validators/containers";
import * as svc from "@/services/inventory/containers";

const msg = (e: z.ZodError) => `${e.issues[0].path[0] ? String(e.issues[0].path[0]) + ": " : ""}${e.issues[0].message}`;
async function run(fn: () => Promise<void>, ok: string): Promise<ActionState> {
  try { await fn(); revalidatePath("/inventory", "layout"); return { ok }; }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
}

export async function saveContainer(id: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:container:write");
  const p = containerSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  const { version, ...data } = p.data;
  const meta = await clientMeta();
  if (!id) {
    let newId = "";
    const r = await run(async () => { newId = (await svc.createContainer(data, user, meta)).id; }, "Container created");
    if (r?.error) return r;
    redirect(`/inventory/containers/${newId}`);
  }
  if (!version) return { error: "Missing version: reload the page" };
  return run(() => svc.updateContainer(id, data, version, user, meta), "Container saved");
}

export async function addItemAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:container:write");
  const p = itemSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  return run(async () => svc.addItem(p.data, user, await clientMeta()), "Item added");
}

export async function removeItemAction(form: FormData) {
  const user = await requirePermission("inventory:container:write");
  try { await svc.removeItem(z.uuid().parse(form.get("id")), user, await clientMeta()); } catch (e) { if (!(e instanceof AppError)) throw e; }
  revalidatePath("/inventory", "layout");
}

export async function addCostAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:container:write");
  const p = costSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: msg(p.error) };
  return run(async () => svc.addCost(p.data, user, await clientMeta()), "Cost added");
}

export async function removeCostAction(form: FormData) {
  const user = await requirePermission("inventory:container:write");
  try { await svc.removeCost(z.uuid().parse(form.get("id")), user, await clientMeta()); } catch (e) { if (!(e instanceof AppError)) throw e; }
  revalidatePath("/inventory", "layout");
}

export async function statusAction(id: string, to: string): Promise<ActionState> {
  const user = await requirePermission("inventory:container:write");
  return run(async () => { await svc.changeStatus(id, to, user, await clientMeta()); }, `Status changed to ${to.replace(/_/g, " ")}`);
}
