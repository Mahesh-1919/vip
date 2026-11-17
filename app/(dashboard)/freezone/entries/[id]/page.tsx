import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate } from "@/lib/dates";
import { getEntryDetail } from "@/services/freezone";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteEntryAction } from "../actions";
import { EntryForm } from "../entry-form";

export const metadata: Metadata = { title: "Entry bill" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx
const n = (v: string | number) => new Intl.NumberFormat("en-US").format(Number(v));

export default async function EntryPage({ params }: PageProps<"/freezone/entries/[id]">) {
  const user = await requirePermission("freezone:entry:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const d = await getEntryDetail(id.data);
  if (!d) notFound();
  const { e: entry, exported, remaining, allocations } = d;
  const canWrite = user.permissions.has("freezone:entry:write");
  const cols: Column<(typeof allocations)[number]>[] = [
    { key: "b", header: "Exit bill (BOE)", cell: ({ boeNo, exitId }) => user.permissions.has("freezone:exit:read") ? <Link href={`/freezone/exits/${exitId}`} className="font-mono text-xs text-primary hover:underline">{boeNo}</Link> : <span className="font-mono text-xs">{boeNo}</span> },
    { key: "d", header: "Exit date", cell: ({ exitDate }) => formatSheetDate(exitDate) },
    { key: "t", header: "Type", cell: ({ billType }) => <Badge variant={billType === "EXPORT" ? "info" : "secondary"}>{billType}</Badge> },
    { key: "c", header: "Customer", cell: ({ customer, importer }) => customer ?? importer },
    { key: "p", header: "Packages", align: "right", cell: ({ a }) => n(a.packages) },
    { key: "n", header: "Note", cell: ({ a }) => a.overReason ? <Badge variant="warning">{a.overReason}</Badge> : "" },
  ];
  return (
    <div className="max-w-5xl flex flex-col gap-6">
      <PageHeader title={<span className="font-mono">{entry.billNo}</span>} back={{ href: "/freezone/entries", label: "Entry bills" }} description={entry.agentName}
        actions={<><Link href={`/freezone/trace?entry=${entry.id}`} className={buttonVariants({ variant: "outline" })}>Trace this import</Link>{remaining <= 0 ? <Badge variant="secondary">Fully exported</Badge> : exported > 0 ? <Badge variant="warning">Partly exported</Badge> : <Badge variant="success">In stock</Badge>}</>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Packages imported" value={n(entry.packages)} />
        <StatCard label="Exported so far" value={n(exported)} hint={`${entry.packages ? Math.round((exported / entry.packages) * 100) : 0}% of this entry`} />
        <StatCard label="Remaining in the zone" value={n(remaining)} tone={remaining < 0 ? "danger" : remaining === 0 ? undefined : "success"} hint={remaining < 0 ? "Exported more than imported (tolerance used)" : undefined} />
      </div>
      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Exits from this entry</CardTitle><CardDescription>Where these goods went. Link exits to this entry from the exit bill.</CardDescription></CardHeader>
        <CardContent className="px-0"><DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={cols} rows={allocations} rowKey={({ a }) => a.id} empty={{ title: "Nothing exported from this entry yet" }} /></CardContent></Card>
      {canWrite ? <Card><CardHeader><CardTitle>Bill details</CardTitle></CardHeader><CardContent><EntryForm entry={entry} /></CardContent></Card> : <Card><CardContent className="text-sm">You have read-only access.</CardContent></Card>}
      {canWrite && <ActionForm action={deleteEntryAction.bind(null, entry.id) as never} submit="Delete entry" variant="destructive" resetOnSuccess={false} confirm="Delete this entry bill? This is recorded in the audit log but cannot be undone. It is blocked once goods have been exported from it." />}
    </div>
  );
}
