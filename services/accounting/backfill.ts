import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { containerCosts, containers, invoices, payments, payrollRuns } from "@/db/schema";
import { postCogs, postCost, postInvoice, postPayment, postPayrollFinalized, postPayrollPaid, postReceipt } from "./posting";

/**
 * Posts every business document that has no journal entry yet (invoices, payments, receipts, costs, dispatches, payroll).
 * Idempotent: documents already posted are skipped. Used after upgrading and from the seed.
 */
export async function backfillLedger(userId: string | null) {
  const counts = { invoices: 0, payments: 0, receipts: 0, costs: 0, cogs: 0, payroll: 0 };
  await db.transaction(async (tx) => {
    for (const i of await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.status, "issued")))
      if ((await postInvoice(tx, i.id, userId))?.created) counts.invoices++;
    for (const p of await tx.select({ id: payments.id }).from(payments)) if ((await postPayment(tx, p.id, userId))?.created) counts.payments++;
    for (const c of await tx.select({ id: containers.id, d: containers.direction }).from(containers).where(and(eq(containers.status, "received")))) if ((await postReceipt(tx, c.id, userId))?.created) counts.receipts++;
    for (const k of await tx.select({ id: containerCosts.id }).from(containerCosts)) if ((await postCost(tx, k.id, userId))?.created) counts.costs++;
    for (const c of await tx.select({ id: containers.id }).from(containers).where(eq(containers.direction, "outward"))) if ((await postCogs(tx, c.id, userId))?.created) counts.cogs++;
    for (const r of await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(ne(payrollRuns.status, "draft"))) {
      if ((await postPayrollFinalized(tx, r.id, userId))?.created) counts.payroll++;
      if ((await postPayrollPaid(tx, r.id, userId))?.created) counts.payroll++;
    }
  });
  return counts;
}
