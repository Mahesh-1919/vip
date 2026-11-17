import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { departments, salaryComponents } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addComponent, addDepartment, toggleActive } from "./actions";
import { ComponentForm, DepartmentForm } from "./forms";

export const metadata: Metadata = { title: "HR settings" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

function Toggle({ kind, id, active }: { kind: string; id: string; active: boolean }) {
  return (
    <form action={toggleActive}>
      <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="active" value={String(!active)} />
      <Button size="sm" variant="outline" type="submit">{active ? "Disable" : "Enable"}</Button>
    </form>
  );
}

export default async function HrConfigPage() {
  const user = await requirePermission("hr:config:read");
  const canWrite = user.permissions.has("hr:config:write");
  const [depts, comps] = await Promise.all([
    db.select().from(departments).orderBy(asc(departments.name)),
    db.select().from(salaryComponents).orderBy(asc(salaryComponents.type), asc(salaryComponents.name)),
  ]);
  return (
    <div className="max-w-3xl flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">HR settings</h1>
      <Card>
        <CardHeader><CardTitle>Departments</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y divide-border text-sm">
            {depts.map((d) => <li key={d.id} className="py-2 flex items-center justify-between"><span className={d.isActive ? "" : "line-through text-muted-foreground"}>{d.name}</span>{canWrite && <Toggle kind="department" id={d.id} active={d.isActive} />}</li>)}
          </ul>
          {canWrite && <DepartmentForm action={addDepartment} />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Salary components</CardTitle><CardDescription>The allowance and deduction library used in employee salary structures and payroll.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y divide-border text-sm">
            {comps.map((c) => (
              <li key={c.id} className="py-2 flex items-center justify-between">
                <span className={c.isActive ? "" : "line-through text-muted-foreground"}>{c.name} <span className="text-muted-foreground">· {c.code} · {c.type} · {c.calc === "percent_of_basic" ? `${c.defaultValue}% of basic` : `AED ${c.defaultValue}`}</span></span>
                {canWrite && <Toggle kind="component" id={c.id} active={c.isActive} />}
              </li>
            ))}
          </ul>
          {canWrite && <ComponentForm action={addComponent} />}
        </CardContent>
      </Card>
    </div>
  );
}
