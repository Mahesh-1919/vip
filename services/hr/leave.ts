import "server-only";
import { and, asc, desc, eq, inArray, lte, gte, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { attendance, employees, leaveBalances, leaveRequests, leaveTypes } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/dates";
import { accrued, monthsBetween, toMs } from "@/lib/hr-calendar";
import { D, Decimal, toDb } from "@/lib/money";
import type { CurrentUser } from "@/lib/auth";
import { loadSchedules } from "./schedule";

type Meta = { ip: string | null; userAgent: string | null };
const who = (u: CurrentUser, m: Meta) => ({ userId: u.id, userEmail: u.email, ...m });

/** Creates any missing balance rows for the year (idempotent). */
export async function ensureBalances(employeeId: string, year: number, tx: Tx | typeof db = db) {
  const [emp] = await tx.select({ gender: employees.gender }).from(employees).where(eq(employees.id, employeeId));
  if (!emp) throw new AppError(404, "Employee not found");
  const types = await tx.select().from(leaveTypes).where(eq(leaveTypes.isActive, true));
  const rows = types.filter((t) => !t.gender || t.gender === emp.gender).map((t) => ({
    employeeId, leaveTypeId: t.id, year, allocated: t.annualQuota,
  }));
  if (rows.length) await tx.insert(leaveBalances).values(rows).onConflictDoNothing();
}

export async function getBalances(employeeId: string, year: number) {
  await ensureBalances(employeeId, year);
  const today = todayISO();
  const rows = await db.select({ b: leaveBalances, t: leaveTypes })
    .from(leaveBalances).innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
    .where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.year, year))).orderBy(asc(leaveTypes.name));
  const pending = await db.select({ typeId: leaveRequests.leaveTypeId, days: sql<string>`coalesce(sum(${leaveRequests.days}),0)` })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, "pending"), gte(leaveRequests.fromDate, `${year}-01-01`), lte(leaveRequests.fromDate, `${year}-12-31`)))
    .groupBy(leaveRequests.leaveTypeId);
  return rows.map(({ b, t }) => {
    const entitled = accrued(b.allocated, t.accrual, year, today).plus(b.carriedForward).plus(b.adjustment);
    const pend = D(pending.find((p) => p.typeId === t.id)?.days);
    return { type: t, balance: b, entitled, used: D(b.used), pending: pend, available: entitled.minus(b.used).minus(pend) };
  });
}

export type ApplyInput = { employeeId: string; leaveTypeId: string; fromDate: string; toDate: string; halfDay: "first" | "second" | null; reason: string | null };

export async function applyLeave(input: ApplyInput, user: CurrentUser, meta: Meta) {
  const year = Number(input.fromDate.slice(0, 4));
  if (input.toDate < input.fromDate) throw new AppError(422, "End date is before start date");
  if (input.toDate.slice(0, 4) !== String(year)) throw new AppError(422, "Split requests that cross a year boundary into two");
  if (input.halfDay && input.fromDate !== input.toDate) throw new AppError(422, "Half-day leave must be a single day");

  return db.transaction(async (tx) => {
    const [emp] = await tx.select().from(employees).where(eq(employees.id, input.employeeId)).for("share");
    if (!emp) throw new AppError(404, "Employee not found");
    if (emp.status === "inactive" || emp.status === "terminated") throw new AppError(422, "Employee is not active");
    const [type] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.id, input.leaveTypeId), eq(leaveTypes.isActive, true)));
    if (!type) throw new AppError(422, "Unknown leave type");
    if (input.halfDay && !type.allowHalfDay) throw new AppError(422, `${type.name} does not allow half days`);
    if (type.gender && type.gender !== emp.gender) throw new AppError(422, `${type.name} is not applicable to this employee`);
    if (monthsBetween(emp.joinDate, input.fromDate) < type.minServiceMonths)
      throw new AppError(422, `${type.name} requires ${type.minServiceMonths} months of service`);

    const sched = (await loadSchedules([emp.id], input.fromDate, input.toDate)).get(emp.id)!;
    const workingDays: string[] = [];
    for (let t = toMs(input.fromDate); t <= toMs(input.toDate); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (sched.isWorkingDay(d)) workingDays.push(d);
    }
    if (!workingDays.length) throw new AppError(422, "The selected dates are all weekly offs or holidays");
    if (input.halfDay && workingDays.length !== 1) throw new AppError(422, "That day is a weekly off or holiday");
    const days = input.halfDay ? D(0.5) : D(workingDays.length);

    // Overlap with pending/approved requests (two half-days of opposite sessions on one day are allowed).
    const clash = await tx.select().from(leaveRequests).where(and(
      eq(leaveRequests.employeeId, emp.id), inArray(leaveRequests.status, ["pending", "approved"]),
      lte(leaveRequests.fromDate, input.toDate), gte(leaveRequests.toDate, input.fromDate)));
    for (const c of clash) {
      if (!(input.halfDay && c.halfDay && c.halfDay !== input.halfDay)) throw new AppError(409, "Overlaps with an existing leave request");
    }

    if (type.payMode !== "unpaid" || Number(type.annualQuota) > 0) {
      await ensureBalances(emp.id, year, tx);
      const [bal] = await tx.select().from(leaveBalances)
        .where(and(eq(leaveBalances.employeeId, emp.id), eq(leaveBalances.leaveTypeId, type.id), eq(leaveBalances.year, year))).for("update");
      if (bal && type.payMode !== "unpaid") {
        const [{ pend }] = await tx.select({ pend: sql<string>`coalesce(sum(${leaveRequests.days}),0)` }).from(leaveRequests)
          .where(and(eq(leaveRequests.employeeId, emp.id), eq(leaveRequests.leaveTypeId, type.id), eq(leaveRequests.status, "pending"),
            gte(leaveRequests.fromDate, `${year}-01-01`), lte(leaveRequests.fromDate, `${year}-12-31`)));
        const avail = accrued(bal.allocated, type.accrual, year, todayISO()).plus(bal.carriedForward).plus(bal.adjustment).minus(bal.used).minus(pend);
        if (days.gt(avail)) throw new AppError(422, `Insufficient ${type.name} balance (${avail.toFixed(2)} days available)`);
      }
    }

    const [req] = await tx.insert(leaveRequests).values({
      employeeId: emp.id, leaveTypeId: type.id, fromDate: input.fromDate, toDate: input.toDate,
      halfDay: input.halfDay, days: toDb(days), reason: input.reason, requestedBy: user.id,
    }).returning();
    await audit({ action: "apply_leave", entity: "leave_request", entityId: req.id, after: req, ...who(user, meta) }, tx);
    if (!type.requiresApproval) await approveInTx(tx, req.id, "Auto-approved (no approval required)", user, meta, true);
    return req;
  });
}

async function approveInTx(tx: Tx, id: string, note: string | null, user: CurrentUser, meta: Meta, auto = false) {
  const [req] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)).for("update");
  if (!req) throw new AppError(404, "Request not found");
  if (req.status !== "pending") throw new AppError(409, `Request is already ${req.status}`);
  const [emp] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, req.employeeId));
  if (!auto && emp?.userId && emp.userId === user.id) throw new AppError(403, "You cannot approve your own leave");
  const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, req.leaveTypeId));
  const year = Number(req.fromDate.slice(0, 4));
  await ensureBalances(req.employeeId, year, tx);
  const [bal] = await tx.select().from(leaveBalances)
    .where(and(eq(leaveBalances.employeeId, req.employeeId), eq(leaveBalances.leaveTypeId, req.leaveTypeId), eq(leaveBalances.year, year))).for("update");
  if (bal && type.payMode !== "unpaid") {
    const avail = accrued(bal.allocated, type.accrual, year, todayISO()).plus(bal.carriedForward).plus(bal.adjustment).minus(bal.used);
    if (D(req.days).gt(avail)) throw new AppError(422, `Insufficient balance (${avail.toFixed(2)} days available)`);
  }
  if (bal) await tx.update(leaveBalances).set({ used: toDb(D(bal.used).plus(req.days)), version: sql`${leaveBalances.version} + 1` }).where(eq(leaveBalances.id, bal.id));

  const sched = (await loadSchedules([req.employeeId], req.fromDate, req.toDate)).get(req.employeeId)!;
  for (let t = toMs(req.fromDate); t <= toMs(req.toDate); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!sched.isWorkingDay(d)) continue;
    const status = req.halfDay ? ("half_day" as const) : ("on_leave" as const);
    await tx.insert(attendance).values({ employeeId: req.employeeId, date: d, status, note: `${type.name}`, leaveRequestId: req.id, createdBy: user.id })
      .onConflictDoUpdate({ target: [attendance.employeeId, attendance.date], set: { status, note: type.name, leaveRequestId: req.id, updatedAt: new Date() } });
  }
  await tx.update(leaveRequests).set({ status: "approved", decidedBy: user.id, decidedAt: new Date(), decisionNote: note, version: sql`${leaveRequests.version} + 1` }).where(eq(leaveRequests.id, id));
  await audit({ action: "approve_leave", entity: "leave_request", entityId: id, before: { status: "pending" }, after: { status: "approved", note }, ...who(user, meta) }, tx);
}

export async function decideLeave(id: string, decision: "approve" | "reject", note: string | null, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    if (decision === "approve") return approveInTx(tx, id, note, user, meta);
    const [req] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)).for("update");
    if (!req) throw new AppError(404, "Request not found");
    if (req.status !== "pending") throw new AppError(409, `Request is already ${req.status}`);
    await tx.update(leaveRequests).set({ status: "rejected", decidedBy: user.id, decidedAt: new Date(), decisionNote: note, version: sql`${leaveRequests.version} + 1` }).where(eq(leaveRequests.id, id));
    await audit({ action: "reject_leave", entity: "leave_request", entityId: id, before: { status: "pending" }, after: { status: "rejected", note }, ...who(user, meta) }, tx);
  });
}

/** Cancels a pending request, or an approved one (restoring the balance and clearing attendance). */
export async function cancelLeave(id: string, user: CurrentUser, meta: Meta) {
  await db.transaction(async (tx) => {
    const [req] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)).for("update");
    if (!req) throw new AppError(404, "Request not found");
    if (req.status === "approved" && !user.permissions.has("hr:leave:approve")) throw new AppError(403, "Only approvers can cancel approved leave");
    if (req.status !== "pending" && req.status !== "approved") throw new AppError(409, `Request is already ${req.status}`);
    if (req.status === "approved") {
      const year = Number(req.fromDate.slice(0, 4));
      const [bal] = await tx.select().from(leaveBalances)
        .where(and(eq(leaveBalances.employeeId, req.employeeId), eq(leaveBalances.leaveTypeId, req.leaveTypeId), eq(leaveBalances.year, year))).for("update");
      if (bal) await tx.update(leaveBalances).set({ used: toDb(Decimal.max(D(0), D(bal.used).minus(req.days))), version: sql`${leaveBalances.version} + 1` }).where(eq(leaveBalances.id, bal.id));
      await tx.delete(attendance).where(eq(attendance.leaveRequestId, req.id));
    }
    await tx.update(leaveRequests).set({ status: "cancelled", version: sql`${leaveRequests.version} + 1` }).where(eq(leaveRequests.id, id));
    await audit({ action: "cancel_leave", entity: "leave_request", entityId: id, before: { status: req.status }, after: { status: "cancelled" }, ...who(user, meta) }, tx);
  });
}

export async function listRequests(p: { status?: string; employeeId?: string; page?: number }) {
  const where = [p.status ? eq(leaveRequests.status, p.status as never) : undefined, p.employeeId ? eq(leaveRequests.employeeId, p.employeeId) : undefined].filter(Boolean);
  return db.select({
    r: leaveRequests, name: employees.name, code: employees.empCode, type: leaveTypes.name,
  }).from(leaveRequests).innerJoin(employees, eq(employees.id, leaveRequests.employeeId)).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(...(where as never[]))).orderBy(desc(leaveRequests.createdAt)).limit(100);
}

/**
 * Year-end rollover (optional per leave type): carries unused days into next year, capped at the type's max.
 * Idempotent: re-running recalculates the same carried amounts.
 */
export async function rolloverYear(fromYear: number, user: CurrentUser, meta: Meta) {
  return db.transaction(async (tx) => {
    const rows = await tx.select({ b: leaveBalances, t: leaveTypes }).from(leaveBalances)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
      .where(and(eq(leaveBalances.year, fromYear), eq(leaveTypes.carryForward, true), ne(leaveTypes.carryForwardMax, "0")));
    let n = 0;
    for (const { b, t } of rows) {
      const remaining = D(b.allocated).plus(b.carriedForward).plus(b.adjustment).minus(b.used);
      const carry = Decimal.min(Decimal.max(remaining, D(0)), D(t.carryForwardMax));
      await tx.insert(leaveBalances).values({ employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: fromYear + 1, allocated: t.annualQuota, carriedForward: toDb(carry) })
        .onConflictDoUpdate({ target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year], set: { carriedForward: toDb(carry) } });
      n++;
    }
    await audit({ action: "leave_rollover", entity: "leave_balance", entityId: String(fromYear), after: { fromYear, balances: n }, ...who(user, meta) }, tx);
    return n;
  });
}
