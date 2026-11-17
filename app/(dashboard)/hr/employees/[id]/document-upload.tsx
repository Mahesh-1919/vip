"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const TYPES = ["passport", "emirates_id", "visa", "labour_contract", "offer_letter", "other"];

export function DocumentUpload({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ error?: string; ok?: boolean }>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true); setMsg(undefined);
    const form = ev.currentTarget;
    const res = await fetch(`/api/hr/employees/${employeeId}/documents`, { method: "POST", body: new FormData(form) });
    setBusy(false);
    if (res.ok) { form.reset(); setMsg({ ok: true }); router.refresh(); }
    else setMsg({ error: (await res.json().catch(() => null))?.error ?? "Upload failed" });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3 items-end">
      <div className="flex flex-col gap-1.5"><Label htmlFor="type">Type</Label>
        <NativeSelect id="type" name="type" className="h-9 rounded-md border border-border bg-background px-3 text-sm">
          {TYPES.map((t) => <NativeSelectOption key={t} value={t}>{t.replace("_", " ")}</NativeSelectOption>)}
        </NativeSelect></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="expiryDate">Expiry date</Label><Input id="expiryDate" name="expiryDate" type="date" /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="file">File (PDF/PNG/JPG, ≤5 MB)</Label><Input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required className="pt-1.5" /></div>
      <div className="sm:col-span-3 flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</Button>
        {msg?.error && <span role="alert" className="text-sm text-destructive">{msg.error}</span>}
        {msg?.ok && <span className="text-sm text-primary">Uploaded.</span>}
      </div>
    </form>
  );
}
