"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createExitInvoiceAction } from "../../actions";

export type InvoiceRow = {
  id: string; boeNo: string; containers: string | null; date: string; destination: string | null;
  packages: number; value: number; billedPkgs: number; remainingPkgs: number; remainingValue: number; invoiceable: number;
};

const n = (v: number) => new Intl.NumberFormat("en-US").format(v);
const aed = (v: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
/** Same rule as the server: the last part takes the exact remainder, other parts are value x packages / total packages. */
const amountFor = (r: InvoiceRow, pk: number) => (pk >= r.remainingPkgs ? r.remainingValue : Math.round((r.value * pk * 100) / r.packages) / 100);

export function ExitInvoiceForm({ customerId, rows, initial, today }: { customerId: string; rows: InvoiceRow[]; initial: Record<string, string>; today: string }) {
  const [pk, setPk] = useState<Record<string, string>>(initial);
  const lines = useMemo(() => rows.map((r) => {
    const want = Math.min(Number(pk[r.id] || 0), r.invoiceable);
    return { r, want, amount: want > 0 ? amountFor(r, want) : 0, over: Number(pk[r.id] || 0) > r.invoiceable };
  }), [rows, pk]);
  const chosen = lines.filter((l) => l.want > 0);
  const totalPkgs = chosen.reduce((t, l) => t + l.want, 0);
  const total = chosen.reduce((t, l) => t + l.amount, 0);
  const anyOver = lines.some((l) => l.over);
  const ready = rows.filter((r) => r.invoiceable > 0 && r.value > 0);

  return (
    <ActionForm action={createExitInvoiceAction} submit="Create tax invoice" resetOnSuccess={false} disabled={totalPkgs === 0 || anyOver} className="flex flex-col gap-6"
      confirm={`This issues a tax invoice for AED ${aed(total)} (${n(totalPkgs)} packages) with the next invoice number. It cannot be edited or deleted afterwards. You can record the customer's payments on it afterwards, in part or in full.`}>
      <input type="hidden" name="customerId" value={customerId} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-base font-semibold"><span className="mr-2 inline-grid size-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">2</span>Choose what to invoice</h3>
          {ready.length > 1 && <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setPk(Object.fromEntries(ready.map((r) => [r.id, String(r.invoiceable)])))}>Select all available</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPk({})}>Clear</Button>
          </div>}
        </div>
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-[0.9375rem]">
            <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Export bill (BOE)</th>
                <th className="px-3 py-3">Exit date</th>
                <th className="px-3 py-3 text-right">Bill value</th>
                <th className="px-3 py-3 text-right">Packages</th>
                <th className="px-3 py-3 text-right">Invoiced</th>
                <th className="px-3 py-3 text-right">Available</th>
                <th className="px-3 py-3">Invoice now</th>
                <th className="px-3 py-3 text-right">Amount (AED)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map(({ r, want, amount, over }) => {
                const blocked = r.value <= 0 ? "no-value" : r.invoiceable <= 0 ? "no-stock" : null;
                return (
                  <tr key={r.id} className={cn(want > 0 && "bg-primary/5")}>
                    <td className="px-3 py-3"><Link href={`/bills/exits/${r.id}`} className="font-mono text-[0.8125rem] text-primary hover:underline">{r.boeNo}</Link>{r.containers && <div className="max-w-56 truncate font-mono text-xs text-muted-foreground">{r.containers}</div>}</td>
                    <td className="whitespace-nowrap px-4 py-3">{r.date}{r.destination && <div className="text-xs text-muted-foreground">to {r.destination}</div>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{aed(r.value)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{n(r.packages)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.billedPkgs > 0 ? <Badge variant="info">{n(r.billedPkgs)}</Badge> : <span className="text-muted-foreground">0</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{blocked ? <span className="text-muted-foreground">0</span> : <Badge variant="success">{n(r.invoiceable)}</Badge>}</td>
                    <td className="px-3 py-3">
                      {blocked === "no-value" ? <Link href={`/bills/exits/${r.id}`} className="text-sm text-warning hover:underline">Add the bill value first →</Link>
                        : blocked === "no-stock" ? <Link href={`/bills/exits/${r.id}`} className="text-sm text-warning hover:underline">Link to stock first →</Link>
                        : <div className="flex items-center gap-2">
                            <Input name={`pk:${r.id}`} inputMode="numeric" value={pk[r.id] ?? ""} placeholder="0" aria-invalid={over || undefined} aria-label={`Packages to invoice for ${r.boeNo}`} className="w-28 text-right"
                              onChange={(e) => setPk((s) => ({ ...s, [r.id]: e.target.value.replace(/\D/g, "") }))} />
                            <Button type="button" size="sm" variant="outline" onClick={() => setPk((s) => ({ ...s, [r.id]: String(r.invoiceable) }))}>All</Button>
                            {over && <span className="text-xs text-destructive">Max {n(r.invoiceable)}</span>}
                          </div>}
                    </td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums">{want > 0 ? aed(amount) : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">Only packages linked to stock can be invoiced. Leave a row empty to skip it. Anything you do not invoice now stays available for a later invoice.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold"><span className="mr-2 inline-grid size-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">3</span>Invoice details</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField name="issueDate" label="Invoice date" type="date" required defaultValue={today} />
          <TextField name="dueDate" label="Due date" type="date" hint="Blank = customer's credit days." />
          <TextField name="notes" label="Notes on invoice" maxLength={500} />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-muted px-5 py-4">
        <div className="text-sm text-muted-foreground">{totalPkgs > 0 ? <><b className="text-foreground">{chosen.length}</b> export {chosen.length === 1 ? "bill" : "bills"} · <b className="text-foreground">{n(totalPkgs)}</b> packages · VAT 0% (export)</> : "Enter the packages to invoice above."}</div>
        <div className="text-right"><div className="text-xs text-muted-foreground">Invoice total</div><div className="text-2xl font-semibold tabular-nums">AED {aed(total)}</div></div>
      </div>
      <p className="-mt-3 text-sm text-muted-foreground">After you create the invoice you can record the customer&apos;s payments on it: a part payment now and the rest later, or the full amount at once.</p>
    </ActionForm>
  );
}
