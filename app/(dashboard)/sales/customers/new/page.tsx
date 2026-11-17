import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "New customer" };
export default async function NewCustomerPage() {
  await requirePermission("sales:customer:write");
  return <div className="max-w-3xl flex flex-col gap-5"><PageHeader title="New customer" back={{ href: "/sales/customers", label: "Customers" }} /><Card><CardContent><CustomerForm /></CardContent></Card></div>;
}
