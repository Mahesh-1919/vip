import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { getCompany } from "@/services/company";
import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/form-field";
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
      <PageHeader title="Company settings" description="Printed in the header of payslips." />
      <Card><CardContent>
        <fieldset disabled={!canWrite}>
          <ActionForm action={saveCompany} submit="Save" resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2">
            <TextField className="sm:col-span-2" name="name" label="Legal name" required defaultValue={c.name} />
            <TextField className="sm:col-span-2" name="address" label="Address" required defaultValue={c.address} />
            <TextField name="phone" label="Phone" defaultValue={c.phone ?? ""} />
            <TextField name="email" label="Email" type="email" defaultValue={c.email ?? ""} />
          </ActionForm>
        </fieldset>
      </CardContent></Card>
    </div>
  );
}
