"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { hashPassword, passwordPolicyError } from "@/lib/password";
import { clientMeta } from "@/lib/request";
import { revokeAllSessions } from "@/lib/session";

export type State = { error?: string; ok?: boolean } | undefined;

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  roleId: z.uuid(),
  password: z.string().max(200),
});

export async function createUser(_: State, form: FormData): Promise<State> {
  const actor = await requirePermission("admin:user:write");
  const p = createSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Please check the form fields" };
  const pwErr = passwordPolicyError(p.data.password);
  if (pwErr) return { error: pwErr };

  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, p.data.email)).limit(1);
  if (exists) return { error: "A user with this email already exists" };
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, p.data.roleId)).limit(1);
  if (!role) return { error: "Unknown role" };

  const meta = await clientMeta();
  await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({
      name: p.data.name, email: p.data.email, roleId: p.data.roleId,
      passwordHash: await hashPassword(p.data.password), mustChangePassword: true,
    }).returning({ id: users.id });
    await audit({ action: "create", entity: "user", entityId: u.id, after: { email: p.data.email, roleId: p.data.roleId }, userId: actor.id, userEmail: actor.email, ...meta }, tx);
  });
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function setUserActive(form: FormData) {
  const actor = await requirePermission("admin:user:write");
  const id = z.uuid().parse(form.get("id"));
  const active = form.get("active") === "true";
  if (id === actor.id) return; // cannot deactivate yourself
  const meta = await clientMeta();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ isActive: active }).where(eq(users.id, id));
    await audit({ action: active ? "activate" : "deactivate", entity: "user", entityId: id, userId: actor.id, userEmail: actor.email, ...meta }, tx);
  });
  if (!active) await revokeAllSessions(id);
  revalidatePath("/admin/users");
}
