import type { Metadata } from "next";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate, todayISO } from "@/lib/dates";
import { customersWithExports, invoiceableExits } from "@/services/exit-billing";
import { customerOptions } from "@/services/billing";
import { FilterBar } from "@/components/filter-bar";
import { SelectField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExitInvoiceForm } from "./exit-invoice-form";

export const metadata: Metadata = { title: "Invoice export bills" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

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
    <div className="max-w-7xl flex flex-col gap-5">
      <PageHeader title="Invoice export bills" back={{ href: "/sales/invoices", label: "Invoices" }} description="Goods exported to a customer are invoiced at 0% VAT. Bill a whole export bill or just some of its packages; the rest stays available for a later invoice." />
      <Card><CardContent>
        <FilterBar plain>
          <SelectField name="customerId" label="1 · Choose the customer" required placeholder="Choose a customer…" defaultValue={customerId} className="min-w-72" options={withExports.map((c) => ({ value: c.id, label: c.name }))} />
          <Button type="submit">Show export bills</Button>
        </FilterBar>
        {!withExports.length && <p className="mt-3 text-sm text-muted-foreground">No export bill is linked to a customer yet. Open an export bill and choose its customer first.</p>}
      </CardContent></Card>

      {customerId && customer && (
        <Card>
          <CardHeader><CardTitle>{customer.name}</CardTitle><CardDescription>{exits.length ? "Step 2 and 3: tick off the goods this invoice covers. One invoice can cover several export bills of this customer." : "Every export bill of this customer is fully invoiced."}</CardDescription></CardHeader>
          {exits.length > 0 && (
            <CardContent>
              <ExitInvoiceForm customerId={customerId} today={todayISO()}
                initial={Object.fromEntries(exits.filter((x) => x.invoiceablePkgs > 0 && Number(x.e.valueAed) > 0 && (!focus || x.e.id === focus)).map((x) => [x.e.id, String(x.invoiceablePkgs)]))}
                rows={exits.map((x) => ({ id: x.e.id, boeNo: x.e.boeNo, containers: x.e.truckContainerNo, date: formatSheetDate(x.e.exitDate), destination: x.e.portOfDischarge, packages: x.e.packages, value: Number(x.e.valueAed), billedPkgs: Number(x.billedPkgs), remainingPkgs: x.remainingPkgs, remainingValue: x.remainingValue.toNumber(), invoiceable: x.invoiceablePkgs }))} />
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
