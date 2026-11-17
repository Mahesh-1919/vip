import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { CURRENCIES } from "@/validators/containers";
import { customerOptions } from "@/services/inventory/containers";
import { containerOptionsForSales } from "@/services/sales/sales";
import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createSaleAction } from "../actions";

export const metadata: Metadata = { title: "New sale" };

export default async function NewSalePage() {
  await requirePermission("sales:sale:write");
  const [customers, containers] = await Promise.all([customerOptions(), containerOptionsForSales()]);
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <PageHeader title="New sale" back={{ href: "/sales", label: "Sales" }} description="Create the sale, then add lines (or import the items of an export container) on the next page." />
      <Card><CardContent>
        <ActionForm action={createSaleAction} submit="Create sale" resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2">
          <SelectField name="customerId" label="Customer" required placeholder="Choose…" options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
          <TextField name="saleDate" label="Sale date" type="date" required defaultValue={todayISO()} />
          <SelectField className="sm:col-span-2" name="containerId" label="Container (optional)" placeholder="No container: goods only" hint="Linking a container feeds its profit & loss. Match the currency and rate below to the container's."
            options={containers.map((c) => ({ value: c.id, label: `${c.containerNo} · ${c.ref} · ${c.direction === "inward" ? "import" : "export"} · ${c.currency}` }))} />
          <SelectField name="currency" label="Currency" defaultValue="AED" options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          <TextField name="exchangeRate" label="Exchange rate (AED per 1 unit)" inputMode="decimal" defaultValue="1" hint="AED = 1. USD is pegged at about 3.6725." />
          <TextareaField className="sm:col-span-2" name="notes" label="Notes" rows={2} maxLength={500} />
        </ActionForm>
      </CardContent></Card>
    </div>
  );
}
