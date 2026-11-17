import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { getMonthlySummary } from "@/services/hr/attendance";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AttendanceTabs, shiftMonth } from "../_components";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Attendance summary" };

export default async function SummaryPage({ searchParams }: PageProps<"/hr/attendance/summary">) {
  await requirePermission("hr:attendance:read");
  const sp = await searchParams;
  const raw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : todayISO().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const rows = await getMonthlySummary(y, m);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Attendance</h1>
      <AttendanceTabs active="summary" />
      <form className="flex items-end gap-2 text-sm">
        <Input type="month" name="month" defaultValue={month} className="w-44" /><Button variant="outline" type="submit">Show</Button>
        <Link className="text-primary underline pb-2" href={`?month=${shiftMonth(month, -1)}`}>← Prev</Link>
        <Link className="text-primary underline pb-2" href={`?month=${shiftMonth(month, 1)}`}>Next →</Link>
      </form>
      <Card className="gap-0 overflow-hidden py-0"><CardContent className="px-0">
        <Table className="w-full text-sm">
          <TableHeader className="text-left text-muted-foreground border-b border-border">
            <TableRow><TableHead className="p-3">Employee</TableHead><TableHead className="p-3 text-right">Working days</TableHead><TableHead className="p-3 text-right">Present</TableHead><TableHead className="p-3 text-right">Late</TableHead><TableHead className="p-3 text-right">Half day</TableHead><TableHead className="p-3 text-right">Absent</TableHead><TableHead className="p-3 text-right">On leave</TableHead><TableHead className="p-3 text-right">Unmarked</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="border-b border-border last:border-0">
                <TableCell className="p-3"><Link className="text-primary hover:underline" href={`/hr/attendance/calendar?employee=${r.id}&month=${month}`}>{r.name}</Link> <span className="font-mono text-xs text-muted-foreground">{r.empCode}</span></TableCell>
                <TableCell className="p-3 text-right">{r.workingDays}</TableCell><TableCell className="p-3 text-right">{r.present}</TableCell><TableCell className="p-3 text-right">{r.late}</TableCell>
                <TableCell className="p-3 text-right">{r.halfDay}</TableCell><TableCell className="p-3 text-right">{r.absent}</TableCell><TableCell className="p-3 text-right">{r.onLeave}</TableCell>
                <TableCell className={`p-3 text-right ${r.unmarked ? "text-amber-600 font-medium" : ""}`}>{r.unmarked}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">Unmarked = working days up to today with no attendance record. Payroll treats unmarked days per the payroll rules (configured in the next phase).</p>
    </div>
  );
}
