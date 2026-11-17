import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { employees, holidayCalendars, holidays } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import { employeeOptions } from "@/services/hr/employees";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addHoliday, assignCalendar, createCalendar, removeHoliday } from "./actions";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Holiday calendars" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

export default async function HolidaysPage() {
  const user = await requirePermission("hr:config:read");
  const canWrite = user.permissions.has("hr:config:write");
  const [cals, hols, emps, assigned] = await Promise.all([
    db.select().from(holidayCalendars).orderBy(asc(holidayCalendars.name)),
    db.select().from(holidays).orderBy(asc(holidays.date)),
    employeeOptions(),
    db.select({ id: employees.id, cal: employees.holidayCalendarId }).from(employees),
  ]);
  const calName = new Map(cals.map((c) => [c.id, c.name]));
  const def = cals.find((c) => c.isDefault);
  return (
    <div className="max-w-4xl flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Holiday calendars</h1>
      <p className="text-sm text-muted-foreground">Create separate calendars for different groups (e.g. office vs. warehouse) and assign each employee one. Employees without an assignment use the default calendar{def ? ` (${def.name})` : ""}. Islamic holidays depend on moon sighting: add them once officially announced.</p>
      {cals.map((c) => (
        <Card key={c.id}>
          <CardHeader><CardTitle>{c.name}{c.isDefault && <span className="ml-2 text-xs font-normal text-muted-foreground">default</span>}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {hols.filter((h) => h.calendarId === c.id).map((h) => (
                <li key={h.id} className="py-1.5 flex items-center justify-between"><span>{formatDate(h.date)} · {h.name}</span>
                  {canWrite && <form action={removeHoliday}><input type="hidden" name="id" value={h.id} /><Button size="sm" variant="ghost" type="submit">Remove</Button></form>}</li>
              ))}
              {!hols.some((h) => h.calendarId === c.id) && <li className="py-1.5 text-muted-foreground">No holidays yet.</li>}
            </ul>
          </CardContent>
        </Card>
      ))}
      {canWrite && (
        <>
          <Card><CardHeader><CardTitle>Add holiday</CardTitle></CardHeader><CardContent>
            <ActionForm action={addHoliday} submit="Add" className="grid gap-3 sm:grid-cols-3 items-end">
              <div className="flex flex-col gap-1.5"><Label htmlFor="hc">Calendar</Label><NativeSelect id="hc" name="calendarId">{cals.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="hd">Date</Label><Input id="hd" name="date" type="date" defaultValue={todayISO()} required /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="hn">Name</Label><Input id="hn" name="name" required placeholder="Eid Al Fitr" /></div>
            </ActionForm></CardContent></Card>
          <Card><CardHeader><CardTitle>New calendar</CardTitle></CardHeader><CardContent>
            <ActionForm action={createCalendar} submit="Create" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5"><Label htmlFor="cn">Name</Label><Input id="cn" name="name" required /></div></ActionForm></CardContent></Card>
          <Card><CardHeader><CardTitle>Assign calendar to employee</CardTitle><CardDescription>{assigned.filter((a) => a.cal).length} employee(s) have an explicit calendar.</CardDescription></CardHeader><CardContent>
            <ActionForm action={assignCalendar} submit="Assign" className="grid gap-3 sm:grid-cols-2 items-end">
              <div className="flex flex-col gap-1.5"><Label htmlFor="ae">Employee</Label><NativeSelect id="ae" name="employeeId">{emps.map((e) => <NativeSelectOption key={e.id} value={e.id}>{e.empCode} · {e.name} ({calName.get(assigned.find((a) => a.id === e.id)?.cal ?? "") ?? "default"})</NativeSelectOption>)}</NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="ac">Calendar</Label><NativeSelect id="ac" name="calendarId"><NativeSelectOption value="">Default calendar</NativeSelectOption>{cals.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect></div>
            </ActionForm></CardContent></Card>
        </>
      )}
    </div>
  );
}
