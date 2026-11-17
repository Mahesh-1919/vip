import { ActionForm } from "@/components/action-form";
import { CheckboxField, SelectField, TextField, TextareaField } from "@/components/form-field";
import type { ActionState } from "@/lib/action-state";
import { CONTAINER_SIZES, CURRENCIES, INCOTERMS } from "@/validators/containers";
import { saveContainer } from "./actions";

type C = {
  id: string; direction: "inward" | "outward"; containerNo: string; sealNo: string | null; size: string; shippingLine: string | null; vessel: string | null; voyage: string | null;
  billOfLading: string | null; supplierId: string | null; customerId: string | null; incoterm: string | null; originCountry: string | null; loadPort: string | null; dischargePort: string | null;
  warehouseId: string | null; eta: string | null; customsDeclarationNo: string | null; freeZone: boolean; currency: string; exchangeRate: string; notes: string | null; version: number; stockPostedAt: Date | null;
};

export function ContainerForm({ direction, container, parties, warehouses }: {
  direction: "inward" | "outward"; container?: C; parties: { id: string; name: string; code: string }[]; warehouses: { id: string; name: string }[];
}) {
  const inward = direction === "inward";
  const locked = !!container?.stockPostedAt;
  const action = saveContainer.bind(null, container?.id ?? null) as (s: ActionState, f: FormData) => Promise<ActionState>;
  return (
    <ActionForm action={action} submit={container ? "Save changes" : `Create ${direction} container`} resetOnSuccess={!container} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="direction" value={direction} />
      {container && <input type="hidden" name="version" value={container.version} />}
      <TextField name="containerNo" label="Container number" required defaultValue={container?.containerNo} placeholder="CSQU3054383" hint="ISO 6346: 4 letters + 7 digits; the check digit is verified." />
      <SelectField name="size" label="Size / type" defaultValue={container?.size ?? "40HC"} options={CONTAINER_SIZES.map((s) => ({ value: s, label: s }))} />
      <SelectField name="partyId" label={inward ? "Supplier" : "Customer"} required defaultValue={(inward ? container?.supplierId : container?.customerId) ?? undefined}
        options={parties.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))} placeholder="Choose…" />
      <SelectField name="warehouseId" label={inward ? "Receiving warehouse" : "Dispatch warehouse"} defaultValue={container?.warehouseId ?? ""} placeholder="Choose…" options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        hint={locked ? "Locked: stock has been posted." : "Required before receiving / dispatching."} disabled={locked} />
      <TextField name="billOfLading" label="Bill of lading no." defaultValue={container?.billOfLading ?? ""} />
      <TextField name="shippingLine" label="Shipping line" defaultValue={container?.shippingLine ?? ""} />
      <TextField name="vessel" label="Vessel" defaultValue={container?.vessel ?? ""} />
      <TextField name="voyage" label="Voyage" defaultValue={container?.voyage ?? ""} />
      <TextField name="sealNo" label="Seal number" defaultValue={container?.sealNo ?? ""} />
      <SelectField name="incoterm" label="Incoterm" defaultValue={container?.incoterm ?? ""} placeholder="—" options={INCOTERMS.map((t) => ({ value: t, label: t }))} />
      <TextField name="originCountry" label={inward ? "Country of origin" : "Destination country"} defaultValue={container?.originCountry ?? ""} maxLength={2} placeholder={inward ? "IN" : "KE"} hint="2-letter ISO code" />
      <TextField name="eta" label="ETA" type="date" defaultValue={container?.eta ?? ""} />
      <TextField name="loadPort" label={inward ? "Port of loading (origin)" : "Port of loading"} defaultValue={container?.loadPort ?? (inward ? "" : "Jebel Ali")} />
      <TextField name="dischargePort" label={inward ? "Port of discharge" : "Destination port"} defaultValue={container?.dischargePort ?? (inward ? "Jebel Ali" : "")} />
      <TextField name="customsDeclarationNo" label="Customs declaration no." defaultValue={container?.customsDeclarationNo ?? ""} />
      <CheckboxField name="freeZone" label="Free-zone / bonded cargo" defaultChecked={container?.freeZone ?? false} className="self-end pb-2" />
      <SelectField name="currency" label="Currency" defaultValue={container?.currency ?? "AED"} disabled={locked} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
      <TextField name="exchangeRate" label="Exchange rate (AED per 1 unit)" inputMode="decimal" defaultValue={container?.exchangeRate ?? "1"} disabled={locked} hint="AED = 1. USD is pegged at about 3.6725." />
      <TextareaField className="sm:col-span-2" name="notes" label="Notes" defaultValue={container?.notes ?? ""} rows={2} maxLength={500} />
    </ActionForm>
  );
}
