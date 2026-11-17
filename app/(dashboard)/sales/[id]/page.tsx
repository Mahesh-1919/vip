import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { D } from "@/lib/money";
import { VAT_LABEL, defaultVatCategory, lineAmounts, invoiceTotals } from "@/lib/vat";
import { getSale } from "@/services/sales/sales";
import { productOptions } from "@/services/inventory/stock";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { SelectField, TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addLineAction, cancelSaleAction, importContainerAction, removeLineAction } from "../actions";

export const metadata: Metadata = { title: "Sale" };
const money = (v: { toFixed(n: number): string } | string | number, cur: string) => `${cur} ${new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;

export default async function SalePage({ params }: PageProps<"/sales/[id]">) {
  const user = await requirePermission("sales:sale:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await getSale(id.data);
  if (!data) notFound();
  const { s, customer, lines, invoices } = data;
  const canWrite = user.permissions.has("sales:sale:write") && s.status === "confirmed";
  const canSeeInvoices = user.permissions.has("inventory:invoice:read");
  const products = canWrite ? await productOptions() : [];

  const calc = lines.map((l) => lineAmounts(l.qty, l.unitPrice, l.vatRate));
  const t = invoiceTotals(calc, s.exchangeRate);
  const columns: Column<(typeof lines)[number]>[] = [
    { key: "d", header: "Description", cell: (l) => l.description },
    { key: "q", header: "Qty", align: "right", cell: (l) => formatQty(l.qty) },
    { key: "b", header: "Invoiced", align: "right", cell: (l) => formatQty(l.billed) },
    { key: "r", header: "Unbilled", align: "right", cell: (l) => <span className={l.remaining.gt(0) ? "font-medium" : "text-muted-foreground"}>{formatQty(l.remaining.toFixed())}</span> },
    { key: "p", header: `Price (${s.currency})`, align: "right", cell: (l) => formatQty(l.unitPrice) },
    { key: "v", header: "VAT", cell: (l) => <Badge variant={l.vatCategory === "standard" ? "info" : "secondary"}>{l.vatCategory === "standard" ? "5%" : l.vatCategory.replace("_", " ")}</Badge> },
    { key: "t", header: "Total", align: "right", cell: (l) => money(lineAmounts(l.qty, l.unitPrice, l.vatRate).total, s.currency) },
    ...(canWrite ? [{ key: "x", header: "", cell: (l: { id: string; billed: string }) => D(l.billed).gt(0) ? null : <form action={removeLineAction}><input type="hidden" name="id" value={l.id} /><Button size="sm" variant="ghost" type="submit">Remove</Button></form> }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: "/sales", label: "Sales" }} title={<>{s.ref} <span className="text-base font-normal text-muted-foreground">· {customer.name}</span></>}
        description={<>{formatDate(s.saleDate)} · {s.currency}{s.currency !== "AED" ? ` @ ${formatQty(s.exchangeRate)}` : ""}{data.containerNo ? ` · container ${data.containerNo}` : " · goods only"}</>}
        actions={<StatusBadge status={s.status === "confirmed" ? "active" : "cancelled"} label={s.status} />} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Net (excl. VAT)" value={money(t.subtotal.toFixed(2), s.currency)} hint={s.currency !== "AED" ? money(t.subtotalAed.toFixed(2), "AED") : undefined} />
        <StatCard label="VAT" value={money(t.vatTotal.toFixed(2), s.currency)} hint={s.currency !== "AED" ? money(t.vatAed.toFixed(2), "AED") : undefined} />
        <StatCard label="Total" value={money(t.total.toFixed(2), s.currency)} hint={s.currency !== "AED" ? money(t.totalAed.toFixed(2), "AED") : undefined} />
      </div>

      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Lines</CardTitle><CardDescription>“Unbilled” is what can still be invoiced. Invoicing happens in Inventory → Invoices and can be done in several parts.</CardDescription></CardHeader>
        <CardContent className="px-0"><DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={columns} rows={lines} rowKey={(l) => l.id} empty={{ title: "No lines yet" }} /></CardContent></Card>

      {canWrite && (
        <div className="grid gap-6 lg:grid-cols-2">
          {s.containerId && data.containerDirection === "outward" && (
            <Card><CardHeader><CardTitle>Import from container</CardTitle><CardDescription>Adds every item of {data.containerNo} that is not yet on a sale, with the container’s prices.</CardDescription></CardHeader>
              <CardContent><ActionForm action={importContainerAction.bind(null, s.id) as never} submit="Import container items" variant="outline" resetOnSuccess={false} /></CardContent></Card>
          )}
          <Card className={s.containerId && data.containerDirection === "outward" ? "" : "lg:col-span-2"}><CardHeader><CardTitle>Add line</CardTitle></CardHeader><CardContent>
            <ActionForm action={addLineAction} submit="Add line" className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="saleId" value={s.id} />
              <SelectField className="sm:col-span-2" name="productId" label="Product" placeholder="Other / free text" options={products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} />
              <TextField className="sm:col-span-2" name="description" label="Description" hint="Optional when a product is chosen." />
              <TextField name="qty" label="Quantity" inputMode="decimal" required />
              <TextField name="unitPrice" label={`Unit price (${s.currency}, excl. VAT)`} inputMode="decimal" required />
              <SelectField className="sm:col-span-2" name="vatCategory" label="VAT treatment" defaultValue={defaultVatCategory(customer.country)} options={Object.entries(VAT_LABEL).map(([value, label]) => ({ value, label }))}
                hint="Exports of goods outside the UAE are normally zero-rated; supplies inside the UAE are 5%." />
            </ActionForm>
          </CardContent></Card>
        </div>
      )}

      <Card><CardHeader><CardTitle>Invoices</CardTitle></CardHeader><CardContent>
        {invoices.length ? (
          <ul className="divide-y text-sm">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <span>{canSeeInvoices ? <Link className="text-primary hover:underline" href={`/inventory/invoices/${i.id}`}>{i.number ?? "Draft"}</Link> : (i.number ?? "Draft")} <span className="text-muted-foreground">· {formatDate(i.issueDate)}</span></span>
                <span className="flex items-center gap-3"><span>{money(i.total, i.currency)}</span><StatusBadge status={i.status === "draft" ? "draft" : D(i.paid).gte(i.total) ? "paid" : D(i.paid).gt(0) ? "pending" : "finalized"} label={i.status === "draft" ? "draft" : D(i.paid).gte(i.total) ? "paid" : D(i.paid).gt(0) ? "part paid" : "unpaid"} /></span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Not invoiced yet.</p>}
      </CardContent></Card>

      {canWrite && invoices.length === 0 && (
        <ActionForm action={cancelSaleAction.bind(null, s.id) as never} submit="Cancel sale" variant="destructive" resetOnSuccess={false} confirm="Cancel this sale? It will drop out of reports. This cannot be undone." />
      )}
    </div>
  );
}
