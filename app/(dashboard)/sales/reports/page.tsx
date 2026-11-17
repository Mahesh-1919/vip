import type { Metadata } from "next";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatQty } from "@/lib/format";
import { formatAED } from "@/lib/money";
import { salesReport, type GroupBy } from "@/services/sales/reports";
import { customerOptions } from "@/services/inventory/containers";
import { containerOptionsForSales } from "@/services/sales/sales";
import { productOptions } from "@/services/inventory/stock";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TabsNav } from "@/components/tabs-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Sales reports" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const GROUPS = [["period", "By period"], ["customer", "By customer"], ["product", "By product"], ["container", "By container"]] as const;

export default async function ReportsPage({ searchParams }: PageProps<"/sales/reports">) {
  await requirePermission("sales:report:read");
  const sp = await searchParams;
  const report = (GROUPS.map((g) => g[0]) as string[]).includes(one(sp.report)) ? (one(sp.report) as GroupBy) : "period";
  const params = { report, granularity: ["day", "month", "year"].includes(one(sp.granularity)) ? one(sp.granularity) : "month", from: one(sp.from), to: one(sp.to), customerId: one(sp.customerId), productId: one(sp.productId), containerId: one(sp.containerId) };
  const id = (v: string) => (z.uuid().safeParse(v).success ? v : undefined);
  const [rows, customers, products, containers] = await Promise.all([
    salesReport({ groupBy: report, granularity: params.granularity as never, from: params.from || undefined, to: params.to || undefined, customerId: id(params.customerId), productId: id(params.productId), containerId: id(params.containerId) }),
    customerOptions(), productOptions(), containerOptionsForSales(),
  ]);
  const total = rows.reduce((s, r) => s + Number(r.revenueAed), 0), vat = rows.reduce((s, r) => s + Number(r.vatAed), 0);
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  const label = { period: "Period", customer: "Customer", product: "Product", container: "Container" }[report];
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "l", header: label, cell: (r) => r.label },
    { key: "s", header: "Sales", align: "right", cell: (r) => r.sales },
    { key: "q", header: "Quantity", align: "right", cell: (r) => formatQty(r.qty) },
    { key: "r", header: "Revenue (excl. VAT)", align: "right", cell: (r) => formatAED(r.revenueAed) },
    { key: "v", header: "VAT", align: "right", cell: (r) => formatAED(r.vatAed) },
    { key: "pct", header: "Share", align: "right", cell: (r) => total ? `${((Number(r.revenueAed) / total) * 100).toFixed(1)}%` : "—" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sales reports" description="Confirmed sales in AED. Filter, then export to CSV or Excel."
        actions={<><a className={buttonVariants({ variant: "outline" })} href={`/api/sales/reports/export?${qs}&format=csv`}>CSV</a><a className={buttonVariants({ variant: "outline" })} href={`/api/sales/reports/export?${qs}&format=xlsx`}>Excel</a></>} />
      <TabsNav active={report} tabs={GROUPS.map(([key, label]) => ({ key, label, href: `/sales/reports?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)), report: key })}` }))} />
      <FilterBar>
        <input type="hidden" name="report" value={report} />
        {report === "period" && <NativeSelect name="granularity" defaultValue={params.granularity}><NativeSelectOption value="day">Daily</NativeSelectOption><NativeSelectOption value="month">Monthly</NativeSelectOption><NativeSelectOption value="year">Yearly</NativeSelectOption></NativeSelect>}
        <Input type="date" name="from" defaultValue={params.from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-40" />
        <NativeSelect name="customerId" defaultValue={params.customerId}><NativeSelectOption value="">All customers</NativeSelectOption>{customers.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="productId" defaultValue={params.productId}><NativeSelectOption value="">All products</NativeSelectOption>{products.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.sku}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="containerId" defaultValue={params.containerId}><NativeSelectOption value="">All containers</NativeSelectOption>{containers.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.containerNo}</NativeSelectOption>)}</NativeSelect>
        <Button variant="outline" type="submit">Apply</Button>
      </FilterBar>
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Revenue (excl. VAT)" value={formatAED(total)} /><StatCard label="VAT" value={formatAED(vat)} /><StatCard label="Rows" value={rows.length} /></div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} empty={{ title: "No sales match", hint: "Widen the date range or clear a filter." }} />
    </div>
  );
}
