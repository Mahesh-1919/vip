import { and, asc, count, desc, eq, ilike, inArray, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { containerCosts, containerItems, containers, customers, products, productPackagings, suppliers, uoms, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import { allocateCosts, allowedNext, landedUnitCost, normalizeContainerNo, validateContainerNo, INITIAL_STATUS, POSTING_STATUS, type Direction } from "@/lib/container";
import { todayISO } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { D, toDb } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import type { CurrentUser } from "@/lib/auth";
import { postMove } from "./stock";
import { postCogs, postCost, postReceipt, reverseCost } from "@/services/accounting/posting";

type Meta = { ip: string | null; userAgent: string | null };
const who = (u: CurrentUser, m: Meta) => ({ userId: u.id, userEmail: u.email, ...m });
export const PAGE_SIZE = 20;
const CLOSED = ["received", "delivered", "cancelled"] as const;

export type ContainerInput = {
  direction: Direction; containerNo: string; sealNo: string | null; size: string; shippingLine: string | null; vessel: string | null; voyage: string | null;
  billOfLading: string | null; partyId: string; incoterm: string | null; originCountry: string | null; loadPort: string | null; dischargePort: string | null;
  warehouseId: string | null; eta: string | null; customsDeclarationNo: string | null; freeZone: boolean; currency: string; exchangeRate: string; notes: string | null;
};

function partyColumns(direction: Direction, partyId: string) {
  return direction === "inward" ? { supplierId: partyId, customerId: null } : { customerId: partyId, supplierId: null };
}

async function assertParty(tx: typeof db, direction: Direction, partyId: string) {
  const [p] = direction === "inward"
    ? await tx.select({ id: suppliers.id, active: suppliers.isActive }).from(suppliers).where(eq(suppliers.id, partyId))
    : await tx.select({ id: customers.id, active: customers.isActive }).from(customers).where(eq(customers.id, partyId));
  if (!p || !p.active) throw new AppError(422, direction === "inward" ? "Choose an active supplier" : "Choose an active customer");
}

function checkHeader(i: ContainerInput) {
  const err = validateContainerNo(i.containerNo);
  if (err) throw new AppError(422, err);
  if (i.currency === "AED" && !D(i.exchangeRate).eq(1)) throw new AppError(422, "AED exchange rate must be 1");
  if (D(i.exchangeRate).lte(0)) throw new AppError(422, "Exchange rate must be greater than zero");
}

export async function createContainer(i: ContainerInput, user: CurrentUser, meta: Meta) {
  checkHeader(i);
  const no = normalizeContainerNo(i.containerNo);
  return db.transaction(async (tx) => {
    await assertParty(tx as never, i.direction, i.partyId);
    const [open] = await tx.select({ ref: containers.ref }).from(containers)
      .where(and(eq(containers.containerNo, no), eq(containers.direction, i.direction), notInArray(containers.status, [...CLOSED])));
    if (open) throw new AppError(409, `Container ${no} is already open on ${open.ref}`);
    const ref = await nextNumber(tx, `container_${i.direction}`, i.direction === "inward" ? "IMP-" : "EXP-");
    const { partyId, ...rest } = i;
    const [c] = await tx.insert(containers).values({ ...rest, containerNo: no, ...partyColumns(i.direction, partyId), ref, status: INITIAL_STATUS[i.direction] as never, createdBy: user.id }).returning();
    await audit({ action: "create", entity: "container", entityId: c.id, after: c, ...who(user, meta) }, tx);
    return c;
  });
}

export async function updateContainer(id: string, i: ContainerInput, version: number, user: CurrentUser, meta: Meta) {
  checkHeader(i);
  const no = normalizeContainerNo(i.containerNo);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(containers).where(eq(containers.id, id)).for("update");
    if (!before) throw new AppError(404, "Container not found");
    if (before.status === "cancelled") throw new AppError(409, "A cancelled container cannot be edited");
    if (before.direction !== i.direction) throw new AppError(422, "Direction cannot be changed");
    await assertParty(tx as never, i.direction, i.partyId);
    if (before.stockPostedAt && (before.warehouseId !== i.warehouseId || before.currency !== i.currency || !D(before.exchangeRate).eq(i.exchangeRate)))
      throw new AppError(409, "Warehouse, currency and exchange rate are locked once stock has been posted");
    const [clash] = await tx.select({ ref: containers.ref }).from(containers)
      .where(and(eq(containers.containerNo, no), eq(containers.direction, i.direction), ne(containers.id, id), notInArray(containers.status, [...CLOSED])));
    if (clash) throw new AppError(409, `Container ${no} is already open on ${clash.ref}`);
    const { partyId, direction: _d, ...rest } = i; void _d;
    const [after] = await tx.update(containers).set({ ...rest, containerNo: no, ...partyColumns(i.direction, partyId), version: sql`${containers.version} + 1` })
      .where(and(eq(containers.id, id), eq(containers.version, version))).returning();
    if (!after) throw new AppError(409, "This container was changed by someone else. Reload and try again.");
    await audit({ action: "update", entity: "container", entityId: id, before, after, ...who(user, meta) }, tx);
  });
}

// ---------- items ----------
export type ItemInput = {
  containerId: string; productId: string; qty: string; packagingId: string | null; unitPrice: string; lotNo: string | null; expiryDate: string | null;
  serials: string[]; weightKg: string; volumeCbm: string;
};

export async function addItem(i: ItemInput, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(containers).where(eq(containers.id, i.containerId)).for("update");
    if (!c) throw new AppError(404, "Container not found");
    if (c.stockPostedAt || c.status === "cancelled") throw new AppError(409, "Items are locked: stock has been posted or the container is cancelled");
    const [p] = await tx.select({ p: products, uom: uoms }).from(products).innerJoin(uoms, eq(uoms.id, products.baseUomId)).where(eq(products.id, i.productId));
    if (!p || !p.p.isActive) throw new AppError(422, "Choose an active product");

    let qty = D(i.qty), enteredAs: string | null = null;
    if (i.packagingId) {
      const [pk] = await tx.select().from(productPackagings).where(and(eq(productPackagings.id, i.packagingId), eq(productPackagings.productId, i.productId)));
      if (!pk) throw new AppError(422, "That packaging does not belong to the product");
      enteredAs = `${qty.toFixed()} × ${pk.name}`; qty = qty.times(pk.qty);
    }
    let serials: string[] | null = null;
    if (p.p.tracking === "serial") {
      if (i.packagingId) throw new AppError(422, "Serial-tracked products cannot be entered in packs");
      if (!i.serials.length) throw new AppError(422, "Enter the serial numbers");
      serials = i.serials; qty = D(serials.length);
    } else if (p.p.tracking === "batch" && !i.lotNo) throw new AppError(422, `${p.p.sku} is batch-tracked: enter the batch number`);
    if (qty.lte(0)) throw new AppError(422, "Quantity must be greater than zero");
    if (!p.uom.allowDecimal && !qty.isInteger()) throw new AppError(422, `${p.p.sku} is counted in whole ${p.uom.name.toLowerCase()}s`);

    const [row] = await tx.insert(containerItems).values({
      containerId: c.id, productId: p.p.id, qty: qty.toFixed(4), enteredAs, unitPrice: D(i.unitPrice).toFixed(4),
      lotNo: p.p.tracking === "batch" ? i.lotNo : null, expiryDate: p.p.tracking === "batch" ? i.expiryDate : null, serials,
      weightKg: D(i.weightKg).toFixed(3), volumeCbm: D(i.volumeCbm).toFixed(3), hsCode: p.p.hsCode,
    }).returning();
    await audit({ action: "add_item", entity: "container", entityId: c.id, after: { sku: p.p.sku, qty: qty.toFixed(4), itemId: row.id }, ...who(user, meta) }, tx);
  });
}

export async function removeItem(itemId: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [it] = await tx.select().from(containerItems).where(eq(containerItems.id, itemId));
    if (!it) throw new AppError(404, "Item not found");
    const [c] = await tx.select().from(containers).where(eq(containers.id, it.containerId)).for("update");
    if (c.stockPostedAt || c.status === "cancelled") throw new AppError(409, "Items are locked: stock has been posted or the container is cancelled");
    await tx.delete(containerItems).where(eq(containerItems.id, itemId));
    await audit({ action: "remove_item", entity: "container", entityId: c.id, before: it, ...who(user, meta) }, tx);
  });
}

// ---------- costs ----------
export const COST_TYPES = ["freight", "customs_duty", "insurance", "port_charges", "thc", "delivery_order", "clearing", "transport", "labour", "other"] as const;

export type CostInput = {
  containerId: string; type: (typeof COST_TYPES)[number]; description: string | null; payeeSupplierId: string | null; amount: string; currency: string; exchangeRate: string;
  vat: string; allocation: "value" | "quantity" | "weight" | "volume"; inLandedCost: boolean; incurredOn: string;
};

export async function addCost(i: CostInput, user: CurrentUser, meta: Meta) {
  if (i.currency === "AED" && !D(i.exchangeRate).eq(1)) throw new AppError(422, "AED exchange rate must be 1");
  const amountAed = D(i.amount).times(i.exchangeRate).toDecimalPlaces(2);
  if (amountAed.lte(0)) throw new AppError(422, "Amount must be greater than zero");
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(containers).where(eq(containers.id, i.containerId));
    if (!c) throw new AppError(404, "Container not found");
    if (c.status === "cancelled") throw new AppError(409, "A cancelled container cannot take new costs");
    const [row] = await tx.insert(containerCosts).values({
      containerId: c.id, type: i.type, description: i.description, payeeSupplierId: i.payeeSupplierId, amount: toDb(i.amount), currency: i.currency,
      exchangeRate: D(i.exchangeRate).toFixed(6), amountAed: amountAed.toFixed(2), vatAed: toDb(D(i.vat).times(i.exchangeRate)), allocation: i.allocation,
      inLandedCost: c.direction === "inward" && i.inLandedCost, incurredOn: i.incurredOn, createdBy: user.id,
    }).returning();
    await postCost(tx, row.id, user.id);
    await audit({ action: "add_cost", entity: "container", entityId: c.id, after: row, ...who(user, meta) }, tx);
  });
}

export async function removeCost(costId: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(containerCosts).where(eq(containerCosts.id, costId));
    if (!row) throw new AppError(404, "Cost not found");
    const [c] = await tx.select().from(containers).where(eq(containers.id, row.containerId)).for("update");
    if (c.stockPostedAt && row.inLandedCost) throw new AppError(409, "This cost is already part of the stock valuation and cannot be removed");
    await reverseCost(tx, row, user.id);
    await tx.delete(containerCosts).where(eq(containerCosts.id, costId));
    await audit({ action: "remove_cost", entity: "container", entityId: c.id, before: row, ...who(user, meta) }, tx);
  });
}

// ---------- landed cost ----------
type ItemRow = typeof containerItems.$inferSelect;
type CostRow = typeof containerCosts.$inferSelect;

export function landedBreakdown(c: { exchangeRate: string }, items: ItemRow[], costs: CostRow[]) {
  const rate = D(c.exchangeRate);
  const base = items.map((i) => ({ id: i.id, qty: i.qty, valueAed: D(i.unitPrice).times(i.qty).times(rate).toDecimalPlaces(2), weightKg: i.weightKg, volumeCbm: i.volumeCbm }));
  const { perItem, warnings } = allocateCosts(base, costs.filter((k) => k.inLandedCost).map((k) => ({ id: k.type, amountAed: k.amountAed, basis: k.allocation })));
  return {
    warnings,
    lines: items.map((i, idx) => {
      const allocated = perItem.get(i.id) ?? D(0);
      return { item: i, goodsAed: base[idx].valueAed, allocatedAed: allocated, totalAed: base[idx].valueAed.plus(allocated), unitAed: landedUnitCost(i.qty, base[idx].valueAed, allocated) };
    }),
  };
}

// ---------- status changes (with stock posting) ----------
export async function changeStatus(id: string, to: string, user: CurrentUser, meta: Meta) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(containers).where(eq(containers.id, id)).for("update");
    if (!c) throw new AppError(404, "Container not found");
    const next = allowedNext(c.direction, c.status, !!c.stockPostedAt);
    if (!next.includes(to)) throw new AppError(409, `Cannot move from “${c.status.replace(/_/g, " ")}” to “${to.replace(/_/g, " ")}”`);

    const set: Partial<typeof containers.$inferInsert> = { status: to as never, version: sql`${containers.version} + 1` as never };
    if (to === POSTING_STATUS[c.direction]) {
      if (!c.warehouseId) throw new AppError(422, "Choose a warehouse before " + (c.direction === "inward" ? "receiving" : "dispatching"));
      const items = await tx.select().from(containerItems).where(eq(containerItems.containerId, id));
      if (!items.length) throw new AppError(422, "Add at least one item first");
      const costs = await tx.select().from(containerCosts).where(eq(containerCosts.containerId, id));
      const prods = await tx.select({ id: products.id, tracking: products.tracking }).from(products).where(inArray(products.id, items.map((i) => i.productId)));
      const trackingOf = new Map(prods.map((p) => [p.id, p.tracking]));
      const landed = c.direction === "inward" ? landedBreakdown(c, items, costs) : null;

      for (const it of items) {
        const unitCost = landed?.lines.find((l) => l.item.id === it.id)?.unitAed;
        const base = { productId: it.productId, warehouseId: c.warehouseId, refType: "container", refId: c.ref, enteredAs: it.enteredAs, note: `${c.containerNo}${c.billOfLading ? " · BL " + c.billOfLading : ""}` };
        const type = c.direction === "inward" ? "inward" : "outward";
        if (trackingOf.get(it.productId) === "serial") {
          for (const s of it.serials ?? []) await postMove(tx, { ...base, type, qty: 1, unitCost: unitCost?.toFixed(4), lotNo: s, enteredAs: null }, user.id);
        } else {
          await postMove(tx, { ...base, type, qty: it.qty, unitCost: unitCost?.toFixed(4), lotNo: it.lotNo, expiryDate: it.expiryDate }, user.id);
        }
        if (unitCost) await tx.update(containerItems).set({ landedUnitCostAed: unitCost.toFixed(4) }).where(eq(containerItems.id, it.id));
      }
      set.stockPostedAt = new Date();
      if (c.direction === "inward") set.arrivalDate = c.arrivalDate ?? todayISO(); else set.dispatchDate = c.dispatchDate ?? todayISO();
    }
    await tx.update(containers).set(set).where(eq(containers.id, id));
    if (set.stockPostedAt) { if (c.direction === "inward") await postReceipt(tx, id, user.id); else await postCogs(tx, id, user.id); }
    await audit({ action: "container_status", entity: "container", entityId: id, before: { status: c.status }, after: { status: to, ref: c.ref, stockPosted: !!set.stockPostedAt }, ...who(user, meta) }, tx);
    return to;
  });
}

// ---------- queries ----------
export async function listContainers(f: { direction?: string; status?: string; q?: string; page?: number }) {
  const where: SQL[] = [];
  if (f.direction === "inward" || f.direction === "outward") where.push(eq(containers.direction, f.direction));
  if (f.status) where.push(eq(containers.status, f.status as never));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(containers.containerNo, like), ilike(containers.ref, like), ilike(containers.billOfLading, like), ilike(suppliers.name, like), ilike(customers.name, like))!);
  }
  const w = where.length ? and(...where) : undefined;
  const page = Math.max(1, f.page ?? 1);
  const base = db.select({
    c: containers, supplier: suppliers.name, customer: customers.name,
    itemCount: sql<number>`(select count(*) from ${containerItems} where ${containerItems.containerId} = ${containers.id})::int`,
  }).from(containers).leftJoin(suppliers, eq(suppliers.id, containers.supplierId)).leftJoin(customers, eq(customers.id, containers.customerId));
  const [rows, [{ total }]] = await Promise.all([
    base.where(w).orderBy(desc(containers.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(containers).leftJoin(suppliers, eq(suppliers.id, containers.supplierId)).leftJoin(customers, eq(customers.id, containers.customerId)).where(w),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getContainer(id: string) {
  const [r] = await db.select({ c: containers, supplier: suppliers.name, customer: customers.name, warehouse: warehouses.name })
    .from(containers).leftJoin(suppliers, eq(suppliers.id, containers.supplierId)).leftJoin(customers, eq(customers.id, containers.customerId)).leftJoin(warehouses, eq(warehouses.id, containers.warehouseId)).where(eq(containers.id, id));
  if (!r) return null;
  const [items, costs] = await Promise.all([
    db.select({ i: containerItems, sku: products.sku, name: products.name, uom: uoms.code, tracking: products.tracking })
      .from(containerItems).innerJoin(products, eq(products.id, containerItems.productId)).innerJoin(uoms, eq(uoms.id, products.baseUomId)).where(eq(containerItems.containerId, id)).orderBy(asc(containerItems.createdAt)),
    db.select().from(containerCosts).where(eq(containerCosts.containerId, id)).orderBy(asc(containerCosts.incurredOn), asc(containerCosts.createdAt)),
  ]);
  return { ...r, items, costs, landed: landedBreakdown(r.c, items.map((x) => x.i), costs) };
}

export const supplierOptions = () => db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name }).from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name));
export const customerOptions = () => db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(eq(customers.isActive, true)).orderBy(asc(customers.name));
