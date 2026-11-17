import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { METHODS, listPayables } from "@/services/accounting/payables";
import { apAging, BUCKETS } from "@/services/accounting/reports";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { payPayableAction } from "../actions";

export const metadata: Metadata = { title: "Payables" };

export default async function PayablesPage() {
  const user = await requirePermission("accounting:payable:read");
  const [a, all] = await Promise.all([apAging(), listPayables()]);
  const open = all.filter((p) => p.outstanding.gt(0));
  const canPay = user.permissions.has("accounting:payable:write");
  const overdue = a.totals.slice(1).reduce((s, v) => s.plus(v), a.total.minus(a.total));
  const cols: Column<(typeof open)[number]>[] = [
    { key: "p", header: "Payee", cell: ({ p }) => <>{p.payeeName}<div className="text-xs text-muted-foreground">{p.description}</div></> },
    { key: "d", header: "Date / due", cell: ({ p }) => <>{formatDate(p.docDate)}<div className="text-xs text-muted-foreground">due {formatDate(p.dueDate)}</div></> },
    { key: "a", header: "Amount", align: "right", cell: ({ p }) => formatAED(p.amountAed) },
    { key: "o", header: "Outstanding", align: "right", cell: ({ outstanding }) => <b>{formatAED(outstanding)}</b> },
    { key: "s", header: "Status", cell: ({ state }) => <StatusBadge status={state} /> },
    ...(canPay ? [{ key: "pay", header: "Pay", cell: ({ p, outstanding }: (typeof open)[number]) => (
      <ActionForm action={payPayableAction} submit="Pay" variant="outline" className="flex flex-wrap items-center gap-1.5" resetOnSuccess={false}>
        <input type="hidden" name="payableId" value={p.id} />
        <Input name="amount" inputMode="decimal" defaultValue={outstanding.toFixed(2)} className="h-8 w-28 text-right" aria-label="Amount" />
        <Input type="date" name="paymentDate" defaultValue={todayISO()} className="h-8 w-36" aria-label="Payment date" />
        <NativeSelect name="method" size="sm" aria-label="Method">{METHODS.map((m) => <NativeSelectOption key={m} value={m}>{m.replace("_", " ")}</NativeSelectOption>)}</NativeSelect>
        <input type="hidden" name="reference" value="" />
      </ActionForm>) }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Accounts payable" description="Money owed to suppliers: goods on received import containers and landed costs, with the supplier's payment terms." />
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Total payable" value={formatAED(a.total)} /><StatCard label="Overdue" value={formatAED(overdue)} tone={overdue.gt(0) ? "danger" : undefined} /><StatCard label="Open items" value={open.length} /></div>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50"><TableRow><TableHead className="px-4">Supplier / payee</TableHead>{BUCKETS.map((b) => <TableHead key={b} className="px-4 text-right">{b}</TableHead>)}<TableHead className="px-4 text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {a.rows.map((r) => <TableRow key={r.name}><TableCell className="px-4">{r.name}</TableCell>{r.buckets.map((b, i) => <TableCell key={i} className={`px-4 text-right ${i > 0 && !b.isZero() ? "text-danger" : ""}`}>{b.isZero() ? "—" : formatAED(b)}</TableCell>)}<TableCell className="px-4 text-right font-medium">{formatAED(r.total)}</TableCell></TableRow>)}
            {!a.rows.length && <TableRow><TableCell colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nothing owed.</TableCell></TableRow>}
          </TableBody>
          {a.rows.length > 0 && <TableFooter><TableRow><TableCell className="px-4">Total</TableCell>{a.totals.map((t, i) => <TableCell key={i} className="px-4 text-right">{formatAED(t)}</TableCell>)}<TableCell className="px-4 text-right">{formatAED(a.total)}</TableCell></TableRow></TableFooter>}
        </Table>
      </Card>
      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Open items</CardTitle></CardHeader><CardContent className="px-0">
        <DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={cols} rows={open} rowKey={({ p }) => p.id} empty={{ title: "No open payables" }} /></CardContent></Card>
    </div>
  );
}
