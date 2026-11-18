import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate } from "@/lib/dates";
import { getEntryDetail } from "@/services/freezone";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteEntryAction } from "../actions";
import { EntryForm } from "../entry-form";

export const metadata: Metadata = { title: "Entry bill" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx
const n = (v: string | number) => new Intl.NumberFormat("en-US").format(Number(v));

export default async function EntryPage({ params }: PageProps<"/freezone/entries/[id]">) {
  const user = await requirePermission("freezone:entry:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const d = await getEntryDetail(id.data);
  if (!d) notFound();
  const { e: entry, exported, remaining, allocations, byCustomer } = d;
  const canWrite = user.permissions.has("freezone:entry:write");
  const canSales = user.permissions.has("sales:invoice:read");
  const pct = entry.packages ? Math.min(100, Math.round((exported / entry.packages) * 100)) : 0;
  const cols: Column<(typeof allocations)[number]>[] = [
    { key: "b", header: "Exit bill (BOE)", cell: ({ boeNo, exitId }) => user.permissions.has("freezone:exit:read") ? <Link href={`/freezone/exits/${exitId}`} className="font-mono text-[0.8125rem] text-primary hover:underline">{boeNo}</Link> : <span className="font-mono text-[0.8125rem]">{boeNo}</span> },
    { key: "d", header: "Exit date", className: "whitespace-nowrap", cell: ({ exitDate }) => formatSheetDate(exitDate) },
    { key: "t", header: "Type", cell: ({ billType }) => <Badge variant={billType === "EXPORT" ? "info" : "secondary"}>{billType}</Badge> },
    { key: "c", header: "Customer", cell: ({ customer, importer }) => customer ?? importer },
    { key: "p", header: "Packages taken", align: "right", cell: ({ a, exitPackages }) => <>{n(a.packages)}<span className="text-xs text-muted-foreground"> of {n(exitPackages)}</span></> },
    { key: "i", header: "Invoiced", align: "right", cell: ({ invoicedPkgs, billType, exitPackages }) => billType !== "EXPORT" ? <span className="text-muted-foreground">n/a</span> : invoicedPkgs === 0 ? <Badge variant="warning">Not invoiced</Badge> : invoicedPkgs >= exitPackages ? <Badge variant="success">Invoiced</Badge> : <Badge variant="info">{n(invoicedPkgs)}/{n(exitPackages)}</Badge> },
    { key: "v", header: "Invoice / Sale", cell: ({ invoices }) => invoices.length ? <span className="flex flex-col gap-0.5 font-mono text-[0.8125rem]">{invoices.map((v) => canSales ? <span key={v.invoiceId}><Link href={`/sales/invoices/${v.invoiceId}`} className="text-primary hover:underline">{v.number}</Link> <span className="text-muted-foreground">· <Link href={`/sales/${v.saleId}`} className="hover:underline">{v.saleRef}</Link></span></span> : <span key={v.invoiceId}>{v.number}</span>)}</span> : "" },
  ];
  return (
    <div className="max-w-5xl flex flex-col gap-6">
      <PageHeader title={<span className="font-mono">{entry.billNo}</span>} back={{ href: "/freezone/entries", label: "Entry bills" }} description={entry.agentName}
        actions={<>{remaining <= 0 ? <Badge variant="secondary">Fully exported</Badge> : exported > 0 ? <Badge variant="warning">Partly exported</Badge> : <Badge variant="success">In stock</Badge>}</>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Packages imported" value={n(entry.packages)} />
        <StatCard label="Exported so far" value={n(exported)} hint={`${pct}% of this entry, to ${byCustomer.length} ${byCustomer.length === 1 ? "customer" : "customers"} in ${allocations.length} exit ${allocations.length === 1 ? "bill" : "bills"}`} />
        <StatCard featured={remaining > 0} label="Stock remaining in the zone" value={n(remaining)} hint={remaining === 0 ? "Nothing left" : `${100 - pct}% still available to export`} />
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct}% of this entry has been exported`}><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
      {byCustomer.length > 0 && <Card className="gap-3"><CardHeader><CardTitle>Who received these goods</CardTitle><CardDescription>How this entry was distributed between customers.</CardDescription></CardHeader>
        <CardContent><ul className="grid gap-2 sm:grid-cols-2">{byCustomer.map((c) => <li key={c.name} className="flex items-center justify-between rounded-xl bg-muted px-4 py-2.5 text-sm"><span className="font-medium">{c.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{c.exits} exit {c.exits === 1 ? "bill" : "bills"}</span></span><span className="tabular-nums font-semibold">{n(c.packages)} <span className="text-xs font-normal text-muted-foreground">pkgs</span></span></li>)}</ul></CardContent></Card>}
      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Exit bills from this entry</CardTitle><CardDescription>Each exit bill, its customer, and the sale and invoice that billed it. Link exits to this entry from the exit bill.</CardDescription></CardHeader>
        <CardContent className="px-0"><DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={cols} rows={allocations} rowKey={({ a }) => a.id} empty={{ title: "Nothing exported from this entry yet" }}
          footer={allocations.length ? { b: "Total", p: n(exported) } : undefined} /></CardContent></Card>
      {canWrite ? <Card><CardHeader><CardTitle>Bill details</CardTitle></CardHeader><CardContent><EntryForm entry={entry} /></CardContent></Card> : <Card><CardContent className="text-sm">You have read-only access.</CardContent></Card>}
      {canWrite && <ActionForm action={deleteEntryAction.bind(null, entry.id) as never} submit="Delete entry" variant="destructive" resetOnSuccess={false} confirm="Delete this entry bill? This is recorded in the audit log but cannot be undone. It is blocked once goods have been exported from it." />}
    </div>
  );
}
