import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { customerOptions } from "@/services/billing";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SaleForm } from "../sale-form";

export const metadata: Metadata = { title: "New sale" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx
export default async function NewSalePage() {
  await requirePermission("sales:sale:write");
  const customers = await customerOptions();
  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <PageHeader title="New sale" back={{ href: "/sales", label: "Sales" }} description="Record what was sold. You can create the tax invoice from the sale afterwards." />
      <Card><CardContent><SaleForm customers={customers} /></CardContent></Card>
    </div>
  );
}
