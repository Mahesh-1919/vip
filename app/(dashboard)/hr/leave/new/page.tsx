import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leaveTypes } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { employeeOptions } from "@/services/hr/employees";
import { ActionForm } from "@/components/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyLeaveAction } from "../actions";
import { LeaveTabs } from "../_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Apply for leave" };

export default async function NewLeavePage() {
  const user = await requirePermission("hr:leave:write");
  const [emps, types] = await Promise.all([employeeOptions(), db.select().from(leaveTypes).where(eq(leaveTypes.isActive, true)).orderBy(asc(leaveTypes.name))]);
  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Leave</h1>
      <LeaveTabs active="new" canConfig={user.permissions.has("hr:config:read")} />
      <Card>
        <CardHeader><CardTitle>Apply for leave</CardTitle><CardDescription>Weekly offs and public holidays in the employee’s shift and calendar are not counted. Half-day applies to a single day.</CardDescription></CardHeader>
        <CardContent>
          <ActionForm action={applyLeaveAction} submit="Submit request" className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5"><Label htmlFor="employeeId">Employee</Label><NativeSelect id="employeeId" name="employeeId" required>{emps.map((e) => <NativeSelectOption key={e.id} value={e.id}>{e.empCode} · {e.name}</NativeSelectOption>)}</NativeSelect></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="leaveTypeId">Leave type</Label><NativeSelect id="leaveTypeId" name="leaveTypeId" required>{types.map((t) => <NativeSelectOption key={t.id} value={t.id}>{t.name}</NativeSelectOption>)}</NativeSelect></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="fromDate">From</Label><Input id="fromDate" name="fromDate" type="date" defaultValue={todayISO()} required /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="toDate">To</Label><Input id="toDate" name="toDate" type="date" defaultValue={todayISO()} required /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="halfDay">Half day</Label><NativeSelect id="halfDay" name="halfDay"><NativeSelectOption value="">Full day(s)</NativeSelectOption><NativeSelectOption value="first">First half</NativeSelectOption><NativeSelectOption value="second">Second half</NativeSelectOption></NativeSelect></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="reason">Reason</Label><Input id="reason" name="reason" maxLength={300} /></div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
