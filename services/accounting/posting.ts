import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  containerCosts, containerItems, containers, invoiceLines, invoices, payablePayments, payables, payments,
  payrollItems, payrollRuns, sales, stockMoves, suppliers,
} from "@/db/schema";
import { todayISO } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { monthRange } from "@/lib/hr-calendar";
import { D, Decimal } from "@/lib/money";
import { A, COST_ACCOUNT, findEntry, post, reverseEntry } from "./ledger";

const addDays = (iso: string, d: number) => new Date(Date.parse(iso + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
const r2 = (v: Decimal.Value) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

// ---------- sales ----------
export async function postInvoice(tx: Tx, invoiceId: string, userId: string | null) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv || inv.status !== "issued") return null;
  const [sale] = await tx.select({ containerId: sales.containerId }).from(sales).where(eq(sales.id, inv.saleId));
  const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  const byAccount = new Map<string, Decimal>();
  for (const l of lines) {
    const acc = l.vatCategory === "zero" ? A.SALES_EXPORT : A.SALES_LOCAL;
    byAccount.set(acc, (byAccount.get(acc) ?? D(0)).plus(D(l.net).times(inv.exchangeRate)));
  }
  const rounded: [string, Decimal][] = [...byAccount.entries()].map(([acc, v]) => [acc, r2(v)]);
  const diff = D(inv.subtotalAed).minus(rounded.reduce((s, [, v]) => s.plus(v), D(0)));
  if (!diff.isZero() && rounded.length) { const big = rounded.reduce((a, b) => (b[1].gt(a[1]) ? b : a)); big[1] = big[1].plus(diff); } // rounding cents go to the largest line
  return post(tx, {
    date: inv.issueDate, memo: `Tax invoice ${inv.number}`, sourceType: "invoice", sourceId: inv.id, userId,
    lines: [
      { account: A.AR, debit: inv.totalAed, customerId: inv.customerId, containerId: sale?.containerId },
      ...rounded.map(([account, v]) => ({ account, credit: v, containerId: sale?.containerId })),
      { account: A.VAT_OUT, credit: inv.vatAed },
    ],
  });
}

export async function postPayment(tx: Tx, paymentId: string, userId: string | null) {
  const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) return null;
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, p.invoiceId));
  const amt = r2(D(p.amount).abs().times(inv.exchangeRate));
  const cash = p.method === "cash" ? A.CASH : A.BANK;
  const refund = D(p.amount).isNegative();
  return post(tx, {
    date: p.paymentDate, memo: `${refund ? "Payment reversal" : "Payment"} ${p.ref} · ${inv.number}`, sourceType: "payment", sourceId: p.id, userId,
    lines: refund ? [{ account: A.AR, debit: amt, customerId: inv.customerId }, { account: cash, credit: amt }] : [{ account: cash, debit: amt }, { account: A.AR, credit: amt, customerId: inv.customerId }],
  });
}

// ---------- containers ----------
async function payeeOf(tx: Tx, supplierId: string | null) {
  if (!supplierId) return { name: "Unassigned / accrued", terms: 30 };
  const [s] = await tx.select({ name: suppliers.name, terms: suppliers.paymentTermsDays }).from(suppliers).where(eq(suppliers.id, supplierId));
  return { name: s?.name ?? "Supplier", terms: s?.terms ?? 30 };
}

async function createPayable(tx: Tx, p: { supplierId: string | null; description: string; containerId: string | null; date: string; amount: Decimal; sourceType: string; sourceId: string }) {
  if (p.amount.lte(0)) return;
  const payee = await payeeOf(tx, p.supplierId);
  await tx.insert(payables).values({
    supplierId: p.supplierId, payeeName: payee.name, description: p.description, containerId: p.containerId, docDate: p.date, dueDate: addDays(p.date, payee.terms),
    amountAed: p.amount.toFixed(2), sourceType: p.sourceType, sourceId: p.sourceId,
  }).onConflictDoNothing();
}

/** Inward container received: stock in at landed cost, payable to the supplier, and payables for each landed cost. */
export async function postReceipt(tx: Tx, containerId: string, userId: string | null) {
  const [c] = await tx.select().from(containers).where(eq(containers.id, containerId));
  if (!c || c.direction !== "inward" || !c.stockPostedAt) return null;
  const items = await tx.select().from(containerItems).where(eq(containerItems.containerId, containerId));
  const costs = await tx.select().from(containerCosts).where(and(eq(containerCosts.containerId, containerId), eq(containerCosts.inLandedCost, true)));
  const goods = items.reduce((s, i) => s.plus(r2(D(i.qty).times(i.unitPrice).times(c.exchangeRate))), D(0));
  const date = c.arrivalDate ?? todayISO();
  const landed = costs.reduce((s, k) => s.plus(k.amountAed), D(0)), vat = costs.reduce((s, k) => s.plus(k.vatAed), D(0));
  await createPayable(tx, { supplierId: c.supplierId, description: `Goods · ${c.containerNo}`, containerId, date, amount: goods, sourceType: "container_receipt", sourceId: c.id });
  for (const k of costs) await createPayable(tx, { supplierId: k.payeeSupplierId, description: `${k.type.replace(/_/g, " ")} · ${c.containerNo}`, containerId, date: k.incurredOn, amount: D(k.amountAed).plus(k.vatAed), sourceType: "container_cost", sourceId: k.id });
  return post(tx, {
    date, memo: `Goods received ${c.ref} · ${c.containerNo}`, sourceType: "container_receipt", sourceId: c.id, userId,
    lines: [
      { account: A.INVENTORY, debit: goods.plus(landed), containerId },
      { account: A.VAT_IN, debit: vat },
      { account: A.AP, credit: goods, supplierId: c.supplierId, containerId },
      ...costs.map((k) => ({ account: A.AP, credit: D(k.amountAed).plus(k.vatAed), supplierId: k.payeeSupplierId, containerId, description: k.type })),
    ],
  });
}

/** An expensed container cost (freight on exports, demurrage, labour...). Capitalised costs on a not-yet-received import wait for the receipt. */
export async function postCost(tx: Tx, costId: string, userId: string | null) {
  const [k] = await tx.select().from(containerCosts).where(eq(containerCosts.id, costId));
  if (!k) return null;
  const [c] = await tx.select().from(containers).where(eq(containers.id, k.containerId));
  if (k.inLandedCost && c.direction === "inward" && !c.stockPostedAt) return null; // deferred to the receipt posting
  if (k.inLandedCost && c.direction === "inward" && c.stockPostedAt) {
    const rec = await findEntry(tx, "container_receipt", c.id);
    if (rec && rec.createdAt < k.createdAt) { /* added after receipt: expensed, stock not revalued */ } else return null; // included in the receipt posting
  }
  const total = D(k.amountAed).plus(k.vatAed);
  await createPayable(tx, { supplierId: k.payeeSupplierId, description: `${k.type.replace(/_/g, " ")} · ${c.containerNo}`, containerId: c.id, date: k.incurredOn, amount: total, sourceType: "container_cost", sourceId: k.id });
  return post(tx, {
    date: k.incurredOn, memo: `${k.type.replace(/_/g, " ")}${k.description ? ` · ${k.description}` : ""} · ${c.containerNo}`, sourceType: "container_cost", sourceId: k.id, userId,
    lines: [
      { account: COST_ACCOUNT[k.type] ?? A.OTHER_DIRECT, debit: k.amountAed, containerId: c.id },
      { account: A.VAT_IN, debit: k.vatAed },
      { account: A.AP, credit: total, supplierId: k.payeeSupplierId, containerId: c.id },
    ],
  });
}

export async function reverseCost(tx: Tx, cost: { id: string }, userId: string | null) {
  const entry = await findEntry(tx, "container_cost", cost.id);
  if (!entry) return;
  const [pay] = await tx.select().from(payables).where(and(eq(payables.sourceType, "container_cost"), eq(payables.sourceId, cost.id)));
  if (pay && D(pay.paidAed).gt(0)) throw new AppError(409, "This cost has already been paid to the supplier and cannot be removed");
  await reverseEntry(tx, entry, "container_cost_reversal", cost.id, todayISO(), userId, "cost removed");
  if (pay) await tx.delete(payables).where(eq(payables.id, pay.id));
}

/** Outward container dispatched: cost of goods at the stock cost the moves carried. */
export async function postCogs(tx: Tx, containerId: string, userId: string | null) {
  const [c] = await tx.select().from(containers).where(eq(containers.id, containerId));
  if (!c || c.direction !== "outward" || !c.stockPostedAt) return null;
  const [r] = await tx.select({ v: sql<string>`coalesce(sum(-${stockMoves.qty} * ${stockMoves.unitCost}), 0)` }).from(stockMoves)
    .where(and(eq(stockMoves.refType, "container"), eq(stockMoves.refId, c.ref), eq(stockMoves.type, "outward")));
  const amt = r2(r.v);
  return post(tx, {
    date: c.dispatchDate ?? todayISO(), memo: `Cost of goods dispatched ${c.ref} · ${c.containerNo}`, sourceType: "cogs", sourceId: c.id, userId,
    lines: [{ account: A.COGS, debit: amt, containerId }, { account: A.INVENTORY, credit: amt, containerId }],
  });
}

// ---------- payroll ----------
const payrollKey = (runId: string, finalizedAt: Date | null) => `${runId}@${finalizedAt?.toISOString() ?? "n/a"}`;

export async function postPayrollFinalized(tx: Tx, runId: string, userId: string | null) {
  const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run || run.status === "draft") return null;
  const items = await tx.select().from(payrollItems).where(eq(payrollItems.runId, runId));
  let gross = D(0), net = D(0), ded = D(0), lop = D(0);
  for (const i of items) {
    gross = gross.plus(i.gross); net = net.plus(i.net); ded = ded.plus(i.totalDeductions);
    lop = lop.plus(i.deductions.filter((d) => d.name === "Loss of pay").reduce((s, d) => s.plus(d.amount), D(0)));
  }
  return post(tx, {
    date: monthRange(run.year, run.month).to, memo: `Payroll ${String(run.month).padStart(2, "0")}/${run.year}`, sourceType: "payroll", sourceId: payrollKey(run.id, run.finalizedAt), userId,
    lines: [
      { account: A.SALARIES, debit: gross.minus(lop) },
      { account: A.SAL_PAYABLE, credit: net },
      { account: A.DED_PAYABLE, credit: ded.minus(lop) },
    ],
  });
}

export async function postPayrollPaid(tx: Tx, runId: string, userId: string | null) {
  const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run || run.status !== "paid" || !run.paidAt) return null;
  return post(tx, {
    date: run.paidAt, memo: `Payroll paid ${String(run.month).padStart(2, "0")}/${run.year}`, sourceType: "payroll_paid", sourceId: run.id, userId,
    lines: [{ account: A.SAL_PAYABLE, debit: run.totalNet }, { account: A.BANK, credit: run.totalNet }],
  });
}

/** Call BEFORE the run is switched back to draft. */
export async function reversePayroll(tx: Tx, runId: string, finalizedAt: Date | null, userId: string | null) {
  const entry = await findEntry(tx, "payroll", payrollKey(runId, finalizedAt));
  if (entry) await reverseEntry(tx, entry, "payroll_reversal", payrollKey(runId, finalizedAt), todayISO(), userId, "payroll reopened");
}

// ---------- supplier payments ----------
export async function postPayablePayment(tx: Tx, paymentId: string, userId: string | null) {
  const [p] = await tx.select().from(payablePayments).where(eq(payablePayments.id, paymentId));
  if (!p) return null;
  const [pay] = await tx.select().from(payables).where(eq(payables.id, p.payableId));
  const cash = p.method === "cash" ? A.CASH : A.BANK;
  return post(tx, {
    date: p.paymentDate, memo: `Supplier payment ${p.ref} · ${pay.payeeName}`, sourceType: "payable_payment", sourceId: p.id, userId,
    lines: [{ account: A.AP, debit: p.amountAed, supplierId: pay.supplierId, containerId: pay.containerId }, { account: cash, credit: p.amountAed }],
  });
}

