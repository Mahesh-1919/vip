import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { getInvoice, PAYMENT_METHODS } from "@/services/billing";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { SelectField, TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { paymentAction } from "../../actions";

export const metadata: Metadata = { title: "Invoice" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx
const n = (v: string | number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));

export default async function InvoicePage({ params }: PageProps<"/sales/invoices/[id]">) {
  const user = await requirePermission("sales:invoice:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const d = await getInvoice(id.data);
  if (!d) notFound();
  const { inv, customer, sale, lines, payments, state, outstanding } = d;
  const canPay = user.permissions.has("sales:payment:write") && outstanding.gt(0);
  const lineCols: Column<(typeof lines)[number]>[] = [
    { key: "d", header: "Description", cell: (l) => l.description },
    { key: "q", header: "Qty", align: "right", cell: (l) => Number(l.qty) },
    { key: "p", header: "Unit price", align: "right", cell: (l) => n(l.unitPrice) },
    { key: "net", header: "Taxable", align: "right", cell: (l) => n(l.net) },
    { key: "v", header: "VAT", align: "right", cell: (l) => <>{n(l.vat)} <span className="text-xs text-muted-foreground">({Number(l.vatRate)}%)</span></> },
    { key: "t", header: "Total", align: "right", cell: (l) => n(l.total) },
  ];
  const payCols: Column<(typeof payments)[number]>[] = [
    { key: "r", header: "Ref", cell: (p) => <span className="font-mono text-[0.8125rem]">{p.ref}</span> },
    { key: "d", header: "Date", cell: (p) => formatDate(p.paymentDate) },
    { key: "m", header: "Method", cell: (p) => <span className="capitalize">{p.method.replace("_", " ")}</span> },
    { key: "a", header: "Amount", align: "right", cell: (p) => n(p.amount) },
    { key: "x", header: "Reference", cell: (p) => <span className="text-xs text-muted-foreground">{p.reference}</span> },
  ];
  return (
    <div className="max-w-6xl flex flex-col gap-5">
      <PageHeader back={{ href: "/sales/invoices", label: "Invoices" }} title={<span className="font-mono">{inv.number}</span>}
        description={<>{customer.name} · sale <Link className="text-primary hover:underline" href={`/sales/${sale.id}`}>{sale.ref}</Link> · issued {formatDate(inv.issueDate)} · due {formatDate(inv.dueDate)}</>}
        actions={<><StatusBadge status={state} />{canPay && <a href="#record-payment" className={buttonVariants()}>Record payment</a>}<a href={`/api/sales/invoices/${inv.id}/pdf`} className={buttonVariants({ variant: "outline" })}>Download PDF</a></>} />
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Invoice total" value={formatAED(inv.total)} hint={`Subtotal ${formatAED(inv.subtotal)} · VAT ${formatAED(inv.vatTotal)}`} /><StatCard label="Paid so far" value={formatAED(inv.paidAmount)} tone={Number(inv.paidAmount) > 0 ? "success" : undefined} hint={`${payments.length} ${payments.length === 1 ? "payment" : "payments"}`} /><StatCard featured={state !== "overdue" && outstanding.gt(0)} label="Outstanding" value={formatAED(outstanding.toFixed(2))} tone={state === "overdue" ? "danger" : undefined} hint={outstanding.gt(0) ? "Still to be paid" : "Fully paid"} /></div>
      <DataTable columns={lineCols} rows={lines} rowKey={(l) => l.id} />
      <p className="text-xs text-muted-foreground">Issued by {inv.parties.company.name} (TRN {inv.parties.company.trn}) to {inv.parties.customer.name}{inv.parties.customer.trn ? ` (TRN ${inv.parties.customer.trn})` : ""}. An issued tax invoice cannot be changed.</p>
      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Payments</CardTitle></CardHeader><CardContent className="px-0"><DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={payCols} rows={payments} rowKey={(p) => p.id} empty={{ title: "No payments yet" }} /></CardContent></Card>
      {canPay && (
        <Card id="record-payment" className="scroll-mt-20"><CardHeader><CardTitle>Record a payment</CardTitle><CardDescription>Outstanding AED {n(outstanding.toFixed(2))}. Enter what the customer paid: the full amount, or a part now and the rest later. A payment cannot exceed the outstanding amount.</CardDescription></CardHeader><CardContent>
          <ActionForm action={paymentAction} submit="Record payment" className="grid gap-4 sm:grid-cols-4">
            <input type="hidden" name="invoiceId" value={inv.id} />
            <TextField name="amount" label="Amount (AED)" inputMode="decimal" required defaultValue={outstanding.toFixed(2)} />
            <TextField name="paymentDate" label="Date received" type="date" required defaultValue={todayISO()} />
            <SelectField name="method" label="Method" options={PAYMENT_METHODS.map((m) => ({ value: m, label: m.replace("_", " ") }))} />
            <TextField name="reference" label="Reference" />
          </ActionForm>
        </CardContent></Card>
      )}
    </div>
  );
}
