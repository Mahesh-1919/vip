import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, sql as pg } from "@/db";
import {
  accounts, companySettings, containerCosts, containerItems, containers, customers, invoiceLines, invoices, journalEntries, journalLines, payables, payments,
  productPackagings, products, saleLines, sales, stockLevels, stockLots, stockMoves, suppliers, uoms, users, warehouses,
} from "@/db/schema";
import { iso6346CheckDigit } from "@/lib/container";
import { todayISO } from "@/lib/dates";
import { post } from "@/services/accounting/ledger";
import { backfillLedger } from "@/services/accounting/backfill";
import { payPayable } from "@/services/accounting/payables";
import * as rep from "@/services/accounting/reports";
import * as cs from "@/services/inventory/containers";
import * as stock from "@/services/inventory/stock";
import * as sale from "@/services/sales/sales";
import * as inv from "@/services/sales/invoicing";
import { purgeSince } from "./purge";

const meta = { ip: null, userAgent: null };
const t0 = new Date(Date.now() - 2000);
const tag = `AC${Date.now()}`;
const today = todayISO();
let user: never, customerId: string, supplierId: string, whId: string, origCompany: typeof companySettings.$inferSelect;
const pid: Record<string, string> = {};
const saleIds: string[] = [], containerIds: string[] = [];
let serial = 700000 + (Date.now() % 250000);
const newNo = () => { const f = `TST${"U"}${String(serial++).padStart(6, "0")}`; return f + iso6346CheckDigit(f); };

/** Net effect of an entry on an account code, debit − credit. */
async function entryLines(sourceType: string, sourceId: string) {
  return db.select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit, customerId: journalLines.customerId, supplierId: journalLines.supplierId })
    .from(journalEntries).innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id)).innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId)));
}
const amt = (ls: Awaited<ReturnType<typeof entryLines>>, code: string, side: "debit" | "credit") => ls.filter((l) => l.code === code).reduce((s, l) => s + Number(l[side]), 0);

beforeAll(async () => {
  const [u] = await db.select().from(users).limit(1);
  user = { id: u.id, email: u.email, permissions: new Set() } as never;
  [{ id: whId }] = await db.select({ id: warehouses.id }).from(warehouses).limit(1);
  [{ id: customerId }] = await db.insert(customers).values({ code: `${tag}-C`, name: "Ledger Customer", country: "AE", taxId: "100200300400003" }).returning({ id: customers.id });
  [{ id: supplierId }] = await db.insert(suppliers).values({ code: `${tag}-S`, name: "Ledger Supplier", paymentTermsDays: 30 }).returning({ id: suppliers.id });
  const [uom] = await db.select().from(uoms).where(eq(uoms.code, "PCS"));
  for (const k of ["A", "B"]) [{ id: pid[k] }] = await db.insert(products).values({ sku: `${tag}-${k}`, name: k, baseUomId: uom.id }).returning({ id: products.id });
  [origCompany] = await db.select().from(companySettings);
  await db.update(companySettings).set({ trn: "100999888777666", booksLockedThrough: null });
});

afterAll(async () => {
  await purgeSince(t0);
  await db.update(companySettings).set({ trn: origCompany.trn, booksLockedThrough: origCompany.booksLockedThrough });
  const ids = Object.values(pid);
  await db.transaction(async (tx) => {
    for (const t of ["invoices", "invoice_lines", "payments", "container_items", "stock_moves"]) await tx.execute(sql.raw(`alter table ${t} disable trigger user`));
    const invs = (await tx.select({ id: invoices.id }).from(invoices).where(inArray(invoices.saleId, saleIds))).map((i) => i.id);
    if (invs.length) { await tx.delete(payments).where(inArray(payments.invoiceId, invs)); await tx.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, invs)); await tx.delete(invoices).where(inArray(invoices.id, invs)); }
    await tx.delete(saleLines).where(inArray(saleLines.saleId, saleIds)); await tx.delete(sales).where(inArray(sales.id, saleIds));
    await tx.delete(stockMoves).where(inArray(stockMoves.productId, ids));
    await tx.delete(containerItems).where(inArray(containerItems.containerId, containerIds));
    await tx.delete(containerCosts).where(inArray(containerCosts.containerId, containerIds));
    await tx.delete(containers).where(inArray(containers.id, containerIds));
    for (const t of ["invoices", "invoice_lines", "payments", "container_items", "stock_moves"]) await tx.execute(sql.raw(`alter table ${t} enable trigger user`));
    await tx.delete(stockLevels).where(inArray(stockLevels.productId, ids)); await tx.delete(stockLots).where(inArray(stockLots.productId, ids));
    await tx.delete(productPackagings).where(inArray(productPackagings.productId, ids)); await tx.delete(products).where(inArray(products.id, ids));
    await tx.delete(customers).where(eq(customers.id, customerId)); await tx.delete(suppliers).where(eq(suppliers.id, supplierId));
  });
  await pg.end();
});

describe("ledger core", () => {
  it("refuses unbalanced entries and is idempotent per source", async () => {
    await expect(db.transaction((tx) => post(tx, { date: today, memo: "bad", sourceType: "manual", lines: [{ account: "1000", debit: 100 }, { account: "3000", credit: 99 }] }))).rejects.toThrow(/Unbalanced/);
    const make = () => db.transaction((tx) => post(tx, { date: today, memo: "Owner capital", sourceType: "manual", sourceId: `${tag}-cap`, lines: [{ account: "1010", debit: 5000 }, { account: "3000", credit: 5000 }] }));
    const a = await make(), b = await make();
    expect(a?.created).toBe(true); expect(b?.created).toBe(false); expect(b?.number).toBe(a?.number);
  });

  it("the database rejects unbalanced lines and any edit or delete of the ledger", async () => {
    const [acc] = await db.select().from(accounts).where(eq(accounts.code, "1000"));
    await expect(db.transaction(async (tx) => {
      const [e] = await tx.insert(journalEntries).values({ number: `X-${tag}`, entryDate: today, memo: "raw", sourceType: "manual" }).returning();
      await tx.insert(journalLines).values({ entryId: e.id, accountId: acc.id, debit: "10.00", credit: "0" });
    })).rejects.toThrow(/not balanced/);
    const [e] = await db.select().from(journalEntries).where(eq(journalEntries.sourceId, `${tag}-cap`));
    await expect(db.update(journalEntries).set({ memo: "tamper" }).where(eq(journalEntries.id, e.id))).rejects.toThrow();
    await expect(db.delete(journalLines).where(eq(journalLines.entryId, e.id))).rejects.toThrow();
  });

  it("closed periods reject postings", async () => {
    await db.update(companySettings).set({ booksLockedThrough: "2020-01-31" });
    await expect(db.transaction((tx) => post(tx, { date: "2020-01-15", memo: "old", sourceType: "manual", sourceId: `${tag}-old`, lines: [{ account: "1000", debit: 1 }, { account: "3000", credit: 1 }] }))).rejects.toMatchObject({ status: 409 });
    await db.update(companySettings).set({ booksLockedThrough: null });
  });
});

describe("invoices and payments post automatically", () => {
  it("books AR, revenue by VAT treatment and output VAT, then cash receipts and reversals", async () => {
    const vatBefore = await rep.vatReturn(today, today);
    const s = await sale.createSale({ customerId, saleDate: today, containerId: null, currency: "USD", exchangeRate: "3.6725", notes: null }, user, meta); saleIds.push(s.id);
    await sale.addLine({ saleId: s.id, productId: pid.A, description: "", qty: "10", unitPrice: "100", vatCategory: "standard", containerItemId: null }, user, meta);
    await sale.addLine({ saleId: s.id, productId: pid.B, description: "", qty: "2", unitPrice: "250.50", vatCategory: "zero", containerItemId: null }, user, meta);
    const lines = await db.select().from(saleLines).where(eq(saleLines.saleId, s.id));
    const d = await inv.createDraft({ saleId: s.id, lines: lines.map((l) => ({ saleLineId: l.id, qty: l.qty })), issueDate: today, supplyDate: today, dueDate: null, notes: null }, user, meta);
    const i = await inv.issueInvoice(d.id, user, meta);
    // 1501 USD net, 50 USD VAT => AED 5512.42 + 183.63 = 5696.05
    const ls = await entryLines("invoice", i.id);
    expect(amt(ls, "1200", "debit")).toBeCloseTo(5696.05, 2);
    expect(amt(ls, "4000", "credit")).toBeCloseTo(3672.5, 2);
    expect(amt(ls, "4010", "credit")).toBeCloseTo(1839.92, 2); // 501 × 3.6725 = 1839.9225 -> rounding cent goes to the larger line, totals still tie
    expect(amt(ls, "4000", "credit") + amt(ls, "4010", "credit")).toBeCloseTo(5512.42, 2);
    expect(amt(ls, "2300", "credit")).toBeCloseTo(183.63, 2);
    expect(ls.find((l) => l.code === "1200")!.customerId).toBe(customerId);

    const p1 = await inv.recordPayment({ invoiceId: i.id, paymentDate: today, amount: "500", method: "bank_transfer", reference: null, notes: null }, user, meta);
    const pl = await entryLines("payment", p1.id);
    expect(amt(pl, "1010", "debit")).toBeCloseTo(1836.25, 2); expect(amt(pl, "1200", "credit")).toBeCloseTo(1836.25, 2);
    const p2 = await inv.recordPayment({ invoiceId: i.id, paymentDate: today, amount: "100", method: "cash", reference: null, notes: null }, user, meta);
    expect(amt(await entryLines("payment", p2.id), "1000", "debit")).toBeCloseTo(367.25, 2);
    await inv.reversePayment(p2.id, "wrong", user, meta);
    const [rev] = await db.select().from(payments).where(eq(payments.reversalOf, p2.id));
    expect(amt(await entryLines("payment", rev.id), "1000", "credit")).toBeCloseTo(367.25, 2);

    // reports tie out
    const after = await rep.vatReturn(today, today);
    expect(after.standard.net.minus(vatBefore.standard.net).toNumber()).toBeCloseTo(3672.5, 2);
    expect(after.standard.vat.minus(vatBefore.standard.vat).toNumber()).toBeCloseTo(183.63, 2);
    expect(after.zero.net.minus(vatBefore.zero.net).toNumber()).toBeCloseTo(1839.92, 2);
    expect(after.outputVat.minus(vatBefore.outputVat).toNumber()).toBeCloseTo(183.63, 2);
    const aging = await rep.arAging(today);
    expect(aging.rows.find((r) => r.name === "Ledger Customer")!.total.toNumber()).toBeCloseTo(5696.05 - 1836.25, 2);
    expect((await rep.trialBalance(today)).balanced).toBe(true);
  });
});

describe("containers post inventory, payables and cost of goods", () => {
  it("receipt: inventory at landed cost, VAT input, payables; supplier payment; late and removed costs", async () => {
    const h = { direction: "inward" as const, containerNo: newNo(), sealNo: null, size: "40HC", shippingLine: null, vessel: null, voyage: null, billOfLading: null, partyId: supplierId, incoterm: "CIF", originCountry: "IN", loadPort: null, dischargePort: "Jebel Ali", warehouseId: whId, eta: null, customsDeclarationNo: null, freeZone: true, currency: "AED", exchangeRate: "1", notes: null };
    const c = await cs.createContainer(h, user, meta); containerIds.push(c.id);
    await cs.addItem({ containerId: c.id, productId: pid.A, qty: "100", packagingId: null, unitPrice: "10", lotNo: null, expiryDate: null, serials: [], weightKg: "0", volumeCbm: "0" }, user, meta); // goods 1000
    await cs.addCost({ containerId: c.id, type: "freight", description: null, payeeSupplierId: supplierId, amount: "200", currency: "AED", exchangeRate: "1", vat: "10", allocation: "value", inLandedCost: true, incurredOn: today }, user, meta);
    expect(await entryLines("container_cost", (await db.select().from(containerCosts).where(eq(containerCosts.containerId, c.id)))[0].id)).toHaveLength(0); // deferred until received
    await cs.changeStatus(c.id, "received", user, meta);
    const r = await entryLines("container_receipt", c.id);
    expect(amt(r, "1300", "debit")).toBe(1200); expect(amt(r, "1400", "debit")).toBe(10); expect(amt(r, "2100", "credit")).toBe(1210);
    const pays = await db.select().from(payables).where(eq(payables.containerId, c.id));
    expect(pays.map((p) => Number(p.amountAed)).sort((a, b) => a - b)).toEqual([210, 1000]);
    expect(pays.find((p) => Number(p.amountAed) === 1000)!.dueDate).toBe(new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10)); // supplier terms

    const goods = pays.find((p) => Number(p.amountAed) === 1000)!;
    await expect(payPayable({ payableId: goods.id, paymentDate: today, amount: "1500", method: "bank_transfer", reference: null }, user, meta)).rejects.toMatchObject({ status: 422 });
    const pp = await payPayable({ payableId: goods.id, paymentDate: today, amount: "400", method: "bank_transfer", reference: "TT9" }, user, meta);
    const ppl = await entryLines("payable_payment", pp.id);
    expect(amt(ppl, "2100", "debit")).toBe(400); expect(amt(ppl, "1010", "credit")).toBe(400);
    expect(Number((await db.select().from(payables).where(eq(payables.id, goods.id)))[0].paidAed)).toBe(400);

    // a cost added after receipt is expensed (stock is not revalued) and can be reversed
    await cs.addCost({ containerId: c.id, type: "other", description: "demurrage", payeeSupplierId: null, amount: "50", currency: "AED", exchangeRate: "1", vat: "0", allocation: "value", inLandedCost: false, incurredOn: today }, user, meta);
    const [dem] = await db.select().from(containerCosts).where(and(eq(containerCosts.containerId, c.id), eq(containerCosts.type, "other")));
    expect(amt(await entryLines("container_cost", dem.id), "5190", "debit")).toBe(50);
    await cs.removeCost(dem.id, user, meta);
    expect(amt(await entryLines("container_cost_reversal", dem.id), "5190", "credit")).toBe(50);
    expect((await db.select().from(payables).where(eq(payables.sourceId, dem.id)))).toHaveLength(0);

    // dispatch posts COGS at the stock cost (landed 12 per unit)
    const o = await cs.createContainer({ ...h, direction: "outward", containerNo: newNo(), partyId: customerId }, user, meta); containerIds.push(o.id);
    await cs.addItem({ containerId: o.id, productId: pid.A, qty: "30", packagingId: null, unitPrice: "20", lotNo: null, expiryDate: null, serials: [], weightKg: "0", volumeCbm: "0" }, user, meta);
    await cs.changeStatus(o.id, "dispatched", user, meta);
    const g = await entryLines("cogs", o.id);
    expect(amt(g, "5000", "debit")).toBe(360); expect(amt(g, "1300", "credit")).toBe(360);
    expect((await stock.getProduct(pid.A))!.onHand).toBe("70.0000");

    const bs = await rep.balanceSheet(today);
    expect(bs.balanced).toBe(true);
  });
});

describe("rebuild", () => {
  it("backfill is idempotent once everything is posted", async () => {
    const first = await backfillLedger(null);
    const second = await backfillLedger(null);
    expect(Object.values(second).every((n) => n === 0)).toBe(true);
    void first;
  });
});
