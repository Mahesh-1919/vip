import type { Metadata } from "next";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { formatAED } from "@/lib/money";
import { listMoves, listWarehouses, productOptions } from "@/services/inventory/stock";
import { Pagination } from "@/components/pagination";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StockTabs } from "../_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Stock movements" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TYPES = ["opening", "inward", "outward", "adjustment_in", "adjustment_out", "transfer_in", "transfer_out"];

export default async function MovementsPage({ searchParams }: PageProps<"/inventory/stock/movements">) {
  const user = await requirePermission("inventory:stock:read");
  const sp = await searchParams;
  const params = { productId: one(sp.productId), warehouseId: one(sp.warehouseId), type: one(sp.type), from: one(sp.from), to: one(sp.to) };
  const date = (s: string) => (z.iso.date().safeParse(s).success ? s : "");
  const [{ rows, total, page, pages }, products, whs] = await Promise.all([
    listMoves({ productId: z.uuid().safeParse(params.productId).data, warehouseId: z.uuid().safeParse(params.warehouseId).data, type: TYPES.includes(params.type) ? params.type : undefined, from: date(params.from) || undefined, to: date(params.to) || undefined, page: Number(one(sp.page)) || 1 }),
    productOptions(), listWarehouses(),
  ]);
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "date", header: "Date", className: "whitespace-nowrap", cell: ({ m }) => formatDate(m.movedAt) },
    { key: "prod", header: "Product", cell: ({ name, sku }) => <>{name}<div className="font-mono text-xs text-muted-foreground">{sku}</div></> },
    { key: "type", header: "Type", cell: ({ m }) => <span className="capitalize">{m.type.replace(/_/g, " ")}</span> },
    { key: "wh", header: "Warehouse", cell: ({ wh }) => wh },
    { key: "lot", header: "Lot / serial", cell: ({ lotNo }) => <span className="font-mono text-xs">{lotNo ?? "—"}</span> },
    { key: "qty", header: "Qty", align: "right", cell: ({ m }) => <span className={`font-medium ${Number(m.qty) < 0 ? "text-danger" : "text-success"}`}>{Number(m.qty) > 0 ? "+" : ""}{formatQty(m.qty)}</span> },
    { key: "cost", header: "Unit cost", align: "right", cell: ({ m }) => formatAED(m.unitCost) },
    { key: "ref", header: "Reference", cell: ({ m }) => <span className="text-xs text-muted-foreground">{[m.refType !== "manual" ? m.refType : null, m.refId, m.enteredAs, m.note].filter(Boolean).join(" · ")}</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Stock" description="Every change to stock is recorded here and cannot be edited or deleted. Corrections are made with reversing movements." />
      <StockTabs active="movements" canAdjust={user.permissions.has("inventory:stock:adjust")} />
      <FilterBar>
        <NativeSelect name="productId" defaultValue={params.productId}><NativeSelectOption value="">All products</NativeSelectOption>{products.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.sku} · {p.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="warehouseId" defaultValue={params.warehouseId}><NativeSelectOption value="">All warehouses</NativeSelectOption>{whs.map((w) => <NativeSelectOption key={w.id} value={w.id}>{w.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="type" defaultValue={params.type}><NativeSelectOption value="">All types</NativeSelectOption>{TYPES.map((t) => <NativeSelectOption key={t} value={t}>{t.replace(/_/g, " ")}</NativeSelectOption>)}</NativeSelect>
        <Input type="date" name="from" defaultValue={params.from} aria-label="From date" /><Input type="date" name="to" defaultValue={params.to} aria-label="To date" />
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={columns} rows={rows} rowKey={({ m }) => String(m.id)} empty={{ title: "No movements", hint: "Nothing matches these filters." }} />
      <Pagination page={page} pages={pages} total={total} basePath="/inventory/stock/movements" params={params} />
    </div>
  );
}
