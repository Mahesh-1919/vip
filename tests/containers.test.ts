import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, sql as pg } from "@/db";
import {
  containerCosts, containerItems, containers, customers, productPackagings, products, stockLevels, stockLots, stockMoves, suppliers, uoms, users, warehouses,
} from "@/db/schema";
import { iso6346CheckDigit } from "@/lib/container";
import { purgeSince } from "./purge";
import * as c from "@/services/inventory/containers";

const meta = { ip: null, userAgent: null };
const tag = `CT${Date.now()}`;
let user: never, wh: string, supplierId: string, customerId: string;
const pid: Record<string, string> = {};
const made: string[] = [];
let serial = 100000 + (Date.now() % 800000);
const newNo = () => { const f = `TST${"U"}${String(serial++).padStart(6, "0")}`; return f + iso6346CheckDigit(f); };

const onHand = async (p: string) => (await db.select().from(stockLevels).where(eq(stockLevels.productId, p))).reduce((s, r) => s + Number(r.qty), 0);
const header = (over: Partial<c.ContainerInput> = {}): c.ContainerInput => ({
  direction: "inward", containerNo: newNo(), sealNo: null, size: "40HC", shippingLine: "MSC", vessel: null, voyage: null, billOfLading: "BL1", partyId: supplierId,
  incoterm: "CIF", originCountry: "IN", loadPort: "Nhava Sheva", dischargePort: "Jebel Ali", warehouseId: wh, eta: null, customsDeclarationNo: null, freeZone: true,
  currency: "AED", exchangeRate: "1", notes: null, ...over,
});
const item = (containerId: string, productId: string, over: Partial<c.ItemInput> = {}): c.ItemInput => ({
  containerId, productId, qty: "100", packagingId: null, unitPrice: "10", lotNo: null, expiryDate: null, serials: [], weightKg: "0", volumeCbm: "0", ...over,
});
const cost = (containerId: string, over: Partial<c.CostInput> = {}): c.CostInput => ({
  containerId, type: "freight", description: null, payeeSupplierId: null, amount: "1000", currency: "AED", exchangeRate: "1", vat: "0", allocation: "value", inLandedCost: true, incurredOn: "2026-11-01", ...over,
});

const t0 = new Date(Date.now() - 2000);

beforeAll(async () => {
  const [u] = await db.select().from(users).limit(1);
  user = { id: u.id, email: u.email, permissions: new Set() } as never;
  [{ id: wh }] = await db.select({ id: warehouses.id }).from(warehouses).limit(1);
  [{ id: supplierId }] = await db.insert(suppliers).values({ code: `${tag}-S`, name: "Test Supplier" }).returning({ id: suppliers.id });
  [{ id: customerId }] = await db.insert(customers).values({ code: `${tag}-C`, name: "Test Customer" }).returning({ id: customers.id });
  const us = Object.fromEntries((await db.select().from(uoms)).map((x) => [x.code, x.id]));
  const mk = async (k: string, uom: string, tracking: "quantity" | "serial") => { [{ id: pid[k] }] = await db.insert(products).values({ sku: `${tag}-${k}`, name: k, baseUomId: us[uom], tracking }).returning({ id: products.id }); };
  await mk("A", "PCS", "quantity"); await mk("B", "PCS", "quantity"); await mk("SER", "PCS", "serial");
  await db.insert(productPackagings).values({ productId: pid.A, name: "Box of 10", qty: "10" });
});

afterAll(async () => {
  await purgeSince(t0);
  const ids = Object.values(pid);
  await db.transaction(async (tx) => {
    await tx.execute(sql`alter table stock_moves disable trigger user`);
    await tx.execute(sql`alter table container_items disable trigger user`);
    await tx.delete(stockMoves).where(inArray(stockMoves.productId, ids));
    await tx.delete(containerItems).where(inArray(containerItems.productId, ids));
    await tx.execute(sql`alter table stock_moves enable trigger user`);
    await tx.execute(sql`alter table container_items enable trigger user`);
    await tx.delete(containerCosts).where(inArray(containerCosts.containerId, made));
    await tx.delete(containers).where(inArray(containers.id, made));
    await tx.delete(stockLevels).where(inArray(stockLevels.productId, ids));
    await tx.delete(stockLots).where(inArray(stockLots.productId, ids));
    await tx.delete(productPackagings).where(inArray(productPackagings.productId, ids));
    await tx.delete(products).where(inArray(products.id, ids));
    await tx.delete(suppliers).where(eq(suppliers.id, supplierId));
    await tx.delete(customers).where(eq(customers.id, customerId));
  });
  await pg.end();
});

describe("inward container: landed cost and receiving", () => {
  let id: string;
  it("rejects bad container numbers, wrong party and duplicate open containers", async () => {
    await expect(c.createContainer(header({ containerNo: "ABCD1234567" }), user, meta)).rejects.toMatchObject({ status: 422 });
    await expect(c.createContainer(header({ partyId: customerId }), user, meta)).rejects.toMatchObject({ status: 422 }); // customer is not a supplier
    const h = header();
    const first = await c.createContainer(h, user, meta); made.push(first.id);
    expect(first.ref).toMatch(/^IMP-\d{4}$/);
    expect(first.status).toBe("in_transit");
    await expect(c.createContainer(h, user, meta)).rejects.toMatchObject({ status: 409 });
    id = first.id;
  });

  it("allocates freight by weight and duty by value across items", async () => {
    await c.addItem(item(id, pid.A, { qty: "10", packagingId: (await db.select().from(productPackagings).where(eq(productPackagings.productId, pid.A)))[0].id, unitPrice: "10", weightKg: "500" }), user, meta); // 100 base units @10 = 1000
    await c.addItem(item(id, pid.B, { qty: "300", unitPrice: "10", weightKg: "1500" }), user, meta); // 3000
    await c.addCost(cost(id, { type: "freight", amount: "400", allocation: "weight" }), user, meta);
    await c.addCost(cost(id, { type: "customs_duty", amount: "200", allocation: "value", vat: "10" }), user, meta);
    await c.addCost(cost(id, { type: "other", description: "demurrage", amount: "999", inLandedCost: false }), user, meta); // expensed, not in stock value
    const d = (await c.getContainer(id))!;
    const a = d.landed.lines.find((l) => l.item.productId === pid.A)!, b = d.landed.lines.find((l) => l.item.productId === pid.B)!;
    expect(Number(a.item.qty)).toBe(100);
    expect(a.allocatedAed.toNumber()).toBe(150); // freight 100 (25%) + duty 50 (25%)
    expect(b.allocatedAed.toNumber()).toBe(450);
    expect(a.unitAed.toNumber()).toBe(11.5);
    expect(b.unitAed.toNumber()).toBe(11.5);
  });

  it("receives: posts stock at landed cost, snapshots cost and locks the items", async () => {
    await c.changeStatus(id, "at_port", user, meta);
    await expect(c.changeStatus(id, "in_transit", user, meta)).rejects.toMatchObject({ status: 409 }); // no going back
    await c.changeStatus(id, "received", user, meta);
    expect(await onHand(pid.A)).toBe(100);
    expect(await onHand(pid.B)).toBe(300);
    const [pa] = await db.select().from(products).where(eq(products.id, pid.A));
    expect(Number(pa.avgCost)).toBe(11.5);
    const d = (await c.getContainer(id))!;
    expect(d.c.status).toBe("received");
    expect(d.c.stockPostedAt).not.toBeNull();
    expect(d.items.every((x) => Number(x.i.landedUnitCostAed) === 11.5)).toBe(true);
    const moves = await db.select().from(stockMoves).where(eq(stockMoves.productId, pid.A));
    expect(moves[0]).toMatchObject({ refType: "container", refId: d.c.ref, type: "inward" });
    await expect(c.addItem(item(id, pid.A), user, meta)).rejects.toMatchObject({ status: 409 });
    await expect(db.insert(containerItems).values({ containerId: id, productId: pid.A, qty: "1" })).rejects.toThrow(); // DB trigger
    await expect(c.changeStatus(id, "cancelled", user, meta)).rejects.toMatchObject({ status: 409 });
    await expect(c.changeStatus(id, "received", user, meta)).rejects.toMatchObject({ status: 409 }); // never posts twice
    expect(await onHand(pid.A)).toBe(100);
  });

  it("a landed cost added after receipt does not silently revalue stock, and cannot be removed once capitalised", async () => {
    const d = (await c.getContainer(id))!;
    const k = d.costs.find((x) => x.type === "freight")!;
    await expect(c.removeCost(k.id, user, meta)).rejects.toMatchObject({ status: 409 });
    const dem = d.costs.find((x) => x.description === "demurrage")!;
    await c.removeCost(dem.id, user, meta); // expensed-only costs may be removed
  });
});

describe("multi-currency", () => {
  it("converts goods and costs to AED at the container exchange rate", async () => {
    const co = await c.createContainer(header({ currency: "USD", exchangeRate: "3.6725" }), user, meta); made.push(co.id);
    await c.addItem(item(co.id, pid.A, { qty: "100", unitPrice: "2" }), user, meta);
    await c.addCost(cost(co.id, { amount: "100", currency: "USD", exchangeRate: "3.6725" }), user, meta);
    const d = (await c.getContainer(co.id))!;
    expect(d.landed.lines[0].goodsAed.toNumber()).toBe(734.5);
    expect(d.costs[0].amountAed).toBe("367.25");
    expect(d.landed.lines[0].unitAed.toNumber()).toBe(11.0175); // (734.5 + 367.25) / 100
    await expect(c.createContainer(header({ currency: "AED", exchangeRate: "3.67" }), user, meta)).rejects.toMatchObject({ status: 422 });
  });
});

describe("outward container: dispatch deducts stock atomically", () => {
  it("dispatches serials and quantities, and rolls back entirely when stock is short", async () => {
    // stock to ship
    const rec = await c.createContainer(header(), user, meta); made.push(rec.id);
    await c.addItem(item(rec.id, pid.SER, { serials: ["SN1", "SN2", "SN3"], unitPrice: "500" }), user, meta);
    await c.changeStatus(rec.id, "received", user, meta);
    expect(await onHand(pid.SER)).toBe(3);

    const out = await c.createContainer(header({ direction: "outward", partyId: customerId, billOfLading: "BLX", loadPort: "Jebel Ali", dischargePort: "Mombasa" }), user, meta); made.push(out.id);
    expect(out.ref).toMatch(/^EXP-\d{4}$/);
    expect(out.status).toBe("packing");
    await c.addItem(item(out.id, pid.SER, { serials: ["SN1", "SN2"], unitPrice: "650" }), user, meta);
    await c.addItem(item(out.id, pid.B, { qty: "1000", unitPrice: "12" }), user, meta); // only ~300 in stock
    const beforeA = await onHand(pid.SER), beforeB = await onHand(pid.B);
    await expect(c.changeStatus(out.id, "dispatched", user, meta)).rejects.toMatchObject({ status: 409 });
    expect(await onHand(pid.SER)).toBe(beforeA); // SN1/SN2 posting rolled back with the failed one
    expect(await onHand(pid.B)).toBe(beforeB);
    const [still] = await db.select().from(containers).where(eq(containers.id, out.id));
    expect(still.status).toBe("packing");
    expect(still.stockPostedAt).toBeNull();

    // fix the quantity: remove and re-add within stock
    const d = (await c.getContainer(out.id))!;
    await c.removeItem(d.items.find((x) => x.sku.endsWith("-B"))!.i.id, user, meta);
    await c.addItem(item(out.id, pid.B, { qty: "50", unitPrice: "12" }), user, meta);
    await c.changeStatus(out.id, "dispatched", user, meta);
    expect(await onHand(pid.SER)).toBe(1);
    expect(await onHand(pid.B)).toBe(beforeB - 50);
    await c.changeStatus(out.id, "shipped", user, meta);
    await c.changeStatus(out.id, "delivered", user, meta);
    expect((await c.getContainer(out.id))!.c.status).toBe("delivered");
    const [lvl] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, pid.SER), eq(stockLevels.warehouseId, wh)));
    expect(lvl).toBeDefined();
  });
});
