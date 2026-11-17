import "server-only";
import { and, asc, between, eq, inArray, lte, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/dates";
import { eachDate, minutesLate, monthRange } from "@/lib/hr-calendar";
import type { CurrentUser } from "@/lib/auth";
import { loadSchedules } from "./schedule";

type Meta = { ip: string | null; userAgent: string | null };
export const MARKABLE = ["present", "late", "half_day", "absent"] as const;
export type Markable = (typeof MARKABLE)[number];

const ACTIVE = notInArray(employees.status, ["inactive", "terminated"]);

export async function getDailySheet(date: string) {
  const emps = await db.select({ id: employees.id, empCode: employees.empCode, name: employees.name })
    .from(employees).where(and(ACTIVE, lte(employees.joinDate, date))).orderBy(asc(employees.empCode));
  const ids = emps.map((e) => e.id);
  const [sched, rows] = await Promise.all([
    loadSchedules(ids, date, date),
    ids.length ? db.select().from(attendance).where(and(eq(attendance.date, date), inArray(attendance.employeeId, ids))) : [],
  ]);
  return emps.map((e) => {
    const s = sched.get(e.id)!;
    const rec = rows.find((r) => r.employeeId === e.id) ?? null;
    return {
      ...e, record: rec, shift: s.shiftFor(date),
      dayType: s.holiday(date) ? ("holiday" as const) : s.isWeeklyOff(date) ? ("weekly_off" as const) : ("working" as const),
      holidayName: s.holiday(date),
    };
  });
}

export type SheetEntry = { employeeId: string; status: Markable | ""; checkIn: string | null; checkOut: string | null; note: string | null };

export async function saveDailySheet(date: string, entries: SheetEntry[], user: CurrentUser, meta: Meta) {
  if (date > todayISO()) throw new AppError(422, "Attendance cannot be recorded for a future date");
  const marked = entries.filter((e) => e.status);
  if (!marked.length) throw new AppError(422, "Nothing to save: no employee has a status");
  const ids = marked.map((e) => e.employeeId);
  const sched = await loadSchedules(ids, date, date);

  const changes = await db.transaction(async (tx) => {
    const valid = await tx.select({ id: employees.id }).from(employees).where(and(inArray(employees.id, ids), ACTIVE, lte(employees.joinDate, date)));
    const okIds = new Set(valid.map((v) => v.id));
    const existing = await tx.select().from(attendance).where(and(eq(attendance.date, date), inArray(attendance.employeeId, ids))).for("update");
    const log: { employeeId: string; before: string | null; after: string }[] = [];

    for (const e of marked) {
      if (!okIds.has(e.employeeId)) throw new AppError(422, "Unknown, inactive or not-yet-joined employee in sheet");
      const prev = existing.find((x) => x.employeeId === e.employeeId);
      if (prev?.leaveRequestId) continue; // leave-driven rows are managed from the leave request
      let status: Markable = e.status as Markable;
      const shift = sched.get(e.employeeId)?.shiftFor(date);
      if (status === "present" && e.checkIn && shift && minutesLate(e.checkIn, shift.startTime, shift.graceMinutes) > 0) status = "late";
      await tx.insert(attendance).values({
        employeeId: e.employeeId, date, status, checkIn: e.checkIn, checkOut: e.checkOut, note: e.note, createdBy: user.id,
      }).onConflictDoUpdate({
        target: [attendance.employeeId, attendance.date],
        set: { status, checkIn: e.checkIn, checkOut: e.checkOut, note: e.note, updatedAt: new Date() },
      });
      if (prev?.status !== status) log.push({ employeeId: e.employeeId, before: prev?.status ?? null, after: status });
    }
    await audit({ action: "save_attendance", entity: "attendance", entityId: date, after: { date, changes: log }, userId: user.id, userEmail: user.email, ...meta }, tx);
    return log.length;
  });
  return changes;
}

export async function getMonthCalendar(employeeId: string, year: number, month: number) {
  const { from, to } = monthRange(year, month);
  const [sched, rows] = await Promise.all([
    loadSchedules([employeeId], from, to),
    db.select().from(attendance).where(and(eq(attendance.employeeId, employeeId), between(attendance.date, from, to))),
  ]);
  const s = sched.get(employeeId)!;
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return eachDate(from, to).map((d) => ({
    date: d, record: byDate.get(d) ?? null, holiday: s.holiday(d), weeklyOff: s.isWeeklyOff(d),
  }));
}

export async function getMonthlySummary(year: number, month: number) {
  const { from, to } = monthRange(year, month);
  const emps = await db.select({ id: employees.id, empCode: employees.empCode, name: employees.name, joinDate: employees.joinDate })
    .from(employees).where(and(ACTIVE, lte(employees.joinDate, to))).orderBy(asc(employees.empCode));
  const ids = emps.map((e) => e.id);
  if (!ids.length) return [];
  const [sched, rows] = await Promise.all([
    loadSchedules(ids, from, to),
    db.select().from(attendance).where(and(inArray(attendance.employeeId, ids), between(attendance.date, from, to))),
  ]);
  const today = todayISO();
  return emps.map((e) => {
    const s = sched.get(e.id)!;
    const mine = rows.filter((r) => r.employeeId === e.id);
    const count = (st: string) => mine.filter((r) => r.status === st).length;
    const days = eachDate(from > e.joinDate ? from : e.joinDate, to);
    const working = days.filter((d) => s.isWorkingDay(d));
    const recorded = new Set(mine.map((r) => r.date));
    const unmarked = working.filter((d) => d <= today && !recorded.has(d)).length;
    return {
      ...e, workingDays: working.length, present: count("present"), late: count("late"), halfDay: count("half_day"),
      absent: count("absent"), onLeave: count("on_leave"), unmarked,
    };
  });
}

export async function clearLeaveAttendance(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], leaveRequestId: string) {
  await tx.delete(attendance).where(eq(attendance.leaveRequestId, leaveRequestId));
}
