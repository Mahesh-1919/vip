import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate } from "@/lib/dates";
import { customerOptions, listSales, PAGE_SIZES } from "@/services/billing";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Sales" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const aed = (v: string | number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export default async function SalesPage({ searchParams }: PageProps<"/sales">) {
  const user = await requirePermission("sales:sale:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), customerId: one(sp.customerId), invoiced: one(sp.invoiced), from: date(one(sp.from)), to: date(one(sp.to)), size: one(sp.size) };
  const [res, customers] = await Promise.all([
    listSales({ ...params, customerId: /^[0-9a-f-]{36}$/i.test(params.customerId) ? params.customerId : undefined, from: params.from || undefined, to: params.to || undefined, size: Number(params.size) || 25, page: Number(one(sp.page)) || 1 }),
    customerOptions(),
  ]);
  const keep = { ...params, size: String(res.size) };
  const qs = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== "size") as [string, string][]).toString();
  const cols: Column<(typeof res.rows)[number]>[] = [
    { key: "ref", header: "Ref", cell: ({ s }) => <Link href={`/sales/${s.id}`} className="font-mono text-xs text-primary hover:underline">{s.ref}</Link> },
    { key: "d", header: "Date", className: "whitespace-nowrap", cell: ({ s }) => formatSheetDate(s.saleDate) },
    { key: "c", header: "Customer", cell: (r) => r.customer },
    { key: "b", header: "Bill ref", className: "font-mono text-xs", cell: ({ s }) => s.billRef },
    { key: "n", header: "Net (AED)", align: "right", cell: (r) => aed(r.net) },
    { key: "t", header: "Total incl. VAT", align: "right", cell: (r) => aed(r.total) },
    { key: "i", header: "Invoice", cell: (r) => r.invoiceId ? <Link href={`/sales/invoices/${r.invoiceId}`} className="font-mono text-xs text-primary hover:underline">{r.invoiceNo}</Link> : <Badge variant="warning">Not invoiced</Badge> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sales" description={`Number of records: ${res.total}`} actions={<>
        <a href={`/api/sales/export?sheet=sales&${qs}`} className={buttonVariants({ variant: "outline" })}><Download size={16} />CSV</a>
        {user.permissions.has("sales:sale:write") && <Link href="/sales/new" className={buttonVariants()}><Plus size={16} />New sale</Link>}
      </>} />
      <FilterBar>
        <label className="flex items-center gap-2 text-sm">Show <NativeSelect name="size" defaultValue={String(res.size)} wrapperClassName="w-24">{PAGE_SIZES.map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}</NativeSelect> entries</label>
        <Input name="q" defaultValue={params.q} placeholder="Search ref, customer, bill…" className="w-64" />
        <NativeSelect name="customerId" defaultValue={params.customerId} wrapperClassName="w-52"><NativeSelectOption value="">All customers</NativeSelectOption>{customers.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="invoiced" defaultValue={params.invoiced} wrapperClassName="w-40"><NativeSelectOption value="">Any invoicing</NativeSelectOption><NativeSelectOption value="no">Not invoiced</NativeSelectOption><NativeSelectOption value="yes">Invoiced</NativeSelectOption></NativeSelect>
        <Input type="date" name="from" defaultValue={params.from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-40" />
        <Button variant="outline" type="submit">Apply</Button>
      </FilterBar>
      <DataTable columns={cols} rows={res.rows} rowKey={({ s }) => s.id} empty={{ title: "No sales yet", hint: "Record the first sale." }} footer={{ ref: "Total", n: aed(res.totals.net), t: aed(res.totals.gross) }} />
      <Pagination page={res.page} pages={res.pages} total={res.total} basePath="/sales" params={keep} />
    </div>
  );
}
