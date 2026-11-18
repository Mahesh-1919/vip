import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Customers" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PAGE = 25;

export default async function CustomersPage({ searchParams }: PageProps<"/sales/customers">) {
  const user = await requirePermission("sales:customer:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), status: one(sp.status) };
  const like = `%${params.q.replace(/[%_\\]/g, "\\$&")}%`;
  const w = and(eq(customers.isActive, params.status !== "inactive"), params.q ? or(ilike(customers.name, like), ilike(customers.trn, like)) : undefined);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(customers).where(w).orderBy(asc(customers.name)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: count() }).from(customers).where(w),
  ]);
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "n", header: "Name", cell: (r) => <Link href={`/sales/customers/${r.id}`} className="font-medium text-primary hover:underline">{r.name}</Link> },
    { key: "c", header: "Contact", cell: (r) => <>{r.contactName ?? "—"}<div className="text-xs text-muted-foreground">{r.phone}</div></> },
    { key: "t", header: "TRN", cell: (r) => <span className="font-mono text-[0.8125rem]">{r.trn ?? "—"}</span> },
    { key: "d", header: "Credit days", align: "right", cell: (r) => r.creditDays },
    { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.isActive ? "active" : "inactive"} /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Customers" description="Who you bill. Credit days set the invoice due date." actions={user.permissions.has("sales:customer:write") && <Link href="/sales/customers/new" className={buttonVariants()}><Plus size={16} />Add customer</Link>} />
      <FilterBar>
        <Input name="q" defaultValue={params.q} placeholder="Search name or TRN" className="w-64" />
        <NativeSelect name="status" defaultValue={params.status} wrapperClassName="w-36"><NativeSelectOption value="">Active</NativeSelectOption><NativeSelectOption value="inactive">Inactive</NativeSelectOption></NativeSelect>
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} empty={{ title: "No customers yet" }} />
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / PAGE))} total={total} basePath="/sales/customers" params={params} />
    </div>
  );
}
