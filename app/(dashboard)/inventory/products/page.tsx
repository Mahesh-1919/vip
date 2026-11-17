import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatQty } from "@/lib/format";
import { formatAED } from "@/lib/money";
import { listCategories, listProducts } from "@/services/inventory/stock";
import { Pagination, qs } from "@/components/pagination";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Products" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProductsPage({ searchParams }: PageProps<"/inventory/products">) {
  const user = await requirePermission("inventory:product:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), category: one(sp.category), status: one(sp.status), sort: one(sp.sort), dir: one(sp.dir) };
  const [{ rows, total, page, pages }, cats] = await Promise.all([listProducts({ ...params, page: Number(one(sp.page)) || 1 }), listCategories()]);
  const sortHref = (key: string, dir: "asc" | "desc") => `/inventory/products${qs({ ...params, sort: key, dir, page: 1 })}`;
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "sku", header: "SKU", sortKey: "sku", cell: (r) => <Link className="font-mono text-xs text-primary hover:underline" href={`/inventory/products/${r.p.id}`}>{r.p.sku}</Link> },
    { key: "name", header: "Name", sortKey: "name", cell: (r) => r.p.name },
    { key: "cat", header: "Category", cell: (r) => <span className="text-muted-foreground">{r.category ?? "—"}</span> },
    { key: "trk", header: "Tracking", cell: (r) => <span className="capitalize text-muted-foreground">{r.p.tracking}</span> },
    { key: "oh", header: "On hand", align: "right", cell: (r) => {
      const low = Number(r.p.reorderLevel) > 0 && Number(r.onHand) <= Number(r.p.reorderLevel);
      return <>{formatQty(r.onHand)} <span className="text-muted-foreground">{r.uom}</span> {low && <Badge variant="danger" className="ml-1">Low</Badge>}</>;
    } },
    { key: "cost", header: "Avg cost", align: "right", cell: (r) => formatAED(r.p.avgCost) },
    { key: "val", header: "Value", align: "right", cell: (r) => formatAED(Number(r.onHand) * Number(r.p.avgCost)) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Products" description="The product master. Stock levels update automatically from inward, outward and adjustments."
        actions={user.permissions.has("inventory:product:write") && <Link href="/inventory/products/new" className={buttonVariants()}><Plus size={16} />Add product</Link>} />
      <FilterBar>
        <Input name="q" defaultValue={params.q} placeholder="Search SKU, name, barcode" className="w-64" />
        <NativeSelect name="category" defaultValue={params.category}><NativeSelectOption value="">All categories</NativeSelectOption>{cats.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="status" defaultValue={params.status}><NativeSelectOption value="">Active</NativeSelectOption><NativeSelectOption value="inactive">Inactive</NativeSelectOption></NativeSelect>
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.p.id} sort={{ key: params.sort, dir: params.dir, href: sortHref }} empty={{ title: "No products found", hint: "Try different filters, or add your first product." }} />
      <Pagination page={page} pages={pages} total={total} basePath="/inventory/products" params={params} />
    </div>
  );
}
