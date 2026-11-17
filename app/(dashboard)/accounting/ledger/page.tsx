import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { accountLedger } from "@/services/accounting/reports";
import { listAccounts } from "@/services/accounting/ledger";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const metadata: Metadata = { title: "General ledger" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const date = (v: string, d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);

export default async function LedgerPage({ searchParams }: PageProps<"/accounting/ledger">) {
  await requirePermission("accounting:journal:read");
  const sp = await searchParams;
  const accs = (await listAccounts());
  const accountId = z.uuid().safeParse(one(sp.account)).data ?? accs.find((a) => a.code === "1010")?.id ?? accs[0]?.id;
  const from = date(one(sp.from), `${todayISO().slice(0, 4)}-01-01`), to = date(one(sp.to), todayISO());
  const data = accountId ? await accountLedger(accountId, from, to) : null;
  const cols: Column<NonNullable<typeof data>["rows"][number]>[] = [
    { key: "d", header: "Date", cell: (r) => formatDate(r.date) },
    { key: "n", header: "Entry", cell: (r) => <Link className="font-mono text-xs text-primary hover:underline" href={`/accounting/journal/${r.entryId}`}>{r.number}</Link> },
    { key: "m", header: "Memo", cell: (r) => r.memo },
    { key: "dr", header: "Debit", align: "right", cell: (r) => Number(r.debit) ? formatAED(r.debit) : "" },
    { key: "cr", header: "Credit", align: "right", cell: (r) => Number(r.credit) ? formatAED(r.credit) : "" },
    { key: "b", header: "Balance", align: "right", cell: (r) => <b>{formatAED(r.balance)}</b> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="General ledger" description="Every movement on one account with a running balance (natural sign: debit for assets and expenses, credit for the rest)." />
      <FilterBar>
        <NativeSelect name="account" defaultValue={accountId} wrapperClassName="min-w-72">{accs.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.code} · {a.name}</NativeSelectOption>)}</NativeSelect>
        <Input type="date" name="from" defaultValue={from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={to} aria-label="To" className="w-40" />
        <Button variant="outline" type="submit">Show</Button>
      </FilterBar>
      {data && (<>
        <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Opening balance" value={formatAED(data.opening)} /><StatCard label="Movements" value={data.rows.length} /><StatCard label="Closing balance" value={formatAED(data.closing)} /></div>
        <DataTable columns={cols} rows={data.rows} rowKey={(r) => r.entryId + r.number + r.debit + r.credit} empty={{ title: "No movements in this period" }} />
      </>)}
    </div>
  );
}
