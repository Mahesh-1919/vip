import {
  pgTable, pgEnum, text, boolean, date, numeric, integer, uuid, jsonb, timestamp, index, uniqueIndex, time,
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, version } from "./_columns";
import { users } from "./auth";
import { employees } from "./hr";

export const attendanceStatus = pgEnum("attendance_status", ["present", "absent", "half_day", "late", "on_leave"]);
export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "rejected", "cancelled"]);
export const accrualMode = pgEnum("leave_accrual", ["annual_upfront", "monthly"]);
export const leavePayMode = pgEnum("leave_pay_mode", ["paid", "unpaid", "tiered"]);

export const shifts = pgTable("shifts", {
  id: id(),
  name: text().notNull().unique(),
  startTime: time().notNull(), // 'HH:MM:SS'
  endTime: time().notNull(),
  graceMinutes: integer().notNull().default(0),
  breakMinutes: integer().notNull().default(60),
  /** Shift ends the next calendar day (night shift). */
  isOvernight: boolean().notNull().default(false),
  /** Weekly off days, 0 = Sunday ... 6 = Saturday. */
  weeklyOff: integer().array().notNull().default([0, 6]),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id, { onDelete: "restrict" }),
    shiftId: uuid().notNull().references(() => shifts.id),
    effectiveFrom: date({ mode: "string" }).notNull(),
    effectiveTo: date({ mode: "string" }),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("shift_assign_emp_idx").on(t.employeeId, t.effectiveFrom)],
);

export const holidayCalendars = pgTable("holiday_calendars", {
  id: id(),
  name: text().notNull().unique(),
  /** Used for employees without an explicit calendar. */
  isDefault: boolean().notNull().default(false),
  createdAt: createdAt(),
});

export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    calendarId: uuid().notNull().references(() => holidayCalendars.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    name: text().notNull(),
  },
  (t) => [uniqueIndex("holiday_cal_date_uq").on(t.calendarId, t.date)],
);

export const attendance = pgTable(
  "attendance",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id, { onDelete: "restrict" }),
    date: date({ mode: "string" }).notNull(),
    status: attendanceStatus().notNull(),
    checkIn: time(),
    checkOut: time(),
    note: text(),
    /** Set when the row was created by an approved leave rather than manual entry. */
    leaveRequestId: uuid(),
    version: version(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("attendance_emp_date_uq").on(t.employeeId, t.date), index("attendance_date_idx").on(t.date)],
);

export const leaveTypes = pgTable("leave_types", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  /** Days per year. */
  annualQuota: numeric({ precision: 6, scale: 2 }).notNull().default("0"),
  accrual: accrualMode().notNull().default("annual_upfront"),
  payMode: leavePayMode().notNull().default("paid"),
  /** For payMode = tiered: [{ upToDays: 15, payPercent: 100 }, { upToDays: 45, payPercent: 50 }, ...] cumulative per year. */
  payTiers: jsonb().$type<{ upToDays: number; payPercent: number }[]>(),
  allowHalfDay: boolean().notNull().default(true),
  carryForward: boolean().notNull().default(false), // optional per type
  carryForwardMax: numeric({ precision: 6, scale: 2 }).notNull().default("0"),
  minServiceMonths: integer().notNull().default(0),
  gender: text(), // null = any, 'female' | 'male'
  requiresApproval: boolean().notNull().default(true),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id, { onDelete: "restrict" }),
    leaveTypeId: uuid().notNull().references(() => leaveTypes.id),
    year: integer().notNull(),
    allocated: numeric({ precision: 6, scale: 2 }).notNull().default("0"),
    carriedForward: numeric({ precision: 6, scale: 2 }).notNull().default("0"),
    adjustment: numeric({ precision: 6, scale: 2 }).notNull().default("0"),
    used: numeric({ precision: 6, scale: 2 }).notNull().default("0"),
    version: version(),
  },
  (t) => [uniqueIndex("leave_bal_uq").on(t.employeeId, t.leaveTypeId, t.year)],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id, { onDelete: "restrict" }),
    leaveTypeId: uuid().notNull().references(() => leaveTypes.id),
    fromDate: date({ mode: "string" }).notNull(),
    toDate: date({ mode: "string" }).notNull(),
    /** Half-day requests are single-day: 'first' or 'second' half. */
    halfDay: text(),
    days: numeric({ precision: 6, scale: 2 }).notNull(),
    reason: text(),
    status: leaveStatus().notNull().default("pending"),
    requestedBy: uuid().references(() => users.id),
    decidedBy: uuid().references(() => users.id),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [index("leave_req_emp_idx").on(t.employeeId, t.fromDate), index("leave_req_status_idx").on(t.status)],
);
