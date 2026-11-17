import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, isNotNull, lte, notInArray, or, sql } from "drizzle-orm";
import { Boxes, CalendarOff, ChevronRight, CircleAlert, Users, PackagePlus, PackageMinus, ReceiptText, ShoppingCart, Wallet, CheckCircle2 } from "lucide-react";
import { db } from "@/db";
import { employees, entryBills, exitBills, leaveRequests, payrollRuns } from "@/db/schema";
import { requirePermission, type CurrentUser } from "@/lib/auth";
import { formatAED } from "@/lib/money";
import { listSales, receivables } from "@/services/billing";
import { linkSummary } from "@/services/freezone";
import { PageHeader } from "@/components/page-header";
import { FlowChart } from "@/components/flow-chart";
import { expiringDocuments, monthlyFlow, recentEntries, recentExits, recentInvoices } from "@/services/dashboard";
import { stateOf } from "@/services/billing";
import { StatusBadge } from "@/components/status-badge";
import { formatSheetDate } from "@/lib/dates";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };
export const instant = false; // session-dependent page: see (dashboard)/layout.tsx

type Attention = { label: string; count: number; href: string; tone: "warning" | "danger" };

async function load(user: CurrentUser) {
  const can = (p: never) => user.permissions.has(p);
  const soon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  const todayIso = new Date().toISOString().slice(0, 10);
  const [leave, drafts, expiring, staff, entriesM, exitsM, refund, cert, salesM, recv, links, onLeave, payroll] = await Promise.all([
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
    can("freezone:exit:read" as never) || can("sales:invoice:write" as never) ? linkSummary() : null,
    can("hr:leave:read" as never) ? db.select({ n: count() }).from(leaveRequests).where(and(eq(leaveRequests.status, "approved"), lte(leaveRequests.fromDate, todayIso), sql`${leaveRequests.toDate} >= ${todayIso}`)) : null,
    can("hr:payroll:read" as never) ? db.select({ net: payrollRuns.totalNet, year: payrollRuns.year, month: payrollRuns.month }).from(payrollRuns).where(sql`${payrollRuns.status} <> 'draft'`).orderBy(desc(payrollRuns.year), desc(payrollRuns.month)).limit(1) : null,
  ]);
  const attention: Attention[] = [];
  if (leave?.[0].n) attention.push({ label: "Leave requests awaiting approval", count: leave[0].n, href: "/hr/leave?status=pending", tone: "warning" });
  if (drafts?.[0].n) attention.push({ label: "Draft payroll runs to review", count: drafts[0].n, href: "/hr/payroll", tone: "warning" });
  if (expiring?.[0].n) attention.push({ label: "Staff documents expired or expiring (90 days)", count: expiring[0].n, href: "/hr/employees", tone: "danger" });
  if (refund?.[0].n) attention.push({ label: "Exit bills with refund pending", count: refund[0].n, href: "/freezone/exits?refund=Pending", tone: "warning" });
  if (cert?.[0].n) attention.push({ label: "Export bills awaiting T/Entry certificate", count: cert[0].n, href: "/freezone/exits?cert=Pending&type=EXPORT", tone: "warning" });
  if (links?.unlinked && can("freezone:exit:read" as never)) attention.push({ label: "Exit bills not linked to an entry bill", count: links.unlinked, href: "/freezone/exits?alloc=none", tone: "warning" });
  if (links?.unbilledExports && can("sales:invoice:write" as never)) attention.push({ label: "Export bills still to invoice", count: links.unbilledExports, href: "/sales/invoices/new", tone: "warning" });
  if (recv && recv.overdue.gt(0)) attention.push({ label: `Overdue invoices (${formatAED(recv.overdue.toFixed(2))})`, count: recv.rows.filter((r) => Number(r.overdue) > 0).length, href: "/sales/invoices?status=overdue", tone: "danger" });
  return { attention, staff: staff?.[0].n, entriesM: entriesM?.[0].n, exitsM: exitsM?.[0].n, salesM: salesM?.totals.net, outstanding: recv?.outstanding.toFixed(2), overdue: recv?.overdue.toFixed(2), stockPackages: can("freezone:entry:read" as never) ? links?.stockPackages : undefined, onLeave: onLeave?.[0].n, payroll: payroll?.[0], payrollKnown: !!payroll };
}

const n = (v: string | number) => new Intl.NumberFormat("en-US").format(Number(v));

function ListCard({ title, description, href, children }: { title: string; description?: string; href?: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0 gap-0 overflow-hidden py-0">
      <CardHeader className="flex flex-row items-start justify-between gap-2 border-b py-4">
        <div><CardTitle className="text-base">{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>
        {href && <Link href={href} className="text-sm text-primary hover:underline">View all</Link>}
      </CardHeader>
      <CardContent className="px-0">{children}</CardContent>
    </Card>
  );
}
const Row = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="flex items-center justify-between gap-3 border-b px-6 py-2.5 text-sm last:border-b-0 hover:bg-muted/50">{children}</Link>;
const Empty = ({ text }: { text: string }) => <p className="px-6 py-8 text-center text-sm text-muted-foreground">{text}</p>;

export default async function DashboardPage() {
  const user = await requirePermission("dashboard:view");
  const can = (p: string) => user.permissions.has(p as never);
  const d = await load(user);
  const [flow, entries, exits, invs, docs] = await Promise.all([
    can("freezone:entry:read") ? monthlyFlow() : null, can("freezone:entry:read") ? recentEntries() : null, can("freezone:exit:read") ? recentExits() : null,
    can("sales:invoice:read") ? recentInvoices() : null, can("hr:employee:read") ? expiringDocuments() : null,
  ]);
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" });
  const kpis = [
    d.staff !== undefined && <StatCard key="s" label="Active staff" value={d.staff} href="/hr/employees" icon={<Users />} />,
    d.onLeave !== undefined && <StatCard key="l" label="Staff on leave today" value={d.onLeave} href="/hr/leave" icon={<CalendarOff />} />,
    d.payrollKnown && <StatCard key="p" label="Latest payroll (net)" value={d.payroll ? formatAED(d.payroll.net) : "—"} hint={d.payroll ? new Date(d.payroll.year, d.payroll.month - 1).toLocaleString("en-GB", { month: "long", year: "numeric" }) : "No finalised payroll yet"} href="/hr/payroll" icon={<Wallet />} />,
    d.entriesM !== undefined && <StatCard key="e" label="Entry bills this month" value={d.entriesM} href="/freezone/entries" icon={<PackagePlus />} />,
    d.exitsM !== undefined && <StatCard key="x" label="Exit bills this month" value={d.exitsM} href="/freezone/exits" icon={<PackageMinus />} />,
    d.stockPackages !== undefined && <StatCard key="k" label="Packages in the zone" value={n(d.stockPackages)} hint="Imported and not yet exported" href="/freezone/entries?open=1" icon={<Boxes />} />,
    d.salesM !== undefined && <StatCard key="m" label="Sales this month (net)" value={formatAED(d.salesM)} href="/sales" icon={<ShoppingCart />} />,
    d.outstanding !== undefined && <StatCard key="o" label="Outstanding receivables" value={formatAED(d.outstanding)} href="/sales/invoices" icon={<ReceiptText />} />,
    d.overdue !== undefined && <StatCard key="d" label="Overdue receivables" value={formatAED(d.overdue)} tone={Number(d.overdue) > 0 ? "danger" : undefined} href="/sales/invoices?status=overdue" icon={<CircleAlert />} />,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`${greeting}, ${user.name.split(" ")[0]}`} description={today} />
      {kpis.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{kpis}</div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ListCard title="Needs your attention" description={d.attention.length ? `${d.attention.length} item${d.attention.length === 1 ? "" : "s"} to follow up` : undefined}>
          {d.attention.length ? d.attention.map((a) => (
            <Row key={a.label} href={a.href}>
              <span className="flex min-w-0 flex-1 items-center gap-3"><CircleAlert size={16} className={a.tone === "danger" ? "shrink-0 text-danger" : "shrink-0 text-warning"} /><span className="truncate text-muted-foreground">{a.label}</span></span>
              <span className="flex shrink-0 items-center gap-1"><Badge variant={a.tone === "danger" ? "danger" : "warning"}>{a.count}</Badge><ChevronRight size={14} className="text-muted-foreground" /></span>
            </Row>
          )) : <div className="flex flex-col items-center gap-2 px-6 py-10 text-sm text-muted-foreground"><CheckCircle2 className="text-success" />All clear: nothing needs attention.</div>}
        </ListCard>
        {flow && (
          <Card className="min-w-0 gap-0 py-0">
            <CardHeader className="border-b py-4"><CardTitle className="text-base">Goods in and out</CardTitle><CardDescription>Packages on entry bills vs exit bills, last six months</CardDescription></CardHeader>
            <CardContent className="px-4 py-4"><FlowChart data={flow} /></CardContent>
          </Card>
        )}
        {!flow && invs && (
          <div>
            <ListCard title="Latest invoices" href="/sales/invoices">
              {invs.length ? invs.map((i) => <Row key={i.id} href={`/sales/invoices/${i.id}`}><span><span className="font-mono text-xs">{i.number}</span> <span className="text-muted-foreground">· {i.customer}</span></span><span className="flex items-center gap-3"><span>{formatAED(i.total)}</span><StatusBadge status={stateOf({ total: i.total, paidAmount: i.paid, dueDate: i.due })} /></span></Row>) : <Empty text="No invoices yet." />}
            </ListCard>
          </div>
        )}
      </div>

      {(entries || exits) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {entries && <ListCard title="Latest entry bills" description="Goods arriving in the zone" href="/freezone/entries">
            {entries.length ? entries.map((e) => <Row key={e.id} href={`/freezone/entries/${e.id}`}><span className="min-w-0"><span className="font-mono text-xs">{e.billNo}</span><span className="block truncate text-xs text-muted-foreground">{e.agent ?? "—"} · {formatSheetDate(e.date)}</span></span><span className="shrink-0 text-right"><b>{n(e.packages)}</b> <span className="text-xs text-muted-foreground">pkgs{e.origin ? ` · ${e.origin}` : ""}</span></span></Row>) : <Empty text="No entry bills yet." />}
          </ListCard>}
          {exits && <ListCard title="Latest exit bills" description="Goods leaving the zone" href="/freezone/exits">
            {exits.length ? exits.map((e) => <Row key={e.id} href={`/freezone/exits/${e.id}`}><span className="min-w-0"><span className="font-mono text-xs">{e.boeNo}</span><span className="block truncate text-xs text-muted-foreground">{e.importer ?? "—"} · {formatSheetDate(e.date)}</span></span><span className="flex shrink-0 items-center gap-3"><span><b>{n(e.packages)}</b> <span className="text-xs text-muted-foreground">pkgs</span></span><Badge variant={e.type === "EXPORT" ? "info" : "secondary"}>{e.type}</Badge></span></Row>) : <Empty text="No exit bills yet." />}
          </ListCard>}
        </div>
      )}

      {((invs && flow) || docs) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {invs && flow && <ListCard title="Latest invoices" href="/sales/invoices">
            {invs.length ? invs.map((i) => <Row key={i.id} href={`/sales/invoices/${i.id}`}><span className="min-w-0"><span className="font-mono text-xs">{i.number}</span><span className="block truncate text-xs text-muted-foreground">{i.customer} · {formatSheetDate(i.date)}</span></span><span className="flex shrink-0 items-center gap-3"><span>{formatAED(i.total)}</span><StatusBadge status={stateOf({ total: i.total, paidAmount: i.paid, dueDate: i.due })} /></span></Row>) : <Empty text="No invoices yet." />}
          </ListCard>}
          {docs && <ListCard title="Documents expiring soon" description="Passports, visas and cards: expired or due within 90 days" href="/hr/employees">
            {docs.length ? docs.map((x, i) => <Row key={i} href={`/hr/employees/${x.id}`}><span className="min-w-0"><span className="block truncate font-medium">{x.name}</span><span className="text-xs text-muted-foreground">{x.doc}</span></span><Badge variant={(x.days ?? 0) < 0 ? "danger" : "warning"}>{(x.days ?? 0) < 0 ? `Expired ${Math.abs(x.days ?? 0)}d ago` : `${x.days}d left`}</Badge></Row>) : <Empty text="No documents expiring in the next 90 days." />}
          </ListCard>}
        </div>
      )}
    </div>
  );
}
