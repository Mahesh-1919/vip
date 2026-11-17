"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, suppliers } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { clientMeta } from "@/lib/request";
import { toDb } from "@/lib/money";
import { partySchema } from "@/validators/containers";

type Kind = "supplier" | "customer";
const dup = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505";

export async function saveParty(kind: Kind, id: string | null, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requirePermission(`inventory:${kind}:write`);
  const p = partySchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: `${p.error.issues[0].path[0] ? String(p.error.issues[0].path[0]) + ": " : ""}${p.error.issues[0].message}` };
  const { version, paymentTermsDays, creditDays, creditLimit, ...base } = p.data;
  const meta = await clientMeta();
  const table = kind === "supplier" ? suppliers : customers;
  const extra = kind === "supplier" ? { paymentTermsDays: paymentTermsDays ?? 30 } : { creditDays: creditDays ?? 30, creditLimit: toDb(creditLimit || "0") };
  try {
    if (!id) {
      const [row] = await db.transaction(async (tx) => {
        const r = await tx.insert(table).values({ ...base, ...extra } as never).returning({ id: table.id });
        await audit({ action: "create", entity: kind, entityId: r[0].id, after: { ...base, ...extra }, userId: user.id, userEmail: user.email, ...meta }, tx);
        return r;
      });
      revalidatePath("/inventory", "layout");
      redirect(`/inventory/${kind}s/${row.id}`);
    }
    if (!version) return { error: "Missing version: reload the page" };
    const err = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(table).where(eq(table.id, id)).for("update");
      if (!before) return "Not found";
      const [after] = await tx.update(table).set({ ...base, ...extra, version: sql`${table.version} + 1` } as never).where(and(eq(table.id, id), eq(table.version, version))).returning();
      if (!after) return "This record was changed by someone else. Reload and try again.";
      await audit({ action: "update", entity: kind, entityId: id, before, after, userId: user.id, userEmail: user.email, ...meta }, tx);
      return null;
    });
    if (err) return { error: err };
  } catch (e) { if (dup(e)) return { error: "That code is already in use" }; throw e; }
  revalidatePath("/inventory", "layout");
  return { ok: "Saved" };
}

export async function setPartyActive(form: FormData) {
  const p = z.object({ kind: z.enum(["supplier", "customer"]), id: z.uuid(), active: z.enum(["true", "false"]) }).parse(Object.fromEntries(form));
  const user = await requirePermission(`inventory:${p.kind}:write`);
  const table = p.kind === "supplier" ? suppliers : customers;
  await db.update(table).set({ isActive: p.active === "true" }).where(eq(table.id, p.id));
  await audit({ action: p.active === "true" ? "activate" : "deactivate", entity: p.kind, entityId: p.id, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  revalidatePath("/inventory", "layout");
}
