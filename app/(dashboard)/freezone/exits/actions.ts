"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientMeta } from "@/lib/request";
import { exitSchema } from "@/validators/freezone";
import * as fz from "@/services/freezone";

export async function saveExitAction(id: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("freezone:exit:write");
  const p = exitSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: `${p.error.issues[0].path[0] ? String(p.error.issues[0].path[0]) + ": " : ""}${p.error.issues[0].message}` };
  const { version, ...data } = p.data;
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
