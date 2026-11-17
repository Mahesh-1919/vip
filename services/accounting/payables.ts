import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { payablePayments, payables, suppliers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { todayISO } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { D, toDb } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import type { CurrentUser } from "@/lib/auth";
import { postPayablePayment } from "./posting";

type Meta = { ip: string | null; userAgent: string | null };
export const METHODS = ["bank_transfer", "cash", "cheque", "card"] as const;

export async function listPayables(f: { status?: string; supplierId?: string } = {}) {
  const rows = await db.select({ p: payables, supplier: suppliers.name }).from(payables).leftJoin(suppliers, eq(suppliers.id, payables.supplierId))
    .where(and(f.supplierId ? eq(payables.supplierId, f.supplierId) : undefined)).orderBy(asc(payables.dueDate));
  const today = todayISO();
  return rows.map((r) => {
    const outstanding = D(r.p.amountAed).minus(r.p.paidAed);
    const state = outstanding.isZero() ? "paid" : D(r.p.paidAed).gt(0) ? (r.p.dueDate < today ? "overdue" : "partial") : r.p.dueDate < today ? "overdue" : "unpaid";
    return { ...r, outstanding, state };
  }).filter((r) => !f.status || r.state === f.status);
}

export async function payPayable(i: { payableId: string; paymentDate: string; amount: string; method: string; reference: string | null }, user: CurrentUser, meta: Meta) {
  if (!(METHODS as readonly string[]).includes(i.method)) throw new AppError(422, "Invalid payment method");
  const amount = D(i.amount);
  if (amount.lte(0)) throw new AppError(422, "Amount must be greater than zero");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payables).where(eq(payables.id, i.payableId)).for("update");
    if (!p) throw new AppError(404, "Payable not found");
    const outstanding = D(p.amountAed).minus(p.paidAed);
    if (amount.gt(outstanding)) throw new AppError(422, `Payment exceeds the outstanding balance (AED ${outstanding.toFixed(2)})`);
    const ref = await nextNumber(tx, "payable_payment", "BPY-");
    const [pay] = await tx.insert(payablePayments).values({ ref, payableId: p.id, paymentDate: i.paymentDate, amountAed: toDb(amount), method: i.method, reference: i.reference, createdBy: user.id }).returning();
    await tx.update(payables).set({ paidAed: toDb(D(p.paidAed).plus(amount)) }).where(eq(payables.id, p.id));
    await postPayablePayment(tx, pay.id, user.id);
    await audit({ action: "pay_supplier", entity: "payable", entityId: p.id, after: { ref, amount: pay.amountAed, payee: p.payeeName }, userId: user.id, userEmail: user.email, ...meta }, tx);
    return pay;
  });
}

export const sumOutstanding = async () => {
  const [r] = await db.select({ v: sql<string>`coalesce(sum(${payables.amountAed} - ${payables.paidAed}), 0)` }).from(payables);
  return r.v;
};
