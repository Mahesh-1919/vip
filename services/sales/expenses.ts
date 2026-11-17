import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { containerCosts, containers } from "@/db/schema";

export const PAGE_SIZE = 25;

export async function listExpenses(f: { containerId?: string; type?: string; from?: string; to?: string; page?: number }) {
  const where: SQL[] = [];
  if (f.containerId) where.push(eq(containerCosts.containerId, f.containerId));
  if (f.type) where.push(eq(containerCosts.type, f.type));
  if (f.from) where.push(gte(containerCosts.incurredOn, f.from));
  if (f.to) where.push(lte(containerCosts.incurredOn, f.to));
  const w = where.length ? and(...where) : undefined;
  const page = Math.max(1, f.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select({ k: containerCosts, containerNo: containers.containerNo, ref: containers.ref }).from(containerCosts).innerJoin(containers, eq(containers.id, containerCosts.containerId))
      .where(w).orderBy(desc(containerCosts.incurredOn), desc(containerCosts.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(containerCosts).where(w),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}
