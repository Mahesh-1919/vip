import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { formatAED } from "@/lib/money";
import { receivables } from "@/services/billing";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toggleCustomerAction } from "../../actions";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Customer" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

export default async function CustomerPage({ params }: PageProps<"/sales/customers/[id]">) {
  const user = await requirePermission("sales:customer:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [c] = await db.select().from(customers).where(eq(customers.id, id.data));
  if (!c) notFound();
  const mine = (await receivables()).rows.find((r) => r.customerId === c.id);
  const canWrite = user.permissions.has("sales:customer:write");
  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <PageHeader title={c.name} back={{ href: "/sales/customers", label: "Customers" }} actions={<StatusBadge status={c.isActive ? "active" : "inactive"} />} />
      <div className="grid gap-3 sm:grid-cols-2"><StatCard label="Outstanding" value={formatAED(mine?.outstanding ?? 0)} href={`/sales/invoices?customerId=${c.id}`} /><StatCard label="Overdue" value={formatAED(mine?.overdue ?? 0)} tone={Number(mine?.overdue) > 0 ? "danger" : undefined} /></div>
      {canWrite ? <Card><CardContent><CustomerForm customer={c} /></CardContent></Card> : <Card><CardContent className="text-sm">Read-only access.</CardContent></Card>}
      {canWrite && <form action={toggleCustomerAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={String(!c.isActive)} /><Button variant="outline" type="submit">{c.isActive ? "Deactivate customer" : "Reactivate customer"}</Button></form>}
    </div>
  );
}
