import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, sql as pg } from "@/db";
import { companySettings, containerItems, containers, customers, invoiceLines, invoices, payments, products, saleLines, sales, uoms, users, warehouses } from "@/db/schema";
import { iso6346CheckDigit } from "@/lib/container";
import { purgeSince } from "./purge";
import * as cs from "@/services/inventory/containers";
import * as sale from "@/services/sales/sales";
import * as inv from "@/services/sales/invoicing";

const meta = { ip: null, userAgent: null };
const tag = `IV${Date.now()}`;
let user: never, customerId: string, productId: string, origCompany: typeof companySettings.$inferSelect;
const saleIds: string[] = [], containerIds: string[] = [];
const today = new Date().toISOString().slice(0, 10);

const mkSale = async (over: Partial<sale.SaleInput> = {}) => { const s = await sale.createSale({ customerId, saleDate: today, containerId: null, currency: "AED", exchangeRate: "1", notes: null, ...over }, user, meta); saleIds.push(s.id); return s; };
const line = (saleId: string, qty: string, price: string, vatCategory: "standard" | "zero" = "standard", over: Partial<sale.LineInput> = {}) =>
  sale.addLine({ saleId, productId, description: "", qty, unitPrice: price, vatCategory, containerItemId: null, ...over }, user, meta);
const draft = (saleId: string, lines: { saleLineId: string; qty: string }[]) => inv.createDraft({ saleId, lines, issueDate: today, supplyDate: today, dueDate: null, notes: null }, user, meta);
const linesOf = async (saleId: string) => db.select().from(saleLines).where(eq(saleLines.saleId, saleId));

const t0 = new Date(Date.now() - 2000);

beforeAll(async () => {
  const [u] = await db.select().from(users).limit(1);
  user = { id: u.id, email: u.email, permissions: new Set() } as never;
  [{ id: customerId }] = await db.insert(customers).values({ code: `${tag}-C`, name: "Invoice Tester", country: "AE", taxId: "100200300400003", creditDays: 15 }).returning({ id: customers.id });
  const [uom] = await db.select().from(uoms).where(eq(uoms.code, "PCS"));
  [{ id: productId }] = await db.insert(products).values({ sku: `${tag}-P`, name: "Widget", baseUomId: uom.id }).returning({ id: products.id });
  [origCompany] = await db.select().from(companySettings);
  await db.update(companySettings).set({ trn: null });
});

afterAll(async () => {
  await purgeSince(t0);
  await db.update(companySettings).set({ trn: origCompany.trn, name: origCompany.name });
  await db.transaction(async (tx) => {
    for (const t of ["invoices", "invoice_lines", "payments", "container_items"]) await tx.execute(sql.raw(`alter table ${t} disable trigger user`));
    const invs = (await tx.select({ id: invoices.id }).from(invoices).where(inArray(invoices.saleId, saleIds))).map((i) => i.id);
    if (invs.length) { await tx.delete(payments).where(inArray(payments.invoiceId, invs)); await tx.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, invs)); await tx.delete(invoices).where(inArray(invoices.id, invs)); }
    await tx.delete(saleLines).where(inArray(saleLines.saleId, saleIds));
    await tx.delete(sales).where(inArray(sales.id, saleIds));
    if (containerIds.length) { await tx.delete(containerItems).where(inArray(containerItems.containerId, containerIds)); await tx.delete(containers).where(inArray(containers.id, containerIds)); }
    for (const t of ["invoices", "invoice_lines", "payments", "container_items"]) await tx.execute(sql.raw(`alter table ${t} enable trigger user`));
    await tx.delete(products).where(eq(products.id, productId));
    await tx.delete(customers).where(eq(customers.id, customerId));
  });
  await pg.end();
});

describe("partial invoicing", () => {
  let s: Awaited<ReturnType<typeof mkSale>>, lineId: string;
  it("tracks billed and remaining quantity and refuses to over-bill", async () => {
    s = await mkSale();
    await line(s.id, "100", "10");
    lineId = (await linesOf(s.id))[0].id;
    const d1 = await draft(s.id, [{ saleLineId: lineId, qty: "40" }]);
    expect(d1.status).toBe("draft");
    expect(d1.total).toBe("420.00"); // 400 + 5% VAT
    expect(d1.dueDate).toBe(new Date(Date.parse(today) + 15 * 86400000).toISOString().slice(0, 10)); // customer credit terms
    await expect(draft(s.id, [{ saleLineId: lineId, qty: "70" }])).rejects.toMatchObject({ status: 409 }); // only 60 left
    const d2 = await draft(s.id, [{ saleLineId: lineId, qty: "60" }]);
    await expect(draft(s.id, [{ saleLineId: lineId, qty: "1" }])).rejects.toMatchObject({ status: 409 });
    const got = (await sale.getSale(s.id))!;
    expect(Number(got.lines[0].billed)).toBe(100);
    expect(Number(got.lines[0].remaining)).toBe(0);
    await inv.deleteDraft(d2.id, user, meta); // deleting a draft releases the quantity
    expect(Number((await sale.getSale(s.id))!.lines[0].remaining)).toBe(60);
  });

  it("two simultaneous drafts cannot both bill the same remaining quantity", async () => {
    const res = await Promise.allSettled([draft(s.id, [{ saleLineId: lineId, qty: "40" }]), draft(s.id, [{ saleLineId: lineId, qty: "40" }])]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1); // 60 left: one 40 fits
    expect(Number((await sale.getSale(s.id))!.lines[0].billed)).toBe(80);
  });

  it("a line on an invoice cannot be removed; a sale with invoices cannot be cancelled", async () => {
    await expect(sale.removeLine(lineId, user, meta)).rejects.toMatchObject({ status: 409 });
    await expect(sale.cancelSale(s.id, user, meta)).rejects.toMatchObject({ status: 409 });
  });
});

describe("issuing, numbering and immutability", () => {
  it("needs a TRN, then numbers invoices gap-free and freezes the parties", async () => {
    const s = await mkSale();
    await line(s.id, "10", "100"); await line(s.id, "2", "250.5", "zero");
    const ls = await linesOf(s.id);
    const d = await draft(s.id, ls.map((l) => ({ saleLineId: l.id, qty: l.qty })));
    expect(d.subtotal).toBe("1501.00"); expect(d.vatTotal).toBe("50.00"); expect(d.total).toBe("1551.00");
    await expect(inv.issueInvoice(d.id, user, meta)).rejects.toMatchObject({ status: 422 }); // no TRN
    await db.update(companySettings).set({ trn: "100999888777666", name: "Frozen Co" });
    const a = await inv.issueInvoice(d.id, user, meta);
    expect(a.number).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(a.parties?.company).toMatchObject({ name: "Frozen Co", trn: "100999888777666" });
    expect(a.parties?.customer.trn).toBe("100200300400003");
    await db.update(companySettings).set({ name: "Renamed Co" }); // later edits must not change the issued invoice
    expect((await inv.getInvoice(a.id))!.inv.parties?.company.name).toBe("Frozen Co");

    const s2 = await mkSale(); await line(s2.id, "1", "10");
    const b = await inv.issueInvoice((await draft(s2.id, [{ saleLineId: (await linesOf(s2.id))[0].id, qty: "1" }])).id, user, meta);
    expect(Number(b.number!.slice(-4))).toBe(Number(a.number!.slice(-4)) + 1);

    // database-level immutability
    await expect(db.update(invoices).set({ total: "1.00" }).where(eq(invoices.id, a.id))).rejects.toThrow();
    await expect(db.delete(invoices).where(eq(invoices.id, a.id))).rejects.toThrow();
    await expect(db.update(invoiceLines).set({ qty: "1" }).where(eq(invoiceLines.invoiceId, a.id))).rejects.toThrow();
    await expect(inv.deleteDraft(a.id, user, meta)).rejects.toMatchObject({ status: 409 });
  });
});

describe("payments", () => {
  it("handles partial and full payment, overpayment, reversal and status", async () => {
    const s = await mkSale(); await line(s.id, "10", "100");
    const d = await draft(s.id, [{ saleLineId: (await linesOf(s.id))[0].id, qty: "10" }]); // total 1050
    await expect(inv.recordPayment({ invoiceId: d.id, paymentDate: today, amount: "10", method: "cash", reference: null, notes: null }, user, meta)).rejects.toMatchObject({ status: 409 }); // draft
    const i = await inv.issueInvoice(d.id, user, meta);
    expect((await inv.getInvoice(i.id))!.state).toBe("unpaid");
    const p1 = await inv.recordPayment({ invoiceId: i.id, paymentDate: today, amount: "400", method: "bank_transfer", reference: "TT123", notes: null }, user, meta);
    expect(p1.ref).toMatch(/^PAY-\d{4}$/);
    expect((await inv.getInvoice(i.id))!.state).toBe("partial");
    await expect(inv.recordPayment({ invoiceId: i.id, paymentDate: today, amount: "700", method: "cash", reference: null, notes: null }, user, meta)).rejects.toMatchObject({ status: 422 }); // 650 outstanding
    await inv.recordPayment({ invoiceId: i.id, paymentDate: today, amount: "650", method: "cheque", reference: null, notes: null }, user, meta);
    expect((await inv.getInvoice(i.id))!.state).toBe("paid");
    await inv.reversePayment(p1.id, "bounced", user, meta);
    const after = (await inv.getInvoice(i.id))!;
    expect(after.inv.paidAmount).toBe("650.00");
    expect(after.state).toBe("partial");
    expect(after.outstanding.toNumber()).toBe(400);
    await expect(inv.reversePayment(p1.id, "again", user, meta)).rejects.toMatchObject({ status: 409 });
    await expect(db.update(payments).set({ amount: "1" }).where(eq(payments.id, p1.id))).rejects.toThrow();
    await expect(db.update(invoices).set({ paidAmount: "5000" }).where(eq(invoices.id, i.id))).rejects.toThrow(); // CHECK paid <= total
    const rec = (await inv.receivables(customerId)).find((r) => r.customerId === customerId)!;
    expect(Number(rec.outstandingAed)).toBeGreaterThanOrEqual(400);
  });
});

describe("sales from an export container", () => {
  it("imports remaining container items and stops overselling", async () => {
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses).limit(1);
    const f = `TST${"U"}${String(600000 + (Date.now() % 300000)).padStart(6, "0")}`;
    const c = await cs.createContainer({
      direction: "outward", containerNo: f + iso6346CheckDigit(f), sealNo: null, size: "40HC", shippingLine: null, vessel: null, voyage: null, billOfLading: null, partyId: customerId,
      incoterm: "FOB", originCountry: "KE", loadPort: "Jebel Ali", dischargePort: "Mombasa", warehouseId: wh.id, eta: null, customsDeclarationNo: null, freeZone: false, currency: "USD", exchangeRate: "3.6725", notes: null,
    }, user, meta);
    containerIds.push(c.id);
    await cs.addItem({ containerId: c.id, productId, qty: "100", packagingId: null, unitPrice: "2", lotNo: null, expiryDate: null, serials: [], weightKg: "0", volumeCbm: "0" }, user, meta);
    const s = await mkSale({ containerId: c.id, currency: "USD", exchangeRate: "3.6725" });
    expect(await sale.importFromContainer(s.id, user, meta)).toBe(1);
    const l = (await linesOf(s.id))[0];
    expect(Number(l.qty)).toBe(100);
    expect(l.vatCategory).toBe("standard"); // customer is in the UAE
    await expect(sale.importFromContainer(s.id, user, meta)).rejects.toMatchObject({ status: 422 }); // nothing left
    await expect(line(s.id, "1", "2", "zero", { containerItemId: l.containerItemId })).rejects.toMatchObject({ status: 409 });
    const [item] = await db.select().from(containerItems).where(eq(containerItems.containerId, c.id));
    expect(item.qty).toBe("100.0000");
  });
});

describe("container profit & loss", () => {
  it("estimates goods cost for an undispatched export and reports revenue from linked sales", async () => {
    const { containerPnl } = await import("@/services/sales/reports");
    const rows = await containerPnl({ direction: "outward" });
    const mine = rows.find((r) => containerIds.includes(r.id));
    expect(mine).toBeDefined();
    expect(mine!.estimated).toBe(true); // never dispatched in this test
    expect(Number(mine!.revenueAed)).toBeGreaterThan(0);
  });
});
