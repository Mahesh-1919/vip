import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  attendance, departments, employeeSalaries, employeeSalaryLines, employees, leaveRequests, leaveTypes,
  payrollAdjustments, payrollItems, payrollRuns, payrollSettings, salaryComponents,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { decryptField } from "@/lib/crypto";
import { todayISO } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { eachDate, monthRange, splitByTiers } from "@/lib/hr-calendar";
import { D, toDb } from "@/lib/money";
import { calculatePayroll, type Rules } from "@/lib/payroll-calc";
import type { CurrentUser } from "@/lib/auth";
import { loadSchedules } from "./schedule";
import { postPayrollFinalized, postPayrollPaid, reversePayroll } from "@/services/accounting/posting";

type Meta = { ip: string | null; userAgent: string | null };
const who = (u: CurrentUser, m: Meta) => ({ userId: u.id, userEmail: u.email, ...m });

export async function getSettings() {
  const [s] = await db.select().from(payrollSettings).where(eq(payrollSettings.id, 1));
  if (s) return s;
  const [created] = await db.insert(payrollSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(payrollSettings))[0];
}
const rulesOf = (s: Awaited<ReturnType<typeof getSettings>>): Rules => ({ dayBasis: s.dayBasis, lateMode: s.lateMode, lateEveryN: s.lateEveryN });

type Computed = Awaited<ReturnType<typeof compute>>[number];

/** Reads attendance/leave/salary data for the month and runs the pure calculator for each employee. */
async function compute(year: number, month: number, settings: Awaited<ReturnType<typeof getSettings>>, adjustments: (typeof payrollAdjustments.$inferSelect)[], q: Tx | typeof db = db) {
  const { from, to } = monthRange(year, month);
  const daysInMonth = Number(to.slice(8));
  const today = todayISO();
  const rules = rulesOf(settings);

  const emps = await q.select({
    id: employees.id, empCode: employees.empCode, name: employees.name, designation: employees.designation, department: departments.name,
    joinDate: employees.joinDate, status: employees.status, deactivatedAt: employees.deactivatedAt,
  }).from(employees).leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(lte(employees.joinDate, to), or(notInArray(employees.status, ["inactive", "terminated"]), gte(employees.deactivatedAt, new Date(from + "T00:00:00Z")))))
    .orderBy(asc(employees.empCode));
  const ids = emps.map((e) => e.id);
  if (!ids.length) return [];

  const [structs, lines, monthAtt, leaveRows, sched] = await Promise.all([
    q.select().from(employeeSalaries).where(and(inArray(employeeSalaries.employeeId, ids), lte(employeeSalaries.effectiveFrom, to))).orderBy(desc(employeeSalaries.effectiveFrom)),
    q.select({ salaryId: employeeSalaryLines.salaryId, name: salaryComponents.name, type: salaryComponents.type, calc: salaryComponents.calc, value: employeeSalaryLines.value })
      .from(employeeSalaryLines).innerJoin(salaryComponents, eq(salaryComponents.id, employeeSalaryLines.componentId)),
    q.select().from(attendance).where(and(inArray(attendance.employeeId, ids), gte(attendance.date, from), lte(attendance.date, to))),
    q.select({ employeeId: attendance.employeeId, date: attendance.date, status: attendance.status, typeId: leaveTypes.id, payMode: leaveTypes.payMode, tiers: leaveTypes.payTiers })
      .from(attendance).innerJoin(leaveRequests, eq(leaveRequests.id, attendance.leaveRequestId)).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(inArray(attendance.employeeId, ids), isNotNull(attendance.leaveRequestId), gte(attendance.date, `${year}-01-01`), lte(attendance.date, to))).orderBy(asc(attendance.date)),
    loadSchedules(ids, from, to),
  ]);

  const out = [];
  for (const e of emps) {
    const st = structs.find((s) => s.employeeId === e.id);
    if (!st) { out.push({ emp: e, skipped: "No salary structure effective for this month" as const }); continue; }
    const s = sched.get(e.id)!;
    const endDate = e.deactivatedAt && (e.status === "inactive" || e.status === "terminated") ? e.deactivatedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }) : null;
    const days = eachDate(from, to);
    const employed = days.filter((d) => d >= e.joinDate && (!endDate || d <= endDate));
    const workingDays = days.filter((d) => s.isWorkingDay(d));
    const unemployedDays = rules.dayBasis === "30" ? Math.max(0, 30 - Math.min(30, employed.length))
      : rules.dayBasis === "calendar" ? days.length - employed.length
      : workingDays.filter((d) => !employed.includes(d)).length;

    const mine = monthAtt.filter((a) => a.employeeId === e.id);
    const manual = mine.filter((a) => !a.leaveRequestId && s.isWorkingDay(a.date));
    const recorded = new Set(mine.map((a) => a.date));
    const unmarked = employed.filter((d) => d <= today && s.isWorkingDay(d) && !recorded.has(d)).length;

    const myLeave = leaveRows.filter((l) => l.employeeId === e.id);
    const dayVal = (status: string) => (status === "half_day" ? 0.5 : 1);
    const unpaidLeaveDays = myLeave.filter((l) => l.payMode === "unpaid" && l.date >= from).reduce((x, l) => x + dayVal(l.status), 0);
    // Tiered leave: cumulative days this year decide the pay percentage of each day.
    const cum = new Map<string, number>();
    let tieredLeaveLopDays = 0;
    for (const l of myLeave.filter((x) => x.payMode === "tiered" && x.tiers)) {
      const used = cum.get(l.typeId) ?? 0;
      const dv = dayVal(l.status);
      if (l.date >= from) for (const part of splitByTiers(used, dv, l.tiers!)) tieredLeaveLopDays += part.days * (1 - part.payPercent / 100);
      cum.set(l.typeId, used + dv);
    }

    const result = calculatePayroll({
      rules, daysInMonth, workingDaysInMonth: workingDays.length, basic: st.basic,
      lines: lines.filter((l) => l.salaryId === st.id),
      absentDays: manual.filter((a) => a.status === "absent").length,
      halfDays: manual.filter((a) => a.status === "half_day").length,
      lateCount: manual.filter((a) => a.status === "late").length,
      unpaidLeaveDays, tieredLeaveLopDays: Math.round(tieredLeaveLopDays * 100) / 100, unemployedDays,
      adjustments: adjustments.filter((a) => a.employeeId === e.id).map((a) => ({ label: a.label, type: a.type, amount: a.amount })),
    });
    const warnings = [...result.warnings];
    if (unmarked) warnings.push(`${unmarked} working day(s) have no attendance record`);
    out.push({ emp: e, skipped: null, basic: st.basic, result, unmarked, warnings });
  }
  return out;
}

function summarize(rows: Computed[]) {
  const ok = rows.filter((r): r is Extract<Computed, { skipped: null }> => r.skipped === null);
  return {
    ok,
    skipped: rows.filter((r) => r.skipped !== null).map((r) => ({ emp: r.emp, reason: r.skipped as string })),
    totals: ok.reduce((t, r) => ({ gross: t.gross.plus(r.result.gross), ded: t.ded.plus(r.result.totalDeductions), net: t.net.plus(r.result.net) }), { gross: D(0), ded: D(0), net: D(0) }),
  };
}

async function writeItems(tx: Tx, runId: string, rows: ReturnType<typeof summarize>["ok"]) {
  await tx.delete(payrollItems).where(eq(payrollItems.runId, runId));
  if (rows.length)
    await tx.insert(payrollItems).values(rows.map((r) => ({
      runId, employeeId: r.emp.id, empCode: r.emp.empCode, employeeName: r.emp.name, designation: r.emp.designation, department: r.emp.department,
      basic: r.basic, earnings: r.result.earnings, deductions: r.result.deductions, basisDays: r.result.basisDays,
      lopDays: toDb(r.result.lopDays), paidDays: toDb(r.result.paidDays), gross: r.result.gross, totalDeductions: r.result.totalDeductions,
      net: r.result.net, warnings: r.warnings,
    })));
}

/** Creates the month's draft run, or recalculates the existing draft (adjustments are kept). */
export async function generateDraft(year: number, month: number, user: CurrentUser, meta: Meta) {
  if (month < 1 || month > 12) throw new AppError(422, "Invalid month");
  const settings = await getSettings();
  return db.transaction(async (tx) => {
    let [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.year, year), eq(payrollRuns.month, month))).for("update");
    if (run && run.status !== "draft") throw new AppError(409, `Payroll for ${month}/${year} is already ${run.status}`);
    const rulesSnapshot = rulesOf(settings);
    if (!run) [run] = await tx.insert(payrollRuns).values({ year, month, rulesSnapshot, createdBy: user.id }).returning();
    const adj = await tx.select().from(payrollAdjustments).where(eq(payrollAdjustments.runId, run.id));
    const { ok, skipped, totals } = summarize(await compute(year, month, settings, adj, tx));
    await writeItems(tx, run.id, ok);
    await tx.update(payrollRuns).set({
      rulesSnapshot, totalGross: toDb(totals.gross), totalDeductions: toDb(totals.ded), totalNet: toDb(totals.net), version: sql`${payrollRuns.version} + 1`,
    }).where(eq(payrollRuns.id, run.id));
    await audit({ action: "generate_payroll", entity: "payroll_run", entityId: run.id, after: { year, month, employees: ok.length, skipped: skipped.length, net: totals.net.toFixed(2) }, ...who(user, meta) }, tx);
    return { runId: run.id, skipped };
  });
}

export async function finalizeRun(runId: string, user: CurrentUser, meta: Meta) {
  const settings = await getSettings();
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).for("update");
    if (!run) throw new AppError(404, "Payroll run not found");
    if (run.status !== "draft") throw new AppError(409, `Payroll is already ${run.status}`);
    const { to } = monthRange(run.year, run.month);
    if (to >= todayISO()) throw new AppError(422, "The month has not ended yet; finalise after the last day of the month");

    const adj = await tx.select().from(payrollAdjustments).where(eq(payrollAdjustments.runId, runId));
    const fresh = summarize(await compute(run.year, run.month, settings, adj, tx));
    const stored = await tx.select().from(payrollItems).where(eq(payrollItems.runId, runId));
    const same = stored.length === fresh.ok.length && fresh.ok.every((f) => {
      const s = stored.find((x) => x.employeeId === f.emp.id);
      return s && s.gross === f.result.gross && s.net === f.result.net && s.totalDeductions === f.result.totalDeductions;
    });
    if (!same) throw new AppError(409, "Attendance, leave or salary data changed since this draft was calculated. Recalculate, review, then finalise.");

    if (settings.blockOnUnmarked) {
      const bad = fresh.ok.filter((r) => r.unmarked > 0);
      if (bad.length) throw new AppError(422, `Attendance is incomplete for ${bad.map((b) => b.emp.name).slice(0, 5).join(", ")}${bad.length > 5 ? "…" : ""}. Mark every working day before finalising.`);
    }
    const neg = fresh.ok.filter((r) => D(r.result.net).isNegative());
    if (neg.length) throw new AppError(422, `Negative net pay for ${neg.map((n) => n.emp.name).join(", ")}`);
    if (!fresh.ok.length) throw new AppError(422, "The run has no employees");

    await tx.update(payrollRuns).set({ status: "finalized", finalizedBy: user.id, finalizedAt: new Date(), rulesSnapshot: rulesOf(settings), version: sql`${payrollRuns.version} + 1` }).where(eq(payrollRuns.id, runId));
    await postPayrollFinalized(tx, runId, user.id);
    await audit({ action: "finalize_payroll", entity: "payroll_run", entityId: runId, after: { year: run.year, month: run.month, net: run.totalNet }, ...who(user, meta) }, tx);
  });
}

export async function markPaid(runId: string, paidAt: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).for("update");
    if (!run) throw new AppError(404, "Payroll run not found");
    if (run.status !== "finalized") throw new AppError(409, "Only a finalised run can be marked paid");
    await tx.update(payrollRuns).set({ status: "paid", paidAt }).where(eq(payrollRuns.id, runId));
    await postPayrollPaid(tx, runId, user.id);
    await audit({ action: "pay_payroll", entity: "payroll_run", entityId: runId, after: { paidAt }, ...who(user, meta) }, tx);
  });
}

/** Admin-only escape hatch for a finalised (not yet paid) run. Always audited with a reason. */
export async function reopenRun(runId: string, reason: string, user: CurrentUser, meta: Meta) {
  if (user.role.key !== "admin") throw new AppError(403, "Only an Admin can reopen a finalised payroll");
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).for("update");
    if (!run) throw new AppError(404, "Payroll run not found");
    if (run.status !== "finalized") throw new AppError(409, run.status === "paid" ? "A paid payroll cannot be reopened" : "Run is not finalised");
    await reversePayroll(tx, runId, run.finalizedAt, user.id);
    await tx.execute(sql`select set_config('erp.allow_reopen', 'on', true)`);
    await tx.update(payrollRuns).set({ status: "draft", finalizedAt: null, finalizedBy: null, version: sql`${payrollRuns.version} + 1` }).where(eq(payrollRuns.id, runId));
    await audit({ action: "reopen_payroll", entity: "payroll_run", entityId: runId, after: { reason }, ...who(user, meta) }, tx);
  });
}

export async function addAdjustment(runId: string, employeeId: string, label: string, type: "earning" | "deduction", amount: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).for("update");
    if (!run) throw new AppError(404, "Payroll run not found");
    if (run.status !== "draft") throw new AppError(409, "Only a draft payroll can be adjusted");
    const [a] = await tx.insert(payrollAdjustments).values({ runId, employeeId, label, type, amount: toDb(amount), createdBy: user.id }).returning();
    await audit({ action: "add_adjustment", entity: "payroll_run", entityId: runId, after: a, ...who(user, meta) }, tx);
  });
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  await generateDraft(run.year, run.month, user, meta);
}

export async function removeAdjustment(adjustmentId: string, user: CurrentUser, meta: Meta) {
  const [a] = await db.select().from(payrollAdjustments).where(eq(payrollAdjustments.id, adjustmentId));
  if (!a) throw new AppError(404, "Adjustment not found");
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, a.runId));
  if (run.status !== "draft") throw new AppError(409, "Only a draft payroll can be adjusted");
  await db.transaction(async (tx) => {
    await tx.delete(payrollAdjustments).where(eq(payrollAdjustments.id, adjustmentId));
    await audit({ action: "remove_adjustment", entity: "payroll_run", entityId: run.id, before: a, ...who(user, meta) }, tx);
  });
  await generateDraft(run.year, run.month, user, meta);
}

// ---- reads ----
export const listRuns = () => db.select().from(payrollRuns).orderBy(desc(payrollRuns.year), desc(payrollRuns.month));

export async function getRun(runId: string) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return null;
  const [items, adjustments] = await Promise.all([
    db.select().from(payrollItems).where(eq(payrollItems.runId, runId)).orderBy(asc(payrollItems.empCode)),
    db.select().from(payrollAdjustments).where(eq(payrollAdjustments.runId, runId)).orderBy(asc(payrollAdjustments.createdAt)),
  ]);
  return { run, items, adjustments };
}

export async function getItem(itemId: string) {
  const [row] = await db.select({ item: payrollItems, run: payrollRuns }).from(payrollItems).innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId)).where(eq(payrollItems.id, itemId));
  return row ?? null;
}

export const listPayslips = (employeeId: string) =>
  db.select({ item: payrollItems, run: payrollRuns }).from(payrollItems).innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.employeeId, employeeId), ne(payrollRuns.status, "draft"))).orderBy(desc(payrollRuns.year), desc(payrollRuns.month));

/** WPS Salary Information File. Format follows MOHRE's EDR/SCR layout; confirm with your bank's sample before first upload. */
export async function buildSif(runId: string) {
  const data = await getRun(runId);
  if (!data) throw new AppError(404, "Payroll run not found");
  const { run, items, adjustments } = data;
  if (run.status === "draft") throw new AppError(409, "Finalise the payroll before exporting the SIF");
  const settings = await getSettings();
  const errors: string[] = [];
  if (!settings.employerId || !/^\d{13,14}$/.test(settings.employerId)) errors.push("Employer ID (MOHRE establishment ID, 13–14 digits) is not set in payroll settings");
  if (!settings.employerBankRouting || !/^\d{9}$/.test(settings.employerBankRouting)) errors.push("Employer bank routing code (9 digits) is not set in payroll settings");

  const emps = await db.select().from(employees).where(inArray(employees.id, items.map((i) => i.employeeId)));
  const { from, to } = monthRange(run.year, run.month);
  const lines: string[] = [];
  let total = D(0);
  for (const it of items) {
    const e = emps.find((x) => x.id === it.employeeId)!;
    if (!e.personCode || !/^\d{1,14}$/.test(e.personCode)) errors.push(`${it.employeeName}: MOHRE person code missing/invalid`);
    if (!e.routingCode || !/^\d{9}$/.test(e.routingCode)) errors.push(`${it.employeeName}: bank routing code missing/invalid`);
    if (!e.ibanEnc) errors.push(`${it.employeeName}: IBAN missing`);
    if (D(it.net).lte(0)) continue; // nothing to transfer
    const variable = adjustments.filter((a) => a.employeeId === it.employeeId && a.type === "earning").reduce((s, a) => s.plus(a.amount), D(0));
    const fixed = D(it.net).minus(variable);
    total = total.plus(it.net);
    if (e.personCode && e.routingCode && e.ibanEnc)
      lines.push(["EDR", e.personCode.padStart(14, "0"), e.routingCode, decryptField(e.ibanEnc), from, to, Number(to.slice(8)), fixed.toFixed(2), variable.toFixed(2), Math.round(Number(it.lopDays))].join(","));
  }
  if (errors.length) return { errors, filename: "", content: "" };
  const now = new Date();
  const dubai = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => dubai.find((p) => p.type === t)!.value;
  const scr = ["SCR", settings.employerId, settings.employerBankRouting, `${g("year")}-${g("month")}-${g("day")}`, `${g("hour")}${g("minute")}`, `${String(run.month).padStart(2, "0")}${run.year}`, lines.length, total.toFixed(2), "AED", ""].join(",");
  return { errors, filename: `${settings.employerId}${g("year").slice(2)}${g("month")}${g("day")}${g("hour")}${g("minute")}${g("second")}.SIF`, content: [...lines, scr].join("\r\n") + "\r\n" };
}
