import "server-only";
import { and, asc, between, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, holidayCalendars, holidays, shiftAssignments, shifts } from "@/db/schema";
import { weekday } from "@/lib/hr-calendar";

/** Weekly off used when an employee has no shift assigned (approved default: Sat-Sun). */
export const DEFAULT_WEEKLY_OFF = [0, 6];

export type Shift = typeof shifts.$inferSelect;
export type Schedule = {
  shiftFor(date: string): Shift | null;
  isWeeklyOff(date: string): boolean;
  holiday(date: string): string | null;
  /** Neither a weekly off nor a public holiday. */
  isWorkingDay(date: string): boolean;
};

/** Resolves shift + weekly-off + holiday calendar for many employees over a date range in 3 queries. */
export async function loadSchedules(employeeIds: string[], from: string, to: string): Promise<Map<string, Schedule>> {
  const result = new Map<string, Schedule>();
  if (!employeeIds.length) return result;

  const [assigns, emps, cals] = await Promise.all([
    db.select({ a: shiftAssignments, s: shifts })
      .from(shiftAssignments).innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .where(and(inArray(shiftAssignments.employeeId, employeeIds), lte(shiftAssignments.effectiveFrom, to),
        or(isNull(shiftAssignments.effectiveTo), gte(shiftAssignments.effectiveTo, from)))),
    db.select({ id: employees.id, cal: employees.holidayCalendarId }).from(employees).where(inArray(employees.id, employeeIds)),
    db.select().from(holidayCalendars),
  ]);
  const defaultCal = cals.find((c) => c.isDefault)?.id ?? null;
  const calIds = [...new Set(emps.map((e) => e.cal ?? defaultCal).filter((x): x is string => !!x))];
  const hols = calIds.length
    ? await db.select().from(holidays).where(and(inArray(holidays.calendarId, calIds), between(holidays.date, from, to)))
    : [];

  for (const e of emps) {
    const mine = assigns.filter((x) => x.a.employeeId === e.id).sort((x, y) => y.a.effectiveFrom.localeCompare(x.a.effectiveFrom));
    const calId = e.cal ?? defaultCal;
    const holMap = new Map(hols.filter((h) => h.calendarId === calId).map((h) => [h.date, h.name]));
    const shiftFor = (d: string) => mine.find((x) => x.a.effectiveFrom <= d && (!x.a.effectiveTo || x.a.effectiveTo >= d))?.s ?? null;
    const isWeeklyOff = (d: string) => (shiftFor(d)?.weeklyOff ?? DEFAULT_WEEKLY_OFF).includes(weekday(d));
    const holiday = (d: string) => holMap.get(d) ?? null;
    result.set(e.id, { shiftFor, isWeeklyOff, holiday, isWorkingDay: (d) => !isWeeklyOff(d) && !holiday(d) });
  }
  return result;
}

export const listShifts = () => db.select().from(shifts).orderBy(asc(shifts.name));
export const listCalendars = () => db.select().from(holidayCalendars).orderBy(asc(holidayCalendars.name));
