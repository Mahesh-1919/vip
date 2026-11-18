import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, sql as pg } from "@/db";
import { billAllocations, companySettings, customers, entryBills, exitBills, invoiceLines, invoices, payments, saleLines, sales, users } from "@/db/schema";
import * as fz from "@/services/freezone";
import * as xb from "@/services/exit-billing";
import * as billing from "@/services/billing";

const meta = { ip: null, userAgent: null };
const tag = `LK${Date.now()}`;
const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let user: never, custA: string, custB: string, origCompany: typeof companySettings.$inferSelect;
const entry: Record<string, string> = {}, exit: Record<string, string> = {};

const mkEntry = async (key: string, packages: number, date: number) => { [{ id: entry[key] }] = await db.insert(entryBills).values({ billDate: d(date), billNo: `${tag}-${key}`, packages, weightKg: String(packages * 10), valueAed: "1000" }).returning({ id: entryBills.id }); };
const mkExit = async (key: string, over: Partial<typeof exitBills.$inferInsert>) => { [{ id: exit[key] }] = await db.insert(exitBills).values({ exitDate: d(-3), boeNo: `${tag}-${key}`, billType: "EXPORT", packages: 10, valueAed: "1000", customerId: custA, ...over }).returning({ id: exitBills.id }); };
const alloc = (x: string, e: string, packages: number) => fz.allocate({ exitBillId: exit[x], entryBillId: entry[e], packages, weightKg: "0" }, user, meta);
const bill = (customerId: string, lines: [string, number][], issue = d(0)) => xb.createExitInvoice({ customerId, issueDate: issue, dueDate: null, notes: null, lines: lines.map(([k, packages]) => ({ exitBillId: exit[k], packages })) }, user, meta);
const remaining = async (e: string) => (await fz.getEntryDetail(entry[e]))!.remaining;

beforeAll(async () => {
  const [u] = await db.select().from(users).limit(1);
  user = { id: u.id, email: u.email, permissions: new Set() } as never;
  [{ id: custA }] = await db.insert(customers).values({ name: `${tag} A`, creditDays: 10 }).returning({ id: customers.id });
  [{ id: custB }] = await db.insert(customers).values({ name: `${tag} B` }).returning({ id: customers.id });
  [origCompany] = await db.select().from(companySettings);
  await db.update(companySettings).set({ trn: "100999888777666" });
  await mkEntry("E1", 100, -20); await mkEntry("E2", 50, -19); await mkEntry("E3", 20, -5);
  await mkExit("X1", { packages: 60, valueAed: "6000" });
  await mkExit("X2", { packages: 50, valueAed: "5000", customerId: custB });
  await mkExit("X3", { billType: "IMPORT", packages: 1, valueAed: "500" });
  await mkExit("X4", { customerId: null });
  await mkExit("X5", { packages: 3, valueAed: "1000" });
  await mkExit("X6", { packages: 5, exitDate: d(-30) }); // before any entry
  await mkExit("X7", { packages: 30, valueAed: "3000" });
});

afterAll(async () => {
  await db.update(companySettings).set({ trn: origCompany.trn });
  const eids = Object.values(exit), nids = Object.values(entry);
  await db.transaction(async (tx) => {
    for (const t of ["invoices", "invoice_lines", "payments"]) await tx.execute(sql.raw(`alter table ${t} disable trigger user`));
    const lines = await tx.select({ id: invoiceLines.invoiceId, sid: invoices.saleId }).from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId)).where(inArray(invoiceLines.exitBillId, eids));
    const invIds = [...new Set(lines.map((l) => l.id))], saleIds = [...new Set(lines.map((l) => l.sid))];
    if (invIds.length) { await tx.delete(payments).where(inArray(payments.invoiceId, invIds)); await tx.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, invIds)); await tx.delete(invoices).where(inArray(invoices.id, invIds)); }
    for (const t of ["invoices", "invoice_lines", "payments"]) await tx.execute(sql.raw(`alter table ${t} enable trigger user`));
    if (saleIds.length) { await tx.delete(saleLines).where(inArray(saleLines.saleId, saleIds)); await tx.delete(sales).where(inArray(sales.id, saleIds)); }
    await tx.delete(billAllocations).where(inArray(billAllocations.exitBillId, eids));
    await tx.delete(exitBills).where(inArray(exitBills.id, eids)); await tx.delete(entryBills).where(inArray(entryBills.id, nids));
    await tx.delete(customers).where(inArray(customers.id, [custA, custB]));
  });
  await pg.end();
});

describe("linking exit bills to entry bills", () => {
  it("one entry can feed several exits (several customers) and tracks what is left", async () => {
    await alloc("X1", "E1", 60);
    expect(await remaining("E1")).toBe(40);
    await alloc("X2", "E1", 40); // a second customer takes the rest of the same entry
    expect(await remaining("E1")).toBe(0);
    const det = (await fz.getEntryDetail(entry.E1))!;
    expect(det.allocations.map((a) => a.a.packages).sort((a, b) => a - b)).toEqual([40, 60]);
  });

  it("one exit can draw from several entries", async () => {
    await alloc("X7", "E2", 20); await alloc("X7", "E3", 10);
    const x = (await fz.getExitDetail(exit.X7))!;
    expect(x.allocations).toHaveLength(2); expect(x.allocated).toBe(30); expect(x.unallocated).toBe(0);
  });

  it("an exit cannot allocate more than its own package count, nor before the goods arrived", async () => {
    await expect(alloc("X1", "E2", 1)).rejects.toMatchObject({ status: 422 }); // X1 already has 60 of 60
    await expect(alloc("X6", "E1", 1)).rejects.toMatchObject({ status: 422 }); // exit dated before the entry
  });

  it("stock can never go negative: an entry cannot supply more than it imported", async () => {
    // E1 is fully used (100/100): even one more package is refused
    await expect(alloc("X5", "E1", 3)).rejects.toMatchObject({ status: 409 });
    expect(await remaining("E1")).toBe(0);
    // E2 has 50, X7 took 20: asking for 31 (> 30 left) is refused, 3 is fine
    await mkExit("X8", { packages: 31 });
    await expect(alloc("X8", "E2", 31)).rejects.toMatchObject({ status: 409 });
    await db.delete(exitBills).where(eq(exitBills.id, exit.X8));
    await alloc("X5", "E2", 3);
    expect(await remaining("E2")).toBe(27);
  });

  it("two people allocating the last packages at once cannot both succeed", async () => {
    await mkExit("R1", { packages: 25 }); await mkExit("R2", { packages: 25 });
    await mkEntry("E4", 30, -10);
    const res = await Promise.allSettled([alloc("R1", "E4", 25), alloc("R2", "E4", 25)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await remaining("E4")).toBe(5);
  });

  it("filters show unlinked / partly linked exits and entries with stock left", async () => {
    const un = await fz.listExits({ q: tag, alloc: "none" });
    expect(un.rows.map((r) => r.e.boeNo)).toEqual(expect.arrayContaining([`${tag}-X3`, `${tag}-X4`]));
    expect((await fz.listExits({ q: tag, alloc: "full" })).rows.map((r) => r.e.boeNo)).toEqual(expect.arrayContaining([`${tag}-X1`, `${tag}-X7`]));
    expect((await fz.listEntries({ q: tag, open: "1" })).rows.map((r) => r.e.billNo)).toContain(`${tag}-E4`);
    expect((await fz.listEntries({ q: tag, open: "1" })).rows.map((r) => r.e.billNo)).not.toContain(`${tag}-E1`);
  });
});

describe("invoicing export bills, in whole or in part", () => {
  it("bills an export in three parts whose total equals the exit value to the fils", async () => {
    const a = await bill(custA, [["X5", 1]]);
    const b = await bill(custA, [["X5", 1]]);
    expect(a.total).toBe("333.33"); expect(b.total).toBe("333.33");
    const c = await bill(custA, [["X5", 1]]); // final part takes the exact remainder
    expect(c.total).toBe("333.34");
    const x = (await fz.getExitDetail(exit.X5))!;
    expect(Number(x.billedValue)).toBe(1000); expect(x.unbilled).toBe(0);
    await expect(bill(custA, [["X5", 1]])).rejects.toMatchObject({ status: 409 }); // nothing left
  });

  it("zero-rates exports, creates the sale record and matches the totals", async () => {
    const inv = await bill(custA, [["X1", 20]]);
    expect(inv.vatTotal).toBe("0.00"); expect(inv.total).toBe("2000.00");
    const full = (await billing.getInvoice(inv.id))!;
    expect(full.lines[0].exitBillId).toBe(exit.X1); expect(Number(full.lines[0].vatRate)).toBe(0);
    expect(full.lines[0].description).toMatch(new RegExp(`BOE ${tag}-X1.*\\(20 of 60 packages\\)`));
    const sale = (await billing.getSale(full.sale.id))!;
    expect(sale.totals.total.toFixed(2)).toBe("2000.00");
    expect(sale.invoice?.number).toBe(inv.number);
    const list = await billing.listSales({ q: full.sale.ref });
    expect(Number(list.rows[0].total)).toBe(2000);
  });

  it("refuses to over-bill, wrong customers, import bills and bills without a customer", async () => {
    await expect(bill(custA, [["X1", 41]])).rejects.toMatchObject({ status: 409 }); // 40 left
    await expect(bill(custA, [["X2", 5]])).rejects.toMatchObject({ status: 422 }); // belongs to B
    await expect(bill(custA, [["X3", 1]])).rejects.toThrow(/export bills only/);
    await expect(bill(custA, [["X4", 1]])).rejects.toMatchObject({ status: 422 }); // no customer linked
    await expect(bill(custA, [["X1", 0]])).rejects.toMatchObject({ status: 422 });
  });

  it("one invoice can cover several exits of the same customer", async () => {
    const inv = await bill(custA, [["X1", 40], ["X7", 30]]);
    expect(inv.total).toBe("6000.00".replace("6000", String(4000 + 3000))); // 4000 (rest of X1) + 3000 (X7)
    expect((await billing.getInvoice(inv.id))!.lines).toHaveLength(2);
    expect(inv.dueDate).toBe(d(10)); // customer credit days
    expect((await xb.invoiceableExits(custA)).map((r) => r.e.boeNo)).not.toContain(`${tag}-X1`);
  });

  it("two invoices racing for the same packages cannot both succeed", async () => {
    const r = await Promise.allSettled([bill(custB, [["X2", 40]]), bill(custB, [["X2", 40]])]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await fz.getExitDetail(exit.X2))!.unbilled).toBe(10);
  });

  it("an invoiced exit is locked: value, customer, allocations, deletion", async () => {
    const x = (await fz.getExit(exit.X2))!;
    const { id: _i, version, createdAt: _c, updatedAt: _u, createdBy: _b, ...data } = x; void _i; void _c; void _u; void _b;
    await expect(fz.saveExit(x.id, { ...data, valueAed: "9999.00" } as never, version, user, meta)).rejects.toMatchObject({ status: 409 });
    const ok = await fz.saveExit(x.id, { ...data, notes: "still editable" } as never, version, user, meta);
    expect(ok.notes).toBe("still editable");
    await expect(fz.deleteExit(x.id, user, meta)).rejects.toMatchObject({ status: 409 });
    const [a] = await db.select().from(billAllocations).where(eq(billAllocations.exitBillId, exit.X2));
    await expect(fz.removeAllocation(a.id, user, meta)).rejects.toMatchObject({ status: 409 });
    await expect(alloc("X2", "E4", 1)).rejects.toMatchObject({ status: 409 });
  });

  it("entries with exports cannot be deleted or cut below what was exported", async () => {
    await expect(fz.deleteEntry(entry.E1, user, meta)).rejects.toMatchObject({ status: 409 });
    const e = (await fz.getEntry(entry.E4))!;
    const { id: _i, version, createdAt: _c, updatedAt: _u, createdBy: _b, ...data } = e; void _i; void _c; void _u; void _b;
    await expect(fz.saveEntry(e.id, { ...data, packages: 10 } as never, version, user, meta)).rejects.toMatchObject({ status: 409 }); // 25 already exported
  });

  it("payments work on invoices created from exits", async () => {
    const [i] = (await billing.listInvoices({ q: `${tag} A` })).rows;
    await billing.recordPayment({ invoiceId: i.inv.id, paymentDate: d(0), amount: "100", method: "bank_transfer", reference: null }, user, meta);
    expect(["partial", "overdue"]).toContain((await billing.getInvoice(i.inv.id))!.state);
  });
});

import * as trace from "@/services/trace";
import { auditLogs } from "@/db/schema";

describe("stock rules: only linked goods are invoiced", () => {
  it("an export bill that is not linked to any entry cannot be invoiced", async () => {
    await mkExit("X9", { packages: 10, valueAed: "1000", truckContainerNo: "TSTU1234567" });
    await expect(bill(custA, [["X9", 5]])).rejects.toThrow(/not linked to any entry bill/);
    expect((await xb.invoiceableExits(custA)).find((r) => r.e.id === exit.X9)).toMatchObject({ allocated: 0, invoiceablePkgs: 0, remainingPkgs: 10 });
  });

  it("a partly linked export can only be invoiced for the linked packages; the final part takes the exact remainder", async () => {
    await mkExit("X10", { packages: 20, valueAed: "2000" });
    await alloc("X10", "E3", 8);
    await expect(bill(custA, [["X10", 9]])).rejects.toThrow(/only 8 packages are linked/);
    const first = await bill(custA, [["X10", 8]]);
    expect(first.total).toBe("800.00");
    await expect(alloc("X10", "E2", 12)).rejects.toMatchObject({ status: 409 }); // invoiced: links are locked, so link everything before the first invoice if you want more
  });

  it("linking everything first lets the whole bill be invoiced in parts that sum exactly", async () => {
    await mkExit("X11", { packages: 20, valueAed: "2000.01" });
    await alloc("X11", "E2", 20);
    const a = await bill(custA, [["X11", 7]]);
    const b = await bill(custA, [["X11", 13]]);
    expect(Number(a.total) + Number(b.total)).toBeCloseTo(2000.01, 2);
    expect(b.total).toBe((2000.01 - Number(a.total)).toFixed(2));
  });

  it("flags exports not backed by stock", async () => {
    const un = (await fz.listExits({ q: tag, backing: "unbacked" })).rows.map((r) => r.e.boeNo);
    expect(un).toContain(`${tag}-X9`); expect(un).toContain(`${tag}-X4`);
    expect(un).not.toContain(`${tag}-X1`); expect(un).not.toContain(`${tag}-X7`);
    expect(un).not.toContain(`${tag}-X3`); // import bills are not exports
  });

  it("warns when the linked weight is well above the imported weight", async () => {
    await mkExit("X12", { packages: 2, valueAed: "100" });
    const r = await fz.allocate({ exitBillId: exit.X12, entryBillId: entry.E3, packages: 1, weightKg: "999999" }, user, meta);
    expect(r.warnings[0]).toMatch(/Weight check/);
  });

  it("changing an entry's package count after goods left it needs a reason, and is flagged in the audit log", async () => {
    const e = (await fz.getEntry(entry.E4))!;
    const { id: _i, version, createdAt: _c, updatedAt: _u, createdBy: _b, ...data } = e; void _i; void _c; void _u; void _b;
    await expect(fz.saveEntry(e.id, { ...data, packages: 40 } as never, version, user, meta)).rejects.toMatchObject({ status: 422 });
    const ok = await fz.saveEntry(e.id, { ...data, packages: 40 } as never, version, user, meta, "Customs recount after unloading");
    expect(ok.packages).toBe(40);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, e.id));
    expect(logs.some((l) => l.action === "change_packages")).toBe(true);
    // an entry nobody has exported from needs no reason
    await mkEntry("E5", 10, -9);
    const e5 = (await fz.getEntry(entry.E5))!;
    const { id: _i2, version: v5, createdAt: _c2, updatedAt: _u2, createdBy: _b2, ...d5 } = e5; void _i2; void _c2; void _u2; void _b2;
    expect((await fz.saveEntry(e5.id, { ...d5, packages: 12 } as never, v5, user, meta)).packages).toBe(12);
  });
});

describe("shipment trace", () => {
  it("shows an import, who received how many packages through which exits, and the invoices", async () => {
    await db.update(entryBills).set({ marksNumbers: "TSTU1234567, TSTU7654321" }).where(eq(entryBills.id, entry.E1));
    const { traces, unlinkedExits } = await trace.traceEntries({ q: "TSTU7654321" });
    const t = traces.find((x) => x.entry.id === entry.E1)!;
    expect(t.entry.packages).toBe(100);
    expect(t.exported).toBe(100); // X1 60 + X2 40
    expect(t.remaining).toBe(0);
    const byName = Object.fromEntries(t.customers.map((c) => [c.name, c.packages]));
    expect(byName[`${tag} A`]).toBe(60); expect(byName[`${tag} B`]).toBe(40);
    const x1 = t.exits.find((e) => e.exit.id === exit.X1)!;
    expect(x1.billed.pk).toBe(60); expect(x1.billed.invoices.length).toBeGreaterThan(0);
    expect(trace.containersOf(t.entry.marksNumbers)).toEqual(["TSTU1234567", "TSTU7654321"]);
    // X9 names TSTU1234567 but is not linked to any entry: it must show up as an unlinked exit
    const found = await trace.traceEntries({ q: "TSTU1234567" });
    expect(found.unlinkedExits.map((x) => x.id)).toContain(exit.X9);
    expect(unlinkedExits).toBeDefined();
  });

  it("traces a customer's exits back to their source entries", async () => {
    const rows = await trace.traceCustomer(custA);
    const x7 = rows.find((r) => r.exit.id === exit.X7)!;
    expect(x7.sources.map((s) => s.a.packages).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(rows.find((r) => r.exit.id === exit.X9)!.sources).toHaveLength(0);
  });
});

describe("creating an export bill straight from stock", () => {
  const base = { exitDate: d(-1), valueAed: "500", weightKg: "50", importerName: "Test importer" } as never;

  it("creates the exit bill and takes its packages from the chosen entry in one step", async () => {
    await mkEntry("S1", 40, -10);
    const before = (await fz.entriesWithStock()).find((e) => e.id === entry.S1)!;
    expect(before.remaining).toBe(40);
    const r = await fz.createExitFromStock({ ...(base as object), boeNo: `${tag}-S1X`, packages: 15, customerId: custA, refundStatus: "Pending", entryCertStatus: "Pending" } as never, entry.S1, user, meta);
    exit.S1X = r.exit.id;
    expect(r.exit.billType).toBe("EXPORT");
    expect((await fz.entriesWithStock()).find((e) => e.id === entry.S1)!.remaining).toBe(25);
    expect((await fz.getExitDetail(r.exit.id))!.unallocated).toBe(0);
  });

  it("refuses more than is in stock and leaves no exit bill behind", async () => {
    await expect(fz.createExitFromStock({ ...(base as object), boeNo: `${tag}-S2X`, packages: 26, customerId: custA, refundStatus: "Pending", entryCertStatus: "Pending" } as never, entry.S1, user, meta)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(exitBills).where(eq(exitBills.boeNo, `${tag}-S2X`))).toHaveLength(0);
    expect((await fz.entriesWithStock()).find((e) => e.id === entry.S1)!.remaining).toBe(25);
  });

  it("an entry with nothing left drops out of the list", async () => {
    const r = await fz.createExitFromStock({ ...(base as object), boeNo: `${tag}-S3X`, packages: 25, customerId: custA, refundStatus: "Pending", entryCertStatus: "Pending" } as never, entry.S1, user, meta);
    exit.S3X = r.exit.id;
    expect((await fz.entriesWithStock()).some((e) => e.id === entry.S1)).toBe(false);
  });
});
