import "server-only";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  departments, employeeDocuments, employeeSalaries, employeeSalaryLines, employees, salaryComponents,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { decryptField, encryptField } from "@/lib/crypto";
import { nextNumber } from "@/lib/numbering";
import { D, toDb } from "@/lib/money";
import type { CurrentUser } from "@/lib/auth";
import type { EmployeeInput } from "@/validators/hr";

type Meta = { ip: string | null; userAgent: string | null };
const actorFields = (u: CurrentUser, m: Meta) => ({ userId: u.id, userEmail: u.email, ...m });

export const PAGE_SIZE = 20;
const SORTS = { name: employees.name, code: employees.empCode, joined: employees.joinDate, status: employees.status } as const;
export type SortKey = keyof typeof SORTS;

export async function listEmployees(p: { q?: string; dept?: string; status?: string; sort?: string; dir?: string; page?: number }) {
  const where: SQL[] = [];
  if (p.q) {
    const like = `%${p.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(employees.name, like), ilike(employees.empCode, like), ilike(employees.email, like))!);
  }
  if (p.dept) where.push(eq(employees.departmentId, p.dept));
  if (p.status) where.push(eq(employees.status, p.status as never));
  const col = SORTS[(p.sort as SortKey) in SORTS ? (p.sort as SortKey) : "code"];
  const order = p.dir === "desc" ? desc(col) : asc(col);
  const page = Math.max(1, p.page ?? 1);
  const w = where.length ? and(...where) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: employees.id, empCode: employees.empCode, name: employees.name, designation: employees.designation,
      status: employees.status, joinDate: employees.joinDate, department: departments.name,
      visaExpiry: employees.visaExpiry, emiratesIdExpiry: employees.emiratesIdExpiry,
      passportExpiry: employees.passportExpiry, labourCardExpiry: employees.labourCardExpiry,
    })
      .from(employees).leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(w).orderBy(order, asc(employees.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(employees).where(w),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getEmployee(id: string, opts: { sensitive: boolean }) {
  const [e] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!e) return null;
  const { emiratesIdEnc, passportNoEnc, ibanEnc, ...rest } = e;
  const mask = (enc: string | null) => {
    if (!enc) return null;
    const plain = decryptField(enc);
    return opts.sensitive ? plain : "•••• " + plain.slice(-4);
  };
  return { ...rest, emiratesId: mask(emiratesIdEnc), passportNo: mask(passportNoEnc), iban: mask(ibanEnc) };
}

function toRow(input: EmployeeInput) {
  const { emiratesId, passportNo, iban, version: _v, ...rest } = input;
  void _v;
  return {
    ...rest,
    email: rest.email ?? null, phone: rest.phone ?? null, address: rest.address ?? null,
    nationality: rest.nationality ?? null, gender: rest.gender ?? null, dateOfBirth: rest.dateOfBirth ?? null,
    departmentId: rest.departmentId ?? null, designation: rest.designation ?? null,
    labourCardNo: rest.labourCardNo ?? null, personCode: rest.personCode ?? null,
    emiratesIdExpiry: rest.emiratesIdExpiry ?? null, passportExpiry: rest.passportExpiry ?? null,
    visaExpiry: rest.visaExpiry ?? null, labourCardExpiry: rest.labourCardExpiry ?? null,
    bankName: rest.bankName ?? null, routingCode: rest.routingCode ?? null,
    // Blank = leave unchanged (handled by the caller on update).
    _enc: {
      emiratesIdEnc: emiratesId ? encryptField(emiratesId) : undefined,
      passportNoEnc: passportNo ? encryptField(passportNo) : undefined,
      ibanEnc: iban ? encryptField(iban) : undefined,
    },
  };
}

export async function createEmployee(input: EmployeeInput, user: CurrentUser, meta: Meta) {
  const { _enc, ...row } = toRow(input);
  return db.transaction(async (tx) => {
    const empCode = await nextNumber(tx, "employee", "EMP-");
    const [e] = await tx.insert(employees).values({
      ...row, empCode,
      emiratesIdEnc: _enc.emiratesIdEnc ?? null, passportNoEnc: _enc.passportNoEnc ?? null, ibanEnc: _enc.ibanEnc ?? null,
    }).returning();
    await audit({ action: "create", entity: "employee", entityId: e.id, after: e, ...actorFields(user, meta) }, tx);
    return e;
  });
}

export async function updateEmployee(id: string, input: EmployeeInput, user: CurrentUser, meta: Meta) {
  if (!input.version) throw new AppError(400, "Missing version");
  const { _enc, ...row } = toRow(input);
  const set = {
    ...row,
    ...(_enc.emiratesIdEnc && { emiratesIdEnc: _enc.emiratesIdEnc }),
    ...(_enc.passportNoEnc && { passportNoEnc: _enc.passportNoEnc }),
    ...(_enc.ibanEnc && { ibanEnc: _enc.ibanEnc }),
    version: sql`${employees.version} + 1`,
  };
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(employees).where(eq(employees.id, id)).for("update");
    if (!before) throw new AppError(404, "Employee not found");
    const [after] = await tx.update(employees).set(set).where(and(eq(employees.id, id), eq(employees.version, input.version!))).returning();
    if (!after) throw new AppError(409, "This employee was changed by someone else. Reload and try again.");
    await audit({ action: "update", entity: "employee", entityId: id, before, after, ...actorFields(user, meta) }, tx);
  });
}

export async function deactivateEmployee(id: string, status: "inactive" | "terminated", reason: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(employees).where(eq(employees.id, id)).for("update");
    if (!before) throw new AppError(404, "Employee not found");
    const [after] = await tx.update(employees)
      .set({ status, deactivatedAt: new Date(), deactivationReason: reason, version: sql`${employees.version} + 1` })
      .where(eq(employees.id, id)).returning();
    await audit({ action: "deactivate", entity: "employee", entityId: id, before: { status: before.status }, after: { status, reason }, ...actorFields(user, meta) }, tx);
    void after;
  });
}

export async function reactivateEmployee(id: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    await tx.update(employees)
      .set({ status: "active", deactivatedAt: null, deactivationReason: null, version: sql`${employees.version} + 1` })
      .where(eq(employees.id, id));
    await audit({ action: "reactivate", entity: "employee", entityId: id, ...actorFields(user, meta) }, tx);
  });
}

// ---- Salary structure (append-only history) ----
export async function listSalaryHistory(employeeId: string) {
  const heads = await db.select().from(employeeSalaries).where(eq(employeeSalaries.employeeId, employeeId)).orderBy(desc(employeeSalaries.effectiveFrom));
  if (!heads.length) return [];
  const lines = await db
    .select({ salaryId: employeeSalaryLines.salaryId, value: employeeSalaryLines.value, name: salaryComponents.name, type: salaryComponents.type, calc: salaryComponents.calc })
    .from(employeeSalaryLines).innerJoin(salaryComponents, eq(salaryComponents.id, employeeSalaryLines.componentId));
  return heads.map((h) => ({ ...h, lines: lines.filter((l) => l.salaryId === h.id) }));
}

export async function setSalaryStructure(
  input: { employeeId: string; effectiveFrom: string; basic: string; lines: { componentId: string; value: string }[] },
  user: CurrentUser, meta: Meta,
) {
  await db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: employeeSalaries.id }).from(employeeSalaries)
      .where(and(eq(employeeSalaries.employeeId, input.employeeId), eq(employeeSalaries.effectiveFrom, input.effectiveFrom)));
    if (dup) throw new AppError(409, "A salary structure already exists for that effective date");
    const comps = await tx.select().from(salaryComponents).where(eq(salaryComponents.isActive, true));
    const byId = new Map(comps.map((c) => [c.id, c]));
    for (const l of input.lines) {
      const c = byId.get(l.componentId);
      if (!c) throw new AppError(422, "Unknown or inactive salary component");
      if (c.calc === "percent_of_basic" && D(l.value).gt(100)) throw new AppError(422, `${c.name}: percent cannot exceed 100`);
    }
    const deductions = input.lines.filter((l) => byId.get(l.componentId)!.type === "deduction")
      .reduce((s, l) => s.plus(byId.get(l.componentId)!.calc === "percent_of_basic" ? D(input.basic).times(l.value).div(100) : D(l.value)), D(0));
    const gross = input.lines.filter((l) => byId.get(l.componentId)!.type === "allowance")
      .reduce((s, l) => s.plus(byId.get(l.componentId)!.calc === "percent_of_basic" ? D(input.basic).times(l.value).div(100) : D(l.value)), D(input.basic));
    if (deductions.gt(gross)) throw new AppError(422, "Deductions exceed gross salary");

    const [head] = await tx.insert(employeeSalaries).values({
      employeeId: input.employeeId, effectiveFrom: input.effectiveFrom, basic: toDb(input.basic), createdBy: user.id,
    }).returning();
    if (input.lines.length)
      await tx.insert(employeeSalaryLines).values(input.lines.map((l) => ({ salaryId: head.id, componentId: l.componentId, value: toDb(l.value) })));
    await audit({ action: "set_salary", entity: "employee", entityId: input.employeeId, after: { effectiveFrom: input.effectiveFrom, basic: input.basic, lines: input.lines }, ...actorFields(user, meta) }, tx);
  });
}

// ---- Documents ----
export const listDocuments = (employeeId: string) =>
  db.select().from(employeeDocuments).where(eq(employeeDocuments.employeeId, employeeId)).orderBy(desc(employeeDocuments.createdAt));

export const employeeOptions = () =>
  db.select({ id: employees.id, empCode: employees.empCode, name: employees.name }).from(employees)
    .where(sql`${employees.status} not in ('inactive','terminated')`).orderBy(asc(employees.empCode));
