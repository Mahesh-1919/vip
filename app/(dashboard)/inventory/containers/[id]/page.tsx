import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { allowedNext, FLOW, POSTING_STATUS } from "@/lib/container";
import { todayISO } from "@/lib/dates";
import { formatDate } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { formatAED } from "@/lib/money";
import { COST_TYPE_LABELS, CURRENCIES } from "@/validators/containers";
import { getContainer, supplierOptions, customerOptions } from "@/services/inventory/containers";
import { listWarehouses, packagingOptions, productOptions } from "@/services/inventory/stock";
import { ActionForm } from "@/components/action-form";
import { DataTable, type Column } from "@/components/data-table";
import { CheckboxField, SelectField, TextField, TextareaField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addCostAction, addItemAction, removeCostAction, removeItemAction, statusAction } from "../actions";
import { ContainerForm } from "../container-form";

export const metadata: Metadata = { title: "Container" };

function RemoveButton({ action, id }: { action: (f: FormData) => Promise<void>; id: string }) {
  return <form action={action}><input type="hidden" name="id" value={id} /><Button size="sm" variant="ghost" type="submit">Remove</Button></form>;
}

export default async function ContainerPage({ params }: PageProps<"/inventory/containers/[id]">) {
  const user = await requirePermission("inventory:container:read");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await getContainer(id.data);
  if (!data) notFound();
  const { c, items, costs, landed, supplier, customer, warehouse } = data;
  const inward = c.direction === "inward";
  const canWrite = user.permissions.has("inventory:container:write");
  const locked = !!c.stockPostedAt || c.status === "cancelled";
  const [products, packs, whs, parties, suppliers] = await Promise.all([
    productOptions(), packagingOptions(), listWarehouses(), inward ? supplierOptions() : customerOptions(), supplierOptions(),
  ]);
  const next = allowedNext(c.direction, c.status, !!c.stockPostedAt);
  const posting = POSTING_STATUS[c.direction];
  const flow = FLOW[c.direction];

  const goods = landed.lines.reduce((s, l) => s + l.goodsAed.toNumber(), 0);
  const capitalised = costs.filter((k) => k.inLandedCost).reduce((s, k) => s + Number(k.amountAed), 0);
  const expensed = costs.filter((k) => !k.inLandedCost).reduce((s, k) => s + Number(k.amountAed), 0);

  const itemCols: Column<(typeof items)[number]>[] = [
    { key: "sku", header: "Product", cell: ({ sku, name }) => <>{name}<div className="font-mono text-xs text-muted-foreground">{sku}</div></> },
    { key: "qty", header: "Qty", align: "right", cell: ({ i, uom }) => <>{formatQty(i.qty)} {uom}{i.enteredAs && <div className="text-xs text-muted-foreground">{i.enteredAs}</div>}</> },
    { key: "price", header: `Unit price (${c.currency})`, align: "right", cell: ({ i }) => formatQty(i.unitPrice) },
    { key: "lot", header: "Batch / serials", cell: ({ i }) => <span className="font-mono text-xs">{i.serials?.length ? `${i.serials.length} serials: ${i.serials.slice(0, 3).join(", ")}${i.serials.length > 3 ? "…" : ""}` : i.lotNo ? `${i.lotNo}${i.expiryDate ? ` (exp ${formatDate(i.expiryDate)})` : ""}` : "—"}</span> },
    { key: "wt", header: "Weight / volume", align: "right", cell: ({ i }) => <span className="text-muted-foreground">{formatQty(i.weightKg)} kg · {formatQty(i.volumeCbm)} m³</span> },
    ...(canWrite && !locked ? [{ key: "rm", header: "", cell: ({ i }: { i: { id: string } }) => <RemoveButton action={removeItemAction} id={i.id} /> }] : []),
  ];
  const costCols: Column<(typeof costs)[number]>[] = [
    { key: "date", header: "Date", cell: (k) => formatDate(k.incurredOn) },
    { key: "type", header: "Type", cell: (k) => <>{COST_TYPE_LABELS[k.type] ?? k.type}{k.description && <div className="text-xs text-muted-foreground">{k.description}</div>}</> },
    { key: "amt", header: "Amount", align: "right", cell: (k) => k.currency === "AED" ? formatAED(k.amount) : <>{formatQty(k.amount)} {k.currency}<div className="text-xs text-muted-foreground">@ {formatQty(k.exchangeRate)}</div></> },
    { key: "aed", header: "AED", align: "right", cell: (k) => formatAED(k.amountAed) },
    { key: "vat", header: "VAT (recoverable)", align: "right", cell: (k) => Number(k.vatAed) ? formatAED(k.vatAed) : "—" },
    { key: "basis", header: "Allocation", cell: (k) => k.inLandedCost ? <Badge variant="info" className="capitalize">by {k.allocation}</Badge> : <Badge variant="secondary">Expensed</Badge> },
    ...(canWrite ? [{ key: "rm", header: "", cell: (k: { id: string; inLandedCost: boolean }) => (locked && k.inLandedCost) || c.status === "cancelled" ? null : <RemoveButton action={removeCostAction} id={k.id} /> }] : []),
  ];
  const sel = (arr: { id: string; name: string }[]) => arr.map((x) => ({ value: x.id, label: x.name }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: "/inventory/containers", label: "Containers" }}
        title={<>{c.containerNo} <span className="font-mono text-base font-normal text-muted-foreground">{c.ref}</span></>}
        description={<>{inward ? "Import from" : "Export to"} <b>{supplier ?? customer}</b> · {[c.loadPort, c.dischargePort].filter(Boolean).join(" → ") || "route not set"}{warehouse ? ` · ${warehouse}` : ""}</>}
        actions={<><Badge variant={inward ? "info" : "secondary"}>{inward ? "Import" : "Export"}</Badge><StatusBadge status={c.status} /></>} />

      {/* Status flow */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {flow.map((s, i) => {
              const reached = c.status !== "cancelled" && flow.indexOf(c.status) >= i;
              return <li key={s} className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 capitalize ${reached ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{s.replace(/_/g, " ")}</span>{i < flow.length - 1 && <span className="text-muted-foreground">→</span>}</li>;
            })}
            {c.status === "cancelled" && <li><Badge variant="danger">Cancelled</Badge></li>}
          </ol>
          {canWrite && next.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {next.map((to) => (
                <ActionForm key={to} action={statusAction.bind(null, c.id, to)} submit={to === "cancelled" ? "Cancel container" : `Mark ${to.replace(/_/g, " ")}`} variant={to === "cancelled" ? "destructive" : to === posting ? "default" : "outline"} resetOnSuccess={false}
                  confirm={to === posting ? (inward ? "Receiving posts every item into stock at its landed cost. It cannot be undone and locks the item list." : "Dispatching deducts every item from stock. It cannot be undone and locks the item list. It fails if stock is short.")
                    : to === "cancelled" ? "Cancel this container? This cannot be undone." : `Move this container to “${to.replace(/_/g, " ")}”? You cannot go back.`} />
              ))}
            </div>
          )}
          {c.stockPostedAt && <p className="text-sm text-muted-foreground">Stock {inward ? "received" : "dispatched"} on {formatDate(c.stockPostedAt)}. Items and costs in stock valuation are locked.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`Goods value (AED)`} value={formatAED(goods)} hint={c.currency !== "AED" ? `at ${formatQty(c.exchangeRate)} ${c.currency}/AED` : undefined} />
        <StatCard label="Landed costs" value={formatAED(capitalised)} hint="Added to stock value" />
        <StatCard label="Total landed" value={formatAED(goods + capitalised)} />
        <StatCard label="Other costs (expensed)" value={formatAED(expensed)} />
      </div>

      <Card className="gap-0 py-0 overflow-hidden"><CardHeader className="py-5"><CardTitle>Items</CardTitle><CardDescription>{inward ? "Goods in this container." : "Goods being shipped. Dispatch deducts them from stock."}{locked && " Locked."}</CardDescription></CardHeader>
        <CardContent className="px-0"><DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={itemCols} rows={items} rowKey={(r) => r.i.id} empty={{ title: "No items yet", hint: "Add the goods below." }} /></CardContent></Card>
      {canWrite && !locked && (
        <Card><CardHeader><CardTitle>Add item</CardTitle><CardDescription>Batch products need a batch number; serial products need the serial list (one per line).</CardDescription></CardHeader><CardContent>
          <ActionForm action={addItemAction} submit="Add item" className="grid gap-4 sm:grid-cols-3">
            <input type="hidden" name="containerId" value={c.id} />
            <SelectField className="sm:col-span-3" name="productId" label="Product" required options={products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name} (${p.uom}, ${p.tracking})` }))} />
            <TextField name="qty" label="Quantity" inputMode="decimal" />
            <SelectField name="packagingId" label="Entered in" placeholder="Base unit" options={packs.map((k) => ({ value: k.id, label: `${k.sku}: ${k.name} (= ${formatQty(k.qty)})` }))} hint="If you pick a pack, quantity is the number of packs." />
            <TextField name="unitPrice" label={`Unit price (${c.currency})`} inputMode="decimal" required defaultValue="0" />
            <TextField name="weightKg" label="Total weight (kg)" inputMode="decimal" hint="Used to allocate freight by weight." />
            <TextField name="volumeCbm" label="Total volume (m³)" inputMode="decimal" />
            <TextField name="lotNo" label="Batch number" />
            <TextField name="expiryDate" label="Batch expiry" type="date" />
            <TextareaField className="sm:col-span-3" name="serials" label="Serial numbers" rows={2} placeholder="One per line, or separated by commas" />
          </ActionForm>
        </CardContent></Card>
      )}

      <Card className="gap-0 py-0 overflow-hidden"><CardHeader className="py-5"><CardTitle>Costs</CardTitle><CardDescription>Freight, duty, port charges and other costs. {inward ? "Costs marked as landed cost are spread over the items and become part of the stock value." : "Costs reduce this container's profit."}</CardDescription></CardHeader>
        <CardContent className="px-0"><DataTable className="rounded-none border-x-0 border-b-0 shadow-none" columns={costCols} rows={costs} rowKey={(k) => k.id} empty={{ title: "No costs recorded" }} /></CardContent></Card>
      {canWrite && c.status !== "cancelled" && (
        <Card><CardHeader><CardTitle>Add cost</CardTitle>{locked && <CardDescription>Stock is already posted: new landed costs will not change the stock value already booked.</CardDescription>}</CardHeader><CardContent>
          <ActionForm action={addCostAction} submit="Add cost" className="grid gap-4 sm:grid-cols-3">
            <input type="hidden" name="containerId" value={c.id} />
            <SelectField name="type" label="Type" options={Object.entries(COST_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
            <TextField name="description" label="Description" />
            <SelectField name="payeeSupplierId" label="Paid to (optional)" placeholder="—" options={sel(suppliers)} />
            <TextField name="amount" label="Amount (ex-VAT)" inputMode="decimal" required />
            <SelectField name="currency" label="Currency" defaultValue={c.currency} options={CURRENCIES.map((x) => ({ value: x, label: x }))} />
            <TextField name="exchangeRate" label="Exchange rate" inputMode="decimal" defaultValue={c.exchangeRate} />
            <TextField name="vat" label="Recoverable VAT (in cost currency)" inputMode="decimal" hint="Import VAT / input VAT: excluded from landed cost." />
            <SelectField name="allocation" label="Allocate by" options={[{ value: "value", label: "Value" }, { value: "quantity", label: "Quantity" }, { value: "weight", label: "Weight" }, { value: "volume", label: "Volume" }]} />
            <TextField name="incurredOn" label="Date" type="date" required defaultValue={todayISO()} />
            {inward && <CheckboxField name="inLandedCost" label="Include in landed cost (stock value)" defaultChecked />}
          </ActionForm>
        </CardContent></Card>
      )}

      {inward && landed.lines.length > 0 && (
        <Card className="gap-0 py-0 overflow-hidden"><CardHeader className="py-5"><CardTitle>Landed cost per item</CardTitle><CardDescription>Goods value + allocated costs ÷ quantity = cost per unit booked into stock{c.stockPostedAt ? " (as posted)" : " (preview: final when received)"}.</CardDescription></CardHeader>
          <CardContent className="px-0">
            <DataTable className="rounded-none border-x-0 border-b-0 shadow-none" rows={landed.lines} rowKey={(l) => l.item.id}
              columns={[
                { key: "p", header: "Product", cell: (l) => items.find((x) => x.i.id === l.item.id)?.name },
                { key: "g", header: "Goods (AED)", align: "right", cell: (l) => formatAED(l.goodsAed) },
                { key: "a", header: "Allocated costs", align: "right", cell: (l) => formatAED(l.allocatedAed) },
                { key: "t", header: "Total landed", align: "right", cell: (l) => formatAED(l.totalAed) },
                { key: "u", header: "Per unit", align: "right", cell: (l) => <b>{formatAED(c.stockPostedAt ? l.item.landedUnitCostAed : l.unitAed)}</b> },
              ]} />
            {landed.warnings.length > 0 && <p className="px-6 py-3 text-xs text-warning">{landed.warnings.join(" · ")}</p>}
          </CardContent></Card>
      )}

      {canWrite && c.status !== "cancelled" && (
        <Card><CardHeader><CardTitle>Container details</CardTitle></CardHeader><CardContent>
          <ContainerForm direction={c.direction} container={c} parties={parties} warehouses={whs.filter((w) => w.isActive)} />
        </CardContent></Card>
      )}
    </div>
  );
}
