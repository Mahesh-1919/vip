import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/db";
import { employeeSalaries, employees, salaryComponents, users } from "@/db/schema";
import * as svc from "@/services/hr/employees";
import { decryptField } from "@/lib/crypto";
import { employeeSchema } from "@/validators/hr";

// Integration test: needs the local Postgres (docker compose up -d) with migrations applied + seed.
const meta = { ip: null, userAgent: null };
let user: never;
let empId: string;
const base = { name: "Vitest Person", joinDate: "2025-01-01", emiratesId: "784-1990-1234567-1", iban: "ae07 0331 2345 6789 0123 456" };

beforeAll(async () => {
  const [u] = await db.select().from(users).limit(1);
  user = { id: u.id, email: u.email } as never;
});
afterAll(async () => {
  if (empId) {
    await db.delete(employeeSalaries).where(eq(employeeSalaries.employeeId, empId));
    await db.delete(employees).where(eq(employees.id, empId));
  }
  await sql.end();
});

describe("employee service", () => {
  it("validates UAE identifiers", () => {
    expect(employeeSchema.safeParse({ ...base, iban: "GB123" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...base, emiratesId: "123" }).success).toBe(false);
    expect(employeeSchema.safeParse(base).success).toBe(true);
  });

  it("creates with sequential code and encrypted sensitive fields", async () => {
    const e = await svc.createEmployee(employeeSchema.parse(base), user, meta);
    empId = e.id;
    expect(e.empCode).toMatch(/^EMP-\d{4}$/);
    expect(e.ibanEnc).not.toContain("AE07");
    expect(decryptField(e.ibanEnc!)).toBe("AE070331234567890123456");
    expect(decryptField(e.emiratesIdEnc!)).toBe("784199012345671");
  });

  it("masks sensitive fields without permission", async () => {
    const masked = await svc.getEmployee(empId, { sensitive: false });
    expect(masked?.iban).toBe("•••• 3456");
    expect((await svc.getEmployee(empId, { sensitive: true }))?.iban).toBe("AE070331234567890123456");
  });

  it("rejects stale updates (optimistic lock)", async () => {
    const upd = employeeSchema.parse({ ...base, name: "Renamed", version: 1 });
    await svc.updateEmployee(empId, upd, user, meta);
    await expect(svc.updateEmployee(empId, upd, user, meta)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps existing encrypted values when the form fields are blank", async () => {
    const upd = employeeSchema.parse({ name: "Renamed", joinDate: "2025-01-01", emiratesId: "", iban: "", version: 2 });
    await svc.updateEmployee(empId, upd, user, meta);
    expect((await svc.getEmployee(empId, { sensitive: true }))?.iban).toBe("AE070331234567890123456");
  });

  it("enforces salary rules", async () => {
    const [fine] = await db.select().from(salaryComponents).where(eq(salaryComponents.code, "FINE"));
    await svc.setSalaryStructure({ employeeId: empId, effectiveFrom: "2025-01-01", basic: "1000", lines: [] }, user, meta);
    await expect(svc.setSalaryStructure({ employeeId: empId, effectiveFrom: "2025-01-01", basic: "1000", lines: [] }, user, meta)).rejects.toMatchObject({ status: 409 });
    await expect(
      svc.setSalaryStructure({ employeeId: empId, effectiveFrom: "2025-06-01", basic: "1000", lines: [{ componentId: fine.id, value: "5000" }] }, user, meta),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("generates gap-free sequential codes under concurrency", async () => {
    const made = await Promise.all([1, 2, 3, 4, 5].map(() => svc.createEmployee(employeeSchema.parse({ name: "Concurrent", joinDate: "2025-01-01" }), user, meta)));
    const nums = made.map((m) => Number(m.empCode.slice(4))).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(5);
    expect(nums[4] - nums[0]).toBe(4);
    await db.delete(employees).where(eq(employees.name, "Concurrent"));
  });
});
