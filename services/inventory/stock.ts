import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { productCategories, productPackagings, products, stockLevels, stockLots, stockMoves, uoms, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { D, Decimal } from "@/lib/money";
import type { CurrentUser } from "@/lib/auth";

type Meta = { ip: string | null; userAgent: string | null };
type MoveType = (typeof stockMoves.$inferInsert)["type"];
const INBOUND: MoveType[] = ["opening", "inward", "adjustment_in", "transfer_in"];
const COSTED_IN: MoveType[] = ["opening", "inward", "adjustment_in"]; // these may change the weighted-average cost

export type MoveInput = {
  productId: string; warehouseId: string; type: MoveType;
  /** Positive magnitude in the product's base UoM (the sign comes from `type`). */
  qty: Decimal.Value;
  unitCost?: Decimal.Value | null;
  lotNo?: string | null; expiryDate?: string | null;
  refType?: string | null; refId?: string | null; enteredAs?: string | null; note?: string | null;
};

/**
 * The single place stock changes. Runs inside the caller's transaction, locks the product and the
 * stock row, refuses to go below zero, maintains weighted-average cost and appends to the ledger.
 */
export async function postMove(tx: Tx, m: MoveInput, userId: string | null) {
  const qty = D(m.qty);
  if (qty.lte(0)) throw new AppError(422, "Quantity must be greater than zero");
  if (qty.decimalPlaces() > 4) throw new AppError(422, "Quantity supports at most 4 decimal places");
  const inbound = INBOUND.includes(m.type);

  const [p] = await tx.select({ p: products, uom: uoms }).from(products).innerJoin(uoms, eq(uoms.id, products.baseUomId)).where(eq(products.id, m.productId)).for("update", { of: products });
  if (!p) throw new AppError(404, "Product not found");
  if (!p.p.isActive && inbound) throw new AppError(422, `${p.p.sku} is inactive`);
  if (!p.uom.allowDecimal && !qty.isInteger()) throw new AppError(422, `${p.p.sku} is counted in whole ${p.uom.name.toLowerCase()}s`);
  const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, m.warehouseId));
  if (!wh || (!wh.isActive && inbound)) throw new AppError(422, "Unknown or inactive warehouse");

  // Lot / serial handling
  let lotId: string | null = null;
  if (p.p.tracking !== "quantity") {
    const lotNo = m.lotNo?.trim();
    if (!lotNo) throw new AppError(422, `${p.p.sku} is ${p.p.tracking}-tracked: a ${p.p.tracking === "serial" ? "serial" : "batch"} number is required`);
    if (p.p.tracking === "serial" && !qty.eq(1)) throw new AppError(422, "Serial-tracked items move one unit per serial number");
    const [existing] = await tx.select().from(stockLots).where(and(eq(stockLots.productId, m.productId), eq(stockLots.lotNo, lotNo)));
    if (existing) lotId = existing.id;
    else if (inbound) {
      [{ id: lotId }] = await tx.insert(stockLots).values({ productId: m.productId, lotNo, expiryDate: m.expiryDate || null }).returning({ id: stockLots.id });
    } else throw new AppError(404, `Unknown ${p.p.tracking === "serial" ? "serial" : "batch"} number ${lotNo}`);
  }
  const lotKey = lotId ?? "";

  const total = async () => {
    const [r] = await tx.select({ t: sql<string>`coalesce(sum(${stockLevels.qty}), 0)` }).from(stockLevels).where(eq(stockLevels.productId, m.productId));
    return D(r.t);
  };
  if (p.p.tracking === "serial" && inbound && m.type !== "transfer_in") {
    const [r] = await tx.select({ t: sql<string>`coalesce(sum(${stockLevels.qty}), 0)` }).from(stockLevels).where(and(eq(stockLevels.productId, m.productId), eq(stockLevels.lotKey, lotKey)));
    if (D(r.t).gt(0)) throw new AppError(409, `Serial ${m.lotNo} is already in stock`);
  }

  await tx.insert(stockLevels).values({ productId: m.productId, warehouseId: m.warehouseId, lotId, lotKey, qty: "0" }).onConflictDoNothing();
  const [lvl] = await tx.select().from(stockLevels).where(and(eq(stockLevels.productId, m.productId), eq(stockLevels.warehouseId, m.warehouseId), eq(stockLevels.lotKey, lotKey))).for("update");
  const newQty = inbound ? D(lvl.qty).plus(qty) : D(lvl.qty).minus(qty);
  if (newQty.isNegative()) {
    throw new AppError(409, `Insufficient stock for ${p.p.sku} at ${wh.name}${lotId ? ` (lot ${m.lotNo})` : ""}: ${D(lvl.qty).toFixed()} available, ${qty.toFixed()} requested`);
  }

  // Weighted-average cost
  const avg = D(p.p.avgCost);
  let unitCost = avg;
  if (COSTED_IN.includes(m.type) && m.unitCost !== undefined && m.unitCost !== null && String(m.unitCost) !== "") {
    unitCost = D(m.unitCost);
    if (unitCost.isNegative()) throw new AppError(422, "Unit cost cannot be negative");
    const before = await total();
    const after = before.plus(qty);
    const newAvg = before.lte(0) ? unitCost : before.times(avg).plus(qty.times(unitCost)).div(after);
    await tx.update(products).set({ avgCost: newAvg.toDecimalPlaces(4).toFixed(4), version: sql`${products.version} + 1` }).where(eq(products.id, m.productId));
  } else if (m.type === "inward" || m.type === "opening") {
    throw new AppError(422, "A unit cost is required for inward and opening stock");
  }

  await tx.update(stockLevels).set({ qty: newQty.toFixed(4) }).where(eq(stockLevels.id, lvl.id));
  const [move] = await tx.insert(stockMoves).values({
    productId: m.productId, warehouseId: m.warehouseId, lotId, type: m.type, qty: (inbound ? qty : qty.neg()).toFixed(4), unitCost: unitCost.toDecimalPlaces(4).toFixed(4),
    refType: m.refType ?? "manual", refId: m.refId ?? null, enteredAs: m.enteredAs ?? null, note: m.note ?? null, createdBy: userId,
  }).returning();
  return move;
}

/** Converts "N × pack" to base units. */
async function toBase(tx: Tx, productId: string, qty: Decimal.Value, packagingId: string | null) {
  if (!packagingId) return { base: D(qty), enteredAs: null as string | null };
  const [pk] = await tx.select().from(productPackagings).where(and(eq(productPackagings.id, packagingId), eq(productPackagings.productId, productId)));
  if (!pk) throw new AppError(422, "That packaging does not belong to the selected product");
  return { base: D(qty).times(pk.qty), enteredAs: `${D(qty).toFixed()} × ${pk.name}` };
}

export type StockEntry = {
  kind: "opening" | "inward" | "adjustment_in" | "adjustment_out";
  productId: string; warehouseId: string; qty: string; packagingId: string | null;
  unitCost: string | null; lotNo: string | null; expiryDate: string | null; serials: string[]; note: string | null;
};

export async function recordStock(e: StockEntry, user: CurrentUser, meta: Meta) {
  return db.transaction(async (tx) => {
    const { base, enteredAs } = await toBase(tx, e.productId, e.qty, e.packagingId);
    const [p] = await tx.select({ tracking: products.tracking, sku: products.sku }).from(products).where(eq(products.id, e.productId));
    if (!p) throw new AppError(404, "Product not found");
    const moves = [];
    if (p.tracking === "serial") {
      // Serials come from the list, or from the single lot/serial field (handy when removing one unit).
      const serials = e.serials.length ? e.serials : e.lotNo?.trim() ? [e.lotNo.trim()] : [];
      if (!serials.length) throw new AppError(422, "Enter at least one serial number");
      if (new Set(serials).size !== serials.length) throw new AppError(422, "Duplicate serial numbers in the list");
      if (e.packagingId) throw new AppError(422, "Serial-tracked products cannot be entered in packs");
      for (const s of serials) moves.push(await postMove(tx, { productId: e.productId, warehouseId: e.warehouseId, type: e.kind, qty: 1, unitCost: e.unitCost, lotNo: s, expiryDate: e.expiryDate, enteredAs: null, note: e.note }, user.id));
    } else {
      moves.push(await postMove(tx, { productId: e.productId, warehouseId: e.warehouseId, type: e.kind, qty: base, unitCost: e.unitCost, lotNo: e.lotNo, expiryDate: e.expiryDate, enteredAs, note: e.note }, user.id));
    }
    await audit({ action: `stock_${e.kind}`, entity: "product", entityId: e.productId, after: { sku: p.sku, warehouseId: e.warehouseId, moves: moves.length, qty: moves.reduce((s, m) => s.plus(m.qty), D(0)).toFixed(4), note: e.note }, userId: user.id, userEmail: user.email, ...meta }, tx);
    return moves;
  });
}

export async function transferStock(t: { productId: string; fromWarehouseId: string; toWarehouseId: string; qty: string; packagingId: string | null; lotNo: string | null; note: string | null }, user: CurrentUser, meta: Meta) {
  if (t.fromWarehouseId === t.toWarehouseId) throw new AppError(422, "Choose two different warehouses");
  return db.transaction(async (tx) => {
    const { base, enteredAs } = await toBase(tx, t.productId, t.qty, t.packagingId);
    const ref = `T-${Date.now()}`;
    const out = await postMove(tx, { productId: t.productId, warehouseId: t.fromWarehouseId, type: "transfer_out", qty: base, lotNo: t.lotNo, refType: "transfer", refId: ref, enteredAs, note: t.note }, user.id);
    const [lot] = out.lotId ? await tx.select().from(stockLots).where(eq(stockLots.id, out.lotId)) : [];
    await postMove(tx, { productId: t.productId, warehouseId: t.toWarehouseId, type: "transfer_in", qty: base, lotNo: lot?.lotNo ?? null, refType: "transfer", refId: ref, enteredAs, note: t.note }, user.id);
    await audit({ action: "stock_transfer", entity: "product", entityId: t.productId, after: { from: t.fromWarehouseId, to: t.toWarehouseId, qty: base.toFixed(4), ref }, userId: user.id, userEmail: user.email, ...meta }, tx);
    return ref;
  });
}

// ---------- queries ----------
const onHandSql = (warehouseId?: string) =>
  sql<string>`coalesce((select sum(${stockLevels.qty}) from ${stockLevels} where ${stockLevels.productId} = ${products.id} ${warehouseId ? sql`and ${stockLevels.warehouseId} = ${warehouseId}` : sql``}), 0)`;

export const PAGE_SIZE = 20;
const SORTS = { sku: products.sku, name: products.name } as const;

export async function listProducts(p: { q?: string; category?: string; status?: string; low?: boolean; warehouse?: string; sort?: string; dir?: string; page?: number }) {
  const onHand = onHandSql(p.warehouse);
  const where: SQL[] = [];
  if (p.q) { const like = `%${p.q.replace(/[%_\\]/g, "\\$&")}%`; where.push(or(ilike(products.sku, like), ilike(products.name, like), ilike(products.barcode, like))!); }
  if (p.category) where.push(eq(products.categoryId, p.category));
  if (p.status === "inactive") where.push(eq(products.isActive, false)); else where.push(eq(products.isActive, true));
  if (p.low) where.push(sql`${products.reorderLevel} > 0 and ${onHand} <= ${products.reorderLevel}`);
  const w = and(...where);
  const key = (p.sort && p.sort in SORTS ? p.sort : "sku") as keyof typeof SORTS;
  const page = Math.max(1, p.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select({ p: products, uom: uoms.code, uomAllowsDecimal: uoms.allowDecimal, category: productCategories.name, onHand })
      .from(products).innerJoin(uoms, eq(uoms.id, products.baseUomId)).leftJoin(productCategories, eq(productCategories.id, products.categoryId))
      .where(w).orderBy(p.dir === "desc" ? desc(SORTS[key]) : asc(SORTS[key]), asc(products.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(products).where(w),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function stockSummary() {
  const [r] = await db.select({
    value: sql<string>`coalesce(sum(${stockLevels.qty} * ${products.avgCost}), 0)`,
    skus: sql<number>`count(distinct ${stockLevels.productId}) filter (where ${stockLevels.qty} > 0)::int`,
  }).from(stockLevels).innerJoin(products, eq(products.id, stockLevels.productId));
  return { value: r.value, skus: r.skus, low: await lowStockCount() };
}

export async function lowStockCount() {
  const [r] = await db.select({ n: count() }).from(products).where(and(eq(products.isActive, true), sql`${products.reorderLevel} > 0 and ${onHandSql()} <= ${products.reorderLevel}`));
  return r.n;
}

export async function stockBreakdown(productIds: string[]) {
  if (!productIds.length) return [];
  return db.select({ productId: stockLevels.productId, warehouse: warehouses.name, lotNo: stockLots.lotNo, expiry: stockLots.expiryDate, qty: stockLevels.qty })
    .from(stockLevels).innerJoin(warehouses, eq(warehouses.id, stockLevels.warehouseId)).leftJoin(stockLots, eq(stockLots.id, stockLevels.lotId))
    .where(and(sql`${stockLevels.productId} in ${productIds}`, sql`${stockLevels.qty} > 0`)).orderBy(asc(warehouses.name), asc(stockLots.lotNo));
}

export async function listMoves(f: { productId?: string; warehouseId?: string; type?: string; from?: string; to?: string; page?: number }) {
  const where: SQL[] = [];
  if (f.productId) where.push(eq(stockMoves.productId, f.productId));
  if (f.warehouseId) where.push(eq(stockMoves.warehouseId, f.warehouseId));
  if (f.type) where.push(eq(stockMoves.type, f.type as MoveType));
  if (f.from) where.push(gte(stockMoves.movedAt, new Date(f.from + "T00:00:00+04:00")));
  if (f.to) where.push(lte(stockMoves.movedAt, new Date(f.to + "T23:59:59+04:00")));
  const w = where.length ? and(...where) : undefined;
  const page = Math.max(1, f.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select({ m: stockMoves, sku: products.sku, name: products.name, wh: warehouses.name, lotNo: stockLots.lotNo })
      .from(stockMoves).innerJoin(products, eq(products.id, stockMoves.productId)).innerJoin(warehouses, eq(warehouses.id, stockMoves.warehouseId)).leftJoin(stockLots, eq(stockLots.id, stockMoves.lotId))
      .where(w).orderBy(desc(stockMoves.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(stockMoves).where(w),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getProduct(id: string) {
  const [r] = await db.select({ p: products, uom: uoms, category: productCategories.name, onHand: onHandSql() })
    .from(products).innerJoin(uoms, eq(uoms.id, products.baseUomId)).leftJoin(productCategories, eq(productCategories.id, products.categoryId)).where(eq(products.id, id));
  if (!r) return null;
  const packagings = await db.select().from(productPackagings).where(eq(productPackagings.productId, id)).orderBy(asc(productPackagings.qty));
  return { ...r, packagings };
}

export const listWarehouses = () => db.select().from(warehouses).orderBy(desc(warehouses.isDefault), asc(warehouses.name));
export const listUoms = () => db.select().from(uoms).orderBy(asc(uoms.code));
export const listCategories = () => db.select().from(productCategories).orderBy(asc(productCategories.name));
export const productOptions = () =>
  db.select({ id: products.id, sku: products.sku, name: products.name, tracking: products.tracking, uom: uoms.code }).from(products).innerJoin(uoms, eq(uoms.id, products.baseUomId)).where(eq(products.isActive, true)).orderBy(asc(products.sku));
export const packagingOptions = () =>
  db.select({ id: productPackagings.id, productId: productPackagings.productId, name: productPackagings.name, qty: productPackagings.qty, sku: products.sku }).from(productPackagings).innerJoin(products, eq(products.id, productPackagings.productId)).orderBy(asc(products.sku), asc(productPackagings.qty));
