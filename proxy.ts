import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate only: redirect cookie-less visitors to /login. Real authentication and
// authorisation happen in the Data Access Layer (lib/auth.ts) and in every route handler.
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-erp_session" : "erp_session";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/login/");
  const hasCookie = req.cookies.has(COOKIE);
  if (!hasCookie && !isPublic && !pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp|jpg)$).*)"],
};
