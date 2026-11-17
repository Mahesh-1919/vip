import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { billAllocations, customers, entryBills, exitBills, invoiceLines, invoices } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import type { CurrentUser } from "@/lib/auth";

type Meta = { ip: string | null; userAgent: string | null };
const who = (u: CurrentUser, m: Meta) => ({ userId: u.id, userEmail: u.email, ...m });
const dup = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505";
export const PAGE_SIZES = [10, 25, 50, 100] as const;

const like = (q: string) => `%${q.replace(/[%_\\]/g, "\\$&")}%`;

// ---------- entry bills ----------
export type EntryFilter = { q?: string; agent?: string; origin?: string; from?: string; to?: string; open?: string; page?: number; size?: number };

const exportedSql = sql<number>`(select coalesce(sum(a.packages), 0) from bill_allocations a where a.entry_bill_id = "entry_bills"."id")::int`;

function entryWhere(f: EntryFilter) {
  const w: SQL[] = [];
  if (f.q) w.push(or(ilike(entryBills.billNo, like(f.q)), ilike(entryBills.agentName, like(f.q)), ilike(entryBills.invoiceNo, like(f.q)), ilike(entryBills.marksNumbers, like(f.q)), ilike(entryBills.transferNo, like(f.q)))!);
  if (f.agent) w.push(eq(entryBills.agentName, f.agent));
  if (f.origin) w.push(ilike(entryBills.originCountry, f.origin));
  if (f.from) w.push(gte(entryBills.billDate, f.from));
  if (f.to) w.push(lte(entryBills.billDate, f.to));
  if (f.open === "1") w.push(sql`(select coalesce(sum(a.packages), 0) from bill_allocations a where a.entry_bill_id = entry_bills.id) < entry_bills.packages`);
  return w.length ? and(...w) : undefined;
}

export async function listEntries(f: EntryFilter) {
  const size = (PAGE_SIZES as readonly number[]).includes(f.size ?? 0) ? f.size! : 25;
  const page = Math.max(1, f.page ?? 1), w = entryWhere(f);
  const [rows, [tot]] = await Promise.all([
    db.select({ e: entryBills, exported: exportedSql, sl: sql<number>`(select count(*) from entry_bills x where (x.bill_date, x.created_at) <= ("entry_bills"."bill_date", "entry_bills"."created_at"))::int` })
      .from(entryBills).where(w).orderBy(desc(entryBills.billDate), desc(entryBills.createdAt)).limit(size).offset((page - 1) * size),
    db.select({ total: count(), value: sql<string>`coalesce(sum(${entryBills.valueAed}), 0)`, weight: sql<string>`coalesce(sum(${entryBills.weightKg}), 0)`, packages: sql<string>`coalesce(sum(${entryBills.packages}), 0)` }).from(entryBills).where(w),
  ]);
  return { rows, total: tot.total, totals: tot, page, size, pages: Math.max(1, Math.ceil(tot.total / size)) };
}

export const entryAgents = async () => (await db.selectDistinct({ v: entryBills.agentName }).from(entryBills).orderBy(asc(entryBills.agentName))).map((r) => r.v).filter((v): v is string => !!v);
export const getEntry = async (id: string) => (await db.select().from(entryBills).where(eq(entryBills.id, id)))[0] ?? null;

type EntryData = Omit<typeof entryBills.$inferInsert, "id" | "version" | "createdAt" | "updatedAt" | "createdBy">;

export async function saveEntry(id: string | null, data: EntryData, version: number | undefined, user: CurrentUser, meta: Meta, packagesReason: string | null = null) {
  try {
    return await db.transaction(async (tx) => {
      if (!id) {
        const [r] = await tx.insert(entryBills).values({ ...data, createdBy: user.id }).returning();
        await audit({ action: "create", entity: "entry_bill", entityId: r.id, after: r, ...who(user, meta) }, tx);
        return r;
      }
      if (!version) throw new AppError(400, "Missing version: reload the page");
      const [before] = await tx.select().from(entryBills).where(eq(entryBills.id, id)).for("update");
      if (!before) throw new AppError(404, "Entry not found");
      const [alloc] = await tx.select({ n: sql<number>`coalesce(sum(${billAllocations.packages}), 0)::int` }).from(billAllocations).where(eq(billAllocations.entryBillId, id));
      if (Number(data.packages) < alloc.n) throw new AppError(409, `${alloc.n} packages from this entry are already allocated to exit bills: the package count cannot go below that`);
      // Stock-inflation guard: once goods have left this entry, changing its package count needs a reason (and is flagged in the audit log).
      const changedWithExports = alloc.n > 0 && Number(data.packages) !== before.packages;
      if (changedWithExports && (!packagesReason || packagesReason.trim().length < 5))
        throw new AppError(422, `${alloc.n} packages from this entry have been exported. To change its package count (${before.packages} → ${data.packages}) give a reason of at least 5 characters.`);
      const [after] = await tx.update(entryBills).set({ ...data, version: sql`${entryBills.version} + 1` }).where(and(eq(entryBills.id, id), eq(entryBills.version, version))).returning();
      if (!after) throw new AppError(409, "This entry was changed by someone else. Reload and try again.");
      await audit({ action: changedWithExports ? "change_packages" : "update", entity: "entry_bill", entityId: id, before, after: changedWithExports ? { ...after, packagesReason: packagesReason!.trim(), packagesFrom: before.packages, packagesTo: after.packages } : after, ...who(user, meta) }, tx);
      return after;
    });
  } catch (e) { if (dup(e)) throw new AppError(409, "An entry with that bill number already exists"); throw e; }
}

export async function deleteEntry(id: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(billAllocations).where(eq(billAllocations.entryBillId, id));
    if (n > 0) throw new AppError(409, "Goods from this entry have been exported (allocated to exit bills): remove those allocations first");
    const [r] = await tx.delete(entryBills).where(eq(entryBills.id, id)).returning();
    if (!r) throw new AppError(404, "Entry not found");
    await audit({ action: "delete", entity: "entry_bill", entityId: id, before: r, ...who(user, meta) }, tx);
  });
}

// ---------- exit bills ----------
export type ExitFilter = { q?: string; type?: string; cert?: string; refund?: string; from?: string; to?: string; alloc?: string; billing?: string; backing?: string; customerId?: string; page?: number; size?: number };

const allocatedSql = sql<number>`(select coalesce(sum(a.packages), 0) from bill_allocations a where a.exit_bill_id = "exit_bills"."id")::int`;
const billedPkgsSql = sql<string>`(select coalesce(sum(l.qty), 0) from invoice_lines l where l.exit_bill_id = "exit_bills"."id")`;
const billedValSql = sql<string>`(select coalesce(sum(l.net), 0) from invoice_lines l where l.exit_bill_id = "exit_bills"."id")`;

function exitWhere(f: ExitFilter) {
  const w: SQL[] = [];
  if (f.q) w.push(or(ilike(exitBills.boeNo, like(f.q)), ilike(exitBills.importerName, like(f.q)), ilike(exitBills.refNo, like(f.q)), ilike(exitBills.invoiceNo, like(f.q)), ilike(exitBills.truckContainerNo, like(f.q)))!);
  if (f.type === "IMPORT" || f.type === "EXPORT") w.push(eq(exitBills.billType, f.type));
  if (f.cert) w.push(eq(exitBills.entryCertStatus, f.cert));
  if (f.refund) w.push(eq(exitBills.refundStatus, f.refund));
  if (f.from) w.push(gte(exitBills.exitDate, f.from));
  if (f.to) w.push(lte(exitBills.exitDate, f.to));
  if (f.customerId) w.push(eq(exitBills.customerId, f.customerId));
  const alloc = sql`(select coalesce(sum(a.packages), 0) from bill_allocations a where a.exit_bill_id = exit_bills.id)`;
  if (f.alloc === "none") w.push(sql`${alloc} = 0`);
  if (f.alloc === "partial") w.push(sql`${alloc} > 0 and ${alloc} < exit_bills.packages`);
  if (f.alloc === "full") w.push(sql`${alloc} >= exit_bills.packages and exit_bills.packages > 0`);
  if (f.backing === "unbacked") w.push(sql`exit_bills.bill_type = 'EXPORT' and exit_bills.packages > 0 and ${alloc} < exit_bills.packages`);
  const billed = sql`(select coalesce(sum(l.qty), 0) from invoice_lines l where l.exit_bill_id = exit_bills.id)`;
  if (f.billing === "none") w.push(sql`${billed} = 0`);
  if (f.billing === "partial") w.push(sql`${billed} > 0 and ${billed} < exit_bills.packages`);
  if (f.billing === "full") w.push(sql`${billed} >= exit_bills.packages and exit_bills.packages > 0`);
  return w.length ? and(...w) : undefined;
}

export async function listExits(f: ExitFilter) {
  const size = (PAGE_SIZES as readonly number[]).includes(f.size ?? 0) ? f.size! : 25;
  const page = Math.max(1, f.page ?? 1), w = exitWhere(f);
  const [rows, [tot]] = await Promise.all([
    db.select({ e: exitBills, customer: customers.name, allocated: allocatedSql, billedPkgs: billedPkgsSql, billedValue: billedValSql, sl: sql<number>`(select count(*) from exit_bills x where (x.exit_date, x.created_at) <= ("exit_bills"."exit_date", "exit_bills"."created_at"))::int` })
      .from(exitBills).leftJoin(customers, eq(customers.id, exitBills.customerId)).where(w).orderBy(desc(exitBills.exitDate), desc(exitBills.createdAt)).limit(size).offset((page - 1) * size),
    db.select({ total: count(), value: sql<string>`coalesce(sum(${exitBills.valueAed}), 0)`, weight: sql<string>`coalesce(sum(${exitBills.weightKg}), 0)`, packages: sql<string>`coalesce(sum(${exitBills.packages}), 0)`, cheques: sql<string>`coalesce(sum(${exitBills.chequeAmount}), 0)` }).from(exitBills).where(w),
  ]);
  return { rows, total: tot.total, totals: tot, page, size, pages: Math.max(1, Math.ceil(tot.total / size)) };
}

export const getExit = async (id: string) => (await db.select().from(exitBills).where(eq(exitBills.id, id)))[0] ?? null;
type ExitData = Omit<typeof exitBills.$inferInsert, "id" | "version" | "createdAt" | "updatedAt" | "createdBy">;

export async function saveExit(id: string | null, data: ExitData, version: number | undefined, user: CurrentUser, meta: Meta) {
  try {
    return await db.transaction(async (tx) => {
      if (!id) {
        const [r] = await tx.insert(exitBills).values({ ...data, createdBy: user.id }).returning();
        await audit({ action: "create", entity: "exit_bill", entityId: r.id, after: r, ...who(user, meta) }, tx);
        return r;
      }
      if (!version) throw new AppError(400, "Missing version: reload the page");
      const [before] = await tx.select().from(exitBills).where(eq(exitBills.id, id)).for("update");
      if (!before) throw new AppError(404, "Exit bill not found");
      const [{ billed }] = await tx.select({ billed: sql<string>`coalesce(sum(${invoiceLines.qty}), 0)` }).from(invoiceLines).where(eq(invoiceLines.exitBillId, id));
      if (Number(billed) > 0 && (data.valueAed !== before.valueAed || data.packages !== before.packages || data.customerId !== before.customerId || data.billType !== before.billType))
        throw new AppError(409, "This exit bill has been invoiced: its value, packages, customer and bill type are locked. Notes and logistics fields can still be edited.");
      const [allocated] = await tx.select({ n: sql<number>`coalesce(sum(${billAllocations.packages}), 0)::int` }).from(billAllocations).where(eq(billAllocations.exitBillId, id));
      if (Number(data.packages) < allocated.n) throw new AppError(409, `${allocated.n} packages are already allocated from entry bills: remove allocations before lowering the package count`);
      const [after] = await tx.update(exitBills).set({ ...data, version: sql`${exitBills.version} + 1` }).where(and(eq(exitBills.id, id), eq(exitBills.version, version))).returning();
      if (!after) throw new AppError(409, "This exit bill was changed by someone else. Reload and try again.");
      await audit({ action: "update", entity: "exit_bill", entityId: id, before, after, ...who(user, meta) }, tx);
      return after;
    });
  } catch (e) { if (dup(e)) throw new AppError(409, "An exit bill with that BOE number already exists"); throw e; }
}

export async function deleteExit(id: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(billAllocations).where(eq(billAllocations.exitBillId, id));
    const [{ m }] = await tx.select({ m: count() }).from(invoiceLines).where(eq(invoiceLines.exitBillId, id));
    if (m > 0) throw new AppError(409, "This exit bill has been invoiced and cannot be deleted");
    if (n > 0) throw new AppError(409, "This exit bill has allocations from entry bills: remove them first");
    const [r] = await tx.delete(exitBills).where(eq(exitBills.id, id)).returning();
    if (!r) throw new AppError(404, "Exit bill not found");
    await audit({ action: "delete", entity: "exit_bill", entityId: id, before: r, ...who(user, meta) }, tx);
  });
}


// ---------- links between entry bills and exit bills ----------
/** Taking more than the entry's package count is tolerated up to this share, but needs a written reason. */
export const OVER_EXPORT_TOLERANCE = 0.1;

export async function getEntryDetail(id: string) {
  const [e] = await db.select({ e: entryBills, exported: exportedSql }).from(entryBills).where(eq(entryBills.id, id));
  if (!e) return null;
  const allocations = await db.select({ a: billAllocations, boeNo: exitBills.boeNo, exitDate: exitBills.exitDate, exitId: exitBills.id, importer: exitBills.importerName, customer: customers.name, billType: exitBills.billType })
    .from(billAllocations).innerJoin(exitBills, eq(exitBills.id, billAllocations.exitBillId)).leftJoin(customers, eq(customers.id, exitBills.customerId))
    .where(eq(billAllocations.entryBillId, id)).orderBy(asc(exitBills.exitDate));
  return { ...e, remaining: e.e.packages - e.exported, allocations };
}

export async function getExitDetail(id: string) {
  const [x] = await db.select({ e: exitBills, customer: customers.name, allocated: allocatedSql, billedPkgs: billedPkgsSql, billedValue: billedValSql }).from(exitBills).leftJoin(customers, eq(customers.id, exitBills.customerId)).where(eq(exitBills.id, id));
  if (!x) return null;
  const [allocations, billing] = await Promise.all([
    db.select({ a: billAllocations, billNo: entryBills.billNo, billDate: entryBills.billDate, agent: entryBills.agentName, entryPackages: entryBills.packages, entryId: entryBills.id })
      .from(billAllocations).innerJoin(entryBills, eq(entryBills.id, billAllocations.entryBillId)).where(eq(billAllocations.exitBillId, id)).orderBy(asc(entryBills.billDate)),
    db.select({ invoiceId: invoices.id, number: invoices.number, issueDate: invoices.issueDate, qty: invoiceLines.qty, net: invoiceLines.net }).from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId)).where(eq(invoiceLines.exitBillId, id)).orderBy(asc(invoices.issueDate)),
  ]);
  return { ...x, allocations, billing, unallocated: x.e.packages - x.allocated, unbilled: x.e.packages - Number(x.billedPkgs) };
}

/** Entries that could still supply this exit: not fully exported and dated on or before the exit. */
export async function entriesForExit(exitId: string) {
  const [x] = await db.select({ date: exitBills.exitDate }).from(exitBills).where(eq(exitBills.id, exitId));
  if (!x) return [];
  const rows = await db.select({ e: entryBills, exported: exportedSql }).from(entryBills).where(lte(entryBills.billDate, x.date)).orderBy(asc(entryBills.billDate), asc(entryBills.billNo));
  return rows.map((r) => ({ id: r.e.id, billNo: r.e.billNo, billDate: r.e.billDate, agent: r.e.agentName, packages: r.e.packages, remaining: r.e.packages - r.exported, marks: r.e.marksNumbers })).filter((r) => r.remaining > -Math.ceil(r.packages * OVER_EXPORT_TOLERANCE));
}

export const WEIGHT_WARNING = 0.05;

export async function allocate(i: { exitBillId: string; entryBillId: string; packages: number; weightKg: string; reason: string | null }, user: CurrentUser, meta: Meta): Promise<{ warnings: string[] }> {
  if (!Number.isInteger(i.packages) || i.packages <= 0) throw new AppError(422, "Packages must be a whole number above zero");
  return db.transaction(async (tx) => {
    const warnings: string[] = [];
    // Lock both rows in a fixed order so two people cannot over-allocate the same entry.
    const [en] = await tx.select().from(entryBills).where(eq(entryBills.id, i.entryBillId)).for("update");
    const [ex] = await tx.select().from(exitBills).where(eq(exitBills.id, i.exitBillId)).for("update");
    if (!en || !ex) throw new AppError(404, "Entry or exit bill not found");
    const [{ billed }] = await tx.select({ billed: sql<string>`coalesce(sum(${invoiceLines.qty}), 0)` }).from(invoiceLines).where(eq(invoiceLines.exitBillId, ex.id));
    if (Number(billed) > 0) throw new AppError(409, "This exit bill is already invoiced: its allocations are locked");
    if (en.billDate > ex.exitDate) throw new AppError(422, `The exit (${ex.exitDate}) is dated before the entry bill (${en.billDate})`);
    const [exitTotal] = await tx.select({ n: sql<number>`coalesce(sum(${billAllocations.packages}), 0)::int` }).from(billAllocations).where(eq(billAllocations.exitBillId, ex.id));
    if (exitTotal.n + i.packages > ex.packages) throw new AppError(422, `The exit has ${ex.packages} packages and ${exitTotal.n} are already allocated: ${ex.packages - exitTotal.n} left to allocate`);
    const [entryTotal] = await tx.select({ n: sql<number>`coalesce(sum(${billAllocations.packages}), 0)::int` }).from(billAllocations).where(eq(billAllocations.entryBillId, en.id));
    const after = entryTotal.n + i.packages;
    let reason: string | null = null;
    if (after > en.packages) {
      const over = after - en.packages;
      if (over > Math.floor(en.packages * OVER_EXPORT_TOLERANCE)) throw new AppError(409, `Not enough stock: ${en.billNo} has ${en.packages - entryTotal.n} packages left and this would take ${over} more than were imported (more than ${OVER_EXPORT_TOLERANCE * 100}% over).`);
      if (!i.reason || i.reason.trim().length < 5) throw new AppError(422, `This takes ${over} packages more than ${en.billNo} imported. Give a reason (at least 5 characters), e.g. repacking or a count correction.`);
      reason = i.reason.trim().slice(0, 200);
    }
    const [row] = await tx.insert(billAllocations).values({ exitBillId: ex.id, entryBillId: en.id, packages: i.packages, weightKg: i.weightKg, overReason: reason, createdBy: user.id })
      .onConflictDoUpdate({ target: [billAllocations.exitBillId, billAllocations.entryBillId], set: { packages: sql`${billAllocations.packages} + ${i.packages}`, weightKg: sql`${billAllocations.weightKg} + ${i.weightKg}`, overReason: reason ?? sql`${billAllocations.overReason}` } }).returning();
    const [w] = await tx.select({ kg: sql<string>`coalesce(sum(${billAllocations.weightKg}), 0)` }).from(billAllocations).where(eq(billAllocations.entryBillId, en.id));
    if (Number(en.weightKg) > 0 && Number(w.kg) > Number(en.weightKg) * (1 + WEIGHT_WARNING)) warnings.push(`Weight check: ${Number(w.kg).toLocaleString("en-US")} kg is now linked from ${en.billNo}, more than the ${Number(en.weightKg).toLocaleString("en-US")} kg imported (over ${WEIGHT_WARNING * 100}%).`);
    await audit({ action: "allocate", entity: "exit_bill", entityId: ex.id, after: { entry: en.billNo, exit: ex.boeNo, packages: i.packages, total: row.packages, overReason: reason, warnings }, ...who(user, meta) }, tx);
    return { warnings };
  });
}

export async function removeAllocation(id: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(billAllocations).where(eq(billAllocations.id, id)).for("update");
    if (!a) throw new AppError(404, "Allocation not found");
    const [{ billed }] = await tx.select({ billed: sql<string>`coalesce(sum(${invoiceLines.qty}), 0)` }).from(invoiceLines).where(eq(invoiceLines.exitBillId, a.exitBillId));
    if (Number(billed) > 0) throw new AppError(409, "This exit bill is already invoiced: its allocations are locked");
    await tx.delete(billAllocations).where(eq(billAllocations.id, id));
    await audit({ action: "remove_allocation", entity: "exit_bill", entityId: a.exitBillId, before: a, ...who(user, meta) }, tx);
  });
}

/** Unlinked / partly-linked counts and export bills waiting to be invoiced, for the dashboard. */
export async function linkSummary() {
  const [stock] = await db.select({ n: sql<number>`(coalesce(sum(${entryBills.packages}), 0) - (select coalesce(sum(a.packages), 0) from bill_allocations a))::int` }).from(entryBills);
  const [r] = await db.select({
    unlinked: sql<number>`count(*) filter (where ${allocatedSql} = 0)::int`,
    unbilledExports: sql<number>`count(*) filter (where ${exitBills.billType} = 'EXPORT' and ${exitBills.packages} > 0 and ${billedPkgsSql} < ${exitBills.packages})::int`,
  }).from(exitBills);
  return { ...r, stockPackages: stock.n };
}


