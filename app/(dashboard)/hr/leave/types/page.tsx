import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { leaveTypes } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLeaveType, rolloverAction, toggleLeaveType, updateCarryForward } from "../actions";
import { LeaveTabs } from "../_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";

export const metadata: Metadata = { title: "Leave types" };

export default async function LeaveTypesPage() {
  const user = await requirePermission("hr:config:read");
  const canWrite = user.permissions.has("hr:config:write");
  const types = await db.select().from(leaveTypes).orderBy(asc(leaveTypes.name));
  return (
    <div className="max-w-4xl flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Leave</h1>
      <LeaveTabs active="types" canConfig />
      <Card>
        <CardHeader><CardTitle>Leave policies</CardTitle><CardDescription>Seeded with UAE labour-law defaults; adjust to your company policy. Carry-forward is optional per type.</CardDescription></CardHeader>
        <CardContent className="divide-y divide-border text-sm">
          {types.map((t) => (
            <div key={t.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className={t.isActive ? "" : "line-through text-muted-foreground"}>
                <b>{t.name}</b> <span className="text-muted-foreground">· {t.code} · {Number(t.annualQuota)} days/yr · {t.accrual === "monthly" ? "monthly accrual" : "upfront"} · {t.payMode}{t.minServiceMonths ? ` · after ${t.minServiceMonths}m service` : ""}{t.gender ? ` · ${t.gender} only` : ""}{t.allowHalfDay ? "" : " · no half-days"}</span>
                {t.payTiers && <div className="text-xs text-muted-foreground">Pay tiers: {t.payTiers.map((x) => `≤${x.upToDays}d @ ${x.payPercent}%`).join(", ")}</div>}
              </div>
              {canWrite && (
                <div className="flex flex-wrap items-center gap-3">
                  <form action={updateCarryForward} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <Label className="flex items-center gap-1.5"><Checkbox name="carryForward" defaultChecked={t.carryForward} /> Carry forward, max</Label>
                    <Input name="max" type="number" step="0.5" min={0} defaultValue={Number(t.carryForwardMax)} className="h-8 w-20" />
                    <Button size="sm" variant="outline" type="submit">Save</Button>
                  </form>
                  <form action={toggleLeaveType}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={String(!t.isActive)} /><Button size="sm" variant="ghost" type="submit">{t.isActive ? "Disable" : "Enable"}</Button></form>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      {canWrite && (
        <>
          <Card><CardHeader><CardTitle>Add leave type</CardTitle></CardHeader><CardContent>
            <ActionForm action={createLeaveType} submit="Create" className="grid gap-3 sm:grid-cols-3 items-end">
              <div className="flex flex-col gap-1.5"><Label htmlFor="code">Code</Label><Input id="code" name="code" required placeholder="STUDY" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="name">Name</Label><Input id="name" name="name" required /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="q">Days per year</Label><Input id="q" name="annualQuota" inputMode="decimal" defaultValue="0" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="ac">Accrual</Label><NativeSelect id="ac" name="accrual"><NativeSelectOption value="annual_upfront">Full quota upfront</NativeSelectOption><NativeSelectOption value="monthly">Monthly accrual</NativeSelectOption></NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="pm">Pay</Label><NativeSelect id="pm" name="payMode"><NativeSelectOption value="paid">Paid</NativeSelectOption><NativeSelectOption value="unpaid">Unpaid</NativeSelectOption><NativeSelectOption value="tiered">Tiered (set tiers in DB for now)</NativeSelectOption></NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="ms">Min. service (months)</Label><Input id="ms" name="minServiceMonths" type="number" min={0} defaultValue={0} /></div>
              <Label className="flex items-center gap-2 text-sm"><Checkbox name="allowHalfDay" defaultChecked /> Allow half-days</Label>
              <Label className="flex items-center gap-2 text-sm"><Checkbox name="carryForward" /> Allow carry-forward</Label>
              <div className="flex flex-col gap-1.5"><Label htmlFor="cm">Carry-forward cap (days)</Label><Input id="cm" name="carryForwardMax" type="number" min={0} step="0.5" defaultValue={0} /></div>
            </ActionForm></CardContent></Card>
          <Card><CardHeader><CardTitle>Year-end carry-forward</CardTitle><CardDescription>Moves unused days (up to each type’s cap) into the next year, for types with carry-forward enabled. Safe to re-run.</CardDescription></CardHeader><CardContent>
            <ActionForm action={rolloverAction} submit="Run rollover" className="flex flex-wrap items-end gap-3" resetOnSuccess={false}>
              <div className="flex flex-col gap-1.5"><Label htmlFor="y">From year</Label><Input id="y" name="year" type="number" defaultValue={new Date().getUTCFullYear() - 1} className="w-28" /></div>
            </ActionForm></CardContent></Card>
        </>
      )}
    </div>
  );
}
