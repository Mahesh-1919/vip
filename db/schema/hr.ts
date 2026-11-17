import {
  pgTable, pgEnum, text, boolean, date, numeric, integer, uuid, jsonb, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, createdAt, updatedAt, version } from "./_columns";
import { users } from "./auth";

export const employeeStatus = pgEnum("employee_status", ["active", "on_leave", "notice_period", "inactive", "terminated"]);
export const componentType = pgEnum("salary_component_type", ["allowance", "deduction"]);
export const componentCalc = pgEnum("salary_component_calc", ["fixed", "percent_of_basic"]);

/** Gap-free document counters (employee codes, later invoice numbers). Increment under row lock. */
export const sequences = pgTable("sequences", {
  key: text().primaryKey(),
  next: integer().notNull().default(1),
});

export const departments = pgTable("departments", {
  id: id(),
  name: text().notNull().unique(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

/** Configurable library: Housing, Transport, Phone, Fine, Advance recovery... */
export const salaryComponents = pgTable("salary_components", {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  type: componentType().notNull(),
  calc: componentCalc().notNull().default("fixed"),
  /** Default amount (AED) or percent of basic, pre-filled on new structures. */
  defaultValue: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const employees = pgTable(
  "employees",
  {
    id: id(),
    empCode: text().notNull().unique(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    address: text(),
    nationality: text(),
    gender: text(),
    dateOfBirth: date({ mode: "string" }),
    joinDate: date({ mode: "string" }).notNull(),
    departmentId: uuid().references(() => departments.id),
    designation: text(),
    status: employeeStatus().notNull().default("active"),
    // UAE identity / compliance
    labourCardNo: text(),
    personCode: text(), // MOHRE person code, used in WPS SIF
    emiratesIdEnc: text(), // AES-256-GCM
    passportNoEnc: text(),
    emiratesIdExpiry: date({ mode: "string" }),
    passportExpiry: date({ mode: "string" }),
    visaExpiry: date({ mode: "string" }),
    labourCardExpiry: date({ mode: "string" }),
    // Bank (WPS)
    bankName: text(),
    ibanEnc: text(),
    routingCode: text(), // bank routing code for WPS
    /** Holiday calendar; null = the default calendar. */
    holidayCalendarId: uuid(),
    customFields: jsonb().$type<Record<string, string>>().notNull().default({}),
    /** Optional link to a login account. */
    userId: uuid().references(() => users.id),
    deactivatedAt: timestamp({ withTimezone: true }),
    deactivationReason: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("employees_dept_idx").on(t.departmentId),
    index("employees_status_idx").on(t.status),
    index("employees_name_idx").on(sql`lower(${t.name})`),
  ],
);

/** Salary history: the row with the latest effective_from <= date applies. Never edited, only superseded. */
export const employeeSalaries = pgTable(
  "employee_salaries",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id, { onDelete: "restrict" }),
    effectiveFrom: date({ mode: "string" }).notNull(),
    basic: numeric({ precision: 14, scale: 2 }).notNull(),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("emp_salary_eff_uq").on(t.employeeId, t.effectiveFrom)],
);

export const employeeSalaryLines = pgTable(
  "employee_salary_lines",
  {
    id: id(),
    salaryId: uuid().notNull().references(() => employeeSalaries.id, { onDelete: "cascade" }),
    componentId: uuid().notNull().references(() => salaryComponents.id),
    /** AED amount, or percent of basic when the component calc is percent_of_basic. */
    value: numeric({ precision: 14, scale: 2 }).notNull(),
  },
  (t) => [uniqueIndex("salary_line_uq").on(t.salaryId, t.componentId)],
);

export const employeeDocuments = pgTable(
  "employee_documents",
  {
    id: id(),
    employeeId: uuid().notNull().references(() => employees.id, { onDelete: "restrict" }),
    type: text().notNull(), // passport, emirates_id, visa, labour_contract, other
    fileName: text().notNull(),
    storageKey: text().notNull().unique(),
    mime: text().notNull(),
    size: integer().notNull(),
    expiryDate: date({ mode: "string" }),
    uploadedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("emp_docs_emp_idx").on(t.employeeId)],
);
