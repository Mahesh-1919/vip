import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { balanceSheet, cashFlow, profitAndLoss, trialBalance, vatReturn } from "@/services/accounting/reports";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TabsNav } from "@/components/tabs-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Financial reports" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const date = (v: string, d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);
const REPORTS = [["tb", "Trial balance"], ["pl", "Profit & loss"], ["bs", "Balance sheet"], ["cf", "Cash flow"], ["vat", "VAT return"]] as const;

function Rows({ rows }: { rows: { code?: string; name: string; amount: { toFixed(n: number): string } }[] }) {
  return <>{rows.map((r) => <TableRow key={(r.code ?? "") + r.name}><TableCell className="px-4">{r.code && <span className="font-mono text-xs text-muted-foreground">{r.code} </span>}{r.name}</TableCell><TableCell className="px-4 text-right">{formatAED(r.amount.toFixed(2))}</TableCell></TableRow>)}</>;
}
const Head = ({ children }: { children: string }) => <TableRow className="bg-muted/40 hover:bg-muted/40"><TableCell colSpan={2} className="px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</TableCell></TableRow>;
const Total = ({ label, v, strong }: { label: string; v: { toFixed(n: number): string }; strong?: boolean }) => <TableRow className={strong ? "font-semibold" : ""}><TableCell className="px-4">{label}</TableCell><TableCell className="px-4 text-right">{formatAED(v.toFixed(2))}</TableCell></TableRow>;

export default async function ReportsPage({ searchParams }: PageProps<"/accounting/reports">) {
  await requirePermission("accounting:report:read");
  const sp = await searchParams;
  const report = (REPORTS.map((r) => r[0]) as string[]).includes(one(sp.report)) ? one(sp.report) : "tb";
  const today = todayISO();
  const from = date(one(sp.from), today.slice(0, 8) + "01"), to = date(one(sp.to), today), asOf = date(one(sp.asOf), today);
  const periodic = report === "pl" || report === "cf" || report === "vat";
  const qs = new URLSearchParams({ report, from, to, asOf }).toString();
  const tabHref = (k: string) => `/accounting/reports?${new URLSearchParams({ report: k, from, to, asOf })}`;

  let body: React.ReactNode;
  if (report === "tb") {
    const t = await trialBalance(asOf);
    body = (<>
      <div className="flex gap-2"><Badge variant={t.balanced ? "success" : "danger"}>{t.balanced ? "Debits equal credits" : "OUT OF BALANCE"}</Badge></div>
      <Card className="gap-0 overflow-hidden py-0"><Table>
        <TableHeader className="bg-muted/50"><TableRow><TableHead className="px-4">Account</TableHead><TableHead className="px-4 text-right">Debit</TableHead><TableHead className="px-4 text-right">Credit</TableHead></TableRow></TableHeader>
        <TableBody>{t.rows.map((r) => <TableRow key={r.id}><TableCell className="px-4"><span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}</TableCell><TableCell className="px-4 text-right">{r.debit.isZero() ? "" : formatAED(r.debit.toFixed(2))}</TableCell><TableCell className="px-4 text-right">{r.credit.isZero() ? "" : formatAED(r.credit.toFixed(2))}</TableCell></TableRow>)}</TableBody>
        <TableFooter><TableRow><TableCell className="px-4">Total</TableCell><TableCell className="px-4 text-right">{formatAED(t.debit.toFixed(2))}</TableCell><TableCell className="px-4 text-right">{formatAED(t.credit.toFixed(2))}</TableCell></TableRow></TableFooter></Table></Card>
    </>);
  } else if (report === "pl") {
    const p = await profitAndLoss(from, to);
    body = (<>
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Income" value={formatAED(p.totalIncome.toFixed(2))} /><StatCard label="Expenses" value={formatAED(p.totalExpenses.toFixed(2))} /><StatCard label="Net profit" value={formatAED(p.netProfit.toFixed(2))} tone={p.netProfit.isNegative() ? "danger" : "success"} /></div>
      <Card className="gap-0 overflow-hidden py-0"><Table><TableBody>
        <Head>Income</Head><Rows rows={p.income} /><Total label="Total income" v={p.totalIncome} strong />
        <Head>Expenses</Head><Rows rows={p.expenses} /><Total label="Total expenses" v={p.totalExpenses} strong />
        <Total label="Gross profit (income − cost of goods sold)" v={p.grossProfit} /><Total label="Net profit" v={p.netProfit} strong />
      </TableBody></Table></Card>
    </>);
  } else if (report === "bs") {
    const b = await balanceSheet(asOf);
    body = (<>
      <Badge variant={b.balanced ? "success" : "danger"} className="w-fit">{b.balanced ? "Assets = liabilities + equity" : "OUT OF BALANCE"}</Badge>
      <Card className="gap-0 overflow-hidden py-0"><Table><TableBody>
        <Head>Assets</Head><Rows rows={b.assets} /><Total label="Total assets" v={b.totalAssets} strong />
        <Head>Liabilities</Head><Rows rows={b.liabilities} /><Total label="Total liabilities" v={b.totalLiabilities} strong />
        <Head>Equity</Head><Rows rows={b.equity} /><Total label="Profit for the period to date" v={b.earnings} /><Total label="Total equity" v={b.totalEquity} strong />
        <Total label="Liabilities + equity" v={b.totalLiabilities.plus(b.totalEquity)} strong />
      </TableBody></Table></Card>
    </>);
  } else if (report === "cf") {
    const c = await cashFlow(from, to);
    body = (<>
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Opening cash & bank" value={formatAED(c.opening.toFixed(2))} /><StatCard label="Net movement" value={formatAED(c.net.toFixed(2))} tone={c.net.isNegative() ? "danger" : "success"} /><StatCard label="Closing cash & bank" value={formatAED(c.closing.toFixed(2))} /></div>
      <Card className="gap-0 overflow-hidden py-0"><Table>
        <TableHeader className="bg-muted/50"><TableRow><TableHead className="px-4">Source</TableHead><TableHead className="px-4 text-right">Cash in</TableHead><TableHead className="px-4 text-right">Cash out</TableHead><TableHead className="px-4 text-right">Net</TableHead></TableRow></TableHeader>
        <TableBody>{c.groups.map((g) => <TableRow key={g.label}><TableCell className="px-4">{g.label}</TableCell><TableCell className="px-4 text-right">{formatAED(g.inflow.toFixed(2))}</TableCell><TableCell className="px-4 text-right">{formatAED(g.outflow.toFixed(2))}</TableCell><TableCell className="px-4 text-right font-medium">{formatAED(g.net.toFixed(2))}</TableCell></TableRow>)}
          {!c.groups.length && <TableRow><TableCell colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No cash movements in this period.</TableCell></TableRow>}</TableBody></Table></Card>
    </>);
  } else {
    const v = await vatReturn(from, to);
    const row = (box: string, label: string, net: { toFixed(n: number): string } | null, vat: { toFixed(n: number): string } | null) => <TableRow key={box}><TableCell className="px-4 font-mono text-xs text-muted-foreground">{box}</TableCell><TableCell className="px-4">{label}</TableCell><TableCell className="px-4 text-right">{net ? formatAED(net.toFixed(2)) : ""}</TableCell><TableCell className="px-4 text-right">{vat ? formatAED(vat.toFixed(2)) : ""}</TableCell></TableRow>;
    body = (<>
      <div className="grid gap-3 sm:grid-cols-3"><StatCard label="Output VAT" value={formatAED(v.outputVat.toFixed(2))} /><StatCard label="Input VAT (recoverable)" value={formatAED(v.inputVat.toFixed(2))} /><StatCard label={v.netPayable.isNegative() ? "VAT refundable" : "VAT payable to FTA"} value={formatAED(v.netPayable.abs().toFixed(2))} tone={v.netPayable.isNegative() ? "success" : "danger"} /></div>
      <Card className="gap-0 overflow-hidden py-0"><Table>
        <TableHeader className="bg-muted/50"><TableRow><TableHead className="px-4 w-16">Box</TableHead><TableHead className="px-4">Description</TableHead><TableHead className="px-4 text-right">Amount (AED)</TableHead><TableHead className="px-4 text-right">VAT (AED)</TableHead></TableRow></TableHeader>
        <TableBody>
          {row("1", "Standard-rated supplies", v.standard.net, v.standard.vat)}
          {row("4", "Zero-rated supplies (incl. exports)", v.zero.net, null)}
          {row("5", "Exempt supplies", v.exempt.net, null)}
          {row("-", "Out of scope", v.outOfScope.net, null)}
          {row("8", "Total output VAT", null, v.outputVat)}
          {row("10", "Input VAT recoverable (incl. import VAT on costs)", null, v.inputVat)}
          <TableRow className="font-semibold"><TableCell className="px-4">14</TableCell><TableCell className="px-4">Net VAT {v.netPayable.isNegative() ? "refundable" : "payable"}</TableCell><TableCell /><TableCell className="px-4 text-right">{formatAED(v.netPayable.toFixed(2))}</TableCell></TableRow>
        </TableBody></Table></Card>
      <p className="text-xs text-muted-foreground">A summary to prepare the FTA Form 201; box numbers are indicative. Customs-declared import VAT and emirate-level splits are not captured. Review with your tax adviser before filing.</p>
    </>);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Financial reports" description="From the ledger, in AED."
        actions={<><a className={buttonVariants({ variant: "outline" })} href={`/api/accounting/export?${qs}&format=csv`}>CSV</a><a className={buttonVariants({ variant: "outline" })} href={`/api/accounting/export?${qs}&format=xlsx`}>Excel</a></>} />
      <TabsNav active={report} tabs={REPORTS.map(([key, label]) => ({ key, label, href: tabHref(key) }))} />
      <FilterBar>
        <input type="hidden" name="report" value={report} />
        {periodic ? <><Input type="date" name="from" defaultValue={from} aria-label="From" className="w-40" /><Input type="date" name="to" defaultValue={to} aria-label="To" className="w-40" /></> : <Input type="date" name="asOf" defaultValue={asOf} aria-label="As of" className="w-40" />}
        <Button variant="outline" type="submit">Apply</Button>
      </FilterBar>
      {body}
    </div>
  );
}
