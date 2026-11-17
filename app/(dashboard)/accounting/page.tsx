import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { getCompany } from "@/services/company";
import { overview, payrollTotals } from "@/services/accounting/reports";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { lockBooks, rebuildPostings } from "./actions";

export const metadata: Metadata = { title: "Accounting" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function AccountingHome() {
  const user = await requirePermission("accounting:report:read");
  const [o, recent, company] = await Promise.all([overview(), db.select().from(journalEntries).orderBy(desc(journalEntries.entryDate), desc(journalEntries.number)).limit(8), getCompany()]);
  const payroll = user.permissions.has("accounting:payroll-summary:read") ? await payrollTotals() : [];
  const canPost = user.permissions.has("accounting:journal:write");
  const cols: Column<(typeof recent)[number]>[] = [
    { key: "n", header: "Entry", cell: (e) => <Link href={`/accounting/journal/${e.id}`} className="font-mono text-xs text-primary hover:underline">{e.number}</Link> },
    { key: "d", header: "Date", cell: (e) => formatDate(e.entryDate) },
    { key: "m", header: "Memo", cell: (e) => e.memo },
    { key: "s", header: "Source", cell: (e) => <Badge variant="secondary" className="capitalize">{e.sourceType.replace(/_/g, " ")}</Badge> },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Accounting" description="Double-entry ledger in AED (accrual basis). Invoices, payments, container costs, stock movements and payroll post automatically."
        actions={<Badge variant={o.balanced ? "success" : "danger"}>{o.balanced ? "Ledger balanced" : "Ledger out of balance"}</Badge>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Cash & bank" value={formatAED(o.cash)} href="/accounting/ledger" />
        <StatCard label="Receivables" value={formatAED(o.ar)} href="/accounting/receivables" />
        <StatCard label="Payables" value={formatAED(o.ap)} href="/accounting/payables" />
        <StatCard label="VAT payable (net)" value={formatAED(o.vatPayable)} href="/accounting/reports?report=vat" />
        <StatCard label="Revenue this month" value={formatAED(o.revenue)} />
        <StatCard label="Expenses this month" value={formatAED(o.expenses)} />
        <StatCard label="Profit this month" value={formatAED(o.profit)} tone={o.profit.isNegative() ? "danger" : "success"} />
      </div>
      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="py-5"><CardTitle>Latest journal entries</CardTitle></CardHeader><CardContent className="px-0">
        <DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={cols} rows={recent} rowKey={(e) => e.id} empty={{ title: "No entries yet" }} /></CardContent></Card>

      {payroll.length > 0 && (
        <Card><CardHeader><CardTitle>Payroll totals</CardTitle><CardDescription>Totals only: individual salaries are not shown here.</CardDescription></CardHeader><CardContent>
          <ul className="divide-y text-sm">{payroll.map((r) => <li key={r.id} className="flex items-center justify-between py-2"><span>{MONTHS[r.month - 1]} {r.year} <StatusBadge status={r.status} /></span><span>gross {formatAED(r.gross)} · net <b>{formatAED(r.net)}</b></span></li>)}</ul>
        </CardContent></Card>
      )}

      {canPost && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card><CardHeader><CardTitle>Close a period</CardTitle><CardDescription>Entries dated on or before this date can no longer be posted. {company.booksLockedThrough ? `Currently closed through ${formatDate(company.booksLockedThrough)}.` : "All periods are open."}</CardDescription></CardHeader><CardContent>
            {user.permissions.has("admin:settings:write") ? (
              <ActionForm action={lockBooks} submit="Save" resetOnSuccess={false} className="flex items-end gap-3" confirm="Closing a period blocks every posting dated in it, including automatic ones (e.g. issuing an invoice dated then).">
                <TextField name="lockedThrough" label="Closed through" type="date" defaultValue={company.booksLockedThrough ?? ""} hint="Blank reopens all periods." />
              </ActionForm>
            ) : <p className="text-sm text-muted-foreground">Only an Admin can close periods.</p>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Rebuild missing postings</CardTitle><CardDescription>Posts any document that has no journal entry yet. Safe to run repeatedly.</CardDescription></CardHeader><CardContent>
            <ActionForm action={rebuildPostings as never} submit="Rebuild" variant="outline" resetOnSuccess={false} /></CardContent></Card>
        </div>
      )}
    </div>
  );
}
