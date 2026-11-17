import type { Metadata } from "next";
import { desc, eq, and, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Audit log" };
const PAGE = 50;

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit-log">) {
  await requirePermission("admin:audit:read");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const entity = one(sp.entity).trim().slice(0, 60);
  const user = one(sp.user).trim().slice(0, 100);

  const where: SQL[] = [];
  if (entity) where.push(eq(auditLogs.entity, entity));
  if (user) where.push(ilike(auditLogs.userEmail, `%${user.replace(/[%_\\]/g, "\\$&")}%`));
  const rows = await db.select().from(auditLogs).where(and(...where)).orderBy(desc(auditLogs.id)).limit(PAGE + 1).offset((page - 1) * PAGE);
  const hasNext = rows.length > PAGE;
  const qs = (p: number) => `?${new URLSearchParams({ ...(entity && { entity }), ...(user && { user }), page: String(p) })}`;

  const columns: Column<(typeof rows)[number]>[] = [
    { key: "at", header: "When (Dubai)", className: "whitespace-nowrap", cell: (r) => r.at.toLocaleString("en-GB", { timeZone: "Asia/Dubai" }) },
    { key: "user", header: "User", cell: (r) => r.userEmail ?? "—" },
    { key: "action", header: "Action", cell: (r) => <Badge variant="secondary">{r.action}</Badge> },
    { key: "entity", header: "Entity", cell: (r) => <>{r.entity}{r.entityId ? <span className="text-muted-foreground"> · {r.entityId.slice(0, 8)}</span> : ""}</> },
    { key: "ip", header: "IP", cell: (r) => r.ip ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit log" description="Append-only record of who changed what, and when." />
      <FilterBar>
        <Input name="entity" defaultValue={entity} placeholder="Entity (e.g. user)" className="w-48" />
        <Input name="user" defaultValue={user} placeholder="User email" className="w-56" />
        <Button variant="outline" type="submit">Filter</Button>
      </FilterBar>
      <DataTable columns={columns} rows={rows.slice(0, PAGE)} rowKey={(r) => String(r.id)} empty={{ title: "No audit entries", hint: "Nothing matches these filters." }} />
      <div className="flex gap-2">
        {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(page - 1)}>Previous</Link>}
        {hasNext && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(page + 1)}>Next</Link>}
      </div>
    </div>
  );
}
