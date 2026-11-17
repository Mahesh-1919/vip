"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { decryptField, encryptField } from "@/lib/crypto";
import { checkTotp, newTotpSecret } from "@/lib/totp";
import { clientMeta } from "@/lib/request";
import { markMfaVerified } from "@/lib/session";

export type State = { error?: string; ok?: boolean } | undefined;

/** Step 1: store a fresh (not yet enabled) secret. */
export async function beginTotpEnrollment() {
  const user = await requireUser({ allowUnenrolled: true });
  if (user.totpEnabled) return;
  await db.update(users).set({ totpSecretEnc: encryptField(newTotpSecret()) }).where(eq(users.id, user.id));
  revalidatePath("/account/security");
}

/** Step 2: prove possession by entering a code, then enable. */
export async function confirmTotpEnrollment(_: State, form: FormData): Promise<State> {
  const user = await requireUser({ allowUnenrolled: true });
  const code = z.string().regex(/^\d{6}$/).safeParse(String(form.get("code") ?? "").replace(/\s/g, ""));
  if (!code.success) return { error: "Enter the 6-digit code" };
  const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!u?.totpSecretEnc) return { error: "Start enrollment first" };
  const step = checkTotp(decryptField(u.totpSecretEnc), code.data);
  if (step === null) return { error: "Invalid code" };
  await db.update(users).set({ totpEnabled: true, totpLastStep: step }).where(eq(users.id, user.id));
  await markMfaVerified(user.sessionId); // the enrolling session has just proven the factor
  await audit({ action: "mfa_enabled", entity: "user", entityId: user.id, userId: user.id, userEmail: user.email, ...(await clientMeta()) });
  revalidatePath("/", "layout");
  return { ok: true };
}
