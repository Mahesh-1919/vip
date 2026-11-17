"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/api";
import type { ActionState } from "@/lib/action-state";
import { requirePermission } from "@/lib/auth";
import { clientMeta } from "@/lib/request";
import { employeeSchema, salarySchema } from "@/validators/hr";
import * as svc from "@/services/hr/employees";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string>; ok?: boolean } | undefined;

/** React 19 resets uncontrolled forms after an action; echo back non-sensitive input so users do not lose it. */
const SENSITIVE_FIELDS = new Set(["emiratesId", "passportNo", "iban"]);
function echo(form: FormData) {
  return Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === "string" && !SENSITIVE_FIELDS.has(k))) as Record<string, string>;
}

function fieldErrors(e: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of e.issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}

export async function saveEmployee(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  const user = await requirePermission("hr:employee:write");
  const parsed = employeeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Please fix the highlighted fields", fieldErrors: fieldErrors(parsed.error), values: echo(form) };
  const meta = await clientMeta();
  let targetId = id;
  try {
    if (id) await svc.updateEmployee(id, parsed.data, user, meta);
    else targetId = (await svc.createEmployee(parsed.data, user, meta)).id;
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, values: echo(form) };
    throw e;
  }
  revalidatePath("/hr/employees");
  redirect(`/hr/employees/${targetId}`);
}

export async function deactivate(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission("hr:employee:write");
  const p = z.object({ id: z.uuid(), status: z.enum(["inactive", "terminated"]), reason: z.string().trim().min(3, "Give a reason (min 3 characters)").max(300) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  await svc.deactivateEmployee(p.data.id, p.data.status, p.data.reason, user, await clientMeta());
  revalidatePath(`/hr/employees/${p.data.id}`);
  revalidatePath("/hr/employees");
  return { ok: "Employee deactivated" };
}

export async function reactivate(form: FormData) {
  const user = await requirePermission("hr:employee:write");
  const id = z.uuid().parse(form.get("id"));
  await svc.reactivateEmployee(id, user, await clientMeta());
  revalidatePath(`/hr/employees/${id}`);
  revalidatePath("/hr/employees");
}

export async function saveSalary(_: FormState, form: FormData): Promise<FormState> {
  const user = await requirePermission("hr:salary:write");
  const lines: { componentId: string; value: string }[] = [];
  for (const [k, v] of form.entries()) {
    if (k.startsWith("line:") && String(v).trim() !== "") lines.push({ componentId: k.slice(5), value: String(v) });
  }
  const parsed = salarySchema.safeParse({
    employeeId: form.get("employeeId"), effectiveFrom: form.get("effectiveFrom"), basic: form.get("basic"), lines,
  });
  if (!parsed.success) return { error: "Check the dates and amounts", fieldErrors: fieldErrors(parsed.error) };
  try {
    await svc.setSalaryStructure(parsed.data, user, await clientMeta());
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/hr/employees/${parsed.data.employeeId}`);
  return { ok: true };
}
