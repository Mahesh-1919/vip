import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, sql as pg } from "@/db";
import { productPackagings, products, stockLevels, stockLots, stockMoves, uoms, users, warehouses } from "@/db/schema";
import * as stock from "@/services/inventory/stock";

const meta = { ip: null, userAgent: null };
const tag = `T${Date.now()}`;
let user: never, w1: string, w2: string;
const pid: Record<string, string> = {};

const onHand = async (productId: string, warehouseId?: string) => {
  const rows = await db.select().from(stockLevels).where(eq(stockLevels.productId, productId));
  return rows.filter((r) => !warehouseId || r.warehouseId === warehouseId).reduce((s, r) => s + Number(r.qty), 0);
};
const entry = (over: Partial<stock.StockEntry> & { productId: string }): stock.StockEntry => ({
  kind: "adjustment_in", warehouseId: w1, qty: "1", packagingId: null, unitCost: null, lotNo: null, expiryDate: null, serials: [], note: null, ...over,
});

beforeAll(async () => {
  const [u] = await db.select().from(users).limit(1);
  user = { id: u.id, email: u.email, permissions: new Set() } as never;
  const wh = await db.select().from(warehouses).orderBy(warehouses.code);
  [w1, w2] = [wh[0].id, wh[1].id];
  const us = Object.fromEntries((await db.select().from(uoms)).map((x) => [x.code, x.id]));
  const mk = async (key: string, uom: string, tracking: "quantity" | "batch" | "serial") => {
    const [p] = await db.insert(products).values({ sku: `${tag}-${key}`, name: `Test ${key}`, baseUomId: us[uom], tracking }).returning();
    pid[key] = p.id;
  };
  await mk("QTY", "PCS", "quantity"); await mk("KG", "KG", "quantity"); await mk("BATCH", "L", "batch"); await mk("SER", "PCS", "serial");
  await db.insert(productPackagings).values({ productId: pid.QTY, name: "Box of 12", qty: "12" });
});

afterAll(async () => {
  const ids = Object.values(pid);
  // The ledger is append-only by trigger; test cleanup disables user triggers briefly (dev DB owner only).
  await db.transaction(async (tx) => {
    await tx.execute(sql`alter table stock_moves disable trigger user`);
    await tx.delete(stockMoves).where(inArray(stockMoves.productId, ids));
    await tx.execute(sql`alter table stock_moves enable trigger user`);
    await tx.delete(stockLevels).where(inArray(stockLevels.productId, ids));
    await tx.delete(stockLots).where(inArray(stockLots.productId, ids));
    await tx.delete(productPackagings).where(inArray(productPackagings.productId, ids));
    await tx.delete(products).where(inArray(products.id, ids));
  });
  await pg.end();
});

describe("weighted-average cost and non-negative stock", () => {
  it("averages cost across inward receipts", async () => {
    await stock.recordStock(entry({ productId: pid.QTY, kind: "inward", qty: "100", unitCost: "10" }), user, meta);
    await stock.recordStock(entry({ productId: pid.QTY, kind: "inward", qty: "100", unitCost: "20" }), user, meta);
    const p = await stock.getProduct(pid.QTY);
    expect(Number(p!.p.avgCost)).toBe(15);
    expect(await onHand(pid.QTY)).toBe(200);
  });

  it("requires a cost for inward stock", async () => {
    await expect(stock.recordStock(entry({ productId: pid.QTY, kind: "inward", qty: "1" }), user, meta)).rejects.toMatchObject({ status: 422 });
  });

  it("refuses to go negative and leaves stock untouched", async () => {
    await stock.recordStock(entry({ productId: pid.QTY, kind: "adjustment_out", qty: "150" }), user, meta);
    await expect(stock.recordStock(entry({ productId: pid.QTY, kind: "adjustment_out", qty: "51" }), user, meta)).rejects.toMatchObject({ status: 409 });
    expect(await onHand(pid.QTY)).toBe(50);
  });

  it("serialises concurrent outward moves: only what is available is issued", async () => {
    const res = await Promise.allSettled([1, 2, 3].map(() => stock.recordStock(entry({ productId: pid.QTY, kind: "adjustment_out", qty: "30" }), user, meta)));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1); // 50 available: one 30 fits, others do not
    expect(await onHand(pid.QTY)).toBe(20);
  });

  it("the database itself rejects negative stock and edits to the ledger", async () => {
    await expect(db.update(stockLevels).set({ qty: "-1" }).where(eq(stockLevels.productId, pid.QTY))).rejects.toThrow();
    await expect(db.update(stockMoves).set({ note: "tamper" }).where(eq(stockMoves.productId, pid.QTY))).rejects.toThrow();
    await expect(db.delete(stockMoves).where(eq(stockMoves.productId, pid.QTY))).rejects.toThrow();
  });
});

describe("units and packagings", () => {
  it("rejects fractions for whole-number units but allows them for kg", async () => {
    await expect(stock.recordStock(entry({ productId: pid.QTY, qty: "1.5" }), user, meta)).rejects.toMatchObject({ status: 422 });
    await stock.recordStock(entry({ productId: pid.KG, kind: "opening", qty: "12.5", unitCost: "3" }), user, meta);
    expect(await onHand(pid.KG)).toBe(12.5);
  });

  it("converts packs to base units and remembers how it was entered", async () => {
    const [pk] = await db.select().from(productPackagings).where(eq(productPackagings.productId, pid.QTY));
    const [m] = await stock.recordStock(entry({ productId: pid.QTY, qty: "5", packagingId: pk.id }), user, meta);
    expect(Number(m.qty)).toBe(60);
    expect(m.enteredAs).toBe("5 × Box of 12");
    await expect(stock.recordStock(entry({ productId: pid.KG, qty: "1", packagingId: pk.id }), user, meta)).rejects.toMatchObject({ status: 422 });
  });
});

describe("batch and serial tracking", () => {
  it("requires a batch number and issues from a specific batch", async () => {
    await expect(stock.recordStock(entry({ productId: pid.BATCH, kind: "opening", qty: "100", unitCost: "5" }), user, meta)).rejects.toMatchObject({ status: 422 });
    await stock.recordStock(entry({ productId: pid.BATCH, kind: "opening", qty: "100", unitCost: "5", lotNo: "B1", expiryDate: "2027-01-31" }), user, meta);
    await stock.recordStock(entry({ productId: pid.BATCH, kind: "opening", qty: "50", unitCost: "5", lotNo: "B2" }), user, meta);
    await expect(stock.recordStock(entry({ productId: pid.BATCH, kind: "adjustment_out", qty: "10", lotNo: "NOPE" }), user, meta)).rejects.toMatchObject({ status: 404 });
    await expect(stock.recordStock(entry({ productId: pid.BATCH, kind: "adjustment_out", qty: "60", lotNo: "B2" }), user, meta)).rejects.toMatchObject({ status: 409 }); // B2 only has 50
    await stock.recordStock(entry({ productId: pid.BATCH, kind: "adjustment_out", qty: "60", lotNo: "B1" }), user, meta);
    expect(await onHand(pid.BATCH)).toBe(90);
  });

  it("tracks serials one unit each and blocks duplicates", async () => {
    await stock.recordStock(entry({ productId: pid.SER, kind: "opening", unitCost: "500", serials: ["S1", "S2", "S3"] }), user, meta);
    expect(await onHand(pid.SER)).toBe(3);
    await expect(stock.recordStock(entry({ productId: pid.SER, kind: "opening", unitCost: "500", serials: ["S2"] }), user, meta)).rejects.toMatchObject({ status: 409 });
    await expect(stock.recordStock(entry({ productId: pid.SER, kind: "opening", unitCost: "500", serials: [] }), user, meta)).rejects.toMatchObject({ status: 422 });
    await stock.recordStock(entry({ productId: pid.SER, kind: "adjustment_out", lotNo: "S1" }), user, meta);
    await expect(stock.recordStock(entry({ productId: pid.SER, kind: "adjustment_out", lotNo: "S1" }), user, meta)).rejects.toMatchObject({ status: 409 });
    expect(await onHand(pid.SER)).toBe(2);
  });
});

describe("transfers", () => {
  it("moves stock between warehouses atomically at the same cost", async () => {
    const before = Number((await stock.getProduct(pid.QTY))!.p.avgCost);
    const w1Before = await onHand(pid.QTY, w1);
    await stock.transferStock({ productId: pid.QTY, fromWarehouseId: w1, toWarehouseId: w2, qty: "10", packagingId: null, lotNo: null, note: null }, user, meta);
    expect(await onHand(pid.QTY, w1)).toBe(w1Before - 10);
    expect(await onHand(pid.QTY, w2)).toBe(10);
    expect(Number((await stock.getProduct(pid.QTY))!.p.avgCost)).toBe(before);
    // over-transfer fails as a whole: nothing leaves the source or arrives at the destination
    await expect(stock.transferStock({ productId: pid.QTY, fromWarehouseId: w2, toWarehouseId: w1, qty: "11", packagingId: null, lotNo: null, note: null }, user, meta)).rejects.toMatchObject({ status: 409 });
    expect(await onHand(pid.QTY, w2)).toBe(10);
    await expect(stock.transferStock({ productId: pid.QTY, fromWarehouseId: w1, toWarehouseId: w1, qty: "1", packagingId: null, lotNo: null, note: null }, user, meta)).rejects.toMatchObject({ status: 422 });
  });

  it("carries serial numbers through a transfer", async () => {
    await stock.transferStock({ productId: pid.SER, fromWarehouseId: w1, toWarehouseId: w2, qty: "1", packagingId: null, lotNo: "S2", note: null }, user, meta);
    expect(await onHand(pid.SER, w2)).toBe(1);
    expect(await onHand(pid.SER, w1)).toBe(1);
  });
});
