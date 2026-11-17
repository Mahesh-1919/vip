import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { D, formatAED } from "@/lib/money";
import { getCompany } from "@/services/company";
import { getInvoice, PAYMENT_METHODS, receivables } from "@/services/sales/invoicing";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { SelectField, TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteDraftAction, issueAction, paymentAction, reversePaymentAction } from "../actions";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/inventory/invoices/[id]">) {
  const user = await requirePermission("inventory:invoice:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const d = await getInvoice(id.data);
  if (!d) notFound();
  const { inv, customer, sale, lines, payments, state, outstanding } = d;
  const draft = inv.status === "draft";
  const cur = inv.currency;
  const m = (v: string | number) => `${cur} ${new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;
  const canWrite = user.permissions.has("inventory:invoice:write");
  const canPay = user.permissions.has("inventory:payment:write");
  const [company, recv] = await Promise.all([getCompany(), receivables(customer.id)]);
  const exposure = Number(recv[0]?.outstandingAed ?? 0);
  const limit = Number(customer.creditLimit);

  const lineCols: Column<(typeof lines)[number]>[] = [
    { key: "d", header: "Description", cell: (l) => l.description },
    { key: "q", header: "Qty", align: "right", cell: (l) => formatQty(l.qty) },
    { key: "p", header: "Unit price", align: "right", cell: (l) => formatQty(l.unitPrice) },
    { key: "n", header: "Taxable", align: "right", cell: (l) => formatQty(l.net) },
    { key: "v", header: "VAT", align: "right", cell: (l) => <>{formatQty(l.vat)} <span className="text-xs text-muted-foreground">({l.vatCategory === "standard" ? `${Number(l.vatRate)}%` : l.vatCategory.replace("_", " ")})</span></> },
    { key: "t", header: "Total", align: "right", cell: (l) => formatQty(l.total) },
  ];
  const payCols: Column<(typeof payments)[number]>[] = [
    { key: "r", header: "Ref", cell: (p) => <span className="font-mono text-xs">{p.ref}</span> },
    { key: "d", header: "Date", cell: (p) => formatDate(p.paymentDate) },
    { key: "m", header: "Method", cell: (p) => <span className="capitalize">{p.method.replace("_", " ")}</span> },
    { key: "a", header: "Amount", align: "right", cell: (p) => <span className={Number(p.amount) < 0 ? "text-danger" : ""}>{m(p.amount)}</span> },
    { key: "n", header: "Reference / notes", cell: (p) => <span className="text-xs text-muted-foreground">{[p.reference, p.notes].filter(Boolean).join(" · ")}</span> },
    ...(canPay ? [{ key: "x", header: "", cell: (p: (typeof payments)[number]) => Number(p.amount) > 0 && !payments.some((q) => q.reversalOf === p.id) ? (
      <ActionForm action={reversePaymentAction} submit="Reverse" variant="outline" resetOnSuccess className="flex items-center gap-2" confirm="Reverse this payment? A negative entry is added; the original stays on record.">
        <input type="hidden" name="id" value={p.id} /><Input name="reason" placeholder="Reason" required minLength={3} maxLength={200} className="h-8 w-36" />
      </ActionForm>) : null }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: "/inventory/invoices", label: "Invoices" }} title={<>{inv.number ?? "Draft invoice"} <span className="text-base font-normal text-muted-foreground">· {customer.name}</span></>}
        description={<>Sale {sale.ref} · invoice date {formatDate(inv.issueDate)} · due {formatDate(inv.dueDate)}</>}
        actions={<><StatusBadge status={state} /><a href={`/api/inventory/invoices/${inv.id}/pdf`} className={buttonVariants({ variant: "outline" })}>{draft ? "Preview PDF" : "Download PDF"}</a></>} />

      {draft && !company.trn && <p role="alert" className="rounded-md border border-warning/40 bg-warning-bg p-3 text-sm text-warning">The company TRN is not set, so this invoice cannot be issued. Add it in <Link href="/admin/settings" className="underline">Company settings</Link>.</p>}
      {draft && !customer.taxId && customer.country === "AE" && <p className="rounded-md border p-3 text-sm text-muted-foreground">This UAE customer has no TRN on file. Tax invoices to VAT-registered businesses should show it.</p>}
      {!draft && limit > 0 && exposure > limit && <p role="alert" className="rounded-md border border-danger/40 bg-danger-bg p-3 text-sm text-danger">{customer.name} owes {formatAED(exposure)}, above the credit limit of {formatAED(limit)}.</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Subtotal" value={m(inv.subtotal)} />
        <StatCard label="VAT" value={m(inv.vatTotal)} hint={cur !== "AED" ? `AED ${Number(inv.vatAed).toFixed(2)}` : undefined} />
        <StatCard label="Total" value={m(inv.total)} hint={cur !== "AED" ? `AED ${Number(inv.totalAed).toFixed(2)}` : undefined} />
        <StatCard label="Outstanding" value={draft ? "—" : m(outstanding.toFixed(2))} tone={state === "overdue" ? "danger" : undefined} />
      </div>

      {canWrite && draft && (
        <div className="flex flex-wrap gap-3">
          <ActionForm action={issueAction.bind(null, inv.id) as never} submit="Issue invoice" resetOnSuccess={false} confirm="Issuing assigns the next tax invoice number and locks the invoice. It can no longer be edited or deleted; corrections need a credit note." />
          <ActionForm action={deleteDraftAction.bind(null, inv.id) as never} submit="Delete draft" variant="destructive" resetOnSuccess={false} confirm="Delete this draft? The quantities become available to bill again." />
        </div>
      )}

      <DataTable columns={lineCols} rows={lines} rowKey={(l) => l.id} />
      {!draft && inv.parties && <p className="text-xs text-muted-foreground">Issued by {inv.parties.company.name} (TRN {inv.parties.company.trn}) to {inv.parties.customer.name}{inv.parties.customer.trn ? ` (TRN ${inv.parties.customer.trn})` : ""}. These details are frozen.</p>}

      {!draft && (
        <>
          <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Payments</CardTitle></CardHeader><CardContent className="px-0">
            <DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={payCols} rows={payments} rowKey={(p) => p.id} empty={{ title: "No payments yet" }} /></CardContent></Card>
          {canPay && outstanding.gt(0) && (
            <Card><CardHeader><CardTitle>Record payment</CardTitle><CardDescription>Outstanding {m(outstanding.toFixed(2))}. Payments cannot exceed this.</CardDescription></CardHeader><CardContent>
              <ActionForm action={paymentAction} submit="Record payment" className="grid gap-4 sm:grid-cols-3">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <TextField name="amount" label={`Amount (${cur})`} inputMode="decimal" required defaultValue={outstanding.toFixed(2)} />
                <TextField name="paymentDate" label="Date received" type="date" required defaultValue={todayISO()} />
                <SelectField name="method" label="Method" options={PAYMENT_METHODS.map((x) => ({ value: x, label: x.replace("_", " ") }))} />
                <TextField name="reference" label="Reference (TT / cheque no.)" />
                <TextField className="sm:col-span-2" name="notes" label="Notes" />
              </ActionForm>
            </CardContent></Card>
          )}
        </>
      )}
      {D(inv.paidAmount).gt(0) && <Badge variant="secondary" className="w-fit">Paid {m(inv.paidAmount)}</Badge>}
    </div>
  );
}
