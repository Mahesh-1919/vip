import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { formatQty } from "@/lib/format";
import { listWarehouses, packagingOptions, productOptions } from "@/services/inventory/stock";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { transferAction } from "../actions";
import { StockTabs } from "../_components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Transfer stock" };

export default async function TransferPage() {
  const user = await requirePermission("inventory:stock:adjust");
  const [products, whs, packs] = await Promise.all([productOptions(), listWarehouses(), packagingOptions()]);
  const active = whs.filter((w) => w.isActive);
  const opts = active.map((w) => <NativeSelectOption key={w.id} value={w.id}>{w.name}</NativeSelectOption>);
  return (
    <div className="max-w-3xl flex flex-col gap-4">
      <PageHeader title="Stock" description="Move stock between warehouses. Cost is carried across unchanged." />
      <StockTabs active="transfer" canAdjust={user.permissions.has("inventory:stock:adjust")} />
      <Card className="gap-0 py-0"><CardContent className="p-5">
        <ActionForm action={transferAction} submit="Transfer" className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2"><Label htmlFor="productId">Product</Label><NativeSelect id="productId" name="productId" required>{products.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.sku} · {p.name} ({p.uom}, {p.tracking})</NativeSelectOption>)}</NativeSelect></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="fromWarehouseId">From</Label><NativeSelect id="fromWarehouseId" name="fromWarehouseId" required>{opts}</NativeSelect></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="toWarehouseId">To</Label><NativeSelect id="toWarehouseId" name="toWarehouseId" required defaultValue={active[1]?.id}>{opts}</NativeSelect></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="qty">Quantity</Label><Input id="qty" name="qty" inputMode="decimal" required /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="packagingId">Entered in</Label><NativeSelect id="packagingId" name="packagingId"><NativeSelectOption value="">Base unit</NativeSelectOption>{packs.map((k) => <NativeSelectOption key={k.id} value={k.id}>{k.sku}: {k.name} (= {formatQty(k.qty)})</NativeSelectOption>)}</NativeSelect></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="lotNo">Batch / serial number</Label><Input id="lotNo" name="lotNo" placeholder="Batch- or serial-tracked products" /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="note">Note</Label><Input id="note" name="note" maxLength={300} /></div>
        </ActionForm>
      </CardContent></Card>
    </div>
  );
}
