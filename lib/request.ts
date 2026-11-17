import "server-only";
import { headers } from "next/headers";

export async function clientMeta() {
  const h = await headers();
  const fwd = process.env.TRUST_PROXY === "true" ? h.get("x-forwarded-for")?.split(",")[0]?.trim() : null;
  return { ip: fwd || h.get("x-real-ip") || null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}
