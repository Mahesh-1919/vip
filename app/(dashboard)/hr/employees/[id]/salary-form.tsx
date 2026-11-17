"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "../actions";

export type Component = { id: string; name: string; type: string; calc: string; defaultValue: string };

export function SalaryForm({ action, employeeId, components, today }: {
  action: (s: FormState, f: FormData) => Promise<FormState>; employeeId: string; components: Component[]; today: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="flex flex-col gap-1.5"><Label htmlFor="effectiveFrom">Effective from *</Label><Input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={today} required /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="basic">Basic salary (AED) *</Label><Input id="basic" name="basic" inputMode="decimal" required placeholder="0.00" /></div>
      {components.map((c) => (
        <div key={c.id} className="flex flex-col gap-1.5">
          <Label htmlFor={`line:${c.id}`}>{c.name} <span className="text-muted-foreground">({c.type}, {c.calc === "percent_of_basic" ? "% of basic" : "AED"})</span></Label>
          <Input id={`line:${c.id}`} name={`line:${c.id}`} inputMode="decimal" placeholder={Number(c.defaultValue) ? `default ${c.defaultValue}` : "0.00"} />
        </div>
      ))}
      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save new structure"}</Button>
        {state?.error && <span role="alert" className="text-sm text-destructive">{state.error}</span>}
        {state?.ok && <span className="text-sm text-primary">Saved.</span>}
      </div>
      <p className="sm:col-span-2 text-xs text-muted-foreground">Saving creates a new version effective from the chosen date; previous structures are kept as history. Leave a component blank to not apply it.</p>
    </form>
  );
}
