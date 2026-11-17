import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatAED } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { customerOptions, getSale } from "@/services/billing";
import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createInvoiceAction } from "../actions";
import { SaleForm } from "../sale-form";

export const metadata: Metadata = { title: "Sale" };

export default async function SalePage({ params }: PageProps<"/sales/[id]">) {
  const user = await requirePermission("sales:sale:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const d = await getSale(id.data);
  if (!d) notFound();
  const { s, customer, lines, invoice, totals } = d;
  const canWrite = user.permissions.has("sales:sale:write") && !invoice;
  const canInvoice = user.permissions.has("sales:invoice:write") && !invoice;
  const customers = canWrite ? await customerOptions() : [];
  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <PageHeader title={<span className="font-mono">{s.ref}</span>} back={{ href: "/sales", label: "Sales" }} description={customer.name} />
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Net" value={formatAED(totals.subtotal.toFixed(2))} /><StatCard label="VAT" value={formatAED(totals.vatTotal.toFixed(2))} /><StatCard label="Total" value={formatAED(totals.total.toFixed(2))} /></div>
      {invoice && <Card className="gap-0 py-0"><CardContent className="flex items-center justify-between px-4 py-4 text-sm">This sale is invoiced and locked. <Link href={`/sales/invoices/${invoice.id}`} className="font-mono text-primary hover:underline">{invoice.number} →</Link></CardContent></Card>}
      {canInvoice && (
        <Card><CardHeader><CardTitle>Create tax invoice</CardTitle><CardDescription>Issues the next invoice number and locks this sale. Save any changes to the sale first.</CardDescription></CardHeader><CardContent>
          <ActionForm action={createInvoiceAction} submit="Create invoice" resetOnSuccess={false} confirm="This issues a tax invoice with the next number. It cannot be edited or deleted afterwards." className="grid gap-4 sm:grid-cols-3">
            <input type="hidden" name="saleId" value={s.id} />
            <TextField name="issueDate" label="Invoice date" type="date" required defaultValue={todayISO()} />
            <TextField name="dueDate" label="Due date" type="date" hint={`Blank = ${customer.creditDays} days after the invoice date.`} />
            <TextField name="notes" label="Notes on invoice" />
          </ActionForm>
        </CardContent></Card>
      )}
      <Card><CardHeader><CardTitle>{canWrite ? "Edit sale" : "Lines"}</CardTitle></CardHeader><CardContent>
        {canWrite ? <SaleForm sale={s} lines={lines} customers={customers} /> : (
          <ul className="divide-y text-sm">{lines.map((l) => <li key={l.id} className="flex justify-between gap-3 py-2"><span>{l.description}</span><span className="text-muted-foreground">{Number(l.qty)} × {l.unitPrice} · VAT {Number(l.vatRate)}%</span></li>)}</ul>
        )}
      </CardContent></Card>
    </div>
  );
}
