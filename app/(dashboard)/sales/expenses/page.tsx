import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { formatAED } from "@/lib/money";
import { COST_TYPE_LABELS, CURRENCIES } from "@/validators/containers";
import { listExpenses } from "@/services/sales/expenses";
import { containerOptionsForSales } from "@/services/sales/sales";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { SelectField, TextField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { addExpenseAction } from "../actions";

export const metadata: Metadata = { title: "Expenses" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ExpensesPage({ searchParams }: PageProps<"/sales/expenses">) {
  const user = await requirePermission("sales:expense:read");
  const sp = await searchParams;
  const params = { containerId: one(sp.containerId), type: one(sp.type), from: one(sp.from), to: one(sp.to) };
  const [{ rows, total, page, pages }, containers] = await Promise.all([
    listExpenses({ ...params, containerId: /^[0-9a-f-]{36}$/i.test(params.containerId) ? params.containerId : undefined, from: params.from || undefined, to: params.to || undefined, page: Number(one(sp.page)) || 1 }),
    containerOptionsForSales(),
  ]);
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "d", header: "Date", className: "whitespace-nowrap", cell: ({ k }) => formatDate(k.incurredOn) },
    { key: "c", header: "Container", cell: ({ containerNo, ref, k }) => <Link href={user.permissions.has("sales:report:read") ? `/sales/containers/${k.containerId}` : "#"} className="text-primary hover:underline"><span className="font-mono text-xs">{containerNo}</span> <span className="text-muted-foreground">{ref}</span></Link> },
    { key: "t", header: "Type", cell: ({ k }) => <>{COST_TYPE_LABELS[k.type] ?? k.type}{k.description && <div className="text-xs text-muted-foreground">{k.description}</div>}</> },
    { key: "a", header: "Amount", align: "right", cell: ({ k }) => k.currency === "AED" ? formatAED(k.amount) : <>{formatQty(k.amount)} {k.currency}<div className="text-xs text-muted-foreground">@ {formatQty(k.exchangeRate)}</div></> },
    { key: "aed", header: "AED", align: "right", cell: ({ k }) => formatAED(k.amountAed) },
    { key: "w", header: "Treatment", cell: ({ k }) => k.inLandedCost ? <Badge variant="info">Landed cost</Badge> : <Badge variant="secondary">Expense</Badge> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Expenses" description="Costs per container: freight, duty, port charges, transport, labour and miscellaneous. They feed each container's profit & loss." />
      <FilterBar>
        <NativeSelect name="containerId" defaultValue={params.containerId}><NativeSelectOption value="">All containers</NativeSelectOption>{containers.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.containerNo} · {c.ref}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect name="type" defaultValue={params.type}><NativeSelectOption value="">All types</NativeSelectOption>{Object.entries(COST_TYPE_LABELS).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}</NativeSelect>
        <Input type="date" name="from" defaultValue={params.from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={params.to} aria-label="To" className="w-40" />
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={columns} rows={rows} rowKey={({ k }) => k.id} empty={{ title: "No expenses recorded" }} />
      <Pagination page={page} pages={pages} total={total} basePath="/sales/expenses" params={params} />
      {user.permissions.has("sales:expense:write") && (
        <Card><CardHeader><CardTitle>Record expense</CardTitle><CardDescription>Recorded as an expense of the container (not added to stock value). Landed costs on imports are entered by Inventory on the container itself.</CardDescription></CardHeader><CardContent>
          <ActionForm action={addExpenseAction} submit="Record expense" className="grid gap-4 sm:grid-cols-3">
            <SelectField className="sm:col-span-3" name="containerId" label="Container" required placeholder="Choose…" options={containers.map((c) => ({ value: c.id, label: `${c.containerNo} · ${c.ref} · ${c.direction === "inward" ? "import" : "export"}` }))} />
            <SelectField name="type" label="Type" options={Object.entries(COST_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
            <TextField name="description" label="Description" />
            <TextField name="incurredOn" label="Date" type="date" required defaultValue={todayISO()} />
            <TextField name="amount" label="Amount (ex-VAT)" inputMode="decimal" required />
            <SelectField name="currency" label="Currency" defaultValue="AED" options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            <TextField name="exchangeRate" label="Exchange rate" inputMode="decimal" defaultValue="1" />
            <TextField name="vat" label="Recoverable VAT (same currency)" inputMode="decimal" />
          </ActionForm>
        </CardContent></Card>
      )}
    </div>
  );
}
