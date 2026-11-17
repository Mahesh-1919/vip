import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { customers, invoiceLines, invoices, payments, saleLines, sales, type InvoiceParties } from "@/db/schema";
import { audit } from "@/lib/audit";
import { todayISO } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { D, toDb } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { invoiceTotals, lineAmounts } from "@/lib/vat";
import type { CurrentUser } from "@/lib/auth";
import { getCompany } from "@/services/company";

type Meta = { ip: string | null; userAgent: string | null };
const who = (u: CurrentUser, m: Meta) => ({ userId: u.id, userEmail: u.email, ...m });
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const PAYMENT_METHODS = ["bank_transfer", "cash", "cheque", "card"] as const;
const like = (q: string) => `%${q.replace(/[%_\\]/g, "\\$&")}%`;
const addDays = (iso: string, d: number) => new Date(Date.parse(iso + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
const sizeOf = (n?: number) => ((PAGE_SIZES as readonly number[]).includes(n ?? 0) ? n! : 25);

// ---------- sales ----------
export type SaleLineInput = { description: string; qty: string; unitPrice: string; vatRate: string };
export type SaleInput = { customerId: string; saleDate: string; billRef: string | null; notes: string | null; lines: SaleLineInput[] };

async function assertCustomer(tx: Pick<typeof db, "select">, id: string) {
  const [c] = await tx.select({ active: customers.isActive }).from(customers).where(eq(customers.id, id));
  if (!c || !c.active) throw new AppError(422, "Choose an active customer");
}

export async function saveSale(id: string | null, i: SaleInput, version: number | undefined, user: CurrentUser, meta: Meta) {
  return db.transaction(async (tx) => {
    await assertCustomer(tx, i.customerId);
    const { lines, ...head } = i;
    let saleId = id;
    if (!id) {
      const ref = await nextNumber(tx, "sale", "SAL-");
      const [s] = await tx.insert(sales).values({ ...head, ref, createdBy: user.id }).returning();
      saleId = s.id;
    } else {
      if (!version) throw new AppError(400, "Missing version: reload the page");
      const [cur] = await tx.select().from(sales).where(eq(sales.id, id)).for("update");
      if (!cur) throw new AppError(404, "Sale not found");
      const [inv] = await tx.select({ n: invoices.number }).from(invoices).where(eq(invoices.saleId, id));
      if (inv) throw new AppError(409, `This sale is already invoiced (${inv.n}) and cannot be changed`);
      const [after] = await tx.update(sales).set({ ...head, version: sql`${sales.version} + 1` }).where(and(eq(sales.id, id), eq(sales.version, version))).returning();
      if (!after) throw new AppError(409, "This sale was changed by someone else. Reload and try again.");
      await tx.delete(saleLines).where(eq(saleLines.saleId, id));
    }
    await tx.insert(saleLines).values(lines.map((l) => ({ saleId: saleId!, ...l })));
    await audit({ action: id ? "update" : "create", entity: "sale", entityId: saleId, after: { ...head, lines: lines.length }, ...who(user, meta) }, tx);
    return saleId!;
  });
}

const saleTotalSql = sql<string>`coalesce((select sum(round(l.qty * l.unit_price, 2) + round(round(l.qty * l.unit_price, 2) * l.vat_rate / 100, 2)) from sale_lines l where l.sale_id = "sales"."id"), 0)`;
const saleNetSql = sql<string>`coalesce((select sum(round(l.qty * l.unit_price, 2)) from sale_lines l where l.sale_id = "sales"."id"), 0)`;

export type SaleFilter = { q?: string; customerId?: string; invoiced?: string; from?: string; to?: string; page?: number; size?: number };

export async function listSales(f: SaleFilter) {
  const size = sizeOf(f.size), page = Math.max(1, f.page ?? 1);
  const where: SQL[] = [];
  if (f.customerId) where.push(eq(sales.customerId, f.customerId));
  if (f.from) where.push(gte(sales.saleDate, f.from));
  if (f.to) where.push(lte(sales.saleDate, f.to));
  if (f.invoiced === "yes") where.push(sql`exists (select 1 from invoices i where i.sale_id = "sales"."id")`);
  if (f.invoiced === "no") where.push(sql`not exists (select 1 from invoices i where i.sale_id = "sales"."id")`);
  if (f.q) where.push(or(ilike(sales.ref, like(f.q)), ilike(customers.name, like(f.q)), ilike(sales.billRef, like(f.q)))!);
  const w = where.length ? and(...where) : undefined;
  const [rows, [tot]] = await Promise.all([
    db.select({ s: sales, customer: customers.name, net: saleNetSql, total: saleTotalSql, invoiceId: sql<string | null>`(select i.id from invoices i where i.sale_id = "sales"."id")`, invoiceNo: sql<string | null>`(select i.number from invoices i where i.sale_id = "sales"."id")` })
      .from(sales).innerJoin(customers, eq(customers.id, sales.customerId)).where(w).orderBy(desc(sales.saleDate), desc(sales.createdAt)).limit(size).offset((page - 1) * size),
    db.select({ total: count(), net: sql<string>`coalesce(sum(${saleNetSql}), 0)`, gross: sql<string>`coalesce(sum(${saleTotalSql}), 0)` }).from(sales).innerJoin(customers, eq(customers.id, sales.customerId)).where(w),
  ]);
  return { rows, total: tot.total, totals: tot, page, size, pages: Math.max(1, Math.ceil(tot.total / size)) };
}

export async function getSale(id: string) {
  const [r] = await db.select({ s: sales, customer: customers }).from(sales).innerJoin(customers, eq(customers.id, sales.customerId)).where(eq(sales.id, id));
  if (!r) return null;
  const lines = await db.select().from(saleLines).where(eq(saleLines.saleId, id)).orderBy(asc(saleLines.description));
  const [inv] = await db.select({ id: invoices.id, number: invoices.number }).from(invoices).where(eq(invoices.saleId, id));
  const calc = lines.map((l) => lineAmounts(l.qty, l.unitPrice, l.vatRate));
  const t = invoiceTotals(calc, 1);
  return { ...r, lines, invoice: inv ?? null, totals: t };
}

// ---------- invoices ----------
export async function createInvoice(i: { saleId: string; issueDate: string; dueDate: string | null; notes: string | null }, user: CurrentUser, meta: Meta) {
  const company = await getCompany();
  if (!company.trn) throw new AppError(422, "Set the company TRN in Admin → Company settings before issuing tax invoices");
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(sales).where(eq(sales.id, i.saleId)).for("update");
    if (!s) throw new AppError(404, "Sale not found");
    const [exists] = await tx.select({ n: invoices.number }).from(invoices).where(eq(invoices.saleId, s.id));
    if (exists) throw new AppError(409, `This sale is already invoiced (${exists.n})`);
    const [cu] = await tx.select().from(customers).where(eq(customers.id, s.customerId));
    const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, s.id));
    if (!lines.length) throw new AppError(422, "The sale has no lines");
    const built = lines.map((l) => { const a = lineAmounts(l.qty, l.unitPrice, l.vatRate); return { description: l.description, qty: l.qty, unitPrice: l.unitPrice, vatRate: l.vatRate, net: a.net.toFixed(2), vat: a.vat.toFixed(2), total: a.total.toFixed(2) }; });
    const t = invoiceTotals(built, 1);
    const year = i.issueDate.slice(0, 4);
    const number = await nextNumber(tx, `invoice_${year}`, `INV-${year}-`, 4);
    const parties: InvoiceParties = {
      company: { name: company.name, address: company.address, trn: company.trn, phone: company.phone, email: company.email, bankName: company.bankName, iban: company.iban, terms: company.invoiceTerms },
      customer: { name: cu.name, address: cu.address, trn: cu.trn },
    };
    const [inv] = await tx.insert(invoices).values({
      number, saleId: s.id, customerId: s.customerId, issueDate: i.issueDate, dueDate: i.dueDate ?? addDays(i.issueDate, cu.creditDays),
      subtotal: t.subtotal.toFixed(2), vatTotal: t.vatTotal.toFixed(2), total: t.total.toFixed(2), parties, notes: i.notes, createdBy: user.id,
    }).returning();
    await tx.insert(invoiceLines).values(built.map((b) => ({ ...b, invoiceId: inv.id })));
    await audit({ action: "issue_invoice", entity: "invoice", entityId: inv.id, after: { number, total: inv.total, customer: cu.name }, ...who(user, meta) }, tx);
    return inv;
  });
}

export async function recordPayment(i: { invoiceId: string; paymentDate: string; amount: string; method: string; reference: string | null }, user: CurrentUser, meta: Meta) {
  const amount = D(i.amount);
  if (amount.lte(0)) throw new AppError(422, "Amount must be greater than zero");
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, i.invoiceId)).for("update");
    if (!inv) throw new AppError(404, "Invoice not found");
    const outstanding = D(inv.total).minus(inv.paidAmount);
    if (amount.gt(outstanding)) throw new AppError(422, `Payment exceeds the outstanding balance (AED ${outstanding.toFixed(2)})`);
    const ref = await nextNumber(tx, "payment", "PAY-");
    const [p] = await tx.insert(payments).values({ ref, invoiceId: inv.id, paymentDate: i.paymentDate, amount: toDb(amount), method: i.method, reference: i.reference, createdBy: user.id }).returning();
    await tx.update(invoices).set({ paidAmount: toDb(D(inv.paidAmount).plus(amount)) }).where(eq(invoices.id, inv.id));
    await audit({ action: "record_payment", entity: "invoice", entityId: inv.id, after: { ref, amount: p.amount, method: p.method }, ...who(user, meta) }, tx);
    return p;
  });
}

export const stateOf = (inv: { total: string; paidAmount: string; dueDate: string }): "paid" | "partial" | "overdue" | "unpaid" =>
  D(inv.paidAmount).gte(inv.total) ? "paid" : inv.dueDate < todayISO() ? "overdue" : D(inv.paidAmount).gt(0) ? "partial" : "unpaid";

export type InvoiceFilter = { q?: string; status?: string; customerId?: string; from?: string; to?: string; page?: number; size?: number };

export async function listInvoices(f: InvoiceFilter) {
  const size = sizeOf(f.size), page = Math.max(1, f.page ?? 1), today = todayISO();
  const where: SQL[] = [];
  switch (f.status) {
    case "unpaid": where.push(sql`${invoices.paidAmount} = 0`); break;
    case "partial": where.push(sql`${invoices.paidAmount} > 0 and ${invoices.paidAmount} < ${invoices.total}`); break;
    case "paid": where.push(sql`${invoices.paidAmount} >= ${invoices.total}`); break;
    case "overdue": where.push(sql`${invoices.paidAmount} < ${invoices.total}`, sql`${invoices.dueDate} < ${today}`); break;
  }
  if (f.customerId) where.push(eq(invoices.customerId, f.customerId));
  if (f.from) where.push(gte(invoices.issueDate, f.from));
  if (f.to) where.push(lte(invoices.issueDate, f.to));
  if (f.q) where.push(or(ilike(invoices.number, like(f.q)), ilike(customers.name, like(f.q)))!);
  const w = where.length ? and(...where) : undefined;
  const [rows, [tot]] = await Promise.all([
    db.select({ inv: invoices, customer: customers.name, saleRef: sales.ref }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).innerJoin(sales, eq(sales.id, invoices.saleId))
      .where(w).orderBy(desc(invoices.issueDate), desc(invoices.number)).limit(size).offset((page - 1) * size),
    db.select({ total: count(), amount: sql<string>`coalesce(sum(${invoices.total}), 0)`, paid: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)` }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).where(w),
  ]);
  return { rows, total: tot.total, totals: tot, page, size, pages: Math.max(1, Math.ceil(tot.total / size)) };
}

export async function getInvoice(id: string) {
  const [r] = await db.select({ inv: invoices, customer: customers, sale: sales }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).innerJoin(sales, eq(sales.id, invoices.saleId)).where(eq(invoices.id, id));
  if (!r) return null;
  const [lines, pays] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.description)),
    db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.createdAt)),
  ]);
  return { ...r, lines, payments: pays, state: stateOf(r.inv), outstanding: D(r.inv.total).minus(r.inv.paidAmount) };
}

/** Outstanding and overdue receivables, overall and per customer. */
export async function receivables() {
  const today = todayISO();
  const rows = await db.select({
    customerId: invoices.customerId, name: customers.name,
    outstanding: sql<string>`sum(${invoices.total} - ${invoices.paidAmount})`,
    overdue: sql<string>`coalesce(sum(case when ${invoices.dueDate} < ${today} then ${invoices.total} - ${invoices.paidAmount} else 0 end), 0)`,
    count: sql<number>`count(*)::int`,
  }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).where(sql`${invoices.paidAmount} < ${invoices.total}`).groupBy(invoices.customerId, customers.name).orderBy(desc(sql`sum(${invoices.total} - ${invoices.paidAmount})`));
  return { rows, outstanding: rows.reduce((s, r) => s.plus(r.outstanding), D(0)), overdue: rows.reduce((s, r) => s.plus(r.overdue), D(0)) };
}

export const customerOptions = () => db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.isActive, true)).orderBy(asc(customers.name));
