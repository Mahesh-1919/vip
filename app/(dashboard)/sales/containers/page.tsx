import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { formatAED } from "@/lib/money";
import { containerPnl } from "@/services/sales/reports";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { TabsNav } from "@/components/tabs-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Container profit & loss" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ContainerPnlPage({ searchParams }: PageProps<"/sales/containers">) {
  await requirePermission("sales:report:read");
  const sp = await searchParams;
  const direction = ["inward", "outward"].includes(one(sp.direction)) ? one(sp.direction) : "";
  const params = { direction, from: one(sp.from), to: one(sp.to) };
  const rows = await containerPnl({ direction, from: params.from || undefined, to: params.to || undefined });
  const sum = (k: "revenueAed" | "goodsCostAed" | "otherCostsAed") => rows.reduce((s, r) => s + Number(r[k]), 0);
  const profitRows = rows.filter((r) => !r.costOnly);
  const profit = profitRows.reduce((s, r) => s + Number(r.profitAed), 0);
  const qs = new URLSearchParams({ report: "pnl", ...(params.from && { from: params.from }), ...(params.to && { to: params.to }) }).toString();

  const columns: Column<(typeof rows)[number]>[] = [
    { key: "ref", header: "Container", cell: (r) => <Link href={`/sales/containers/${r.id}`} className="text-primary hover:underline"><span className="font-mono text-xs">{r.containerNo}</span><div className="text-xs text-muted-foreground">{r.ref} · {r.party ?? "—"}</div></Link> },
    { key: "dir", header: "Type", cell: (r) => <Badge variant={r.direction === "inward" ? "info" : "secondary"}>{r.direction === "inward" ? "Import" : "Export"}</Badge> },
    { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "rev", header: "Revenue", align: "right", cell: (r) => formatAED(r.revenueAed) },
    { key: "g", header: "Goods cost", align: "right", cell: (r) => <>{formatAED(r.goodsCostAed)}{r.estimated && <div className="text-xs text-muted-foreground">estimate</div>}</> },
    { key: "o", header: "Other costs", align: "right", cell: (r) => formatAED(r.otherCostsAed) },
    { key: "p", header: "Profit / loss", align: "right", cell: (r) => r.costOnly ? <span className="text-xs text-muted-foreground">cost only</span> : <b className={Number(r.profitAed) < 0 ? "text-danger" : "text-success"}>{formatAED(r.profitAed)}</b> },
    { key: "m", header: "Margin", align: "right", cell: (r) => r.marginPct ? `${r.marginPct}%` : "—" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Container profit & loss" description="Revenue from sales linked to the container, minus the cost of the goods and every cost recorded against it."
        actions={<><a className={buttonVariants({ variant: "outline" })} href={`/api/sales/reports/export?${qs}&format=csv`}>CSV</a><a className={buttonVariants({ variant: "outline" })} href={`/api/sales/reports/export?${qs}&format=xlsx`}>Excel</a></>} />
      <TabsNav active={direction || "all"} tabs={[{ key: "all", href: "/sales/containers", label: "All" }, { key: "outward", href: "/sales/containers?direction=outward", label: "Exports" }, { key: "inward", href: "/sales/containers?direction=inward", label: "Imports" }]} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Revenue" value={formatAED(sum("revenueAed"))} />
        <StatCard label="Goods cost" value={formatAED(sum("goodsCostAed"))} />
        <StatCard label="Other costs" value={formatAED(sum("otherCostsAed"))} />
        <StatCard label="Profit (containers with sales)" value={formatAED(profit)} tone={profit < 0 ? "danger" : "success"} />
      </div>
      <FilterBar>
        {direction && <input type="hidden" name="direction" value={direction} />}
        <Input type="date" name="from" defaultValue={params.from} aria-label="Created from" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="Created to" className="w-40" />
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={{ title: "No containers", hint: "Containers appear here once they exist." }} />
      <p className="text-xs text-muted-foreground">Imports are shown as “cost only” until sales are linked to them directly: goods leave stock at weighted-average cost, so profit is measured on the export (or sale-linked) container.</p>
    </div>
  );
}
