import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { entryBills, exitBills } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import type { CurrentUser } from "@/lib/auth";

type Meta = { ip: string | null; userAgent: string | null };
const who = (u: CurrentUser, m: Meta) => ({ userId: u.id, userEmail: u.email, ...m });
const dup = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505";
export const PAGE_SIZES = [10, 25, 50, 100] as const;

const like = (q: string) => `%${q.replace(/[%_\\]/g, "\\$&")}%`;

// ---------- entry bills ----------
export type EntryFilter = { q?: string; agent?: string; origin?: string; from?: string; to?: string; page?: number; size?: number };

function entryWhere(f: EntryFilter) {
  const w: SQL[] = [];
  if (f.q) w.push(or(ilike(entryBills.billNo, like(f.q)), ilike(entryBills.agentName, like(f.q)), ilike(entryBills.invoiceNo, like(f.q)), ilike(entryBills.marksNumbers, like(f.q)), ilike(entryBills.transferNo, like(f.q)))!);
  if (f.agent) w.push(eq(entryBills.agentName, f.agent));
  if (f.origin) w.push(ilike(entryBills.originCountry, f.origin));
  if (f.from) w.push(gte(entryBills.billDate, f.from));
  if (f.to) w.push(lte(entryBills.billDate, f.to));
  return w.length ? and(...w) : undefined;
}

export async function listEntries(f: EntryFilter) {
  const size = (PAGE_SIZES as readonly number[]).includes(f.size ?? 0) ? f.size! : 25;
  const page = Math.max(1, f.page ?? 1), w = entryWhere(f);
  const [rows, [tot]] = await Promise.all([
    db.select({ e: entryBills, sl: sql<number>`(select count(*) from entry_bills x where (x.bill_date, x.created_at) <= ("entry_bills"."bill_date", "entry_bills"."created_at"))::int` })
      .from(entryBills).where(w).orderBy(desc(entryBills.billDate), desc(entryBills.createdAt)).limit(size).offset((page - 1) * size),
    db.select({ total: count(), value: sql<string>`coalesce(sum(${entryBills.valueAed}), 0)`, weight: sql<string>`coalesce(sum(${entryBills.weightKg}), 0)`, packages: sql<string>`coalesce(sum(${entryBills.packages}), 0)` }).from(entryBills).where(w),
  ]);
  return { rows, total: tot.total, totals: tot, page, size, pages: Math.max(1, Math.ceil(tot.total / size)) };
}

export const entryAgents = async () => (await db.selectDistinct({ v: entryBills.agentName }).from(entryBills).orderBy(asc(entryBills.agentName))).map((r) => r.v).filter((v): v is string => !!v);
export const getEntry = async (id: string) => (await db.select().from(entryBills).where(eq(entryBills.id, id)))[0] ?? null;

type EntryData = Omit<typeof entryBills.$inferInsert, "id" | "version" | "createdAt" | "updatedAt" | "createdBy">;

export async function saveEntry(id: string | null, data: EntryData, version: number | undefined, user: CurrentUser, meta: Meta) {
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
      const [after] = await tx.update(entryBills).set({ ...data, version: sql`${entryBills.version} + 1` }).where(and(eq(entryBills.id, id), eq(entryBills.version, version))).returning();
      if (!after) throw new AppError(409, "This entry was changed by someone else. Reload and try again.");
      await audit({ action: "update", entity: "entry_bill", entityId: id, before, after, ...who(user, meta) }, tx);
      return after;
    });
  } catch (e) { if (dup(e)) throw new AppError(409, "An entry with that bill number already exists"); throw e; }
}

export async function deleteEntry(id: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [r] = await tx.delete(entryBills).where(eq(entryBills.id, id)).returning();
    if (!r) throw new AppError(404, "Entry not found");
    await audit({ action: "delete", entity: "entry_bill", entityId: id, before: r, ...who(user, meta) }, tx);
  });
}

// ---------- exit bills ----------
export type ExitFilter = { q?: string; type?: string; cert?: string; refund?: string; from?: string; to?: string; page?: number; size?: number };

function exitWhere(f: ExitFilter) {
  const w: SQL[] = [];
  if (f.q) w.push(or(ilike(exitBills.boeNo, like(f.q)), ilike(exitBills.importerName, like(f.q)), ilike(exitBills.refNo, like(f.q)), ilike(exitBills.invoiceNo, like(f.q)), ilike(exitBills.truckContainerNo, like(f.q)))!);
  if (f.type === "IMPORT" || f.type === "EXPORT") w.push(eq(exitBills.billType, f.type));
  if (f.cert) w.push(eq(exitBills.entryCertStatus, f.cert));
  if (f.refund) w.push(eq(exitBills.refundStatus, f.refund));
  if (f.from) w.push(gte(exitBills.exitDate, f.from));
  if (f.to) w.push(lte(exitBills.exitDate, f.to));
  return w.length ? and(...w) : undefined;
}

export async function listExits(f: ExitFilter) {
  const size = (PAGE_SIZES as readonly number[]).includes(f.size ?? 0) ? f.size! : 25;
  const page = Math.max(1, f.page ?? 1), w = exitWhere(f);
  const [rows, [tot]] = await Promise.all([
    db.select({ e: exitBills, sl: sql<number>`(select count(*) from exit_bills x where (x.exit_date, x.created_at) <= ("exit_bills"."exit_date", "exit_bills"."created_at"))::int` })
      .from(exitBills).where(w).orderBy(desc(exitBills.exitDate), desc(exitBills.createdAt)).limit(size).offset((page - 1) * size),
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
      const [after] = await tx.update(exitBills).set({ ...data, version: sql`${exitBills.version} + 1` }).where(and(eq(exitBills.id, id), eq(exitBills.version, version))).returning();
      if (!after) throw new AppError(409, "This exit bill was changed by someone else. Reload and try again.");
      await audit({ action: "update", entity: "exit_bill", entityId: id, before, after, ...who(user, meta) }, tx);
      return after;
    });
  } catch (e) { if (dup(e)) throw new AppError(409, "An exit bill with that BOE number already exists"); throw e; }
}

export async function deleteExit(id: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [r] = await tx.delete(exitBills).where(eq(exitBills.id, id)).returning();
    if (!r) throw new AppError(404, "Exit bill not found");
    await audit({ action: "delete", entity: "exit_bill", entityId: id, before: r, ...who(user, meta) }, tx);
  });
}
