"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { State } from "./actions";

export function EnrollForm({ action }: { action: (s: State, f: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Label htmlFor="code">Enter the code to confirm</Label>
      <Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={7} required autoComplete="one-time-code" />
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-primary">Two-factor authentication enabled.</p>}
      <Button type="submit" disabled={pending}>Confirm and enable</Button>
    </form>
  );
}
