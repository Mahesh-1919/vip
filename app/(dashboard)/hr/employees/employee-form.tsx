"use client";

import { createContext, useActionState, useContext } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/form-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FormState } from "./actions";

type Emp = Record<string, string | number | null | undefined>;
const Ctx = createContext<{ e: Emp; err: Record<string, string> }>({ e: {}, err: {} });

/** Form field bound to the employee record + validation errors from the server action. */
function F({ name, label, type = "text", required, placeholder, hint }: { name: string; label: string; type?: string; required?: boolean; placeholder?: string; hint?: string }) {
  const { e, err } = useContext(Ctx);
  return <TextField name={name} label={label} type={type} required={required} placeholder={placeholder} hint={hint} error={err[name]} defaultValue={(e[name] as string | undefined) ?? ""} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent></Card>;
}

export function EmployeeForm({ action, employee, departments, canSensitive }: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  employee?: Emp;
  departments: { id: string; name: string }[];
  canSensitive: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const e: Emp = { ...(employee ?? {}), ...(state?.values ?? {}) };
  const err = state?.fieldErrors ?? {};


  return (
    <Ctx.Provider value={{ e, err }}>
    <form action={formAction} className="flex flex-col gap-5">
      {employee?.version && <input type="hidden" name="version" value={String(employee.version)} />}
      <Section title="Personal">
        <F name="name" label="Full name" required />
        <F name="email" label="Email" type="email" />
        <F name="phone" label="Phone" placeholder="+971 5x xxx xxxx" />
        <F name="nationality" label="Nationality" />
        <SelectField name="gender" label="Gender" defaultValue={(e.gender as string) ?? ""} options={[{ value: "", label: "—" }, { value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }]} />
        <F name="dateOfBirth" label="Date of birth" type="date" />
        <div className="sm:col-span-2"><F name="address" label="Address" /></div>
      </Section>
      <Section title="Employment">
        <F name="joinDate" label="Date of joining" type="date" required />
        <SelectField name="departmentId" label="Department" defaultValue={(e.departmentId as string) ?? ""} options={[{ value: "", label: "—" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
        <F name="designation" label="Designation" />
        <SelectField name="status" label="Status" defaultValue={(e.status as string) ?? "active"} options={[{ value: "active", label: "Active" }, { value: "on_leave", label: "On leave" }, { value: "notice_period", label: "Notice period" }, { value: "inactive", label: "Inactive" }, { value: "terminated", label: "Terminated" }]} />
      </Section>
      <Section title="UAE identity & compliance">
        <F name="labourCardNo" label="Labour card no." />
        <F name="labourCardExpiry" label="Labour card expiry" type="date" />
        <F name="personCode" label="MOHRE person code" hint="Used in the WPS SIF file" />
        <F name="visaExpiry" label="Residence visa expiry" type="date" />
        <F name="emiratesIdExpiry" label="Emirates ID expiry" type="date" />
        <F name="passportExpiry" label="Passport expiry" type="date" />
        {canSensitive ? (
          <>
            <F name="emiratesId" label="Emirates ID" placeholder={e.emiratesId ? String(e.emiratesId) : "784-XXXX-XXXXXXX-X"} hint={e.emiratesId ? "Leave blank to keep the current value" : undefined} />
            <F name="passportNo" label="Passport no." placeholder={e.passportNo ? String(e.passportNo) : ""} hint={e.passportNo ? "Leave blank to keep the current value" : undefined} />
          </>
        ) : (
          <p className="sm:col-span-2 text-xs text-muted-foreground">Emirates ID and passport numbers are visible to authorised roles only.</p>
        )}
      </Section>
      {canSensitive && (
        <Section title="Bank (WPS)">
          <F name="bankName" label="Bank name" />
          <F name="routingCode" label="Routing code" />
          <div className="sm:col-span-2">
            <F name="iban" label="IBAN" placeholder={e.iban ? String(e.iban) : "AE00 0000 0000 0000 0000 000"} hint={e.iban ? "Leave blank to keep the current value" : undefined} />
          </div>
        </Section>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : employee ? "Save changes" : "Create employee"}</Button>
        {state?.error && <span role="alert" className="text-sm text-destructive">{state.error}</span>}
      </div>
    </form>
    </Ctx.Provider>
  );
}
