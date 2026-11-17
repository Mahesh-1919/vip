import "server-only";
import { asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { billAllocations, customers, entryBills, exitBills, invoiceLines, invoices } from "@/db/schema";
import { D } from "@/lib/money";
import { WEIGHT_WARNING } from "./freezone";

const like = (q: string) => `%${q.replace(/[%_\\]/g, "\\$&")}%`;
/** Splits a "Marks & numbers" cell into container numbers. */
export const containersOf = (s: string | null | undefined) => (s ?? "").split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);

type Billing = Map<string, { pk: number; value: string; invoices: { id: string; number: string }[] }>;

async function billingFor(exitIds: string[]): Promise<Billing> {
  const out: Billing = new Map();
  if (!exitIds.length) return out;
  const rows = await db.select({ exitId: invoiceLines.exitBillId, qty: invoiceLines.qty, net: invoiceLines.net, invId: invoices.id, number: invoices.number })
    .from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId)).where(inArray(invoiceLines.exitBillId, exitIds)).orderBy(asc(invoices.number));
  for (const r of rows) {
    const e = out.get(r.exitId!) ?? { pk: 0, value: "0", invoices: [] };
    e.pk += Number(r.qty); e.value = D(e.value).plus(r.net).toFixed(2);
    if (!e.invoices.some((i) => i.id === r.invId)) e.invoices.push({ id: r.invId, number: r.number });
    out.set(r.exitId!, e);
  }
  return out;
}

/**
 * One import (entry bill) with everything that left it: who received how many packages, through which
 * exit bill and truck/container, and what has been invoiced.
 */
export async function traceEntries(f: { q?: string; entryId?: string }) {
  const entries = f.entryId
    ? await db.select().from(entryBills).where(eq(entryBills.id, f.entryId))
    : f.q
      ? await db.select().from(entryBills).where(or(ilike(entryBills.marksNumbers, like(f.q)), ilike(entryBills.billNo, like(f.q)), ilike(entryBills.transferNo, like(f.q)), ilike(entryBills.invoiceNo, like(f.q)), ilike(entryBills.agentName, like(f.q)))).orderBy(desc(entryBills.billDate)).limit(15)
      : await db.select().from(entryBills).orderBy(desc(entryBills.billDate)).limit(10);
  if (!entries.length) return { traces: [], unlinkedExits: [] };
  const rows = await db.select({
    a: billAllocations, x: exitBills, customer: customers.name, customerId: customers.id,
  }).from(billAllocations).innerJoin(exitBills, eq(exitBills.id, billAllocations.exitBillId)).leftJoin(customers, eq(customers.id, exitBills.customerId))
    .where(inArray(billAllocations.entryBillId, entries.map((e) => e.id))).orderBy(asc(exitBills.exitDate));
  const bill = await billingFor([...new Set(rows.map((r) => r.x.id))]);

  const traces = entries.map((e) => {
    const mine = rows.filter((r) => r.a.entryBillId === e.id);
    const exported = mine.reduce((s, r) => s + r.a.packages, 0);
    const exportedKg = mine.reduce((s, r) => s.plus(r.a.weightKg), D(0));
    const byCustomer = new Map<string, { name: string; packages: number; exits: number }>();
    for (const r of mine) {
      const key = r.customerId ?? r.x.importerName ?? "unknown";
      const c = byCustomer.get(key) ?? { name: r.customer ?? r.x.importerName ?? "Unknown customer", packages: 0, exits: 0 };
      c.packages += r.a.packages; c.exits++; byCustomer.set(key, c);
    }
    return {
      entry: e, exported, remaining: e.packages - exported, exportedKg,
      weightFlag: Number(e.weightKg) > 0 && exportedKg.gt(D(e.weightKg).times(1 + WEIGHT_WARNING)),
      customers: [...byCustomer.values()].sort((a, b) => b.packages - a.packages),
      exits: mine.map((r) => ({ alloc: r.a, exit: r.x, customer: r.customer, billed: bill.get(r.x.id) ?? { pk: 0, value: "0", invoices: [] } })),
    };
  });

  // Exits that name one of these containers but are not linked to any entry: shipped without a recorded source.
  let unlinkedExits: (typeof exitBills.$inferSelect & { customer: string | null })[] = [];
  if (f.q) {
    const linked = new Set(rows.map((r) => r.x.id));
    const cands = await db.select({ x: exitBills, customer: customers.name }).from(exitBills).leftJoin(customers, eq(customers.id, exitBills.customerId))
      .where(or(ilike(exitBills.truckContainerNo, like(f.q)), ilike(exitBills.boeNo, like(f.q)))).orderBy(desc(exitBills.exitDate)).limit(30);
    unlinkedExits = cands.filter((c) => !linked.has(c.x.id)).map((c) => ({ ...c.x, customer: c.customer }));
  }
  return { traces, unlinkedExits };
}

/** One customer's exits with the entry bills (and containers) they came from. */
export async function traceCustomer(customerId: string) {
  const exits = await db.select({ x: exitBills }).from(exitBills).where(eq(exitBills.customerId, customerId)).orderBy(desc(exitBills.exitDate)).limit(200);
  if (!exits.length) return [];
  const ids = exits.map((e) => e.x.id);
  const [allocs, bill] = await Promise.all([
    db.select({ a: billAllocations, billNo: entryBills.billNo, billDate: entryBills.billDate, marks: entryBills.marksNumbers, entryId: entryBills.id }).from(billAllocations).innerJoin(entryBills, eq(entryBills.id, billAllocations.entryBillId)).where(inArray(billAllocations.exitBillId, ids)),
    billingFor(ids),
  ]);
  return exits.map(({ x }) => ({ exit: x, sources: allocs.filter((a) => a.a.exitBillId === x.id), billed: bill.get(x.id) ?? { pk: 0, value: "0", invoices: [] } }));
}
