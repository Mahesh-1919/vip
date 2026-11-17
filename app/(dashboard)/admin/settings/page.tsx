import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { getCompany } from "@/services/company";
import { ActionForm } from "@/components/action-form";
import { TextField, TextareaField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { saveCompany } from "./actions";

export const metadata: Metadata = { title: "Company settings" };

export default async function CompanySettingsPage() {
  const user = await requirePermission("admin:settings:read");
  const c = await getCompany();
  const canWrite = user.permissions.has("admin:settings:write");
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <PageHeader title="Company settings" description="Printed on tax invoices and payslips. A valid TRN is required before any tax invoice can be issued." />
      <Card><CardContent>
        <fieldset disabled={!canWrite}>
          <ActionForm action={saveCompany} submit="Save" resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2">
            <TextField className="sm:col-span-2" name="name" label="Legal name" required defaultValue={c.name} />
            <TextField className="sm:col-span-2" name="address" label="Address" required defaultValue={c.address} />
            <TextField name="trn" label="Tax Registration Number (TRN)" defaultValue={c.trn ?? ""} inputMode="numeric" maxLength={17} hint="15 digits, issued by the UAE Federal Tax Authority." />
            <TextField name="phone" label="Phone" defaultValue={c.phone ?? ""} />
            <TextField name="email" label="Email" type="email" defaultValue={c.email ?? ""} />
            <TextField name="bankName" label="Bank (for payment instructions)" defaultValue={c.bankName ?? ""} />
            <TextField className="sm:col-span-2" name="iban" label="IBAN" defaultValue={c.iban ?? ""} />
            <TextareaField className="sm:col-span-2" name="invoiceTerms" label="Invoice terms / footer" defaultValue={c.invoiceTerms ?? ""} rows={2} placeholder="Payment due within the credit period. Goods remain our property until paid in full." />
          </ActionForm>
        </fieldset>
      </CardContent></Card>
    </div>
  );
}
