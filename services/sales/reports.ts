import { and, asc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "@/db";
import { containerCosts, containerItems, containers, customers, products, saleLines, sales, stockMoves, suppliers } from "@/db/schema";
import { D } from "@/lib/money";

export type GroupBy = "period" | "customer" | "product" | "container";
export type Granularity = "day" | "month" | "year";
export type ReportFilter = { groupBy: GroupBy; granularity?: Granularity; from?: string; to?: string; customerId?: string; productId?: string; containerId?: string };
export type ReportRow = { key: string; label: string; sales: number; qty: string; revenueAed: string; vatAed: string };

const lineNet = sql`${saleLines.qty} * ${saleLines.unitPrice} * ${sales.exchangeRate}`;
const lineVat = sql`${saleLines.qty} * ${saleLines.unitPrice} * ${sales.exchangeRate} * ${saleLines.vatRate} / 100`;

/** Sales by period / customer / product / container, in AED, from confirmed sales. */
export async function salesReport(f: ReportFilter): Promise<ReportRow[]> {
  const where: SQL[] = [ne(sales.status, "cancelled")];
  if (f.from) where.push(gte(sales.saleDate, f.from));
  if (f.to) where.push(lte(sales.saleDate, f.to));
  if (f.customerId) where.push(eq(sales.customerId, f.customerId));
  if (f.productId) where.push(eq(saleLines.productId, f.productId));
  if (f.containerId) where.push(eq(sales.containerId, f.containerId));

  const gran = f.granularity ?? "month";
  const fmt = gran === "day" ? "YYYY-MM-DD" : gran === "year" ? "YYYY" : "YYYY-MM";
  const key = f.groupBy === "period" ? sql<string>`to_char(${sales.saleDate}::date, ${fmt})`
    : f.groupBy === "customer" ? sql<string>`${customers.name}`
    : f.groupBy === "product" ? sql<string>`coalesce(${products.sku} || ' · ' || ${products.name}, ${saleLines.description})`
    : sql<string>`coalesce(${containers.containerNo} || ' (' || ${containers.ref} || ')', 'No container')`;

  const rows = await db.select({
    key, sales: sql<number>`count(distinct ${sales.id})::int`, qty: sql<string>`sum(${saleLines.qty})`,
    revenue: sql<string>`sum(${lineNet})`, vat: sql<string>`sum(${lineVat})`,
  }).from(saleLines).innerJoin(sales, eq(sales.id, saleLines.saleId)).innerJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(products, eq(products.id, saleLines.productId)).leftJoin(containers, eq(containers.id, sales.containerId))
    .where(and(...where)).groupBy(key).orderBy(f.groupBy === "period" ? asc(key) : sql`sum(${lineNet}) desc`);

  return rows.map((r) => ({ key: r.key, label: r.key, sales: r.sales, qty: D(r.qty).toFixed(2), revenueAed: D(r.revenue).toFixed(2), vatAed: D(r.vat).toFixed(2) }));
}

// ---------- per-container profit & loss ----------
export type PnlRow = {
  id: string; ref: string; containerNo: string; direction: "inward" | "outward"; status: string; party: string | null;
  revenueAed: string; goodsCostAed: string; otherCostsAed: string; profitAed: string; marginPct: string | null; costOnly: boolean;
  /** Export not dispatched yet: goods cost is an estimate at current average cost. */
  estimated: boolean;
};

/**
 * Revenue  = sales linked to the container (AED).
 * Goods    = export: stock cost at dispatch · import: goods value + capitalised landed costs.
 * Other    = container costs that are not part of stock value (freight on exports, demurrage, labour...).
 * Profit   = revenue − goods − other. Imports with no linked sales are "cost only": no profit is shown.
 */
export async function containerPnl(f: { containerId?: string; direction?: string; from?: string; to?: string } = {}): Promise<PnlRow[]> {
  const where: SQL[] = [ne(containers.status, "cancelled")];
  if (f.containerId) where.push(eq(containers.id, f.containerId));
  if (f.direction === "inward" || f.direction === "outward") where.push(eq(containers.direction, f.direction));
  if (f.from) where.push(gte(containers.createdAt, new Date(f.from + "T00:00:00+04:00")));
  if (f.to) where.push(lte(containers.createdAt, new Date(f.to + "T23:59:59+04:00")));
  const cs = await db.select({ c: containers, supplier: suppliers.name, customer: customers.name }).from(containers)
    .leftJoin(suppliers, eq(suppliers.id, containers.supplierId)).leftJoin(customers, eq(customers.id, containers.customerId)).where(and(...where)).orderBy(sql`${containers.createdAt} desc`);
  if (!cs.length) return [];
  const ids = cs.map((x) => x.c.id), refs = cs.map((x) => x.c.ref);

  const [rev, dispatched, goods, costs, estimate] = await Promise.all([
    db.select({ id: sales.containerId, v: sql<string>`sum(${lineNet})` }).from(saleLines).innerJoin(sales, eq(sales.id, saleLines.saleId)).where(and(ne(sales.status, "cancelled"), inArray(sales.containerId, ids))).groupBy(sales.containerId),
    db.select({ ref: stockMoves.refId, v: sql<string>`sum(-${stockMoves.qty} * ${stockMoves.unitCost})` }).from(stockMoves).where(and(eq(stockMoves.refType, "container"), eq(stockMoves.type, "outward"), inArray(stockMoves.refId, refs))).groupBy(stockMoves.refId),
    db.select({ id: containerItems.containerId, v: sql<string>`sum(${containerItems.qty} * ${containerItems.unitPrice} * ${containers.exchangeRate})` }).from(containerItems).innerJoin(containers, eq(containers.id, containerItems.containerId)).where(inArray(containerItems.containerId, ids)).groupBy(containerItems.containerId),
    db.select({ id: containerCosts.containerId, landed: sql<string>`coalesce(sum(case when ${containerCosts.inLandedCost} then ${containerCosts.amountAed} else 0 end), 0)`, other: sql<string>`coalesce(sum(case when ${containerCosts.inLandedCost} then 0 else ${containerCosts.amountAed} end), 0)` })
      .from(containerCosts).where(inArray(containerCosts.containerId, ids)).groupBy(containerCosts.containerId),
    db.select({ id: containerItems.containerId, v: sql<string>`sum(${containerItems.qty} * ${products.avgCost})` }).from(containerItems).innerJoin(products, eq(products.id, containerItems.productId)).where(inArray(containerItems.containerId, ids)).groupBy(containerItems.containerId),
  ]);
  const m = <T extends { v?: string }>(rows: (T & { id?: string | null; ref?: string | null })[], k: string) => rows.find((r) => (r.id ?? r.ref) === k);

  return cs.map(({ c, supplier, customer }) => {
    const revenue = D(m(rev, c.id)?.v);
    const cost = costs.find((x) => x.id === c.id);
    const estimated = c.direction === "outward" && !c.stockPostedAt;
    const goodsCost = c.direction === "outward" ? (estimated ? D(m(estimate, c.id)?.v) : D(m(dispatched, c.ref)?.v)) : D(m(goods, c.id)?.v).plus(cost?.landed ?? 0);
    const other = D(cost?.other);
    const profit = revenue.minus(goodsCost).minus(other);
    const costOnly = c.direction === "inward" && revenue.isZero();
    return {
      id: c.id, ref: c.ref, containerNo: c.containerNo, direction: c.direction, status: c.status, party: supplier ?? customer ?? null,
      revenueAed: revenue.toFixed(2), goodsCostAed: goodsCost.toFixed(2), otherCostsAed: other.toFixed(2),
      profitAed: costOnly ? "0.00" : profit.toFixed(2), marginPct: costOnly || revenue.isZero() ? null : profit.div(revenue).times(100).toFixed(1), costOnly, estimated,
    };
  });
}

// ---------- exports ----------
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // Guard against spreadsheet formula injection from user-entered text.
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** UTF-8 CSV with BOM so Excel opens it correctly. */
export function toCsv(headers: string[], rows: (string | number | null)[][]) {
  return "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function toXlsx(sheet: string, headers: string[], rows: (string | number | null)[][], numericFrom = 1) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet.slice(0, 30));
  ws.addRow(headers).font = { bold: true };
  for (const r of rows) ws.addRow(r.map((v, i) => (i >= numericFrom && v !== null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v)));
  ws.columns.forEach((c, i) => { c.width = Math.max(14, headers[i].length + 4); if (i >= numericFrom) c.numFmt = "#,##0.00"; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
