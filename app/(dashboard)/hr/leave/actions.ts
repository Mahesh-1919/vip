"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { leaveTypes } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { toDb } from "@/lib/money";
import { clientMeta } from "@/lib/request";
import * as leave from "@/services/hr/leave";

const num = z.string().trim().regex(/^\d{1,4}(\.\d{1,2})?$/, "Enter a valid number of days");

export async function applyLeaveAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:leave:write");
  const p = z.object({
    employeeId: z.uuid(), leaveTypeId: z.uuid(), fromDate: z.iso.date("Start date is required"), toDate: z.iso.date("End date is required"),
    halfDay: z.enum(["", "first", "second"]), reason: z.string().trim().max(300),
  }).safeParse({ ...Object.fromEntries(form), halfDay: form.get("halfDay") ?? "" });
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    await leave.applyLeave({ ...p.data, halfDay: p.data.halfDay || null, reason: p.data.reason || null }, user, await clientMeta());
  } catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
  revalidatePath("/hr/leave", "layout");
  return { ok: "Leave request submitted" };
}

export async function decideAction(form: FormData) {
  const user = await requirePermission("hr:leave:approve");
  const p = z.object({ id: z.uuid(), decision: z.enum(["approve", "reject"]), note: z.string().trim().max(300) }).parse(Object.fromEntries(form));
  try {
    await leave.decideLeave(p.id, p.decision, p.note || null, user, await clientMeta());
  } catch (e) { if (!(e instanceof AppError)) throw e; }
  revalidatePath("/hr/leave", "layout");
  revalidatePath("/hr/attendance", "layout");
}

export async function cancelAction(form: FormData) {
  const user = await requirePermission("hr:leave:write");
  try { await leave.cancelLeave(z.uuid().parse(form.get("id")), user, await clientMeta()); } catch (e) { if (!(e instanceof AppError)) throw e; }
  revalidatePath("/hr/leave", "layout");
  revalidatePath("/hr/attendance", "layout");
}

export async function rolloverAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:config:write");
  const year = z.coerce.number().int().min(2000).max(2100).safeParse(form.get("year"));
  if (!year.success) return { error: "Enter a year" };
  const n = await leave.rolloverYear(year.data, user, await clientMeta());
  revalidatePath("/hr/leave", "layout");
  return { ok: `Carried forward ${n} balance(s) into ${year.data + 1}` };
}

const typeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, "Code: 2-20 letters/digits/underscore"),
  name: z.string().trim().min(2).max(80), annualQuota: num,
  accrual: z.enum(["annual_upfront", "monthly"]), payMode: z.enum(["paid", "unpaid", "tiered"]),
  minServiceMonths: z.coerce.number().int().min(0).max(60),
});

export async function createLeaveType(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:config:write");
  const p = typeSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const carryForward = form.get("carryForward") === "on";
  const max = form.get("carryForwardMax") ? num.safeParse(form.get("carryForwardMax")) : { success: true as const, data: "0" };
  if (!max.success) return { error: "Carry-forward cap must be a number of days" };
  try {
    const [t] = await db.insert(leaveTypes).values({
      ...p.data, annualQuota: toDb(p.data.annualQuota), allowHalfDay: form.get("allowHalfDay") === "on",
      carryForward, carryForwardMax: toDb(max.data),
    }).returning();
    await audit({ action: "create", entity: "leave_type", entityId: t.id, after: t, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === "23505") return { error: "A leave type with that code exists" };
    throw e;
  }
  revalidatePath("/hr/leave", "layout");
  return { ok: "Leave type created" };
}

export async function updateCarryForward(form: FormData) {
  const user = await requirePermission("hr:config:write");
  const p = z.object({ id: z.uuid(), max: num }).safeParse({ id: form.get("id"), max: form.get("max") || "0" });
  if (!p.success) return;
  const carryForward = form.get("carryForward") === "on";
  await db.update(leaveTypes).set({ carryForward, carryForwardMax: toDb(p.data.max) }).where(eq(leaveTypes.id, p.data.id));
  await audit({ action: "update", entity: "leave_type", entityId: p.data.id, after: { carryForward, carryForwardMax: p.data.max }, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  revalidatePath("/hr/leave", "layout");
}

export async function toggleLeaveType(form: FormData) {
  const user = await requirePermission("hr:config:write");
  const p = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).parse(Object.fromEntries(form));
  await db.update(leaveTypes).set({ isActive: p.active === "true" }).where(eq(leaveTypes.id, p.id));
  await audit({ action: "update", entity: "leave_type", entityId: p.id, after: { isActive: p.active }, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  revalidatePath("/hr/leave", "layout");
}
