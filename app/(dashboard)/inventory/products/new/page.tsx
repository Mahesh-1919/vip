import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { listCategories, listUoms } from "@/services/inventory/stock";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { saveProduct } from "../actions";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  await requirePermission("inventory:product:write");
  const [uoms, categories] = await Promise.all([listUoms(), listCategories()]);
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <PageHeader title="New product" back={{ href: "/inventory/products", label: "Products" }} description="Opening stock is added afterwards from Stock → Adjust." />
      <Card className="gap-0 py-0"><CardContent className="p-5"><ProductForm action={saveProduct.bind(null, null)} uoms={uoms.filter((u) => u.isActive)} categories={categories} submit="Create product" /></CardContent></Card>
    </div>
  );
}
