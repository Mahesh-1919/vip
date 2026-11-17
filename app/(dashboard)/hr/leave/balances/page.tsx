import type { Metadata } from "next";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { employeeOptions } from "@/services/hr/employees";
import { getBalances } from "@/services/hr/leave";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LeaveTabs } from "../_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Leave balances" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

export default async function BalancesPage({ searchParams }: PageProps<"/hr/leave/balances">) {
  const user = await requirePermission("hr:leave:read");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const emps = await employeeOptions();
  const empId = z.uuid().safeParse(one(sp.employee)).data ?? emps[0]?.id;
  const year = Number(one(sp.year)) || new Date().getUTCFullYear();
  const rows = empId ? await getBalances(empId, year) : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Leave</h1>
      <LeaveTabs active="balances" canConfig={user.permissions.has("hr:config:read")} />
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <NativeSelect name="employee" defaultValue={empId} className="h-9 rounded-md border border-border bg-background px-3">{emps.map((e) => <NativeSelectOption key={e.id} value={e.id}>{e.empCode} · {e.name}</NativeSelectOption>)}</NativeSelect>
        <Input name="year" type="number" min={2000} max={2100} defaultValue={year} className="w-28" /><Button variant="outline" type="submit">Show</Button>
      </form>
      <Card className="gap-0 overflow-hidden py-0"><CardContent className="px-0">
        <Table className="w-full text-sm">
          <TableHeader className="text-left text-muted-foreground border-b border-border"><TableRow><TableHead className="p-3">Leave type</TableHead><TableHead className="p-3 text-right">Yearly quota</TableHead><TableHead className="p-3 text-right">Carried fwd</TableHead><TableHead className="p-3 text-right">Accrued to date</TableHead><TableHead className="p-3 text-right">Used</TableHead><TableHead className="p-3 text-right">Pending</TableHead><TableHead className="p-3 text-right">Available</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(({ type, balance, entitled, used, pending, available }) => (
              <TableRow key={type.id} className="border-b border-border last:border-0">
                <TableCell className="p-3">{type.name}<div className="text-xs text-muted-foreground">{type.payMode}{type.accrual === "monthly" ? " · monthly accrual" : ""}{type.carryForward ? ` · carry-fwd ≤ ${Number(type.carryForwardMax)}` : ""}</div></TableCell>
                <TableCell className="p-3 text-right">{Number(balance.allocated)}</TableCell><TableCell className="p-3 text-right">{Number(balance.carriedForward)}</TableCell>
                <TableCell className="p-3 text-right">{entitled.toFixed(2)}</TableCell><TableCell className="p-3 text-right">{used.toFixed(2)}</TableCell><TableCell className="p-3 text-right">{pending.toFixed(2)}</TableCell>
                <TableCell className={`p-3 text-right font-medium ${available.lt(0) ? "text-destructive" : ""}`}>{type.payMode === "unpaid" && Number(type.annualQuota) === 0 ? "—" : available.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
