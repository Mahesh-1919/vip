import "server-only";
import { connection, NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { getCurrentUser, type CurrentUser } from "./auth";
import type { Permission } from "./rbac";

export { AppError };

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: { user: CurrentUser; params: P }) => Promise<Response | unknown>;

/** Same-origin check for cookie-authenticated mutations (defence in depth on top of SameSite=Lax). */
function originOk(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
}

/**
 * Wraps a Route Handler: authenticates, authorises (ALL listed permissions), CSRF-checks,
 * and converts errors to safe JSON. Every API route must go through this.
 */
export function route<P = Record<string, never>>(permissions: Permission[], handler: Handler<P>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    // Authenticated handlers are always request-time: opt out of prerendering (Cache Components) explicitly.
    await connection();
    try {
      if (!originOk(req)) throw new AppError(403, "Cross-origin request blocked");
      const user = await getCurrentUser();
      if (!user || user.mfaPending) throw new AppError(401, "Not authenticated");
      if (user.mfaRequired && !user.totpEnabled) throw new AppError(403, "Two-factor enrolment required");
      if (!permissions.every((p) => user.permissions.has(p))) throw new AppError(403, "Forbidden");
      const out = await handler(req, { user, params: await ctx.params });
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Validation failed", details: e.flatten() }, { status: 422 });
      console.error("[api]", e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
