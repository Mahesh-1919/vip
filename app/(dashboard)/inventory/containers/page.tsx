import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { FLOW } from "@/lib/container";
import { listContainers } from "@/services/inventory/containers";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { TabsNav } from "@/components/tabs-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "Containers" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ContainersPage({ searchParams }: PageProps<"/inventory/containers">) {
  const user = await requirePermission("inventory:container:read");
  const sp = await searchParams;
  const direction = ["inward", "outward"].includes(one(sp.direction)) ? one(sp.direction) : "";
  const params = { direction, q: one(sp.q).slice(0, 80), status: one(sp.status) };
  const { rows, total, page, pages } = await listContainers({ ...params, page: Number(one(sp.page)) || 1 });
  const statuses = direction ? [...FLOW[direction as "inward" | "outward"], "cancelled"] : [...FLOW.inward, ...FLOW.outward, "cancelled"];
  const canWrite = user.permissions.has("inventory:container:write");

  const columns: Column<(typeof rows)[number]>[] = [
    { key: "ref", header: "Ref", cell: ({ c }) => <Link href={`/inventory/containers/${c.id}`} className="font-mono text-xs text-primary hover:underline">{c.ref}</Link> },
    { key: "no", header: "Container", cell: ({ c }) => <>{c.containerNo}<div className="text-xs text-muted-foreground">{c.size}{c.billOfLading ? ` · BL ${c.billOfLading}` : ""}</div></> },
    { key: "dir", header: "Direction", cell: ({ c }) => <Badge variant={c.direction === "inward" ? "info" : "secondary"} className="capitalize">{c.direction === "inward" ? "Import" : "Export"}</Badge> },
    { key: "party", header: "Supplier / customer", cell: (r) => r.supplier ?? r.customer ?? "—" },
    { key: "route", header: "Route", cell: ({ c }) => <span className="text-muted-foreground">{[c.loadPort, c.dischargePort].filter(Boolean).join(" → ") || "—"}</span> },
    { key: "date", header: "ETA / date", cell: ({ c }) => formatDate(c.arrivalDate ?? c.dispatchDate ?? c.eta) },
    { key: "items", header: "Items", align: "right", cell: (r) => r.itemCount },
    { key: "st", header: "Status", cell: ({ c }) => <StatusBadge status={c.status} /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Containers" description="Inward (import) and outward (export) shipments. Receiving or dispatching a container posts stock automatically."
        actions={canWrite && <><Link href="/inventory/containers/new?direction=inward" className={buttonVariants()}><Plus size={16} />New import</Link><Link href="/inventory/containers/new?direction=outward" className={buttonVariants({ variant: "outline" })}><Plus size={16} />New export</Link></>} />
      <TabsNav active={direction || "all"} tabs={[{ key: "all", href: "/inventory/containers", label: "All" }, { key: "inward", href: "/inventory/containers?direction=inward", label: "Inward (import)" }, { key: "outward", href: "/inventory/containers?direction=outward", label: "Outward (export)" }]} />
      <FilterBar>
        {direction && <input type="hidden" name="direction" value={direction} />}
        <Input name="q" defaultValue={params.q} placeholder="Search container no, ref, BL, party" className="w-72" />
        <NativeSelect name="status" defaultValue={params.status}><NativeSelectOption value="">All statuses</NativeSelectOption>{statuses.map((s) => <NativeSelectOption key={s} value={s}>{s.replace(/_/g, " ")}</NativeSelectOption>)}</NativeSelect>
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.c.id} empty={{ title: "No containers found", hint: canWrite ? "Create an import or export container to get started." : undefined }} />
      <Pagination page={page} pages={pages} total={total} basePath="/inventory/containers" params={params} />
    </div>
  );
}
