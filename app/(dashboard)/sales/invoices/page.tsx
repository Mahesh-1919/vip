import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate } from "@/lib/dates";
import { D, formatAED } from "@/lib/money";
import { customerOptions, listInvoices, PAGE_SIZES, receivables, stateOf } from "@/services/billing";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Invoices" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const aed = (v: string | number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export default async function InvoicesPage({ searchParams }: PageProps<"/sales/invoices">) {
  await requirePermission("sales:invoice:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), status: one(sp.status), customerId: one(sp.customerId), from: date(one(sp.from)), to: date(one(sp.to)), size: one(sp.size) };
  const [res, customers, recv] = await Promise.all([
    listInvoices({ ...params, customerId: /^[0-9a-f-]{36}$/i.test(params.customerId) ? params.customerId : undefined, from: params.from || undefined, to: params.to || undefined, size: Number(params.size) || 25, page: Number(one(sp.page)) || 1 }),
    customerOptions(), receivables(),
  ]);
  const keep = { ...params, size: String(res.size) };
  const qs = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== "size") as [string, string][]).toString();
  const cols: Column<(typeof res.rows)[number]>[] = [
    { key: "n", header: "Invoice", cell: ({ inv }) => <Link href={`/sales/invoices/${inv.id}`} className="font-mono text-xs text-primary hover:underline">{inv.number}</Link> },
    { key: "d", header: "Date", className: "whitespace-nowrap", cell: ({ inv }) => formatSheetDate(inv.issueDate) },
    { key: "c", header: "Customer", cell: (r) => <>{r.customer}<div className="text-xs text-muted-foreground">{r.saleRef}</div></> },
    { key: "due", header: "Due", className: "whitespace-nowrap", cell: ({ inv }) => formatSheetDate(inv.dueDate) },
    { key: "t", header: "Total", align: "right", cell: ({ inv }) => aed(inv.total) },
    { key: "p", header: "Paid", align: "right", cell: ({ inv }) => aed(inv.paidAmount) },
    { key: "o", header: "Outstanding", align: "right", cell: ({ inv }) => <b>{aed(D(inv.total).minus(inv.paidAmount).toFixed(2))}</b> },
    { key: "s", header: "Status", cell: ({ inv }) => <StatusBadge status={stateOf(inv)} /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Invoices" description={`Number of records: ${res.total}. Tax invoices are created from a sale.`} actions={<a href={`/api/sales/export?sheet=invoices&${qs}`} className={buttonVariants({ variant: "outline" })}><Download size={16} />CSV</a>} />
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Outstanding (AED)" value={formatAED(recv.outstanding.toFixed(2))} /><StatCard label="Overdue (AED)" value={formatAED(recv.overdue.toFixed(2))} tone={recv.overdue.gt(0) ? "danger" : undefined} href="/sales/invoices?status=overdue" /><StatCard label="Customers owing" value={recv.rows.length} /></div>
      <FilterBar>
        <label className="flex items-center gap-2 text-sm">Show <NativeSelect name="size" defaultValue={String(res.size)} wrapperClassName="w-24">{PAGE_SIZES.map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}</NativeSelect> entries</label>
        <Input name="q" defaultValue={params.q} placeholder="Search number or customer" className="w-60" />
        <NativeSelect name="status" defaultValue={params.status} wrapperClassName="w-36"><NativeSelectOption value="">All statuses</NativeSelectOption>{["unpaid", "partial", "paid", "overdue"].map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="customerId" defaultValue={params.customerId} wrapperClassName="w-52"><NativeSelectOption value="">All customers</NativeSelectOption>{customers.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect>
        <Input type="date" name="from" defaultValue={params.from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-40" />
        <Button variant="outline" type="submit">Apply</Button>
      </FilterBar>
      <DataTable columns={cols} rows={res.rows} rowKey={({ inv }) => inv.id} empty={{ title: "No invoices", hint: "Open a sale and choose Create invoice." }} footer={{ n: "Total", t: aed(res.totals.amount), p: aed(res.totals.paid), o: aed(D(res.totals.amount).minus(res.totals.paid).toFixed(2)) }} />
      <Pagination page={res.page} pages={res.pages} total={res.total} basePath="/sales/invoices" params={keep} />
    </div>
  );
}
