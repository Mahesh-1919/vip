import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ActionState } from "@/lib/action-state";
import { todayISO } from "@/lib/dates";
import { MAX_LINES } from "@/validators/sales";
import { saveSaleAction } from "./actions";

type Line = { description: string; qty: string; unitPrice: string; vatRate: string };

export function SaleForm({ sale, lines, customers }: {
  sale?: { id: string; customerId: string; saleDate: string; billRef: string | null; notes: string | null; version: number };
  lines?: Line[]; customers: { id: string; name: string }[];
}) {
  const action = saveSaleAction.bind(null, sale?.id ?? null) as (s: ActionState, f: FormData) => Promise<ActionState>;
  const shown = Math.max(lines?.length ?? 0, 4);
  return (
    <ActionForm action={action} submit={sale ? "Save sale" : "Create sale"} resetOnSuccess={!sale} className="flex flex-col gap-5">
      {sale && <input type="hidden" name="version" value={sale.version} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField name="customerId" label="Customer" required placeholder="Choose…" defaultValue={sale?.customerId} options={customers.map((c) => ({ value: c.id, label: c.name }))} />
        <TextField name="saleDate" label="Sale date" type="date" required defaultValue={sale?.saleDate ?? todayISO()} />
        <TextField name="billRef" label="Bill reference" defaultValue={sale?.billRef ?? ""} hint="Entry or exit bill number this relates to (optional)." />
      </div>
      <div>
        <div className="mb-1 hidden grid-cols-[1fr_6rem_8rem_7rem] gap-2 text-sm font-medium sm:grid"><span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit price (AED)</span><span>VAT</span></div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: Math.min(MAX_LINES, shown + (sale ? 1 : 0)) }).map((_, n) => {
            const l = lines?.[n];
            return (
              <div key={n} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_8rem_7rem]">
                <Input name={`desc:${n}`} defaultValue={l?.description ?? ""} placeholder={n === 0 ? "e.g. Clearing & handling charges" : "Description"} className="col-span-2 sm:col-span-1" aria-label={`Line ${n + 1} description`} />
                <Input name={`qty:${n}`} defaultValue={l ? Number(l.qty) : ""} inputMode="decimal" className="text-right" placeholder="Qty" aria-label={`Line ${n + 1} quantity`} />
                <Input name={`price:${n}`} defaultValue={l ? l.unitPrice : ""} inputMode="decimal" className="text-right" placeholder="0.00" aria-label={`Line ${n + 1} unit price`} />
                <NativeSelect name={`vat:${n}`} defaultValue={l ? String(Number(l.vatRate)) : "5"} aria-label={`Line ${n + 1} VAT`}><NativeSelectOption value="5">5%</NativeSelectOption><NativeSelectOption value="0">0%</NativeSelectOption></NativeSelect>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Leave unused rows blank. Use 0% VAT for zero-rated supplies such as exports.</p>
      </div>
      <TextareaField name="notes" label="Notes" rows={2} defaultValue={sale?.notes ?? ""} />
    </ActionForm>
  );
}
