import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/services/hr/payroll";
import { ActionForm } from "@/components/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSettingsAction } from "../actions";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";

export const metadata: Metadata = { title: "Payroll settings" };

export default async function PayrollSettingsPage() {
  const user = await requirePermission("hr:config:read");
  const s = await getSettings();
  const canWrite = user.permissions.has("hr:config:write");
  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <Link href="/hr/payroll" className="text-sm text-primary hover:underline">← Payroll</Link>
      <h1 className="text-2xl font-semibold">Payroll rules & WPS settings</h1>
      <Card>
        <CardHeader><CardTitle>Rules</CardTitle><CardDescription>Applied the next time a draft is calculated. Finalised runs keep the rules they were finalised with.</CardDescription></CardHeader>
        <CardContent>
          <fieldset disabled={!canWrite}>
            <ActionForm action={saveSettingsAction} submit="Save settings" resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5"><Label htmlFor="dayBasis">Daily rate = monthly pay ÷</Label>
                <NativeSelect id="dayBasis" name="dayBasis" defaultValue={s.dayBasis}><NativeSelectOption value="30">30 days (UAE convention)</NativeSelectOption><NativeSelectOption value="calendar">Calendar days in the month</NativeSelectOption><NativeSelectOption value="working">Working days in the month</NativeSelectOption></NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="lateMode">Late arrivals</Label>
                <NativeSelect id="lateMode" name="lateMode" defaultValue={s.lateMode}><NativeSelectOption value="none">No deduction</NativeSelectOption><NativeSelectOption value="every_n_half_day">Every N lates = half-day</NativeSelectOption></NativeSelect></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="lateEveryN">N (lates per half-day)</Label><Input id="lateEveryN" name="lateEveryN" type="number" min={1} max={30} defaultValue={s.lateEveryN} /></div>
              <Label className="flex items-center gap-2 text-sm self-end pb-2"><Checkbox name="blockOnUnmarked" defaultChecked={s.blockOnUnmarked} /> Block finalising while attendance is unmarked</Label>
              <div className="flex flex-col gap-1.5"><Label htmlFor="employerId">MOHRE employer ID (WPS)</Label><Input id="employerId" name="employerId" defaultValue={s.employerId ?? ""} inputMode="numeric" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="employerBankRouting">Employer bank routing code</Label><Input id="employerBankRouting" name="employerBankRouting" defaultValue={s.employerBankRouting ?? ""} inputMode="numeric" /></div>
            </ActionForm>
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
