import "server-only";
import { and, asc, desc, eq, isNotNull, lte, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, employees, entryBills, exitBills, invoices } from "@/db/schema";
import { daysUntil } from "@/lib/dates";

/** Packages in (entry bills) vs out (exit bills) for the last six months. */
export async function monthlyFlow() {
  const months: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const [ins, outs] = await Promise.all([
    db.select({ m: sql<string>`to_char(${entryBills.billDate}::date, 'YYYY-MM')`, n: sql<number>`coalesce(sum(${entryBills.packages}), 0)::int` }).from(entryBills).groupBy(sql`1`),
    db.select({ m: sql<string>`to_char(${exitBills.exitDate}::date, 'YYYY-MM')`, n: sql<number>`coalesce(sum(${exitBills.packages}), 0)::int` }).from(exitBills).groupBy(sql`1`),
  ]);
  const label = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return months.map((m) => ({ month: label(m), imported: ins.find((x) => x.m === m)?.n ?? 0, exported: outs.find((x) => x.m === m)?.n ?? 0 }));
}

export const recentEntries = () => db.select({ id: entryBills.id, billNo: entryBills.billNo, date: entryBills.billDate, agent: entryBills.agentName, packages: entryBills.packages, origin: entryBills.originCountry }).from(entryBills).orderBy(desc(entryBills.billDate), desc(entryBills.createdAt)).limit(5);
export const recentExits = () => db.select({ id: exitBills.id, boeNo: exitBills.boeNo, date: exitBills.exitDate, importer: exitBills.importerName, packages: exitBills.packages, type: exitBills.billType, country: exitBills.country }).from(exitBills).orderBy(desc(exitBills.exitDate), desc(exitBills.createdAt)).limit(5);
export const recentInvoices = () => db.select({ id: invoices.id, number: invoices.number, date: invoices.issueDate, due: invoices.dueDate, total: invoices.total, paid: invoices.paidAmount, customer: customers.name }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).orderBy(desc(invoices.issueDate), desc(invoices.number)).limit(5);

/** Staff whose passport or visa has expired or expires within 90 days, soonest first. */
export async function expiringDocuments() {
  const soon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const rows = await db.select({ id: employees.id, name: employees.name, code: employees.empCode, passport: employees.passportExpiry, visa: employees.visaExpiry, eid: employees.emiratesIdExpiry, labour: employees.labourCardExpiry })
    .from(employees).where(and(notInArray(employees.status, ["inactive", "terminated"]), or(...(["visaExpiry", "passportExpiry", "emiratesIdExpiry", "labourCardExpiry"] as const).map((c) => and(isNotNull(employees[c]), lte(employees[c], soon))))!)).orderBy(asc(employees.name));
  return rows.flatMap((r) => (["passport", "visa", "eid", "labour"] as const).map((k) => ({ id: r.id, name: r.name, doc: { passport: "Passport", visa: "Visa", eid: "Emirates ID", labour: "Labour card" }[k], date: r[k], days: daysUntil(r[k]) })))
    .filter((x) => x.days !== null && x.days <= 90).sort((a, b) => (a.days ?? 0) - (b.days ?? 0)).slice(0, 6);
}
