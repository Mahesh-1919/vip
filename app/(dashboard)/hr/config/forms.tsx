"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { State } from "./actions";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const Msg = ({ s }: { s: State }) => (
  <>{s?.error && <span role="alert" className="text-sm text-destructive">{s.error}</span>}{s?.ok && <span className="text-sm text-primary">Saved.</span>}</>
);

export function DepartmentForm({ action }: { action: (s: State, f: FormData) => Promise<State> }) {
  const [s, a, pending] = useActionState(action, undefined);
  return (
    <form action={a} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5"><Label htmlFor="dname">Department name</Label><Input id="dname" name="name" required minLength={2} maxLength={80} /></div>
      <Button type="submit" disabled={pending}>Add</Button><Msg s={s} />
    </form>
  );
}

export function ComponentForm({ action }: { action: (s: State, f: FormData) => Promise<State> }) {
  const [s, a, pending] = useActionState(action, undefined);
  return (
    <form action={a} className="grid gap-3 sm:grid-cols-3 items-end">
      <div className="flex flex-col gap-1.5"><Label htmlFor="code">Code</Label><Input id="code" name="code" required placeholder="HOUSING" /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="cname">Name</Label><Input id="cname" name="name" required /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="ctype">Type</Label><NativeSelect id="ctype" name="type"><NativeSelectOption value="allowance">Allowance</NativeSelectOption><NativeSelectOption value="deduction">Deduction</NativeSelectOption></NativeSelect></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="calc">Calculation</Label><NativeSelect id="calc" name="calc"><NativeSelectOption value="fixed">Fixed (AED)</NativeSelectOption><NativeSelectOption value="percent_of_basic">% of basic</NativeSelectOption></NativeSelect></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="dv">Default value</Label><Input id="dv" name="defaultValue" inputMode="decimal" defaultValue="0" /></div>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending}>Add component</Button><Msg s={s} /></div>
    </form>
  );
}
