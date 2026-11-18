"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { FormField, SelectField, TextField, TextareaField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CERT_STATUSES, REFUND_STATUSES } from "@/validators/freezone";
import { createExitFromStockAction } from "./actions";

export type StockEntry = { id: string; billNo: string; billDate: string; agent: string | null; packages: number; remaining: number; weightKg: string; marks: string | null; origin: string | null };
const opts = (a: readonly string[]) => a.map((v) => ({ value: v, label: v }));
const n = (v: number | string) => new Intl.NumberFormat("en-US").format(Number(v));
const shortDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

/** Export bill created straight from stock: pick the import, see what is available, take up to that many packages. */
export function NewExitForm({ entries, customers }: { entries: StockEntry[]; customers: { id: string; name: string }[] }) {
  const [entryId, setEntryId] = useState("");
  const [pkgs, setPkgs] = useState("");
  const entry = entries.find((e) => e.id === entryId);
  const want = Number(pkgs);
  const over = !!entry && want > entry.remaining;

  return (
    <ActionForm action={createExitFromStockAction} submit="Create exit bill" resetOnSuccess={false} className="grid gap-4 sm:grid-cols-3">
      <FormField className="sm:col-span-3" label="Import (entry bill) to take stock from" htmlFor="entryBillId" required hint={entries.length ? "Only imports that still have packages in stock are listed." : "There is no stock to export. Add an entry bill first."}>
        <NativeSelect id="entryBillId" name="entryBillId" required value={entryId} onChange={(e) => { setEntryId(e.target.value); setPkgs(""); }}>
          <NativeSelectOption value="">Choose an import…</NativeSelectOption>
          {entries.map((e) => <NativeSelectOption key={e.id} value={e.id}>{`${e.billNo} · ${shortDate(e.billDate)} · ${e.agent ?? "—"} · ${n(e.remaining)} in stock`}</NativeSelectOption>)}
        </NativeSelect>
      </FormField>

      {entry && (
        <div className="sm:col-span-3 grid gap-3 rounded-2xl bg-muted p-4 sm:grid-cols-4">
          <div><div className="text-xs text-muted-foreground">Available stock</div><div className="text-2xl font-semibold text-primary">{n(entry.remaining)} <span className="text-sm font-normal text-muted-foreground">packages</span></div></div>
          <div><div className="text-xs text-muted-foreground">Imported</div><div className="text-lg font-semibold">{n(entry.packages)}</div><div className="text-xs text-muted-foreground">{n(entry.packages - entry.remaining)} already exported</div></div>
          <div><div className="text-xs text-muted-foreground">Arrived</div><div className="text-sm font-medium">{shortDate(entry.billDate)}</div><div className="text-xs text-muted-foreground">{entry.agent ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Containers</div><div className="break-words font-mono text-xs">{entry.marks || "—"}</div>{entry.origin && <Badge variant="secondary" className="mt-1">{entry.origin}</Badge>}</div>
        </div>
      )}

      <SelectField name="customerId" label="Customer" required placeholder="Choose the customer…" options={customers.map((c) => ({ value: c.id, label: c.name }))} />
      <FormField label="Packages to export" htmlFor="packages" required error={over ? `Only ${n(entry!.remaining)} in stock` : undefined} hint={entry ? `Up to ${n(entry.remaining)}` : "Choose an import first"}>
        <div className="flex gap-2">
          <Input id="packages" name="packages" inputMode="numeric" required disabled={!entry} value={pkgs} onChange={(e) => setPkgs(e.target.value.replace(/\D/g, ""))} aria-invalid={over || undefined} />
          {entry && <Button type="button" variant="outline" onClick={() => setPkgs(String(entry.remaining))}>All</Button>}
        </div>
      </FormField>
      <TextField name="exitDate" label="Exit date" type="date" required min={entry?.billDate} hint={entry ? `Not before ${shortDate(entry.billDate)}` : undefined} />
      <TextField name="boeNo" label="BOE no." required placeholder="1-3-60-1-26-847" />
      <TextField name="valueAed" label="Value (AED)" inputMode="decimal" defaultValue="0" />
      <TextField name="weightKg" label="Weight (kg)" inputMode="decimal" defaultValue="0" />

      <details className="sm:col-span-3 rounded-2xl border p-4 [&_summary]:cursor-pointer">
        <summary className="text-sm font-medium">More details (optional)</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <TextField name="refNo" label="Ref no." />
          <TextField name="portOfLoading" label="Port of loading" />
          <TextField name="portOfDischarge" label="Port of discharge" />
          <TextField name="invoiceNo" label="Invoice no." />
          <TextField name="country" label="Country" placeholder="CN, TR" />
          <TextField name="truckContainerNo" label="Truck / container no." />
          <SelectField name="entryCertStatus" label="T / Entry certificate" defaultValue="Pending" options={opts(CERT_STATUSES)} />
          <TextField name="chequeDate" label="Cheque date" type="date" />
          <TextField name="chequeAmount" label="Cheque amount" inputMode="decimal" />
          <SelectField name="refundStatus" label="Refund status" defaultValue="Pending" options={opts(REFUND_STATUSES)} />
          <TextField name="shippingLine" label="Shipping" />
          <TextareaField className="sm:col-span-3" name="notes" label="Notes" rows={2} />
        </div>
      </details>
    </ActionForm>
  );
}
