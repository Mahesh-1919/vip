"use server";

import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { decryptField } from "@/lib/crypto";
import { dummyVerify, verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { clientMeta } from "@/lib/request";
import { createSession, destroySession, getSessionRow, markMfaVerified } from "@/lib/session";
import { checkTotp } from "@/lib/totp";

export type FormState = { error?: string } | undefined;

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const GENERIC = "Invalid email or password";

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) });

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: GENERIC };
  const { email, password } = parsed.data;
  const meta = await clientMeta();

  if (!rateLimit(`login:ip:${meta.ip}`, 20, 60_000) || !rateLimit(`login:email:${email}`, 10, 60_000))
    return { error: "Too many attempts. Try again in a minute." };

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    await dummyVerify(password);
    await audit({ action: "login_failed", entity: "user", userEmail: email, ...meta });
    return { error: GENERIC };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ action: "login_blocked_locked", entity: "user", entityId: user.id, userId: user.id, userEmail: email, ...meta });
    return { error: "Account temporarily locked. Try again later." };
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok || !user.isActive) {
    const locked = user.failedAttempts + 1 >= MAX_FAILS;
    await db.update(users).set({
      failedAttempts: locked ? 0 : sql`${users.failedAttempts} + 1`,
      lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
    }).where(eq(users.id, user.id));
    await audit({ action: locked ? "account_locked" : "login_failed", entity: "user", entityId: user.id, userId: user.id, userEmail: email, ...meta });
    return { error: GENERIC };
  }

  await db.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await createSession(user.id, meta, !user.totpEnabled);
  await audit({ action: "login", entity: "user", entityId: user.id, userId: user.id, userEmail: email, ...meta });
  redirect(user.totpEnabled ? "/login/verify" : "/");
}

export async function verifyTotpAction(_: FormState, form: FormData): Promise<FormState> {
  const token = z.string().regex(/^\d{6}$/).safeParse(String(form.get("code") ?? "").replace(/\s/g, ""));
  if (!token.success) return { error: "Enter the 6-digit code" };
  const s = await getSessionRow();
  if (!s) redirect("/login");
  if (!rateLimit(`totp:${s.userId}`, 5, 60_000)) return { error: "Too many attempts. Wait a minute." };

  const [u] = await db.select().from(users).where(and(eq(users.id, s.userId), eq(users.isActive, true))).limit(1);
  if (!u?.totpSecretEnc) redirect("/login");
  const step = checkTotp(decryptField(u.totpSecretEnc), token.data);
  const meta = await clientMeta();
  if (step === null || (u.totpLastStep !== null && step <= u.totpLastStep)) {
    await audit({ action: "mfa_failed", entity: "user", entityId: u.id, userId: u.id, userEmail: u.email, ...meta });
    return { error: "Invalid code" };
  }
  await db.update(users).set({ totpLastStep: step }).where(eq(users.id, u.id));
  await markMfaVerified(s.id);
  await audit({ action: "mfa_verified", entity: "user", entityId: u.id, userId: u.id, userEmail: u.email, ...meta });
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
