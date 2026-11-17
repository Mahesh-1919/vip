import "server-only";
import { cookies } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { randomToken, sha256 } from "./crypto";

const IS_PROD = process.env.NODE_ENV === "production";
// __Host- prefix: Secure, Path=/, no Domain -> cannot be overwritten by sibling subdomains.
export const SESSION_COOKIE = IS_PROD ? "__Host-erp_session" : "erp_session";
const SESSION_HOURS = 12;

export async function createSession(userId: string, meta: { ip: string | null; userAgent: string | null }, mfaVerified: boolean) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    mfaVerifiedAt: mfaVerified ? new Date() : null,
    ip: meta.ip,
    userAgent: meta.userAgent,
    expiresAt,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSessionRow() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function markMfaVerified(sessionId: string) {
  await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
