import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { listWarehouses } from "@/services/inventory/stock";
import { customerOptions, supplierOptions } from "@/services/inventory/containers";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ContainerForm } from "../container-form";

export const metadata: Metadata = { title: "New container" };

export default async function NewContainerPage({ searchParams }: PageProps<"/inventory/containers/new">) {
  await requirePermission("inventory:container:write");
  const sp = await searchParams;
  const direction = (Array.isArray(sp.direction) ? sp.direction[0] : sp.direction) === "outward" ? "outward" : "inward";
  const [parties, whs] = await Promise.all([direction === "inward" ? supplierOptions() : customerOptions(), listWarehouses()]);
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <PageHeader title={direction === "inward" ? "New inward (import) container" : "New outward (export) container"} back={{ href: "/inventory/containers", label: "Containers" }}
        description="Create the container first, then add items and costs on the next page." />
      <Card><CardContent><ContainerForm direction={direction} parties={parties} warehouses={whs.filter((w) => w.isActive)} /></CardContent></Card>
    </div>
  );
}
