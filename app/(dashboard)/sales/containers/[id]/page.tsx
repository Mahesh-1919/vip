import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatAED } from "@/lib/money";
import { COST_TYPE_LABELS } from "@/validators/containers";
import { containerPnl } from "@/services/sales/reports";
import { getContainer } from "@/services/inventory/containers";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Container P&L" };

export default async function ContainerPnlDetail({ params }: PageProps<"/sales/containers/[id]">) {
  const user = await requirePermission("sales:report:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [[pnl], detail] = await Promise.all([containerPnl({ containerId: id.data }), getContainer(id.data)]);
  if (!pnl || !detail) notFound();
  const profit = Number(pnl.profitAed);
  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <PageHeader back={{ href: "/sales/containers", label: "Container P&L" }} title={<>{pnl.containerNo} <span className="font-mono text-base font-normal text-muted-foreground">{pnl.ref}</span></>}
        description={<>{pnl.direction === "inward" ? "Import from" : "Export to"} {pnl.party ?? "—"}</>} actions={<StatusBadge status={pnl.status} />} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Revenue" value={formatAED(pnl.revenueAed)} />
        <StatCard label={pnl.direction === "outward" ? (pnl.estimated ? "Cost of goods (estimate until dispatched)" : "Cost of goods (at dispatch)") : "Goods + landed cost"} value={formatAED(pnl.goodsCostAed)} />
        <StatCard label="Other costs" value={formatAED(pnl.otherCostsAed)} />
        <StatCard label="Profit / loss" value={pnl.costOnly ? "cost only" : formatAED(pnl.profitAed)} tone={pnl.costOnly ? undefined : profit < 0 ? "danger" : "success"} hint={pnl.marginPct ? `${pnl.marginPct}% margin` : undefined} />
      </div>
      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Costs on this container</CardTitle></CardHeader><CardContent className="px-0">
        <Table><TableHeader><TableRow><TableHead className="px-4">Type</TableHead><TableHead className="px-4">Treatment</TableHead><TableHead className="px-4 text-right">AED</TableHead></TableRow></TableHeader>
          <TableBody>
            {detail.costs.map((k) => <TableRow key={k.id}><TableCell className="px-4">{COST_TYPE_LABELS[k.type] ?? k.type}{k.description ? ` · ${k.description}` : ""}</TableCell><TableCell className="px-4">{k.inLandedCost ? "In goods / landed cost" : "Expense"}</TableCell><TableCell className="px-4 text-right">{formatAED(k.amountAed)}</TableCell></TableRow>)}
            {!detail.costs.length && <TableRow><TableCell colSpan={3} className="px-4 text-center text-muted-foreground">No costs recorded.</TableCell></TableRow>}
          </TableBody></Table></CardContent></Card>
      {user.permissions.has("inventory:container:read") && <Link className="text-sm text-primary hover:underline" href={`/inventory/containers/${pnl.id}`}>Open container →</Link>}
    </div>
  );
}
