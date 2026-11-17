import type { Metadata } from "next";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatAED } from "@/lib/money";
import { employeeOptions } from "@/services/hr/employees";
import { listPayslips } from "@/services/hr/payroll";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Payslips" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function PayslipsPage({ searchParams }: PageProps<"/hr/payslips">) {
  await requirePermission("hr:payslip:read");
  const sp = await searchParams;
  const emps = await employeeOptions();
  const empId = z.uuid().safeParse(Array.isArray(sp.employee) ? sp.employee[0] : sp.employee).data ?? emps[0]?.id;
  const slips = empId ? await listPayslips(empId) : [];
  return (
    <div className="max-w-3xl flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Payslips</h1>
      <form className="flex gap-2 text-sm">
        <NativeSelect name="employee" defaultValue={empId} className="h-9 rounded-md border border-border bg-background px-3">{emps.map((e) => <NativeSelectOption key={e.id} value={e.id}>{e.empCode} · {e.name}</NativeSelectOption>)}</NativeSelect>
        <Button variant="outline" type="submit">Show</Button>
      </form>
      <Card className="gap-0 overflow-hidden py-0"><CardContent className="px-0">
        <ul className="divide-y divide-border text-sm">
          {slips.map(({ item, run }) => (
            <li key={item.id} className="p-3 flex items-center justify-between">
              <span>{MONTHS[run.month - 1]} {run.year} <span className="text-muted-foreground">· net {formatAED(item.net)} · {run.status}</span></span>
              <a className="text-primary hover:underline" href={`/api/hr/payslips/${item.id}`}>Download PDF</a>
            </li>
          ))}
          {!slips.length && <li className="p-6 text-center text-muted-foreground">No finalised payslips for this employee yet.</li>}
        </ul>
      </CardContent></Card>
    </div>
  );
}
