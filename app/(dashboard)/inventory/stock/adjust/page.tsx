import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { formatQty } from "@/lib/format";
import { listWarehouses, packagingOptions, productOptions } from "@/services/inventory/stock";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordStockAction } from "../actions";
import { StockTabs } from "../_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export const metadata: Metadata = { title: "Add / adjust stock" };

export default async function AdjustPage() {
  const user = await requirePermission("inventory:stock:adjust");
  const [products, whs, packs] = await Promise.all([productOptions(), listWarehouses(), packagingOptions()]);
  const active = whs.filter((w) => w.isActive);
  return (
    <div className="max-w-3xl flex flex-col gap-4">
      <PageHeader title="Stock" description="Record opening stock or correct counts. Containers will post inward/outward stock automatically in the next phase." />
      <StockTabs active="adjust" canAdjust={user.permissions.has("inventory:stock:adjust")} />
      <Card className="gap-0 py-0"><CardContent className="p-5">
        <ActionForm action={recordStockAction} submit="Record movement" className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5"><Label htmlFor="kind">Movement</Label>
            <NativeSelect id="kind" name="kind"><NativeSelectOption value="opening">Opening stock (with cost)</NativeSelectOption><NativeSelectOption value="adjustment_in">Adjustment: add (found / correction)</NativeSelectOption><NativeSelectOption value="adjustment_out">Adjustment: remove (damage / loss / correction)</NativeSelectOption></NativeSelect></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="warehouseId">Warehouse</Label><NativeSelect id="warehouseId" name="warehouseId" required>{active.map((w) => <NativeSelectOption key={w.id} value={w.id}>{w.name}</NativeSelectOption>)}</NativeSelect></div>
          <div className="flex flex-col gap-1.5 sm:col-span-2"><Label htmlFor="productId">Product</Label>
            <NativeSelect id="productId" name="productId" required>{products.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.sku} · {p.name} ({p.uom}, {p.tracking})</NativeSelectOption>)}</NativeSelect></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="qty">Quantity</Label><Input id="qty" name="qty" inputMode="decimal" required placeholder="0" /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="packagingId">Entered in</Label>
            <NativeSelect id="packagingId" name="packagingId"><NativeSelectOption value="">Base unit</NativeSelectOption>{packs.map((k) => <NativeSelectOption key={k.id} value={k.id}>{k.sku}: {k.name} (= {formatQty(k.qty)})</NativeSelectOption>)}</NativeSelect>
            <span className="text-xs text-muted-foreground">If you pick a pack, the quantity above is the number of packs.</span></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="unitCost">Unit cost (AED per base unit)</Label><Input id="unitCost" name="unitCost" inputMode="decimal" placeholder="Required for opening stock" />
            <span className="text-xs text-muted-foreground">Updates the weighted-average cost. Leave blank for adjustments.</span></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="note">Note / reason</Label><Input id="note" name="note" maxLength={300} /></div>
          <fieldset className="sm:col-span-2 grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">Batch / serial tracked products only</legend>
            <div className="flex flex-col gap-1.5"><Label htmlFor="lotNo">Batch / lot number</Label><Input id="lotNo" name="lotNo" maxLength={60} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="expiryDate">Expiry date (new batches)</Label><Input id="expiryDate" name="expiryDate" type="date" /></div>
            <div className="flex flex-col gap-1.5 sm:col-span-2"><Label htmlFor="serials">Serial numbers</Label><Textarea id="serials" name="serials" rows={3} className="py-2" placeholder="One per line, or separated by commas" />
              <span className="text-xs text-muted-foreground">Each serial is one unit. The quantity field is ignored for serial products.</span></div>
          </fieldset>
        </ActionForm>
      </CardContent></Card>
    </div>
  );
}
