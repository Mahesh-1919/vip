"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { employees, holidayCalendars, holidays } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { clientMeta } from "@/lib/request";

const dup = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505";
async function log(user: { id: string; email: string }, action: string, entity: string, entityId: string, after?: unknown) {
  await audit({ action, entity, entityId, after, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
}

export async function createCalendar(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:config:write");
  const p = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Enter a calendar name" };
  try {
    const [c] = await db.insert(holidayCalendars).values({ name: p.data.name }).returning();
    await log(user, "create", "holiday_calendar", c.id, c);
  } catch (e) { if (dup(e)) return { error: "That calendar already exists" }; throw e; }
  revalidatePath("/hr/holidays");
  return { ok: "Calendar created" };
}

export async function addHoliday(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:config:write");
  const p = z.object({ calendarId: z.uuid(), date: z.iso.date(), name: z.string().trim().min(2).max(100) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose a calendar, date and name" };
  try {
    const [h] = await db.insert(holidays).values(p.data).returning();
    await log(user, "create", "holiday", h.id, h);
  } catch (e) { if (dup(e)) return { error: "That date is already in the calendar" }; throw e; }
  revalidatePath("/hr/holidays");
  return { ok: "Holiday added" };
}

export async function removeHoliday(form: FormData) {
  const user = await requirePermission("hr:config:write");
  const id = z.uuid().parse(form.get("id"));
  await db.delete(holidays).where(eq(holidays.id, id));
  await log(user, "delete", "holiday", id);
  revalidatePath("/hr/holidays");
}

export async function assignCalendar(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:config:write");
  const p = z.object({ employeeId: z.uuid(), calendarId: z.string() }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Choose an employee" };
  const calendarId = p.data.calendarId === "" ? null : z.uuid().safeParse(p.data.calendarId).data ?? null;
  await db.update(employees).set({ holidayCalendarId: calendarId }).where(eq(employees.id, p.data.employeeId));
  await log(user, "assign_calendar", "employee", p.data.employeeId, { calendarId });
  revalidatePath("/hr/holidays");
  return { ok: "Calendar assigned" };
}
