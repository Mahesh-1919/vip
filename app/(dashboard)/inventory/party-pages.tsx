import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq, ilike, or, type SQL } from "drizzle-orm";
import { Plus } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import { customers, suppliers } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { formatAED } from "@/lib/money";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PartyForm, type Party } from "./party-form";
import { setPartyActive } from "./parties";

type Kind = "supplier" | "customer";
const T = { supplier: suppliers, customer: customers } as const;
const LABEL = { supplier: { one: "Supplier", many: "Suppliers" }, customer: { one: "Customer", many: "Customers" } } as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PAGE = 20;

export async function PartyListPage({ kind, searchParams }: { kind: Kind; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission(`inventory:${kind}:read`);
  const sp = await searchParams;
  const params = { q: one(sp.q).slice(0, 80), status: one(sp.status) };
  const t = T[kind];
  const where: SQL[] = [eq(t.isActive, params.status !== "inactive")];
  if (params.q) { const like = `%${params.q.replace(/[%_\\]/g, "\\$&")}%`; where.push(or(ilike(t.name, like), ilike(t.code, like), ilike(t.taxId, like))!); }
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(t).where(and(...where)).orderBy(asc(t.name)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: count() }).from(t).where(and(...where)),
  ]);
  const base = `/inventory/${kind}s`;
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "code", header: "Code", cell: (r) => <Link href={`${base}/${r.id}`} className="font-mono text-xs text-primary hover:underline">{r.code}</Link> },
    { key: "name", header: "Name", cell: (r) => <>{r.name}{r.contactName && <div className="text-xs text-muted-foreground">{r.contactName}</div>}</> },
    { key: "country", header: "Country", cell: (r) => r.country ?? "—" },
    { key: "tax", header: "TRN / tax ID", cell: (r) => <span className="font-mono text-xs">{r.taxId ?? "—"}</span> },
    { key: "terms", header: kind === "supplier" ? "Payment terms" : "Credit", cell: (r) => "paymentTermsDays" in r ? `${r.paymentTermsDays} days` : `${r.creditDays} days · ${formatAED(r.creditLimit)}` },
    { key: "st", header: "Status", cell: (r) => <StatusBadge status={r.isActive ? "active" : "inactive"} /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={LABEL[kind].many} description={kind === "supplier" ? "Who you import from. Used on inward containers and supplier payables." : "Who you export and sell to. Used on outward containers, sales and invoices."}
        actions={user.permissions.has(`inventory:${kind}:write` as never) && <Link href={`${base}/new`} className={buttonVariants()}><Plus size={16} />Add {kind}</Link>} />
      <FilterBar>
        <Input name="q" defaultValue={params.q} placeholder="Search name, code, TRN" className="w-64" />
        <NativeSelect name="status" defaultValue={params.status}><NativeSelectOption value="">Active</NativeSelectOption><NativeSelectOption value="inactive">Inactive</NativeSelectOption></NativeSelect>
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={{ title: `No ${LABEL[kind].many.toLowerCase()} found` }} />
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / PAGE))} total={total} basePath={base} params={params} />
    </div>
  );
}

export async function PartyNewPage({ kind }: { kind: Kind }) {
  await requirePermission(`inventory:${kind}:write`);
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <PageHeader title={`New ${kind}`} back={{ href: `/inventory/${kind}s`, label: LABEL[kind].many }} />
      <Card><CardContent><PartyForm kind={kind} /></CardContent></Card>
    </div>
  );
}

export async function PartyEditPage({ kind, params }: { kind: Kind; params: Promise<{ id: string }> }) {
  const user = await requirePermission(`inventory:${kind}:read`);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const t = T[kind];
  const [row] = await db.select().from(t).where(eq(t.id, id.data));
  if (!row) notFound();
  const canWrite = user.permissions.has(`inventory:${kind}:write` as never);
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <PageHeader title={<>{row.name} <span className="font-mono text-base font-normal text-muted-foreground">{row.code}</span></>} back={{ href: `/inventory/${kind}s`, label: LABEL[kind].many }}
        actions={<StatusBadge status={row.isActive ? "active" : "inactive"} />} />
      {canWrite ? <Card><CardContent><PartyForm kind={kind} party={row as Party} /></CardContent></Card> : <Card><CardContent className="text-sm">You have read-only access.</CardContent></Card>}
      {canWrite && (
        <form action={setPartyActive}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={row.id} /><input type="hidden" name="active" value={String(!row.isActive)} />
          <Button variant="outline" type="submit">{row.isActive ? `Deactivate ${kind}` : `Reactivate ${kind}`}</Button></form>
      )}
    </div>
  );
}
