import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatAED, D } from "@/lib/money";
import { customerOptions } from "@/services/inventory/containers";
import { listInvoices, receivables, statusOf } from "@/services/sales/invoicing";
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
const money = (v: string, cur: string) => `${cur} ${new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2 }).format(Number(v))}`;

export default async function InvoicesPage({ searchParams }: PageProps<"/inventory/invoices">) {
  const user = await requirePermission("inventory:invoice:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), status: one(sp.status), customerId: one(sp.customerId), from: one(sp.from), to: one(sp.to) };
  const [{ rows, total, page, pages }, customers, recv] = await Promise.all([
    listInvoices({ ...params, customerId: /^[0-9a-f-]{36}$/i.test(params.customerId) ? params.customerId : undefined, from: params.from || undefined, to: params.to || undefined, page: Number(one(sp.page)) || 1 }),
    customerOptions(), receivables(),
  ]);
  const out = recv.reduce((s, r) => s + Number(r.outstandingAed), 0), over = recv.reduce((s, r) => s + Number(r.overdueAed), 0);
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "n", header: "Number", cell: ({ inv }) => <Link href={`/inventory/invoices/${inv.id}`} className="font-mono text-xs text-primary hover:underline">{inv.number ?? "Draft"}</Link> },
    { key: "d", header: "Date", cell: ({ inv }) => formatDate(inv.issueDate) },
    { key: "c", header: "Customer", cell: (r) => <>{r.customer}<div className="text-xs text-muted-foreground">{r.saleRef}</div></> },
    { key: "due", header: "Due", cell: ({ inv }) => inv.status === "draft" ? "—" : formatDate(inv.dueDate) },
    { key: "t", header: "Total", align: "right", cell: ({ inv }) => money(inv.total, inv.currency) },
    { key: "o", header: "Outstanding", align: "right", cell: ({ inv }) => inv.status === "draft" ? "—" : money(D(inv.total).minus(inv.paidAmount).toFixed(2), inv.currency) },
    { key: "s", header: "Status", cell: ({ inv }) => { const s = statusOf(inv); return <StatusBadge status={s} />; } },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Invoices" description="UAE tax invoices with gap-free numbering. Bill a sale in full or in parts; payments are tracked per invoice."
        actions={user.permissions.has("inventory:invoice:write") && <Link href="/inventory/invoices/new" className={buttonVariants()}><Plus size={16} />New invoice</Link>} />
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Outstanding receivables (AED)" value={formatAED(out)} /><StatCard label="Overdue (AED)" value={formatAED(over)} tone={over > 0 ? "danger" : undefined} href="/inventory/invoices?status=overdue" /><StatCard label="Customers with a balance" value={recv.length} /></div>
      <FilterBar>
        <Input name="q" defaultValue={params.q} placeholder="Search number or customer" className="w-60" />
        <NativeSelect name="status" defaultValue={params.status}><NativeSelectOption value="">All statuses</NativeSelectOption>{["draft", "unpaid", "partial", "paid", "overdue"].map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="customerId" defaultValue={params.customerId}><NativeSelectOption value="">All customers</NativeSelectOption>{customers.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect>
        <Input type="date" name="from" defaultValue={params.from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-40" />
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={columns} rows={rows} rowKey={({ inv }) => inv.id} empty={{ title: "No invoices", hint: "Create one from a sale." }} />
      <Pagination page={page} pages={pages} total={total} basePath="/inventory/invoices" params={params} />
    </div>
  );
}
