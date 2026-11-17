import { pgTable, pgEnum, text, boolean, integer, numeric, uuid, jsonb, timestamp, date, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, version } from "./_columns";
import { users } from "./auth";
import { employees } from "./hr";

export const payrollStatus = pgEnum("payroll_status", ["draft", "finalized", "paid"]);

/** Single-row table (id is always 1). */
export const payrollSettings = pgTable("payroll_settings", {
  id: integer().primaryKey().default(1),
  /** How the daily rate is derived: '30' (UAE convention), 'calendar' (days in month) or 'working' days. */
  dayBasis: text().$type<"30" | "calendar" | "working">().notNull().default("30"),
  /** 'none' or 'every_n_half_day' (every N lates = half-day deduction). */
  lateMode: text().$type<"none" | "every_n_half_day">().notNull().default("none"),
  lateEveryN: integer().notNull().default(3),
  /** Block finalising while working days have no attendance record. */
  blockOnUnmarked: boolean().notNull().default(true),
  /** WPS (MOHRE): 14-digit establishment/employer ID and the employer's bank routing code. */
  employerId: text(),
  employerBankRouting: text(),
  updatedAt: updatedAt(),
});

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: id(),
    year: integer().notNull(),
    month: integer().notNull(),
    status: payrollStatus().notNull().default("draft"),
    /** Rules in force when generated/finalised, kept for audit. */
    rulesSnapshot: jsonb().notNull(),
    totalGross: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    totalDeductions: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    totalNet: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    finalizedBy: uuid().references(() => users.id),
    finalizedAt: timestamp({ withTimezone: true }),
    paidAt: date({ mode: "string" }),
    version: version(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payroll_run_period_uq").on(t.year, t.month)],
);

export type PayLine = { name: string; amount: string; note?: string };

export const payrollItems = pgTable(
  "payroll_items",
  {
    id: id(),
    runId: uuid().notNull().references(() => payrollRuns.id, { onDelete: "restrict" }),
    employeeId: uuid().notNull().references(() => employees.id, { onDelete: "restrict" }),
    // Snapshot so payslips never change if the employee record does.
    empCode: text().notNull(),
    employeeName: text().notNull(),
    designation: text(),
    department: text(),
    basic: numeric({ precision: 14, scale: 2 }).notNull(),
    earnings: jsonb().$type<PayLine[]>().notNull(),
    deductions: jsonb().$type<PayLine[]>().notNull(),
    basisDays: integer().notNull(),
    lopDays: numeric({ precision: 6, scale: 2 }).notNull().default("0"),
    paidDays: numeric({ precision: 6, scale: 2 }).notNull(),
    gross: numeric({ precision: 14, scale: 2 }).notNull(),
    totalDeductions: numeric({ precision: 14, scale: 2 }).notNull(),
    net: numeric({ precision: 14, scale: 2 }).notNull(),
    warnings: jsonb().$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payroll_item_uq").on(t.runId, t.employeeId), index("payroll_item_emp_idx").on(t.employeeId)],
);

/** One-off bonuses / deductions for a run (kept across recalculations while the run is a draft). */
export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: id(),
    runId: uuid().notNull().references(() => payrollRuns.id, { onDelete: "restrict" }),
    employeeId: uuid().notNull().references(() => employees.id, { onDelete: "restrict" }),
    label: text().notNull(),
    type: text().$type<"earning" | "deduction">().notNull(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("payroll_adj_run_idx").on(t.runId, t.employeeId)],
);
