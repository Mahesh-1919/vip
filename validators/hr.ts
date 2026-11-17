import { z } from "zod";

const optText = (max = 200) =>
  z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();
const optDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.iso.date().nullable())
  .optional();
const money = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a valid amount");

export const EMPLOYEE_STATUSES = ["active", "on_leave", "notice_period", "inactive", "terminated"] as const;

export const employeeSchema = z.object({
  /** Optional: the register's employee ID. Blank = auto-generated (EMP-0001). */
  empCode: z.string().trim().max(20).regex(/^[A-Za-z0-9-]*$/, "Letters, digits and hyphen only").transform((v) => v || null).optional(),
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().trim().toLowerCase().max(254).transform((v) => v || null).pipe(z.email().nullable()).optional(),
  phone: optText(30),
  address: optText(300),
  nationality: optText(60),
  gender: z.enum(["male", "female", "other", ""]).transform((v) => v || null).optional(),
  dateOfBirth: optDate,
  joinDate: z.iso.date("Date of joining is required"),
  departmentId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()).optional(),
  designation: optText(100),
  status: z.enum(EMPLOYEE_STATUSES).default("active"),
  labourCardNo: optText(30),
  personCode: optText(30),
  emiratesId: z
    .string().trim().transform((v) => v.replace(/-/g, ""))
    .pipe(z.union([z.literal(""), z.string().regex(/^784\d{12}$/, "Emirates ID must be 15 digits starting with 784")]))
    .optional(),
  passportNo: z.string().trim().max(30).optional(),
  emiratesIdExpiry: optDate,
  passportIssueDate: optDate,
  passportExpiry: optDate,
  visaIssueDate: optDate,
  visaExpiry: optDate,
  labourCardExpiry: optDate,
  bankName: optText(80),
  iban: z
    .string().trim().toUpperCase().transform((v) => v.replace(/\s/g, ""))
    .pipe(z.union([z.literal(""), z.string().regex(/^AE\d{21}$/, "UAE IBAN is AE + 21 digits")]))
    .optional(),
  routingCode: optText(20),
  version: z.coerce.number().int().positive().optional(),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const salarySchema = z.object({
  employeeId: z.uuid(),
  effectiveFrom: z.iso.date(),
  basic: money,
  lines: z.array(z.object({ componentId: z.uuid(), value: money })),
});

export const departmentSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const componentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, "2-20 letters/digits/underscore"),
  name: z.string().trim().min(2).max(80),
  type: z.enum(["allowance", "deduction"]),
  calc: z.enum(["fixed", "percent_of_basic"]),
  defaultValue: money,
});

export const DOC_TYPES = ["passport", "emirates_id", "visa", "labour_contract", "offer_letter", "other"] as const;
export const documentMetaSchema = z.object({
  employeeId: z.uuid(),
  type: z.enum(DOC_TYPES),
  expiryDate: optDate,
});
