import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createHmac } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, DEMO_MODE } from "@/db";
import { sessions } from "@/db/schema";
import { randomToken, sha256 } from "./crypto";

const IS_PROD = process.env.NODE_ENV === "production";
// __Host- prefix: Secure, Path=/, no Domain -> cannot be overwritten by sibling subdomains.
export const SESSION_COOKIE = IS_PROD ? "__Host-erp_session" : "erp_session";
const SESSION_HOURS = 12;

/**
 * Demo mode: every serverless instance has its own in-memory database, so a session row created on one instance is
 * unknown to the next. The token therefore carries the session itself, signed, and an instance that has never seen it
 * re-creates the row. The key is public on purpose: demo data is fictional and the demo password is published.
 */
const demoSig = (body: string) => createHmac("sha256", "vip-demo-session-v1").update(body).digest("base64url");
function demoToken(userId: string, expiresAt: Date, mfa: boolean) {
  const body = [randomToken(12), userId, expiresAt.getTime(), mfa ? 1 : 0].join(".");
  return `${body}.${demoSig(body)}`;
}
function parseDemoToken(token: string) {
  const i = token.lastIndexOf(".");
  if (i < 0 || demoSig(token.slice(0, i)) !== token.slice(i + 1)) return null;
  const [, userId, exp, mfa] = token.slice(0, i).split(".");
  const expiresAt = new Date(Number(exp));
  if (!userId || !(expiresAt.getTime() > Date.now())) return null;
  return { userId, expiresAt, mfa: mfa === "1" };
}

export async function createSession(userId: string, meta: { ip: string | null; userAgent: string | null }, mfaVerified: boolean) {
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  const token = DEMO_MODE ? demoToken(userId, expiresAt, mfaVerified) : randomToken();
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
  await connection(); // request-time boundary: the embedded demo database reads the clock while it runs
  const find = async () => (await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`))
    .limit(1))[0] ?? null;
  const row = await find();
  if (row || !DEMO_MODE) return row;
  // Demo mode: a valid signed token from another instance. Re-create its session row here.
  const t = parseDemoToken(token);
  if (!t) return null;
  try {
    await db.insert(sessions).values({ userId: t.userId, tokenHash: sha256(token), mfaVerifiedAt: t.mfa ? new Date() : null, ip: null, userAgent: null, expiresAt: t.expiresAt }).onConflictDoNothing();
  } catch { return null; } // unknown user on this instance
  return find();
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
