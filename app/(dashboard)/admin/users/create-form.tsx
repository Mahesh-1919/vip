"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { State } from "./actions";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export function CreateUserForm({ action, roles }: { action: (s: State, f: FormData) => Promise<State>; roles: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5"><Label htmlFor="name">Name</Label><Input id="name" name="name" required minLength={2} maxLength={120} /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="roleId">Role</Label>
        <NativeSelect id="roleId" name="roleId" required className="h-9 rounded-md border border-border bg-background px-3 text-sm">
          {roles.map((r) => <NativeSelectOption key={r.id} value={r.id}>{r.name}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="password">Temporary password</Label><Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" /></div>
      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>Create user</Button>
        {state?.error && <span role="alert" className="text-sm text-destructive">{state.error}</span>}
        {state?.ok && <span className="text-sm text-primary">User created.</span>}
      </div>
    </form>
  );
}
