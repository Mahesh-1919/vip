import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { formatAED } from "@/lib/money";
import { listSales } from "@/services/sales/sales";
import { customerOptions } from "@/services/inventory/containers";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Sales" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SalesPage({ searchParams }: PageProps<"/sales">) {
  const user = await requirePermission("sales:sale:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), status: one(sp.status), customerId: one(sp.customerId), from: one(sp.from), to: one(sp.to) };
  const [{ rows, total, page, pages }, customers] = await Promise.all([listSales({ ...params, from: params.from || undefined, to: params.to || undefined, page: Number(one(sp.page)) || 1 }), customerOptions()]);
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "ref", header: "Ref", cell: ({ s }) => <Link href={`/sales/${s.id}`} className="font-mono text-xs text-primary hover:underline">{s.ref}</Link> },
    { key: "date", header: "Date", cell: ({ s }) => formatDate(s.saleDate) },
    { key: "cust", header: "Customer", cell: (r) => r.customer },
    { key: "cont", header: "Container", cell: (r) => r.containerNo ? <span className="font-mono text-xs">{r.containerNo}</span> : <span className="text-muted-foreground">Goods only</span> },
    { key: "tot", header: "Total (AED, incl. VAT)", align: "right", cell: (r) => formatAED(r.totalAed) },
    { key: "bill", header: "Invoiced", align: "right", cell: (r) => Number(r.ordered) ? `${Math.min(100, Math.round((Number(r.billed) / Number(r.ordered)) * 100))}%` : "—", className: "text-muted-foreground" },
    { key: "st", header: "Status", cell: ({ s }) => <StatusBadge status={s.status === "confirmed" ? "active" : "cancelled"} label={s.status} /> },
  ];
  void formatQty;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sales" description="Every sale, linked to a container and/or goods. Invoicing can be done in parts." actions={user.permissions.has("sales:sale:write") && <Link href="/sales/new" className={buttonVariants()}><Plus size={16} />New sale</Link>} />
      <FilterBar>
        <Input name="q" defaultValue={params.q} placeholder="Search ref, customer, container" className="w-64" />
        <NativeSelect name="customerId" defaultValue={params.customerId}><NativeSelectOption value="">All customers</NativeSelectOption>{customers.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="status" defaultValue={params.status}><NativeSelectOption value="">All statuses</NativeSelectOption><NativeSelectOption value="confirmed">Confirmed</NativeSelectOption><NativeSelectOption value="cancelled">Cancelled</NativeSelectOption></NativeSelect>
        <Input type="date" name="from" defaultValue={params.from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-40" />
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.s.id} empty={{ title: "No sales yet", hint: "Create a sale, then invoice it from Inventory → Invoices." }} />
      <Pagination page={page} pages={pages} total={total} basePath="/sales" params={params} />
    </div>
  );
}
