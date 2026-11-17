import type { Metadata } from "next";
import Link from "next/link";
import { and, count, eq, isNotNull, lte, notInArray, or, sql } from "drizzle-orm";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { db } from "@/db";
import { employees, leaveRequests, payrollRuns } from "@/db/schema";
import { requirePermission, type CurrentUser } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { todayISO } from "@/lib/dates";
import { lowStockCount } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Dashboard" };

type Attention = { label: string; count: number; href: string; tone: "warning" | "danger" };

async function attention(user: CurrentUser): Promise<Attention[]> {
  const items: Attention[] = [];
  const can = (p: never) => user.permissions.has(p);
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const [leave, drafts, expiring, low] = await Promise.all([
    can("hr:leave:approve" as never) ? db.select({ n: count() }).from(leaveRequests).where(eq(leaveRequests.status, "pending")) : null,
    can("hr:payroll:read" as never) ? db.select({ n: count() }).from(payrollRuns).where(eq(payrollRuns.status, "draft")) : null,
    can("hr:employee:read" as never)
      ? db.select({ n: count() }).from(employees).where(and(notInArray(employees.status, ["inactive", "terminated"]),
          or(...(["visaExpiry", "emiratesIdExpiry", "passportExpiry", "labourCardExpiry"] as const).map((c) => and(isNotNull(employees[c]), lte(employees[c], soon))))!))
      : null,
    can("inventory:stock:read" as never) ? lowStockCount() : null,
  ]);
  if (leave?.[0].n) items.push({ label: "Leave requests awaiting approval", count: leave[0].n, href: "/hr/leave?status=pending", tone: "warning" });
  if (drafts?.[0].n) items.push({ label: "Draft payroll runs to review", count: drafts[0].n, href: "/hr/payroll", tone: "warning" });
  if (expiring?.[0].n) items.push({ label: "Employees with documents expiring within 60 days", count: expiring[0].n, href: "/hr/employees", tone: "danger" });
  if (low) items.push({ label: "Products at or below reorder level", count: low, href: "/inventory/stock?low=1", tone: "danger" });
  void sql; void todayISO;
  return items;
}

export default async function DashboardPage() {
  const user = await requirePermission("dashboard:view");
  const items = await attention(user);
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => i.href !== "/" && user.permissions.has(i.permission)) })).filter((s) => s.items.length);
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`${greeting}, ${user.name.split(" ")[0]}`} description={`Signed in as ${user.role.name}. KPI cards and charts arrive in the final phase.`} />

      <section aria-labelledby="attn">
        <h2 id="attn" className="mb-2 text-sm text-muted-foreground">Needs your attention</h2>
        {items.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => (
              <Link key={a.label} href={a.href} className="group">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardContent className="flex items-start gap-3 p-4">
                    <AlertTriangle size={18} className={a.tone === "danger" ? "text-danger" : "text-warning"} />
                    <div className="flex-1"><div className="text-2xl font-semibold leading-none">{a.count}</div><div className="mt-1 text-sm text-muted-foreground">{a.label}</div></div>
                    <ArrowRight size={16} className="mt-1 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="gap-0 py-0"><CardContent className="p-4 text-sm text-muted-foreground">Nothing needs attention right now. <Badge variant="success">All clear</Badge></CardContent></Card>
        )}
      </section>

      {sections.map((s) => (
        <section key={s.title} aria-label={s.title}>
          <h2 className="mb-2 text-sm text-muted-foreground">{s.title}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {s.items.map((i) => (
              <Link key={i.href} href={i.href} className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-muted">{i.label}</Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
