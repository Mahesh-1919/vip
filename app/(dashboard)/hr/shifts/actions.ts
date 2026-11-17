"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { shiftAssignments, shifts } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { clientMeta } from "@/lib/request";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const shiftSchema = z.object({
  name: z.string().trim().min(2).max(80),
  startTime: time, endTime: time,
  graceMinutes: z.coerce.number().int().min(0).max(120),
  breakMinutes: z.coerce.number().int().min(0).max(240),
});

export async function createShift(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:config:write");
  const p = shiftSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const weeklyOff = form.getAll("off").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const isOvernight = form.get("overnight") === "on" || p.data.endTime <= p.data.startTime;
  if (p.data.endTime <= p.data.startTime && form.get("overnight") !== "on") return { error: "End time is before start time: tick “overnight shift” if it ends the next day" };
  try {
    const [s] = await db.insert(shifts).values({ ...p.data, isOvernight, weeklyOff }).returning();
    await audit({ action: "create", entity: "shift", entityId: s.id, after: s, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === "23505") return { error: "A shift with that name exists" };
    throw e;
  }
  revalidatePath("/hr/shifts");
  return { ok: "Shift created" };
}

export async function toggleShift(form: FormData) {
  const user = await requirePermission("hr:config:write");
  const p = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).parse(Object.fromEntries(form));
  await db.update(shifts).set({ isActive: p.active === "true" }).where(eq(shifts.id, p.id));
  await audit({ action: p.active === "true" ? "activate" : "deactivate", entity: "shift", entityId: p.id, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  revalidatePath("/hr/shifts");
}

export async function assignShift(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:config:write");
  const p = z.object({ employeeId: z.uuid(), shiftId: z.uuid(), effectiveFrom: z.iso.date() }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose an employee, shift and start date" };
  const prevDay = new Date(Date.parse(p.data.effectiveFrom + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  const err = await db.transaction(async (tx) => {
    const [shift] = await tx.select().from(shifts).where(and(eq(shifts.id, p.data.shiftId), eq(shifts.isActive, true)));
    if (!shift) return "Unknown or inactive shift";
    const [later] = await tx.select({ id: shiftAssignments.id }).from(shiftAssignments)
      .where(and(eq(shiftAssignments.employeeId, p.data.employeeId), gte(shiftAssignments.effectiveFrom, p.data.effectiveFrom)));
    if (later) return "This employee already has an assignment starting on or after that date";
    await tx.update(shiftAssignments).set({ effectiveTo: prevDay })
      .where(and(eq(shiftAssignments.employeeId, p.data.employeeId), or(isNull(shiftAssignments.effectiveTo), gte(shiftAssignments.effectiveTo, p.data.effectiveFrom))));
    const [a] = await tx.insert(shiftAssignments).values({ ...p.data, createdBy: user.id }).returning();
    await audit({ action: "assign_shift", entity: "employee", entityId: p.data.employeeId, after: a, userId: user.id, userEmail: user.email, ...(await clientMeta()) }, tx);
    return null;
  });
  if (err) return { error: err };
  revalidatePath("/hr/shifts");
  return { ok: "Shift assigned" };
}
