import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ExitForm } from "../exit-form";

export const metadata: Metadata = { title: "New exit bill" };

export default async function NewExitPage() {
  await requirePermission("freezone:exit:write");
  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <PageHeader title="New exit bill" back={{ href: "/freezone/exits", label: "Exit bills" }} />
      <Card><CardContent><ExitForm /></CardContent></Card>
    </div>
  );
}
