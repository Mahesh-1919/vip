import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EntryForm } from "../entry-form";

export const metadata: Metadata = { title: "New entry bill" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

export default async function NewEntryPage() {
  await requirePermission("freezone:entry:write");
  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <PageHeader title="New entry bill" back={{ href: "/bills/entries", label: "Entry bills" }} />
      <Card><CardContent><EntryForm /></CardContent></Card>
    </div>
  );
}
