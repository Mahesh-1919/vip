import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { listRuns } from "@/services/hr/payroll";
import { ActionForm } from "@/components/action-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { generateAction } from "./actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Payroll" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function PayrollPage() {
  const user = await requirePermission("hr:payroll:read");
  const runs = await listRuns();
  const prev = new Date(); prev.setUTCDate(1); prev.setUTCMonth(prev.getUTCMonth() - 1);
  return (
    <div className="max-w-4xl flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payroll</h1>
        {user.permissions.has("hr:config:read") && <Link href="/hr/payroll/settings" className="text-sm text-primary hover:underline">Payroll rules & WPS settings</Link>}
      </div>
      {user.permissions.has("hr:payroll:write") && (
        <Card>
          <CardHeader><CardTitle>Generate payroll</CardTitle><CardDescription>Creates a draft for the month from salary structures, attendance and approved leave. Re-running a draft recalculates it.</CardDescription></CardHeader>
          <CardContent>
            <ActionForm action={generateAction} submit="Generate / recalculate draft" className="flex flex-wrap items-end gap-3" resetOnSuccess={false}>
              <div className="flex flex-col gap-1.5"><Label htmlFor="month">Month</Label><Input id="month" type="month" name="month" defaultValue={prev.toISOString().slice(0, 7)} max={todayISO().slice(0, 7)} required className="w-44" /></div>
            </ActionForm>
          </CardContent>
        </Card>
      )}
      <Card className="gap-0 overflow-hidden py-0"><CardContent className="px-0">
        <Table className="w-full text-sm">
          <TableHeader className="text-left text-muted-foreground border-b border-border"><TableRow><TableHead className="p-3">Period</TableHead><TableHead className="p-3">Status</TableHead><TableHead className="p-3 text-right">Gross</TableHead><TableHead className="p-3 text-right">Deductions</TableHead><TableHead className="p-3 text-right">Net</TableHead></TableRow></TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                <TableCell className="p-3"><Link className="text-primary hover:underline" href={`/hr/payroll/${r.id}`}>{MONTHS[r.month - 1]} {r.year}</Link></TableCell>
                <TableCell className="p-3"><StatusBadge status={r.status} /></TableCell>
                <TableCell className="p-3 text-right">{formatAED(r.totalGross)}</TableCell><TableCell className="p-3 text-right">{formatAED(r.totalDeductions)}</TableCell><TableCell className="p-3 text-right font-medium">{formatAED(r.totalNet)}</TableCell>
              </TableRow>
            ))}
            {!runs.length && <TableRow><TableCell colSpan={5} className="p-6 text-center text-muted-foreground">No payroll runs yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
