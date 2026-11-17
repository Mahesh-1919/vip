import {
  pgTable, text, boolean, timestamp, integer, uuid, primaryKey, index, bigint, jsonb,
} from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, version } from "./_columns";

export const roles = pgTable("roles", {
  id: id(),
  key: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  /** System roles can have permissions edited but cannot be deleted. */
  isSystem: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid().notNull().references(() => roles.id, { onDelete: "cascade" }),
    permission: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text().notNull().unique(), // stored lower-case
    name: text().notNull(),
    passwordHash: text().notNull(),
    roleId: uuid().notNull().references(() => roles.id),
    isActive: boolean().notNull().default(true),
    mustChangePassword: boolean().notNull().default(false),
    // TOTP 2FA. Secret is AES-256-GCM encrypted (lib/crypto.ts).
    totpSecretEnc: text(),
    totpEnabled: boolean().notNull().default(false),
    totpLastStep: integer(),
    failedAttempts: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("users_role_idx").on(t.roleId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the cookie token. The raw token is never stored. */
    tokenHash: text().notNull().unique(),
    mfaVerifiedAt: timestamp({ withTimezone: true }),
    ip: text(),
    userAgent: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Append-only. A DB trigger (see drizzle/ custom migration) blocks UPDATE and DELETE. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userId: uuid(), // intentionally no FK: logs must outlive users
    userEmail: text(),
    action: text().notNull(), // e.g. create | update | delete | login | login_failed
    entity: text().notNull(), // e.g. user, employee, invoice
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    userAgent: text(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entity, t.entityId),
    index("audit_user_idx").on(t.userId),
    index("audit_at_idx").on(t.at),
  ],
);
