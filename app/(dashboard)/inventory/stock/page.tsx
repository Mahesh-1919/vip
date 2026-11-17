import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { formatAED } from "@/lib/money";
import { listCategories, listProducts, listWarehouses, stockBreakdown, stockSummary } from "@/services/inventory/stock";
import { Pagination } from "@/components/pagination";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StockTabs } from "./_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/stat-card";

export const metadata: Metadata = { title: "Stock" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function StockPage({ searchParams }: PageProps<"/inventory/stock">) {
  const user = await requirePermission("inventory:stock:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), category: one(sp.category), warehouse: one(sp.warehouse), low: one(sp.low) };
  const [{ rows, total, page, pages }, cats, whs, summary] = await Promise.all([
    listProducts({ ...params, low: params.low === "1", page: Number(one(sp.page)) || 1 }), listCategories(), listWarehouses(), stockSummary(),
  ]);
  const detail = await stockBreakdown(rows.map((r) => r.p.id));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Stock" description="Live quantities by product, warehouse and batch. Stock can never go below zero." />
      <StockTabs active="overview" canAdjust={user.permissions.has("inventory:stock:adjust")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Stock value (weighted avg cost)" value={<>{formatAED(summary.value)}</>} />
        <StatCard label="Products in stock" value={<>{summary.skus}</>} />
        <StatCard label="Low-stock alerts" value={summary.low} tone={summary.low ? "danger" : undefined} href="/inventory/stock?low=1" />
      </div>
      <form className="flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={params.q} placeholder="Search SKU or name" className="w-56" />
        <NativeSelect name="warehouse" defaultValue={params.warehouse}><NativeSelectOption value="">All warehouses</NativeSelectOption>{whs.map((w) => <NativeSelectOption key={w.id} value={w.id}>{w.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="category" defaultValue={params.category}><NativeSelectOption value="">All categories</NativeSelectOption>{cats.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect>
        <Label className="flex items-center gap-1.5 text-sm"><Checkbox name="low" value="1" defaultChecked={params.low === "1"} /> Low stock only</Label>
        <Button variant="outline" type="submit">Filter</Button>
      </form>
      <Card className="gap-0 overflow-hidden py-0"><CardContent className="px-0">
        <Table className="w-full text-sm">
          <TableHeader className="text-left text-muted-foreground border-b border-border"><TableRow><TableHead className="p-3">Product</TableHead><TableHead className="p-3">Where</TableHead><TableHead className="p-3 text-right">On hand</TableHead><TableHead className="p-3 text-right">Reorder at</TableHead><TableHead className="p-3 text-right">Value</TableHead><TableHead className="p-3">Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => {
              const low = Number(r.p.reorderLevel) > 0 && Number(r.onHand) <= Number(r.p.reorderLevel);
              const lines = detail.filter((d) => d.productId === r.p.id);
              const short = r.p.tracking === "serial";
              return (
                <TableRow key={r.p.id} className="border-b border-border last:border-0 align-top">
                  <TableCell className="p-3"><Link className="text-primary hover:underline" href={`/inventory/products/${r.p.id}`}>{r.p.name}</Link><div className="font-mono text-xs text-muted-foreground">{r.p.sku}</div></TableCell>
                  <TableCell className="p-3 text-xs text-muted-foreground">
                    {short ? [...new Set(lines.map((l) => l.warehouse))].map((w) => <div key={w}>{w}: {lines.filter((l) => l.warehouse === w).length} serials</div>)
                      : lines.map((l, i) => <div key={i}>{l.warehouse}{l.lotNo ? ` · ${l.lotNo}` : ""}{l.expiry ? ` (exp ${formatDate(l.expiry)})` : ""}: {formatQty(l.qty)}</div>)}
                    {!lines.length && "—"}
                  </TableCell>
                  <TableCell className="p-3 text-right font-medium">{formatQty(r.onHand)} <span className="font-normal text-muted-foreground">{r.uom}</span></TableCell>
                  <TableCell className="p-3 text-right text-muted-foreground">{formatQty(r.p.reorderLevel)}</TableCell>
                  <TableCell className="p-3 text-right">{formatAED(Number(r.onHand) * Number(r.p.avgCost))}</TableCell>
                  <TableCell className="p-3">{low ? <Badge variant="danger">Low stock</Badge> : Number(r.onHand) === 0 ? <Badge variant="secondary">Out of stock</Badge> : <Badge variant="success">OK</Badge>}</TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <TableRow><TableCell colSpan={6}><EmptyState title="No stock matches" hint="Adjust the filters, or add opening stock from the Add / adjust tab." /></TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
      <Pagination page={page} pages={pages} total={total} basePath="/inventory/stock" params={params} />
    </div>
  );
}
