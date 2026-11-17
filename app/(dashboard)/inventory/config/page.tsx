import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { listCategories, listUoms, listWarehouses } from "@/services/inventory/stock";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addCategory, addUom, addWarehouse, setDefaultWarehouse, toggleWarehouse } from "./actions";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";

export const metadata: Metadata = { title: "Inventory settings" };

export default async function InventoryConfigPage() {
  const user = await requirePermission("inventory:product:read");
  const canWrite = user.permissions.has("inventory:product:write");
  const [whs, cats, uoms] = await Promise.all([listWarehouses(), listCategories(), listUoms()]);
  return (
    <div className="max-w-4xl flex flex-col gap-6">
      <PageHeader title="Inventory settings" description="Warehouses, product categories and units of measure." />
      <Card>
        <CardHeader><CardTitle>Warehouses</CardTitle><CardDescription>Stock is tracked per warehouse. Deactivating a warehouse stops new stock being received into it.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y divide-border text-sm">
            {whs.map((w) => (
              <li key={w.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span className={w.isActive ? "" : "text-muted-foreground line-through"}><b>{w.name}</b> <span className="font-mono text-xs text-muted-foreground">{w.code}</span> {w.isDefault && <Badge variant="info">Default</Badge>}{w.address && <span className="block text-xs text-muted-foreground">{w.address}</span>}</span>
                {canWrite && <div className="flex gap-2">
                  {!w.isDefault && <form action={setDefaultWarehouse}><input type="hidden" name="id" value={w.id} /><Button size="sm" variant="outline" type="submit">Make default</Button></form>}
                  {!w.isDefault && <form action={toggleWarehouse}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="active" value={String(!w.isActive)} /><Button size="sm" variant="ghost" type="submit">{w.isActive ? "Disable" : "Enable"}</Button></form>}
                </div>}
              </li>
            ))}
          </ul>
          {canWrite && (
            <ActionForm action={addWarehouse} submit="Add warehouse" className="grid gap-3 sm:grid-cols-3 items-end">
              <div className="flex flex-col gap-1.5"><Label htmlFor="wc">Code</Label><Input id="wc" name="code" required placeholder="DIP-1" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="wn">Name</Label><Input id="wn" name="name" required /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="wa">Address</Label><Input id="wa" name="address" /></div>
            </ActionForm>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Categories</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">{cats.map((c) => <Badge variant="secondary" key={c.id}>{c.name}</Badge>)}</div>
            {canWrite && <ActionForm action={addCategory} submit="Add" className="flex items-end gap-3"><div className="flex flex-col gap-1.5"><Label htmlFor="cn">Name</Label><Input id="cn" name="name" required /></div></ActionForm>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Units of measure</CardTitle><CardDescription>Whole-number units (pieces, boxes) reject fractions.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">{uoms.map((u) => <Badge variant="secondary" key={u.id} title={u.allowDecimal ? "Decimals allowed" : "Whole numbers only"}>{u.code}{u.allowDecimal ? " ·0.0" : ""}</Badge>)}</div>
            {canWrite && (
              <ActionForm action={addUom} submit="Add unit" className="grid gap-3 sm:grid-cols-2 items-end">
                <div className="flex flex-col gap-1.5"><Label htmlFor="uc">Code</Label><Input id="uc" name="code" required placeholder="BAG" /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="un">Name</Label><Input id="un" name="name" required /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="uk">Kind</Label><NativeSelect id="uk" name="kind"><NativeSelectOption value="count">Count</NativeSelectOption><NativeSelectOption value="pack">Pack</NativeSelectOption><NativeSelectOption value="weight">Weight</NativeSelectOption><NativeSelectOption value="volume">Volume</NativeSelectOption><NativeSelectOption value="length">Length</NativeSelectOption></NativeSelect></div>
                <Label className="flex items-center gap-2 text-sm pb-2"><Checkbox name="allowDecimal" /> Allow decimals</Label>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
