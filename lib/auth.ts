import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roles, rolePermissions, users } from "@/db/schema";
import { getSessionRow } from "./session";
import type { Permission } from "./rbac";

export type CurrentUser = {
  id: string;
  sessionId: string;
  email: string;
  name: string;
  role: { key: string; name: string };
  permissions: Set<Permission>;
  totpEnabled: boolean;
  mfaRequired: boolean; // role policy says MFA must be enrolled
  mfaPending: boolean; // enrolled but this session has not passed the second factor
};

/** Resolves the session -> user -> permissions. Always fresh from the DB (revocation is immediate). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await getSessionRow();
  if (!s) return null;
  const [u] = await db
    .select({
      id: users.id, email: users.email, name: users.name, isActive: users.isActive,
      totpEnabled: users.totpEnabled, roleId: users.roleId, roleKey: roles.key, roleName: roles.name,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, s.userId))
    .limit(1);
  if (!u || !u.isActive) return null;
  const perms = await db.select({ p: rolePermissions.permission }).from(rolePermissions).where(eq(rolePermissions.roleId, u.roleId));
  const required = (process.env.MFA_REQUIRED_ROLES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    id: u.id, sessionId: s.id, email: u.email, name: u.name,
    role: { key: u.roleKey, name: u.roleName },
    permissions: new Set(perms.map((x) => x.p as Permission)),
    totpEnabled: u.totpEnabled,
    mfaRequired: required.includes(u.roleKey),
    mfaPending: u.totpEnabled && !s.mfaVerifiedAt,
  };
});

export const can = (user: CurrentUser, p: Permission) => user.permissions.has(p);

/** For pages/layouts/actions. Redirects instead of throwing. */
export async function requireUser(opts?: { allowUnenrolled?: boolean }): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mfaPending) redirect("/login/verify");
  // Roles whose policy mandates 2FA can only reach the enrolment page until they enrol.
  if (user.mfaRequired && !user.totpEnabled && !opts?.allowUnenrolled) redirect("/account/security");
  return user;
}

export async function requirePermission(...perms: Permission[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!perms.every((p) => can(user, p))) redirect("/forbidden");
  return user;
}
