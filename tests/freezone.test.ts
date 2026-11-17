import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, sql as pg } from "@/db";
import { entryBills, exitBills, users } from "@/db/schema";
import { entrySchema, exitSchema } from "@/validators/freezone";
import * as fz from "@/services/freezone";

const meta = { ip: null, userAgent: null };
const tag = `T${Date.now()}`;
let user: never;

beforeAll(async () => { const [u] = await db.select().from(users).limit(1); user = { id: u.id, email: u.email, permissions: new Set() } as never; });
afterAll(async () => {
  await db.delete(entryBills).where(inArray(entryBills.billNo, [`${tag}-E1`]));
  await db.delete(exitBills).where(inArray(exitBills.boeNo, [`${tag}-X1`]));
  await pg.end();
});

describe("sheet validation", () => {
  it("accepts numbers written the way the sheets show them", () => {
    const p = entrySchema.parse({ billDate: "2026-01-03", billNo: "1-3-60-8-26-493", valueAed: "6,486.15", weightKg: "9,100", packages: "331", originCountry: "cn" });
    expect(p.valueAed).toBe("6486.15"); expect(p.weightKg).toBe("9100"); expect(p.packages).toBe("331"); expect(p.originCountry).toBe("CN");
    expect(entrySchema.safeParse({ billDate: "2026-01-03", billNo: "" }).success).toBe(false);
    expect(entrySchema.parse({ billDate: "2026-01-03", billNo: "X", valueAed: "", packages: "" }).valueAed).toBe("0");
  });
  it("restricts bill type and statuses", () => {
    const base = { exitDate: "2026-01-05", boeNo: "B1", billType: "EXPORT", entryCertStatus: "Received", refundStatus: "Refund Received", valueAed: "1", weightKg: "1", packages: "1" };
    expect(exitSchema.safeParse(base).success).toBe(true);
    expect(exitSchema.safeParse({ ...base, billType: "OTHER" }).success).toBe(false);
    expect(exitSchema.safeParse({ ...base, refundStatus: "Maybe" }).success).toBe(false);
  });
});

describe("entry and exit bills", () => {
  it("creates, updates with optimistic locking, filters, totals and deletes entries", async () => {
    const data = entrySchema.parse({ billDate: "2026-02-01", billNo: `${tag}-E1`, agentName: "Test Agent", valueAed: "1000", weightKg: "500", packages: "10", originCountry: "TR", marksNumbers: "MSKU1234567" });
    const { version: _v, ...d } = data; void _v;
    const e = await fz.saveEntry(null, d as never, undefined, user, meta);
    await expect(fz.saveEntry(null, d as never, undefined, user, meta)).rejects.toMatchObject({ status: 409 }); // duplicate bill no
    await fz.saveEntry(e.id, { ...d, agentName: "Renamed" } as never, e.version, user, meta);
    await expect(fz.saveEntry(e.id, d as never, e.version, user, meta)).rejects.toMatchObject({ status: 409 }); // stale version
    const hit = await fz.listEntries({ q: "MSKU1234567" });
    expect(hit.total).toBe(1); expect(hit.rows[0].e.agentName).toBe("Renamed");
    expect(Number(hit.totals.value)).toBe(1000); expect(Number(hit.totals.packages)).toBe(10);
    expect((await fz.listEntries({ q: tag, from: "2027-01-01" })).total).toBe(0);
    await fz.deleteEntry(e.id, user, meta);
    expect(await fz.getEntry(e.id)).toBeNull();
  });

  it("creates exit bills and filters by refund status", async () => {
    const d = exitSchema.parse({ exitDate: "2026-02-02", boeNo: `${tag}-X1`, billType: "EXPORT", entryCertStatus: "Pending", refundStatus: "Pending", valueAed: "2,500.50", weightKg: "1000", packages: "5", chequeAmount: "1,200" });
    const { version: _v, ...data } = d; void _v;
    const x = await fz.saveExit(null, data as never, undefined, user, meta);
    expect(x.chequeAmount).toBe("1200.00");
    const pending = await fz.listExits({ q: tag, refund: "Pending", cert: "Pending", type: "EXPORT" });
    expect(pending.total).toBe(1);
    expect(Number(pending.totals.cheques)).toBe(1200);
    expect((await fz.listExits({ q: tag, refund: "Refund Received" })).total).toBe(0);
    expect(await db.select().from(exitBills).where(eq(exitBills.id, x.id))).toHaveLength(1);
  });
});
