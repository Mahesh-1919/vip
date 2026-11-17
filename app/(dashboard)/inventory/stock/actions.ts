"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientMeta } from "@/lib/request";
import { entrySchema, transferSchema } from "@/validators/inventory";
import { recordStock, transferStock } from "@/services/inventory/stock";

const first = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues[0].message;

export async function recordStockAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:stock:adjust");
  const p = entrySchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: first(p.error) };
  if (Number(p.data.qty) <= 0) return { error: "Quantity must be greater than zero" };
  try {
    const moves = await recordStock(p.data, user, await clientMeta());
    revalidatePath("/inventory", "layout");
    return { ok: `Recorded ${moves.length} movement${moves.length === 1 ? "" : "s"}` };
  } catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
}

export async function transferAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("inventory:stock:adjust");
  const p = transferSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: first(p.error) };
  try {
    const ref = await transferStock(p.data, user, await clientMeta());
    revalidatePath("/inventory", "layout");
    return { ok: `Transferred (ref ${ref})` };
  } catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
}
