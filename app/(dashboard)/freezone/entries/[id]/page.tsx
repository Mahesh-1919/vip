import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { getEntry } from "@/services/freezone";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { deleteEntryAction } from "../actions";
import { EntryForm } from "../entry-form";

export const metadata: Metadata = { title: "Entry bill" };

export default async function EntryPage({ params }: PageProps<"/freezone/entries/[id]">) {
  const user = await requirePermission("freezone:entry:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const entry = await getEntry(id.data);
  if (!entry) notFound();
  const canWrite = user.permissions.has("freezone:entry:write");
  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <PageHeader title={<span className="font-mono">{entry.billNo}</span>} back={{ href: "/freezone/entries", label: "Entry bills" }} description={entry.agentName} />
      {canWrite ? <Card><CardContent><EntryForm entry={entry} /></CardContent></Card> : <Card><CardContent className="text-sm">You have read-only access.</CardContent></Card>}
      {canWrite && <ActionForm action={deleteEntryAction.bind(null, entry.id) as never} submit="Delete entry" variant="destructive" resetOnSuccess={false} confirm="Delete this entry bill? This is recorded in the audit log but cannot be undone." />}
    </div>
  );
}
