import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { customerOptions } from "@/services/billing";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { entriesWithStock } from "@/services/freezone";
import { NewExitForm } from "../new-exit-form";

export const metadata: Metadata = { title: "New exit bill" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

export default async function NewExitPage() {
  await requirePermission("freezone:exit:write");
  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <PageHeader title="New exit bill" description="Pick the import the goods come from, see what is in stock, and export up to that amount." back={{ href: "/bills/exits", label: "Exit bills" }} />
      <Card><CardContent><NewExitForm entries={await entriesWithStock()} customers={await customerOptions()} /></CardContent></Card>
    </div>
  );
}
