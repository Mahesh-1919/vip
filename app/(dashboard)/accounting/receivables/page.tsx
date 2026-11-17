import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { formatAED } from "@/lib/money";
import { arAging, BUCKETS } from "@/services/accounting/reports";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Receivables" };

export default async function ReceivablesPage() {
  const user = await requirePermission("accounting:receivable:read");
  const a = await arAging();
  const overdue = a.totals.slice(1).reduce((s, v) => s.plus(v), a.total.minus(a.total));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Accounts receivable" description="What customers owe, by how late it is. Built from issued invoices less payments." />
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Total receivable" value={formatAED(a.total)} /><StatCard label="Overdue" value={formatAED(overdue)} tone={overdue.gt(0) ? "danger" : undefined} /><StatCard label="Customers owing" value={a.rows.length} /></div>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50"><TableRow><TableHead className="px-4">Customer</TableHead>{BUCKETS.map((b) => <TableHead key={b} className="px-4 text-right">{b}</TableHead>)}<TableHead className="px-4 text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {a.rows.map((r) => <TableRow key={r.name}><TableCell className="px-4">{r.name}</TableCell>{r.buckets.map((b, i) => <TableCell key={i} className={`px-4 text-right ${i > 0 && !b.isZero() ? "text-danger" : ""}`}>{b.isZero() ? "—" : formatAED(b)}</TableCell>)}<TableCell className="px-4 text-right font-medium">{formatAED(r.total)}</TableCell></TableRow>)}
            {!a.rows.length && <TableRow><TableCell colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nothing outstanding.</TableCell></TableRow>}
          </TableBody>
          {a.rows.length > 0 && <TableFooter><TableRow><TableCell className="px-4">Total</TableCell>{a.totals.map((t, i) => <TableCell key={i} className="px-4 text-right">{formatAED(t)}</TableCell>)}<TableCell className="px-4 text-right">{formatAED(a.total)}</TableCell></TableRow></TableFooter>}
        </Table>
      </Card>
      {user.permissions.has("inventory:invoice:read") && <Link href="/inventory/invoices?status=overdue" className="text-sm text-primary hover:underline">View overdue invoices →</Link>}
    </div>
  );
}
