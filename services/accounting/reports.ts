import { and, asc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, invoiceLines, invoices, journalEntries, journalLines, payables, payrollRuns } from "@/db/schema";
import { todayISO } from "@/lib/dates";
import { D, Decimal } from "@/lib/money";

type AccountType = (typeof accounts.$inferSelect)["type"];
const debitNormal = (t: AccountType) => t === "asset" || t === "expense";
/** Natural-sign balance: assets & expenses positive when debit-heavy; the rest positive when credit-heavy. */
const natural = (t: AccountType, dr: Decimal.Value, cr: Decimal.Value) => (debitNormal(t) ? D(dr).minus(cr) : D(cr).minus(dr));

async function movements(f: { from?: string; to?: string }) {
  const where = and(f.from ? gte(journalEntries.entryDate, f.from) : undefined, f.to ? lte(journalEntries.entryDate, f.to) : undefined);
  return db.select({
    id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type, isCash: accounts.isCash,
    dr: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, cr: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
  }).from(accounts).leftJoin(journalLines, eq(journalLines.accountId, accounts.id)).leftJoin(journalEntries, and(eq(journalEntries.id, journalLines.entryId), where))
    .where(sql`${journalLines.id} is null or ${journalEntries.id} is not null`).groupBy(accounts.id).orderBy(asc(accounts.code));
}

export async function trialBalance(asOf: string) {
  const rows = await movements({ to: asOf });
  const out = rows.map((r) => {
    const net = D(r.dr).minus(r.cr);
    return { id: r.id, code: r.code, name: r.name, type: r.type, debit: net.gt(0) ? net : D(0), credit: net.lt(0) ? net.neg() : D(0) };
  }).filter((r) => !r.debit.isZero() || !r.credit.isZero());
  const debit = out.reduce((s, r) => s.plus(r.debit), D(0)), credit = out.reduce((s, r) => s.plus(r.credit), D(0));
  return { rows: out, debit, credit, balanced: debit.eq(credit) };
}

export async function profitAndLoss(from: string, to: string) {
  const rows = (await movements({ from, to })).filter((r) => r.type === "income" || r.type === "expense");
  const mk = (t: AccountType) => rows.filter((r) => r.type === t).map((r) => ({ code: r.code, name: r.name, amount: natural(t, r.dr, r.cr) })).filter((r) => !r.amount.isZero());
  const income = mk("income"), expenses = mk("expense");
  const totalIncome = income.reduce((s, r) => s.plus(r.amount), D(0)), totalExpenses = expenses.reduce((s, r) => s.plus(r.amount), D(0));
  const cogs = expenses.filter((e) => e.code === "5000").reduce((s, r) => s.plus(r.amount), D(0));
  return { income, expenses, totalIncome, totalExpenses, grossProfit: totalIncome.minus(cogs), netProfit: totalIncome.minus(totalExpenses) };
}

export async function balanceSheet(asOf: string) {
  const rows = await movements({ to: asOf });
  const mk = (t: AccountType) => rows.filter((r) => r.type === t).map((r) => ({ code: r.code, name: r.name, amount: natural(t, r.dr, r.cr) })).filter((r) => !r.amount.isZero());
  const assets = mk("asset"), liabilities = mk("liability"), equity = mk("equity");
  const earnings = rows.filter((r) => r.type === "income" || r.type === "expense").reduce((s, r) => s.plus(natural(r.type, r.dr, r.cr).times(r.type === "income" ? 1 : -1)), D(0));
  const sum = (a: { amount: Decimal }[]) => a.reduce((s, r) => s.plus(r.amount), D(0));
  const totalAssets = sum(assets), totalLiab = sum(liabilities), totalEquity = sum(equity).plus(earnings);
  return { assets, liabilities, equity, earnings, totalAssets, totalLiabilities: totalLiab, totalEquity, balanced: totalAssets.eq(totalLiab.plus(totalEquity)) };
}

const CASH_GROUPS: Record<string, string> = {
  payment: "Receipts from customers", payable_payment: "Payments to suppliers", payroll_paid: "Salaries paid", manual: "Other (manual entries)",
};

/** Direct-method cash flow from movements on cash & bank accounts. */
export async function cashFlow(from: string, to: string) {
  const cashIds = (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.isCash, true))).map((a) => a.id);
  if (!cashIds.length) return { opening: D(0), closing: D(0), groups: [], net: D(0) };
  const [open] = await db.select({ v: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(inArray(journalLines.accountId, cashIds), sql`${journalEntries.entryDate} < ${from}`));
  const moves = await db.select({ type: journalEntries.sourceType, v: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})`, inflow: sql<string>`sum(${journalLines.debit})`, outflow: sql<string>`sum(${journalLines.credit})` })
    .from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(inArray(journalLines.accountId, cashIds), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to))).groupBy(journalEntries.sourceType);
  const groups = moves.map((m) => ({ label: CASH_GROUPS[m.type] ?? m.type.replace(/_/g, " "), inflow: D(m.inflow), outflow: D(m.outflow), net: D(m.v) }));
  const net = groups.reduce((s, g) => s.plus(g.net), D(0));
  return { opening: D(open.v), closing: D(open.v).plus(net), groups, net };
}

export async function accountLedger(accountId: string, from: string, to: string) {
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!acc) return null;
  const [open] = await db.select({ dr: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, cr: sql<string>`coalesce(sum(${journalLines.credit}), 0)` }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.accountId, accountId), sql`${journalEntries.entryDate} < ${from}`));
  const lines = await db.select({ date: journalEntries.entryDate, number: journalEntries.number, memo: journalEntries.memo, desc: journalLines.description, debit: journalLines.debit, credit: journalLines.credit, entryId: journalEntries.id })
    .from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.accountId, accountId), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to))).orderBy(asc(journalEntries.entryDate), asc(journalEntries.number));
  let run = natural(acc.type, open.dr, open.cr);
  const opening = run;
  const rows = lines.map((l) => { run = run.plus(natural(acc.type, l.debit, l.credit)); return { ...l, balance: run }; });
  return { account: acc, opening, rows, closing: run };
}

export type Vat201 = Awaited<ReturnType<typeof vatReturn>>;
/** VAT return summary for a period (UAE Form 201 style: supplies, output VAT, recoverable input VAT, net payable). */
export async function vatReturn(from: string, to: string) {
  const lines = await db.select({
    cat: invoiceLines.vatCategory, net: sql<string>`coalesce(sum(${invoiceLines.net} * ${invoices.exchangeRate}), 0)`, vat: sql<string>`coalesce(sum(${invoiceLines.vat} * ${invoices.exchangeRate}), 0)`,
  }).from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId)).where(and(eq(invoices.status, "issued"), gte(invoices.issueDate, from), lte(invoices.issueDate, to))).groupBy(invoiceLines.vatCategory);
  const get = (c: string) => lines.find((l) => l.cat === c);
  const [input] = await db.select({ v: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId)).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(accounts.code, "1400"), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)));
  const [output] = await db.select({ v: sql<string>`coalesce(sum(${journalLines.credit} - ${journalLines.debit}), 0)` }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId)).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(accounts.code, "2300"), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)));
  const outVat = D(output.v), inVat = D(input.v);
  return {
    standard: { net: D(get("standard")?.net), vat: D(get("standard")?.vat) }, zero: { net: D(get("zero")?.net), vat: D(0) },
    exempt: { net: D(get("exempt")?.net), vat: D(0) }, outOfScope: { net: D(get("out_of_scope")?.net), vat: D(0) },
    outputVat: outVat, inputVat: inVat, netPayable: outVat.minus(inVat),
  };
}

const BUCKETS = ["Not yet due", "1-30 days", "31-60 days", "61-90 days", "Over 90 days"] as const;
const bucketOf = (due: string, asOf: string) => {
  const d = Math.floor((Date.parse(asOf + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 86400000);
  return d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
};
export { BUCKETS };

export async function arAging(asOf = todayISO()) {
  const rows = await db.select({ inv: invoices, customer: customers.name }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.status, "issued"), sql`${invoices.paidAmount} < ${invoices.total}`, lte(invoices.issueDate, asOf)));
  const by = new Map<string, { name: string; buckets: Decimal[]; total: Decimal }>();
  for (const { inv, customer } of rows) {
    const e = by.get(inv.customerId) ?? { name: customer, buckets: BUCKETS.map(() => D(0)), total: D(0) };
    const out = D(inv.total).minus(inv.paidAmount).times(inv.exchangeRate).toDecimalPlaces(2);
    e.buckets[bucketOf(inv.dueDate, asOf)] = e.buckets[bucketOf(inv.dueDate, asOf)].plus(out); e.total = e.total.plus(out);
    by.set(inv.customerId, e);
  }
  const list = [...by.values()].sort((a, b) => b.total.comparedTo(a.total));
  return { rows: list, totals: BUCKETS.map((_, i) => list.reduce((s, r) => s.plus(r.buckets[i]), D(0))), total: list.reduce((s, r) => s.plus(r.total), D(0)) };
}

export async function apAging(asOf = todayISO()) {
  const rows = await db.select().from(payables).where(and(sql`${payables.paidAed} < ${payables.amountAed}`, lte(payables.docDate, asOf)));
  const by = new Map<string, { name: string; buckets: Decimal[]; total: Decimal }>();
  for (const p of rows) {
    const key = p.supplierId ?? "none";
    const e = by.get(key) ?? { name: p.payeeName, buckets: BUCKETS.map(() => D(0)), total: D(0) };
    const out = D(p.amountAed).minus(p.paidAed);
    e.buckets[bucketOf(p.dueDate, asOf)] = e.buckets[bucketOf(p.dueDate, asOf)].plus(out); e.total = e.total.plus(out);
    by.set(key, e);
  }
  const list = [...by.values()].sort((a, b) => b.total.comparedTo(a.total));
  return { rows: list, totals: BUCKETS.map((_, i) => list.reduce((s, r) => s.plus(r.buckets[i]), D(0))), total: list.reduce((s, r) => s.plus(r.total), D(0)) };
}

export async function overview() {
  const today = todayISO(), monthStart = today.slice(0, 8) + "01";
  const [tb, pl, ar, ap] = await Promise.all([trialBalance(today), profitAndLoss(monthStart, today), arAging(today), apAging(today)]);
  const bal = (code: string) => { const r = tb.rows.find((x) => x.code === code); return r ? r.debit.minus(r.credit) : D(0); };
  return { cash: bal("1000").plus(bal("1010")), ar: ar.total, ap: ap.total, vatPayable: D(0).minus(bal("2300")).minus(bal("1400")), revenue: pl.totalIncome, expenses: pl.totalExpenses, profit: pl.netProfit, balanced: tb.balanced };
}

/** Payroll totals only (no per-employee data): for roles with accounting:payroll-summary:read. */
export const payrollTotals = () =>
  db.select({ id: payrollRuns.id, year: payrollRuns.year, month: payrollRuns.month, status: payrollRuns.status, gross: payrollRuns.totalGross, deductions: payrollRuns.totalDeductions, net: payrollRuns.totalNet, paidAt: payrollRuns.paidAt })
    .from(payrollRuns).where(gt(payrollRuns.totalNet, "0")).orderBy(sql`${payrollRuns.year} desc, ${payrollRuns.month} desc`);

