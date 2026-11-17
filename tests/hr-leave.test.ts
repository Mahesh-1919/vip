import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, sql } from "@/db";
import { attendance, employees, leaveBalances, leaveRequests, leaveTypes, shiftAssignments, shifts, users } from "@/db/schema";
import * as leave from "@/services/hr/leave";
import * as att from "@/services/hr/attendance";
import { todayISO } from "@/lib/dates";

const meta = { ip: null, userAgent: null };
let user: never;
let empId: string;
const types: Record<string, string> = {};

beforeAll(async () => {
  const [u] = await db.select().from(users).limit(1);
  user = { id: u.id, email: u.email, permissions: new Set(["hr:leave:approve", "hr:leave:write"]) } as never;
  for (const t of await db.select().from(leaveTypes)) types[t.code] = t.id;
  const [e] = await db.insert(employees).values({ empCode: `T-${Date.now()}`, name: "Leave Tester", joinDate: "2025-01-01", gender: "male" }).returning();
  empId = e.id;
  const [shift] = await db.select().from(shifts).where(eq(shifts.name, "General (09:00-18:00)"));
  await db.insert(shiftAssignments).values({ employeeId: empId, shiftId: shift.id, effectiveFrom: "2025-01-01" });
});
afterAll(async () => {
  await db.delete(attendance).where(eq(attendance.employeeId, empId));
  await db.delete(leaveRequests).where(eq(leaveRequests.employeeId, empId));
  await db.delete(leaveBalances).where(eq(leaveBalances.employeeId, empId));
  await db.delete(shiftAssignments).where(eq(shiftAssignments.employeeId, empId));
  await db.delete(employees).where(eq(employees.id, empId));
  await sql.end();
});

const apply = (code: string, from: string, to = from, halfDay: "first" | "second" | null = null) =>
  leave.applyLeave({ employeeId: empId, leaveTypeId: types[code], fromDate: from, toDate: to, halfDay, reason: null }, user, meta);

describe("leave", () => {
  it("counts only working days (skips weekend)", async () => {
    // Thu 26 Nov .. Mon 30 Nov 2026 => Thu, Fri, Mon
    const r = await apply("CASUAL", "2026-11-26", "2026-11-30");
    expect(Number(r.days)).toBe(3);
  });

  it("skips public holidays from the calendar", async () => {
    // Tue 1 Dec .. Fri 4 Dec 2026, with 2 & 3 Dec holidays => 2 days (needs 6 casual total: 3 used pending + 2 = 5 ok)
    const r = await apply("UNPAID", "2026-12-01", "2026-12-04");
    expect(Number(r.days)).toBe(2);
  });

  it("blocks overlapping requests but allows opposite half-days", async () => {
    await expect(apply("CASUAL", "2026-11-27")).rejects.toMatchObject({ status: 409 });
    await apply("UNPAID", "2026-12-08", "2026-12-08", "first");
    await expect(apply("UNPAID", "2026-12-08", "2026-12-08", "first")).rejects.toMatchObject({ status: 409 });
    await apply("UNPAID", "2026-12-08", "2026-12-08", "second");
  });

  it("rejects insufficient balance counting pending requests", async () => {
    // 6 casual per year, 3 already pending; 4 more working days (Dec 14-17) must fail
    await expect(apply("CASUAL", "2026-12-14", "2026-12-17")).rejects.toMatchObject({ status: 422 });
  });

  it("enforces half-day, weekly-off and gender rules", async () => {
    await expect(apply("BEREAVEMENT", "2026-12-09", "2026-12-09", "first")).rejects.toMatchObject({ status: 422 });
    await expect(apply("CASUAL", "2026-12-12", "2026-12-13")).rejects.toThrow(/weekly offs/); // Sat-Sun
    await expect(apply("MATERNITY", "2026-12-15")).rejects.toMatchObject({ status: 422 });
  });

  it("approve deducts balance and marks attendance; cancel restores both", async () => {
    const [req] = await db.select().from(leaveRequests).where(and(eq(leaveRequests.employeeId, empId), eq(leaveRequests.leaveTypeId, types.CASUAL)));
    await leave.decideLeave(req.id, "approve", "ok", user, meta);
    const [bal] = await db.select().from(leaveBalances).where(and(eq(leaveBalances.employeeId, empId), eq(leaveBalances.leaveTypeId, types.CASUAL), eq(leaveBalances.year, 2026)));
    expect(Number(bal.used)).toBe(3);
    const rows = await db.select().from(attendance).where(and(eq(attendance.employeeId, empId), eq(attendance.leaveRequestId, req.id)));
    expect(rows.map((r) => r.date).sort()).toEqual(["2026-11-26", "2026-11-27", "2026-11-30"]);
    expect(rows.every((r) => r.status === "on_leave")).toBe(true);
    await expect(leave.decideLeave(req.id, "approve", null, user, meta)).rejects.toMatchObject({ status: 409 });

    await leave.cancelLeave(req.id, user, meta);
    const [after] = await db.select().from(leaveBalances).where(eq(leaveBalances.id, bal.id));
    expect(Number(after.used)).toBe(0);
    expect(await db.select().from(attendance).where(eq(attendance.leaveRequestId, req.id))).toHaveLength(0);
  });

  it("carries forward only for types that enable it, capped", async () => {
    const [annual] = await db.select().from(leaveTypes).where(eq(leaveTypes.code, "ANNUAL"));
    await db.insert(leaveBalances).values({ employeeId: empId, leaveTypeId: annual.id, year: 2020, allocated: "30", used: "8" }).onConflictDoNothing();
    await db.insert(leaveBalances).values({ employeeId: empId, leaveTypeId: types.CASUAL, year: 2020, allocated: "6", used: "0" }).onConflictDoNothing();
    await leave.rolloverYear(2020, user, meta);
    const next = await db.select().from(leaveBalances).where(and(eq(leaveBalances.employeeId, empId), eq(leaveBalances.year, 2021)));
    expect(Number(next.find((b) => b.leaveTypeId === annual.id)?.carriedForward)).toBe(10); // 22 remaining, capped at 10
    expect(next.find((b) => b.leaveTypeId === types.CASUAL)).toBeUndefined(); // casual: carry-forward off
  });
});

describe("attendance", () => {
  it("auto-marks late after grace and protects leave rows; rejects future dates", async () => {
    const day = (() => { let d = new Date(Date.now() - 86400000); while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() - 86400000); return d.toISOString().slice(0, 10); })();
    const n = await att.saveDailySheet(day, [{ employeeId: empId, status: "present", checkIn: "09:40", checkOut: "18:00", note: null }], user, meta);
    expect(n).toBe(1);
    const [row] = await db.select().from(attendance).where(and(eq(attendance.employeeId, empId), eq(attendance.date, day)));
    expect(row.status).toBe("late");
    await expect(att.saveDailySheet("2999-01-01", [{ employeeId: empId, status: "present", checkIn: null, checkOut: null, note: null }], user, meta)).rejects.toMatchObject({ status: 422 });
    expect(day <= todayISO()).toBe(true);
  });
  it("summary reports counts", async () => {
    const rows = await att.getMonthlySummary(2026, 11);
    expect(rows.some((r) => r.id === empId)).toBe(true);
  });
});
