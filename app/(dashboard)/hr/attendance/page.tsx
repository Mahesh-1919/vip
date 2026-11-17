import type { Metadata } from "next";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import { getDailySheet } from "@/services/hr/attendance";
import { ActionForm } from "@/components/action-form";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveSheet } from "./actions";
import { AttendanceTabs } from "./_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Attendance" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

export default async function AttendancePage({ searchParams }: PageProps<"/hr/attendance">) {
  const user = await requirePermission("hr:attendance:read");
  const sp = await searchParams;
  const d = z.iso.date().safeParse(Array.isArray(sp.date) ? sp.date[0] : sp.date);
  const date = d.success && d.data <= todayISO() ? d.data : todayISO();
  const rows = await getDailySheet(date);
  const canWrite = user.permissions.has("hr:attendance:write");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Attendance</h1>
      <AttendanceTabs active="daily" />
      <form className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5 text-sm">Date<Input type="date" name="date" defaultValue={date} max={todayISO()} className="w-44" /></div>
        <Button variant="outline" type="submit">Go</Button>
        <span className="text-sm text-muted-foreground pb-2">{formatDate(date)}</span>
      </form>
      <ActionForm key={date} action={saveSheet.bind(null, date)} submit="Save attendance" resetOnSuccess={false} className="flex flex-col gap-4">
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="px-0">
            <Table className="w-full text-sm">
              <TableHeader className="text-left text-muted-foreground border-b border-border">
                <TableRow><TableHead className="p-3">Employee</TableHead><TableHead className="p-3">Day</TableHead><TableHead className="p-3">Shift</TableHead><TableHead className="p-3">Status</TableHead><TableHead className="p-3">In</TableHead><TableHead className="p-3">Out</TableHead><TableHead className="p-3">Note</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const leave = !!r.record?.leaveRequestId;
                  const def = r.record?.status ?? (r.dayType === "working" ? "present" : "");
                  return (
                    <TableRow key={r.id} className="border-b border-border last:border-0">
                      <TableCell className="p-3"><span className="font-mono text-xs text-muted-foreground">{r.empCode}</span> {r.name}</TableCell>
                      <TableCell className="p-3 text-xs">{r.dayType === "holiday" ? <span className="text-amber-600">Holiday · {r.holidayName}</span> : r.dayType === "weekly_off" ? <span className="text-muted-foreground">Weekly off</span> : "Working"}</TableCell>
                      <TableCell className="p-3 text-xs text-muted-foreground">{r.shift ? `${r.shift.startTime.slice(0, 5)}–${r.shift.endTime.slice(0, 5)}` : "—"}</TableCell>
                      {leave ? <TableCell className="p-3" colSpan={4}>{r.record!.status === "half_day" ? "Half-day leave" : "On leave"} <span className="text-muted-foreground">({r.record!.note})</span></TableCell> : (
                        <>
                          <TableCell className="p-3"><NativeSelect name={`s:${r.id}`} defaultValue={def} disabled={!canWrite}>
                            <NativeSelectOption value="">— not marked —</NativeSelectOption><NativeSelectOption value="present">Present</NativeSelectOption><NativeSelectOption value="late">Late</NativeSelectOption><NativeSelectOption value="half_day">Half day</NativeSelectOption><NativeSelectOption value="absent">Absent</NativeSelectOption></NativeSelect></TableCell>
                          <TableCell className="p-3"><Input type="time" name={`in:${r.id}`} defaultValue={r.record?.checkIn?.slice(0, 5) ?? ""} disabled={!canWrite} /></TableCell>
                          <TableCell className="p-3"><Input type="time" name={`out:${r.id}`} defaultValue={r.record?.checkOut?.slice(0, 5) ?? ""} disabled={!canWrite} /></TableCell>
                          <TableCell className="p-3"><Input name={`n:${r.id}`} defaultValue={r.record?.note ?? ""} maxLength={200} disabled={!canWrite} className="w-40" /></TableCell>
                        </>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {!canWrite && <p className="text-sm text-muted-foreground">Read-only access.</p>}
      </ActionForm>
      <p className="text-xs text-muted-foreground">A check-in after the shift start plus grace period is recorded as Late automatically. Leave-driven rows are managed from the leave request.</p>
    </div>
  );
}
