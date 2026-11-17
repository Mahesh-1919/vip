import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate, todayISO } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { customersWithExports, invoiceableExits } from "@/services/exit-billing";
import { customerOptions } from "@/services/billing";
import { ActionForm } from "@/components/action-form";
import { FilterBar } from "@/components/filter-bar";
import { SelectField, TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createExitInvoiceAction } from "../../actions";

export const metadata: Metadata = { title: "Invoice export bills" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx
const n = (v: string | number) => new Intl.NumberFormat("en-US").format(Number(v));

export default async function NewExitInvoicePage({ searchParams }: PageProps<"/sales/invoices/new">) {
  await requirePermission("sales:invoice:write");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const customerId = z.uuid().safeParse(one(sp.customerId)).data;
  const focus = z.uuid().safeParse(one(sp.exit)).data;
  const [withExports, customer, exits] = await Promise.all([
    customersWithExports(), customerId ? customerOptions().then((c) => c.find((x) => x.id === customerId)) : null, customerId ? invoiceableExits(customerId) : [],
  ]);
  return (
    <div className="max-w-5xl flex flex-col gap-5">
      <PageHeader title="Invoice export bills" back={{ href: "/sales/invoices", label: "Invoices" }} description="Goods exported to a customer are invoiced at 0% VAT. Bill a whole export bill or just some of its packages; the rest stays available for a later invoice." />
      <Card><CardContent>
        <FilterBar plain>
          <SelectField name="customerId" label="Customer" required placeholder="Choose a customer…" defaultValue={customerId} className="min-w-72" options={withExports.map((c) => ({ value: c.id, label: c.name }))} />
          <Button type="submit">Show export bills</Button>
        </FilterBar>
        {!withExports.length && <p className="mt-3 text-sm text-muted-foreground">No export bill is linked to a customer yet. Open an export bill and choose its customer first.</p>}
      </CardContent></Card>

      {customerId && customer && (
        <Card>
          <CardHeader><CardTitle>{customer.name}</CardTitle><CardDescription>{exits.length ? "Only packages traced to stock (linked to an entry bill) can be invoiced. Enter the packages to invoice now and leave a row blank to skip it. One invoice can cover several export bills." : "Every export bill of this customer is fully invoiced."}</CardDescription></CardHeader>
          {exits.length > 0 && (
            <CardContent>
              <ActionForm action={createExitInvoiceAction} submit="Create tax invoice" resetOnSuccess={false} className="flex flex-col gap-5" confirm="This issues a tax invoice with the next number. It cannot be edited or deleted afterwards.">
                <input type="hidden" name="customerId" value={customerId} />
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader className="bg-muted/50"><TableRow>
                      <TableHead className="px-3">Export bill (BOE)</TableHead><TableHead className="px-3">Date</TableHead><TableHead className="px-3">Destination</TableHead>
                      <TableHead className="px-3 text-right">Value (AED)</TableHead><TableHead className="px-3 text-right">Packages</TableHead><TableHead className="px-3 text-right">Linked to stock</TableHead><TableHead className="px-3 text-right">Already invoiced</TableHead><TableHead className="px-3 text-right">Invoice now</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {exits.map((x) => (
                        <TableRow key={x.e.id} className={x.e.id === focus ? "bg-primary/5" : ""}>
                          <TableCell className="px-3"><Link href={`/freezone/exits/${x.e.id}`} className="font-mono text-xs text-primary hover:underline">{x.e.boeNo}</Link>{x.e.truckContainerNo && <div className="max-w-52 truncate font-mono text-[11px] text-muted-foreground">{x.e.truckContainerNo}</div>}</TableCell>
                          <TableCell className="px-3 whitespace-nowrap">{formatSheetDate(x.e.exitDate)}</TableCell>
                          <TableCell className="px-3">{x.e.portOfDischarge}</TableCell>
                          <TableCell className="px-3 text-right">{n(x.e.valueAed)}</TableCell>
                          <TableCell className="px-3 text-right">{n(x.e.packages)}</TableCell>
                          <TableCell className="px-3 text-right">{x.allocated >= x.e.packages ? <Badge variant="success">{n(x.allocated)}</Badge> : x.allocated > 0 ? <Badge variant="warning">{n(x.allocated)} of {n(x.e.packages)}</Badge> : <Badge variant="danger">Not linked</Badge>}</TableCell>
                          <TableCell className="px-3 text-right">{Number(x.billedPkgs) ? <Badge variant="info">{n(x.billedPkgs)} · {formatAED(x.billedValue)}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="px-3 text-right"><Input name={`pk:${x.e.id}`} inputMode="numeric" disabled={x.invoiceablePkgs === 0} defaultValue={x.invoiceablePkgs === 0 ? "" : focus ? (x.e.id === focus ? x.invoiceablePkgs : "") : x.invoiceablePkgs} className="ml-auto w-24 text-right" aria-label={`Packages to invoice for ${x.e.boeNo}`} /><div className="mt-0.5 text-[11px] text-muted-foreground">{x.invoiceablePkgs === 0 ? <Link href={`/freezone/exits/${x.e.id}`} className="text-warning hover:underline">link to stock first</Link> : `${n(x.invoiceablePkgs)} can be invoiced`}</div></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField name="issueDate" label="Invoice date" type="date" required defaultValue={todayISO()} />
                  <TextField name="dueDate" label="Due date" type="date" hint="Blank = customer's credit days." />
                  <TextField name="notes" label="Notes on invoice" maxLength={500} />
                </div>
              </ActionForm>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
