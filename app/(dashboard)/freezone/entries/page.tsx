import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate } from "@/lib/dates";
import { entryAgents, listEntries, PAGE_SIZES } from "@/services/freezone";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Entry bills" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const num = (v: string | number, d = 2) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v));
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export default async function EntriesPage({ searchParams }: PageProps<"/freezone/entries">) {
  const user = await requirePermission("freezone:entry:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), agent: one(sp.agent), origin: one(sp.origin).slice(0, 10), from: date(one(sp.from)), to: date(one(sp.to)), size: one(sp.size) };
  const [res, agents] = await Promise.all([
    listEntries({ ...params, from: params.from || undefined, to: params.to || undefined, size: Number(params.size) || 25, page: Number(one(sp.page)) || 1 }),
    entryAgents(),
  ]);
  const keep = { ...params, size: String(res.size) };
  const qs = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== "size") as [string, string][]).toString();

  const columns: Column<(typeof res.rows)[number]>[] = [
    { key: "sl", header: "Sl", cell: ({ sl }) => sl, className: "text-muted-foreground" },
    { key: "date", header: "Bill Date", className: "whitespace-nowrap", cell: ({ e }) => formatSheetDate(e.billDate) },
    { key: "no", header: "Bill No", className: "whitespace-nowrap", cell: ({ e }) => <Link href={`/freezone/entries/${e.id}`} className="font-mono text-xs text-primary hover:underline">{e.billNo}</Link> },
    { key: "agent", header: "Agent Name", cell: ({ e }) => e.agentName },
    { key: "tr", header: "Transfer No", className: "font-mono text-xs", cell: ({ e }) => e.transferNo },
    { key: "arr", header: "Arrival Date", className: "whitespace-nowrap", cell: ({ e }) => formatSheetDate(e.arrivalDate) },
    { key: "pol", header: "Port of Loading", cell: ({ e }) => e.portOfLoading },
    { key: "pod", header: "Port of Discharge", cell: ({ e }) => e.portOfDischarge },
    { key: "inv", header: "Invoice No", className: "font-mono text-xs", cell: ({ e }) => e.invoiceNo },
    { key: "val", header: "Value", align: "right", cell: ({ e }) => num(e.valueAed) },
    { key: "wt", header: "Weight (Kg)", align: "right", cell: ({ e }) => num(e.weightKg, 0) },
    { key: "pk", header: "No of Packages", align: "right", cell: ({ e }) => num(e.packages, 0) },
    { key: "stock", header: "Stock", cell: ({ e }) => e.originCountry },
    { key: "marks", header: "Marks & Numbers", className: "max-w-64 whitespace-normal font-mono text-xs", cell: ({ e }) => e.marksNumbers },
    { key: "line", header: "Line", cell: ({ e }) => e.line },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Free Zone Entry Bill Sheet" description={`Number of records: ${res.total}`}
        actions={<>
          <a href={`/api/freezone/export?sheet=entries&${qs}`} className={buttonVariants({ variant: "outline" })}><Download size={16} />CSV</a>
          {user.permissions.has("freezone:entry:write") && <Link href="/freezone/entries/new" className={buttonVariants()}><Plus size={16} />Add entry</Link>}
        </>} />
      <FilterBar>
        <label className="flex items-center gap-2 text-sm">Show
          <NativeSelect name="size" defaultValue={String(res.size)} wrapperClassName="w-24">{PAGE_SIZES.map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}</NativeSelect> entries</label>
        <Input name="q" defaultValue={params.q} placeholder="Search bill, agent, invoice, container…" className="w-72" />
        <NativeSelect name="agent" defaultValue={params.agent} wrapperClassName="w-56"><NativeSelectOption value="">All agents</NativeSelectOption>{agents.map((a) => <NativeSelectOption key={a} value={a}>{a}</NativeSelectOption>)}</NativeSelect>
        <Input name="origin" defaultValue={params.origin} placeholder="Stock (CN…)" className="w-28" />
        <Input type="date" name="from" defaultValue={params.from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-40" />
        <Button variant="outline" type="submit">Apply</Button>
      </FilterBar>
      <DataTable dense columns={columns} rows={res.rows} rowKey={({ e }) => e.id} empty={{ title: "No entry bills", hint: "Add the first entry, or change the filters." }}
        footer={{ sl: "Total", val: num(res.totals.value), wt: num(res.totals.weight, 0), pk: num(res.totals.packages, 0) }} />
      <Pagination page={res.page} pages={res.pages} total={res.total} basePath="/freezone/entries" params={keep} />
    </div>
  );
}
