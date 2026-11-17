import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { customers, invoiceLines, invoices, payments, saleLines, sales, type InvoiceParties } from "@/db/schema";
import { audit } from "@/lib/audit";
import { todayISO } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { D, toDb } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { invoiceTotals, lineAmounts, paymentStatus } from "@/lib/vat";
import type { CurrentUser } from "@/lib/auth";
import { getCompany } from "@/services/company";
import { postInvoice, postPayment } from "@/services/accounting/posting";

type Meta = { ip: string | null; userAgent: string | null };
const who = (u: CurrentUser, m: Meta) => ({ userId: u.id, userEmail: u.email, ...m });
export const PAGE_SIZE = 20;
export const PAYMENT_METHODS = ["bank_transfer", "cash", "cheque", "card"] as const;

const addDays = (iso: string, d: number) => new Date(Date.parse(iso + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);

export type DraftInput = { saleId: string; lines: { saleLineId: string; qty: string }[]; issueDate: string; supplyDate: string; dueDate: string | null; notes: string | null };

/** Creates a draft invoice for part (or all) of a sale. Quantities are reserved immediately so two drafts can never over-bill a line. */
export async function createDraft(i: DraftInput, user: CurrentUser, meta: Meta) {
  const wanted = i.lines.filter((l) => D(l.qty).gt(0));
  if (!wanted.length) throw new AppError(422, "Enter a quantity for at least one line");
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(sales).where(eq(sales.id, i.saleId)).for("update");
    if (!s) throw new AppError(404, "Sale not found");
    if (s.status === "cancelled") throw new AppError(409, "A cancelled sale cannot be invoiced");
    const [cu] = await tx.select().from(customers).where(eq(customers.id, s.customerId));
    const lines = await tx.select().from(saleLines).where(and(eq(saleLines.saleId, s.id), inArray(saleLines.id, wanted.map((w) => w.saleLineId)))).for("update");
    if (lines.length !== wanted.length) throw new AppError(422, "Some lines do not belong to this sale");

    const built = [];
    for (const w of wanted) {
      const l = lines.find((x) => x.id === w.saleLineId)!;
      const [{ billed }] = await tx.select({ billed: sql<string>`coalesce(sum(${invoiceLines.qty}), 0)` }).from(invoiceLines).where(eq(invoiceLines.saleLineId, l.id));
      const remaining = D(l.qty).minus(billed);
      const qty = D(w.qty);
      if (qty.gt(remaining)) throw new AppError(409, `“${l.description}”: only ${remaining.toFixed()} left to invoice (${D(billed).toFixed()} of ${D(l.qty).toFixed()} already billed)`);
      const a = lineAmounts(qty, l.unitPrice, l.vatRate);
      built.push({ saleLineId: l.id, description: l.description, qty: qty.toFixed(4), unitPrice: l.unitPrice, vatCategory: l.vatCategory, vatRate: l.vatRate, net: a.net.toFixed(2), vat: a.vat.toFixed(2), total: a.total.toFixed(2) });
    }
    const t = invoiceTotals(built, s.exchangeRate);
    const [inv] = await tx.insert(invoices).values({
      customerId: s.customerId, saleId: s.id, issueDate: i.issueDate, supplyDate: i.supplyDate, dueDate: i.dueDate ?? addDays(i.issueDate, cu.creditDays),
      currency: s.currency, exchangeRate: s.exchangeRate, subtotal: t.subtotal.toFixed(2), vatTotal: t.vatTotal.toFixed(2), total: t.total.toFixed(2),
      subtotalAed: t.subtotalAed.toFixed(2), vatAed: t.vatAed.toFixed(2), totalAed: t.totalAed.toFixed(2), notes: i.notes, createdBy: user.id,
    }).returning();
    await tx.insert(invoiceLines).values(built.map((b) => ({ ...b, invoiceId: inv.id })));
    await audit({ action: "create_draft", entity: "invoice", entityId: inv.id, after: { saleId: s.id, total: inv.total, lines: built.length }, ...who(user, meta) }, tx);
    return inv;
  });
}

export async function deleteDraft(id: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update");
    if (!inv) throw new AppError(404, "Invoice not found");
    if (inv.status !== "draft") throw new AppError(409, "An issued tax invoice cannot be deleted");
    await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    await tx.delete(invoices).where(eq(invoices.id, id));
    await audit({ action: "delete_draft", entity: "invoice", entityId: id, before: inv, ...who(user, meta) }, tx);
  });
}

/** Assigns the next gap-free number, freezes the company/customer details and locks the invoice. */
export async function issueInvoice(id: string, user: CurrentUser, meta: Meta) {
  const company = await getCompany();
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update");
    if (!inv) throw new AppError(404, "Invoice not found");
    if (inv.status !== "draft") throw new AppError(409, "This invoice is already issued");
    if (!company.trn) throw new AppError(422, "Set the company TRN in Admin → Company settings before issuing tax invoices");
    const [cu] = await tx.select().from(customers).where(eq(customers.id, inv.customerId));
    const year = inv.issueDate.slice(0, 4);
    const number = await nextNumber(tx, `invoice_${year}`, `INV-${year}-`, 4);
    const parties: InvoiceParties = {
      company: { name: company.name, address: company.address, trn: company.trn, phone: company.phone, email: company.email, bankName: company.bankName, iban: company.iban, terms: company.invoiceTerms },
      customer: { name: cu.name, address: cu.address, trn: cu.taxId, country: cu.country },
    };
    const [after] = await tx.update(invoices).set({ number, status: "issued", parties, issuedBy: user.id, issuedAt: new Date(), version: sql`${invoices.version} + 1` }).where(eq(invoices.id, id)).returning();
    await postInvoice(tx, id, user.id);
    await audit({ action: "issue", entity: "invoice", entityId: id, after: { number, total: after.total, customer: cu.name }, ...who(user, meta) }, tx);
    return after;
  });
}

export async function recordPayment(i: { invoiceId: string; paymentDate: string; amount: string; method: string; reference: string | null; notes: string | null }, user: CurrentUser, meta: Meta) {
  if (!(PAYMENT_METHODS as readonly string[]).includes(i.method)) throw new AppError(422, "Invalid payment method");
  const amount = D(i.amount);
  if (amount.lte(0)) throw new AppError(422, "Amount must be greater than zero");
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, i.invoiceId)).for("update");
    if (!inv) throw new AppError(404, "Invoice not found");
    if (inv.status !== "issued") throw new AppError(409, "Payments can only be recorded against issued invoices");
    const outstanding = D(inv.total).minus(inv.paidAmount);
    if (amount.gt(outstanding)) throw new AppError(422, `Payment exceeds the outstanding balance (${outstanding.toFixed(2)} ${inv.currency})`);
    const ref = await nextNumber(tx, "payment", "PAY-");
    const [p] = await tx.insert(payments).values({ ref, invoiceId: inv.id, paymentDate: i.paymentDate, amount: toDb(amount), method: i.method, reference: i.reference, notes: i.notes, createdBy: user.id }).returning();
    await tx.update(invoices).set({ paidAmount: toDb(D(inv.paidAmount).plus(amount)), version: sql`${invoices.version} + 1` }).where(eq(invoices.id, inv.id));
    await postPayment(tx, p.id, user.id);
    await audit({ action: "record_payment", entity: "invoice", entityId: inv.id, after: { ref, amount: p.amount, method: p.method }, ...who(user, meta) }, tx);
    return p;
  });
}

export async function reversePayment(paymentId: string, reason: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) throw new AppError(404, "Payment not found");
    if (D(p.amount).lte(0)) throw new AppError(422, "A reversal cannot be reversed");
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, p.invoiceId)).for("update");
    const [done] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.reversalOf, paymentId));
    if (done) throw new AppError(409, "This payment was already reversed");
    const ref = await nextNumber(tx, "payment", "PAY-");
    const [rev] = await tx.insert(payments).values({ ref, invoiceId: inv.id, paymentDate: todayISO(), amount: toDb(D(p.amount).neg()), method: p.method, reference: p.ref, notes: `Reversal of ${p.ref}: ${reason}`, reversalOf: p.id, createdBy: user.id }).returning();
    await postPayment(tx, rev.id, user.id);
    await tx.update(invoices).set({ paidAmount: toDb(D(inv.paidAmount).minus(p.amount)), version: sql`${invoices.version} + 1` }).where(eq(invoices.id, inv.id));
    await audit({ action: "reverse_payment", entity: "invoice", entityId: inv.id, after: { reversed: p.ref, reason }, ...who(user, meta) }, tx);
  });
}

// ---------- queries ----------
export type InvoiceFilter = { q?: string; status?: string; customerId?: string; from?: string; to?: string; page?: number };

export async function listInvoices(f: InvoiceFilter) {
  const today = todayISO();
  const where: SQL[] = [];
  switch (f.status) {
    case "draft": where.push(eq(invoices.status, "draft")); break;
    case "unpaid": where.push(eq(invoices.status, "issued"), sql`${invoices.paidAmount} = 0`); break;
    case "partial": where.push(sql`${invoices.paidAmount} > 0 and ${invoices.paidAmount} < ${invoices.total}`); break;
    case "paid": where.push(eq(invoices.status, "issued"), sql`${invoices.paidAmount} >= ${invoices.total}`); break;
    case "overdue": where.push(eq(invoices.status, "issued"), sql`${invoices.paidAmount} < ${invoices.total}`, sql`${invoices.dueDate} < ${today}`); break;
  }
  if (f.customerId) where.push(eq(invoices.customerId, f.customerId));
  if (f.from) where.push(gte(invoices.issueDate, f.from));
  if (f.to) where.push(lte(invoices.issueDate, f.to));
  if (f.q) { const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`; where.push(or(ilike(invoices.number, like), ilike(customers.name, like))!); }
  const w = where.length ? and(...where) : undefined;
  const page = Math.max(1, f.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select({ inv: invoices, customer: customers.name, saleRef: sales.ref }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).innerJoin(sales, eq(sales.id, invoices.saleId))
      .where(w).orderBy(desc(invoices.issueDate), desc(invoices.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).where(w),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export const statusOf = (inv: { status: string; total: string; paidAmount: string; dueDate: string }) =>
  inv.status === "draft" ? "draft" : paymentStatus(inv.total, inv.paidAmount) === "paid" ? "paid"
    : inv.dueDate < todayISO() ? "overdue" : paymentStatus(inv.total, inv.paidAmount) === "partial" ? "partial" : "unpaid";

export async function getInvoice(id: string) {
  const [r] = await db.select({ inv: invoices, customer: customers, sale: sales }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).innerJoin(sales, eq(sales.id, invoices.saleId)).where(eq(invoices.id, id));
  if (!r) return null;
  const [lines, pays] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.description)),
    db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.createdAt)),
  ]);
  return { ...r, lines, payments: pays, state: statusOf(r.inv), outstanding: D(r.inv.total).minus(r.inv.paidAmount) };
}

/** Outstanding receivable per customer in AED. */
export async function receivables(customerId?: string) {
  return db.select({
    customerId: invoices.customerId, name: customers.name,
    outstandingAed: sql<string>`sum((${invoices.total} - ${invoices.paidAmount}) * ${invoices.exchangeRate})`,
    overdueAed: sql<string>`coalesce(sum(case when ${invoices.dueDate} < ${todayISO()} then (${invoices.total} - ${invoices.paidAmount}) * ${invoices.exchangeRate} else 0 end), 0)`,
    count: sql<number>`count(*)::int`,
  }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.status, "issued"), sql`${invoices.paidAmount} < ${invoices.total}`, customerId ? eq(invoices.customerId, customerId) : undefined))
    .groupBy(invoices.customerId, customers.name).orderBy(desc(sql`sum((${invoices.total} - ${invoices.paidAmount}) * ${invoices.exchangeRate})`));
}
