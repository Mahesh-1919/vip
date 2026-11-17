import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { stockMoves } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { formatAED } from "@/lib/money";
import { getProduct, listCategories, listUoms, listMoves, stockBreakdown } from "@/services/inventory/stock";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addPackaging, removePackaging, saveProduct, setProductActive } from "../actions";
import { ProductForm } from "../product-form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/inventory/products/[id]">) {
  const user = await requirePermission("inventory:product:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await getProduct(id.data);
  if (!data) notFound();
  const { p, uom, onHand, packagings, category } = data;
  const canWrite = user.permissions.has("inventory:product:write");
  const [uoms, cats, breakdown, moves, hasMoves] = await Promise.all([
    listUoms(), listCategories(), stockBreakdown([p.id]), listMoves({ productId: p.id }),
    db.select({ id: stockMoves.id }).from(stockMoves).where(eq(stockMoves.productId, p.id)).limit(1),
  ]);
  const low = Number(p.reorderLevel) > 0 && Number(onHand) <= Number(p.reorderLevel);

  return (
    <div className="max-w-4xl flex flex-col gap-6">
      <PageHeader back={{ href: "/inventory/products", label: "Products" }}
        title={<>{p.name} <span className="font-mono text-base font-normal text-muted-foreground">{p.sku}</span></>}
        description={<>{category ?? "Uncategorised"} · {uom.name} · <span className="capitalize">{p.tracking}</span> tracking{p.hsCode ? ` · HS ${p.hsCode}` : ""}</>}
        actions={<>{low && <Badge variant="danger">Low stock</Badge>}{!p.isActive && <Badge variant="secondary">Inactive</Badge>}</>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="On hand" value={<>{formatQty(onHand)} {uom.code}</>} />
        <StatCard label="Average cost" value={<>{formatAED(p.avgCost)}</>} />
        <StatCard label="Stock value" value={<>{formatAED(Number(onHand) * Number(p.avgCost))}</>} />
      </div>

      <Card><CardHeader><CardTitle>Stock by location</CardTitle><CardDescription>Reorder level {formatQty(p.reorderLevel)} {uom.code}</CardDescription></CardHeader><CardContent className="p-0 overflow-x-auto">
        <Table className="w-full text-sm"><TableHeader className="text-left text-muted-foreground border-y border-border"><TableRow><TableHead className="p-3">Warehouse</TableHead><TableHead className="p-3">{p.tracking === "serial" ? "Serial" : "Batch"}</TableHead><TableHead className="p-3">Expiry</TableHead><TableHead className="p-3 text-right">Qty</TableHead></TableRow></TableHeader>
          <TableBody>
            {breakdown.map((b, i) => <TableRow key={i} className="border-b border-border last:border-0"><TableCell className="p-3">{b.warehouse}</TableCell><TableCell className="p-3 font-mono text-xs">{b.lotNo ?? "—"}</TableCell><TableCell className="p-3">{formatDate(b.expiry)}</TableCell><TableCell className="p-3 text-right">{formatQty(b.qty)}</TableCell></TableRow>)}
            {!breakdown.length && <TableRow><TableCell colSpan={4} className="p-4 text-center text-muted-foreground">No stock on hand.</TableCell></TableRow>}
          </TableBody></Table></CardContent></Card>

      {canWrite && (
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent>
          <ProductForm action={saveProduct.bind(null, p.id)} product={p} uoms={uoms} categories={cats} locked={hasMoves.length > 0} submit="Save changes" />
        </CardContent></Card>
      )}

      <Card><CardHeader><CardTitle>Packagings</CardTitle><CardDescription>Receive and ship in boxes, cartons or pallets: quantities are converted to {uom.code} automatically.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y divide-border text-sm">
            {packagings.map((k) => (
              <li key={k.id} className="py-2 flex items-center justify-between"><span>{k.name} <span className="text-muted-foreground">= {formatQty(k.qty)} {uom.code}</span></span>
                {canWrite && <form action={removePackaging}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="productId" value={p.id} /><Button size="sm" variant="ghost" type="submit">Remove</Button></form>}</li>
            ))}
            {!packagings.length && <li className="py-2 text-muted-foreground">No packagings defined.</li>}
          </ul>
          {canWrite && (
            <ActionForm action={addPackaging} submit="Add packaging" className="grid gap-3 sm:grid-cols-3 items-end">
              <input type="hidden" name="productId" value={p.id} />
              <div className="flex flex-col gap-1.5"><Label htmlFor="pkn">Name</Label><Input id="pkn" name="name" required placeholder="Carton of 12" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="pkq">{uom.code} per pack</Label><Input id="pkq" name="qty" inputMode="decimal" required /></div>
            </ActionForm>
          )}
        </CardContent></Card>

      <Card><CardHeader><CardTitle>Recent movements</CardTitle></CardHeader><CardContent className="p-0 overflow-x-auto">
        <Table className="w-full text-sm"><TableHeader className="text-left text-muted-foreground border-y border-border"><TableRow><TableHead className="p-3">Date</TableHead><TableHead className="p-3">Type</TableHead><TableHead className="p-3">Warehouse</TableHead><TableHead className="p-3">Lot</TableHead><TableHead className="p-3 text-right">Qty</TableHead><TableHead className="p-3">Note</TableHead></TableRow></TableHeader>
          <TableBody>
            {moves.rows.map(({ m, wh, lotNo }) => (
              <TableRow key={m.id} className="border-b border-border last:border-0"><TableCell className="p-3 whitespace-nowrap">{formatDate(m.movedAt)}</TableCell><TableCell className="p-3 capitalize">{m.type.replace(/_/g, " ")}</TableCell><TableCell className="p-3">{wh}</TableCell><TableCell className="p-3 font-mono text-xs">{lotNo ?? "—"}</TableCell>
                <TableCell className={`p-3 text-right font-medium ${Number(m.qty) < 0 ? "text-danger" : "text-success"}`}>{Number(m.qty) > 0 ? "+" : ""}{formatQty(m.qty)}</TableCell><TableCell className="p-3 text-muted-foreground">{m.enteredAs ?? m.note ?? ""}</TableCell></TableRow>
            ))}
            {!moves.rows.length && <TableRow><TableCell colSpan={6} className="p-4 text-center text-muted-foreground">No movements yet.</TableCell></TableRow>}
          </TableBody></Table></CardContent></Card>

      {canWrite && (
        <form action={setProductActive}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={String(!p.isActive)} />
          <Button variant="outline" type="submit">{p.isActive ? "Deactivate product" : "Reactivate product"}</Button></form>
      )}
    </div>
  );
}
