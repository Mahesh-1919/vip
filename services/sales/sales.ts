import { and, asc, count, desc, eq, gte, ilike, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { containerItems, containers, customers, invoiceLines, invoices, products, saleLines, sales, uoms } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { D } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { VAT_CATEGORIES, defaultVatCategory, vatRateFor, type VatCategory } from "@/lib/vat";
import type { CurrentUser } from "@/lib/auth";

type Meta = { ip: string | null; userAgent: string | null };
const who = (u: CurrentUser, m: Meta) => ({ userId: u.id, userEmail: u.email, ...m });
export const PAGE_SIZE = 20;

export type SaleInput = { customerId: string; saleDate: string; containerId: string | null; currency: string; exchangeRate: string; notes: string | null };

export async function createSale(i: SaleInput, user: CurrentUser, meta: Meta) {
  if (i.currency === "AED" && !D(i.exchangeRate).eq(1)) throw new AppError(422, "AED exchange rate must be 1");
  if (D(i.exchangeRate).lte(0)) throw new AppError(422, "Exchange rate must be greater than zero");
  return db.transaction(async (tx) => {
    const [cu] = await tx.select().from(customers).where(eq(customers.id, i.customerId));
    if (!cu || !cu.isActive) throw new AppError(422, "Choose an active customer");
    if (i.containerId) {
      const [c] = await tx.select().from(containers).where(eq(containers.id, i.containerId));
      if (!c || c.status === "cancelled") throw new AppError(422, "Unknown or cancelled container");
      if (c.direction === "outward" && c.customerId && c.customerId !== i.customerId) throw new AppError(422, "That export container belongs to a different customer");
    }
    const ref = await nextNumber(tx, "sale", "SAL-");
    const [s] = await tx.insert(sales).values({ ...i, ref, createdBy: user.id }).returning();
    await audit({ action: "create", entity: "sale", entityId: s.id, after: s, ...who(user, meta) }, tx);
    return s;
  });
}

export type LineInput = { saleId: string; productId: string | null; description: string; qty: string; unitPrice: string; vatCategory: VatCategory; containerItemId: string | null };

/** Remaining (not yet on a sale) quantity of an exported container item. */
async function itemRemaining(tx: Pick<typeof db, "select">, containerItemId: string, exceptSaleLine?: string) {
  const [it] = await tx.select({ qty: containerItems.qty }).from(containerItems).where(eq(containerItems.id, containerItemId));
  const [{ used }] = await tx.select({ used: sql<string>`coalesce(sum(${saleLines.qty}), 0)` }).from(saleLines).innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(and(eq(saleLines.containerItemId, containerItemId), ne(sales.status, "cancelled"), exceptSaleLine ? ne(saleLines.id, exceptSaleLine) : undefined));
  return D(it?.qty).minus(used);
}

export async function addLine(i: LineInput, user: CurrentUser, meta: Meta) {
  if (!VAT_CATEGORIES.includes(i.vatCategory)) throw new AppError(422, "Invalid VAT category");
  const qty = D(i.qty);
  if (qty.lte(0)) throw new AppError(422, "Quantity must be greater than zero");
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(sales).where(eq(sales.id, i.saleId)).for("update");
    if (!s) throw new AppError(404, "Sale not found");
    if (s.status === "cancelled") throw new AppError(409, "A cancelled sale cannot be changed");
    let description = i.description.trim();
    if (i.productId) {
      const [p] = await tx.select({ p: products, uom: uoms }).from(products).innerJoin(uoms, eq(uoms.id, products.baseUomId)).where(eq(products.id, i.productId));
      if (!p) throw new AppError(422, "Unknown product");
      if (!p.uom.allowDecimal && !qty.isInteger()) throw new AppError(422, `${p.p.sku} is sold in whole ${p.uom.name.toLowerCase()}s`);
      description ||= `${p.p.name} (${p.p.sku})`;
    }
    if (!description) throw new AppError(422, "Enter a description or choose a product");
    if (i.containerItemId) {
      const rem = await itemRemaining(tx, i.containerItemId);
      if (qty.gt(rem)) throw new AppError(409, `Only ${rem.toFixed()} left on that container item`);
    }
    const [l] = await tx.insert(saleLines).values({
      saleId: s.id, productId: i.productId, description, containerItemId: i.containerItemId, qty: qty.toFixed(4), unitPrice: D(i.unitPrice).toFixed(4),
      vatCategory: i.vatCategory, vatRate: String(vatRateFor(i.vatCategory)),
    }).returning();
    await audit({ action: "add_line", entity: "sale", entityId: s.id, after: l, ...who(user, meta) }, tx);
  });
}

export async function removeLine(lineId: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [l] = await tx.select().from(saleLines).where(eq(saleLines.id, lineId)).for("update");
    if (!l) throw new AppError(404, "Line not found");
    const [{ n }] = await tx.select({ n: count() }).from(invoiceLines).where(eq(invoiceLines.saleLineId, lineId));
    if (n > 0) throw new AppError(409, "This line is on an invoice and cannot be removed");
    await tx.delete(saleLines).where(eq(saleLines.id, lineId));
    await audit({ action: "remove_line", entity: "sale", entityId: l.saleId, before: l, ...who(user, meta) }, tx);
  });
}

/** Copies the not-yet-sold items of the linked export container into the sale. */
export async function importFromContainer(saleId: string, user: CurrentUser, meta: Meta) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(sales).where(eq(sales.id, saleId)).for("update");
    if (!s) throw new AppError(404, "Sale not found");
    if (s.status === "cancelled") throw new AppError(409, "A cancelled sale cannot be changed");
    if (!s.containerId) throw new AppError(422, "Link the sale to a container first");
    const [c] = await tx.select().from(containers).where(eq(containers.id, s.containerId));
    if (c.direction !== "outward") throw new AppError(422, "Only export containers have items to sell");
    const [cu] = await tx.select().from(customers).where(eq(customers.id, s.customerId));
    const items = await tx.select({ i: containerItems, p: products }).from(containerItems).innerJoin(products, eq(products.id, containerItems.productId)).where(eq(containerItems.containerId, c.id));
    let added = 0;
    for (const { i, p } of items) {
      const rem = await itemRemaining(tx, i.id);
      if (rem.lte(0)) continue;
      // Container prices are in the container's currency; convert if the sale uses another one.
      const price = c.currency === s.currency ? D(i.unitPrice) : D(i.unitPrice).times(c.exchangeRate).div(s.exchangeRate);
      const cat = defaultVatCategory(cu.country ?? c.originCountry);
      await tx.insert(saleLines).values({ saleId: s.id, productId: p.id, description: `${p.name} (${p.sku})`, containerItemId: i.id, qty: rem.toFixed(4), unitPrice: price.toDecimalPlaces(4).toFixed(4), vatCategory: cat, vatRate: String(vatRateFor(cat)) });
      added++;
    }
    if (!added) throw new AppError(422, "Everything on that container is already on a sale");
    await audit({ action: "import_container_items", entity: "sale", entityId: s.id, after: { containerId: c.id, lines: added }, ...who(user, meta) }, tx);
    return added;
  });
}

export async function cancelSale(saleId: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(sales).where(eq(sales.id, saleId)).for("update");
    if (!s) throw new AppError(404, "Sale not found");
    const [{ n }] = await tx.select({ n: count() }).from(invoices).where(eq(invoices.saleId, saleId));
    if (n > 0) throw new AppError(409, "This sale has invoices; cancel or credit them first");
    await tx.update(sales).set({ status: "cancelled", version: sql`${sales.version} + 1` }).where(eq(sales.id, saleId));
    await audit({ action: "cancel", entity: "sale", entityId: saleId, ...who(user, meta) }, tx);
  });
}

// ---------- queries ----------
// Qualified by hand: Drizzle prints bare column names in single-table selects, which would bind to the subquery table.
const billedSql = sql<string>`coalesce((select sum(il.qty) from invoice_lines il where il.sale_line_id = "sale_lines"."id"), 0)`;
const totalAedSql = sql<string>`coalesce((select sum(${saleLines.qty} * ${saleLines.unitPrice} * (1 + ${saleLines.vatRate} / 100)) from ${saleLines} where ${saleLines.saleId} = ${sales.id}), 0) * ${sales.exchangeRate}`;

export async function listSales(f: { q?: string; status?: string; customerId?: string; from?: string; to?: string; page?: number }) {
  const where: SQL[] = [];
  if (f.status) where.push(eq(sales.status, f.status as never));
  if (f.customerId) where.push(eq(sales.customerId, f.customerId));
  if (f.from) where.push(gte(sales.saleDate, f.from));
  if (f.to) where.push(lte(sales.saleDate, f.to));
  if (f.q) { const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`; where.push(or(ilike(sales.ref, like), ilike(customers.name, like), ilike(containers.containerNo, like))!); }
  const w = where.length ? and(...where) : undefined;
  const page = Math.max(1, f.page ?? 1);
  const from = db.select({
    s: sales, customer: customers.name, containerNo: containers.containerNo, containerRef: containers.ref, totalAed: totalAedSql,
    ordered: sql<string>`coalesce((select sum(${saleLines.qty}) from ${saleLines} where ${saleLines.saleId} = ${sales.id}), 0)`,
    billed: sql<string>`coalesce((select sum(${invoiceLines.qty}) from ${invoiceLines} inner join ${saleLines} on ${saleLines.id} = ${invoiceLines.saleLineId} where ${saleLines.saleId} = ${sales.id}), 0)`,
  }).from(sales).innerJoin(customers, eq(customers.id, sales.customerId)).leftJoin(containers, eq(containers.id, sales.containerId));
  const [rows, [{ total }]] = await Promise.all([
    from.where(w).orderBy(desc(sales.saleDate), desc(sales.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(sales).innerJoin(customers, eq(customers.id, sales.customerId)).leftJoin(containers, eq(containers.id, sales.containerId)).where(w),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getSale(id: string) {
  const [r] = await db.select({ s: sales, customer: customers, containerNo: containers.containerNo, containerRef: containers.ref, containerDirection: containers.direction })
    .from(sales).innerJoin(customers, eq(customers.id, sales.customerId)).leftJoin(containers, eq(containers.id, sales.containerId)).where(eq(sales.id, id));
  if (!r) return null;
  const lines = await db.select({ l: saleLines, billed: billedSql }).from(saleLines).where(eq(saleLines.saleId, id)).orderBy(asc(saleLines.createdAt));
  const inv = await db.select({ id: invoices.id, number: invoices.number, status: invoices.status, total: invoices.total, paid: invoices.paidAmount, currency: invoices.currency, issueDate: invoices.issueDate })
    .from(invoices).where(eq(invoices.saleId, id)).orderBy(asc(invoices.createdAt));
  return { ...r, lines: lines.map((x) => ({ ...x.l, billed: x.billed, remaining: D(x.l.qty).minus(x.billed) })), invoices: inv };
}

/** Sales that still have something left to invoice (for the invoice picker). */
export async function openSales() {
  return db.select({ id: sales.id, ref: sales.ref, customer: customers.name, saleDate: sales.saleDate, currency: sales.currency }).from(sales).innerJoin(customers, eq(customers.id, sales.customerId))
    .where(and(eq(sales.status, "confirmed"), sql`exists (select 1 from ${saleLines} where ${saleLines.saleId} = ${sales.id} and ${saleLines.qty} > coalesce((select sum(${invoiceLines.qty}) from ${invoiceLines} where ${invoiceLines.saleLineId} = ${saleLines.id}), 0))`))
    .orderBy(desc(sales.saleDate));
}

export const exportItemsForCustomer = (containerId: string) =>
  db.select({ id: containerItems.id, qty: containerItems.qty, price: containerItems.unitPrice, sku: products.sku, name: products.name }).from(containerItems).innerJoin(products, eq(products.id, containerItems.productId)).where(eq(containerItems.containerId, containerId));

export const containerOptionsForSales = () =>
  db.select({ id: containers.id, ref: containers.ref, containerNo: containers.containerNo, direction: containers.direction, currency: containers.currency, exchangeRate: containers.exchangeRate, customerId: containers.customerId })
    .from(containers).where(ne(containers.status, "cancelled")).orderBy(desc(containers.createdAt));
