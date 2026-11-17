import type { Metadata } from "next";
import { asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employees, shiftAssignments, shifts } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import { employeeOptions } from "@/services/hr/employees";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { assignShift, createShift, toggleShift } from "./actions";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Shifts" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function ShiftsPage() {
  const user = await requirePermission("hr:config:read");
  const canWrite = user.permissions.has("hr:config:write");
  const [list, emps, current] = await Promise.all([
    db.select().from(shifts).orderBy(asc(shifts.name)),
    employeeOptions(),
    db.select({ name: employees.name, code: employees.empCode, shift: shifts.name, from: shiftAssignments.effectiveFrom })
      .from(shiftAssignments).innerJoin(employees, eq(employees.id, shiftAssignments.employeeId)).innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .where(isNull(shiftAssignments.effectiveTo)).orderBy(asc(employees.empCode)),
  ]);
  return (
    <div className="max-w-4xl flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Shifts</h1>
      <Card>
        <CardHeader><CardTitle>Shift definitions</CardTitle><CardDescription>Weekly offs belong to the shift, so different teams can have different working weeks.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-5">
          <ul className="divide-y divide-border text-sm">
            {list.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                <span className={s.isActive ? "" : "line-through text-muted-foreground"}>
                  <b>{s.name}</b> · {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}{s.isOvernight ? " (overnight)" : ""} · grace {s.graceMinutes}m · off: {s.weeklyOff.map((d) => DAYS[d]).join(", ") || "none"}
                </span>
                {canWrite && <form action={toggleShift}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={String(!s.isActive)} /><Button size="sm" variant="outline" type="submit">{s.isActive ? "Disable" : "Enable"}</Button></form>}
              </li>
            ))}
          </ul>
          {canWrite && (
            <ActionForm action={createShift} submit="Add shift" className="grid gap-3 sm:grid-cols-3 items-end">
              <div className="flex flex-col gap-1.5"><Label htmlFor="sname">Name</Label><Input id="sname" name="name" required /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="st">Start</Label><Input id="st" name="startTime" type="time" required defaultValue="09:00" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="et">End</Label><Input id="et" name="endTime" type="time" required defaultValue="18:00" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="gr">Grace (min)</Label><Input id="gr" name="graceMinutes" type="number" min={0} defaultValue={15} /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="br">Break (min)</Label><Input id="br" name="breakMinutes" type="number" min={0} defaultValue={60} /></div>
              <Label className="flex items-center gap-2 text-sm pb-2"><Checkbox name="overnight" /> Overnight shift</Label>
              <fieldset className="sm:col-span-3 flex flex-wrap gap-4 text-sm"><legend className="mb-1 font-medium">Weekly off</legend>
                {DAYS.map((d, i) => <Label key={d} className="flex items-center gap-1.5"><Checkbox name="off" value={i} defaultChecked={i === 0 || i === 6} /> {d}</Label>)}
              </fieldset>
            </ActionForm>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Assign shift to employee</CardTitle><CardDescription>The previous assignment ends the day before the new one starts. Employees without a shift use Sat–Sun off.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-5">
          {canWrite && (
            <ActionForm action={assignShift} submit="Assign" className="grid gap-3 sm:grid-cols-3 items-end">
              <div className="flex flex-col gap-1.5"><Label htmlFor="emp">Employee</Label><NativeSelect id="emp" name="employeeId" required>{emps.map((e) => <NativeSelectOption key={e.id} value={e.id}>{e.empCode} · {e.name}</NativeSelectOption>)}</NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="sh">Shift</Label><NativeSelect id="sh" name="shiftId" required>{list.filter((s) => s.isActive).map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>)}</NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="ef">Effective from</Label><Input id="ef" name="effectiveFrom" type="date" defaultValue={todayISO()} required /></div>
            </ActionForm>
          )}
          <Table className="w-full text-sm"><TableHeader className="text-left text-muted-foreground border-b border-border"><TableRow><TableHead className="py-2">Employee</TableHead><TableHead>Current shift</TableHead><TableHead>Since</TableHead></TableRow></TableHeader>
            <TableBody>{current.map((c) => <TableRow key={c.code} className="border-b border-border last:border-0"><TableCell className="py-2">{c.name} <span className="font-mono text-xs text-muted-foreground">{c.code}</span></TableCell><TableCell>{c.shift}</TableCell><TableCell>{formatDate(c.from)}</TableCell></TableRow>)}</TableBody></Table>
        </CardContent>
      </Card>
    </div>
  );
}
