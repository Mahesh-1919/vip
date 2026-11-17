import type { Metadata } from "next";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { openSales, getSale } from "@/services/sales/sales";
import { ActionForm } from "@/components/action-form";
import { FilterBar } from "@/components/filter-bar";
import { SelectField, TextField, TextareaField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createDraftAction } from "../actions";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: PageProps<"/inventory/invoices/new">) {
  await requirePermission("inventory:invoice:write");
  const sp = await searchParams;
  const saleId = z.uuid().safeParse(Array.isArray(sp.saleId) ? sp.saleId[0] : sp.saleId).data;
  const sale = saleId ? await getSale(saleId) : null;
  const open = sale ? [] : await openSales();

  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <PageHeader title="New invoice" back={{ href: "/inventory/invoices", label: "Invoices" }} description="Pick a sale, then choose how much of each line to bill now. The rest stays available for later invoices." />
      {!sale ? (
        <Card><CardContent>
          <FilterBar className="items-end">
            <SelectField name="saleId" label="Sale with unbilled lines" required placeholder="Choose a sale…" className="min-w-80"
              options={open.map((s) => ({ value: s.id, label: `${s.ref} · ${s.customer} · ${s.saleDate} · ${s.currency}` }))} />
            <Button type="submit">Continue</Button>
          </FilterBar>
          {!open.length && <p className="mt-3 text-sm text-muted-foreground">Nothing left to invoice: every sale is fully billed. Create a sale first.</p>}
        </CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>{sale.s.ref} · {sale.customer.name}</CardTitle><CardDescription>Currency {sale.s.currency}. Leave a quantity blank to skip that line.</CardDescription></CardHeader>
          <CardContent>
            <ActionForm action={createDraftAction} submit="Create draft invoice" resetOnSuccess={false} className="flex flex-col gap-5">
              <input type="hidden" name="saleId" value={sale.s.id} />
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead className="px-4">Description</TableHead><TableHead className="px-4 text-right">Sold</TableHead><TableHead className="px-4 text-right">Already billed</TableHead><TableHead className="px-4 text-right">Unbilled</TableHead><TableHead className="px-4 text-right">Bill now</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {sale.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="px-4 whitespace-normal">{l.description}</TableCell>
                        <TableCell className="px-4 text-right">{formatQty(l.qty)}</TableCell><TableCell className="px-4 text-right">{formatQty(l.billed)}</TableCell>
                        <TableCell className="px-4 text-right font-medium">{formatQty(l.remaining.toFixed())}</TableCell>
                        <TableCell className="px-4 text-right">{l.remaining.gt(0) ? <Input name={`qty:${l.id}`} inputMode="decimal" defaultValue={l.remaining.toFixed()} className="ml-auto w-28 text-right" aria-label={`Quantity to bill for ${l.description}`} /> : <span className="text-muted-foreground">fully billed</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField name="issueDate" label="Invoice date" type="date" required defaultValue={todayISO()} />
                <TextField name="supplyDate" label="Date of supply" type="date" required defaultValue={todayISO()} />
                <TextField name="dueDate" label="Due date" type="date" hint={`Blank = ${sale.customer.creditDays} days (customer credit terms)`} />
                <TextareaField className="sm:col-span-3" name="notes" label="Notes (printed on the invoice)" rows={2} maxLength={500} />
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
