"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { payrollSettings } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientMeta } from "@/lib/request";
import * as payroll from "@/services/hr/payroll";

const wrap = async (fn: () => Promise<ActionState | void>, okMsg: string): Promise<ActionState> => {
  try { return (await fn()) ?? { ok: okMsg }; }
  catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
};
const refresh = () => revalidatePath("/hr/payroll", "layout");

export async function generateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:payroll:write");
  const m = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(form.get("month"));
  if (!m.success) return { error: "Choose a month" };
  const [year, month] = m.data.split("-").map(Number);
  let runId = "";
  const res = await wrap(async () => { runId = (await payroll.generateDraft(year, month, user, await clientMeta())).runId; }, "");
  if (res?.error) return res;
  refresh();
  redirect(`/hr/payroll/${runId}`);
}

export async function recalcAction(runId: string): Promise<ActionState> {
  const user = await requirePermission("hr:payroll:write");
  return wrap(async () => {
    const [r] = await db.query.payrollRuns.findMany({ where: (t, { eq }) => eq(t.id, runId) });
    if (!r) throw new AppError(404, "Run not found");
    const { skipped } = await payroll.generateDraft(r.year, r.month, user, await clientMeta());
    refresh();
    return { ok: skipped.length ? `Recalculated. ${skipped.length} employee(s) skipped (no salary structure).` : "Recalculated" };
  }, "Recalculated");
}

export async function finalizeAction(runId: string): Promise<ActionState> {
  const user = await requirePermission("hr:payroll:finalize");
  return wrap(async () => { await payroll.finalizeRun(runId, user, await clientMeta()); refresh(); }, "Payroll finalised and locked");
}

export async function paidAction(runId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:payroll:finalize");
  const d = z.iso.date().safeParse(form.get("paidAt"));
  if (!d.success) return { error: "Choose the payment date" };
  return wrap(async () => { await payroll.markPaid(runId, d.data, user, await clientMeta()); refresh(); }, "Marked as paid");
}

export async function reopenAction(runId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:payroll:finalize");
  const reason = z.string().trim().min(5, "Give a reason (min 5 characters)").max(300).safeParse(form.get("reason"));
  if (!reason.success) return { error: reason.error.issues[0].message };
  return wrap(async () => { await payroll.reopenRun(runId, reason.data, user, await clientMeta()); refresh(); }, "Payroll reopened as draft");
}

export async function addAdjustmentAction(runId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:payroll:write");
  const p = z.object({
    employeeId: z.uuid(), label: z.string().trim().min(2).max(80), type: z.enum(["earning", "deduction"]),
    amount: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter a valid amount"),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  return wrap(async () => { await payroll.addAdjustment(runId, p.data.employeeId, p.data.label, p.data.type, p.data.amount, user, await clientMeta()); refresh(); }, "Adjustment added");
}

export async function removeAdjustmentAction(form: FormData) {
  const user = await requirePermission("hr:payroll:write");
  try { await payroll.removeAdjustment(z.uuid().parse(form.get("id")), user, await clientMeta()); } catch (e) { if (!(e instanceof AppError)) throw e; }
  refresh();
}

const settingsSchema = z.object({
  dayBasis: z.enum(["30", "calendar", "working"]),
  lateMode: z.enum(["none", "every_n_half_day"]),
  lateEveryN: z.coerce.number().int().min(1).max(30),
  employerId: z.string().trim().regex(/^(\d{13,14})?$/, "Employer ID must be 13–14 digits"),
  employerBankRouting: z.string().trim().regex(/^(\d{9})?$/, "Routing code must be 9 digits"),
});

export async function saveSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:config:write");
  const p = settingsSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const before = await payroll.getSettings();
  await db.update(payrollSettings).set({
    ...p.data, blockOnUnmarked: form.get("blockOnUnmarked") === "on",
    employerId: p.data.employerId || null, employerBankRouting: p.data.employerBankRouting || null,
  });
  await audit({ action: "update", entity: "payroll_settings", entityId: "1", before, after: p.data, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  refresh();
  return { ok: "Settings saved. They apply to the next calculation." };
}
