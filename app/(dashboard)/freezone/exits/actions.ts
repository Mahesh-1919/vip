"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientMeta } from "@/lib/request";
import { allocationSchema, exitFromStockSchema, exitSchema } from "@/validators/freezone";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as fz from "@/services/freezone";

export async function saveExitAction(id: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("freezone:exit:write");
  const p = exitSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: `${p.error.issues[0].path[0] ? String(p.error.issues[0].path[0]) + ": " : ""}${p.error.issues[0].message}` };
  const { version, ...data } = p.data;
  // A linked customer fills in a blank importer name.
  if (data.customerId && !data.importerName) data.importerName = (await db.select({ n: customers.name }).from(customers).where(eq(customers.id, data.customerId)))[0]?.n ?? null;
  try { await fz.saveExit(id, data as never, version, user, await clientMeta()); }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  revalidatePath("/freezone", "layout");
  if (!id) redirect("/freezone/exits");
  return { ok: "Saved" };
}

export async function deleteExitAction(id: string): Promise<ActionState> {
  const user = await requirePermission("freezone:exit:write");
  try { await fz.deleteExit(z.uuid().parse(id), user, await clientMeta()); }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  revalidatePath("/freezone", "layout");
  redirect("/freezone/exits");
}

export async function allocateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("freezone:exit:write");
  const p = allocationSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: `${p.error.issues[0].path[0] ? String(p.error.issues[0].path[0]) + ": " : ""}${p.error.issues[0].message}` };
  let warnings: string[] = [];
  try { warnings = (await fz.allocate(p.data, user, await clientMeta())).warnings; }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  revalidatePath("/freezone", "layout");
  return { ok: warnings.length ? `Linked. ${warnings.join(" ")}` : "Linked" };
}

export async function removeAllocationAction(form: FormData) {
  const user = await requirePermission("freezone:exit:write");
  try { await fz.removeAllocation(z.uuid().parse(form.get("id")), user, await clientMeta()); } catch (e) { if (!(e instanceof AppError)) throw e; }
  revalidatePath("/freezone", "layout");
}

/** New export bill straight from an entry bill's stock. */
export async function createExitFromStockAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("freezone:exit:write");
  const p = exitFromStockSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: `${p.error.issues[0].path[0] ? String(p.error.issues[0].path[0]) + ": " : ""}${p.error.issues[0].message}` };
  const { entryBillId, ...data } = p.data;
  const [c] = await db.select({ n: customers.name }).from(customers).where(eq(customers.id, data.customerId));
  if (!c) return { error: "Choose the customer" };
  let id: string;
  try { id = (await fz.createExitFromStock({ ...data, importerName: c.n } as never, entryBillId, user, await clientMeta())).exit.id; }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  revalidatePath("/freezone", "layout");
  redirect(`/freezone/exits/${id}`);
}
