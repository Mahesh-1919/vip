import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { Search } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatSheetDate } from "@/lib/dates";
import { containersOf, traceCustomer, traceEntries } from "@/services/trace";
import { customerOptions } from "@/services/billing";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Shipment trace" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const n = (v: string | number, d = 0) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v));

function Containers({ text }: { text: string | null }) {
  const list = containersOf(text);
  if (!list.length) return <span className="text-muted-foreground">—</span>;
  return <span className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-xs">{list.map((c) => <Link key={c} href={`/freezone/trace?q=${encodeURIComponent(c)}`} className="text-primary hover:underline">{c}</Link>)}</span>;
}

function InvoiceCell({ billed, packages, canOpen }: { billed: { pk: number; invoices: { id: string; number: string }[] }; packages: number; canOpen: boolean }) {
  if (!billed.pk) return <Badge variant="warning">Not invoiced</Badge>;
  return (
    <div className="space-y-0.5">
      <Badge variant={billed.pk >= packages ? "success" : "info"}>{n(billed.pk)} / {n(packages)} pkgs</Badge>
      <div className="flex flex-wrap gap-x-2 text-xs">{billed.invoices.map((i) => canOpen ? <Link key={i.id} href={`/sales/invoices/${i.id}`} className="font-mono text-primary hover:underline">{i.number}</Link> : <span key={i.id} className="font-mono">{i.number}</span>)}</div>
    </div>
  );
}

export default async function TracePage({ searchParams }: PageProps<"/freezone/trace">) {
  const user = await requirePermission("freezone:entry:read", "freezone:exit:read");
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80);
  const customerId = z.uuid().safeParse(one(sp.customerId)).data;
  const entryId = z.uuid().safeParse(one(sp.entry)).data;
  const canInvoices = user.permissions.has("sales:invoice:read");
  const customers = await customerOptions();
  const [byEntry, byCustomer] = await Promise.all([customerId ? null : traceEntries({ q: q || undefined, entryId }), customerId ? traceCustomer(customerId) : null]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Shipment trace" description="Pick an import (by container number, bill, transfer or invoice number) and see when it arrived, who received how many packages, through which exit and truck, and what has been invoiced." />
      <Card className="gap-0 py-0"><CardContent className="px-4 py-4">
        <FilterBar className="items-end">
          <div className="flex items-center gap-2"><Search size={16} className="text-muted-foreground" /><Input name="q" defaultValue={q} placeholder="Container no, bill no, transfer no, invoice no, agent…" className="w-96" /></div>
          <Button type="submit">Trace import</Button>
          <span className="px-2 text-sm text-muted-foreground">or</span>
          <NativeSelect name="customerId" defaultValue={customerId ?? ""} wrapperClassName="w-60"><NativeSelectOption value="">By customer…</NativeSelectOption>{customers.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect>
          <Button type="submit" variant="outline">Trace customer</Button>
        </FilterBar>
      </CardContent></Card>

      {byCustomer && (
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="py-5"><CardTitle>{customers.find((c) => c.id === customerId)?.name}</CardTitle><CardDescription>Every export bill for this customer, the import(s) the goods came from, and invoicing.</CardDescription></CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader className="bg-muted/50"><TableRow><TableHead className="px-3">Exit date</TableHead><TableHead className="px-3">Exit bill (BOE)</TableHead><TableHead className="px-3">Truck / container</TableHead><TableHead className="px-3 text-right">Packages</TableHead><TableHead className="px-3">Came from (entry bill · containers)</TableHead><TableHead className="px-3">Invoice</TableHead></TableRow></TableHeader>
              <TableBody>
                {byCustomer.map(({ exit: x, sources, billed }) => (
                  <TableRow key={x.id} className="align-top">
                    <TableCell className="px-3 whitespace-nowrap">{formatSheetDate(x.exitDate)}</TableCell>
                    <TableCell className="px-3"><Link href={`/freezone/exits/${x.id}`} className="font-mono text-xs text-primary hover:underline">{x.boeNo}</Link><div className="text-xs text-muted-foreground">{x.portOfDischarge}</div></TableCell>
                    <TableCell className="px-3 whitespace-normal"><Containers text={x.truckContainerNo} /></TableCell>
                    <TableCell className="px-3 text-right">{n(x.packages)}</TableCell>
                    <TableCell className="px-3 whitespace-normal">{sources.length ? sources.map((s) => <div key={s.a.id} className="text-xs"><Link href={`/freezone/trace?entry=${s.entryId}`} className="font-mono text-primary hover:underline">{s.billNo}</Link> · {formatSheetDate(s.billDate)} · <b>{n(s.a.packages)}</b> pkgs<div className="text-muted-foreground"><Containers text={s.marks} /></div></div>) : <Badge variant="warning">Not linked to an entry</Badge>}</TableCell>
                    <TableCell className="px-3">{x.billType === "EXPORT" ? <InvoiceCell billed={billed} packages={x.packages} canOpen={canInvoices} /> : <span className="text-xs text-muted-foreground">import bill</span>}</TableCell>
                  </TableRow>
                ))}
                {!byCustomer.length && <TableRow><TableCell colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No export bills for this customer yet.</TableCell></TableRow>}
              </TableBody>
              {byCustomer.length > 0 && <TableFooter><TableRow><TableCell colSpan={3} className="px-3">Total</TableCell><TableCell className="px-3 text-right">{n(byCustomer.reduce((s, r) => s + r.exit.packages, 0))}</TableCell><TableCell colSpan={2} /></TableRow></TableFooter>}
            </Table>
          </CardContent>
        </Card>
      )}

      {byEntry && !byEntry.traces.length && <Card className="gap-0 py-0"><CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">No import found for “{q}”.</CardContent></Card>}
      {byEntry && !q && !entryId && byEntry.traces.length > 0 && <p className="text-sm text-muted-foreground">Showing the 10 most recent imports. Search above to find a specific container or bill.</p>}

      {byEntry?.traces.map((t) => (
        <Card key={t.entry.id} className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2"><Link href={`/freezone/entries/${t.entry.id}`} className="font-mono text-primary hover:underline">{t.entry.billNo}</Link>
                  <Badge variant={t.remaining <= 0 ? "secondary" : t.exported > 0 ? "warning" : "success"}>{t.remaining <= 0 ? "Fully exported" : t.exported > 0 ? "Partly exported" : "In stock"}</Badge>
                  {t.weightFlag && <Badge variant="danger">Linked weight exceeds imported weight</Badge>}</CardTitle>
                <CardDescription className="mt-1">Imported {formatSheetDate(t.entry.billDate)}{t.entry.arrivalDate ? ` · arrived ${formatSheetDate(t.entry.arrivalDate)}` : ""} · agent {t.entry.agentName ?? "—"} · {t.entry.portOfLoading ?? "?"} → {t.entry.portOfDischarge ?? "?"}{t.entry.originCountry ? ` · origin ${t.entry.originCountry}` : ""}{t.entry.line ? ` · ${t.entry.line}` : ""}</CardDescription>
                <div className="mt-2 text-sm"><span className="text-muted-foreground">Containers: </span><Containers text={t.entry.marksNumbers} /></div>
                <div className="mt-1 text-xs text-muted-foreground">Transfer {t.entry.transferNo ?? "—"} · invoice {t.entry.invoiceNo ?? "—"} · value AED {n(t.entry.valueAed, 2)}</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Packages imported" value={n(t.entry.packages)} hint={`${n(t.entry.weightKg)} kg`} />
              <StatCard label="Exported" value={n(t.exported)} hint={`${t.entry.packages ? Math.round((t.exported / t.entry.packages) * 100) : 0}% · ${n(t.exportedKg.toFixed(2))} kg`} />
              <StatCard label="Remaining in the zone" value={n(t.remaining)} tone={t.remaining < 0 ? "danger" : t.remaining === 0 ? undefined : "success"} />
              <StatCard label="Customers served" value={t.customers.length} />
            </div>

            {t.customers.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium">Who received these goods</h3>
                <div className="flex flex-wrap gap-2">{t.customers.map((c) => <Badge key={c.name} variant="secondary" className="px-3 py-1 text-sm font-normal">{c.name}: <b className="ml-1">{n(c.packages)}</b>&nbsp;pkgs{c.exits > 1 ? ` · ${c.exits} exits` : ""}</Badge>)}</div>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="bg-muted/50"><TableRow><TableHead className="px-3">Exit date</TableHead><TableHead className="px-3">Customer</TableHead><TableHead className="px-3">Exit bill (BOE)</TableHead><TableHead className="px-3">Truck / container</TableHead><TableHead className="px-3">Destination</TableHead><TableHead className="px-3 text-right">Packages from this import</TableHead><TableHead className="px-3">Invoice</TableHead></TableRow></TableHeader>
                <TableBody>
                  {t.exits.map(({ alloc, exit: x, customer, billed }) => (
                    <TableRow key={alloc.id} className="align-top">
                      <TableCell className="px-3 whitespace-nowrap">{formatSheetDate(x.exitDate)}</TableCell>
                      <TableCell className="px-3 whitespace-normal">{customer ?? x.importerName ?? "—"}{!customer && <div className="text-xs text-warning">customer not linked</div>}</TableCell>
                      <TableCell className="px-3"><Link href={`/freezone/exits/${x.id}`} className="font-mono text-xs text-primary hover:underline">{x.boeNo}</Link> <Badge variant={x.billType === "EXPORT" ? "info" : "secondary"}>{x.billType}</Badge></TableCell>
                      <TableCell className="px-3 whitespace-normal"><Containers text={x.truckContainerNo} /></TableCell>
                      <TableCell className="px-3">{x.portOfDischarge}{x.country ? ` (${x.country})` : ""}</TableCell>
                      <TableCell className="px-3 text-right font-medium">{n(alloc.packages)}{alloc.overReason && <div className="text-xs font-normal text-warning" title={alloc.overReason}>over-export</div>}</TableCell>
                      <TableCell className="px-3">{x.billType === "EXPORT" ? <InvoiceCell billed={billed} packages={x.packages} canOpen={canInvoices} /> : <span className="text-xs text-muted-foreground">import bill</span>}</TableCell>
                    </TableRow>
                  ))}
                  {!t.exits.length && <TableRow><TableCell colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Nothing has left this import yet: all {n(t.entry.packages)} packages are still in the zone.</TableCell></TableRow>}
                </TableBody>
                {t.exits.length > 0 && <TableFooter><TableRow><TableCell colSpan={5} className="px-3">Total exported</TableCell><TableCell className="px-3 text-right">{n(t.exported)}</TableCell><TableCell /></TableRow></TableFooter>}
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}

      {byEntry && byEntry.unlinkedExits.length > 0 && (
        <Card className="gap-0 overflow-hidden border-warning/40 py-0">
          <CardHeader className="py-4"><CardTitle>Exit bills mentioning “{q}” that are not linked to any import</CardTitle><CardDescription>These went out without a recorded source. Open each one and link it to the entry bill it came from.</CardDescription></CardHeader>
          <CardContent className="px-0">
            <Table><TableBody>
              {byEntry.unlinkedExits.map((x) => (
                <TableRow key={x.id}><TableCell className="px-4 whitespace-nowrap">{formatSheetDate(x.exitDate)}</TableCell><TableCell className="px-4"><Link href={`/freezone/exits/${x.id}`} className="font-mono text-xs text-primary hover:underline">{x.boeNo}</Link></TableCell><TableCell className="px-4">{x.customer ?? x.importerName}</TableCell><TableCell className="px-4 text-right">{n(x.packages)} pkgs</TableCell><TableCell className="px-4"><Containers text={x.truckContainerNo} /></TableCell></TableRow>
              ))}
            </TableBody></Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
