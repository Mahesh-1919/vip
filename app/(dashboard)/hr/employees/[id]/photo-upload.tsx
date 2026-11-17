"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PhotoUpload({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true);
    const form = ev.currentTarget;
    const res = await fetch(`/api/hr/employees/${employeeId}/photo`, { method: "POST", body: new FormData(form) });
    setBusy(false);
    if (res.ok) { form.reset(); toast.success("Photo updated"); router.refresh(); }
    else toast.error((await res.json().catch(() => null))?.error ?? "Upload failed");
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input name="file" type="file" accept="image/png,image/jpeg" required className="max-w-64 pt-1.5" aria-label="Employee photo" />
      <Button type="submit" size="sm" variant="outline" disabled={busy}>{busy ? "Uploading…" : "Upload photo"}</Button>
    </form>
  );
}
