import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, exitBills, invoiceLines, invoices, saleLines, sales, type InvoiceParties } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { D, Decimal } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { amountsFromNet, invoiceTotals } from "@/lib/vat";
import type { CurrentUser } from "@/lib/auth";
import { getCompany } from "@/services/company";

type Meta = { ip: string | null; userAgent: string | null };
const addDays = (iso: string, d: number) => new Date(Date.parse(iso + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
const r2 = (v: Decimal.Value) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Export bills of a customer that still have packages left to invoice. */
export async function invoiceableExits(customerId: string) {
  const rows = await db.select({
    e: exitBills,
    billedPkgs: sql<string>`(select coalesce(sum(l.qty), 0) from invoice_lines l where l.exit_bill_id = "exit_bills"."id")`,
    billedValue: sql<string>`(select coalesce(sum(l.net), 0) from invoice_lines l where l.exit_bill_id = "exit_bills"."id")`,
  }).from(exitBills).where(and(eq(exitBills.customerId, customerId), eq(exitBills.billType, "EXPORT"))).orderBy(asc(exitBills.exitDate), asc(exitBills.boeNo));
  return rows.map((r) => ({ ...r, remainingPkgs: r.e.packages - Number(r.billedPkgs), remainingValue: D(r.e.valueAed).minus(r.billedValue) })).filter((r) => r.remainingPkgs > 0);
}

export const customersWithExports = () =>
  db.selectDistinct({ id: customers.id, name: customers.name }).from(customers).innerJoin(exitBills, eq(exitBills.customerId, customers.id)).where(and(eq(customers.isActive, true), eq(exitBills.billType, "EXPORT"))).orderBy(asc(customers.name));

/**
 * Invoices goods on one or more EXPORT bills of the same customer, in whole or in part (by packages).
 * - Each package is billed once: remaining = exit packages − packages on earlier invoices.
 * - The price is the exit bill's value spread over its packages; the final part takes the exact remainder,
 *   so all parts together always equal the exit bill value to the fils.
 * - Exports are zero-rated (0% VAT).
 * A sale record is created alongside, so the Sales list and totals stay complete.
 */
export async function createExitInvoice(
  i: { customerId: string; issueDate: string; dueDate: string | null; notes: string | null; lines: { exitBillId: string; packages: number }[] },
  user: CurrentUser, meta: Meta,
) {
  const wanted = i.lines.filter((l) => l.packages > 0);
  if (!wanted.length) throw new AppError(422, "Enter the number of packages to invoice for at least one export bill");
  if (new Set(wanted.map((w) => w.exitBillId)).size !== wanted.length) throw new AppError(422, "The same export bill appears twice");
  if (wanted.some((w) => !Number.isInteger(w.packages))) throw new AppError(422, "Packages must be whole numbers");
  const company = await getCompany();
  if (!company.trn) throw new AppError(422, "Set the company TRN in Admin → Company settings before issuing tax invoices");

  return db.transaction(async (tx) => {
    const [cu] = await tx.select().from(customers).where(eq(customers.id, i.customerId));
    if (!cu || !cu.isActive) throw new AppError(422, "Choose an active customer");
    // Lock the export bills in id order so concurrent invoices cannot bill the same packages twice.
    const exits = await tx.select().from(exitBills).where(inArray(exitBills.id, wanted.map((w) => w.exitBillId))).orderBy(asc(exitBills.id)).for("update");
    if (exits.length !== wanted.length) throw new AppError(404, "An export bill was not found");

    const built: { exitBillId: string; description: string; qty: number; unitPrice: string; net: Decimal; boe: string }[] = [];
    for (const x of exits) {
      const want = wanted.find((w) => w.exitBillId === x.id)!.packages;
      if (x.billType !== "EXPORT") throw new AppError(422, `${x.boeNo} is an ${x.billType} bill: invoices are generated for export bills only`);
      if (x.customerId !== cu.id) throw new AppError(422, `${x.boeNo} belongs to a different customer${x.customerId ? "" : " (no customer linked yet)"}`);
      if (x.packages <= 0) throw new AppError(422, `${x.boeNo}: set the number of packages on the export bill first`);
      if (D(x.valueAed).lte(0)) throw new AppError(422, `${x.boeNo}: the export bill has no value to invoice`);
      const [b] = await tx.select({ pk: sql<string>`coalesce(sum(${invoiceLines.qty}), 0)`, val: sql<string>`coalesce(sum(${invoiceLines.net}), 0)` }).from(invoiceLines).where(eq(invoiceLines.exitBillId, x.id));
      const remaining = x.packages - Number(b.pk);
      if (want > remaining) throw new AppError(409, `${x.boeNo}: only ${remaining} of ${x.packages} packages left to invoice (${Number(b.pk)} already billed)`);
      const net = want === remaining ? D(x.valueAed).minus(b.val) : r2(D(x.valueAed).times(want).div(x.packages));
      if (net.lte(0)) throw new AppError(422, `${x.boeNo}: nothing left to invoice`);
      const where = [x.portOfLoading, x.portOfDischarge].filter(Boolean).join(" → ");
      built.push({
        exitBillId: x.id, qty: want, net, boe: x.boeNo,
        unitPrice: net.div(want).toDecimalPlaces(4).toFixed(4),
        description: `Goods exported per BOE ${x.boeNo}${x.truckContainerNo ? ` · ${x.truckContainerNo}` : ""}${where ? ` · ${where}` : ""}${want < x.packages ? ` (${want} of ${x.packages} packages)` : ""}`.slice(0, 200),
      });
    }

    const lines = built.map((b) => ({ ...b, ...amountsFromNet(b.net, 0) }));
    const t = invoiceTotals(lines, 1);
    const boes = built.map((b) => b.boe);
    const billRef = (boes.length > 2 ? `${boes.slice(0, 2).join(", ")} +${boes.length - 2}` : boes.join(", ")).slice(0, 80);
    const saleRef = await nextNumber(tx, "sale", "SAL-");
    const [sale] = await tx.insert(sales).values({ ref: saleRef, customerId: cu.id, saleDate: i.issueDate, billRef, notes: null, createdBy: user.id }).returning();
    await tx.insert(saleLines).values(lines.map((l) => ({ saleId: sale.id, description: l.description, qty: String(l.qty), unitPrice: l.unitPrice, exitBillId: l.exitBillId, netOverride: l.net.toFixed(2), vatRate: "0" })));

    const year = i.issueDate.slice(0, 4);
    const number = await nextNumber(tx, `invoice_${year}`, `INV-${year}-`, 4);
    const parties: InvoiceParties = {
      company: { name: company.name, address: company.address, trn: company.trn, phone: company.phone, email: company.email, bankName: company.bankName, iban: company.iban, terms: company.invoiceTerms },
      customer: { name: cu.name, address: cu.address, trn: cu.trn },
    };
    const [inv] = await tx.insert(invoices).values({
      number, saleId: sale.id, customerId: cu.id, issueDate: i.issueDate, dueDate: i.dueDate ?? addDays(i.issueDate, cu.creditDays),
      subtotal: t.subtotal.toFixed(2), vatTotal: t.vatTotal.toFixed(2), total: t.total.toFixed(2), parties, notes: i.notes, createdBy: user.id,
    }).returning();
    await tx.insert(invoiceLines).values(lines.map((l) => ({ invoiceId: inv.id, description: l.description, qty: String(l.qty), unitPrice: l.unitPrice, exitBillId: l.exitBillId, vatRate: "0", net: l.net.toFixed(2), vat: "0.00", total: l.total.toFixed(2) })));
    await audit({ action: "issue_invoice", entity: "invoice", entityId: inv.id, after: { number, total: inv.total, customer: cu.name, exits: boes, packages: built.map((b) => b.qty) }, userId: user.id, userEmail: user.email, ...meta }, tx);
    return inv;
  });
}
