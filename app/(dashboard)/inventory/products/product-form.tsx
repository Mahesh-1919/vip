import { ActionForm } from "@/components/action-form";
import { SelectField, TextField } from "@/components/form-field";
import type { ActionState } from "@/lib/action-state";

type Opt = { id: string; name: string };
export function ProductForm({ action, product, uoms, categories, locked, submit }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  product?: { sku: string; name: string; description: string | null; categoryId: string | null; baseUomId: string; tracking: string; hsCode: string | null; barcode: string | null; reorderLevel: string; version: number };
  uoms: { id: string; code: string; name: string }[]; categories: Opt[]; locked?: boolean; submit: string;
}) {
  const f = (name: string, label: string, def?: string | null, extra: Partial<React.ComponentProps<typeof TextField>> = {}, hint?: string) => (
    <TextField name={name} label={label} defaultValue={def ?? ""} hint={hint} {...extra} />
  );
  return (
    <ActionForm action={action} submit={submit} resetOnSuccess={!product} className="grid gap-4 sm:grid-cols-2">
      {product && <input type="hidden" name="version" value={product.version} />}
      {f("sku", "SKU *", product?.sku, { required: true, placeholder: "RICE-BAS", maxLength: 40 })}
      {f("name", "Name *", product?.name, { required: true, maxLength: 150 })}
      <SelectField name="categoryId" label="Category" defaultValue={product?.categoryId ?? ""} options={[{ value: "", label: "—" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
      <SelectField name="baseUomId" label="Unit of measure" required defaultValue={product?.baseUomId} options={uoms.map((u) => ({ value: u.id, label: `${u.code} · ${u.name}` }))} hint="Stock is held in this unit. Add boxes, cartons or pallets as packagings after creating." />
      <SelectField name="tracking" label="Tracking" defaultValue={product?.tracking ?? "quantity"} options={[{ value: "quantity", label: "Quantity only" }, { value: "batch", label: "By batch / lot (with expiry)" }, { value: "serial", label: "By serial number" }]} hint={locked ? "Cannot change once stock has moved." : undefined} />
      {f("reorderLevel", "Reorder level", product?.reorderLevel ?? "0", { inputMode: "decimal" }, "Low-stock alert when on-hand is at or below this.")}
      {f("hsCode", "HS code", product?.hsCode, { maxLength: 20, placeholder: "1006.30" }, "Customs tariff code, used on import/export documents.")}
      {f("barcode", "Barcode", product?.barcode, { maxLength: 40 })}
      <TextField className="sm:col-span-2" name="description" label="Description" defaultValue={product?.description ?? ""} maxLength={500} />
    </ActionForm>
  );
}
