import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { weekday } from "@/lib/hr-calendar";
import { employeeOptions } from "@/services/hr/employees";
import { getMonthCalendar } from "@/services/hr/attendance";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AttendanceTabs, shiftMonth } from "../_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Attendance calendar" };
const COLORS: Record<string, string> = {
  present: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300", late: "bg-amber-500/25 text-amber-700 dark:text-amber-300",
  half_day: "bg-sky-500/25 text-sky-700 dark:text-sky-300", absent: "bg-red-500/25 text-red-700 dark:text-red-300", on_leave: "bg-violet-500/25 text-violet-700 dark:text-violet-300",
};
const LABEL: Record<string, string> = { present: "P", late: "L", half_day: "½", absent: "A", on_leave: "LV" };

export default async function CalendarPage({ searchParams }: PageProps<"/hr/attendance/calendar">) {
  await requirePermission("hr:attendance:read");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const emps = await employeeOptions();
  const empId = z.uuid().safeParse(one(sp.employee)).data ?? emps[0]?.id;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(one(sp.month)) ? one(sp.month) : todayISO().slice(0, 7);
  if (!empId) return <p>No employees yet.</p>;
  const [y, m] = month.split("-").map(Number);
  const days = await getMonthCalendar(empId, y, m);
  const lead = (weekday(days[0].date) + 6) % 7; // Monday-first grid
  const qs = (mm: string) => `?employee=${empId}&month=${mm}`;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Attendance</h1>
      <AttendanceTabs active="calendar" />
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <NativeSelect name="employee" defaultValue={empId} className="h-9 rounded-md border border-border bg-background px-3">
          {emps.map((e) => <NativeSelectOption key={e.id} value={e.id}>{e.empCode} · {e.name}</NativeSelectOption>)}
        </NativeSelect>
        <Input type="month" name="month" defaultValue={month} className="w-44" />
        <Button variant="outline" type="submit">Show</Button>
        <Link className="text-primary underline pb-2" href={qs(shiftMonth(month, -1))}>← Prev</Link>
        <Link className="text-primary underline pb-2" href={qs(shiftMonth(month, 1))}>Next →</Link>
      </form>
      <Card className="gap-0 py-0"><CardContent className="p-4">
        <div className="grid grid-cols-7 gap-1 text-xs">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="text-center text-muted-foreground py-1">{d}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
          {days.map((d) => {
            const st = d.record?.status;
            const cls = st ? COLORS[st] : d.holiday ? "bg-amber-500/10" : d.weeklyOff ? "bg-muted text-muted-foreground" : "border border-dashed border-border";
            return (
              <div key={d.date} title={d.holiday ?? st ?? ""} className={`min-h-14 rounded p-1.5 ${cls}`}>
                <div>{Number(d.date.slice(8))}</div>
                <div className="font-medium">{st ? LABEL[st] : d.holiday ? "Hol" : ""}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">P present · L late · ½ half day · A absent · LV leave · Hol public holiday · grey = weekly off · dashed = not marked</p>
      </CardContent></Card>
    </div>
  );
}
