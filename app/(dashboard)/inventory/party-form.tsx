import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/form-field";
import type { ActionState } from "@/lib/action-state";
import { saveParty } from "./parties";

export type Party = {
  id: string; code: string; name: string; contactName: string | null; email: string | null; phone: string | null; address: string | null;
  country: string | null; taxId: string | null; version: number; paymentTermsDays?: number; creditDays?: number; creditLimit?: string;
};

/** One form for suppliers and customers (customers add credit terms; suppliers add payment terms). */
export function PartyForm({ kind, party }: { kind: "supplier" | "customer"; party?: Party }) {
  const action = saveParty.bind(null, kind, party?.id ?? null) as (s: ActionState, f: FormData) => Promise<ActionState>;
  return (
    <ActionForm action={action} submit={party ? "Save changes" : `Create ${kind}`} resetOnSuccess={!party} className="grid gap-4 sm:grid-cols-2">
      {party && <input type="hidden" name="version" value={party.version} />}
      <TextField name="code" label="Code" required defaultValue={party?.code} placeholder={kind === "supplier" ? "SUP-001" : "CUS-001"} maxLength={16} />
      <TextField name="name" label="Name" required defaultValue={party?.name} maxLength={150} />
      <TextField name="contactName" label="Contact person" defaultValue={party?.contactName ?? ""} />
      <TextField name="email" label="Email" type="email" defaultValue={party?.email ?? ""} />
      <TextField name="phone" label="Phone" defaultValue={party?.phone ?? ""} />
      <TextField name="country" label="Country (ISO code)" defaultValue={party?.country ?? ""} maxLength={2} placeholder="AE" />
      <TextField name="taxId" label={kind === "customer" ? "TRN / tax ID" : "Tax ID"} defaultValue={party?.taxId ?? ""} hint={kind === "customer" ? "UAE TRN is 15 digits and is printed on tax invoices." : undefined} />
      {kind === "supplier"
        ? <TextField name="paymentTermsDays" label="Payment terms (days)" type="number" min={0} max={365} defaultValue={party?.paymentTermsDays ?? 30} />
        : <>
            <TextField name="creditDays" label="Credit terms (days)" type="number" min={0} max={365} defaultValue={party?.creditDays ?? 30} />
            <TextField name="creditLimit" label="Credit limit (AED)" inputMode="decimal" defaultValue={party?.creditLimit ?? "0"} />
          </>}
      <TextField className="sm:col-span-2" name="address" label="Address" defaultValue={party?.address ?? ""} maxLength={300} />
    </ActionForm>
  );
}
