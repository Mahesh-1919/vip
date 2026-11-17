import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { reverseJournal } from "../../actions";

export const metadata: Metadata = { title: "Journal entry" };

export default async function JournalEntryPage({ params }: PageProps<"/accounting/journal/[id]">) {
  const user = await requirePermission("accounting:journal:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [e] = await db.select().from(journalEntries).where(eq(journalEntries.id, id.data));
  if (!e) notFound();
  const lines = await db.select({ l: journalLines, code: accounts.code, name: accounts.name }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).where(eq(journalLines.entryId, e.id)).orderBy(journalLines.debit);
  const cols: Column<(typeof lines)[number]>[] = [
    { key: "a", header: "Account", cell: ({ code, name, l }) => <><span className="font-mono text-xs text-muted-foreground">{code}</span> {name}{l.description && <div className="text-xs text-muted-foreground">{l.description}</div>}</> },
    { key: "d", header: "Debit", align: "right", cell: ({ l }) => Number(l.debit) ? formatAED(l.debit) : "" },
    { key: "c", header: "Credit", align: "right", cell: ({ l }) => Number(l.credit) ? formatAED(l.credit) : "" },
  ];
  const canReverse = user.permissions.has("accounting:journal:write") && e.sourceType === "manual";
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <PageHeader back={{ href: "/accounting/journal", label: "Journal" }} title={<span className="font-mono">{e.number}</span>} description={<>{formatDate(e.entryDate)} · {e.memo}</>}
        actions={<><Badge variant="secondary" className="capitalize">{e.sourceType.replace(/_/g, " ")}</Badge>{e.reversalOf && <Badge variant="warning">Reversal</Badge>}</>} />
      <DataTable columns={cols} rows={lines} rowKey={({ l }) => l.id} />
      {canReverse && (
        <ActionForm action={reverseJournal.bind(null, e.id)} submit="Reverse this entry" variant="outline" className="flex items-end gap-3" confirm="A mirrored entry dated today will be posted. The original stays on record.">
          <Input name="reason" placeholder="Reason" required minLength={3} maxLength={200} className="w-72" />
        </ActionForm>
      )}
    </div>
  );
}
