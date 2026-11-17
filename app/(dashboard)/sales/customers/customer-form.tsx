import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/form-field";
import type { ActionState } from "@/lib/action-state";
import type { customers } from "@/db/schema";
import { saveCustomerAction } from "../actions";

export function CustomerForm({ customer }: { customer?: typeof customers.$inferSelect }) {
  const action = saveCustomerAction.bind(null, customer?.id ?? null) as (s: ActionState, f: FormData) => Promise<ActionState>;
  return (
    <ActionForm action={action} submit={customer ? "Save changes" : "Add customer"} resetOnSuccess={!customer} className="grid gap-4 sm:grid-cols-2">
      {customer && <input type="hidden" name="version" value={customer.version} />}
      <TextField className="sm:col-span-2" name="name" label="Name" required defaultValue={customer?.name} />
      <TextField name="contactName" label="Contact person" defaultValue={customer?.contactName ?? ""} />
      <TextField name="phone" label="Phone" defaultValue={customer?.phone ?? ""} />
      <TextField name="email" label="Email" type="email" defaultValue={customer?.email ?? ""} />
      <TextField name="trn" label="TRN" defaultValue={customer?.trn ?? ""} inputMode="numeric" maxLength={17} hint="15 digits. Printed on the tax invoice." />
      <TextField name="creditDays" label="Credit days" type="number" min={0} max={365} defaultValue={customer?.creditDays ?? 30} hint="Sets the invoice due date." />
      <TextField className="sm:col-span-2" name="address" label="Address" defaultValue={customer?.address ?? ""} />
    </ActionForm>
  );
}
