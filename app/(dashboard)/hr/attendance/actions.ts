"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth";
import { clientMeta } from "@/lib/request";
import { MARKABLE, saveDailySheet, type SheetEntry } from "@/services/hr/attendance";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export async function saveSheet(date: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:attendance:write");
  if (!z.iso.date().safeParse(date).success) return { error: "Invalid date" };
  const entries: SheetEntry[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("s:")) continue;
    const employeeId = k.slice(2);
    if (!z.uuid().safeParse(employeeId).success) return { error: "Invalid employee" };
    const status = String(v);
    if (status && !(MARKABLE as readonly string[]).includes(status)) return { error: "Invalid status" };
    const t = (name: string) => { const x = String(form.get(`${name}:${employeeId}`) ?? ""); return x === "" ? null : time.safeParse(x).success ? x : "bad"; };
    const checkIn = t("in"), checkOut = t("out");
    if (checkIn === "bad" || checkOut === "bad") return { error: "Use HH:MM for check-in/out times" };
    entries.push({ employeeId, status: status as SheetEntry["status"], checkIn, checkOut, note: String(form.get(`n:${employeeId}`) ?? "").trim().slice(0, 200) || null });
  }
  try {
    const changed = await saveDailySheet(date, entries, user, await clientMeta());
    revalidatePath("/hr/attendance", "layout");
    return { ok: `Saved (${changed} change${changed === 1 ? "" : "s"})` };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}
