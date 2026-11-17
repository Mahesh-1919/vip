import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, sql as pg } from "@/db";
import { companySettings, customers, invoiceLines, invoices, payments, saleLines, sales, users } from "@/db/schema";
import { parseLines } from "@/validators/sales";
import * as b from "@/services/billing";

const meta = { ip: null, userAgent: null };
const today = new Date().toISOString().slice(0, 10);
let user: never, customerId: string, origCompany: typeof companySettings.$inferSelect;
const saleIds: string[] = [];

const mk = async (lines: b.SaleLineInput[]) => { const id = await b.saveSale(null, { customerId, saleDate: today, billRef: "B-1", notes: null, lines }, undefined, user, meta); saleIds.push(id); return id; };
const inv = (saleId: string, over: Partial<{ issueDate: string; dueDate: string | null }> = {}) => b.createInvoice({ saleId, issueDate: today, dueDate: null, notes: null, ...over }, user, meta);
const form = (rows: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(rows)) f.set(k, v); return f; };

beforeAll(async () => {
  const [u] = await db.select().from(users).limit(1);
  user = { id: u.id, email: u.email, permissions: new Set() } as never;
  [{ id: customerId }] = await db.insert(customers).values({ name: "Billing Tester", trn: "100200300400003", creditDays: 20 }).returning({ id: customers.id });
  [origCompany] = await db.select().from(companySettings);
  await db.update(companySettings).set({ trn: null });
});
afterAll(async () => {
  await db.update(companySettings).set({ trn: origCompany.trn, name: origCompany.name });
  await db.transaction(async (tx) => {
    for (const t of ["invoices", "invoice_lines", "payments"]) await tx.execute(sql.raw(`alter table ${t} disable trigger user`));
    const invs = (await tx.select({ id: invoices.id }).from(invoices).where(inArray(invoices.saleId, saleIds))).map((i) => i.id);
    if (invs.length) { await tx.delete(payments).where(inArray(payments.invoiceId, invs)); await tx.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, invs)); await tx.delete(invoices).where(inArray(invoices.id, invs)); }
    for (const t of ["invoices", "invoice_lines", "payments"]) await tx.execute(sql.raw(`alter table ${t} enable trigger user`));
    await tx.delete(saleLines).where(inArray(saleLines.saleId, saleIds)); await tx.delete(sales).where(inArray(sales.id, saleIds));
    await tx.delete(customers).where(eq(customers.id, customerId));
  });
  await pg.end();
});

describe("sale lines form", () => {
  it("skips blank rows and validates the rest", () => {
    const ok = parseLines(form({ "desc:0": "Clearing", "qty:0": "2", "price:0": "1,200.50", "vat:0": "5", "desc:1": "", "qty:1": "", "price:1": "" }));
    expect(ok).toEqual({ ok: true, lines: [{ description: "Clearing", qty: "2", unitPrice: "1200.50", vatRate: "5" }] });
    expect(parseLines(form({ "desc:0": "x", "qty:0": "0", "price:0": "5" }))).toMatchObject({ ok: false });
    expect(parseLines(form({ "desc:0": "", "qty:0": "1", "price:0": "5" }))).toMatchObject({ ok: false });
    expect(parseLines(form({ "desc:0": "x", "qty:0": "1", "price:0": "5", "vat:0": "12" }))).toMatchObject({ ok: false });
    expect(parseLines(form({}))).toMatchObject({ ok: false });
  });
});

describe("sales and tax invoices", () => {
  let saleId: string, invoiceId: string;
  it("computes sale totals with per-line VAT", async () => {
    saleId = await mk([{ description: "Clearing", qty: "10", unitPrice: "100", vatRate: "5" }, { description: "Export fee", qty: "2", unitPrice: "250.50", vatRate: "0" }]);
    const d = (await b.getSale(saleId))!;
    expect(d.totals.subtotal.toString()).toBe("1501"); expect(d.totals.vatTotal.toString()).toBe("50"); expect(d.totals.total.toString()).toBe("1551");
    const list = await b.listSales({ q: "Billing Tester" });
    expect(Number(list.rows[0].total)).toBe(1551);
  });

  it("needs the company TRN, then numbers invoices in sequence and freezes the details", async () => {
    await expect(inv(saleId)).rejects.toMatchObject({ status: 422 });
    await db.update(companySettings).set({ trn: "100999888777666", name: "Frozen Co" });
    const a = await inv(saleId); invoiceId = a.id;
    expect(a.number).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(a.total).toBe("1551.00");
    expect(a.dueDate).toBe(new Date(Date.parse(today) + 20 * 86400000).toISOString().slice(0, 10)); // customer credit days
    expect(a.parties.company).toMatchObject({ name: "Frozen Co", trn: "100999888777666" });
    await db.update(companySettings).set({ name: "Renamed Co" });
    expect((await b.getInvoice(a.id))!.inv.parties.company.name).toBe("Frozen Co");
    const s2 = await mk([{ description: "Other", qty: "1", unitPrice: "10", vatRate: "5" }]);
    const second = await inv(s2);
    expect(Number(second.number.slice(-4))).toBe(Number(a.number.slice(-4)) + 1);
  });

  it("one invoice per sale; invoiced sales cannot change; database blocks edits and deletes", async () => {
    await expect(inv(saleId)).rejects.toMatchObject({ status: 409 });
    await expect(b.saveSale(saleId, { customerId, saleDate: today, billRef: null, notes: null, lines: [{ description: "x", qty: "1", unitPrice: "1", vatRate: "5" }] }, 1, user, meta)).rejects.toMatchObject({ status: 409 });
    await expect(db.update(invoices).set({ total: "1.00" }).where(eq(invoices.id, invoiceId))).rejects.toThrow();
    await expect(db.delete(invoices).where(eq(invoices.id, invoiceId))).rejects.toThrow();
    await expect(db.update(invoiceLines).set({ qty: "99" }).where(eq(invoiceLines.invoiceId, invoiceId))).rejects.toThrow();
  });

  it("two simultaneous invoice requests for one sale create exactly one invoice", async () => {
    const s = await mk([{ description: "Race", qty: "1", unitPrice: "100", vatRate: "5" }]);
    const r = await Promise.allSettled([inv(s), inv(s)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("payments: partial, full, overpayment blocked, status and receivables", async () => {
    expect((await b.getInvoice(invoiceId))!.state).toBe("unpaid");
    const p = await b.recordPayment({ invoiceId, paymentDate: today, amount: "500", method: "bank_transfer", reference: "TT1" }, user, meta);
    expect(p.ref).toMatch(/^PAY-\d{4}$/);
    expect((await b.getInvoice(invoiceId))!.state).toBe("partial");
    await expect(b.recordPayment({ invoiceId, paymentDate: today, amount: "1100", method: "cash", reference: null }, user, meta)).rejects.toMatchObject({ status: 422 });
    await b.recordPayment({ invoiceId, paymentDate: today, amount: "1051", method: "cheque", reference: null }, user, meta);
    expect((await b.getInvoice(invoiceId))!.state).toBe("paid");
    await expect(db.update(payments).set({ amount: "1" }).where(eq(payments.id, p.id))).rejects.toThrow();
    await expect(db.update(invoices).set({ paidAmount: "99999" }).where(eq(invoices.id, invoiceId))).rejects.toThrow(); // CHECK paid <= total
    expect((await b.listInvoices({ status: "paid", q: "Billing Tester" })).total).toBe(1);
    const r = (await b.receivables()).rows.find((x) => x.customerId === customerId)!;
    expect(Number(r.outstanding)).toBe(10.5 + 105); // the two other invoices stay unpaid
  });

  it("an unpaid invoice past its due date is overdue", async () => {
    const s = await mk([{ description: "Old", qty: "1", unitPrice: "100", vatRate: "5" }]);
    const old = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const i = await inv(s, { issueDate: old });
    expect((await b.getInvoice(i.id))!.state).toBe("overdue");
    expect((await b.listInvoices({ status: "overdue", q: "Billing Tester" })).total).toBe(1);
  });
});
