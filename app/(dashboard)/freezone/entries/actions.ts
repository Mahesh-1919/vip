"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientMeta } from "@/lib/request";
import { entrySchema } from "@/validators/freezone";
import * as fz from "@/services/freezone";

export async function saveEntryAction(id: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("freezone:entry:write");
  const p = entrySchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: `${p.error.issues[0].path[0] ? String(p.error.issues[0].path[0]) + ": " : ""}${p.error.issues[0].message}` };
  const { version, packagesReason, ...data } = p.data;
  try { await fz.saveEntry(id, data as never, version, user, await clientMeta(), packagesReason); }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  revalidatePath("/freezone", "layout");
  if (!id) redirect("/freezone/entries");
  return { ok: "Saved" };
}

export async function deleteEntryAction(id: string): Promise<ActionState> {
  const user = await requirePermission("freezone:entry:write");
  try { await fz.deleteEntry(z.uuid().parse(id), user, await clientMeta()); }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  revalidatePath("/freezone", "layout");
  redirect("/freezone/entries");
}
