import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/form-field";
import type { ActionState } from "@/lib/action-state";
import type { exitBills } from "@/db/schema";
import { BILL_TYPES, CERT_STATUSES, REFUND_STATUSES } from "@/validators/freezone";
import { saveExitAction } from "./actions";

const opts = (a: readonly string[]) => a.map((v) => ({ value: v, label: v }));

export function ExitForm({ exit }: { exit?: typeof exitBills.$inferSelect }) {
  const action = saveExitAction.bind(null, exit?.id ?? null) as (s: ActionState, f: FormData) => Promise<ActionState>;
  return (
    <ActionForm action={action} submit={exit ? "Save changes" : "Add exit bill"} resetOnSuccess={!exit} className="grid gap-4 sm:grid-cols-3">
      {exit && <input type="hidden" name="version" value={exit.version} />}
      <TextField name="exitDate" label="Date" type="date" required defaultValue={exit?.exitDate} />
      <TextField name="boeNo" label="BOE no." required defaultValue={exit?.boeNo} placeholder="1-3-60-1-26-847" />
      <SelectField name="billType" label="Bill type" defaultValue={exit?.billType ?? "EXPORT"} options={opts(BILL_TYPES)} />
      <TextField className="sm:col-span-2" name="importerName" label="Importer name" defaultValue={exit?.importerName ?? ""} />
      <TextField name="refNo" label="Ref no." defaultValue={exit?.refNo ?? ""} />
      <TextField name="portOfLoading" label="Port of loading" defaultValue={exit?.portOfLoading ?? ""} />
      <TextField name="portOfDischarge" label="Port of discharge" defaultValue={exit?.portOfDischarge ?? ""} />
      <TextField name="invoiceNo" label="Invoice no." defaultValue={exit?.invoiceNo ?? ""} />
      <TextField name="valueAed" label="Value (AED)" inputMode="decimal" defaultValue={exit?.valueAed ?? "0"} />
      <TextField name="weightKg" label="Weight (kg)" inputMode="decimal" defaultValue={exit?.weightKg ?? "0"} />
      <TextField name="packages" label="No. of packages" inputMode="numeric" defaultValue={exit?.packages ?? 0} />
      <TextField name="country" label="Country" defaultValue={exit?.country ?? ""} placeholder="CN, TR" />
      <TextField name="truckContainerNo" label="Truck / container no." defaultValue={exit?.truckContainerNo ?? ""} />
      <SelectField name="entryCertStatus" label="T / Entry certificate" defaultValue={exit?.entryCertStatus ?? "Pending"} options={opts(CERT_STATUSES)} />
      <TextField name="chequeDate" label="Cheque date" type="date" defaultValue={exit?.chequeDate ?? ""} />
      <TextField name="chequeAmount" label="Cheque amount" inputMode="decimal" defaultValue={exit?.chequeAmount ?? ""} />
      <SelectField name="refundStatus" label="Refund status" defaultValue={exit?.refundStatus ?? "Pending"} options={opts(REFUND_STATUSES)} />
      <TextField name="shippingLine" label="Shipping" defaultValue={exit?.shippingLine ?? ""} />
      <TextareaField className="sm:col-span-3" name="notes" label="Notes" rows={2} defaultValue={exit?.notes ?? ""} />
    </ActionForm>
  );
}
