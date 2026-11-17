import type { Metadata } from "next";
import Link from "next/link";
import { and, count, eq, isNotNull, lte, notInArray, or, sql } from "drizzle-orm";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { db } from "@/db";
import { employees, entryBills, exitBills, leaveRequests, payrollRuns } from "@/db/schema";
import { requirePermission, type CurrentUser } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { formatAED } from "@/lib/money";
import { listSales, receivables } from "@/services/billing";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

type Attention = { label: string; count: number; href: string; tone: "warning" | "danger" };

async function load(user: CurrentUser) {
  const can = (p: never) => user.permissions.has(p);
  const soon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  const [leave, drafts, expiring, staff, entriesM, exitsM, refund, cert, salesM, recv] = await Promise.all([
    can("hr:leave:approve" as never) ? db.select({ n: count() }).from(leaveRequests).where(eq(leaveRequests.status, "pending")) : null,
    can("hr:payroll:read" as never) ? db.select({ n: count() }).from(payrollRuns).where(eq(payrollRuns.status, "draft")) : null,
    can("hr:employee:read" as never)
      ? db.select({ n: count() }).from(employees).where(and(notInArray(employees.status, ["inactive", "terminated"]),
          or(...(["visaExpiry", "passportExpiry", "emiratesIdExpiry", "labourCardExpiry"] as const).map((c) => and(isNotNull(employees[c]), lte(employees[c], soon))))!))
      : null,
    can("hr:employee:read" as never) ? db.select({ n: count() }).from(employees).where(notInArray(employees.status, ["inactive", "terminated"])) : null,
    can("freezone:entry:read" as never) ? db.select({ n: count() }).from(entryBills).where(sql`to_char(${entryBills.billDate}::date, 'YYYY-MM') = ${month}`) : null,
    can("freezone:exit:read" as never) ? db.select({ n: count() }).from(exitBills).where(sql`to_char(${exitBills.exitDate}::date, 'YYYY-MM') = ${month}`) : null,
    can("freezone:exit:read" as never) ? db.select({ n: count() }).from(exitBills).where(eq(exitBills.refundStatus, "Pending")) : null,
    can("freezone:exit:read" as never) ? db.select({ n: count() }).from(exitBills).where(and(eq(exitBills.entryCertStatus, "Pending"), eq(exitBills.billType, "EXPORT"))) : null,
    can("sales:sale:read" as never) ? listSales({ from: `${month}-01`, size: 10 }) : null,
    can("sales:invoice:read" as never) ? receivables() : null,
  ]);
  const attention: Attention[] = [];
  if (leave?.[0].n) attention.push({ label: "Leave requests awaiting approval", count: leave[0].n, href: "/hr/leave?status=pending", tone: "warning" });
  if (drafts?.[0].n) attention.push({ label: "Draft payroll runs to review", count: drafts[0].n, href: "/hr/payroll", tone: "warning" });
  if (expiring?.[0].n) attention.push({ label: "Staff with a passport or visa expired or expiring within 90 days", count: expiring[0].n, href: "/hr/employees", tone: "danger" });
  if (refund?.[0].n) attention.push({ label: "Exit bills with refund pending", count: refund[0].n, href: "/freezone/exits?refund=Pending", tone: "warning" });
  if (cert?.[0].n) attention.push({ label: "Export bills awaiting the T/Entry certificate", count: cert[0].n, href: "/freezone/exits?cert=Pending&type=EXPORT", tone: "warning" });
  if (recv && recv.overdue.gt(0)) attention.push({ label: `Overdue receivables (${formatAED(recv.overdue.toFixed(2))})`, count: recv.rows.filter((r) => Number(r.overdue) > 0).length, href: "/sales/invoices?status=overdue", tone: "danger" });
  return { attention, staff: staff?.[0].n, entriesM: entriesM?.[0].n, exitsM: exitsM?.[0].n, salesM: salesM?.totals.net, outstanding: recv?.outstanding.toFixed(2) };
}

export default async function DashboardPage() {
  const user = await requirePermission("dashboard:view");
  const d = await load(user);
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => i.href !== "/" && user.permissions.has(i.permission)) })).filter((s) => s.items.length);
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const kpis = [d.staff !== undefined && <StatCard key="s" label="Active staff" value={d.staff} href="/hr/employees" />, d.entriesM !== undefined && <StatCard key="e" label="Entry bills this month" value={d.entriesM} href="/freezone/entries" />, d.exitsM !== undefined && <StatCard key="x" label="Exit bills this month" value={d.exitsM} href="/freezone/exits" />, d.salesM !== undefined && <StatCard key="m" label="Sales this month (net)" value={formatAED(d.salesM)} href="/sales" />, d.outstanding !== undefined && <StatCard key="o" label="Outstanding receivables" value={formatAED(d.outstanding)} href="/sales/invoices" />].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`${greeting}, ${user.name.split(" ")[0]}`} description={`Signed in as ${user.role.name}.`} />
      {kpis.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{kpis}</div>}

      <section aria-labelledby="attn">
        <h2 id="attn" className="mb-2 text-sm text-muted-foreground">Needs your attention</h2>
        {d.attention.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.attention.map((a) => (
              <Link key={a.label} href={a.href} className="group">
                <Card className="h-full gap-0 py-0 transition-shadow group-hover:shadow-md">
                  <CardContent className="flex items-start gap-3 px-4 py-4">
                    <AlertTriangle size={18} className={a.tone === "danger" ? "text-danger" : "text-warning"} />
                    <div className="flex-1"><div className="text-2xl font-semibold leading-none">{a.count}</div><div className="mt-1 text-sm text-muted-foreground">{a.label}</div></div>
                    <ArrowRight size={16} className="mt-1 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="gap-0 py-0"><CardContent className="px-4 py-4 text-sm text-muted-foreground">Nothing needs attention right now. <Badge variant="success">All clear</Badge></CardContent></Card>
        )}
      </section>

      {sections.map((s) => (
        <section key={s.title} aria-label={s.title}>
          <h2 className="mb-2 text-sm text-muted-foreground">{s.title}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {s.items.map((i) => <Link key={i.href} href={i.href} className="rounded-lg border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-muted">{i.label}</Link>)}
          </div>
        </section>
      ))}
    </div>
  );
}
