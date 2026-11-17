import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { departments, salaryComponents } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { daysUntil, formatDate, todayISO } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { getEmployee, listDocuments, listSalaryHistory } from "@/services/hr/employees";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deactivate, reactivate, saveEmployee, saveSalary } from "../actions";
import { EmployeeForm } from "../employee-form";
import { SalaryForm } from "./salary-form";
import { DocumentUpload } from "./document-upload";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params }: PageProps<"/hr/employees/[id]">) {
  const user = await requirePermission("hr:employee:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sensitive = user.permissions.has("hr:employee:sensitive");
  const canWrite = user.permissions.has("hr:employee:write");
  const emp = await getEmployee(id.data, { sensitive });
  if (!emp) notFound();

  const canSalary = user.permissions.has("hr:salary:read");
  const [depts, comps, history, docs] = await Promise.all([
    db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.name)),
    db.select().from(salaryComponents).where(eq(salaryComponents.isActive, true)).orderBy(asc(salaryComponents.type), asc(salaryComponents.name)),
    canSalary ? listSalaryHistory(id.data) : Promise.resolve([]),
    sensitive ? listDocuments(id.data) : Promise.resolve([]),
  ]);
  const active = emp.status !== "inactive" && emp.status !== "terminated";
  const days = (d?: string | null) => { const n = daysUntil(d); return n === null ? null : n < 0 ? "expired" : n <= 60 ? `in ${n}d` : null; };

  return (
    <div className="max-w-3xl flex flex-col gap-6">
      <div>
        <Link href="/hr/employees" className="text-sm text-primary hover:underline">← Employees</Link>
        <h1 className="mt-1 text-2xl font-semibold">{emp.name} <span className="text-base font-normal text-muted-foreground font-mono">{emp.empCode}</span></h1>
        <p className="text-sm text-muted-foreground capitalize">{emp.status.replace("_", " ")} · joined {formatDate(emp.joinDate)}
          {days(emp.visaExpiry) && ` · visa ${days(emp.visaExpiry)}`}{days(emp.emiratesIdExpiry) && ` · Emirates ID ${days(emp.emiratesIdExpiry)}`}
          {days(emp.passportExpiry) && ` · passport ${days(emp.passportExpiry)}`}{days(emp.labourCardExpiry) && ` · labour card ${days(emp.labourCardExpiry)}`}</p>
      </div>

      {canWrite ? (
        <EmployeeForm action={saveEmployee.bind(null, emp.id)} departments={depts} canSensitive={sensitive}
          employee={{ ...emp, departmentId: emp.departmentId, customFields: undefined } as never} />
      ) : (
        <Card className="gap-0 py-0"><CardContent className="p-5 text-sm">You have read-only access to this employee.</CardContent></Card>
      )}

      {canSalary && (
        <Card>
          <CardHeader><CardTitle>Salary structure</CardTitle><CardDescription>Basic, allowances and deductions. History is kept for payroll accuracy.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-5">
            {history.length ? history.map((h, i) => (
              <div key={h.id} className="rounded-md border border-border p-3 text-sm">
                <div className="font-medium">{i === 0 ? "Current · " : ""}effective {formatDate(h.effectiveFrom)}</div>
                <div>Basic: {formatAED(h.basic)}</div>
                {h.lines.map((l) => <div key={l.name} className="text-muted-foreground">{l.type === "deduction" ? "−" : "+"} {l.name}: {l.calc === "percent_of_basic" ? `${l.value}% of basic` : formatAED(l.value)}</div>)}
              </div>
            )) : <p className="text-sm text-muted-foreground">No salary structure yet.</p>}
            {user.permissions.has("hr:salary:write") && <SalaryForm action={saveSalary} employeeId={emp.id} components={comps} today={todayISO()} />}
          </CardContent>
        </Card>
      )}

      {sensitive && (
        <Card>
          <CardHeader><CardTitle>Documents</CardTitle><CardDescription>Stored privately; every download is audit-logged.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {docs.length ? (
              <ul className="text-sm divide-y divide-border">
                {docs.map((d) => (
                  <li key={d.id} className="py-2 flex justify-between gap-3">
                    <span><span className="capitalize">{d.type.replace("_", " ")}</span> — {d.fileName}{d.expiryDate && <span className="text-muted-foreground"> · expires {formatDate(d.expiryDate)}</span>}</span>
                    <a className="text-primary hover:underline" href={`/api/files/employee-documents/${d.id}`}>Download</a>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No documents uploaded.</p>}
            {canWrite && <DocumentUpload employeeId={emp.id} />}
          </CardContent>
        </Card>
      )}

      {canWrite && (
        <Card>
          <CardHeader><CardTitle>{active ? "Deactivate employee" : "Reactivate employee"}</CardTitle>
            <CardDescription>{active ? "Employees are never deleted; deactivating keeps all payroll and audit history." : `Deactivated ${formatDate(emp.deactivatedAt)}: ${emp.deactivationReason ?? ""}`}</CardDescription></CardHeader>
          <CardContent>
            {active ? (
              <ActionForm action={deactivate} submit="Deactivate" variant="destructive" confirm="The employee will be excluded from attendance and future payroll. History is kept and you can reactivate them later." className="grid gap-3 sm:grid-cols-3 items-end">
                <input type="hidden" name="id" value={emp.id} />
                <div className="flex flex-col gap-1.5"><Label htmlFor="st">New status</Label>
                  <NativeSelect id="st" name="status"><NativeSelectOption value="inactive">Inactive</NativeSelectOption><NativeSelectOption value="terminated">Terminated</NativeSelectOption></NativeSelect></div>
                <div className="flex flex-col gap-1.5 sm:col-span-2"><Label htmlFor="reason">Reason *</Label><Input id="reason" name="reason" required minLength={3} maxLength={300} /></div>
              </ActionForm>
            ) : (
              <form action={reactivate}><input type="hidden" name="id" value={emp.id} /><Button variant="outline" type="submit">Reactivate</Button></form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
