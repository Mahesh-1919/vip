import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate } from "@/lib/dates";
import { listExits, PAGE_SIZES } from "@/services/freezone";
import { containersOf } from "@/services/trace";
import { BILL_TYPES, CERT_STATUSES, REFUND_STATUSES } from "@/validators/freezone";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Exit bills" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const num = (v: string | number, d = 2) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v));
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const tone = (s: string) => (s === "Pending" ? "warning" : s === "No Need" ? "secondary" : "success") as "warning" | "secondary" | "success";

export default async function ExitsPage({ searchParams }: PageProps<"/freezone/exits">) {
  const user = await requirePermission("freezone:exit:read");
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), type: one(sp.type), cert: one(sp.cert), refund: one(sp.refund), alloc: one(sp.alloc), billing: one(sp.billing), backing: one(sp.backing), from: date(one(sp.from)), to: date(one(sp.to)), size: one(sp.size) };
  const res = await listExits({ ...params, from: params.from || undefined, to: params.to || undefined, size: Number(params.size) || 25, page: Number(one(sp.page)) || 1 });
  const keep = { ...params, size: String(res.size) };
  const qs = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== "size") as [string, string][]).toString();

  const columns: Column<(typeof res.rows)[number]>[] = [
    { key: "sl", header: "Sl", cell: ({ sl }) => sl, className: "text-muted-foreground" },
    { key: "date", header: "Date", className: "whitespace-nowrap", cell: ({ e }) => formatSheetDate(e.exitDate) },
    { key: "boe", header: "BOE No", className: "whitespace-nowrap", cell: ({ e }) => <Link href={`/freezone/exits/${e.id}`} className="font-mono text-xs text-primary hover:underline">{e.boeNo}</Link> },
    { key: "imp", header: "Importer Name", cell: ({ e }) => e.importerName },
    { key: "ref", header: "Ref No", className: "font-mono text-xs", cell: ({ e }) => e.refNo },
    { key: "type", header: "Bill Type", cell: ({ e }) => <Badge variant={e.billType === "EXPORT" ? "info" : "secondary"}>{e.billType}</Badge> },
    { key: "pol", header: "Port of Loading", cell: ({ e }) => e.portOfLoading },
    { key: "pod", header: "Port of Discharge", cell: ({ e }) => e.portOfDischarge },
    { key: "inv", header: "Invoice No", className: "font-mono text-xs", cell: ({ e }) => e.invoiceNo },
    { key: "val", header: "Value (AED)", align: "right", cell: ({ e }) => num(e.valueAed) },
    { key: "wt", header: "Weight (Kg)", align: "right", cell: ({ e }) => num(e.weightKg, 0) },
    { key: "pk", header: "No of Pkgs", align: "right", cell: ({ e }) => num(e.packages, 0) },
    { key: "cty", header: "Country", cell: ({ e }) => e.country },
    { key: "trk", header: "Truck / Container No", className: "max-w-56 whitespace-normal font-mono text-xs", cell: ({ e }) => <span className="flex flex-wrap gap-x-2">{containersOf(e.truckContainerNo).map((c) => <Link key={c} href={`/freezone/trace?q=${encodeURIComponent(c)}`} className="text-primary hover:underline">{c}</Link>)}</span> },
    { key: "cert", header: "T/Entry Cert", cell: ({ e }) => <Badge variant={tone(e.entryCertStatus)}>{e.entryCertStatus}</Badge> },
    { key: "cd", header: "Cheque Date", className: "whitespace-nowrap", cell: ({ e }) => formatSheetDate(e.chequeDate) },
    { key: "ca", header: "Cheque Amount", align: "right", cell: ({ e }) => (e.chequeAmount ? num(e.chequeAmount) : "") },
    { key: "ref2", header: "Refund Status", cell: ({ e }) => <Badge variant={tone(e.refundStatus)}>{e.refundStatus}</Badge> },
    { key: "ship", header: "Shipping", cell: ({ e }) => e.shippingLine },
    { key: "cust", header: "Customer", cell: (r) => r.customer ?? <span className="text-xs text-warning">not linked</span> },
    { key: "link", header: "Linked to entries", cell: ({ e, allocated }) => <Badge variant={allocated === 0 ? "warning" : allocated >= e.packages ? "success" : "info"}>{allocated === 0 ? "Unlinked" : allocated >= e.packages ? "Fully" : `${num(allocated, 0)}/${num(e.packages, 0)}`}</Badge> },
    { key: "inv", header: "Invoiced", cell: ({ e, billedPkgs }) => e.billType !== "EXPORT" ? <span className="text-muted-foreground">n/a</span> : Number(billedPkgs) === 0 ? <Badge variant="warning">Not invoiced</Badge> : Number(billedPkgs) >= e.packages ? <Badge variant="success">Invoiced</Badge> : <Badge variant="info">{num(billedPkgs, 0)}/{num(e.packages, 0)}</Badge> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Free Zone Exit Bill Sheet" description={`Number of records: ${res.total}`}
        actions={<>
          <a href={`/api/freezone/export?sheet=exits&${qs}`} className={buttonVariants({ variant: "outline" })}><Download size={16} />CSV</a>
          {user.permissions.has("freezone:exit:write") && <Link href="/freezone/exits/new" className={buttonVariants()}><Plus size={16} />Add exit bill</Link>}
        </>} />
      <FilterBar>
        <label className="flex items-center gap-2 text-sm">Show
          <NativeSelect name="size" defaultValue={String(res.size)} wrapperClassName="w-24">{PAGE_SIZES.map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}</NativeSelect> entries</label>
        <Input name="q" defaultValue={params.q} placeholder="Search BOE, importer, ref, container…" className="w-72" />
        <NativeSelect name="type" defaultValue={params.type} wrapperClassName="w-36"><NativeSelectOption value="">All types</NativeSelectOption>{BILL_TYPES.map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="cert" defaultValue={params.cert} wrapperClassName="w-44"><NativeSelectOption value="">Any T/Entry cert</NativeSelectOption>{CERT_STATUSES.map((t) => <NativeSelectOption key={t} value={t}>Cert: {t}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="refund" defaultValue={params.refund} wrapperClassName="w-48"><NativeSelectOption value="">Any refund status</NativeSelectOption>{REFUND_STATUSES.map((t) => <NativeSelectOption key={t} value={t}>Refund: {t}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="alloc" defaultValue={params.alloc} wrapperClassName="w-44"><NativeSelectOption value="">Any entry link</NativeSelectOption><NativeSelectOption value="none">Unlinked</NativeSelectOption><NativeSelectOption value="partial">Partly linked</NativeSelectOption><NativeSelectOption value="full">Fully linked</NativeSelectOption></NativeSelect>
        <NativeSelect name="backing" defaultValue={params.backing} wrapperClassName="w-56"><NativeSelectOption value="">All stock backing</NativeSelectOption><NativeSelectOption value="unbacked">Exports not backed by stock</NativeSelectOption></NativeSelect>
        <NativeSelect name="billing" defaultValue={params.billing} wrapperClassName="w-44"><NativeSelectOption value="">Any invoicing</NativeSelectOption><NativeSelectOption value="none">Not invoiced</NativeSelectOption><NativeSelectOption value="partial">Partly invoiced</NativeSelectOption><NativeSelectOption value="full">Fully invoiced</NativeSelectOption></NativeSelect>
        <Input type="date" name="from" defaultValue={params.from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-40" />
        <Button variant="outline" type="submit">Apply</Button>
      </FilterBar>
      <DataTable dense columns={columns} rows={res.rows} rowKey={({ e }) => e.id} empty={{ title: "No exit bills", hint: "Add the first exit bill, or change the filters." }}
        footer={{ sl: "Total", val: num(res.totals.value), wt: num(res.totals.weight, 0), pk: num(res.totals.packages, 0), ca: num(res.totals.cheques) }} />
      <Pagination page={res.page} pages={res.pages} total={res.total} basePath="/freezone/exits" params={keep} />
    </div>
  );
}
