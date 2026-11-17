import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, gte, ilike, lte, eq, sql, type SQL } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Journal" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SOURCES = ["invoice", "payment", "container_receipt", "container_cost", "cogs", "payroll", "payroll_paid", "payable_payment", "manual", "reversal"];
const PAGE = 25;

export default async function JournalPage({ searchParams }: PageProps<"/accounting/journal">) {
  const user = await requirePermission("accounting:journal:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), source: one(sp.source), from: one(sp.from), to: one(sp.to) };
  const where: SQL[] = [];
  if (params.q) where.push(ilike(journalEntries.memo, `%${params.q.replace(/[%_\\]/g, "\\$&")}%`));
  if (SOURCES.includes(params.source)) where.push(eq(journalEntries.sourceType, params.source));
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.from)) where.push(gte(journalEntries.entryDate, params.from));
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.to)) where.push(lte(journalEntries.entryDate, params.to));
  const w = where.length ? and(...where) : undefined;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select({ e: journalEntries, amount: sql<string>`(select coalesce(sum(${journalLines.debit}), 0) from ${journalLines} where ${journalLines.entryId} = ${journalEntries.id})` }).from(journalEntries).where(w).orderBy(desc(journalEntries.entryDate), desc(journalEntries.number)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: count() }).from(journalEntries).where(w),
  ]);
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "n", header: "Entry", cell: ({ e }) => <Link href={`/accounting/journal/${e.id}`} className="font-mono text-xs text-primary hover:underline">{e.number}</Link> },
    { key: "d", header: "Date", cell: ({ e }) => formatDate(e.entryDate) },
    { key: "m", header: "Memo", cell: ({ e }) => e.memo },
    { key: "s", header: "Source", cell: ({ e }) => <Badge variant={e.sourceType === "manual" ? "info" : "secondary"} className="capitalize">{e.sourceType.replace(/_/g, " ")}</Badge> },
    { key: "a", header: "Amount", align: "right", cell: ({ amount }) => formatAED(amount) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Journal" description="Every posting, automatic or manual. Entries cannot be edited or deleted: corrections are reversals."
        actions={user.permissions.has("accounting:journal:write") && <Link href="/accounting/journal/new" className={buttonVariants()}><Plus size={16} />Manual entry</Link>} />
      <FilterBar>
        <Input name="q" defaultValue={params.q} placeholder="Search memo" className="w-56" />
        <NativeSelect name="source" defaultValue={params.source}><NativeSelectOption value="">All sources</NativeSelectOption>{SOURCES.map((s) => <NativeSelectOption key={s} value={s}>{s.replace(/_/g, " ")}</NativeSelectOption>)}</NativeSelect>
        <Input type="date" name="from" defaultValue={params.from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-40" />
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={cols} rows={rows} rowKey={({ e }) => e.id} empty={{ title: "No entries" }} />
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / PAGE))} total={total} basePath="/accounting/journal" params={params} />
    </div>
  );
}
