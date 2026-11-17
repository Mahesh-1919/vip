import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { saveEmployee } from "../actions";
import { EmployeeForm } from "../employee-form";

export const metadata: Metadata = { title: "New employee" };

export default async function NewEmployeePage() {
  const user = await requirePermission("hr:employee:write");
  const depts = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name));
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">New employee</h1>
      <EmployeeForm action={saveEmployee.bind(null, null)} departments={depts} canSensitive={user.permissions.has("hr:employee:sensitive")} />
    </div>
  );
}
