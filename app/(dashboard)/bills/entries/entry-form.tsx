import { ActionForm } from "@/components/action-form";
import { TextField, TextareaField } from "@/components/form-field";
import type { ActionState } from "@/lib/action-state";
import type { entryBills } from "@/db/schema";
import { saveEntryAction } from "./actions";

export function EntryForm({ entry }: { entry?: typeof entryBills.$inferSelect }) {
  const action = saveEntryAction.bind(null, entry?.id ?? null) as (s: ActionState, f: FormData) => Promise<ActionState>;
  return (
    <ActionForm action={action} submit={entry ? "Save changes" : "Add entry"} resetOnSuccess={!entry} className="grid gap-4 sm:grid-cols-3">
      {entry && <input type="hidden" name="version" value={entry.version} />}
      <TextField name="billDate" label="Bill date" type="date" required defaultValue={entry?.billDate} />
      <TextField name="billNo" label="Bill no." required defaultValue={entry?.billNo} placeholder="1-3-60-8-26-493" />
      <TextField name="agentName" label="Agent name" defaultValue={entry?.agentName ?? ""} />
      <TextField name="transferNo" label="Transfer no." defaultValue={entry?.transferNo ?? ""} />
      <TextField name="arrivalDate" label="Arrival date" type="date" defaultValue={entry?.arrivalDate ?? ""} />
      <TextField name="invoiceNo" label="Invoice no." defaultValue={entry?.invoiceNo ?? ""} />
      <TextField name="portOfLoading" label="Port of loading" defaultValue={entry?.portOfLoading ?? ""} />
      <TextField name="portOfDischarge" label="Port of discharge" defaultValue={entry?.portOfDischarge ?? ""} />
      <TextField name="line" label="Line" defaultValue={entry?.line ?? ""} placeholder="OMAN" />
      <TextField name="valueAed" label="Value (AED)" inputMode="decimal" defaultValue={entry?.valueAed ?? "0"} />
      <TextField name="weightKg" label="Weight (kg)" inputMode="decimal" defaultValue={entry?.weightKg ?? "0"} />
      <TextField name="packages" label="No. of packages" inputMode="numeric" defaultValue={entry?.packages ?? 0} />
      <TextField name="originCountry" label="Stock / origin country" defaultValue={entry?.originCountry ?? ""} placeholder="CN" hint="Country code, e.g. CN, TR, BH." />
      <TextField className="sm:col-span-2" name="marksNumbers" label="Marks & numbers (containers)" defaultValue={entry?.marksNumbers ?? ""} placeholder="HLXU8574630, MSKU1475670" />
      {entry && <TextField className="sm:col-span-3" name="packagesReason" label="Reason for changing the package count" hint="Required only if you change the packages after goods have already been exported from this entry. Recorded in the audit log." maxLength={200} />}
      <TextareaField className="sm:col-span-3" name="notes" label="Notes" rows={2} defaultValue={entry?.notes ?? ""} />
    </ActionForm>
  );
}
