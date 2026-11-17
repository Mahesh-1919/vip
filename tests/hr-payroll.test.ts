import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { renderToBuffer } from "@react-pdf/renderer";
import { db, sql as pg } from "@/db";
import {
  attendance, employeeSalaries, employeeSalaryLines, employees, leaveBalances, leaveRequests, leaveTypes, payrollAdjustments,
  payrollItems, payrollRuns, payrollSettings, salaryComponents, shiftAssignments, shifts, users,
} from "@/db/schema";
import { encryptField } from "@/lib/crypto";
import { eachDate, monthRange, weekday } from "@/lib/hr-calendar";
import { PayslipPdf } from "@/components/payslip-pdf";
import { purgeSince } from "./purge";
import * as leave from "@/services/hr/leave";
import * as payroll from "@/services/hr/payroll";

const meta = { ip: null, userAgent: null };
const Y = 2025, M = 3; // far in the past so no real data collides
let admin: never, hr: never, empId: string;
let origSettings: typeof payrollSettings.$inferSelect;
let touchedEmployees: { id: string; personCode: string | null; routingCode: string | null }[] = [];

const t0 = new Date(Date.now() - 2000);

beforeAll(async () => {
  const [u] = await db.select().from(users).limit(1);
  admin = { id: u.id, email: u.email, role: { key: "admin" }, permissions: new Set(["hr:leave:approve", "hr:leave:write"]) } as never;
  hr = { id: u.id, email: u.email, role: { key: "hr_manager" }, permissions: new Set() } as never;
  origSettings = await payroll.getSettings();

  const [e] = await db.insert(employees).values({ empCode: `PT-${Date.now()}`, name: "Payroll Tester", joinDate: "2024-06-01", gender: "male", ibanEnc: encryptField("AE070331234567890123456") }).returning();
  empId = e.id;
  const [shift] = await db.select().from(shifts).where(eq(shifts.name, "General (09:00-18:00)"));
  await db.insert(shiftAssignments).values({ employeeId: empId, shiftId: shift.id, effectiveFrom: "2024-06-01" });
  const comps = await db.select().from(salaryComponents);
  const [sal] = await db.insert(employeeSalaries).values({ employeeId: empId, effectiveFrom: "2024-06-01", basic: "6000" }).returning();
  await db.insert(employeeSalaryLines).values([
    { salaryId: sal.id, componentId: comps.find((c) => c.code === "HOUSING")!.id, value: "25" },
    { salaryId: sal.id, componentId: comps.find((c) => c.code === "TRANSPORT")!.id, value: "600" },
  ]);

  // March 2025: present every working day, then override specific days
  const { from, to } = monthRange(Y, M);
  const days = eachDate(from, to).filter((d) => ![0, 6].includes(weekday(d)));
  await db.insert(attendance).values(days.map((d) => ({ employeeId: empId, date: d, status: "present" as const })));
  const set = (date: string, status: "absent" | "half_day" | "late") => db.update(attendance).set({ status }).where(and(eq(attendance.employeeId, empId), eq(attendance.date, date)));
  await set("2025-03-04", "absent"); await set("2025-03-05", "absent"); await set("2025-03-06", "half_day");
  await set("2025-03-17", "late"); await set("2025-03-18", "late"); await set("2025-03-19", "late");

  const types = Object.fromEntries((await db.select().from(leaveTypes)).map((t) => [t.code, t.id]));
  const run = async (code: string, f: string, t: string) => {
    const r = await leave.applyLeave({ employeeId: empId, leaveTypeId: types[code], fromDate: f, toDate: t, halfDay: null, reason: null }, admin, meta);
    await leave.decideLeave(r.id, "approve", null, admin, meta);
  };
  await run("SICK", "2025-01-06", "2025-01-24"); // 15 working days: all at full pay
  await run("UNPAID", "2025-03-10", "2025-03-10");
  await run("SICK", "2025-03-12", "2025-03-13"); // days 16-17 => 50% pay
});

afterAll(async () => {
  await purgeSince(t0);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('erp.allow_reopen', 'on', true)`);
    const runs = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.year, Y), eq(payrollRuns.month, M)));
    const ids = runs.map((r) => r.id);
    if (ids.length) {
      await tx.delete(payrollAdjustments).where(inArray(payrollAdjustments.runId, ids));
      await tx.delete(payrollItems).where(inArray(payrollItems.runId, ids));
      await tx.delete(payrollRuns).where(inArray(payrollRuns.id, ids));
    }
  });
  const cur = new Date(); const curRun = await db.select().from(payrollRuns).where(and(eq(payrollRuns.year, cur.getUTCFullYear()), eq(payrollRuns.month, cur.getUTCMonth() + 1), eq(payrollRuns.status, "draft")));
  for (const r of curRun) { await db.delete(payrollItems).where(eq(payrollItems.runId, r.id)); await db.delete(payrollRuns).where(eq(payrollRuns.id, r.id)); }
  for (const t of touchedEmployees) await db.update(employees).set({ personCode: t.personCode, routingCode: t.routingCode }).where(eq(employees.id, t.id));
  await db.update(payrollSettings).set({ blockOnUnmarked: origSettings.blockOnUnmarked, employerId: origSettings.employerId, employerBankRouting: origSettings.employerBankRouting });
  await db.delete(attendance).where(eq(attendance.employeeId, empId));
  await db.delete(leaveRequests).where(eq(leaveRequests.employeeId, empId));
  await db.delete(leaveBalances).where(eq(leaveBalances.employeeId, empId));
  await db.delete(shiftAssignments).where(eq(shiftAssignments.employeeId, empId));
  await db.delete(employeeSalaryLines).where(inArray(employeeSalaryLines.salaryId, (await db.select({ id: employeeSalaries.id }).from(employeeSalaries).where(eq(employeeSalaries.employeeId, empId))).map((s) => s.id)));
  await db.delete(employeeSalaries).where(eq(employeeSalaries.employeeId, empId));
  await db.delete(employees).where(eq(employees.id, empId));
  await pg.end();
});

let runId: string;
const myItem = async () => (await payroll.getRun(runId))!.items.find((i) => i.employeeId === empId)!;

describe("payroll run", () => {
  it("calculates from salary, attendance, unpaid and tiered sick leave", async () => {
    await db.update(payrollSettings).set({ blockOnUnmarked: true, dayBasis: "30", lateMode: "none" });
    runId = (await payroll.generateDraft(Y, M, admin, meta)).runId;
    const it = await myItem();
    expect(it.gross).toBe("8100.00");
    // LOP: 2 absent + 0.5 half + 1 unpaid leave + 1.0 (2 sick days at 50% pay) = 4.5 days × 270
    expect(Number(it.lopDays)).toBe(4.5);
    expect(it.net).toBe("6885.00");
    expect(it.warnings).toEqual([]);
  });

  it("adjustments are kept across recalculation", async () => {
    await payroll.addAdjustment(runId, empId, "Bonus", "earning", "500", admin, meta);
    expect((await myItem()).net).toBe("7385.00");
    await payroll.generateDraft(Y, M, admin, meta);
    expect((await myItem()).net).toBe("7385.00");
    const adj = (await payroll.getRun(runId))!.adjustments;
    await payroll.removeAdjustment(adj[0].id, admin, meta);
    expect((await myItem()).net).toBe("6885.00");
  });

  it("refuses to finalise while attendance is unmarked, then finalises", async () => {
    await expect(payroll.finalizeRun(runId, admin, meta)).rejects.toMatchObject({ status: 422 });
    await db.update(payrollSettings).set({ blockOnUnmarked: false });
    await payroll.finalizeRun(runId, admin, meta);
    expect((await payroll.getRun(runId))!.run.status).toBe("finalized");
  });

  it("is locked at the database level once finalised", async () => {
    const it = await myItem();
    await expect(db.update(payrollItems).set({ net: "999999.00" }).where(eq(payrollItems.id, it.id))).rejects.toThrow();
    await expect(db.delete(payrollItems).where(eq(payrollItems.id, it.id))).rejects.toThrow();
    await expect(payroll.generateDraft(Y, M, admin, meta)).rejects.toMatchObject({ status: 409 });
    await expect(payroll.addAdjustment(runId, empId, "x", "earning", "1", admin, meta)).rejects.toMatchObject({ status: 409 });
  });

  it("only an admin can reopen, with an audit trail; paid runs cannot be reopened", async () => {
    await expect(payroll.reopenRun(runId, "mistake", hr, meta)).rejects.toMatchObject({ status: 403 });
    await payroll.reopenRun(runId, "Wrong attendance for 4 March", admin, meta);
    expect((await payroll.getRun(runId))!.run.status).toBe("draft");
    await payroll.finalizeRun(runId, admin, meta);
    await payroll.markPaid(runId, "2025-04-01", admin, meta);
    await expect(payroll.reopenRun(runId, "again", admin, meta)).rejects.toMatchObject({ status: 409 });
  });

  it("renders a payslip PDF", async () => {
    const it = await myItem();
    const buf = await renderToBuffer(PayslipPdf({ company: { name: "Test Co", address: "Dubai" }, year: Y, month: M, item: it }));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1500);
  });

  it("builds a WPS SIF only when data is complete", async () => {
    const first = await payroll.buildSif(runId);
    expect(first.errors.join(" ")).toMatch(/Employer ID/);
    const inRun = await db.select().from(employees).where(inArray(employees.id, (await payroll.getRun(runId))!.items.map((i) => i.employeeId)));
    touchedEmployees = inRun.map((e) => ({ id: e.id, personCode: e.personCode, routingCode: e.routingCode }));
    await db.update(employees).set({ personCode: "12345678901234", routingCode: "123456789" }).where(inArray(employees.id, inRun.map((e) => e.id)));
    for (const e of inRun) if (!e.ibanEnc) await db.update(employees).set({ ibanEnc: encryptField("AE070331234567890123456") }).where(eq(employees.id, e.id));
    await db.update(payrollSettings).set({ employerId: "12345678901234", employerBankRouting: "987654321" });
    const sif = await payroll.buildSif(runId);
    expect(sif.errors).toEqual([]);
    const lines = sif.content.trim().split("\r\n");
    const scr = lines.at(-1)!.split(",");
    expect(scr[0]).toBe("SCR");
    expect(scr[5]).toBe("032025");
    expect(Number(scr[6])).toBe(lines.length - 1);
    const total = lines.slice(0, -1).reduce((s, l) => s + Number(l.split(",")[7]) + Number(l.split(",")[8]), 0);
    expect(Number(scr[7])).toBeCloseTo(total, 2);
    expect(lines.find((l) => l.includes("AE070331234567890123456"))!.startsWith("EDR,12345678901234,123456789,")).toBe(true);
  });

  it("refuses to finalise a month that has not ended", async () => {
    const now = new Date();
    const { runId: cur } = await payroll.generateDraft(now.getUTCFullYear(), now.getUTCMonth() + 1, admin, meta);
    await expect(payroll.finalizeRun(cur, admin, meta)).rejects.toThrow(/not ended/);
  });
});
