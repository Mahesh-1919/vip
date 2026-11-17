import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { getRun } from "@/services/hr/payroll";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addAdjustmentAction, finalizeAction, paidAction, recalcAction, reopenAction, removeAdjustmentAction } from "../actions";
import { RunControls } from "../run-controls";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";

export const metadata: Metadata = { title: "Payroll run" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function RunPage({ params }: PageProps<"/hr/payroll/[runId]">) {
  const user = await requirePermission("hr:payroll:read");
  const id = z.uuid().safeParse((await params).runId);
  if (!id.success) notFound();
  const data = await getRun(id.data);
  if (!data) notFound();
  const { run, items, adjustments } = data;
  const draft = run.status === "draft";
  const can = (p: never) => user.permissions.has(p);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/hr/payroll" className="text-sm text-primary hover:underline">← Payroll</Link>
        <h1 className="mt-1 text-2xl font-semibold">{MONTHS[run.month - 1]} {run.year} <span className="text-base font-normal text-muted-foreground capitalize">· {run.status}</span></h1>
        {!draft && <p className="text-sm text-muted-foreground">Finalised {formatDate(run.finalizedAt)}{run.paidAt ? ` · paid ${formatDate(run.paidAt)}` : ""}. This payroll is locked.</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[["Gross", run.totalGross], ["Deductions", run.totalDeductions], ["Net pay", run.totalNet]].map(([k, v]) => <StatCard key={k} label={k} value={formatAED(v)} />)}
      </div>
      <RunControls status={run.status} runId={run.id} today={todayISO()} canWrite={can("hr:payroll:write" as never)} canFinalize={can("hr:payroll:finalize" as never)}
        canExport={can("hr:payroll:export" as never)} isAdmin={user.role.key === "admin"}
        recalc={recalcAction.bind(null, run.id)} finalize={finalizeAction.bind(null, run.id)} paid={paidAction.bind(null, run.id)} reopen={reopenAction.bind(null, run.id)} />

      <Card className="gap-0 overflow-hidden py-0"><CardContent className="px-0">
        <Table className="w-full text-sm">
          <TableHeader className="text-left text-muted-foreground border-b border-border"><TableRow><TableHead className="p-3">Employee</TableHead><TableHead className="p-3 text-right">Paid days</TableHead><TableHead className="p-3 text-right">Gross</TableHead><TableHead className="p-3 text-right">Deductions</TableHead><TableHead className="p-3 text-right">Net</TableHead><TableHead className="p-3" /></TableRow></TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id} className="border-b border-border last:border-0 align-top">
                <TableCell className="p-3"><Link className="text-primary hover:underline" href={`/hr/payroll/${run.id}/${i.id}`}>{i.employeeName}</Link> <span className="font-mono text-xs text-muted-foreground">{i.empCode}</span>
                  {i.warnings.map((w) => <div key={w} className="text-xs text-amber-600">⚠ {w}</div>)}</TableCell>
                <TableCell className="p-3 text-right">{Number(i.paidDays)}/{i.basisDays}</TableCell>
                <TableCell className="p-3 text-right">{formatAED(i.gross)}</TableCell><TableCell className="p-3 text-right">{formatAED(i.totalDeductions)}</TableCell><TableCell className="p-3 text-right font-medium">{formatAED(i.net)}</TableCell>
                <TableCell className="p-3 text-right">{!draft && can("hr:payslip:read" as never) && <a className="text-primary hover:underline" href={`/api/hr/payslips/${i.id}`}>Payslip PDF</a>}</TableCell>
              </TableRow>
            ))}
            {!items.length && <TableRow><TableCell colSpan={6} className="p-6 text-center text-muted-foreground">No employees in this run. Check that employees have a salary structure.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      {draft && can("hr:payroll:write" as never) && (
        <Card>
          <CardHeader><CardTitle>One-off adjustments</CardTitle><CardDescription>Bonuses, overtime pay, advances or fines for this month only. They are included in the recalculation.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {adjustments.length > 0 && (
              <ul className="divide-y divide-border text-sm">
                {adjustments.map((a) => (
                  <li key={a.id} className="py-1.5 flex items-center justify-between">
                    <span>{items.find((i) => i.employeeId === a.employeeId)?.employeeName} · {a.label} · {a.type === "earning" ? "+" : "−"}{formatAED(a.amount)}</span>
                    <form action={removeAdjustmentAction}><input type="hidden" name="id" value={a.id} /><Button size="sm" variant="ghost" type="submit">Remove</Button></form>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={addAdjustmentAction.bind(null, run.id)} submit="Add adjustment" className="grid gap-3 sm:grid-cols-4 items-end">
              <div className="flex flex-col gap-1.5"><Label htmlFor="adjEmp">Employee</Label><NativeSelect id="adjEmp" name="employeeId" required>{items.map((i) => <NativeSelectOption key={i.employeeId} value={i.employeeId}>{i.empCode} · {i.employeeName}</NativeSelectOption>)}</NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="adjLabel">Label</Label><Input id="adjLabel" name="label" required placeholder="Overtime / Bonus" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="adjType">Type</Label><NativeSelect id="adjType" name="type"><NativeSelectOption value="earning">Earning</NativeSelectOption><NativeSelectOption value="deduction">Deduction</NativeSelectOption></NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="adjAmt">Amount (AED)</Label><Input id="adjAmt" name="amount" inputMode="decimal" required /></div>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
