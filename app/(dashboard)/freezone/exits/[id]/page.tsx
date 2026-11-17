import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { customerOptions } from "@/services/billing";
import { entriesForExit, getExitDetail, OVER_EXPORT_TOLERANCE } from "@/services/freezone";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { SelectField, TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { allocateAction, deleteExitAction, removeAllocationAction } from "../actions";
import { ExitForm } from "../exit-form";

export const metadata: Metadata = { title: "Exit bill" };
const n = (v: string | number, d = 0) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v));

export default async function ExitPage({ params }: PageProps<"/freezone/exits/[id]">) {
  const user = await requirePermission("freezone:exit:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const d = await getExitDetail(id.data);
  if (!d) notFound();
  const { e: exit, allocations, billing, allocated, unallocated, billedPkgs, billedValue, unbilled } = d;
  const canWrite = user.permissions.has("freezone:exit:write");
  const invoiced = Number(billedPkgs) > 0;
  const [customers, entries] = await Promise.all([customerOptions(), canWrite && !invoiced && unallocated > 0 ? entriesForExit(exit.id) : Promise.resolve([])]);
  const isExport = exit.billType === "EXPORT";

  const allocCols: Column<(typeof allocations)[number]>[] = [
    { key: "e", header: "Entry bill", cell: ({ billNo, entryId }) => <Link href={`/freezone/entries/${entryId}`} className="font-mono text-xs text-primary hover:underline">{billNo}</Link> },
    { key: "d", header: "Entry date", cell: ({ billDate }) => formatSheetDate(billDate) },
    { key: "a", header: "Agent", cell: ({ agent }) => agent },
    { key: "p", header: "Packages taken", align: "right", cell: ({ a, entryPackages }) => <>{n(a.packages)} <span className="text-xs text-muted-foreground">of {n(entryPackages)}</span></> },
    { key: "w", header: "Weight (kg)", align: "right", cell: ({ a }) => n(a.weightKg) },
    { key: "r", header: "Note", cell: ({ a }) => a.overReason ? <Badge variant="warning" title={a.overReason}>Over-export: {a.overReason}</Badge> : "" },
    ...(canWrite && !invoiced ? [{ key: "x", header: "", cell: ({ a }: { a: { id: string } }) => <form action={removeAllocationAction}><input type="hidden" name="id" value={a.id} /><Button size="sm" variant="ghost" type="submit">Remove</Button></form> }] : []),
  ];
  const billCols: Column<(typeof billing)[number]>[] = [
    { key: "i", header: "Invoice", cell: ({ number, invoiceId }) => user.permissions.has("sales:invoice:read") ? <Link href={`/sales/invoices/${invoiceId}`} className="font-mono text-xs text-primary hover:underline">{number}</Link> : <span className="font-mono text-xs">{number}</span> },
    { key: "d", header: "Date", cell: ({ issueDate }) => formatSheetDate(issueDate) },
    { key: "q", header: "Packages", align: "right", cell: ({ qty }) => n(qty) },
    { key: "v", header: "Value (AED)", align: "right", cell: ({ net }) => n(net, 2) },
  ];

  return (
    <div className="max-w-5xl flex flex-col gap-6">
      <PageHeader title={<span className="font-mono">{exit.boeNo}</span>} back={{ href: "/freezone/exits", label: "Exit bills" }} description={<>{exit.importerName}{d.customer && d.customer !== exit.importerName ? ` · customer: ${d.customer}` : ""}</>}
        actions={<Badge variant={isExport ? "info" : "secondary"}>{exit.billType}</Badge>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Packages on this bill" value={n(exit.packages)} />
        <StatCard label="Linked to entry bills" value={`${n(allocated)} / ${n(exit.packages)}`} tone={unallocated > 0 ? "warning" : "success"} hint={unallocated > 0 ? `${n(unallocated)} not yet traced to an entry` : "Fully traced"} />
        <StatCard label="Invoiced packages" value={isExport ? `${n(billedPkgs)} / ${n(exit.packages)}` : "—"} tone={isExport && unbilled > 0 ? "warning" : undefined} hint={isExport ? `${n(unbilled)} left to invoice` : "Import bills are not invoiced"} />
        <StatCard label="Invoiced value" value={isExport ? `${formatAED(billedValue)}` : "—"} hint={isExport ? `of ${formatAED(exit.valueAed)}` : undefined} />
      </div>

      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Where these goods came from</CardTitle><CardDescription>Link the exit to the entry bill(s) it was taken from. One entry can supply several exits, and one exit can draw from several entries.</CardDescription></CardHeader>
        <CardContent className="px-0"><DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={allocCols} rows={allocations} rowKey={({ a }) => a.id} empty={{ title: "Not linked to any entry bill yet" }} /></CardContent></Card>
      {canWrite && invoiced && <p className="text-sm text-muted-foreground">This exit bill is invoiced, so its links are locked.</p>}
      {canWrite && !invoiced && unallocated > 0 && (
        <Card><CardHeader><CardTitle>Link to an entry bill</CardTitle><CardDescription>{n(unallocated)} packages still to trace. Taking more than an entry imported is allowed up to {OVER_EXPORT_TOLERANCE * 100}% with a reason (e.g. repacking).</CardDescription></CardHeader><CardContent>
          <ActionForm action={allocateAction} submit="Link packages" className="grid gap-4 sm:grid-cols-4">
            <input type="hidden" name="exitBillId" value={exit.id} />
            <SelectField className="sm:col-span-4" name="entryBillId" label="Entry bill" required placeholder="Choose…" options={entries.map((x) => ({ value: x.id, label: `${x.billNo} · ${formatSheetDate(x.billDate)} · ${x.agent ?? "—"} · ${x.remaining} of ${x.packages} left${x.marks ? ` · ${x.marks}` : ""}` }))} />
            <TextField name="packages" label="Packages" inputMode="numeric" required defaultValue={unallocated} />
            <TextField name="weightKg" label="Weight (kg)" inputMode="decimal" />
            <TextField className="sm:col-span-2" name="reason" label="Reason (only if over the entry's count)" maxLength={200} />
          </ActionForm>
        </CardContent></Card>
      )}

      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Invoicing</CardTitle>
        <CardDescription>{isExport ? "Goods on export bills are invoiced at 0% VAT, in whole or in parts (by packages)." : "Invoices are generated for export bills only."}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          <DataTable className="rounded-none border-x-0 shadow-none" columns={billCols} rows={billing} rowKey={(b) => b.invoiceId + b.qty} empty={{ title: isExport ? "Not invoiced yet" : "Not applicable" }}
            footer={billing.length ? { i: "Total", q: n(billedPkgs), v: n(billedValue, 2) } : undefined} />
          {isExport && user.permissions.has("sales:invoice:write") && (
            <div className="px-6 pb-5">
              {!exit.customerId ? <p className="text-sm text-warning">Link a customer above before invoicing this bill.</p>
                : unbilled > 0 ? <Link className={buttonVariants()} href={`/sales/invoices/new?customerId=${exit.customerId}&exit=${exit.id}`}>Invoice this bill ({n(unbilled)} packages left)</Link>
                : <p className="text-sm text-success">Fully invoiced.</p>}
            </div>
          )}
        </CardContent></Card>

      {canWrite ? <Card><CardHeader><CardTitle>Bill details</CardTitle></CardHeader><CardContent><ExitForm exit={exit} customers={customers} /></CardContent></Card> : <Card><CardContent className="text-sm">You have read-only access.</CardContent></Card>}
      {canWrite && <ActionForm action={deleteExitAction.bind(null, exit.id) as never} submit="Delete exit bill" variant="destructive" resetOnSuccess={false} confirm="Delete this exit bill? This is recorded in the audit log but cannot be undone. It is blocked if the bill is invoiced or linked to entry bills." />}
    </div>
  );
}
